import { testRoot, electron } from './test-workspace.mjs';
import { offlineElectronEntry } from './offline-electron-entry.mjs';

import { mkdir, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { installUiAccount, closeUiApp } from './install-ui-account.mjs';

await mkdir(path.join(testRoot, 'test/results'), { recursive: true });
const profile = await mkdtemp(path.resolve(path.join(testRoot, 'test/results/chat-progress-')));
const env = { ...process.env, COPILOT_TEST_USER_DATA: profile, VITE_DEV_SERVER_URL: '' };
delete env.ELECTRON_RUN_AS_NODE;
const executable = process.argv
  .find((arg) => arg.startsWith('--app-executable='))
  ?.slice('--app-executable='.length);
const packaged = !!executable;
const screenshotDirectory = process.argv
  .find((arg) => arg.startsWith('--screenshots='))
  ?.slice('--screenshots='.length);
if (screenshotDirectory) await mkdir(path.resolve(screenshotDirectory), { recursive: true });
const app = await electron.launch({
  ...(packaged ? { executablePath: path.resolve(executable) } : {}),
  args: packaged ? [] : [await offlineElectronEntry()],
  env,
});
const errors = [];
try {
  await app.evaluate(({ app }) => {
    const require = process
      .getBuiltinModule('module')
      .createRequire(app.getAppPath() + '/package.json');
    globalThis.actualChatStream = require(
      app.getAppPath() + '/dist-electron/shared/electron/backend/chat/service.js',
    ).ChatGPTService.prototype.stream;
  });
  await installUiAccount(app);
  await app.evaluate(({ app }) => {
    const require = process
      .getBuiltinModule('module')
      .createRequire(app.getAppPath() + '/package.json');
    const { ChatGPTService } = require(
      app.getAppPath() + '/dist-electron/shared/electron/backend/chat/service.js',
    );
    const { UsageLedger } = require(
      app.getAppPath() + '/dist-electron/shared/electron/backend/chat/usage.js',
    );
    const { profileFields } = require(
      app.getAppPath() + '/dist-electron/shared/electron/contracts/profile.js',
    );
    globalThis.progressRequests = [];
    const attempts = new Map();
    const native = new ChatGPTService({
      access: async () => ({ account: 'synthetic', token: 'synthetic-only' }),
      ledger: new UsageLedger(require('node:path').join(app.getPath('userData'), 'fixture-usage')),
      fetch: async (_url, init) => {
        const body = JSON.parse(init.body);
        const prompt = body.input.at(-1).content;
        attempts.set(prompt, (attempts.get(prompt) ?? 0) + 1);
        globalThis.progressRequests.push({
          prompt,
          input: body.input,
          instructions: body.instructions,
        });
        const changes = Object.fromEntries(profileFields.map((field) => [field, null]));
        if (prompt === '更新简历') changes.background = '已核对的合成简历摘要';
        if (prompt === '更新 JD') changes.jobDescription = 'TypeScript、接口边界与桌面应用。';
        if (body.instructions.includes('本次任务：按技能规则生成技能更新提案。')) {
          globalThis.skillResponseCount = (globalThis.skillResponseCount ?? 0) + 1;
          const retrieved = Array.from({ length: 7 }, (_, index) => ({
            title: `真实资料${index + 1}`,
            url: `https://example.com/docs/${index}/?utm_source=search`,
          }));
          changes.skills = Array.from({ length: 3 }, (_, index) => ({
            id: `skill-${index}`,
            title: `核心技能${index + 1}`,
            content: `精简技术重点与岗位关系，保留事实边界。版本${globalThis.skillResponseCount}。`,
            sources: [
              {
                title: '模型标题',
                url: (
                  globalThis.failSkillReference === 'partial'
                    ? index === 0
                    : globalThis.failSkillReference
                )
                  ? 'https://example.com/unretrieved'
                  : `https://example.com/docs/${index}/#section`,
              },
            ],
          }));
          const response = {
            id: `skills-${globalThis.skillResponseCount}`,
            object: 'response',
            status: 'completed',
            output: [
              {
                id: 'skills-message',
                type: 'message',
                content: [
                  {
                    type: 'output_text',
                    text: JSON.stringify({
                      answer: '已整理3项核心技能，请确认下方提案。',
                      changes,
                    }),
                  },
                ],
              },
            ],
          };
          return new Response(
            [
              {
                type: 'response.output_item.done',
                output_index: 0,
                item: {
                  id: 'skills-search',
                  type: 'web_search_call',
                  status: 'completed',
                  action: { type: 'search', sources: retrieved },
                },
              },
              {
                type: 'response.output_text.delta',
                output_index: 1,
                delta: response.output[0].content[0].text,
              },
              { type: 'response.completed', response },
            ]
              .map((event) => 'data: ' + JSON.stringify(event) + '\n\n')
              .join(''),
            { headers: { 'content-type': 'text/event-stream' } },
          );
        }
        const answer =
          prompt === '进度测试'
            ? '进度最终回答'
            : prompt === '失败后重试'
              ? '重试完成'
              : '普通问题已回答';
        const text = JSON.stringify({ answer, changes });
        const terminal = {
          id: 'synthetic-' + globalThis.progressRequests.length,
          object: 'response',
          status: 'completed',
          output: [
            {
              id: 'final',
              type: 'message',
              phase: 'final_answer',
              content: [{ type: 'output_text', text }],
            },
          ],
          usage: { input_tokens: 1, output_tokens: 2, total_tokens: 3 },
        };
        if (!['进度测试', '失败后重试', '停止测试'].includes(prompt) || attempts.get(prompt) > 1)
          return Response.json(terminal);
        const encoder = new TextEncoder();
        const encode = (event) => encoder.encode('data: ' + JSON.stringify(event) + '\n\n');
        return new Response(
          new ReadableStream({
            start(controller) {
              globalThis.progressController = controller;
              globalThis.finishProgress = () => {
                terminal.output.unshift({
                  id: 'reason',
                  type: 'reasoning',
                  summary: [{ type: 'summary_text', text: '**梳理问题**\n\n已收到的公开摘要。' }],
                  encrypted_content: 'PRIVATE',
                });
                terminal.output.splice(1, 0, {
                  id: 'review',
                  type: 'reasoning',
                  summary: [{ type: 'summary_text', text: '**核对资料**\n\n整理公开来源。' }],
                });
                controller.enqueue(
                  encode({
                    type: 'response.output_item.added',
                    output_index: 4,
                    item: { ...terminal.output.at(-1), content: [] },
                  }),
                );
                controller.enqueue(
                  encode({ type: 'response.output_text.delta', output_index: 4, delta: text }),
                );
                controller.enqueue(encode({ type: 'response.completed', response: terminal }));
                controller.close();
              };
              const publicEvents = [
                { type: 'response.created' },
                { type: 'response.in_progress' },
                {
                  type: 'response.output_item.added',
                  output_index: 0,
                  item: { id: 'comment', type: 'message', phase: 'commentary', content: [] },
                },
                {
                  type: 'response.output_text.delta',
                  output_index: 0,
                  delta: '先核对两个官方来源。',
                },
                {
                  type: 'response.output_item.done',
                  output_index: 0,
                  item: {
                    id: 'comment',
                    type: 'message',
                    phase: 'commentary',
                    content: [{ type: 'output_text', text: '先核对两个官方来源。' }],
                  },
                },
                {
                  type: 'response.reasoning_summary_text.delta',
                  item_id: 'reason',
                  summary_index: 0,
                  delta: '**梳理问题**\n\n已收到的公开摘要。',
                },
                { type: 'response.reasoning_text.delta', delta: 'PRIVATE' },
                {
                  type: 'response.output_item.done',
                  output_index: 1,
                  item: {
                    id: 'search',
                    type: 'web_search_call',
                    status: 'completed',
                    action: { type: 'search', queries: ['official first', 'official second'] },
                  },
                },
                {
                  type: 'response.output_item.done',
                  output_index: 2,
                  item: {
                    id: 'read',
                    type: 'web_search_call',
                    status: 'completed',
                    action: {
                      type: 'open_page',
                      url: 'https://example.com/docs?secret=hidden#part',
                    },
                  },
                },
                {
                  type: 'response.output_item.done',
                  output_index: 3,
                  item: {
                    id: 'find',
                    type: 'web_search_call',
                    status: 'completed',
                    action: { type: 'find_in_page', url: 'https://example.com/docs' },
                  },
                },
                {
                  type: 'response.reasoning_summary_text.delta',
                  item_id: 'review',
                  summary_index: 0,
                  delta: '**核对资料**\n\n整理公开来源。',
                },
              ];
              for (const event of publicEvents) controller.enqueue(encode(event));
            },
          }),
          { headers: { 'content-type': 'text/event-stream' } },
        );
      },
    });
    ChatGPTService.prototype.stream = function (request, emit, signal) {
      return globalThis.actualChatStream.call(native, request, emit, signal);
    };
  });
  const login = await app.firstWindow();
  const [page] = await Promise.all([
    app.waitForEvent('window'),
    login.getByRole('button', { name: '使用 ChatGPT 继续', exact: true }).click(),
  ]);
  page.setDefaultTimeout(30000);
  page.on('pageerror', (error) => errors.push(error.message));
  const input = () => page.getByRole('textbox', { name: '聊天消息', exact: true });
  const latest = () => page.locator('.chat-message.assistant').last();
  const send = async (text) => {
    await input().fill(text);
    await page.getByRole('button', { name: '发送消息', exact: true }).click();
  };
  const completed = () => page.getByRole('button', { name: '发送消息', exact: true }).waitFor();
  const capture = async (name, target = page) => {
    if (screenshotDirectory)
      await target.screenshot({
        path: path.join(path.resolve(screenshotDirectory), name + '.png'),
        animations: 'disabled',
      });
  };
  await input().waitFor();
  await page.waitForFunction(() => !document.querySelector('[aria-label="聊天消息"]').disabled);
  const measureInput = () =>
    input().evaluate((element) => ({
      height: element.getBoundingClientRect().height,
      width: element.clientWidth,
      line: parseFloat(getComputedStyle(element).lineHeight),
      scroll: element.scrollHeight,
      overflow: getComputedStyle(element).overflowY,
    }));
  const lineCount = async (expected) => {
    await page.waitForFunction((expected) => {
      const node = document.querySelector('[aria-label="聊天消息"]');
      return (
        Math.abs(
          node.getBoundingClientRect().height -
            parseFloat(getComputedStyle(node).lineHeight) * expected,
        ) < 1
      );
    }, expected);
  };
  await lineCount(2);
  await input().fill('第一行\n第二行\n第三行\n第四行');
  await lineCount(4);
  const longDraft = Array.from({ length: 20 }, (_, index) => `第${index + 1}行`).join('\n');
  await input().fill(longDraft);
  await lineCount(11);
  const capped = await measureInput();
  assert.ok(capped.scroll > capped.height && capped.overflow === 'auto');
  const composerBounds = await page.locator('.composer').evaluate((node) => {
    const bounds = node.getBoundingClientRect();
    return { top: bounds.top, bottom: bounds.bottom, viewportHeight: innerHeight };
  });
  assert.ok(composerBounds.top > 0 && composerBounds.bottom < composerBounds.viewportHeight);
  await page.locator('.composer').screenshot({});
  await input().fill('');
  await lineCount(2);
  await input().fill('项目描述与候选人经历。'.repeat(30));
  await page.waitForFunction(
    () => document.querySelector('[aria-label="聊天消息"]').clientHeight > 40,
  );
  const beforeNarrow = await measureInput();
  const mainWindow = await app.browserWindow(page);
  await mainWindow.evaluate((window) => window.setSize(960, 800));
  await page.waitForFunction(
    (width) => document.querySelector('[aria-label="聊天消息"]').clientWidth < width,
    beforeNarrow.width,
  );
  await page.waitForFunction(
    (height) =>
      document.querySelector('[aria-label="聊天消息"]').getBoundingClientRect().height > height,
    beforeNarrow.height,
  );
  const narrow = await measureInput();
  assert.ok(narrow.height > beforeNarrow.height && narrow.height <= narrow.line * 11 + 1);
  await mainWindow.evaluate((window) => window.setSize(1280, 800));
  await input().fill('');
  await lineCount(2);
  await send('更新简历');
  const proposal = latest().getByRole('region', { name: '待确认的资料更新', exact: true });
  await proposal.getByRole('button', { name: '保存所选', exact: true }).click();
  await page
    .locator('.skill-update-prompt')
    .getByText('资料已保存，补齐摘要后可联网更新面试技能。', { exact: true })
    .waitFor();
  await capture('prompt-before', page.locator('.skill-update-prompt'));
  await page
    .locator('.skill-update-prompt')
    .getByRole('button', { name: '补充职位描述', exact: true })
    .click();
  await page.locator('.skill-update-prompt').waitFor({ state: 'hidden' });
  assert.ok((await input().inputValue()).includes('仅补充缺少的摘要并展示待确认提案'));
  assert.ok((await input().inputValue()).includes('以下是职位描述内容：'));
  assert.ok((await input().inputValue()).includes('也不生成技能'));
  assert.equal((await input().inputValue()).includes('联网更新面试技能'), false);
  await capture('prompt-after');
  await page.reload();
  await input().waitFor();
  assert.equal(await page.locator('.skill-update-prompt').count(), 0);
  assert.ok((await input().inputValue()).includes('以下是职位描述内容：'));
  await send('普通问题');
  await completed();
  const next = await app.evaluate(() => globalThis.progressRequests.at(-1));
  assert.ok(
    next.input.some((turn) => turn.role === 'assistant' && turn.content.includes('已成功保存')),
  );
  assert.equal(next.instructions.includes('公开推理摘要和进度说明优先使用简体中文'), false);
  const requests = await app.evaluate(() => globalThis.progressRequests.length);
  await send('确认');
  await latest().getByText('普通问题已回答', { exact: true }).waitFor();
  assert.equal(await app.evaluate(() => globalThis.progressRequests.length), requests + 1);
  assert.equal(await page.locator('.skill-update-prompt').count(), 0);
  await send('继续提问');
  await completed();
  await send('更新 JD');
  const jdProposal = latest().getByRole('region', { name: '待确认的资料更新', exact: true });
  await jdProposal.getByRole('button', { name: '保存所选', exact: true }).click();
  await page
    .locator('.skill-update-prompt')
    .getByRole('button', { name: '联网更新技能', exact: true })
    .click();
  const skillsProposal = latest().getByRole('region', { name: '待确认的资料更新', exact: true });
  await skillsProposal.getByRole('button', { name: '保存所选', exact: true }).waitFor();
  assert.equal(await skillsProposal.locator('.proposal-skill-row').count(), 3);
  assert.equal(
    await latest().locator('.chat-answer').innerText(),
    '已整理3项核心技能，请确认下方提案。',
  );
  assert.equal(await latest().locator('.chat-source-group').count(), 0);
  assert.equal(await skillsProposal.locator('a').count(), 0);
  const skillRequest = await app.evaluate(() => globalThis.progressRequests.at(-1));
  assert.ok(skillRequest.prompt.includes('根据已确认的简历和职位描述联网搜索'));
  assert.ok(skillRequest.instructions.includes('不凑数量，不设固定字数'));
  assert.ok(skillRequest.instructions.includes('标题和正文只写文字'));
  assert.ok(skillRequest.instructions.includes('完整内容只放在 changes'));
  await latest().screenshot({});
  await skillsProposal.getByRole('button', { name: '保存所选', exact: true }).click();
  const confirmedInfo = await page.evaluate(() => localStorage.getItem('copilot-personal-info-v1'));
  assert.equal(JSON.parse(confirmedInfo).skills.length, 3);
  assert.equal(
    JSON.parse(confirmedInfo).skills[0].sources[0].url,
    'https://example.com/docs/0/?utm_source=search',
  );
  await app.evaluate(() => {
    globalThis.failSkillReference = true;
  });
  await send('请联网更新面试技能');
  const review = latest().getByRole('region', { name: '待确认的资料更新', exact: true });
  await review.getByRole('button', { name: '保存所选', exact: true }).waitFor();
  const skillSeparation = await latest()
    .locator('.proposal-skill-row')
    .evaluateAll((nodes) =>
      nodes.map((node) => {
        const style = getComputedStyle(node);
        return {
          padding: parseFloat(style.paddingTop),
          border: parseFloat(style.borderTopWidth),
        };
      }),
    );
  assert.equal(skillSeparation.length, 3);
  assert.ok(skillSeparation.slice(1).every((item) => item.padding > 0 && item.border > 0));
  assert.equal(await review.locator('.proposal-skill-row .proposal-warning').count(), 3);
  await review
    .getByRole('button', {
      name:
        '查看技能：' +
        (await review.locator('.proposal-skill-row .profile-field-choice').first().innerText()),
      exact: true,
    })
    .click();
  const sourceReader = page.getByRole('dialog');
  assert.equal(await sourceReader.getByRole('note').count(), 1);
  assert.equal(
    await sourceReader.locator('.skill-source-issue code').innerText(),
    'https://example.com/unretrieved',
  );
  await sourceReader.getByRole('button', { name: '关闭对话框', exact: true }).click();
  assert.equal(
    await review.getByRole('button', { name: '保存所选', exact: true }).isEnabled(),
    true,
  );
  assert.equal((await latest().innerText()).includes('生成已中断'), false);
  assert.equal(
    await page.evaluate(() => localStorage.getItem('copilot-personal-info-v1')),
    confirmedInfo,
  );
  await capture('source-review-light', review);
  await page.evaluate(() => document.documentElement.classList.add('dark'));
  await capture('source-review-dark', review);
  await page.evaluate(() => document.documentElement.classList.remove('dark'));
  await review.getByRole('button', { name: '保存所选', exact: true }).click();
  const unverifiedSaved = JSON.parse(
    await page.evaluate(() => localStorage.getItem('copilot-personal-info-v1')),
  );
  assert.equal(unverifiedSaved.skills.length, 3);
  assert.ok(
    unverifiedSaved.skills.every(
      (skill) => skill.content.includes('版本2') && skill.sources.length === 0,
    ),
  );
  assert.equal(await review.locator('.proposal-skill-row .proposal-warning').count(), 3);
  await page.reload();
  await latest().getByText('已保存所选资料', { exact: true }).waitFor();
  assert.equal(await latest().locator('.proposal-skill-row .proposal-warning').count(), 3);
  await app.evaluate(() => {
    globalThis.failSkillReference = 'partial';
  });
  await send('请联网更新面试技能');
  await review.getByRole('button', { name: '保存所选', exact: true }).waitFor();
  assert.equal(await review.locator('.proposal-skill-row .proposal-warning').count(), 1);
  await review.getByRole('button', { name: '保存所选', exact: true }).click();
  await review.getByText('已保存所选资料', { exact: true }).waitFor();
  const mixedSaved = JSON.parse(
    await page.evaluate(() => localStorage.getItem('copilot-personal-info-v1')),
  );
  assert.deepEqual(
    mixedSaved.skills.map((skill) => skill.sources.length),
    [0, 1, 1],
  );
  await app.evaluate(() => {
    globalThis.failSkillReference = false;
  });
  await page.evaluate(() => {
    window.restoreProgressClock = Date.now;
    window.progressEpoch = Date.now();
    Date.now = () => window.progressEpoch;
  });
  await send('进度测试');
  await latest().locator('.response-progress').waitFor();
  await latest()
    .getByText(/^正在思考 /)
    .waitFor();
  const firstTitle = latest().locator('.reasoning-section summary').filter({ hasText: '梳理问题' });
  const currentTitle = latest()
    .locator('.reasoning-section summary')
    .filter({ hasText: '核对资料' });
  await currentTitle.waitFor();
  assert.equal(await firstTitle.locator('..').getAttribute('open'), null);
  assert.equal(await currentTitle.locator('.reasoning-heading.is-active').count(), 1);
  assert.equal(
    await currentTitle
      .locator('.reasoning-heading')
      .evaluate((node) => getComputedStyle(node).animationName),
    'reasoning-title-shine',
  );
  assert.equal(await latest().locator('.progress-state-label.is-active').count(), 1);
  assert.equal(
    await latest()
      .locator('.progress-state-label.is-active')
      .evaluate((node) => getComputedStyle(node).animationName),
    'reasoning-title-shine',
  );
  const layout = await latest()
    .locator('.response-progress')
    .evaluate((root) => ({
      first: root.firstElementChild.className,
      border: getComputedStyle(root).borderBottomWidth,
      durationBorder: getComputedStyle(root.firstElementChild).borderBottomWidth,
      rows: [...root.querySelectorAll('.response-steps > li')].map((node) => ({
        kind: node.dataset.kind,
        phase: node.dataset.phase,
        text: node.textContent,
      })),
      durationInSummary: !!root.querySelector('summary .response-duration'),
    }));
  assert.equal(layout.first, 'response-duration');
  assert.ok(parseFloat(layout.border) > 0 && parseFloat(layout.border) <= 1);
  assert.equal(layout.durationInSummary, false);
  assert.equal(parseFloat(layout.durationBorder), 0);
  const firstIndex = layout.rows.findIndex((row) => row.text.includes('梳理问题'));
  const searchIndex = layout.rows.findIndex((row) => row.kind === 'web_search');
  const nextTitleIndex = layout.rows.findIndex((row) => row.text.includes('核对资料'));
  assert.ok(firstIndex >= 0 && firstIndex < searchIndex && searchIndex < nextTitleIndex);
  assert.equal(
    layout.rows.some(
      (row) => row.kind === 'status' && ['waiting', 'processing'].includes(row.phase),
    ),
    false,
  );
  await page.mouse.move(0, 0);
  assert.equal(
    await currentTitle
      .locator('.reasoning-chevron')
      .evaluate((node) => getComputedStyle(node).opacity),
    '0',
  );
  if (process.platform === 'darwin')
    await app.evaluate(({ app, BrowserWindow }) => {
      app.focus({ steal: true });
      BrowserWindow.getAllWindows()
        .find((window) => window.isVisible())
        ?.focus();
    });
  await currentTitle.hover();
  await page.waitForFunction(
    () =>
      getComputedStyle(document.querySelector('.reasoning-heading.is-active + .reasoning-chevron'))
        .opacity === '1',
  );
  await currentTitle.click();
  assert.equal(await currentTitle.locator('..').getAttribute('open'), '');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(
    await currentTitle
      .locator('.reasoning-heading')
      .evaluate((node) => getComputedStyle(node).animationName),
    'none',
  );
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await latest().locator('.response-progress').screenshot({ animations: 'allow' });
  await page.evaluate(() => {
    Date.now = () => window.progressEpoch + 333000;
  });
  await app.evaluate(() => globalThis.finishProgress());
  await latest().getByText('用时 5 分钟 33 秒', { exact: true }).waitFor();
  assert.equal(await latest().locator('.duration-toggle').getAttribute('aria-expanded'), 'false');
  assert.equal(await latest().locator('.response-progress-content').isVisible(), false);
  await latest().locator('.duration-toggle').click();
  await page.evaluate(() => {
    Date.now = window.restoreProgressClock;
  });
  assert.equal(await latest().locator('.reasoning-heading.is-active').count(), 0);
  assert.equal(await latest().locator('.progress-state-label.is-active').count(), 0);
  await firstTitle.click();
  assert.equal(
    await latest()
      .locator(
        '.response-steps li[data-kind="commentary"], .response-steps li[data-kind="web_search"], .response-steps li[data-kind="open_page"], .response-steps li[data-kind="find_in_page"]',
      )
      .count(),
    4,
  );
  await latest().getByText('official first · official second', { exact: true }).waitFor();
  await latest().getByText('先核对两个官方来源。', { exact: true }).waitFor();
  assert.equal(await latest().locator('.chat-answer').innerText(), '进度最终回答');
  assert.equal((await latest().innerText()).includes('PRIVATE'), false);
  assert.equal((await latest().innerText()).includes('secret'), false);
  assert.equal((await latest().innerText()).includes('推理摘要'), false);
  assert.equal(await latest().locator('.progress-link').first().getAttribute('title'), null);
  for (const theme of ['light', 'dark']) {
    await page.evaluate(
      (theme) => document.documentElement.classList.toggle('dark', theme === 'dark'),
      theme,
    );
    await latest().locator('.response-progress').screenshot({ animations: 'disabled' });
  }
  await page.evaluate(() => {
    window.progressEpoch = Date.now();
    Date.now = () => window.progressEpoch;
  });
  await send('失败后重试');
  await latest().locator('.response-progress').waitFor();
  await page.evaluate(() => {
    Date.now = () => window.progressEpoch + 66000;
  });
  await app.evaluate(() =>
    globalThis.progressController.error(Error('synthetic interrupted transport')),
  );
  await latest().getByText('已处理 1 分钟 6 秒', { exact: true }).waitFor();
  await page.evaluate(() => {
    Date.now = window.restoreProgressClock;
  });
  await latest().getByRole('button', { name: '重试回答', exact: true }).click();
  await latest().getByText('重试完成', { exact: true }).waitFor();
  assert.equal(
    (await latest().locator('.response-duration').innerText()).includes('1 分钟 6 秒'),
    false,
  );
  await send('停止测试');
  await latest().locator('.response-progress').waitFor();
  await page.getByRole('button', { name: '停止回复', exact: true }).click();
  await latest().getByText('已停止回复。', { exact: true }).waitFor();
  assert.ok((await latest().locator('.response-duration').innerText()).startsWith('已处理'));
  await input().fill(longDraft);
  await lineCount(11);
  await page.reload();
  await input().waitFor();
  await page.waitForFunction(() =>
    document.querySelector('[aria-label="聊天消息"]').value.includes('第20行'),
  );
  await lineCount(11);
  const stored = page.locator('.chat-message.assistant').filter({ hasText: '进度最终回答' });
  await stored.getByText('用时 5 分钟 33 秒', { exact: true }).waitFor();
  assert.equal(await stored.locator('.response-progress-content').isVisible(), false);
  await stored.locator('.duration-toggle').click();
  await stored.locator('.reasoning-section summary').filter({ hasText: '梳理问题' }).click();
  await stored.getByText('已收到的公开摘要。', { exact: true }).waitFor();
  assert.equal(await stored.locator('.reasoning-section').count(), 2);
  assert.equal(await stored.locator('.response-steps li[data-kind="web_search"]').count(), 1);
  assert.deepEqual(errors, []);
  await console.log(
    JSON.stringify(
      {
        passed: true,
        checks: [
          'button consent without JD does not gate chat',
          'plain consent after dismissing the prompt does not revive it',
          'JD draft is not skills research',
          'saved resolution enters history',
          'real Responses SSE public commentary/search/read/find',
          'live and completed duration',
          'failure/stop/retry duration',
          'duration and activities survive reload',
          'time above separator, real title disclosures and chronological status changes',
          'trailing chevron only on hover/focus, active title shimmer and reduced motion',
          'composer grows from 2 to 11 lines, shrinks, reflows and restores drafts',
          'source problems identify skills and URLs in detail dialogs without blocking complete proposals; button save, mixed/all-unverified sources and reload persistence',
          'both skill prompt actions dismiss immediately and remain dismissed on reload',
          'empty statuses replaced, current status shimmer and no summary language preference',
        ],
        rendererErrors: errors.length,
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ passed: true, profile }));
} catch (error) {
  console.error(error);
  const page = app.windows().find((window) => window.url().includes('index.html'));
  if (page) {
    await page.screenshot({}).catch(() => {});
    console.log(
      await page
        .evaluate(() => {
          const input = document.querySelector('[aria-label="聊天消息"]');
          return {
            viewport: [innerWidth, innerHeight],
            input: input && {
              width: input.clientWidth,
              height: input.clientHeight,
              scroll: input.scrollHeight,
            },
          };
        })
        .catch(() => ({})),
    );
  }
  throw error;
} finally {
  await closeUiApp(app);
}
