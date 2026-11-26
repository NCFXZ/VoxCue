import { evaluateHistory } from './stored-history-fixture.mjs';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import workspace from '../../scripts/workspace.mjs';
import { testRoot, electron } from './test-workspace.mjs';
import { offlineElectronEntry } from './offline-electron-entry.mjs';
import { closeUiApp } from './install-ui-account.mjs';
import { readStoredChatFixture } from './stored-chat-fixture.mjs';

const profile = path.join(testRoot, 'legacy-upgrade-device');
const backend = path.join(workspace.platformRoot, 'dist-electron/shared/electron');
const indexFile = path.join(workspace.platformRoot, 'dist/index.html');
const users = ['a', 'b'].map((name) => ({
  id: randomUUID(),
  email: name + '@example.test',
  createdAt: 1,
}));
const selected = path.join(profile, 'synthetic-upgrade-session.json');
const shell = path.join(testRoot, 'legacy-upgrade.cjs');
const picture = randomUUID();
const accountOrigin = 'https://account-fixture.example.test';
const png =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgaDgAAAHEAUFzHAXEAAAAAElFTkSuQmCC';
let app;
let phase = 'seed browser storage', nativeErrors = '', bodyFailure;

function observeShutdown({ app, ipcMain }) {
  const events = globalThis.upgradeShutdown = { phase: 'launch', events: [] };
  const record = (kind, details = {}) => {
    const entry = { phase: events.phase, kind, ...details };
    events.events.push(entry);
    if (events.events.length > 80) events.events.shift();
    console.error('SYNTHETIC_UPGRADE_SHUTDOWN ' + JSON.stringify(entry));
  };
  app.on('browser-window-created', (_event, win) => {
    const contents = win.webContents, id = win.id;
    win.on('close', event => queueMicrotask(() => record('window-close', {
      id, prevented: event.defaultPrevented, destroyed: win.isDestroyed(),
    })));
    win.on('closed', () => record('window-closed', { id }));
    contents.on('render-process-gone', (_event, details) => record('renderer-gone', {
      id, reason: details.reason, exitCode: details.exitCode,
    }));
    const send = contents.send;
    contents.send = function(channel, ...args) {
      if (channel === 'session:request-close') record('session-request-close', { id, request: args[0] });
      return send.call(this, channel, ...args);
    };
  });
  const handle = ipcMain.handle.bind(ipcMain);
  ipcMain.handle = (channel, listener) => handle(channel, channel !== 'session:close-ready' ? listener : (...args) => {
    record('session-close-ready', { contents: args[0].sender.id, request: args[1], saved: args[2] });
    return listener(...args);
  });
  for (const kind of ['before-quit', 'will-quit', 'quit', 'window-all-closed'])
    app.on(kind, () => record(kind));
}

async function launch(script) {
  await writeFile(shell, '(' + observeShutdown.toString() + ')(require("electron"));\n' + script);
  nativeErrors = '';
  app = await electron.launch({
    args: [await offlineElectronEntry(shell)],
    env: { ...process.env, COPILOT_TEST_USER_DATA: profile, VOXCUE_ACCOUNT_API: accountOrigin, VITE_DEV_SERVER_URL: '' },
  });
  app.process().stderr?.on('data', chunk => { nativeErrors = (nativeErrors + String(chunk)).slice(-16000); });
}
async function closeCurrentApp(stage) {
  const target = app;
  if (!target) return;
  phase = 'close: ' + stage;
  console.log('Legacy upgrade close:', phase, JSON.stringify(await target.evaluate(({ BrowserWindow }, phase) => {
    if (globalThis.upgradeShutdown) globalThis.upgradeShutdown.phase = phase;
    return {
      windows: BrowserWindow.getAllWindows().map(win => ({
        id: win.id, contents: win.webContents.id, role: new URL(win.webContents.getURL() || 'about:blank').hash || 'main',
        visible: win.isVisible(), crashed: win.webContents.isCrashed(), loading: win.webContents.isLoading(),
      })),
      events: globalThis.upgradeShutdown?.events,
    };
  }, phase).catch(error => ({ unavailable: error.message }))));
  try { await closeUiApp(target); }
  catch (error) {
    console.error('Legacy upgrade close failed:', phase, error, '\nNative shutdown events/errors:\n' + nativeErrors);
    throw error;
  }
  if (app === target) app = undefined;
}
async function pageFor(hash) {
  const end = Date.now() + 45000;
  while (Date.now() < end) {
    const found = app
      .windows()
      .find(
        (page) =>
          !page.isClosed() &&
          page.url().startsWith('file:') &&
          new URL(page.url()).pathname.endsWith('/index.html') &&
          new URL(page.url()).hash === hash,
      );
    if (found) return found;
    await delay(40);
  }
  throw Error('Expected upgrade test window ' + hash);
}
async function seedBrowser(page, legacy) {
  await page.evaluate(
    async ({ legacy, picture, userIds }) => {
      const name = legacy ? 'Legacy' : 'Existing';
      const attachment = { id: 'legacy-chat-attachment', name: 'legacy.txt', size: 6 };
      const record = {
        id: name,
        title: name,
        startedAt: 1,
        endedAt: 2,
        status: 'ended',
        transcripts: [],
        answers: legacy
          ? [{ id: 'answer', question: 'question', content: 'answer', images: [{ id: picture }] }]
          : [],
        mock: false,
      };
      localStorage.setItem('copilot-interview-history-v1', JSON.stringify([record]));
      if (legacy) {
        localStorage.setItem(
          'copilot-personal-info-v1',
          JSON.stringify({ name: 'Legacy profile', background: '', jobDescription: '' }),
        );
        localStorage.setItem('copilot-interview-input-mode-v1', 'transcription');
      }
      async function database(name, upgrade, write) {
        const req = indexedDB.open(name, 1);
        req.onupgradeneeded = () => upgrade(req.result);
        const db = await new Promise((ok, fail) => {
          req.onsuccess = () => ok(req.result);
          req.onerror = () => fail(req.error);
        });
        try {
          const tx = db.transaction([...db.objectStoreNames], 'readwrite');
          write(tx);
          await new Promise((ok, fail) => {
            tx.oncomplete = ok;
            tx.onabort = () => fail(tx.error);
          });
        } finally {
          db.close();
        }
      }
      await database(
        'voxcue-cloud-sync',
        (db) => db.createObjectStore('accounts'),
        (tx) => {
          const source = {
            preferences: {
              enabled: { profile: legacy, history: !legacy, knowledgebase: legacy },
              knowledgeLimitBytes: 64000000,
            },
            baselines: {},
          };
          tx.objectStore('accounts').put(source, userIds[0]);
          if (legacy) tx.objectStore('accounts').put(source, userIds[1]);
        },
      );
      if (legacy) localStorage.setItem('voxcue-sync-owner', userIds[0]);
      await database(
        'voxcue-preparation-chats',
        (db) => {
          db.createObjectStore('state');
          db.createObjectStore('files', { keyPath: 'id' });
        },
        (tx) => {
          const attachments = legacy ? [attachment] : [];
          const conversation = {
            id: name,
            title: name + ' chat',
            draft: name + ' draft',
            attachments,
            messages: [{ id: name + '-msg', role: 'user', content: name + ' message' }],
          };
          tx.objectStore('state').put(
            {
              version: 1,
              conversations: [conversation],
              activeConversation: name,
              draft: conversation.draft,
              attachments,
              modelId: '',
              effort: 'auto',
              webSearch: false,
            },
            'current',
          );
          if (legacy)
            tx.objectStore('files').put({
              id: attachment.id,
              blob: new Blob(['legacy'], { type: 'text/plain' }),
              lastModified: 1,
            });
        },
      );
      if (legacy)
        await database(
          'copilot-local-documents',
          (db) => {
            db.createObjectStore('bases', { keyPath: 'id' });
            db.createObjectStore('documents', { keyPath: 'id' }).createIndex('baseId', 'baseId');
          },
          (tx) => {
            tx.objectStore('bases').put({ id: 'library', name: 'Legacy library', createdAt: 1 });
            for (const [id, baseId] of [
              ['original', 'library'],
              ['cv', 'personal-resume'],
            ])
              tx.objectStore('documents').put({
                id,
                baseId,
                name: id + '.txt',
                createdAt: 1,
                type: 'text/plain',
                size: 6,
                blob: new Blob(['legacy']),
              });
          },
        );
    },
    { legacy, picture, userIds: users.map((user) => user.id) },
  );
}
function observeAccountSwitch(profiles, pages) {
  const events = globalThis.upgradeWindowOrder = [];
  const create = profiles.createAccountProfile;
  profiles.createAccountProfile = (...args) => {
    const profile = create(...args);
    const dispose = profile.dispose.bind(profile);
    profile.dispose = async (...args) => {
      await dispose(...args);
      events.push('retired');
    };
    return profile;
  };
  const load = pages.loadWindowPage;
  pages.loadWindowPage = (window, role, ...args) => {
    if (role === 'login') events.push('login');
    return load(window, role, ...args);
  };
}
function observeErasureWindows({ app }, files) {
  const order = globalThis.erasureWindowOrder = [];
  app.on('browser-window-created', (_event, win) => {
    win.webContents.on('did-finish-load', () => {
      const url = new URL(win.webContents.getURL());
      if (url.hash === '#legacy-upgrade-erase') order.push('legacy-erase');
      if (url.pathname.endsWith('/index.html') && !url.hash) order.push('main');
    });
  });
  app.on('window-all-closed', () => {
    order.push('window-all-closed');
    globalThis.pendingAtLastClose = files.map(file => process.getBuiltinModule('fs').existsSync(file));
  });
}
const normalLaunch = (erasureFiles) =>
  launch(
    [
      "const fs=require('node:fs');",
      erasureFiles ? '(' + observeErasureWindows.toString() + ')(require("electron"),' +
        JSON.stringify(erasureFiles) + ');' : '',
      'const users=' + JSON.stringify(users) + ', selected=' + JSON.stringify(selected) + ';',
      'const {CloudAccountClient}=require(' +
        JSON.stringify(path.join(backend, 'backend/cloud/client.js')) +
        ');',
      'const state=()=>({configured:true,user:fs.existsSync(selected)?users[JSON.parse(fs.readFileSync(selected))]:null,verified:fs.existsSync(selected)});',
      'CloudAccountClient.prototype.snapshot=state;',
      '(' + observeAccountSwitch.toString() + ')(require(' +
        JSON.stringify(path.join(backend, 'accountProfile.js')) + '),require(' +
        JSON.stringify(path.join(backend, 'window.js')) + '));',
      "CloudAccountClient.prototype.call=async function(call){if(call.action==='login'){const i=users.findIndex(user=>user.email===call.email);if(i<0||call.password!=='synthetic-password')throw Error('Unexpected account');fs.writeFileSync(selected,JSON.stringify(i));}else if(call.action==='logout')fs.rmSync(selected,{force:true});else if(call.action!=='status')throw Error('Unexpected fixture call '+call.action);return {ok:true,state:state()};};",
      'require(' + JSON.stringify(path.join(backend, 'main.js')) + ');',
    ].join('\n'),
  );

async function inspect(page) {
  await page.getByRole('navigation', { name: '主导航' }).waitFor();
  const chats = await page.evaluate(readStoredChatFixture);
  return evaluateHistory(page, async ({ picture, chats }) => {
    const request = async (database, store, key) => {
      if (!(await indexedDB.databases()).some((d) => d.name === database)) return;
      const open = indexedDB.open(database);
      const db = await new Promise((ok, fail) => {
        open.onsuccess = () => ok(open.result);
        open.onerror = () => fail(open.error);
      });
      try {
        const get = db.transaction(store).objectStore(store).get(key);
        return await new Promise((ok, fail) => {
          get.onsuccess = () => ok(get.result);
          get.onerror = () => fail(get.error);
        });
      } finally {
        db.close();
      }
    };
    const uploaded = await request('voxcue-preparation-chats', 'files', 'legacy-chat-attachment');
    const original = await request('copilot-local-documents', 'documents', 'original');
    const resume = await request('copilot-local-documents', 'documents', 'cv');
    return {
      profile: JSON.parse(localStorage.getItem('copilot-personal-info-v1'))?.name ?? null,
      records: (await fixtureHistory.read())
        .map((r) => r.id)
        .sort(),
      input: localStorage.getItem('copilot-interview-input-mode-v1'),
      chats: (chats?.conversations ?? [])
        .map((c) => [c.id, c.draft, c.messages[0]?.content])
        .sort(),
      attachment: (await uploaded?.blob?.text()) ?? null,
      original: (await original?.blob?.text()) ?? null,
      resume: (await resume?.blob?.text()) ?? null,
      image: (await window.desktop.interviewImage({ op: 'read', id: picture })).dataUrl ?? null,
      shortcut: (await window.desktop.shortcutSettings({ op: 'status' })).state.bindings[
        'toggle-window'
      ],
      autoDownload: (await window.desktop.updates({ op: 'status' })).autoDownload,
    };
  }, { picture, chats });
}
async function checkSyncSettings(page, values) {
  await page.getByRole('button', { name: '用户菜单', exact: true }).click();
  await page.getByRole('menuitem', { name: '设置', exact: true }).click();
  for (const [index, label] of ['同步个人信息', '同步面试记录', '同步知识库'].entries()) {
    const toggle = page.getByRole('switch', { name: label, exact: true });
    await toggle.waitFor();
    assert.equal(await toggle.getAttribute('aria-checked'), String(values[index]), label);
  }
  await page.getByRole('button', { name: '关闭设置', exact: true }).click();
}
async function switchUser(main, user) {
  await app.evaluate(() => { globalThis.upgradeWindowOrder.length = 0; });
  await main.getByRole('button', { name: '用户菜单', exact: true }).click();
  await main.getByRole('menuitem', { name: '退出登录', exact: true }).click();
  await main
    .getByRole('dialog', { name: '退出登录', exact: true })
    .getByRole('button', { name: '退出登录', exact: true })
    .click();
  const login = await pageFor('#login');
  assert.deepEqual(await app.evaluate(() => globalThis.upgradeWindowOrder), ['retired', 'login'],
    'The new login form must load only after the outgoing account has released its writers');
  await login.getByLabel('邮箱', { exact: true }).fill(user.email);
  await login.getByLabel('密码', { exact: true }).fill('synthetic-password');
  await login.getByRole('button', { name: '登录', exact: true }).click();
  try {
    return await pageFor('');
  } catch (error) {
    const alerts = !login.isClosed() ? await login.getByRole('alert').allTextContents() : [];
    throw new Error('Upgrade fixture login did not open the main window: ' + alerts.join(' '), { cause: error });
  }
}
try {
  await mkdir(profile);
  // This first process owns the synthetic default partition and creates no application migration marker.
  await launch(
    [
      "const {app,BrowserWindow}=require('electron');",
      'const {profilePartition}=require(' + JSON.stringify(path.join(backend, 'window.js')) + ');',
      'app.whenReady().then(async()=>{globalThis.seed=[];for(const owner of [null,' +
        JSON.stringify('account:' + users[0].id) +
        ']){',
      'const win=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,...(owner?{partition:profilePartition(owner)}:{})}});',
      'globalThis.seed.push(win);await win.loadFile(' +
        JSON.stringify(indexFile) +
        ",{hash:'profile-import-source'});}});",
    ].join('\n'),
  );
  await app.firstWindow();
  const end = Date.now() + 30000;
  while (
    app.windows().filter((p) => p.url().endsWith('#profile-import-source')).length !== 2 &&
    Date.now() < end
  )
    await delay(40);
  const pages = app.windows().filter((p) => p.url().endsWith('#profile-import-source'));
  assert.equal(pages.length, 2);
  await seedBrowser(pages[0], true);
  await seedBrowser(pages[1], false);
  await app.evaluate(({ BrowserWindow }) => {
    for (const win of BrowserWindow.getAllWindows()) win.webContents.session.flushStorageData();
  });
  await closeCurrentApp('seed browser storage');
  const images = path.join(profile, 'interview-images-v1');
  await mkdir(images);
  await writeFile(path.join(images, picture + '.image'), Buffer.from(png, 'base64'));
  await writeFile(path.join(images, picture + '.preview'), 'data:image/png;base64,' + png);
  const { defaultShortcuts } = workspace.platformRequire(
    path.join(backend, 'contracts/shortcuts.js'),
  );
  await writeFile(
    path.join(profile, 'shortcut-settings.json'),
    JSON.stringify({
      version: 2,
      bindings: { ...defaultShortcuts(), 'toggle-window': 'Control+Shift+9' },
    }),
  );
  await writeFile(
    path.join(profile, 'update-settings.json'),
    JSON.stringify({ schemaVersion: 1, autoDownload: false }),
  );
  await writeFile(selected, '0');
  await normalLaunch();
  let main = await pageFor('');
  const merged = await inspect(main);
  await checkSyncSettings(main, [true, false, true]);
  assert.deepEqual(merged, {
    profile: 'Legacy profile',
    records: ['Existing', 'Legacy'],
    input: 'transcription',
    chats: [
      ['Existing', 'Existing draft', 'Existing message'],
      ['Legacy', 'Legacy draft', 'Legacy message'],
    ],
    attachment: 'legacy',
    original: 'legacy',
    resume: 'legacy',
    image: 'data:image/png;base64,' + png,
    shortcut: 'Control+Shift+9',
    autoDownload: false,
  });
  main = await switchUser(main, users[1]);
  const clean = await inspect(main);
  await checkSyncSettings(main, [false, false, false]);
  assert.deepEqual(clean, {
    profile: null,
    records: [],
    input: null,
    chats: [],
    attachment: null,
    original: null,
    resume: null,
    image: null,
    shortcut: 'Control+Shift+H',
    autoDownload: true,
  });
  if (process.platform === 'win32') {
    await main.evaluate(() => localStorage.setItem('copilot-personal-info-v1',
      JSON.stringify({ name: 'Owner B only', background: '', jobDescription: '' })));
  }
  main = await switchUser(main, users[0]);
  assert.deepEqual(await inspect(main), merged);
  await checkSyncSettings(main, [true, false, true]);
  await closeCurrentApp('A/B account roundtrip');
  phase = 'restore A after restart';
  await normalLaunch();
  main = await pageFor('');
  assert.deepEqual(await inspect(main), merged);
  await checkSyncSettings(main, [true, false, true]);
  console.log(
    'PASS upgraded the shared profile into A once, merged existing target data, preserved original attachments and settings, and kept B isolated across restart',
  );
  if (process.platform === 'win32') {
    // Simulate a stop after the server committed A's deletion and its acknowledgement
    // reached disk, but before this upgrade claimant's browser and files were cleared.
    phase = 'commit A erasure receipt';
    await app.evaluate(async ({ app }, { backend, accountOrigin, id }) => {
      const load = process.getBuiltinModule('module').createRequire(app.getAppPath() + '/package.json');
      const { createCredentialVault } = load(backend + '/backend/cloud/vault.js');
      const { AccountErasureReceipts } = load(backend + '/backend/cloud/erasureReceipts.js');
      const receipts = new AccountErasureReceipts(app.getPath('userData'), accountOrigin,
        file => createCredentialVault(file));
      const { entry } = await receipts.prepare(id, true);
      await receipts.commit(entry);
    }, { backend, accountOrigin, id: users[0].id });
    await closeCurrentApp('committed A erasure receipt');
    phase = 'verify pending A erasure originals';
    const { profileDirectory } = workspace.platformRequire(path.join(backend, 'accountProfilePaths.js'));
    const erased = [profileDirectory(profile, 'account:' + users[0].id),
      path.join(images, picture + '.image'), path.join(images, picture + '.preview'),
      path.join(profile, 'account-erasure-intents', users[0].id + '.bin')];
    for (const file of erased) await stat(file);
    await writeFile(selected, '1');
    phase = 'cold-start A erasure and B recovery';
    await normalLaunch(erased);
    main = await pageFor('');
    assert.equal((await inspect(main)).profile, 'Owner B only');
    assert.deepEqual(await app.evaluate(() => globalThis.erasureWindowOrder),
      ['legacy-erase', 'window-all-closed', 'main']);
    assert.deepEqual(await app.evaluate(() => globalThis.pendingAtLastClose), erased.map(() => true));
    for (const file of erased) await assert.rejects(stat(file), { code: 'ENOENT' });
    console.log('PASS cold-start erasure closed the last legacy window, erased only claimant A and its receipt, then opened B with its own data');
  }
} catch (error) {
  bodyFailure = error;
  console.error('Legacy upgrade failed before teardown:', phase, error, '\nNative errors:\n' + nativeErrors);
  throw error;
} finally {
  try { if (app) await closeCurrentApp('final cleanup after ' + phase); }
  catch (error) {
    if (bodyFailure) throw new AggregateError([bodyFailure, error], 'Legacy upgrade body and teardown both failed');
    throw error;
  }
}
