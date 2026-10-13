import { _electron as electron } from 'playwright';
import { installUiAccount } from './install-ui-account.mjs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const profile = path.resolve('test-results', `history-branding-${Date.now()}`);
await mkdir(profile, { recursive: true });
const app = await electron.launch({
  args: ['.'],
  env: { ...process.env, COPILOT_TEST_USER_DATA: profile, VITE_DEV_SERVER_URL: '' },
});
const checks = [];
const errors = [];
try {
  await installUiAccount(app, { speech: true });
  await app.evaluate(({ app }) => {
    const require = process
      .getBuiltinModule('module')
      .createRequire(app.getAppPath() + '/package.json');
    const { ChatGPTService } = require(app.getAppPath() + '/dist-electron/backend/chat/service.js');
    const original = ChatGPTService.prototype.stream;
    ChatGPTService.prototype.stream = async function (request, emit, signal) {
      if (!request.id.startsWith('history-title-'))
        return original.call(this, request, emit, signal);
      globalThis.titleRequest = request;
      globalThis.titleCalls = (globalThis.titleCalls || 0) + 1;
      if (globalThis.titleFail) {
        globalThis.titleFail = false;
        throw Error('synthetic failure');
      }
      return new Promise((resolve) => {
        globalThis.finishTitle = () =>
          resolve({ answerText: '机器人控制与工业自动化岗位面试', usage: null, sources: [] });
      });
    };
  });
  const login = await app.firstWindow();
  await login.getByRole('button', { name: 'Continue with ChatGPT', exact: true }).waitFor();
  await app.evaluate(({ app }) => {
    const require = process
      .getBuiltinModule('module')
      .createRequire(app.getAppPath() + '/package.json');
    const { ChatGPTAuthService } = require(
      app.getAppPath() + '/dist-electron/backend/auth/service.js',
    );
    const session = ChatGPTAuthService.prototype.session;
    globalThis.delayStartup = true;
    ChatGPTAuthService.prototype.session = async function () {
      if (globalThis.delayStartup)
        await new Promise((resolve) => {
          globalThis.releaseStartup = resolve;
        });
      return session.call(this);
    };
  });
  await login.reload();
  await login.locator('.startup-screen .app-logo').waitFor();
  await login.screenshot({ path: path.join(profile, 'startup.png') });
  await app.evaluate(() => {
    globalThis.delayStartup = false;
    globalThis.releaseStartup();
  });
  await login.getByRole('button', { name: 'Continue with ChatGPT', exact: true }).waitFor();
  checks.push('startup screen shows supplied Logo while session loads');
  assert.equal(await login.locator('.login-brand .app-logo').count(), 1);
  await login.screenshot({ path: path.join(profile, 'login.png') });
  const [main] = await Promise.all([
    app.waitForEvent('window'),
    login.getByRole('button', { name: 'Continue with ChatGPT', exact: true }).click(),
  ]);
  main.setDefaultTimeout(15000);
  main.on('pageerror', (e) => errors.push(e.message));
  await main.getByRole('button', { name: '面试记录', exact: true }).click();
  await main.evaluate(() => {
    const startedAt = Date.now() - 3600000;
    const transcripts = Array.from({ length: 120 }, (_, i) => ({
      id: 's' + i,
      source: i % 3 === 1 ? 'microphone' : 'system',
      text:
        i === 0
          ? '请介绍机器人控制项目'
          : i === 80
            ? '如何设计工业系统的可靠性？'
            : `第 ${i + 1} 条转录：讨论控制系统与工程实践。`,
      time: '10:00',
      startMs: startedAt + i * 1000,
      final: true,
    }));
    const answers = [
      {
        id: 'a0',
        question: transcripts[0].text,
        content: '**项目概况**\n\n使用 C++ 与 ROS 2 完成控制系统。',
        provider: 'chatgpt',
        sourceTranscriptIds: ['s0'],
        createdAt: startedAt + 1000,
      },
      {
        id: 'a80',
        question: transcripts[80].text,
        content: '通过隔离故障、状态监测与回归验证提高可靠性。',
        provider: 'chatgpt',
        sourceTranscriptIds: ['s80'],
        createdAt: startedAt + 81000,
      },
      { id: 'manual', question: '手动输入的问题', content: '', provider: 'chatgpt' },
    ];
    const record = {
      id: 'fixture',
      title: '机器人工业自动化工程师（控制系统与可靠性设计）',
      titleStatus: 'ready',
      startedAt,
      endedAt: startedAt + 180000,
      status: 'ended',
      mock: false,
      transcripts,
      answers,
    };
    localStorage.setItem(
      'copilot-interview-history-v1',
      JSON.stringify([
        record,
        { ...record, id: 'hidden', mock: true, title: 'hidden-mock-sentinel' },
      ]),
    );
    window.dispatchEvent(new StorageEvent('storage', { key: 'copilot-interview-history-v1' }));
  });
  assert.equal(await main.locator('.history-row').count(), 1);
  await main.locator('.history-row').click();
  await main.locator('.record-transcript-row').nth(119).waitFor();
  assert.equal(await main.locator('.record-answer-panel').count(), 0);
  assert.equal(await main.locator('.record-transcript-row time').nth(80).innerText(), '1:20');
  const centered = await main.locator('.record-reading-column').evaluate((el) => {
    const r = el.getBoundingClientRect(),
      p = el.parentElement.getBoundingClientRect();
    return {
      r: { left: r.left, right: r.right },
      p: { left: p.left, right: p.right },
      width: el.parentElement.clientWidth,
    };
  });
  assert(Math.abs(centered.r.left + centered.r.right - (centered.p.left * 2 + centered.width)) < 3);
  await main.screenshot({ path: path.join(profile, 'timeline.png') });
  checks.push('centered timeline, elapsed times, 120 rows, legacy Mock hidden');
  await main.getByRole('button', { name: '查看回答：请介绍机器人控制项目', exact: true }).click();
  await main.getByRole('complementary', { name: 'AI 回答', exact: true }).waitFor();
  assert.equal(await main.locator('.record-answer-content strong').innerText(), '项目概况');
  await main.screenshot({path:path.join(profile,'overview.png')});
  const reliability = main.getByRole('article', {
    name: '回答：如何设计工业系统的可靠性？',
    exact: true,
  });
  await reliability.getByRole('button', { name: '定位到原问题' }).click();
  await main.locator('.record-transcript-row.is-located').waitFor();
  await main.waitForFunction(() => {
    const e = document.querySelector('.record-transcript-row.is-located');
    const r = e.getBoundingClientRect(),
      p = e.closest('.record-transcript-scroll').getBoundingClientRect();
    return r.top >= p.top && r.bottom <= p.bottom;
  });
  assert.equal(
    await main
      .getByRole('article', { name: '回答：手动输入的问题', exact: true })
      .getByRole('button', { name: '定位到原问题' })
      .count(),
    0,
  );
  await main.screenshot({ path: path.join(profile, 'answer-rail.png') });
  checks.push('AI answer rail, Markdown, link and reverse location, manual/empty answer');
  const output = path.join(profile, 'export.txt');
  await app.evaluate(({ dialog }, file) => {
    globalThis.exportDialogs = 0;
    dialog.showSaveDialog = async (_w, options) => {
      globalThis.exportDialogs++;
      globalThis.exportOptions = options;
      return { canceled: false, filePath: file };
    };
  }, output);
  await main.getByRole('button', { name: '导出 TXT', exact: true }).click();
  await main.getByRole('button', { name: '导出 TXT', exact: true }).waitFor();
  const exported = await readFile(output, 'utf8');
  assert(exported.startsWith('\uFEFF'));
  assert(exported.includes('[1:20] 面试官'));
  assert(exported.includes('**项目概况**'));
  assert(!exported.includes('hidden-mock-sentinel'));
  await app.evaluate(({ dialog }) => {
    dialog.showSaveDialog = async () => ({ canceled: true });
  });
  await main.getByRole('button', { name: '导出 TXT', exact: true }).click();
  assert.equal(await readFile(output, 'utf8'), exported);
  checks.push('native TXT export with BOM and cancellation');
  await main.evaluate(() => document.documentElement.classList.add('dark'));
  await main.screenshot({ path: path.join(profile, 'detail-dark.png') });
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((w) => !w.webContents.getURL().includes('#'))
      .setSize(900, 720),
  );
  assert(await main.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await main.screenshot({ path: path.join(profile, 'detail-narrow.png') });
  checks.push('dark theme and narrow layout');
  await main.getByRole('button', { name: '删除记录', exact: true }).click();
  const dialog = main.getByRole('dialog', { name: '删除面试记录', exact: true });
  assert.equal(
    await dialog
      .getByRole('button', { name: '取消', exact: true })
      .evaluate((el) => document.activeElement === el),
    true,
  );
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  assert.equal(await main.locator('.record-transcript-row').count(), 120);
  checks.push('delete confirmation defaults to cancel');
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((w) => !w.webContents.getURL().includes('#'))
      .setSize(1280, 800),
  );
  await main.evaluate(() => document.documentElement.classList.remove('dark'));
  await main.getByRole('button', { name: '新对话', exact: true }).click();
  await main.getByRole('button', { name: '开始面试', exact: true }).click();
  const [floating] = await Promise.all([
    app.waitForEvent('window'),
    main.getByRole('button', { name: '确认开始', exact: true }).click(),
  ]);
  floating.on('pageerror', (e) => errors.push(e.message));
  await floating.getByText('Synthetic interview answer', { exact: true }).waitFor();
  await floating.getByRole('button', { name: '结束面试', exact: true }).click();
  await Promise.all([
    floating.waitForEvent('close'),
    floating.getByRole('button', { name: '确认结束面试', exact: true }).click(),
  ]);
  await app.evaluate(async () => {
    for (let i = 0; i < 50 && !globalThis.finishTitle; i++)
      await new Promise((r) => setTimeout(r, 50));
    if (!globalThis.finishTitle) throw Error('Title job missing');
  });
  assert.equal(
    await main.evaluate(
      () =>
        JSON.parse(localStorage.getItem('copilot-interview-history-v1')).find(
          (r) => r.id !== 'fixture' && r.id !== 'hidden',
        ).titleStatus,
    ),
    'pending',
  );
  await app.evaluate(() => globalThis.finishTitle());
  await main.waitForFunction(() =>
    JSON.parse(localStorage.getItem('copilot-interview-history-v1')).some(
      (r) => r.title === '机器人控制与工业自动化岗位面试',
    ),
  );
  const request = await app.evaluate(() => globalThis.titleRequest);
  assert.equal(request.modelId, 'test-model');
  assert.equal(request.webSearch, false);
  assert(request.turns[0].content.includes('Synthetic interviewer question'));
  checks.push(
    'end interview closes promptly; native title survives window close and off-page completion',
  );
  await main.getByRole('button', { name: '面试记录', exact: true }).click();
  await main.locator('.history-row').filter({ hasText: '机器人控制与工业自动化岗位面试' }).click();
  await main.locator('.record-session-heading h1').waitFor();
  const refs = await main.evaluate(
    () =>
      JSON.parse(localStorage.getItem('copilot-interview-history-v1')).find(
        (r) => r.title === '机器人控制与工业自动化岗位面试',
      ).answers[0].sourceTranscriptIds,
  );
  assert.deepEqual(refs, ['synthetic-system']);
  checks.push('new saved answer references original system transcript');
  await main.getByRole('button', { name: '返回面试记录', exact: true }).click();
  await app.evaluate(() => {
    globalThis.titleFail = true;
    globalThis.finishTitle = undefined;
  });
  await main.evaluate(() => {
    const records = JSON.parse(localStorage.getItem('copilot-interview-history-v1'));
    records.unshift({
      ...records[0],
      id: 'retry-title',
      title: '待生成标题',
      titleStatus: undefined,
    });
    localStorage.setItem('copilot-interview-history-v1', JSON.stringify(records));
    window.dispatchEvent(new StorageEvent('storage', { key: 'copilot-interview-history-v1' }));
  });
  await main.locator('.history-row').filter({ hasText: '待生成标题' }).click();
  await main.getByRole('button', { name: '重试生成标题', exact: true }).waitFor();
  await main.getByRole('button', { name: '重试生成标题', exact: true }).click();
  await app.evaluate(async () => {
    for (let i = 0; i < 50 && !globalThis.finishTitle; i++)
      await new Promise((r) => setTimeout(r, 50));
    globalThis.finishTitle();
  });
  await main
    .getByRole('heading', { name: '机器人控制与工业自动化岗位面试', exact: true })
    .waitFor();
  checks.push('failed automatic title visible and retry succeeds');
  const assets = await Promise.all(
    [
      'public/voxcue-source.png',
      'public/voxcue.png',
      'public/voxcue.ico',
      'C:/Users/fengk/Desktop/voxcue_logo.png',
    ].map((p) => readFile(p)),
  );
  assert.equal(
    createHash('sha256').update(assets[0]).digest('hex'),
    createHash('sha256').update(assets[3]).digest('hex'),
  );
  assert.equal(assets[1].readUInt32BE(16), 512);
  assert.equal(assets[2].readUInt16LE(4), 7);
  checks.push('provided artwork preserved; 512 PNG and seven-resolution ICO');
  assert((await readFile('dist/index.html', 'utf8')).includes('aria-label="正在启动 VoxCue"'));
  assert.deepEqual(errors, []);
  await writeFile(path.join(profile, 'report.json'), JSON.stringify({ checks, errors }, null, 2));
  console.log(JSON.stringify({ profile, checks }, null, 2));
} finally {
  await app.close();
}
