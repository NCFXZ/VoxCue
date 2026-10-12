import { _electron as electron } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const profile = path.resolve('test-results', `chat-response-profile-${Date.now()}`);
await mkdir(profile, { recursive: true });
const fixture = path.join(profile, 'main.cjs');
await writeFile(
  fixture,
  `const {app} = require('electron'); app.setAppPath(${JSON.stringify(process.cwd())}); globalThis.chatTestModules = { ...require(${JSON.stringify(path.resolve('dist-electron/backend/chat/service.js'))}), ...require(${JSON.stringify(path.resolve('dist-electron/backend/chat/usage.js'))}) }; require(${JSON.stringify(path.resolve('dist-electron/main.js'))});`,
);
const app = await electron.launch({
  args: [fixture],
  env: { ...process.env, COPILOT_TEST_USER_DATA: profile, VITE_DEV_SERVER_URL: '' },
});
try {
  const login = await app.firstWindow();
  const [page] = await Promise.all([
    app.waitForEvent('window'),
    login.getByRole('button', { name: '体验 Mock 界面', exact: true }).click(),
  ]);
  page.setDefaultTimeout(15000);
  // Only the test profile's transport is replaced. Renderer and IPC remain real.
  await app.evaluate(async ({ ipcMain }, profile) => {
    const { ChatGPTService, publicFailure, UsageLedger } = globalThis.chatTestModules;
    let responseCount = 0;
    const service = new ChatGPTService({
      access: async () => ({ account: 'test', token: 'test-only' }),
      ledger: new UsageLedger(profile + '/usage'),
      fetch: async (url, options) => {
        if (url.endsWith('/models'))
          return Response.json({
            models: [{ slug: 'gpt-6-luna', display_name: 'Test Luna', visibility: 'list' }],
          });
        const request = JSON.parse(options.body);
        if (request.input.at(-1).content === '状态测试') {
          const encoder = new TextEncoder();
          const events = [
            { type: 'response.created' },
            { type: 'response.output_item.added', item: { type: 'reasoning' } },
            { type: 'response.web_search_call.searching' },
            {
              type: 'response.output_item.added',
              item: {
                type: 'web_search_call',
                action: { type: 'open_page', url: 'https://example.com/docs' },
              },
            },
            { type: 'response.output_text.delta', delta: '状态演示已完成' },
            {
              type: 'response.completed',
              response: { id: 'status-test', status: 'completed', output: [] },
            },
          ];
          return new Response(
            new ReadableStream({
              async start(controller) {
                for (const event of events) {
                  controller.enqueue(encoder.encode('data: ' + JSON.stringify(event) + '\n\n'));
                  await new Promise((resolve) => setTimeout(resolve, 700));
                }
                controller.close();
              },
            }),
            { headers: { 'content-type': 'text/event-stream' } },
          );
        }
        if (request.input.at(-1).content === '失败测试')
          return new Response('<html>upstream error</html>', {
            headers: { 'content-type': 'text/html' },
          });
        if (request.reasoning?.effort !== 'low') throw new Error('Effort not transmitted');
        const markdown =
          '**JSON 回答已显示**\n\n```python\nprint("Hello")\n```\n\n|字段|内容|\n|---|---|\n|姓名|示例|';
        const text =
          request.text?.format?.type === 'json_schema'
            ? JSON.stringify({
                answer: '**已整理资料**，请检查修改前后内容并确认。',
                changes: {
                  name: '新姓名',
                  role: null,
                  jobDescription: '新的 JD',
                  background: null,
                },
              })
            : markdown;
        return Response.json({
          object: 'response',
          id: `test-response-${++responseCount}`,
          status: 'completed',
          output: [{ content: [{ type: 'output_text', text }] }],
          usage: { input_tokens: 4, output_tokens: 2, total_tokens: 6 },
        });
      },
    });
    for (const channel of ['auth:session', 'chat:models', 'chat:usage', 'chat:send'])
      ipcMain.removeHandler(channel);
    ipcMain.handle('auth:session', () => ({
      mode: 'chatgpt',
      user: { id: 'test', name: 'Test', email: '' },
      expiresAt: Date.now() + 3600000,
    }));
    ipcMain.handle('chat:models', async () => ({ ok: true, models: await service.models() }));
    ipcMain.handle('chat:usage', async () => ({ ok: true, usage: await service.usage() }));
    ipcMain.handle('chat:send', async (event, request) => {
      try {
        return {
          ok: true,
          ...(await service.stream(
            request,
            (value) => event.sender.send('chat:event', value),
            new AbortController().signal,
          )),
        };
      } catch (error) {
        return { ok: false, error: publicFailure(error) };
      }
    });
  }, profile);
  await page.evaluate(() =>
    localStorage.setItem(
      'copilot-personal-info-v1',
      JSON.stringify({
        name: '旧姓名',
        role: '原岗位',
        jobDescription: '旧 JD',
        background: '已有经历',
      }),
    ),
  );
  await page.reload();
  await page
    .getByRole('button', { name: '聊天模型', exact: true })
    .getByText('Test Luna')
    .waitFor();
  const controls = await page.locator('.composer-tool').evaluateAll((elements) =>
    elements.map((element) => {
      const style = getComputedStyle(element);
      return {
        height: Math.round(element.getBoundingClientRect().height * 100) / 100,
        shadow: style.boxShadow,
        radius: style.borderRadius,
      };
    }),
  );
  assert.equal(controls.length, 3);
  assert.deepEqual(controls, Array(3).fill({ height: 26, shadow: 'none', radius: '7px' }));
  await page.getByRole('button', { name: '聊天模型', exact: true }).click();
  assert.equal(await page.locator('.model-option-icon').count(), 0);
  assert.ok(
    await page
      .locator('.model-option')
      .evaluate((element) => element.getBoundingClientRect().height <= 32),
  );
  await page.screenshot({ path: 'test-results/compact-model-menu.png' });
  await page.keyboard.press('Escape');
  await page.getByRole('textbox', { name: '聊天消息', exact: true }).fill('你好');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await page.locator('.chat-answer').getByText('JSON 回答已显示', { exact: true }).waitFor();
  assert.equal(await page.locator('.chat-answer strong').count(), 1);
  assert.equal(await page.locator('.chat-answer pre code.language-python').count(), 1);
  assert.equal(await page.locator('.chat-answer table').count(), 1);
  await page.screenshot({ path: 'test-results/markdown-chat.png' });
  await page.evaluate(() => {
    navigator.clipboard.writeText = async (text) => {
      window.testCopiedCode = text;
    };
  });
  await page.getByRole('button', { name: '复制代码', exact: true }).click();
  assert.equal(await page.evaluate(() => window.testCopiedCode), 'print("Hello")');
  await page
    .locator('.usage-panel > strong')
    .filter({ hasText: /^6\s*token$/ })
    .waitFor();
  await page.getByRole('textbox', { name: '聊天消息', exact: true }).fill('失败测试');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await page.locator('.chat-answer').getByText('请求失败，未收到回答。', { exact: true }).waitFor();
  assert.equal(await page.getByText('正在等待回答…', { exact: true }).count(), 0);
  await page.getByRole('alert').getByText('格式 text/html', { exact: false }).waitFor();
  await page.getByLabel('添加聊天文件', { exact: true }).setInputFiles({
    name: 'resume.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from('姓名：新姓名\nJD：新的 JD'),
  });
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  const proposals = page.getByRole('region', { name: '待确认的资料更新', exact: true });
  await proposals.first().getByText('修改前', { exact: true }).first().waitFor();
  await page.locator('.chat-answer').getByText('已整理资料', { exact: true }).waitFor();
  assert.equal(
    await page.evaluate(() => JSON.parse(localStorage.getItem('copilot-personal-info-v1')).name),
    '旧姓名',
  );
  await proposals.first().getByRole('button', { name: '保留旧版', exact: true }).click();
  assert.equal(
    await page.evaluate(() => JSON.parse(localStorage.getItem('copilot-personal-info-v1')).name),
    '旧姓名',
  );
  await page.getByRole('textbox', { name: '聊天消息', exact: true }).fill('更新个人信息');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await proposals.last().getByRole('button', { name: '确认更新', exact: true }).waitFor();
  await page.screenshot({ path: 'test-results/profile-proposal-light.png' });
  await page.getByRole('button', { name: '用户菜单', exact: true }).click();
  await page.getByRole('menuitem', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: '深色', exact: true }).click();
  await page.getByRole('button', { name: '关闭设置', exact: true }).click();
  await page.screenshot({ path: 'test-results/profile-proposal-dark.png' });
  await proposals.last().getByRole('button', { name: '确认更新', exact: true }).click();
  await proposals.last().getByText('个人信息已更新', { exact: true }).waitFor();
  assert.deepEqual(
    await page.evaluate(() => JSON.parse(localStorage.getItem('copilot-personal-info-v1'))),
    { name: '新姓名', role: '原岗位', jobDescription: '新的 JD', background: '已有经历' },
  );
  await page.screenshot({ path: 'test-results/chat-response.png' });
  assert.equal(await page.title(), 'VoxCue');
  assert.equal(await app.evaluate(({ app }) => app.getName()), 'VoxCue');
  assert.equal(await page.locator('.answer-label strong').first().textContent(), 'ChatGPT');
  assert.equal(
    await page
      .locator('.provider-avatar img')
      .first()
      .evaluate((img) => img.complete && img.naturalWidth > 0),
    true,
  );
  assert.ok((await page.locator('link[rel="icon"]').getAttribute('href')).endsWith('voxcue.png'));
  await page.getByRole('button', { name: '个人信息', exact: true }).click();
  const styleOption = page.getByRole('button', { name: '条理清晰', exact: false });
  await styleOption.scrollIntoViewIfNeeded();
  const alignment = await styleOption.evaluate((element) => {
    const card = element.getBoundingClientRect();
    const mark = element.querySelector('svg').getBoundingClientRect();
    return Math.abs(card.y + card.height / 2 - mark.y - mark.height / 2);
  });
  assert.ok(alignment < 1);
  await page.screenshot({ path: 'test-results/voxcue-style-alignment.png' });
  await page.getByRole('button', { name: '个人信息', exact: true }).click();
  await page.getByRole('textbox', { name: '聊天消息', exact: true }).fill('状态测试');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  for (const label of [
    '正在等待服务响应',
    '正在思考',
    '正在联网搜索',
    '正在查询网页',
    '正在生成回答',
  ]) {
    await page.locator('.chat-activity').getByText(label, { exact: false }).waitFor();
    if (label === '正在查询网页') {
      await page
        .locator('.chat-activity')
        .getByText('example.com/docs', { exact: false })
        .waitFor();
      await page.screenshot({ path: 'test-results/voxcue-chat-status.png' });
    }
  }
  await page.locator('.chat-activity').waitFor({ state: 'detached' });
  await page.getByText('状态演示已完成', { exact: true }).waitFor();
  console.log(
    'PASS: compact tools, Markdown/code copy, effort, usage, failure state, attachment proposal, reject/confirm and light/dark themes. Test transport only; no production account used.',
  );
} catch (error) {
  const current = app.windows().at(-1);
  if (current && !current.isClosed()) {
    await current.screenshot({ path: 'test-results/chat-response-failure.png' });
    console.log((await current.locator('body').innerText()).slice(-2500));
  }
  throw error;
} finally {
  await app.close();
}
