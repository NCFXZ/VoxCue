import { _electron as electron } from 'playwright';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
const profile = path.resolve('test-results', `floating-profile-${Date.now()}`);
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
  const main = await app.firstWindow();
  main.setDefaultTimeout(15000);
  const [floating] = await Promise.all([
    app.waitForEvent('window'),
    main.getByRole('button', { name: '开始面试', exact: true }).click(),
  ]);
  floating.setDefaultTimeout(15000);
  const errors = [];
  floating.on('pageerror', (error) => errors.push(error.message));
  await floating.getByRole('button', { name: '截图保护已开启' }).waitFor();
  assert.equal(
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((win) => win.webContents.getURL().endsWith('#interview'))
        .isContentProtected(),
    ),
    true,
  );
  await floating.getByRole('button', { name: '截图保护已开启' }).click();
  await floating.getByRole('button', { name: '允许截图/共享', exact: true }).waitFor();
  assert.equal(
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((win) => win.webContents.getURL().endsWith('#interview'))
        .isContentProtected(),
    ),
    false,
  );
  await floating.screenshot({ path: 'test-results/floating-light.png' });
  await floating.getByRole('button', { name: '开始模拟转写', exact: true }).click();
  await floating.getByText('模拟面试官', { exact: true }).first().waitFor();
  await floating.locator('.answer-text').first().waitFor();
  await floating.getByRole('button', { name: '暂停模拟', exact: true }).click();
  await floating.getByText('已暂停', { exact: true }).waitFor();
  await floating.getByRole('button', { name: '转写面板', exact: true }).click();
  assert.equal(await floating.locator('.floating-panel').count(), 1);
  await floating.getByRole('button', { name: '转写面板', exact: true }).click();
  await floating.getByRole('button', { name: '已置顶', exact: true }).click();
  await floating.getByRole('button', { name: '置顶', exact: true }).waitFor();
  await floating.evaluate(() => {
    localStorage.setItem('copilot-theme', 'dark');
    window.dispatchEvent(new Event('storage'));
  });
  await floating.screenshot({ path: 'test-results/floating-dark.png' });
  await floating.getByRole('button', { name: '结束面试', exact: true }).click();
  await main.getByRole('button', { name: '面试记录', exact: true }).click();
  await main.locator('.history-row').first().waitFor();
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1);
  await main.getByRole('button', { name: '新对话', exact: true }).click();
  const [reopened] = await Promise.all([
    app.waitForEvent('window'),
    main.getByRole('button', { name: '开始面试', exact: true }).click(),
  ]);
  await reopened.getByRole('button', { name: '截图保护已开启' }).waitFor();
  assert.equal(
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((win) => win.webContents.getURL().endsWith('#interview'))
        .isContentProtected(),
    ),
    true,
  );
  await reopened.getByRole('button', { name: '结束面试并返回', exact: true }).click();
  assert.deepEqual(errors, []);
  console.log(
    'PASS: independent floating window, default OS protection, explicit sharing toggle, reset on reopen, mock transcript/answer, pin/panel controls and history persistence.',
  );
} finally {
  await app.close();
  await server?.close();
}
