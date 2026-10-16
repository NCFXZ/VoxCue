import { closeUiApp } from './install-ui-account.mjs';
import { _electron as electron } from 'playwright';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const profile = path.resolve('test/results', `conversations-profile-${Date.now()}`);
await mkdir(profile, { recursive: true });
const app = await electron.launch({
  args: ['.'],
  env: { ...process.env, COPILOT_TEST_USER_DATA: profile, VITE_DEV_SERVER_URL: '' },
});
try {
  const login = await app.firstWindow();
  await login.getByRole('button', { name: '使用 ChatGPT 继续', exact: true }).waitFor();
  await login.waitForFunction(() => document.visibilityState === 'visible');
  const [page] = await Promise.all([
    app.waitForEvent('window'),
    login.evaluate(() => window.desktop.enterDemo()),
  ]);
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.getByRole('textbox', { name: '聊天消息', exact: true }).fill('第一条对话');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await page.getByRole('button', { name: '停止回复', exact: true }).click();
  await page.getByRole('button', { name: '新对话', exact: true }).click();
  await page.getByRole('textbox', { name: '聊天消息', exact: true }).fill('第二条对话');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  const row = page.locator('.conversation-row').filter({ hasText: '第一条对话' });
  await row.hover();
  await row.getByRole('button', { name: '删除对话：第一条对话', exact: true }).click();
  await row
    .getByRole('button', { name: '确认删除：对话：第一条对话', exact: true })
    .press('Escape');
  assert.equal(await page.locator('.conversation-row').count(), 2);
  await row.getByRole('button', { name: '第一条对话', exact: true }).click();
  await page.locator('.chat-message.user').getByText('第一条对话', { exact: true }).waitFor();
  await row.hover();
  await row.getByRole('button', { name: '删除对话：第一条对话', exact: true }).click();
  await row.getByRole('button', { name: '确认删除：对话：第一条对话', exact: true }).click();
  assert.equal(await page.locator('.conversation-row').count(), 1);
  assert.equal(await page.locator('.chat-message').count(), 0);
  const remaining = page.locator('.conversation-row');
  await remaining.locator('.conversation').click();
  await page.locator('.chat-message.user').getByText('第二条对话', { exact: true }).waitFor();
  await remaining.hover();
  await remaining.getByRole('button', { name: '删除对话：第二条对话', exact: true }).click();
  await page.screenshot({ path: 'test/results/conversation-delete.png' });
  await remaining.getByRole('button', { name: '确认删除：对话：第二条对话', exact: true }).click();
  assert.equal(await page.locator('.conversation-row').count(), 0);
  assert.deepEqual(errors, []);
  console.log(
    'PASS: conversation switching, cancel deletion, confirmed deletion and return to new chat.',
  );
} finally {
  await closeUiApp(app);
}
