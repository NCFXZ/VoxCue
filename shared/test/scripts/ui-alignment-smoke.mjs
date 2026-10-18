import { testRoot, electron } from './test-workspace.mjs';
import { closeUiApp } from './install-ui-account.mjs';
import { installUiAccount } from './install-ui-account.mjs';

import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

// Isolated visual fixture: no real account, audio or model inference requests.
const directory = path.resolve(path.join(testRoot, 'test/results'), `ui-alignment-${Date.now()}`);
await mkdir(directory, { recursive: true });
const app = await electron.launch({
  args: ['.'],
  env: {
    ...process.env,
    COPILOT_TEST_USER_DATA: path.join(directory, 'profile'),
    VITE_DEV_SERVER_URL: '',
  },
});
const checks = [];
const longName = 'A very long model name used to verify compact controls and constrained menus';
const check = (name, passed, detail) => checks.push({ name, passed, detail });
const settle = (page) =>
  page.waitForFunction(() =>
    document
      .getAnimations()
      .every(
        (animation) =>
          animation.effect?.getTiming().iterations === Infinity ||
          animation.playState !== 'running',
      ),
  );
try {
  await installUiAccount(app, { speech: true, components: true });
  const login = await app.firstWindow();
  const [page] = await Promise.all([
    app.waitForEvent('window'),
    login.getByRole('button', { name: '使用 ChatGPT 继续', exact: true }).click(),
  ]);
  page.setDefaultTimeout(20000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('auth:session');
    ipcMain.handle('auth:session', () => ({
      mode: 'chatgpt',
      user: { id: 'visual', name: 'Visual test', email: '' },
      expiresAt: Date.now() + 3600000,
    }));
    ipcMain.removeHandler('chat:models');
    ipcMain.handle('chat:models', () => ({
      ok: true,
      models: [
        { id: 'short', label: 'GPT test', reasoningEfforts: ['low', 'high'] },
        {
          id: 'long',
          label: 'A very long model name used to verify compact controls and constrained menus',
          reasoningEfforts: ['low', 'high'],
        },
      ],
    }));
    ipcMain.removeHandler('chat:usage');
    ipcMain.handle('chat:usage', () => ({ ok: false, error: { message: 'Visual fixture' } }));
  });
  await page.reload();
  await page
    .getByRole('button', { name: '聊天模型', exact: true })
    .getByText('GPT test', { exact: true })
    .waitFor();
  await page.getByRole('button', { name: '聊天模型', exact: true }).click();
  await page.getByRole('menuitemradio', { name: longName, exact: true }).click();
  const composerGeometry = () =>
    page.locator('.composer').evaluate((element) => {
      const box = element.getBoundingClientRect();
      const rects = [...element.querySelectorAll('.composer-bottom button')].map((button) => {
        const r = button.getBoundingClientRect();
        return {
          label: button.getAttribute('aria-label') ?? button.textContent,
          left: r.left,
          right: r.right,
          y: r.top + r.height / 2,
          height: r.height,
        };
      });
      return {
        overflow: element.scrollWidth > element.clientWidth + 1,
        contained: rects.every((r) => r.left >= box.left && r.right <= box.right),
        rects,
      };
    });
  for (const [width, height] of [
    [1280, 800],
    [960, 680],
  ]) {
    await app.evaluate(
      ({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setSize(...size),
      [width, height],
    );
    await page.getByRole('button', { name: '个人信息', exact: true }).click();
    await page.locator('.personal-panel').waitFor();
    await settle(page);
    const result = await composerGeometry();
    check(`composer-${width}`, !result.overflow && result.contained, result);
    check(
      `composer-actions-align-${width}`,
      Math.abs(result.rects.at(-1).y - result.rects.at(-3).y) < 1,
      result,
    );
    await page.screenshot({ animations: 'disabled' });
    await page.getByRole('button', { name: '关闭个人信息', exact: true }).click();
    await settle(page);
  }
  await page.getByRole('button', { name: '用户菜单', exact: true }).click();
  await page.getByRole('menuitem', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: '面试设置', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '设置', exact: true });
  const alignment = await dialog.evaluate((element) => {
    const rect = (e) => {
      const r = e.getBoundingClientRect();
      return { left: r.left, top: r.top, width: r.width, height: r.height };
    };
    const rows = [...element.querySelectorAll('.speech-setting-row')];
    return {
      devices: [...element.querySelectorAll('.speech-device')].map(rect),
      selects: rows.map((r) => rect(r.querySelector('.speech-select'))),
      textLeft: rect(element.querySelector('.speech-answer-settings .speech-setting-label')).left,
      effortLeft: rect(element.querySelector('.speech-effort-row .speech-setting-label')).left,
      overflow: element.scrollWidth > element.clientWidth + 1,
    };
  });
  check(
    'interview-device-and-select-alignment',
    alignment.devices[0].width === alignment.devices[1].width &&
      alignment.selects.every((r) => Math.abs(r.left - alignment.selects[0].left) < 1) &&
      !alignment.overflow,
    alignment,
  );
  check(
    'interview-label-alignment',
    Math.abs(alignment.textLeft - alignment.effortLeft) <= 1,
    alignment,
  );
  await dialog.screenshot({ animations: 'disabled' });
  await page.evaluate(() => document.documentElement.classList.add('dark'));
  await dialog.screenshot({ animations: 'disabled' });
  await dialog.getByRole('button', { name: '关闭设置', exact: true }).click();
  await page.getByRole('button', { name: '知识库', exact: true }).click();
  await page
    .getByRole('button', { name: /创建知识库/ })
    .first()
    .click();
  const baseName = 'LongKnowledgeBaseName'.repeat(3).slice(0, 60);
  await page.getByLabel('知识库名称', { exact: true }).fill(baseName);
  await page.getByRole('button', { name: '保存', exact: true }).click();
  const base = page.getByRole('dialog', { name: baseName, exact: true });
  await base.waitFor();
  const headerFits = await base
    .locator('.dialog-heading')
    .evaluate((element) => element.scrollWidth <= element.clientWidth + 1);
  check('long-dialog-title', headerFits);
  await base.screenshot({ animations: 'disabled' });
  await base.getByRole('button', { name: '关闭对话框', exact: true }).click();
  await page.getByRole('button', { name: '用户菜单', exact: true }).click();
  await page.getByRole('menuitem', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: '面试设置', exact: true }).click();
  await page.getByRole('button', { name: '麦克风设备', exact: true }).waitFor();
  await page.getByRole('button', { name: '关闭设置', exact: true }).click();
  check('renderer-errors', errors.length === 0, errors);
  await console.log(JSON.stringify(checks, null, 2));
  console.log(
    JSON.stringify({ directory, checks: checks.map(({ name, passed }) => ({ name, passed })) }),
  );
  assert.ok(
    checks.every((r) => r.passed),
    'Visual geometry checks failed; see terminal output',
  );
} finally {
  await app
    .evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy()))
    .catch(() => {});
  await closeUiApp(app);
}
