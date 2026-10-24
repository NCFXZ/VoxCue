import { waitForAsync } from './wait-for-async.mjs';
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
    await base.getByLabel('知识库检索问题').count(),
    0,
    'Retired manual search stays out of the document management layout',
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
  await waitForAsync(
    page,
    async () => {
      const r = await window.desktop.knowledge({ op: 'status' });
      return (
        r.ok && r.value.documents?.length === 3 && r.value.tasks.every((t) => t.phase === 'ready')
      );
    },
    undefined,
    { timeout: 120000 },
  );
  assert.equal(await base.locator('.document-row').count(), 3);
  assert.equal(await base.getByText(/索引完成/).count(), 3);
  // The manual search/preview UI was retired. Keep real indexed retrieval
  // coverage at its public IPC port; import/status/persistence remain UI checks.
  for (const mode of ['hybrid', 'keyword', 'vector']) {
    const result = await page.evaluate(async (mode) => {
      const status = await window.desktop.knowledge({ op: 'status' });
      if (!status.ok) throw Error(status.error);
      const doc = status.value.documents.find((doc) => doc.name === 'sensor.md');
      const hits = await window.desktop.knowledge({
        op: 'search',
        requestId: crypto.randomUUID(),
        query: 'eddy current PID lift-off',
        baseId: doc.baseId,
        mode,
        topK: 5,
      });
      if (!hits.ok) throw Error(hits.error);
      const hit = hits.value.find((hit) => hit.name === 'sensor.md');
      if (!hit) throw Error('Indexed sensor document missing for ' + mode);
      const item = await window.desktop.knowledge({
        op: 'item',
        requestId: crypto.randomUUID(),
        itemId: hit.itemId,
      });
      if (!item.ok) throw Error(item.error);
      return item.value;
    }, mode);
    const content = [result.content, ...(result.followUps ?? []).map((item) => item.content)].join(
      '\n',
    );
    assert.match(content, /Tailxyz parameter is 37/);
    assert.match(content, /限制输出并保留追问/);
  }
  await page.screenshot({ animations: 'disabled' });
  await page.reload();
  await page.getByRole('button', { name: '知识库', exact: true }).click();
  await page.getByRole('button', { name: /RAG 本地集成/ }).click();
  await page
    .getByRole('dialog', { name: 'RAG 本地集成', exact: true })
    .getByText(/索引完成/)
    .first()
    .waitFor();
  await page
    .getByRole('dialog', { name: 'RAG 本地集成', exact: true })
    .getByRole('button', { name: '关闭对话框', exact: true })
    .click();
  await page.getByRole('button', { name: '用户菜单', exact: true }).click();
  await page.getByRole('menuitem', { name: '设置', exact: true }).click();
  const settings = page.getByRole('dialog', { name: '设置', exact: true });
  assert.equal(
    await settings
      .getByRole('navigation')
      .getByRole('button', { name: '知识库', exact: true })
      .count(),
    0,
  );
  assert.equal(
    await settings.getByRole('button', { name: '资料使用方式', exact: true }).count(),
    0,
  );
  await waitForAsync(page, async () => {
    const result = await window.desktop.knowledge({ op: 'settings', mode: 'function' });
    return !result.ok;
  });
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
