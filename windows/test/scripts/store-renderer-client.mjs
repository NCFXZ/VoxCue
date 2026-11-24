import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';

// Runs only inside the disposable, offline Windows Sandbox. It speaks Chromium
// CDP to the shipped renderer; no main-process inspector or test entry is used.
assert.equal(process.platform, 'win32');
assert.equal(process.arch, 'x64');
assert.equal(os.userInfo().username.toLowerCase(), 'wdagutilityaccount');
const profile = path.resolve(os.homedir());
assert.equal(profile.toLowerCase(), 'c:\\users\\wdagutilityaccount');
assert.equal((await fs.realpath(profile)).toLowerCase(), profile.toLowerCase());
const closeStore = process.argv.length === 5 && process.argv[4] === '--close-store';
assert.ok(process.argv.length === 4 || closeStore);
const [configFile, outputFile] = process.argv.slice(2, 4).map((file) => path.resolve(file));
assert.equal(path.dirname(configFile), path.dirname(outputFile));
const work = path.dirname(configFile);
assert.equal(path.dirname(work).toLowerCase(), path.resolve(os.tmpdir()).toLowerCase());
assert.match(path.basename(work), /^voxcue-store-[a-f0-9-]{36}$/i);
assert.equal((await fs.realpath(work)).toLowerCase(), work.toLowerCase());
const info = await fs.lstat(configFile);
assert.ok(info.isFile() && !info.isSymbolicLink() && info.size <= 16384);
if (!closeStore) await assert.rejects(fs.lstat(outputFile), { code: 'ENOENT' });
const config = JSON.parse(await fs.readFile(configFile, 'utf8'));
assert.equal(path.basename(work), 'voxcue-store-' + config.nonce);
const nsis = config.distribution === 'nsis';
assert.ok(config.distribution === undefined || nsis, 'Unknown packaged distribution');
if (nsis) {
  assert.ok(['seed', 'verify'].includes(config.phase), 'Unknown NSIS persistence phase');
  assert.ok(Number.isSafeInteger(config.expectedPid) && config.expectedPid > 0);
  assert.equal(config.close, true, 'NSIS phases must close naturally before continuing');
}
if (closeStore) assert.ok(!nsis && ['seed', 'verify'].includes(config.phase));
const deadline = Date.now() + 120000;
const clients = [];
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function poll(read, label) {
  while (Date.now() < deadline) {
    const value = await read();
    if (value) return value;
    await delay(250);
  }
  throw Error('Installed Store renderer did not become ready: ' + label);
}
async function endpoint(resource) {
  try {
    const response = await fetch('http://127.0.0.1:9222/json/' + resource, {
      signal: AbortSignal.timeout(1000),
    });
    return response.ok ? await response.json() : undefined;
  } catch {
    return undefined;
  }
}
async function connect(url) {
  assert.ok(url.startsWith('ws://127.0.0.1:9222/'), 'Unexpected CDP endpoint');
  const socket = new WebSocket(url);
  const pending = new Map();
  let sequence = 0;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('Renderer CDP websocket timeout')), 10000);
    socket.addEventListener(
      'open',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
    socket.addEventListener(
      'error',
      () => {
        clearTimeout(timer);
        reject(Error('Renderer CDP connection failed'));
      },
      { once: true },
    );
  });
  socket.addEventListener('message', (message) => {
    const value = JSON.parse(message.data);
    const request = pending.get(value.id);
    if (!request) return;
    pending.delete(value.id);
    clearTimeout(request.timer);
    if (value.error) request.reject(Error('CDP command failed: ' + JSON.stringify(value.error)));
    else request.resolve(value.result);
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(
        () => {
          pending.delete(id);
          reject(Error('CDP command timeout: ' + method));
        },
        Math.max(1, Math.min(30000, deadline - Date.now())),
      );
      pending.set(id, { resolve, reject, timer });
      socket.send(JSON.stringify({ id, method, params }));
    });
  const client = {
    send,
    async evaluate(expression) {
      const result = await send('Runtime.evaluate', {
        expression,
        awaitPromise: true,
        returnByValue: true,
        userGesture: true,
      });
      if (result.exceptionDetails)
        throw Error(
          'Renderer evaluation failed: ' +
            (result.exceptionDetails.exception?.description ?? result.exceptionDetails.text),
        );
      return result.result.value;
    },
    close() {
      for (const request of pending.values()) {
        clearTimeout(request.timer);
        request.reject(Error('CDP client closed'));
      }
      socket.close();
    },
  };
  clients.push(client);
  return client;
}
const appPage = path.join(config.appDirectory, 'resources/app.asar/dist/index.html').toLowerCase();
async function renderer(login) {
  const target = await poll(
    async () =>
      (await endpoint('list'))?.find((item) => {
        if (item.type !== 'page' || !item.url.startsWith('file:')) return false;
        const url = new URL(item.url);
        return fileURLToPath(url).toLowerCase() === appPage && url.hash === (login ? '#login' : '');
      }),
    login ? 'login page' : 'main page',
  );
  return connect(target.webSocketDebuggerUrl);
}
async function checkSecondLaunch(main) {
  const exe = path.join(profile, 'AppData/Local/Programs/VoxCue/VoxCue.exe');
  assert.equal(path.dirname(exe).toLowerCase(), config.appDirectory.toLowerCase());
  assert.equal((await fs.realpath(exe)).toLowerCase(), exe.toLowerCase());
  const onlyPage = async () => {
    const pages = (await endpoint('list'))?.filter((item) => item.type === 'page');
    assert.equal(pages?.length, 1, 'Expected one application window');
    assert.equal(fileURLToPath(new URL(pages[0].url)).toLowerCase(), appPage);
    return pages[0].id;
  };
  const targetId = await onlyPage();
  await main.evaluate('window.desktop.windowAction("minimize")');
  await poll(() => main.evaluate('document.visibilityState === "hidden"'), 'minimized original window');
  await promisify(execFile)(exe, [], { cwd: work, windowsHide: true, timeout: 15000 });
  await poll(
    () => main.evaluate('document.visibilityState === "visible" && document.hasFocus()'),
    'restored and focused original window after second launch',
  );
  assert.equal(await onlyPage(), targetId);
}
async function checkPersistence(main) {
  const hasIsolatedProfile = (version) => {
    const [major, minor] = version.split('.').map(Number);
    return major > 1 || (major === 1 && minor >= 3);
  };
  const isolatedProfile = hasIsolatedProfile(config.version);
  const modernSource = hasIsolatedProfile(config.sourceVersion ?? config.version);
  const originalText = 'Synthetic Sandbox original: 中文与 English remain intact.';
  const bytes = Array.from(
    Buffer.from(`${originalText}\nFixture reference ${config.nonce}.\n`),
  );
  const createdAt = 1700000000000;
  const expected = {
    profile: {
      name: 'Sandbox persistence owner',
      background: 'Synthetic persisted resume: TypeScript 与接口校验。',
      jobDescription: 'Synthetic persisted job requirements.',
      language: '简体中文',
    },
    history: [
      {
        id: 'sandbox-persistence-record',
        title: 'Sandbox persistence record',
        titleStatus: 'ready',
        titleSource: 'manual',
        startedAt: createdAt,
        endedAt: createdAt + 30000,
        status: 'ended',
        mock: false,
        transcripts: [
          {
            id: 'sandbox-transcript',
            text: 'Sandbox persisted transcript：合成原文。',
            time: '10:00',
            final: true,
            source: 'system',
          },
        ],
        answers: [
          {
            id: 'sandbox-answer',
            question: 'Sandbox persisted question',
            content: 'Sandbox persisted answer.',
            provider: 'chatgpt',
            sourceTranscriptIds: ['sandbox-transcript'],
          },
        ],
      },
    ],
    base: {
      id: 'sandbox-persistence-base',
      name: 'Sandbox persistence library',
      createdAt,
      localRevision: 'sandbox-base-v1',
    },
    document: {
      id: 'sandbox-persistence-document',
      baseId: 'sandbox-persistence-base',
      name: 'sandbox-original.md',
      size: bytes.length,
      type: 'text/markdown',
      createdAt,
      localRevision: 'sandbox-file-v1',
      bytes,
    },
    theme: 'dark',
    language: 'zh-CN',
  };
  const call = (operation, input = expected) =>
    main.evaluate(`(${operation.toString()})(${JSON.stringify(input)})`);
  const click = (selector, label, text) =>
    poll(
      () =>
        call(
          ({ selector, text }) => {
            const button = [...document.querySelectorAll(selector)].find(
              (element) =>
                element.getClientRects().length &&
                !element.closest('[inert],[hidden]') &&
                (text === undefined || (Array.isArray(text)
                  ? text.includes(element.textContent.trim())
                  : element.textContent.includes(text))),
            );
            if (!button) return false;
            if (button.getAttribute('aria-haspopup') === 'menu') {
              button.focus();
              button.dispatchEvent(new KeyboardEvent('keydown', {
                key: 'ArrowDown', code: 'ArrowDown', bubbles: true,
              }));
            } else button.click();
            return true;
          },
          { selector, text },
        ),
      label,
    );
  if (config.phase !== 'verify') {
    await click('button.user-button', 'settings user menu');
    await click('.user-menu [role="menuitem"]', 'open settings', ['设置', 'Settings']);
    await click('.settings-sidebar nav button', 'general settings', ['通用', 'General']);
    await click('button[aria-label="语言"],button[aria-label="Language"]', 'language selector');
    await click('[role="menuitemradio"]', 'Simplified Chinese', '简体中文');
    await poll(() => main.evaluate('document.documentElement.lang === "zh-CN"'), 'Chinese settings UI');
    await click('button[aria-label="外观主题"]', 'theme selector');
    await click('.settings-theme-menu [role="menuitemradio"]', 'dark theme', '深色');
    await poll(() => main.evaluate('localStorage.getItem("copilot-theme") === "dark" && document.documentElement.classList.contains("dark")'),
      'theme selected and persisted through the settings UI');
    await click('.settings-sidebar .dialog-close-button', 'close settings');
    await poll(() => main.evaluate('!document.querySelector(".settings-dialog[open]")'), 'closed settings');
  }
  async function checkIndex() {
    assert.ok(['seed', 'verify'].includes(config.phase));
    const { document } = expected;
    await poll(async () => {
      const components = await main.evaluate('window.desktop.components({op:"status"})');
      return components.items.find((item) => item.id === 'rag')?.phase === 'ready';
    }, 'the installed app to authenticate the offline RAG component');
    const knowledge = async (request) => {
      const result = await call((request) => {
        if (request.op === 'import') request.bytes = new Uint8Array(request.bytes);
        return window.desktop.knowledge(request);
      }, request);
      assert.equal(result.ok, true, result.error);
      return result.value;
    };
    const contentHash = createHash('sha256').update(Buffer.from(bytes)).digest('hex');
    const state = await knowledge({ op: 'status' });
    assert.equal(state.modelReady, true);
    const existing = state.documents.find((item) => item.documentId === document.id);
    if (config.phase === 'seed') {
      assert.equal(existing, undefined);
      const indexed = await knowledge({
        op: 'import', requestId: 'sandbox-index-seed', baseId: document.baseId,
        documentId: document.id, name: document.name, bytes,
      });
      assert.equal(indexed.contentHash, contentHash);
      assert.ok(indexed.chunkCount > 0);
      if (isolatedProfile) assert.equal(indexed.indexVersion, 'qa-linked-v3');
      else if (config.version === '1.2.3') assert.equal(indexed.indexVersion, 'qa-linked-v2');
    } else {
      assert.match(config.ragRevision, /^[a-f0-9]{64}$/);
      let observed;
      const current = isolatedProfile ? await poll(async () => {
        const status = await knowledge({ op: 'status' });
        if (status.error) throw Error(status.error);
        const indexed = status.documents.find((item) => item.documentId === document.id);
        const task = status.tasks.find((item) => item.documentId === document.id);
        observed = { modelReady: status.modelReady, indexVersion: indexed?.indexVersion ?? null,
          available: indexed?.available ?? null, phase: task?.phase ?? null };
        if (task?.phase === 'failed') throw Error(task.error || 'Reindexing the migrated original failed');
        return indexed?.indexVersion === 'qa-linked-v3' && indexed.available === true && indexed;
      }, 'the installed app to index the migrated original in qa-linked-v3').catch(error => {
        throw Error(error.message + ' (last index state ' + JSON.stringify(observed) + ')');
      }) : existing;
      assert.equal(current?.contentHash, contentHash);
      assert.equal(current.baseId, document.baseId);
      assert.equal(current.name, document.name);
      assert.ok(current.chunkCount > 0);
    }
    const [hit] = await knowledge({
      op: 'search', requestId: 'sandbox-index-search', query: 'Synthetic Sandbox original',
      baseId: document.baseId, mode: 'vector', topK: 1,
    });
    assert.equal(hit?.documentId, document.id);
    assert.equal(hit.mode, 'vector');
    assert.ok(Number.isFinite(hit.similarity));
    assert.match(hit.revision, /^[a-f0-9]{64}$/);
    const ragRevision = hit.revision;
    if (config.phase === 'verify') {
      if (config.rebuildIndex) assert.notEqual(ragRevision, config.ragRevision);
      else assert.equal(ragRevision, config.ragRevision);
    }
    const item = await knowledge({
      op: 'item', requestId: 'sandbox-index-item', itemId: hit.itemId,
      expected: { baseId: document.baseId, documentId: document.id, revision: ragRevision },
    });
    assert.equal(item?.source?.contentHash, contentHash);
    if (isolatedProfile) {
      assert.equal(item.source.indexVersion, 'qa-linked-v3');
      assert.equal(item.source.revision, ragRevision);
    }
    assert.ok(item.content.includes(originalText));
    return ragRevision;
  }
  // Index in the old process before writing the synthetic originals and reloading its UI.
  let ragRevision = config.checkRag && config.phase === 'seed' ? await checkIndex() : undefined;
  // An upgrade/restart must only read the seed written by the old process.
  const seededBindings =
    config.phase === 'verify'
      ? config.bindings
      : await call(async ({ seed, modernSource }) => {
          const db = await new Promise((resolve, reject) => {
            const request = indexedDB.open('copilot-local-documents');
            request.onupgradeneeded = () => {
              request.result.createObjectStore('bases', { keyPath: 'id' });
              request.result
                .createObjectStore('documents', { keyPath: 'id' })
                .createIndex('baseId', 'baseId');
            };
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(Error('Synthetic document database could not open'));
          });
          try {
            await new Promise((resolve, reject) => {
              const tx = db.transaction(['bases', 'documents'], 'readwrite');
              const { bytes, ...metadata } = seed.document;
              tx.objectStore('bases').put(seed.base);
              tx.objectStore('documents').put({
                ...metadata,
                blob: new Blob([new Uint8Array(bytes)], { type: metadata.type }),
              });
              tx.oncomplete = resolve;
              tx.onerror = tx.onabort = () => reject(Error('Synthetic document write failed'));
            });
          } finally {
            db.close();
          }
          localStorage.setItem('copilot-personal-info-v1', JSON.stringify(seed.profile));
          localStorage.setItem('copilot-interview-history-v1', JSON.stringify(seed.history));
          const result = await window.desktop.shortcutSettings({
            op: 'set',
            action: 'toggle-window',
            accelerator: 'Control+Alt+K',
          });
          if (result.state.bindings['toggle-window'] !== 'Control+Alt+K' || result.state.error)
            throw Error('Synthetic shortcut was rejected');
          if (!modernSource) return result.state.bindings;
          const help = await window.desktop.shortcutSettings({
            op: 'set',
            action: 'toggle-shortcut-help',
            accelerator: 'Control+Alt+U',
          });
          if (help.state.bindings['toggle-shortcut-help'] !== 'Control+Alt+U' || help.state.error)
            throw Error('Synthetic shortcut help binding was rejected');
          return help.state.bindings;
        }, { seed: expected, modernSource });
  // The four supported pre-1.3 packages have the same nine actions. The seed
  // can also customize the help shortcut in 1.3 and later.
  const legacyBindings = {
    'toggle-window': 'Control+Alt+K',
    'toggle-panels': 'Control+Shift+P',
    'toggle-transcript': 'Control+Shift+T',
    'toggle-microphone': 'Control+Shift+M',
    'toggle-system-audio': 'Control+Shift+A',
    'submit-input': 'Control+Shift+Enter',
    'scroll-device-up': 'Control+Shift+Up',
    'scroll-device-down': 'Control+Shift+Down',
    screenshot: 'Control+Shift+S',
  };
  const modernBindings = { ...legacyBindings, 'toggle-shortcut-help': 'Control+Alt+U' };
  const expectedSeed = modernSource ? modernBindings : legacyBindings;
  const bindings = !modernSource && isolatedProfile
    ? { ...legacyBindings, 'toggle-shortcut-help': 'Control+Shift+/' }
    : expectedSeed;
  assert.deepEqual(seededBindings, expectedSeed, 'Unexpected seeded shortcut bindings');
  const snapshot = (requireCommitted = false) =>
    call(async ({ seed, requireCommitted, isolatedProfile }) => {
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open('copilot-local-documents');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(Error('Persisted document database could not open'));
      });
      let rows;
      try {
        rows = await new Promise((resolve, reject) => {
          const modernHistory = db.objectStoreNames.contains('interviewRecords');
          if (isolatedProfile && requireCommitted && !modernHistory) {
            reject(Error('The installed account partition has no committed history store'));
            return;
          }
          const stores = modernHistory ? ['bases', 'documents', 'interviewRecords', 'interviewDirectory'] : ['bases', 'documents'];
          const tx = db.transaction(stores, 'readonly');
          const base = tx.objectStore('bases').get(seed.base.id);
          const document = tx.objectStore('documents').get(seed.document.id);
          const history = modernHistory ? tx.objectStore('interviewRecords').getAll() : undefined;
          const directory = modernHistory ? tx.objectStore('interviewDirectory').get(seed.history[0].id) : undefined;
          tx.oncomplete = () => resolve({
            base: base.result, document: document.result, summary: directory?.result,
            history: modernHistory && (requireCommitted || history.result.length) ? history.result
              : JSON.parse(localStorage.getItem('copilot-interview-history-v1')),
          });
          tx.onerror = tx.onabort = () => reject(Error('Persisted document read failed'));
        });
      } finally {
        db.close();
      }
      if (isolatedProfile && requireCommitted && (
        localStorage.getItem('copilot-interview-history-v1') !== null ||
        rows.summary?.title !== seed.history[0].title || rows.summary?.answerCount !== seed.history[0].answers.length ||
        !rows.summary?.revision)) throw Error('The migrated history directory or legacy cleanup is incomplete');
      if (!rows.document?.blob) throw Error('Persisted original is missing');
      const { blob, ...metadata } = rows.document;
      return {
        profile: JSON.parse(localStorage.getItem('copilot-personal-info-v1')),
        history: rows.history,
        theme: localStorage.getItem('copilot-theme'),
        language: localStorage.getItem('voxcue-language-v1'),
        base: rows.base,
        document: { ...metadata, bytes: Array.from(new Uint8Array(await blob.arrayBuffer())) },
        bindings: (await window.desktop.shortcutSettings({ op: 'status' })).state.bindings,
      };
    }, { seed: expected, requireCommitted, isolatedProfile });
  assert.deepEqual(await snapshot(), { ...expected, bindings });
  // Check the upgraded index before a reload or library navigation can reconcile it.
  if (config.checkRag && config.phase === 'verify' && (modernSource || config.rebuildIndex))
    ragRevision = await checkIndex();
  const previousOrigin = await main.evaluate('performance.timeOrigin');
  await main.send('Page.reload');
  await poll(async () => {
    try {
      return await main.evaluate(`performance.timeOrigin !== ${JSON.stringify(previousOrigin)} &&
        document.readyState === 'complete' && !!document.querySelector('button[aria-label="个人信息"]')`);
    } catch {
      return false;
    }
  }, 'reloaded persisted application');
  assert.deepEqual(await snapshot(), { ...expected, bindings });
  assert.deepEqual(
    await main.evaluate(`({ dark:document.documentElement.classList.contains('dark'),
    language:document.documentElement.lang })`),
    { dark: true, language: expected.language },
  );
  await click('button[aria-label="个人信息"]', 'personal information');
  await poll(
    () =>
      call(
        (seed) =>
          document.querySelector('#personal-info-panel[data-open="true"] input')?.value ===
          seed.profile.name,
      ),
    'persisted personal information UI',
  );
  await click('#personal-info-panel details[aria-label="简历摘要"] > summary', 'resume summary');
  await poll(
    () =>
      call((seed) =>
        [...document.querySelectorAll('#personal-info-panel .profile-summary')].some(
          (element) =>
            element.getClientRects().length &&
            element.textContent.includes(seed.profile.background),
        ),
      ),
    'persisted resume UI',
  );
  await click('button[aria-label="个人信息"]', 'close personal information');
  await click('nav button[aria-label="面试记录"]', 'interview history');
  await poll(
    () =>
      call((seed) =>
        [...document.querySelectorAll('.history-title-text')].some(
          (element) => element.textContent === seed.history[0].title,
        ),
      ),
    'persisted history list',
  );
  await click('.history-row-open', 'persisted history detail');
  await poll(
    () =>
      call((seed) =>
        document
          .querySelector('.history-detail')
          ?.innerText.includes(seed.history[0].transcripts[0].text),
      ),
    'persisted transcript UI',
  );
  await click('button[aria-label="查看回答：Sandbox persisted question"]', 'persisted answer');
  await poll(
    () =>
      call((seed) =>
        document
          .querySelector('.record-answer-panel[data-open="true"]')
          ?.innerText.includes(seed.history[0].answers[0].content),
      ),
    'persisted answer UI',
  );
  assert.deepEqual(await snapshot(true), { ...expected, bindings });
  await click('nav button[aria-label="知识库"]', 'knowledge library');
  await click('.knowledge-card', 'persisted library UI', expected.base.name);
  await poll(
    () =>
      call((seed) =>
        [...document.querySelectorAll('.document-row')].some(
          (element) =>
            element.innerText.includes(seed.document.name) &&
            element.innerText.includes(`${seed.document.size} B`),
        ),
      ),
    'persisted original metadata UI',
  );
  assert.deepEqual(await snapshot(), { ...expected, bindings });
  // Opening this library calls the real renderer reconciliation path. Test the migrated
  // IndexedDB bytes and visible original first, then assert its rebuilt index and citation.
  if (config.checkRag && config.phase === 'verify') {
    const openedRevision = await checkIndex();
    if (ragRevision)
      assert.equal(openedRevision, ragRevision, 'Opening the library changed the verified index');
    ragRevision = openedRevision;
  }
  return { bindings, ragRevision };
}
async function inspect() {
  const browser = await connect(
    (await poll(() => endpoint('version'), 'browser')).webSocketDebuggerUrl,
  );
  const { processInfo } = await browser.send('SystemInfo.getProcessInfo');
  const processes = processInfo.filter((item) => item.type === 'browser');
  assert.equal(processes.length, 1);
  const pid = processes[0].id;
  assert.ok(Number.isSafeInteger(pid) && pid > 0);
  if (closeStore) {
    const info = await fs.lstat(outputFile);
    assert.ok(info.isFile() && !info.isSymbolicLink() && info.size <= 16384);
    const result = JSON.parse(await fs.readFile(outputFile, 'utf8'));
    assert.equal(result.nonce, config.nonce);
    assert.equal(result.version, config.version);
    assert.equal(result.pid, pid);
    await (await renderer(false)).evaluate('window.desktop.windowAction("close")');
    return;
  }
  if (nsis) assert.equal(pid, config.expectedPid, 'CDP is not the launched guest process');
  if (config.phase !== 'verify') {
    const login = await renderer(true);
    await poll(
      () => login.evaluate('typeof window.desktop?.setLocalMode === "function"'),
      'local account API',
    );
    assert.deepEqual(
      await login.evaluate(
        '({node:typeof require,process:typeof process,platform:window.desktop.platform})',
      ),
      { node: 'undefined', process: 'undefined', platform: 'windows' },
    );
    const entered = await login.evaluate('window.desktop.setLocalMode(true)');
    assert.equal(entered.ok, true);
    assert.equal(entered.state.localMode, true);
  }
  const main = await renderer(false);
  let update = await poll(
    () =>
      main.evaluate(
        'typeof window.desktop?.updates === "function" ? window.desktop.updates({op:"status"}) : null',
      ),
    'updates API',
  );
  if (config.offeredVersion) {
    assert.ok(nsis);
    const previous = config.phase === 'seed';
    update = await poll(async () => {
      const state = await main.evaluate('window.desktop.updates({op:"status"})');
      if (state.phase === 'error') throw Error('Installed updater rejected the signed release');
      return state.lastCheckedAt !== null && state.phase !== 'checking' ? state : undefined;
    }, 'installed updater consuming signed metadata');
    assert.equal(update.autoDownload, false);
    assert.equal(update.phase, previous ? 'available' : 'idle');
    assert.equal(update.availableVersion, previous ? config.offeredVersion : null);
  }
  const states = nsis
    ? []
    : await main.evaluate(
        'Promise.all([{op:"check",force:true},{op:"download"},{op:"install"}].map(call=>window.desktop.updates(call)))',
      );
  assert.equal(states.length, nsis ? 0 : 3);
  for (const state of [update, ...states]) {
    assert.equal(state.currentVersion, config.version);
    if (nsis) continue;
    assert.equal(state.phase, 'unavailable');
    assert.equal(state.message, config.storeUpdateMessage);
  }
  const { bindings, ragRevision } = await checkPersistence(main);
  if (nsis && config.phase === 'verify') await checkSecondLaunch(main);
  await fs.writeFile(
    outputFile,
    JSON.stringify({
      nonce: config.nonce,
      pid,
      version: update.currentVersion,
      updatePhases: [update, ...states].map((state) => state.phase),
      persistence: true,
      bindings,
      ragRevision,
      phase: config.phase,
    }),
  );
  if (nsis) await main.evaluate('window.desktop.windowAction("close")');
}
try {
  await inspect();
} finally {
  for (const client of clients) client.close();
}
