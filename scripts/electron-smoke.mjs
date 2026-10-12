import { _electron as electron } from 'playwright';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
await mkdir('test-results', { recursive: true });
const profile = path.resolve('test-results', `smoke-profile-${Date.now()}`);
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
  const login = await app.firstWindow();
  const [page] = await Promise.all([
    app.waitForEvent('window'),
    login.getByRole('button', { name: '体验 Mock 界面', exact: true }).click(),
  ]);
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('pageerror', (error) => {
    errors.push(error.message);
    console.error(error.message);
  });
  await page.getByRole('heading', { name: '有什么可以帮你？' }).waitFor();
  assert.equal(await page.evaluate(() => typeof window.desktop?.windowAction), 'function');
  assert.equal(await page.evaluate(() => typeof window.require), 'undefined');
  assert.equal(
    await page.getByRole('button', { name: '开始面试', exact: true }).isDisabled(),
    false,
  );
  await page.screenshot({ path: 'test-results/welcome-light.png' });
  await page.getByRole('button', { name: '用户菜单' }).click();
  assert.equal(await page.getByRole('menuitem').count(), 2);
  await page.getByRole('menuitem', { name: '设置' }).click();
  await page.getByRole('button', { name: '深色', exact: true }).click();
  assert.equal(await page.locator('html').getAttribute('class'), 'dark');
  await page.getByRole('button', { name: '关闭设置' }).click();
  await page.screenshot({ path: 'test-results/welcome-dark.png' });
  await page
    .getByRole('textbox', { name: '聊天消息' })
    .fill('姓名：测试用户\n岗位：前端工程师\nJD：负责 React 桌面应用');
  await page.getByRole('button', { name: '发送消息' }).click();
  await page.getByRole('button', { name: '确认更新', exact: true }).click();
  await page.getByRole('button', { name: '个人信息', exact: true }).click();
  assert.equal(await page.getByLabel('姓名', { exact: true }).inputValue(), '测试用户');
  assert.equal(await page.getByLabel('目标岗位', { exact: true }).inputValue(), '前端工程师');
  await page.getByLabel('个人背景', { exact: true }).fill('有 React 和 TypeScript 项目经验');
  await page.getByRole('button', { name: '保存信息', exact: true }).click();
  await page.getByLabel('上传简历文件', { exact: true }).setInputFiles({
    name: 'resume.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('测试简历：React 项目经历'),
  });
  await page.locator('.resume-chip').getByText('resume.txt', { exact: true }).waitFor();
  await page.screenshot({ path: 'test-results/chat-profile-dark.png' });
  await page.getByRole('button', { name: '关闭个人信息' }).click();
  await page.getByRole('button', { name: '面试记录', exact: true }).click();
  await page.getByRole('heading', { name: '还没有面试记录' }).waitFor();
  await page.getByRole('button', { name: '查看示例记录', exact: true }).click();
  assert.equal(await page.locator('.history-row').count(), 2);
  await page.screenshot({ path: 'test-results/history-dark.png' });
  await page.locator('.history-row').first().click();
  await page.getByText('这是模拟记录示例，并非真实面试。', { exact: false }).waitFor();
  await page.screenshot({ path: 'test-results/history-detail-dark.png' });
  await page.getByRole('button', { name: '知识库', exact: true }).click();
  await page.getByRole('button', { name: '创建知识库', exact: false }).first().click();
  await page
    .getByRole('dialog', { name: '创建知识库', exact: true })
    .getByLabel('知识库名称')
    .fill('前端项目资料');
  await page
    .getByRole('dialog', { name: '创建知识库', exact: true })
    .getByRole('button', { name: '保存', exact: true })
    .click();
  const baseDialog = page.getByRole('dialog', { name: '前端项目资料', exact: true });
  await baseDialog.getByLabel('导入知识库文档').setInputFiles([
    {
      name: 'project.md',
      mimeType: 'text/markdown',
      buffer: Buffer.from('# 项目介绍\n使用 React 构建桌面应用'),
    },
    { name: 'job.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 mock document') },
  ]);
  await baseDialog.getByText('project.md', { exact: true }).waitFor();
  await baseDialog.getByText('job.pdf', { exact: true }).waitFor();
  await baseDialog
    .locator('.document-row')
    .filter({ hasText: 'project.md' })
    .getByRole('button', { name: '预览' })
    .click();
  await page
    .getByRole('dialog', { name: 'project.md', exact: true })
    .getByText('使用 React 构建桌面应用', { exact: false })
    .waitFor();
  await page
    .getByRole('dialog', { name: 'project.md', exact: true })
    .getByRole('button', { name: '关闭对话框' })
    .click();
  await baseDialog.getByLabel('导入知识库文档').setInputFiles({
    name: 'blocked.exe',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from('invalid'),
  });
  await baseDialog
    .getByRole('alert')
    .getByText('不支持的文件格式：blocked.exe', { exact: true })
    .waitFor();
  assert.equal(await baseDialog.locator('.document-row').count(), 2);
  await baseDialog.getByRole('button', { name: '重命名', exact: true }).click();
  await page
    .getByRole('dialog', { name: '重命名知识库' })
    .getByLabel('知识库名称')
    .fill('React 面试资料');
  await page
    .getByRole('dialog', { name: '重命名知识库' })
    .getByRole('button', { name: '保存', exact: true })
    .click();
  await page
    .getByRole('dialog', { name: 'React 面试资料', exact: true })
    .getByRole('button', { name: '关闭对话框' })
    .click();
  await page.reload();
  await page.getByRole('button', { name: '个人信息', exact: true }).click();
  assert.equal(
    await page.getByLabel('个人背景', { exact: true }).inputValue(),
    '有 React 和 TypeScript 项目经验',
  );
  await page.locator('.resume-chip').getByText('resume.txt', { exact: true }).waitFor();
  await page.getByRole('button', { name: '关闭个人信息' }).click();
  await page.getByRole('button', { name: '知识库', exact: true }).click();
  await page.getByRole('button', { name: 'React 面试资料', exact: false }).click();
  const savedDialog = page.getByRole('dialog', { name: 'React 面试资料', exact: true });
  await savedDialog.getByText('project.md', { exact: true }).waitFor();
  assert.equal(await savedDialog.locator('.document-row').count(), 2);
  await page.screenshot({ path: 'test-results/knowledge-documents-dark.png' });
  await savedDialog.getByRole('button', { name: '删除文档 job.pdf', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('.document-row').length === 1);
  await savedDialog.getByRole('button', { name: '关闭对话框' }).click();
  await page.screenshot({ path: 'test-results/knowledge-dark.png' });
  await page.getByRole('button', { name: 'React 面试资料', exact: false }).click();
  await savedDialog.getByRole('button', { name: '删除知识库', exact: true }).click();
  await savedDialog.getByRole('button', { name: '确认删除', exact: true }).click();
  await page.getByRole('heading', { name: '创建你的第一个知识库' }).waitFor();
  await page.evaluate(() =>
    localStorage.setItem(
      'copilot-interview-history-v1',
      JSON.stringify([
        {
          id: 'test-record',
          title: '测试记录',
          startedAt: 100,
          endedAt: 1000,
          status: 'ended',
          mock: true,
          transcripts: [],
          answers: [],
        },
      ]),
    ),
  );
  await page.reload();
  await page.getByRole('button', { name: '面试记录', exact: true }).click();
  await page.locator('.history-row').filter({ hasText: '测试记录' }).click();
  await page.getByRole('button', { name: '删除记录' }).click();
  await page.getByRole('button', { name: '确认删除', exact: true }).click();
  await page.getByRole('heading', { name: '还没有面试记录' }).waitFor();
  await page.getByRole('button', { name: '新对话', exact: true }).click();
  await page.getByRole('button', { name: '用户菜单' }).click();
  const [returnedLogin] = await Promise.all([
    app.waitForEvent('window'),
    page.getByRole('menuitem', { name: '退出登录' }).click(),
  ]);
  await returnedLogin.getByRole('heading', { name: '欢迎回来' }).waitFor();
  assert.deepEqual(errors, []);
  console.log(
    'PASS: Electron startup, unified shell, mock preparation chat, profile/resume persistence, independent history, knowledge CRUD/import/preview/persistence and user menu.',
  );
} catch (error) {
  const page = app.windows()[0];
  if (page) {
    await page.screenshot({ path: 'test-results/smoke-failure.png' });
    console.error(await page.locator('main').innerText());
  }
  throw error;
} finally {
  await app.close();
  await server?.close();
}
