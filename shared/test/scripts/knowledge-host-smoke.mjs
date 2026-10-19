import assert from 'node:assert/strict';
import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import workspace from '../../scripts/workspace.mjs';
import { testRoot, spawnTestProcess } from './test-workspace.mjs';
import { offlineElectronEntry } from './offline-electron-entry.mjs';

// Keep the production process/host boundary; inject only deterministic work in
// its synthetic KnowledgeService. No BrowserWindow, model download or audio.
function utilityFixture() {
  const config = require('./knowledge-error-config.json');
  const deny = () => {
    throw Error('Offline knowledge fixture forbids network access');
  };
  globalThis.fetch = deny;
  for (const module of ['node:http', 'node:https']) {
    require(module).request = deny;
    require(module).get = deny;
  }
  require('node:net').Socket.prototype.connect = deny;
  require('node:tls').connect = deny;
  require('node:module').syncBuiltinESMExports();
  const { KnowledgeService } = require(config.service);
  const { KnowledgeError } = require(config.errors);
  KnowledgeService.prototype.search = async function (query, _topK, _mode, signal) {
    if (query.startsWith('code:'))
      throw new KnowledgeError(query.slice(5), 'synthetic knowledge failure');
    if (query === 'unknown-wire')
      throw new KnowledgeError('future-code', 'synthetic unknown wire code');
    if (query === 'late' || query === 'hang') {
      process.parentPort.postMessage({ fixtureStarted: query });
      if (query === 'late') await new Promise((resolve) => setTimeout(resolve, 100));
      else
        await new Promise((_resolve, reject) =>
          signal.addEventListener('abort', () => reject(signal.reason), { once: true }),
        );
    }
    return [];
  };
  require(config.processFile);
}

async function runInElectron() {
  const { app, utilityProcess } = require('electron');
  const assert = require('node:assert/strict');
  const path = require('node:path');
  const config = require('./knowledge-error-config.json');
  app.setPath('userData', path.join(config.root, 'profile'));
  for (const attempt of [
    () => fetch('https://example.invalid'),
    () => fetch('http://127.0.0.1:1'),
    () => require('node:http').request('http://example.invalid'),
    () => require('electron').net.request('https://example.invalid'),
    () => require('node:tls').connect({ host: 'example.invalid', port: 443 }),
  ])
    assert.throws(attempt, /Offline desktop regression forbids network access/);
  app.disableHardwareAcceleration();
  await app.whenReady();
  const { KnowledgeHost } = require(config.host);
  const { KnowledgeError, knowledgeErrorCodes } = require(config.errors);
  const { RagChatService } = require(config.rag);
  const originalFork = utilityProcess.fork;
  utilityProcess.fork = (file, args, options) =>
    originalFork(file === config.processFile ? config.fixture : file, args, options);
  const hosts = [];
  const createHost = () => {
    const host = new KnowledgeHost(
      path.join(config.root, 'database-' + hosts.length),
      path.join(config.root, 'unused-synthetic-model'),
    );
    hosts.push(host);
    return host;
  };
  const signal = () => new AbortController().signal;
  function message(child, predicate) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        child.removeListener('message', received);
        reject(Error('Synthetic utility message timeout'));
      }, 5000);
      function received(value) {
        if (!predicate(value)) return;
        clearTimeout(timer);
        child.removeListener('message', received);
        resolve(value);
      }
      child.on('message', received);
    });
  }
  const exit = (child) => new Promise((resolve) => child.once('exit', resolve));
  let host = createHost();
  try {
    await host.initialize();
    for (const code of knowledgeErrorCodes)
      await assert.rejects(
        host.search('code:' + code, 5, 'hybrid', signal()),
        (error) => error instanceof KnowledgeError && error.code === code,
      );
    await assert.rejects(host.search('unknown-wire', 5, 'hybrid', signal()), {
      code: 'integrity',
    });
    assert.deepEqual(await host.search('next', 5, 'hybrid', signal()), []);

    let providerCalls = 0;
    const provider = {
      stream: async (_request, _emit, parent) => {
        parent.throwIfAborted();
        providerCalls++;
        return { usage: null, sources: [], answerText: 'synthetic direct answer' };
      },
    };
    const rag = new RagChatService(provider, host, async () => 'local');
    const request = (question) => ({
      id: 'synthetic-knowledge-wire',
      modelId: 'synthetic-model',
      instructions: 'Synthetic interview fixture',
      webSearch: false,
      knowledgeBaseId: 'synthetic-base',
      turns: [{ role: 'user', content: question }],
    });
    for (const code of knowledgeErrorCodes.filter((code) => code !== 'unavailable')) {
      providerCalls = 0;
      await assert.rejects(
        rag.stream(request('code:' + code), () => {}, signal()),
        { code },
      );
      assert.equal(providerCalls, 0);
    }
    providerCalls = 0;
    await rag.stream(request('code:unavailable'), () => {}, signal());
    assert.equal(providerCalls, 1);

    const controller = new AbortController();
    const started = message(host.child, (value) => value.fixtureStarted === 'hang');
    const lateCancellation = message(host.child, (value) => value.errorCode === 'cancelled');
    providerCalls = 0;
    const cancelled = rag.stream(request('hang'), () => {}, controller.signal);
    const rejected = assert.rejects(cancelled, { name: 'AbortError' });
    await started;
    controller.abort();
    await rejected;
    await lateCancellation;
    assert.equal(providerCalls, 0);
    assert.equal(host.pending.size, 0);

    // Shorten only Host's test deadline; real production process emits its late
    // cancellation after finishing the deliberately uncooperative work.
    const send = host.send.bind(host);
    host.send = (call, parent, timeout) => send(call, parent, call.query === 'late' ? 20 : timeout);
    const late = message(host.child, (value) => value.errorCode === 'cancelled');
    await assert.rejects(host.search('late', 5, 'hybrid', signal()), { code: 'unavailable' });
    await late;
    assert.equal(host.pending.size, 0);
    assert.deepEqual(await host.search('next', 5, 'hybrid', signal()), []);

    // Exercise the actual 15-second Local RAG deadline, without changing it.
    providerCalls = 0;
    const timeoutCancellation = message(host.child, (value) => value.fixtureStarted === 'hang');
    const timed = rag.stream(request('hang'), () => {}, signal());
    await timeoutCancellation;
    await timed;
    assert.equal(providerCalls, 1);
    assert.equal(host.pending.size, 0);

    for (const operation of ['stop', 'exit']) {
      const started = message(host.child, (value) => value.fixtureStarted === 'hang');
      const pending = host.search('hang', 5, 'hybrid', signal());
      const rejected = assert.rejects(pending, {
        code: operation === 'stop' ? 'closed' : 'unavailable',
      });
      await started;
      const child = host.child;
      const exited = exit(child);
      if (operation === 'stop') host.stop();
      else child.kill();
      await rejected;
      await exited;
      assert.equal(host.pending.size, 0);
      host = createHost();
      await host.initialize();
    }
    await host.close();
    console.log(
      JSON.stringify({
        status: 'passed',
        realUtilityProcess: true,
        wireCodes: knowledgeErrorCodes,
        unknownWire: 'integrity',
        originalLocalRagTimeoutMs: 15000,
        cancellationPreventsProvider: true,
        fallbackProviderCalls: 1,
        lateResultsRetired: true,
        gui: false,
      }),
    );
  } finally {
    utilityProcess.fork = originalFork;
    for (const host of hosts) await host.close().catch(() => host.stop());
  }
  app.exit(0);
}

const base = path.join(workspace.platformRoot, 'dist-electron/shared/electron');
const fixture = path.join(testRoot, 'knowledge-error-process.cjs');
await writeFile(
  path.join(testRoot, 'knowledge-error-config.json'),
  JSON.stringify({
    root: testRoot,
    fixture,
    host: path.join(base, 'backend/knowledge/host.js'),
    service: path.join(base, 'backend/knowledge/service.js'),
    errors: path.join(base, 'backend/knowledge/errors.js'),
    processFile: path.join(base, 'backend/knowledge/process.js'),
    rag: path.join(base, 'application/rag.js'),
  }),
);
await writeFile(fixture, '(' + utilityFixture.toString() + ')();');
const main = path.join(testRoot, 'knowledge-error-main.cjs');
await writeFile(
  main,
  '(' +
    runInElectron.toString() +
    ')().catch(error => { console.error(error); require("electron").app.exit(1); });',
);
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawnTestProcess(
  workspace.platformRequire('electron'),
  [await offlineElectronEntry(main)],
  { cwd: workspace.platformRoot, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
);
child.stdout.on('data', (data) => process.stdout.write(data));
child.stderr.on('data', (data) => process.stderr.write(data));
const timer = setTimeout(() => child.kill(), 60000);
const code = await new Promise((resolve, reject) => {
  child.once('exit', resolve);
  child.once('error', reject);
}).finally(() => clearTimeout(timer));
assert.equal(code, 0, 'Real utility-process knowledge classification failed');
