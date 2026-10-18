import { testRoot, electron } from '../../../shared/test/scripts/test-workspace.mjs';
import workspace from '../../../shared/scripts/workspace.mjs';
import { buildMacApp } from '../../scripts/package-app.mjs';
import { installUiAccount, closeUiApp } from '../../../shared/test/scripts/install-ui-account.mjs';
import { assertDownloadButton } from '../../../shared/test/scripts/assert-download-button.mjs';
import { readFile, mkdir, lstat, rename } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const require = workspace.platformRequire;
const asar = await import(require.resolve('@electron/asar'));
const { publicKey } = JSON.parse(
  await readFile(path.join(workspace.platformRoot, 'update-public-key.json'), 'utf8'),
);
const bundle = await buildMacApp(path.join(testRoot, 'bundle'), publicKey);
const resources = path.join(bundle, 'Contents/Resources');
const entries = asar.listPackage(path.join(resources, 'app.asar'));
assert.ok(
  !entries.some((name) =>
    /node_modules\/(?:onnxruntime-web(?:\/|$)|@github\/copilot-sdk(?:\/|-))/.test(name),
  ),
);
assert.ok(!entries.some((name) => name.includes('/backend/copilot/')));
assert.ok(entries.some((name) => name.includes('/onnxruntime-node/')));
assert.ok(entries.some((name) => name.includes('/adm-zip/')));
assert.equal(await lstat(path.join(resources, 'models')).catch(() => null), null);
assert.equal(
  JSON.parse(await readFile(path.join(resources, 'voxcue-components.json'), 'utf8')).schemaVersion,
  1,
);
console.log(
  'PASS: temporary signed Mac application contains Node CPU dependencies and excludes models, removed SDK and ONNX Web.',
);
const profile = path.join(testRoot, 'profile');
let activeBundle = bundle;
for (const directory of ['profile', 'tmp', 'home'])
  await mkdir(path.join(testRoot, directory), { recursive: true });
const launch = () =>
  electron.launch({
    executablePath: path.join(activeBundle, 'Contents/MacOS/VoxCue'),
    args: [],
    env: {
      ...process.env,
      COPILOT_TEST_USER_DATA: profile,
      VITE_DEV_SERVER_URL: '',
      HOME: path.join(testRoot, 'home'),
      CFFIXED_USER_HOME: path.join(testRoot, 'home'),
      TMPDIR: path.join(testRoot, 'tmp'),
    },
  });
let application = await launch();
try {
  let page = await application.firstWindow();
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.getByRole('heading', { name: '欢迎使用 VoxCue' }).waitFor();
  assert.equal(await page.locator('.service-login').count(), 1);
  assert.equal(await page.getByRole('button', { name: /GitHub/ }).count(), 0);
  assert.equal(
    await page.evaluate(() => Object.hasOwn(window.desktop, 'signInWithCopilot')),
    false,
  );
  await installUiAccount(application);
  await application.evaluate(({ session }) => {
    globalThis.componentRequests = [];
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
      const until = Date.now() + 5000;
      let first = true;
      return new Response(
        new ReadableStream({
          async pull(controller) {
            if (!first && Date.now() < until)
              await new Promise((resolve) => setTimeout(resolve, until - Date.now()));
            first = false;
            const chunk = await reader.read();
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
  const [main] = await Promise.all([
    application.waitForEvent('window'),
    page.getByRole('button', { name: '使用 ChatGPT 继续', exact: true }).click(),
  ]);
  page = main;
  page.setDefaultTimeout(15000);
  page.on('pageerror', (error) => errors.push(error.message));
  const start = page.getByRole('button', { name: '开始面试', exact: true });
  await start.waitFor();
  assert.equal(await start.isDisabled(), true);
  assert.deepEqual(await application.evaluate(() => globalThis.componentRequests), []);
  const notice = page.locator('.chat-column > .components-notice');
  await notice.getByText(/本地语音模型、知识库模型/).waitFor();
  assert.equal(await page.getByRole('button', { name: '下载', exact: true }).count(), 0);
  await notice.getByRole('button', { name: '前往设置' }).click();
  let settings = page.getByRole('dialog', { name: '设置', exact: true });
  await settings.getByRole('heading', { name: '本地组件', exact: true }).waitFor();
  assert.equal(await settings.locator('.component-row').count(), 2);
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
      await window.desktop.openInterview({});
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
  const personal = page.getByRole('complementary', { name: '个人信息' });
  assert.equal(
    await personal.getByRole('button', { name: '面试知识库', exact: true }).isDisabled(),
    true,
  );
  await personal.locator('.components-notice').getByRole('button', { name: '前往设置' }).click();
  await settings.getByRole('heading', { name: '本地组件', exact: true }).waitFor();
  const rag = settings.locator('.component-row').filter({ hasText: '知识库模型' });
  await rag.getByRole('button', { name: '下载', exact: true }).click();
  await assertDownloadButton(page, rag.locator('.download-button'));
  await page.waitForFunction(
    async () =>
      (await window.desktop.components({ op: 'status' })).items.find((item) => item.id === 'rag')
        .phase === 'ready',
    undefined,
    { timeout: 180000 },
  );
  await rag.getByText('已就绪', { exact: true }).waitFor();
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
  await page.getByRole('button', { name: '关闭个人信息' }).click();
  await notice.getByRole('button', { name: '前往设置' }).click();
  const speech = settings.locator('.component-row').filter({ hasText: '本地语音模型' });
  await speech.getByRole('button', { name: '下载', exact: true }).click();
  await page.waitForFunction(
    async () => (await window.desktop.components({ op: 'status' })).phase === 'ready',
    undefined,
    { timeout: 180000 },
  );
  await speech.getByText('已就绪', { exact: true }).waitFor();
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
  assert.ok(state.items.every((item) => item.phase === 'ready'));
  const requests = await application.evaluate(() => globalThis.componentRequests);
  for (const name of ['VoxCue-Models-Speech-1.0.0.zip', 'VoxCue-Models-RAG-1.0.0.zip'])
    assert.equal(
      requests.filter(
        (url) =>
          url.startsWith('https://github.com/NCFXZ/VoxCue-releases/releases/download/') &&
          url.endsWith('/' + name),
      ).length,
      1,
    );
  assert.ok(requests.every((url) => !url.includes('copilot')));
  console.log(
    'PASS: ChatGPT-only login before downloads; settings shortcuts, theme rings, MB and speech/RAG feature guards.',
  );
  const searches = await page.evaluate(async () => {
    const indexed = await window.desktop.knowledge({
      op: 'import',
      requestId: 'index-probe',
      documentId: 'fixture',
      baseId: 'fixture',
      name: 'fixture.md',
      bytes: new TextEncoder().encode(
        '## Q001. PID control\n\nPID feedback controls sensor lift-off and output is limited to 2.',
      ),
    });
    if (!indexed.ok) throw Error(indexed.error);
    const counts = [];
    for (const mode of ['keyword', 'vector', 'hybrid']) {
      const result = await window.desktop.knowledge({
        op: 'search',
        requestId: 'search-' + mode,
        query: 'PID sensor control',
        topK: 3,
        mode,
        baseId: 'fixture',
      });
      if (!result.ok || !Array.isArray(result.value)) throw Error('Synthetic RAG search failed');
      counts.push(result.value.length);
    }
    return counts;
  });
  assert.ok(searches.every((count) => count > 0));
  await application.evaluate(async ({ app }) => {
    const require = process
      .getBuiltinModule('module')
      .createRequire(app.getAppPath() + '/package.json');
    const path = require('node:path');
    const { componentPaths } = require(
      app.getAppPath() + '/dist-electron/shared/electron/backend/components/service.js',
    );
    const { packagesFor } = require(
      app.getAppPath() + '/dist-electron/shared/electron/backend/components/catalog.js',
    );
    const models = componentPaths(
      path.join(app.getPath('userData'), 'component-cache'),
      packagesFor(process.platform, process.arch),
    );
    const { Worker } = require('node:worker_threads');
    const worker = new Worker(
      path.join(
        app.getAppPath().replace(/app\.asar$/, 'app.asar.unpacked'),
        'dist-electron/shared/electron/backend/speech/worker.js',
      ),
    );
    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(Error('Cached ASR initialization timeout')), 45000);
        worker.once('error', (error) => {
          clearTimeout(timer);
          reject(error);
        });
        worker.on('message', (message) => {
          if (message.error) {
            clearTimeout(timer);
            reject(Error(message.error));
          } else if (message.ready)
            worker.postMessage({
              op: 'audio',
              source: 'system',
              samples: new Float32Array(16000),
              rate: 16000,
              timestamp: Date.now(),
              sequence: 1,
              ms: 1000,
            });
          else if (message.ack === 1)
            worker.postMessage({ op: 'flush', reason: 'stop', id: 'probe' });
          else if (message.flushed === 'probe') {
            clearTimeout(timer);
            resolve();
          }
        });
        worker.postMessage({ op: 'init', directory: models.speechModels });
      });
    } finally {
      await worker.terminate();
    }
  });
  assert.deepEqual(errors, []);
  console.log(
    'PASS: downloaded cache drives real offline E5/LanceDB searches and Paraformer Worker synthetic silence.',
  );
  await closeUiApp(application);
  await mkdir(path.join(testRoot, 'upgraded'));
  activeBundle = path.join(testRoot, 'upgraded/VoxCue.app');
  await rename(bundle, activeBundle);
  application = await launch();
  await application.evaluate(({ session }) => {
    globalThis.componentRequests = [];
    session.fromPartition('voxcue-components').webRequest.onBeforeRequest((details, callback) => {
      globalThis.componentRequests.push(details.url);
      callback({ cancel: true });
    });
  });
  page = await application.firstWindow();
  await page.waitForFunction(
    async () => (await window.desktop.components({ op: 'status' })).phase === 'ready',
    undefined,
    { timeout: 30000 },
  );
  assert.deepEqual(await application.evaluate(() => globalThis.componentRequests), []);
  console.log(
    'PASS: replacement/relocation and offline restart reuse the verified model cache without requests.',
  );
} finally {
  await closeUiApp(application).catch(() => application.close());
}
console.log(
  'Temporary application, profile, downloaded components and screenshots are not retained.',
);
