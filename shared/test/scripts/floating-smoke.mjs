import { connectUiAccount } from './install-ui-account.mjs';
import { testRoot, electron } from './test-workspace.mjs';
import workspace from '../../scripts/workspace.mjs';
import { closeUiApp } from './install-ui-account.mjs';
import { installUiAccount } from './install-ui-account.mjs';
import { exerciseInterviewWindowDrag } from './interview-window-drag.mjs';
import { evaluateHistory } from './stored-history-fixture.mjs';
import { captureRequested } from './capture-requested.mjs';

import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const { createServer } = workspace.platformRequire('vite');
const profile = path.resolve(path.join(testRoot, 'test/results'), `floating-profile-${Date.now()}`);
await mkdir(profile, { recursive: true });
const dev = process.argv.includes('--dev');
const server = dev
  ? await createServer({ server: { host: '127.0.0.1', port: 5174, strictPort: true } })
  : undefined;
await server?.listen();
const app = await electron.launch({
  args: ['.'],
  env: {
    ...process.env,
    COPILOT_TEST_USER_DATA: profile,
    VITE_DEV_SERVER_URL: dev ? 'http://127.0.0.1:5174' : '',
  },
});
try {
  await installUiAccount(app, { speech: true, components: true });
  await app.evaluate(({ app }) => {
    globalThis.pinMaxDepth = 0;
    app.on('browser-window-created', (_event, win) => {
      const pin = win.setAlwaysOnTop.bind(win);
      let depth = 0;
      win.setAlwaysOnTop = (...args) => {
        globalThis.pinMaxDepth = Math.max(globalThis.pinMaxDepth, ++depth);
        try {
          win.emit('always-on-top-changed', {}, false);
          return pin(...args);
        } finally {
          depth--;
        }
      };
    });
  });
  const login = await app.firstWindow();
  const main = await connectUiAccount(app, login);
  main.setDefaultTimeout(15000);
  // Keep the real interview gate, IPC, history writer and sync engine. Only the
  // cloud transport is replaced by an in-memory destination for synthetic records.
  await app.evaluate(({ app }) => {
    const load = process.getBuiltinModule('module').createRequire(app.getAppPath() + '/package.json');
    const { CloudSyncClient } = load('./dist-electron/shared/electron/backend/cloud/sync.js');
    const { createHash, randomUUID } = load('node:crypto');
    const items = new Map();
    const uploads = new Map();
    const records = globalThis.completedInterviewUploads = new Map();
    const ok = value => ({ ok: true, value });
    CloudSyncClient.prototype.call = async call => {
      switch (call.action) {
        case 'cancel': return ok({ cancelled: true });
        case 'list': {
          const counts = { profile: 0, knowledgebase: 0, history: 0 };
          for (const item of items.values()) counts.history += item.bytes;
          return ok({ items: [...items.values()], nextCursor: null, storage: {
            currentBytes: counts, reservedBytes: { ...counts, history: 0 }, storedBytes: counts,
            capacityBytes: 100_000_000, knowledgeCapacityBytes: 100_000_000,
          } });
        }
        case 'create':
          if (call.kind !== 'history' || !call.key.startsWith('record:')) throw Error('Expected an interview record');
          items.set(call.id, { id: call.id, name: call.key, kind: call.kind, bytes: 0, revision: 0, headVersion: null });
          return ok(items.get(call.id));
        case 'begin': {
          const id = randomUUID();
          uploads.set(id, { target: items.get(call.id), parts: [], expected: call.sha256 });
          return ok({ id, parts: [], chunkBytes: 1048576, partCount: Math.ceil(call.bytes / 1048576) });
        }
        case 'put':
          uploads.get(call.id).parts[call.index] = Buffer.from(call.bytes);
          return ok({ stored: true });
        case 'complete': {
          const upload = uploads.get(call.id);
          const bytes = Buffer.concat(upload.parts);
          const sha256 = createHash('sha256').update(bytes).digest('hex');
          if (upload.expected !== sha256) throw Error('Unexpected interview upload digest');
          const record = JSON.parse(bytes.subarray(8 + bytes.readUInt32BE(4)).toString());
          if (upload.target.name !== 'record:' + record.id) throw Error('Unexpected uploaded record identity');
          records.set(record.id, record);
          Object.assign(upload.target, { bytes: bytes.length, revision: upload.target.revision + 1, headVersion: randomUUID(), sha256 });
          uploads.delete(call.id);
          return ok({ bytes: bytes.length, revision: upload.target.revision, versionId: upload.target.headVersion, sha256 });
        }
        case 'versions': return ok({ items: [] });
        default: throw Error('Unexpected interview sync request: ' + call.action);
      }
    };
  });
  await main.getByRole('button', { name: '用户菜单', exact: true }).click();
  await main.getByRole('menuitem', { name: '设置', exact: true }).click();
  const accountSettings = main.getByRole('dialog', { name: '设置', exact: true });
  await accountSettings.getByRole('button', { name: 'VoxCue 账号', exact: true }).click();
  await accountSettings.getByRole('switch', { name: '同步面试记录', exact: true }).click();
  await accountSettings.getByRole('button', { name: '关闭设置', exact: true }).click();
  await main.locator('.interview-start-trigger').click();
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1);
  await main
    .getByRole('dialog', { name: '开始面试', exact: true })
    .getByRole('button', { name: '取消', exact: true })
    .click();
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1);
  await main.locator('.interview-start-trigger').click();
  await main.screenshot({});
  const [floating] = await Promise.all([
    app.waitForEvent('window'),
    main.getByRole('button', { name: '确认开始', exact: true }).click(),
  ]);
  floating.setDefaultTimeout(15000);
  assert.equal(
    await floating
      .getByRole('button', { name: '静音后自动提交完整问题', exact: true })
      .getAttribute('aria-pressed'),
    'true',
  );
  const errors = [];
  const nativeControlErrors = [];
  floating.on('pageerror', (error) => errors.push(error.message));
  await floating.getByRole('button', { name: '关闭截图保护' }).waitFor();
  assert.equal(
    await main.evaluate(async () => {
      try {
        await window.desktop.moveInterviewWindow({ phase: 'start' });
        return false;
      } catch {
        return true;
      }
    }),
    true,
    'The main window cannot move the interview window',
  );
  await exerciseInterviewWindowDrag(app, floating);

  assert.equal(
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((win) => win.webContents.getURL().endsWith('#interview'))
        .isContentProtected(),
    ),
    true,
  );
  await floating.emulateMedia({ reducedMotion: 'no-preference' });
  const captureWidths = await floating.evaluate(async () => {
    const button = document.querySelector('.floating-capture');
    const widths = [button.getBoundingClientRect().width];
    button.click();
    const start = performance.now();
    while (performance.now() - start < 320) {
      await new Promise(requestAnimationFrame);
      widths.push(button.getBoundingClientRect().width);
    }
    return widths;
  });
  assert.ok(captureWidths.at(-1) - captureWidths[0] > 60, 'Reveal confirmation must expand on the initiating button');
  assert.ok(captureWidths.some(width => width > captureWidths[0] + 2 && width < captureWidths.at(-1) - 2), 'Reveal confirmation must have real intermediate width frames');
  const confirmCapture = floating.getByRole('button', { name: '确认显示面试窗口', exact: true });
  await confirmCapture.waitFor();
  const confirmationInsets = (control) => control.evaluate(async (button) => {
    await Promise.all(button.getAnimations().map(animation => animation.finished));
    const bounds = button.getBoundingClientRect();
    const content = button.querySelector('.button-morph-expanded').getBoundingClientRect();
    return [content.left - bounds.left, bounds.right - content.right];
  });
  const captureInsets = await confirmationInsets(confirmCapture);
  assert.ok(Math.min(...captureInsets) >= 4, 'The confirmation must show the complete action and window name');
  await captureRequested(floating.locator('.floating-toolbar'), 'capture-confirmation');
  const protectedState = () => app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().find(win => win.webContents.getURL().endsWith('#interview')).isContentProtected());
  assert.equal(await protectedState(), true, 'First click must keep the window hidden');
  await confirmCapture.press('Escape');
  await floating.getByRole('button', { name: '关闭截图保护', exact: true }).waitFor();
  assert.equal(await protectedState(), true, 'Cancelling must keep capture protection on');
  await floating.getByRole('button', { name: '关闭截图保护' }).click();
  await confirmCapture.waitFor();
  await floating.locator('.floating-brand').focus();
  await floating.getByRole('button', { name: '关闭截图保护', exact: true }).waitFor();
  assert.equal(await protectedState(), true, 'Losing focus must cancel without revealing the window');
  await floating.getByRole('button', { name: '收起面试窗口', exact: true }).click();
  await floating.getByRole('button', { name: '展开面试窗口', exact: true }).waitFor();
  await floating.getByRole('button', { name: '关闭截图保护' }).click();
  await confirmCapture.waitFor();
  assert.ok(await confirmCapture.evaluate(button => {
    const bounds = button.getBoundingClientRect();
    return bounds.left >= 0 && bounds.right <= innerWidth;
  }), 'The expanded confirmation must fit the collapsed canvas');
  await confirmCapture.press('Escape');
  await floating.getByRole('button', { name: '展开面试窗口', exact: true }).click();
  await floating.getByRole('button', { name: '收起面试窗口', exact: true }).waitFor();
  await floating.getByRole('button', { name: '关闭截图保护' }).click();
  await confirmCapture.waitFor();
  await floating.getByRole('button', { name: '关闭截图保护', exact: true }).waitFor();
  assert.equal(await protectedState(), true, 'Confirmation timeout must leave the window hidden');
  await floating.getByRole('button', { name: '关闭截图保护' }).click();
  await confirmCapture.waitFor();
  await confirmCapture.click();
  await floating.getByRole('button', { name: '开启截图保护', exact: true }).waitFor();
  assert.equal(
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((win) => win.webContents.getURL().endsWith('#interview'))
        .isContentProtected(),
    ),
    false,
  );
  await floating.getByRole('button', { name: '开启截图保护', exact: true }).click();
  await floating.getByRole('button', { name: '关闭截图保护', exact: true }).waitFor();
  assert.equal(await protectedState(), true, 'Hiding again must take effect without a confirmation');
  await floating.getByRole('button', { name: '关闭截图保护', exact: true }).click();
  await confirmCapture.click();
  await floating.screenshot({});
  const nativeBounds = () =>
    app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((win) => win.webContents.getURL().endsWith('#interview'))
        .getBounds(),
    );
  const bounds = async () => {
    const native = await nativeBounds();
    const { layout } = await floating.evaluate(() => window.desktop.interviewState());
    return layout ? { ...native, width: layout.width, height: layout.height } : native;
  };
  const original = await bounds();
  const originalNative = await nativeBounds();
  await floating.evaluate(() => window.desktop.resizeInterview(-1));
  const smaller = await bounds();
  assert.ok(smaller.width < original.width && smaller.height < original.height);
  if (process.platform === 'win32') assert.deepEqual(await nativeBounds(), originalNative);
  await floating.evaluate(() => window.desktop.resizeInterview(1));
  assert.ok(Math.abs((await bounds()).width - original.width) <= 5);
  await floating.getByRole('button', { name: '收起面试窗口', exact: true }).click();
  await floating.getByRole('button', { name: '展开面试窗口', exact: true }).waitFor();
  assert.ok(Math.abs((await bounds()).height - 72) <= 5);
  assert.equal(await floating.locator('.floating-panels').isVisible(), false);
  await exerciseInterviewWindowDrag(app, floating);
  await floating.screenshot({});
  await floating.getByRole('button', { name: '展开面试窗口', exact: true }).click();
  assert.ok(Math.abs((await bounds()).height - original.height) <= 5);
  assert.equal(await floating.getByRole('button', { name: '转写模式', exact: true }).count(), 0);
  assert.equal(await floating.locator('.floating-panel > footer').count(), 0);
  assert.equal(
    await floating.getByRole('button', { name: /开始采集|暂停采集|继续采集|停止采集/ }).count(),
    0,
  );
  const interviewer = floating.locator('.transcript-item.interviewer').first();
  await interviewer
    .locator('.transcript-meta strong')
    .getByText('面试官', { exact: true })
    .waitFor();
  await interviewer.locator('.transcript-meta time').waitFor();
  assert.equal(await floating.getByText('面试官 · 系统音频', { exact: true }).count(), 0);
  await floating.locator('.answer-text').first().waitFor();
  assert.equal(
    await floating.locator('.floating-question').first().innerText(),
    'Synthetic interviewer question',
  );
  await floating.getByRole('button', { name: '转写面板', exact: true }).click();
  await floating.waitForFunction(
    () => document.querySelectorAll('.floating-panel:not([hidden])').length === 1,
  );
  assert.equal(await floating.locator('.floating-panel:visible').count(), 1);
  await floating.getByRole('button', { name: '转写面板', exact: true }).click();
  await floating.waitForFunction(
    () => document.querySelectorAll('.floating-panel:not([hidden])').length === 2,
  );
  const nativePinned = () =>
    app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((win) => win.webContents.getURL().endsWith('#interview'))
        .isAlwaysOnTop(),
    );
  assert.equal(await nativePinned(), true);
  assert.equal(
    await app.evaluate(() => globalThis.pinMaxDepth),
    1,
    'Native pin events must not recursively re-enter pinning',
  );
  assert.equal(await floating.getByRole('button', { name: /^(置顶|已置顶)$/ }).count(), 0);
  assert.equal(await floating.evaluate(() => window.desktop.togglePin()), true);
  await floating.evaluate(() => {
    localStorage.setItem('copilot-theme', 'dark');
    window.dispatchEvent(new Event('storage'));
  });
  await floating.screenshot({});
  await floating.getByRole('button', { name: '结束面试', exact: true }).click();
  const confirmEnd = floating.getByRole('button', { name: '确认结束面试', exact: true });
  await confirmEnd.waitFor();
  const endInsets = await confirmationInsets(confirmEnd);
  assert.ok(captureInsets.every((inset, side) => Math.abs(inset - endInsets[side]) < 0.1),
    `Both expanded confirmations must have matching insets (${captureInsets} and ${endInsets})`);
  assert.equal(
    await confirmEnd.evaluate((element) => element.classList.contains('button-destructive')),
    true,
  );
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 2);
  await floating.screenshot({});
  await floating.getByRole('button', { name: '结束面试', exact: true }).waitFor();
  // The native drag checks reload the floating renderer and can leave an earlier
  // interrupted draft. Identify the final session by a question sent after reload.
  const finalQuestion = '合成问题：结束后自动同步这场面试';
  await floating.getByRole('textbox', { name: '面试提问', exact: true }).fill(finalQuestion);
  await floating.getByRole('button', { name: '发送面试问题', exact: true }).click();
  const questionId = await floating.locator('.floating-question').filter({ hasText: finalQuestion }).getAttribute('data-question-id');
  assert.ok(questionId);
  const deferred = await main.evaluate(async () => {
    window.syncAvailableEvents = 0;
    window.desktop.onCloudSyncAvailable(() => window.syncAvailableEvents++);
    // Wake the regular scheduler while the interview gate is closed.
    window.dispatchEvent(new Event('online'));
    const { state } = await window.desktop.cloudAccount({ action: 'status' });
    return window.desktop.cloudSync({ action: 'list', userId: state.user.id, cursor: '' });
  });
  assert.equal(deferred.deferred, 'interview');
  assert.equal(await app.evaluate(() => globalThis.completedInterviewUploads.size), 0);
  // The OS close route must also request confirmation, without losing the session.
  await floating.evaluate(() => window.desktop.windowAction('close'));
  await floating.getByRole('button', { name: '确认结束面试', exact: true }).click();
  await main.getByRole('button', { name: '面试记录', exact: true }).click();
  await main.locator('.history-row').first().waitFor();
  // This deadline is shorter than both the old retry cooldown and the periodic poll.
  await main.waitForFunction(() => window.syncAvailableEvents > 0, null, { timeout: 5000 });
  const ended = await evaluateHistory(main, async id => (await fixtureHistory.read())
    .find(record => record.status === 'ended' && record.answers.some(answer => answer.id === id)), questionId);
  assert.ok(ended?.endedAt > 0, 'Expected the archived session containing the final question');
  const row = main.locator('.history-row')
    .filter({ has: main.getByText('已结束', { exact: true }) })
    .filter({ has: main.getByRole('button', { name: '查看面试记录：' + ended.title, exact: true }) });
  await row.getByRole('button', { name: /：已同步$/ }).waitFor({ timeout: 5000 });
  const uploaded = await app.evaluate((_electron, id) => globalThis.completedInterviewUploads.get(id), ended.id);
  assert.equal(uploaded?.status, 'ended');
  assert.equal(uploaded.endedAt, ended.endedAt);
  assert.ok(uploaded.answers.some(answer => answer.id === questionId && answer.question === finalQuestion));
  assert.deepEqual(uploaded.transcripts, ended.transcripts);
  console.log('PASS: active interview deferred; ended interview uploaded with its final question and transcript after the native close event.');
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1);
  await main.getByRole('button', { name: '新对话', exact: true }).click();
  await main.locator('.interview-start-trigger').click();
  const [reopened] = await Promise.all([
    app.waitForEvent('window'),
    main.getByRole('button', { name: '确认开始', exact: true }).click(),
  ]);
  await reopened.getByRole('button', { name: '关闭截图保护' }).waitFor();
  assert.equal(
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((win) => win.webContents.getURL().endsWith('#interview'))
        .isContentProtected(),
    ),
    true,
  );
  await reopened.getByRole('button', { name: '结束面试', exact: true }).click();
  await Promise.all([
    reopened.waitForEvent('close'),
    reopened.getByRole('button', { name: '确认结束面试', exact: true }).click(),
  ]);
  assert.deepEqual(errors, []);
  assert.deepEqual(nativeControlErrors, [], '原生窗口回归失败，不能标记全部通过');
  console.log(
    'PASS: grip pointer capture to real native window movement (synthetic cursor), expanded/collapsed dragging, cancellation/blur/reload cleanup, blank-canvas passthrough, caller/argument rejection, start configuration, floating controls, end confirmation, reopen and history persistence.',
  );
} finally {
  // End flows above are asserted through the UI. Destroy remaining test-only
  // windows during teardown so native close confirmation cannot stall the runner.
  await app.evaluate(({ BrowserWindow }) => {
    for (const window of BrowserWindow.getAllWindows()) window.destroy();
  });
  await closeUiApp(app);
  await server?.close();
}
