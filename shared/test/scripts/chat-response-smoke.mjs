import { testRoot, electron } from './test-workspace.mjs';
import { offlineElectronEntry } from './offline-electron-entry.mjs';
import { closeUiApp } from './install-ui-account.mjs';

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const profile = path.resolve(
  path.join(testRoot, 'test/results'),
  `chat-response-profile-${Date.now()}`,
);
await mkdir(profile, { recursive: true });
const fixture = path.join(profile, 'main.cjs');
await writeFile(
  fixture,
  `const {app} = require('electron'); app.setAppPath(${JSON.stringify(process.cwd())}); globalThis.chatTestModules = { ...require(${JSON.stringify(path.resolve('dist-electron/shared/electron/backend/chat/service.js'))}), ...require(${JSON.stringify(path.resolve('dist-electron/shared/electron/backend/chat/usage.js'))}) }; require(${JSON.stringify(path.resolve('dist-electron/shared/electron/main.js'))});`,
);
const app = await electron.launch({
  args: [await offlineElectronEntry(fixture)],
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
            { type: 'response.web_search_call.searching', item_id: 'search-progress' },
            {
              type: 'response.output_item.added',
              item: {
                type: 'web_search_call',
                id: 'open-reading',
                action: { type: 'open_page', url: 'https://example.com/docs' },
              },
            },
            { type: 'response.output_text.delta', delta: '{"answer":"' },
            {
              type: 'response.output_text.delta',
              delta: JSON.stringify({ answer: '状态演示已完成', changes: {} }).slice(11),
            },
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
                answer:
                  request.input.at(-1).content === '你好'
                    ? markdown
                    : '**已整理资料**，请检查待保存内容并确认。',
                changes:
                  request.input.at(-1).content === '你好'
                    ? {}
                    : {
                        name: '新姓名',
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
    for (const channel of [
      'auth:session',
      'chat:models',
      'chat:usage',
      'chat:usage-reset',
      'chat:send',
    ])
      ipcMain.removeHandler(channel);
    ipcMain.handle('auth:session', () => ({
      mode: 'chatgpt',
      user: { id: 'test', name: 'Test', email: '' },
      expiresAt: Date.now() + 3600000,
    }));
    ipcMain.handle('chat:models', async () => ({ ok: true, models: await service.models() }));
    ipcMain.handle('chat:usage', async () => ({ ok: true, usage: await service.usage() }));
    globalThis.usageResetAttempts = 0;
    ipcMain.handle('chat:usage-reset', async () => {
      globalThis.usageResetAttempts++;
      if (globalThis.rejectUsageReset)
        return { ok: false, error: { message: '合成用量重置失败，请重试。' } };
      if (globalThis.holdUsageReset)
        await new Promise((resolve) => {
          globalThis.releaseUsageReset = resolve;
        });
      return { ok: true, usage: await service.resetUsage() };
    });
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
  assert.deepEqual(
    await page
      .locator('.composer-tool')
      .evaluateAll((elements) => elements.map((element) => element.getAttribute('aria-label'))),
    ['聊天模型', '思考强度'],
  );
  assert.equal(await page.getByRole('button', { name: '网络搜索', exact: true }).count(), 0);
  assert.deepEqual(controls, Array(2).fill({ height: 32, shadow: 'none', radius: '16px' }));
  await page.getByRole('button', { name: '聊天模型', exact: true }).click();
  assert.equal(await page.locator('.model-option-icon').count(), 0);
  assert.ok(
    await page
      .locator('.model-option')
      .evaluate((element) => element.getBoundingClientRect().height <= 32),
  );
  await page.screenshot({});
  await page.keyboard.press('Escape');
  await page.getByRole('textbox', { name: '聊天消息', exact: true }).fill('你好');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await page.locator('.chat-answer').getByText('JSON 回答已显示', { exact: true }).waitFor();
  assert.equal(await page.locator('.chat-answer strong').count(), 1);
  assert.equal(await page.locator('.chat-answer pre code.language-python').count(), 1);
  assert.equal(await page.locator('.chat-answer table').count(), 1);
  await page.screenshot({});
  await page.evaluate(() => {
    navigator.clipboard.writeText = async (text) => {
      window.testCopiedCode = text;
    };
  });
  await page.getByRole('button', { name: '复制代码', exact: true }).click();
  assert.equal(await page.evaluate(() => window.testCopiedCode), 'print("Hello")');
  await page.getByRole('button', { name: '用户菜单', exact: true }).click();
  await page.getByRole('menuitem', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: '账户与用量', exact: true }).click();
  await page
    .locator('.usage-panel > strong')
    .filter({ hasText: /^6\s*token$/ })
    .waitFor();
  assert.equal(await page.locator('.sidebar .usage-panel').count(), 0);
  const usage = page.getByRole('region', { name: '本应用用量', exact: true });
  const reset = usage.getByRole('button', { name: '重置用量', exact: true });
  const confirmReset = usage.getByRole('button', {
    name: '确认重置：本应用的本地用量统计',
    exact: true,
  });
  const counter = usage.locator(':scope > strong');
  const originalButton = await reset.elementHandle();
  const beforeReset = await reset.boundingBox();
  await reset.click();
  assert.equal(
    await confirmReset.evaluate((element, original) => element === original, originalButton),
    true,
  );
  assert.equal(await usage.locator('.usage-reset-confirm').count(), 0);
  assert.match(await confirmReset.getAttribute('aria-description'), /无法撤销.*不影响 ChatGPT/);
  assert.match(await counter.textContent(), /^6\s*token$/);
  assert.equal(await app.evaluate(() => globalThis.usageResetAttempts), 0);
  await page.waitForFunction(
    () =>
      document
        .querySelector('[aria-label="确认重置：本应用的本地用量统计"]')
        ?.getBoundingClientRect().width >= 111.5,
  );
  const armedReset = await confirmReset.boundingBox();
  assert.ok(Math.abs(beforeReset.y - armedReset.y) < 1);
  assert.ok(Math.abs(beforeReset.x + beforeReset.width - armedReset.x - armedReset.width) < 1);
  assert.equal(
    await confirmReset.evaluate((element) => getComputedStyle(element).fontSize),
    '14px',
  );
  await page.screenshot({});
  await page.keyboard.press('Escape');
  await reset.waitFor();
  assert.equal(await page.getByRole('dialog', { name: '设置', exact: true }).isVisible(), true);
  await reset.click();
  await usage.getByRole('button', { name: '刷新用量', exact: true }).focus();
  await reset.waitFor();
  await reset.click();
  await reset.waitFor({ timeout: 5000 });
  assert.equal(await app.evaluate(() => globalThis.usageResetAttempts), 0);
  await reset.click();
  await page.getByRole('button', { name: '关于', exact: true }).click();
  await page.getByRole('button', { name: '账户与用量', exact: true }).click();
  await reset.waitFor();
  assert.equal(await confirmReset.count(), 0);
  await app.evaluate(() => {
    globalThis.rejectUsageReset = true;
  });
  await reset.click();
  await confirmReset.click();
  await usage.getByRole('alert').filter({ hasText: '合成用量重置失败' }).waitFor();
  await reset.waitFor();
  assert.match(await counter.textContent(), /^6\s*token$/);
  assert.equal(await app.evaluate(() => globalThis.usageResetAttempts), 1);
  await app.evaluate(() => {
    globalThis.rejectUsageReset = false;
    globalThis.holdUsageReset = true;
  });
  await reset.click();
  await confirmReset.click();
  await page.waitForFunction(
    () =>
      document
        .querySelector('[aria-label="确认重置：本应用的本地用量统计"]')
        ?.getAttribute('aria-busy') === 'true',
  );
  assert.equal(await confirmReset.isDisabled(), true);
  await confirmReset.evaluate((element) => {
    element.click();
    element.click();
  });
  assert.equal(await app.evaluate(() => globalThis.usageResetAttempts), 2);
  assert.match(await counter.textContent(), /^6\s*token$/);
  await app.evaluate(() => {
    globalThis.releaseUsageReset();
  });
  await reset.waitFor();
  assert.equal(await reset.isEnabled(), true);
  assert.equal(await usage.getByRole('alert').count(), 0);
  assert.equal(await usage.getByRole('status').count(), 0);
  assert.equal(await usage.getByText('已完成', { exact: true }).count(), 0);
  await page.getByRole('button', { name: '刷新用量', exact: true }).click();
  await page
    .locator('.usage-panel > strong')
    .filter({ hasText: /^0\s*token$/ })
    .waitFor();
  await page.screenshot({});
  await page.getByRole('button', { name: '关闭设置', exact: true }).click();
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
  await proposals.first().getByText('选择要保存的资料', { exact: true }).first().waitFor();
  await page.locator('.chat-answer').getByText('已整理资料', { exact: true }).waitFor();
  assert.equal(
    await page.evaluate(() => JSON.parse(localStorage.getItem('copilot-personal-info-v1')).name),
    '旧姓名',
  );
  await proposals.first().getByRole('button', { name: '保留原资料', exact: true }).click();
  assert.equal(
    await page.evaluate(() => JSON.parse(localStorage.getItem('copilot-personal-info-v1')).name),
    '旧姓名',
  );
  await page.getByRole('textbox', { name: '聊天消息', exact: true }).fill('更新个人信息');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await proposals.last().getByRole('button', { name: '保存所选', exact: true }).waitFor();
  await page.screenshot({});
  await page.getByRole('button', { name: '用户菜单', exact: true }).click();
  await page.getByRole('menuitem', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: '外观主题', exact: true }).click();
  await page.getByRole('menuitemradio', { name: '深色', exact: true }).click();
  await page.getByRole('button', { name: '账户与用量', exact: true }).click();
  await page.getByRole('button', { name: '重置用量', exact: true }).click();
  await confirmReset.waitFor();
  assert.equal(
    await confirmReset.evaluate((element) => getComputedStyle(element).fontSize),
    '14px',
  );
  await page.screenshot({});
  await page.keyboard.press('Escape');
  await reset.waitFor();
  assert.equal(await app.evaluate(() => globalThis.usageResetAttempts), 2);
  await page.getByRole('button', { name: '关闭设置', exact: true }).click();
  await page.screenshot({});
  await page.getByRole('button', { name: '个人信息', exact: true }).click();
  assert.equal(await page.getByLabel('姓名', { exact: true }).inputValue(), '旧姓名');
  await proposals.last().getByRole('button', { name: '保存所选', exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector('input[placeholder="你的名字"]')?.value === '新姓名',
  );
  assert.equal(await page.getByLabel('姓名', { exact: true }).inputValue(), '新姓名');
  await page.getByRole('button', { name: '关闭个人信息', exact: true }).click();
  await proposals.last().getByText('已保存所选资料', { exact: true }).waitFor();
  assert.deepEqual(
    await page.evaluate(() => JSON.parse(localStorage.getItem('copilot-personal-info-v1'))),
    { name: '新姓名', role: '原岗位', jobDescription: '新的 JD', background: '已有经历' },
  );
  await page.screenshot({});
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
  const panel = page.getByRole('complementary', { name: '个人信息', exact: true });
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .every(
        (animation) =>
          animation.effect?.getTiming().iterations === Infinity ||
          animation.playState !== 'running',
      ),
  );
  const geometry = await panel
    .locator('.profile-section-actions')
    .first()
    .evaluate((element) => {
      const buttons = [...element.querySelectorAll('button')].map((e) => {
        const rect = e.getBoundingClientRect();
        return {
          label: e.getAttribute('aria-label') || e.textContent,
          y: rect.y,
          height: rect.height,
        };
      });
      return {
        buttons,
        offset: Math.abs(
          buttons[0].y + buttons[0].height / 2 - buttons[1].y - buttons[1].height / 2,
        ),
      };
    });
  assert.ok(geometry.offset < 1, JSON.stringify(geometry));
  await page.screenshot({});
  await page.getByRole('button', { name: '个人信息', exact: true }).click();
  await page.getByRole('textbox', { name: '聊天消息', exact: true }).fill('状态测试');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  for (const label of ['正在思考', '正在联网搜索', '正在查询网页', '正在生成回答']) {
    await page.locator('.progress-state-label.is-active').filter({ hasText: label }).waitFor();
    if (label === '正在查询网页') {
      await page
        .locator('.chat-message.assistant')
        .last()
        .locator('.response-steps')
        .getByText('example.com/docs', { exact: false })
        .waitFor();
      await page.screenshot({});
    }
  }
  assert.equal(await page.getByText('正在等待服务响应', { exact: true }).count(), 0);
  await page.locator('.progress-state-label.is-active').waitFor({ state: 'detached' });
  await page.getByText('状态演示已完成', { exact: true }).waitFor();
  await page.reload();
  await page.getByRole('button', { name: '个人信息', exact: true }).click();
  assert.equal(await page.getByLabel('姓名', { exact: true }).inputValue(), '新姓名');
  const jd = page.locator('details[aria-label="职位描述摘要"]');
  await jd.locator(':scope > summary').click();
  await jd.getByText('新的 JD', { exact: true }).waitFor();
  assert.equal(await page.locator('.composer-caption').count(), 0);
  assert.ok((await page.locator('.effort-trigger').textContent()).includes('思考强度'));

  console.log(
    'PASS: compact tools, Markdown/code copy, effort, same-button usage reset/cancellation/failure retry/single-flight and light/dark typography, failure state, attachment proposal, reject/confirm. Test transport only; no production account used.',
  );
} catch (error) {
  const current = app.windows().at(-1);
  if (current && !current.isClosed()) {
    await current.screenshot({});
    console.log((await current.locator('body').innerText()).slice(-2500));
  }
  throw error;
} finally {
  await closeUiApp(app);
}
