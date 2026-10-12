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
    const service = new ChatGPTService({
      access: async () => ({ account: 'test', token: 'test-only' }),
      ledger: new UsageLedger(profile + '/usage'),
      fetch: async (url, options) => {
        if (url.endsWith('/models'))
          return Response.json({
            models: [{ slug: 'gpt-6-luna', display_name: 'Test Luna', visibility: 'list' }],
          });
        const request = JSON.parse(options.body);
        if (request.input.at(-1).content === '失败测试')
          return new Response('<html>upstream error</html>', {
            headers: { 'content-type': 'text/html' },
          });
        if (request.reasoning?.effort !== 'low') throw new Error('Effort not transmitted');
        return Response.json({
          object: 'response',
          id: 'test-response',
          status: 'completed',
          output: [{ content: [{ type: 'output_text', text: 'JSON 回答已显示' }] }],
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
  await page.reload();
  await page
    .getByRole('button', { name: '聊天模型', exact: true })
    .getByText('Test Luna')
    .waitFor();
  await page.getByRole('textbox', { name: '聊天消息', exact: true }).fill('你好');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await page.locator('.chat-answer').getByText('JSON 回答已显示', { exact: true }).waitFor();
  await page
    .locator('.usage-panel > strong')
    .filter({ hasText: /^6\s*token$/ })
    .waitFor();
  await page.getByRole('textbox', { name: '聊天消息', exact: true }).fill('失败测试');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await page.locator('.chat-answer').getByText('请求失败，未收到回答。', { exact: true }).waitFor();
  assert.equal(await page.getByText('正在等待回答…', { exact: true }).count(), 0);
  await page.getByRole('alert').getByText('格式 text/html', { exact: false }).waitFor();
  await page.screenshot({ path: 'test-results/chat-response.png' });
  console.log(
    'PASS: effort reaches native transport, JSON answer renders, usage updates, failure clears waiting state. Test transport only; no production account used.',
  );
} finally {
  await app.close();
}
