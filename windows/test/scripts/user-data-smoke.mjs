import { connectUiAccount } from '../../../shared/test/scripts/install-ui-account.mjs';
import { testRoot, electron } from '../../../shared/test/scripts/test-workspace.mjs';
import workspace from '../../../shared/scripts/workspace.mjs';
import { closeUiApp, installUiAccount } from '../../../shared/test/scripts/install-ui-account.mjs';
import { mkdir, writeFile, readFile, lstat } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const appData = path.join(testRoot, 'application-data');
const legacy = path.join(appData, 'ai-interview-copilot');
const destination = path.join(appData, 'VoxCue');
const bootstrap = path.join(testRoot, 'migration-bootstrap');
await mkdir(legacy, { recursive: true });
await mkdir(bootstrap);
const baseline = path.join(testRoot, 'baseline.cjs');
const next = path.join(testRoot, 'next.cjs');
const entry = path.join(workspace.platformRoot, 'dist-electron/shared/electron/main.js');
const storage = path.join(
  workspace.platformRoot,
  'dist-electron/shared/electron/backend/auth/storage.js',
);
const chat = path.join(
  workspace.platformRoot,
  'dist-electron/shared/electron/backend/chat/service.js',
);
await writeFile(
  baseline,
  `
const {app,BrowserWindow}=require('electron');
app.setAppPath(${JSON.stringify(workspace.platformRoot)});
app.setName('VoxCue');
app.setPath('userData',${JSON.stringify(legacy)});
app.setPath('sessionData',${JSON.stringify(legacy)});
app.whenReady().then(()=>{
 const window=new BrowserWindow({width:960,height:700,webPreferences:{contextIsolation:true,sandbox:true}});
 window.loadFile(${JSON.stringify(path.join(workspace.platformRoot, 'dist/index.html'))});
});
app.on('window-all-closed',()=>app.quit());
`,
);
await writeFile(
  next,
  `
const {app}=require('electron');
app.setAppPath(${JSON.stringify(workspace.platformRoot)});
const getPath=app.getPath.bind(app);
app.getPath=name=>name==='appData'?${JSON.stringify(appData)}:getPath(name);
app.setPath('userData',${JSON.stringify(bootstrap)});
app.setPath('sessionData',${JSON.stringify(bootstrap)});
// Keep every pre-import path owned, then remove the launcher's override so main
// exercises the production migration rather than selecting an empty test profile.
delete process.env.COPILOT_TEST_USER_DATA;
// Only the catalog transport is synthetic; encrypted storage/auth session are unchanged.
const {ChatGPTService}=require(${JSON.stringify(chat)});
ChatGPTService.prototype.models=async()=>[{id:'fixture-model',label:'Fixture',description:'',provider:{id:'chatgpt',name:'ChatGPT',dataRecipient:'OpenAI'},reasoningEfforts:['low']}];
ChatGPTService.prototype.usage=async()=>({requests:0,inputTokens:0,outputTokens:0,totalTokens:0,updatedAt:null});
require(${JSON.stringify(entry)});
`,
);
const env = { ...process.env, VITE_DEV_SERVER_URL: '' };
delete env.COPILOT_TEST_USER_DATA;
delete env.ELECTRON_RUN_AS_NODE;
const launch = (fixture) => electron.launch({ args: [fixture], env });
async function assertMigrationEntry(app) {
  assert.deepEqual(
    await app.evaluate(({ app }) => ({
      fixtureEnabled: !!process.env.COPILOT_TEST_USER_DATA,
      appData: app.getPath('appData'),
      userData: app.getPath('userData'),
      sessionData: app.getPath('sessionData'),
    })),
    { fixtureEnabled: false, appData, userData: destination, sessionData: destination },
  );
}
let app;
try {
  app = await launch(baseline);
  let page = await app.firstWindow();
  await page.waitForLoadState();
  await page.evaluate(async () => {
    localStorage.setItem('copilot-theme', 'dark');
    localStorage.setItem(
      'copilot-personal-info-v1',
      JSON.stringify({
        name: 'Migration user',
        background: 'Synthetic resume',
        jobDescription: 'Synthetic role',
      }),
    );
    localStorage.setItem('copilot-interview-knowledge-base-v1', JSON.stringify('migration-base'));
    localStorage.setItem('migration-history-fixture', 'history-is-preserved');
    const open = (name, upgrade) =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open(name, 1);
        request.onupgradeneeded = () => upgrade(request.result);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    const commit = (tx) =>
      new Promise((resolve, reject) => {
        tx.oncomplete = resolve;
        tx.onerror = tx.onabort = () => reject(tx.error);
      });
    const chats = await open('voxcue-preparation-chats', (db) => {
      db.createObjectStore('state');
      db.createObjectStore('files', { keyPath: 'id' });
    });
    const tx = chats.transaction(['state', 'files'], 'readwrite');
    const done = commit(tx);
    const blob = new Blob(['migration attachment'], { type: 'text/plain' });
    tx.objectStore('files').put({ id: 'migration-file', blob, lastModified: 1 });
    tx.objectStore('state').put(
      {
        version: 1,
        conversations: [
          {
            id: 'saved-conversation',
            title: '迁移对话',
            draft: '迁移前的合成草稿',
            attachments: [{ id: 'migration-file', name: 'migration.txt', size: blob.size }],
            messages: [
              {
                id: 'saved-answer',
                role: 'assistant',
                content: '迁移前的合成回答',
                status: 'completed',
              },
            ],
          },
        ],
        activeConversation: 'saved-conversation',
        draft: '迁移前的合成草稿',
        attachments: [{ id: 'migration-file', name: 'migration.txt', size: blob.size }],
        modelId: 'fixture-model',
        effort: 'auto',
        webSearch: false,
      },
      'current',
    );
    await done;
    chats.close();
    const knowledge = await open('copilot-local-documents', (db) => {
      db.createObjectStore('bases', { keyPath: 'id' });
      db.createObjectStore('documents', { keyPath: 'id' }).createIndex('baseId', 'baseId');
    });
    const documents = knowledge.transaction(['bases', 'documents'], 'readwrite');
    const committed = commit(documents);
    documents
      .objectStore('bases')
      .put({ id: 'migration-base', name: 'Migration knowledge', createdAt: 1 });
    documents.objectStore('documents').put({
      id: 'migration-original',
      baseId: 'migration-base',
      name: 'original.txt',
      size: 8,
      type: 'text/plain',
      createdAt: 1,
      blob: new Blob(['original']),
    });
    await committed;
    knowledge.close();
  });
  const hostId = await app.evaluate(async ({ app }, module) => {
    const require = process
      .getBuiltinModule('module')
      .createRequire(app.getAppPath() + '/package.json');
    const { createAuthStorage } = require(module);
    const storage = createAuthStorage();
    const hostId = await storage.hostId();
    await storage.write({
      version: 1,
      hostId,
      clientId: 'oaiapp_migration_fixture',
      subject: 'migration-user',
      name: 'Migration user',
      email: '',
      expiresAt: Date.now() + 3600000,
      idToken: 'SYNTHETIC_DO_NOT_USE',
    });
    return hostId;
  }, storage);
  await app.close();
  app = undefined;
  const originalCipher = await readFile(path.join(legacy, 'auth-data/credentials.bin'));
  for (const directory of ['component-cache/migration-fixture', 'knowledge-v1', 'chat-usage']) {
    await mkdir(path.join(legacy, directory), { recursive: true });
    await writeFile(
      path.join(legacy, directory, 'migration-sentinel.bin'),
      Buffer.from([0, 255, 128, 7]),
    );
  }
  app = await launch(next);
  await assertMigrationEntry(app);
  page = await app.firstWindow();
  await page.getByRole('heading', { name: '登录 VoxCue', exact: true }).waitFor();
  assert.equal(
    await page.evaluate(() => window.desktop.authSession()),
    null,
    'Legacy SIWC credentials require the current managed login',
  );
  await installUiAccount(app);
  page = await connectUiAccount(app, page);
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.getByRole('textbox', { name: '聊天消息', exact: true }).waitFor();
  await page.waitForFunction(
    () => document.querySelector('[aria-label="聊天消息"]')?.value === '迁移前的合成草稿',
  );
  await page.locator('.chat-answer').getByText('迁移前的合成回答', { exact: true }).waitFor();
  await page.locator('.chat-attachment').getByText('migration.txt', { exact: false }).waitFor();
  assert.equal(
    await page.evaluate(() => document.documentElement.classList.contains('dark')),
    true,
  );
  assert.equal(
    await page.evaluate(() => localStorage.getItem('migration-history-fixture')),
    'history-is-preserved',
  );
  assert.equal(
    (await page.evaluate(() => window.desktop.authSession())).user.id,
    'synthetic-account',
  );
  assert.deepEqual(
    await app.evaluate(({ app }) => [app.getPath('userData'), app.getPath('sessionData')]),
    [destination, destination],
  );
  assert.equal(await lstat(legacy).catch(() => null), null);
  assert.deepEqual(
    await readFile(path.join(destination, 'auth-data/credentials.bin')),
    originalCipher,
  );
  assert.equal(await readFile(path.join(destination, 'auth-data/host-id'), 'utf8'), hostId);
  const stored = await page.evaluate(async () => {
    const open = (name) =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open(name, 1);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    const read = (db, store, key) =>
      new Promise((resolve, reject) => {
        const r = db.transaction(store).objectStore(store).get(key);
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
    const chats = await open('voxcue-preparation-chats');
    const attachment = await read(chats, 'files', 'migration-file');
    chats.close();
    const knowledge = await open('copilot-local-documents');
    const original = await read(knowledge, 'documents', 'migration-original');
    knowledge.close();
    return { attachment: await attachment.blob.text(), original: await original.blob.text() };
  });
  assert.deepEqual(stored, { attachment: 'migration attachment', original: 'original' });
  for (const directory of ['component-cache/migration-fixture', 'knowledge-v1', 'chat-usage'])
    assert.deepEqual(
      await readFile(path.join(destination, directory, 'migration-sentinel.bin')),
      Buffer.from([0, 255, 128, 7]),
    );
  assert.deepEqual(errors, []);
  console.log(
    'PASS: real Chromium profile, chat/attachment/knowledge blobs, theme, encrypted login, host identity and model/index files survive migration; legacy path is absent.',
  );
  await closeUiApp(app);
  app = undefined;
  app = await launch(next);
  await assertMigrationEntry(app);
  page = await app.firstWindow();
  await installUiAccount(app);
  page = await connectUiAccount(app, page);
  await page.getByRole('textbox', { name: '聊天消息', exact: true }).waitFor();
  await page.waitForFunction(
    () => document.querySelector('[aria-label="聊天消息"]')?.value === '迁移前的合成草稿',
  );
  assert.equal(
    (await page.evaluate(() => window.desktop.authSession())).user.id,
    'synthetic-account',
  );
  assert.equal(await lstat(legacy).catch(() => null), null);
  console.log(
    'PASS: repeated launch reuses VoxCue with no recreated legacy directory or repeat migration.',
  );
} finally {
  if (app) await closeUiApp(app).catch(() => app.close());
}
console.log(
  'Migration fixtures, encrypted synthetic records, database/profile and snapshots are not retained.',
);
