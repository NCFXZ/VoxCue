import { testRoot, electron } from './test-workspace.mjs';
import workspace from '../../scripts/workspace.mjs';
import { closeUiApp } from './install-ui-account.mjs';

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const profile = path.resolve(path.join(testRoot, 'test/results'), `composer-profile-${Date.now()}`);
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
  const send = page.getByRole('button', { name: '发送消息', exact: true });
  await send.waitFor();
  const dimensions = await send.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  });
  assert.equal(dimensions.width, dimensions.height);
  page.on('pageerror', (error) => errors.push(error.message));
  await page.getByRole('button', { name: '添加附件', exact: true }).click();
  await page.getByRole('menuitem', { name: '添加文件夹' }).waitFor();
  await page.getByRole('menuitemcheckbox', { name: '网络搜索' }).click();
  assert.equal(
    await page.getByRole('button', { name: /网络搜索/ }).getAttribute('aria-pressed'),
    'true',
  );
  await page.getByRole('button', { name: '聊天模型', exact: true }).click();
  await page.getByRole('menuitemradio', { name: /GPT · 推理/ }).click();
  await page.getByRole('button', { name: '思考强度', exact: true }).click();
  await page.getByRole('menuitemradio', { name: '高', exact: true }).click();
  await page.getByLabel('添加聊天文件', { exact: true }).setInputFiles({
    name: 'resume-draft.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('本地简历草稿'),
  });
  await page.locator('.chat-attachment').getByText('resume-draft.txt', { exact: false }).waitFor();
  await page.locator('.composer').evaluate((element) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(['项目素材'], 'project.md', { type: 'text/markdown' }));
    element.dispatchEvent(
      new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }),
    );
  });
  await page.locator('.chat-attachment').getByText('project.md', { exact: false }).waitFor();
  assert.equal(await page.locator('.chat-attachment').count(), 2);
  const folder = path.join(profile, 'context');
  await mkdir(folder);
  await writeFile(path.join(folder, 'jd.txt'), '岗位描述');
  await page.getByLabel('添加聊天文件夹', { exact: true }).setInputFiles(folder);
  await page.locator('.chat-attachment').getByText('context/jd.txt', { exact: false }).waitFor();
  await page.getByRole('button', { name: '移除附件 context/jd.txt', exact: true }).click();
  assert.equal(await page.locator('.chat-attachment').count(), 3);
  await page.getByRole('button', { name: '确认删除：附件：context/jd.txt', exact: true }).click();
  assert.equal(await page.locator('.chat-attachment').count(), 2);
  await page.screenshot({});
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await page.locator('.chat-answer').getByText('尚未联网检索', { exact: false }).waitFor();
  assert.equal(await page.locator('.chat-attachment').count(), 0);
  await page.locator('.message-options').getByText('附件：project.md').waitFor();
  await page.locator('.message-options').getByText('思考：高', { exact: false }).waitFor();
  await page.getByRole('button', { name: '停止回复', exact: true }).click();
  await page.getByLabel('添加聊天文件', { exact: true }).setInputFiles({
    name: 'bad.exe',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from('bad'),
  });
  await page.getByRole('alert').getByText('不支持的文件格式：bad.exe', { exact: false }).waitFor();
  await page.getByRole('button', { name: '用户菜单' }).click();
  await page.getByRole('menuitem', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: '外观主题', exact: true }).click();
  await page.getByRole('menuitemradio', { name: '深色', exact: true }).click();
  await page.getByRole('button', { name: '关闭设置' }).click();
  await page.getByRole('button', { name: '新对话', exact: true }).click();
  await page.getByLabel('添加聊天文件', { exact: true }).setInputFiles({
    name: 'project.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from('项目素材'),
  });
  await page.screenshot({});
  assert.deepEqual(errors, []);
  console.log(
    'PASS: attachment menu, file selection/drop, removal after send, request model/search snapshot, internal synthetic response, invalid file validation and compact sidebar.',
  );
} finally {
  await closeUiApp(app);
}
