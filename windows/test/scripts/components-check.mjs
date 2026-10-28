import { connectUiAccount } from '../../../shared/test/scripts/install-ui-account.mjs';
import { waitForAsync } from '../../../shared/test/scripts/wait-for-async.mjs';
import assert from 'node:assert/strict';
import { installUiAccount } from '../../../shared/test/scripts/install-ui-account.mjs';
import {
  assertDownloadButton,
  assertInitialDownloadProgress,
} from '../../../shared/test/scripts/assert-download-button.mjs';
// Called only against an isolated installed application. Fixed production assets and checksums remain real.
export async function checkComponents(application) {
  let page = await application.firstWindow();
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.getByRole('heading', { name: '登录 VoxCue', exact: true }).waitFor();
  assert.equal(await page.getByLabel('邮箱', { exact: true }).count(), 1);
  assert.equal(await page.getByLabel('密码', { exact: true }).count(), 1);
  await page.locator('.login-brand .app-logo').evaluate(async (image) => image.decode());
  assert.equal(
    await page.getByRole('button', { name: /使用 ChatGPT|使用 GitHub Copilot/ }).count(),
    0,
  );
  assert.equal(await page.evaluate(() => Object.hasOwn(window.desktop, 'signInWithCopilot')), true);
  await installUiAccount(application);
  await application.evaluate(({ app }) => {
    const require = process
      .getBuiltinModule('module')
      .createRequire(app.getAppPath() + '/package.json');
    const { ComponentService } = require(
      app.getAppPath() + '/dist-electron/shared/electron/backend/components/service.js',
    );
    globalThis.componentDiagnostics = [];
    const download = ComponentService.prototype.download;
    ComponentService.prototype.download = function (...args) {
      return (globalThis.componentDownload = download.apply(this, args));
    };
    for (const method of ['install', 'downloadArchive']) {
      const original = ComponentService.prototype[method];
      ComponentService.prototype[method] = async function (...args) {
        try {
          return await original.apply(this, args);
        } catch (error) {
          globalThis.componentDiagnostics.push({
            method,
            code: error.code,
            message: error.message,
          });
          throw error;
        }
      };
    }
  });
  await application.evaluate(({ session }) => {
    globalThis.componentRequests = [];
    globalThis.ragMode = 'cancel';
    const componentSession = session.fromPartition('voxcue-components');
    componentSession.webRequest.onBeforeRequest((details, callback) => {
      globalThis.componentRequests.push(details.url);
      callback({});
    });
    const fetch = componentSession.fetch.bind(componentSession);
    componentSession.fetch = async (url, options) => {
      const response = await fetch(url, options);
      if (!String(url).endsWith('/VoxCue-Models-RAG-1.0.0.zip') || !response.body) return response;
      // Pace real bytes so a fast CDN cannot finish before hover/theme checks.
      // Requests, headers, archive data and production checksum verification stay real.
      const reader = response.body.getReader();
      const mode = globalThis.ragMode;
      const until = Date.now() + (mode === 'corrupt' ? 0 : 8000);
      let first = true;
      return new Response(
        new ReadableStream({
          async pull(controller) {
            if (!first && Date.now() < until)
              await new Promise((resolve) => setTimeout(resolve, until - Date.now()));
            const mutate = first && mode === 'corrupt';
            first = false;
            const chunk = await reader.read();
            if (mutate && !chunk.done) {
              chunk.value = chunk.value.slice();
              chunk.value[0] ^= 1;
            }
            if (chunk.done) controller.close();
            else controller.enqueue(chunk.value);
          },
          cancel(reason) {
            return reader.cancel(reason);
          },
        }),
        { status: response.status, statusText: response.statusText, headers: response.headers },
      );
    };
  });
  const main = await connectUiAccount(application, page);
  page = main;
  page.setDefaultTimeout(15000);
  page.on('pageerror', (error) => errors.push(error.message));
  const start = page.getByRole('button', { name: '开始面试', exact: true });
  await start.waitFor();
  assert.equal(await start.isDisabled(), true);
  assert.deepEqual(await application.evaluate(() => globalThis.componentRequests), []);
  const notice = page.locator('.chat-column > .components-notice');
  await notice.getByText(/本地语音模型、知识库模型/).waitFor();
  await page.getByRole('textbox', { name: '聊天消息', exact: true }).fill('模型尚未下载时准备聊天');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await page
    .locator('.chat-answer')
    .getByText('Synthetic interview answer', { exact: true })
    .waitFor();
  assert.deepEqual(await application.evaluate(() => globalThis.componentRequests), []);
  const blockedImport = await page.evaluate(() =>
    window.desktop.knowledge({
      op: 'import',
      requestId: 'missing-model',
      documentId: 'missing-model',
      baseId: 'missing-model',
      name: 'fixture.md',
      bytes: new TextEncoder().encode('Synthetic fixture'),
    }),
  );
  assert.equal(blockedImport.ok, false);
  assert.match(blockedImport.error, /知识库模型/);
  assert.equal(await page.getByRole('button', { name: '下载', exact: true }).count(), 0);
  await notice.getByRole('button', { name: '前往设置' }).click();
  let settings = page.getByRole('dialog', { name: '设置', exact: true });
  await settings.getByRole('heading', { name: '本地组件', exact: true }).waitFor();
  assert.equal(await settings.locator('.component-row').count(), 3);
  const speechGroup = settings.getByRole('region', { name: '语音识别组件', exact: true });
  assert.equal(await speechGroup.locator('.component-row').count(), 2);
  for (const dark of [false, true]) {
    await page.evaluate((dark) => document.documentElement.classList.toggle('dark', dark), dark);
    assert.ok(
      await settings.locator('.components-panel').evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        return bounds.left >= 0 && bounds.right <= innerWidth && bounds.bottom <= innerHeight;
      }),
    );
    await page.screenshot(); // Buffer only, never written.
  }
  await settings.getByRole('button', { name: '关闭设置', exact: true }).click();
  const blocked = await page.evaluate(async () => {
    try {
      await window.desktop.openInterview({
        mode: 'local',
        options: { sources: ['system'] },
        aiEnabled: false,
        autoAnswer: true,
        modelId: '',
        effort: 'auto',
      });
      return false;
    } catch (error) {
      return String(error).includes('本地语音模型');
    }
  });
  assert.equal(blocked, true);
  await page.getByRole('button', { name: '知识库', exact: true }).click();
  for (const button of await page.getByRole('button', { name: '创建知识库', exact: false }).all())
    assert.equal(await button.isDisabled(), true);
  await page
    .locator('.management-container > .components-notice')
    .getByRole('button', { name: '前往设置' })
    .click();
  await settings.getByRole('heading', { name: '本地组件', exact: true }).waitFor();
  await settings.getByRole('button', { name: '关闭设置', exact: true }).click();
  await page.getByRole('button', { name: '新对话', exact: true }).click();
  await page.getByRole('button', { name: '个人信息', exact: true }).click();
  const personal = page.getByRole('complementary', { name: '个人信息', exact: true });
  const knowledgeSection = personal.locator('details[aria-label="面试知识库"]');
  assert.equal(await knowledgeSection.getAttribute('open'), null);
  await knowledgeSection.locator('summary').click();
  assert.equal(
    await personal.getByRole('button', { name: '面试知识库', exact: true }).isDisabled(),
    true,
  );
  await personal.locator('.components-notice').getByRole('button', { name: '前往设置' }).click();
  await settings.getByRole('heading', { name: '本地组件', exact: true }).waitFor();
  const rag = settings.locator('.component-row[data-component-id="rag"]');
  const speech = settings.locator('.component-row[data-component-id="speech"]');
  await assertInitialDownloadProgress(rag.locator('.download-button'), () =>
    rag.getByRole('button', { name: '下载', exact: true }).click(),
  );
  assert.equal(await speech.getByRole('button', { name: '下载', exact: true }).isDisabled(), true);
  await rag.locator('.download-button').click();
  await waitForAsync(
    page,
    async () => (await window.desktop.components({ op: 'status' })).phase === 'cancelled',
  );
  const cacheEntries = () =>
    application.evaluate(({ app }) => {
      const fs = process.getBuiltinModule('fs'),
        path = process.getBuiltinModule('path');
      return fs.readdirSync(path.join(app.getPath('userData'), 'component-cache'));
    });
  assert.deepEqual(
    await cacheEntries(),
    [],
    JSON.stringify(await application.evaluate(() => globalThis.componentDiagnostics)),
  );
  await application.evaluate(() => {
    globalThis.ragMode = 'corrupt';
  });
  await rag.getByRole('button', { name: '下载', exact: true }).click();
  await waitForAsync(
    page,
    async () => (await window.desktop.components({ op: 'status' })).phase === 'error',
    undefined,
    { timeout: 180000 },
  );
  const rejected = await application.evaluate(() => globalThis.componentDownload);
  assert.equal(rejected.phase, 'error');
  assert.ok(
    (await application.evaluate(() => globalThis.componentDiagnostics)).some(
      (item) => item.method === 'downloadArchive' && item.message === 'Download checksum mismatch',
    ),
  );
  assert.deepEqual(
    await cacheEntries(),
    [],
    JSON.stringify(await application.evaluate(() => globalThis.componentDiagnostics)),
  );
  await settings.getByText(/组件下载或校验失败/).waitFor();
  await application.evaluate(() => {
    globalThis.ragMode = 'real';
  });
  await rag.getByRole('button', { name: '下载', exact: true }).click();
  await assertDownloadButton(page, rag.locator('.download-button'));
  await waitForAsync(
    page,
    async () =>
      (await window.desktop.components({ op: 'status' })).items.find((item) => item.id === 'rag')
        .phase === 'ready',
    undefined,
    { timeout: 180000 },
  );
  await rag.getByRole('button', { name: '删除：知识库检索', exact: true }).waitFor();
  assert.equal(await rag.getByText('已就绪', { exact: true }).count(), 0);
  assert.match(await rag.innerText(), /85\.0 MB/);
  assert.doesNotMatch(await settings.innerText(), /MiB/);
  await settings.getByRole('button', { name: '关闭设置', exact: true }).click();
  await page.waitForFunction(
    () => !document.querySelector('[aria-label="面试知识库"].choice-trigger')?.disabled,
  );
  assert.equal(
    await personal.getByRole('button', { name: '面试知识库', exact: true }).isEnabled(),
    true,
  );
  await page.getByRole('button', { name: '个人信息', exact: true }).click();
  await personal.waitFor({ state: 'hidden' });
  await notice.getByRole('button', { name: '前往设置' }).click();
  await speech.getByRole('button', { name: '下载', exact: true }).click();
  await waitForAsync(
    page,
    async () => (await window.desktop.components({ op: 'status' })).phase === 'ready',
    undefined,
    { timeout: 180000 },
  );
  await speech.getByRole('button', { name: '删除：轻量语音识别', exact: true }).waitFor();
  assert.equal(await speech.getByText('已就绪', { exact: true }).count(), 0);
  await settings.getByRole('button', { name: '关闭设置', exact: true }).click();
  assert.equal(await start.isEnabled(), true);
  assert.equal(await notice.count(), 0);
  await page.getByRole('button', { name: '知识库', exact: true }).click();
  assert.equal(
    await page.getByRole('button', { name: '创建知识库', exact: false }).first().isEnabled(),
    true,
  );
  const state = await page.evaluate(() => window.desktop.components({ op: 'status' }));
  assert.equal(state.phase, 'ready');
  assert.ok(state.items.every((item) => item.optional || item.phase === 'ready'));
  const requests = await application.evaluate(() => globalThis.componentRequests);
  for (const name of ['VoxCue-Models-Speech-1.0.0.zip', 'VoxCue-Models-RAG-1.0.0.zip'])
    assert.equal(
      requests.filter(
        (url) =>
          url.startsWith('https://github.com/NCFXZ/VoxCue-releases/releases/download/') &&
          url.endsWith('/' + name),
      ).length,
      name.includes('RAG') ? 3 : 1,
    );
  assert.ok(requests.every((url) => !url.includes('copilot')));
  console.log(
    'PASS: ChatGPT/Copilot login before downloads; settings shortcuts, theme rings, MB and speech/RAG feature guards.',
  );
  return { page, errors };
}
