import { testRoot, electron } from './test-workspace.mjs';
import workspace from '../../scripts/workspace.mjs';
import { closeUiApp } from './install-ui-account.mjs';
import { installUiAccount } from './install-ui-account.mjs';
import { exerciseInterviewWindowDrag } from './interview-window-drag.mjs';

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
      if (!win.getTitle().includes('面试')) return;
      const pin = win.setAlwaysOnTop.bind(win);
      let depth = 0;
      win.setAlwaysOnTop = (...args) => {
        globalThis.pinMaxDepth = Math.max(globalThis.pinMaxDepth, ++depth);
        try {
          return pin(...args);
        } finally {
          depth--;
        }
      };
    });
  });
  const login = await app.firstWindow();
  const [main] = await Promise.all([
    app.waitForEvent('window'),
    login.getByRole('button', { name: '使用 ChatGPT 继续', exact: true }).click(),
  ]);
  main.setDefaultTimeout(15000);
  await main.getByRole('button', { name: '开始面试', exact: true }).click();
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1);
  await main
    .getByRole('dialog', { name: '开始面试', exact: true })
    .getByRole('button', { name: '取消', exact: true })
    .click();
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1);
  await main.getByRole('button', { name: '开始面试', exact: true }).click();
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
  await floating.getByRole('button', { name: '关闭截图保护' }).click();
  await floating.getByRole('button', { name: '开启截图保护', exact: true }).waitFor();
  assert.equal(
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((win) => win.webContents.getURL().endsWith('#interview'))
        .isContentProtected(),
    ),
    false,
  );
  await floating.screenshot({});
  const bounds = () =>
    app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((win) => win.webContents.getURL().endsWith('#interview'))
        .getBounds(),
    );
  const original = await bounds();
  await floating.evaluate(() => window.desktop.resizeInterview(-1));
  const smaller = await bounds();
  assert.ok(smaller.width < original.width && smaller.height < original.height);
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
  await floating.waitForFunction(() => document.querySelectorAll('.floating-panel').length === 1);
  assert.equal(await floating.locator('.floating-panel').count(), 1);
  await floating.getByRole('button', { name: '转写面板', exact: true }).click();
  await floating.waitForFunction(() => document.querySelectorAll('.floating-panel').length === 2);
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
  await floating.getByRole('button', { name: '确认结束面试', exact: true }).waitFor();
  assert.equal(
    await floating
      .getByRole('button', { name: '确认结束面试', exact: true })
      .evaluate((element) => element.classList.contains('button-destructive')),
    true,
  );
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 2);
  await floating.screenshot({});
  await floating.getByRole('button', { name: '结束面试', exact: true }).waitFor();
  // The OS close route must also request confirmation, without losing the session.
  await floating.evaluate(() => window.desktop.windowAction('close'));
  await floating.getByRole('button', { name: '确认结束面试', exact: true }).click();
  await main.getByRole('button', { name: '面试记录', exact: true }).click();
  await main.locator('.history-row').first().waitFor();
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1);
  await main.getByRole('button', { name: '新对话', exact: true }).click();
  await main.getByRole('button', { name: '开始面试', exact: true }).click();
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
