import { testRoot, electron } from './test-workspace.mjs';
import { closeUiApp } from './install-ui-account.mjs';

import { mkdir, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import fixtures from './rag-fixtures.cjs';
await mkdir(path.join(testRoot, 'test/results'), { recursive: true });
const profile = await mkdtemp(path.resolve(path.join(testRoot, 'test/results/rag-ui-')));
const env = { ...process.env, COPILOT_TEST_USER_DATA: profile, VITE_DEV_SERVER_URL: '' };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: ['.'], env });
try {
  const login = await app.firstWindow();
  await login.getByRole('button', { name: '使用 ChatGPT 继续', exact: true }).waitFor();
  const [page] = await Promise.all([
    app.waitForEvent('window'),
    login.evaluate(() => window.desktop.enterDemo()),
  ]);
  page.setDefaultTimeout(30000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.getByRole('button', { name: '知识库', exact: true }).click();
  await page
    .getByRole('button', { name: /创建知识库/ })
    .first()
    .click();
  await page.getByLabel('知识库名称', { exact: true }).fill('RAG 本地集成');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  const base = page.getByRole('dialog', { name: 'RAG 本地集成', exact: true });
  assert.equal(
    await base.getByLabel('知识库检索问题').evaluate((e) => getComputedStyle(e).fontSize),
    '14px',
    'Search controls use the shared 14px body typography',
  );
  assert.equal(await base.locator('select').count(), 0);
  await base.getByLabel('导入知识库文档').setInputFiles([
    {
      name: 'sensor.md',
      mimeType: 'text/markdown',
      buffer: Buffer.from(
        '## Q001. How does the eddy current sensor control lift-off?\n\nThe synthetic answer uses PID feedback. Tailxyz parameter is 37.\n\n### 追问 1：如何限幅？\n\n限制输出并保留追问。',
      ),
    },
    { name: 'resume.pdf', mimeType: 'application/pdf', buffer: fixtures.pdf() },
    {
      name: 'project.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from(
        'Qt uses queued connections to keep the GUI responsive. 工作线程不能直接修改界面。',
      ),
    },
  ]);
  await page.waitForFunction(
    async () => {
      const r = await window.desktop.knowledge({ op: 'status' });
      return (
        r.ok && r.value.documents?.length === 3 && r.value.tasks.every((t) => t.phase === 'ready')
      );
    },
    undefined,
    { timeout: 120000 },
  );
  await base.getByRole('button', { name: '高级选项', exact: true }).click();
  for (const mode of ['hybrid', 'keyword', 'vector']) {
    await base.getByLabel('知识库检索问题').fill('eddy current PID lift-off');
    await base.getByRole('button', { name: '检索方式', exact: true }).click();
    await base
      .getByRole('menuitemradio', {
        name: { hybrid: '混合', keyword: '关键词', vector: '向量' }[mode],
        exact: true,
      })
      .click();
    await base.getByRole('button', { name: '查找资料', exact: true }).click();
    try {
      await base.locator('.knowledge-hits button').first().waitFor({ timeout: 10000 });
    } catch (error) {
      const status = await page.evaluate(() => window.desktop.knowledge({ op: 'status' }));
      const direct = await page.evaluate(
        (mode) =>
          window.desktop.knowledge({
            op: 'search',
            requestId: crypto.randomUUID(),
            query: 'eddy current PID lift-off',
            mode,
            topK: 5,
          }),
        mode,
      );
      console.log(
        JSON.stringify({
          diagnostic: true,
          mode,
          query: await base.getByLabel('知识库检索问题').inputValue(),
          alerts: await base.getByRole('alert').allTextContents(),
          documents: status.ok ? status.value.documents.length : status.error,
          direct: direct.ok ? direct.value.length : direct.error,
        }),
      );
      await page.screenshot({});
      throw error;
    }
    await base.locator('.knowledge-hits button').filter({ hasText: 'sensor.md' }).first().click();
    const preview = page.getByRole('dialog', { name: /How does the eddy/ });
    await preview.getByText(/Tailxyz parameter is 37/).waitFor();
    await preview.getByText(/限制输出并保留追问/).waitFor();
    await preview.getByRole('button', { name: '关闭对话框', exact: true }).click();
  }
  await page.screenshot({ animations: 'disabled' });
  await page.reload();
  await page.getByRole('button', { name: '知识库', exact: true }).click();
  await page.getByRole('button', { name: /RAG 本地集成/ }).click();
  await page
    .getByRole('dialog', { name: 'RAG 本地集成', exact: true })
    .getByText(/可用于回答/)
    .first()
    .waitFor();
  await page
    .getByRole('dialog', { name: 'RAG 本地集成', exact: true })
    .getByRole('button', { name: '关闭对话框', exact: true })
    .click();
  await page.getByRole('button', { name: '用户菜单', exact: true }).click();
  await page.getByRole('menuitem', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: '知识库', exact: true }).last().click();
  const settings = page.getByRole('dialog', { name: '设置', exact: true });
  await settings.getByRole('button', { name: '资料使用方式', exact: true }).click();
  await settings.getByRole('menuitemradio', { name: '由模型按需查找', exact: true }).click();
  await page.waitForFunction(async () => {
    const r = await window.desktop.knowledge({ op: 'status' });
    return r.ok && r.value.mode === 'function';
  });
  await settings.getByRole('button', { name: '资料使用方式', exact: true }).click();
  await settings
    .getByRole('menuitemradio', { name: '自动查找相关资料（默认）', exact: true })
    .click();
  await page.getByRole('button', { name: '关闭设置', exact: true }).click();
  assert.deepEqual(errors, []);
  const result = {
    status: 'passed',
    profile,
    checks: [
      'real utilityProcess',
      'local PDF/MD/TXT import',
      'three search modes',
      'whole QA plus follow-up',
      'restart persistence',
      'original preservation',
    ],
    liveAccount: false,
  };
  await console.log(JSON.stringify(result, null, 2));
  console.log(result);
} finally {
  await closeUiApp(app);
}
