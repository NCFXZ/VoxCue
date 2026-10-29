import { connectUiAccount } from '../../../shared/test/scripts/install-ui-account.mjs';
import assert from 'node:assert/strict';
import { waitForAsync } from '../../../shared/test/scripts/wait-for-async.mjs';
import { installUiAccount } from '../../../shared/test/scripts/install-ui-account.mjs';
import { probe } from './window-probe.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { testRoot } from '../../../shared/test/scripts/test-workspace.mjs';

// Runs only after packaged inference, against that run's temporary profile and
// real managed models. Replace capture, never Worker/ONNX or deletion logic.
export async function checkComponentRemoval(application, page, restoreCached) {
  const handleFixture = path.join(testRoot, 'exclusive-handle-fixture');
  fs.writeFileSync(handleFixture, 'synthetic handle fixture');
  const held = fs.openSync(handleFixture, 'r');
  try {
    assert.throws(() => probe('exclusive', handleFixture), /Model handle is not released/);
  } finally {
    fs.closeSync(held);
  }
  assert.equal(probe('exclusive', handleFixture).exclusiveFiles, 1);
  fs.unlinkSync(handleFixture);
  await installUiAccount(application);
  page = await connectUiAccount(application, page);
  await page.getByRole('textbox', { name: '聊天消息', exact: true }).waitFor();
  await application.evaluate(({ app }) => {
    const require = process
      .getBuiltinModule('module')
      .createRequire(app.getAppPath() + '/package.json');
    const fs = require('node:fs');
    const path = require('node:path');
    const root = app.getAppPath();
    const unpacked = root.replace(/app\.asar$/, 'app.asar.unpacked');
    const base = root + '/dist-electron/shared/electron/backend/';
    const { SpeechHost } = require(base + 'speech/host.js');
    const { KnowledgeHost } = require(base + 'knowledge/host.js');
    const { componentLocation } = require(base + 'components/service.js');
    const { packagesFor } = require(base + 'components/catalog.js');
    globalThis.removalCheck = { speechExited: false, ragUnloaded: false };
    globalThis.removalLocations = Object.fromEntries(
      packagesFor(process.platform, process.arch).map((pkg) => [
        pkg.id,
        componentLocation(path.join(app.getPath('userData'), 'component-cache'), pkg),
      ]),
    );
    globalThis.removalFiles = Object.fromEntries(
      packagesFor(process.platform, process.arch).map((pkg) => [
        pkg.id,
        [
          path.join(globalThis.removalLocations[pkg.id], '.voxcue-component.json'),
          ...pkg.files.map((file) =>
            path.join(globalThis.removalLocations[pkg.id], 'files', file.path),
          ),
        ],
      ]),
    );
    const fixture = path.join(app.getPath('userData'), 'removal-speech.cjs');
    const controller = path.join(unpacked, 'dist-electron/windows/electron/speech/controller.js');
    const shared = path.join(
      unpacked,
      'dist-electron/shared/electron/backend/speech/controller.js',
    );
    fs.writeFileSync(
      fixture,
      `
const {SpeechController}=require(${JSON.stringify(shared)});
require(${JSON.stringify(controller)}).SpeechController=class extends SpeechController {
  constructor(model,helper,emit) { super(model,helper,emit,{
    devices:async()=>[{id:'synthetic-mic',name:'Synthetic microphone',source:'microphone',default:true}],
    create:(_helper,_source,_device,audio)=>({
      async start(){audio({samples:new Float32Array(1600),rate:16000,timestamp:Date.now(),flags:0});},
      async stop(){}
    })
  }); }
};
require(${JSON.stringify(path.join(unpacked, 'dist-electron/windows/electron/speech/process.js'))});
`,
    );
    const call = SpeechHost.prototype.call;
    SpeechHost.prototype.call = function (...args) {
      if (!this.child) this.processFile = fixture;
      return call.apply(this, args);
    };
    const close = SpeechHost.prototype.close;
    SpeechHost.prototype.close = async function () {
      const child = this.child;
      if (!child) throw Error('Removal must close the loaded speech utility process');
      let exited = false;
      child.once('exit', () => {
        exited = true;
      });
      globalThis.removalCheck.closing = true;
      await new Promise((resolve) => {
        globalThis.releaseRemoval = resolve;
      });
      await close.call(this);
      if (!exited || this.child) throw Error('Speech close returned before process exit');
      globalThis.removalCheck.speechExited = true;
      await new Promise((resolve) => {
        globalThis.releaseSpeechProbe = resolve;
      });
    };
    const index = KnowledgeHost.prototype.indexDocument;
    KnowledgeHost.prototype.indexDocument = async function (...args) {
      globalThis.removalCheck.indexing = true;
      await new Promise((resolve) => {
        globalThis.releaseIndex = resolve;
      });
      return index.apply(this, args);
    };
    const unload = KnowledgeHost.prototype.unloadModel;
    KnowledgeHost.prototype.unloadModel = async function () {
      if (!this.child) throw Error('Removal must unload a live ONNX consumer');
      if (globalThis.holdRagRemoval) {
        globalThis.removalCheck.ragRemoving = true;
        await new Promise((resolve) => {
          globalThis.releaseRagRemoval = resolve;
        });
      }
      await unload.call(this);
      globalThis.removalCheck.ragUnloaded = true;
      if (globalThis.holdRagRemoval)
        await new Promise((resolve) => {
          globalThis.releaseRagProbe = resolve;
        });
    };
    globalThis.restoreRemovalChecks = () => {
      globalThis.releaseIndex?.();
      globalThis.releaseRemoval?.();
      globalThis.releaseRagRemoval?.();
      globalThis.releaseSpeechProbe?.();
      globalThis.releaseRagProbe?.();
      SpeechHost.prototype.call = call;
      SpeechHost.prototype.close = close;
      KnowledgeHost.prototype.indexDocument = index;
      KnowledgeHost.prototype.unloadModel = unload;
    };
  });
  try {
    await page.evaluate(() => {
      window.removalImport = window.desktop.knowledge({
        op: 'import',
        requestId: 'removal-import',
        documentId: 'removal-doc',
        baseId: 'removal-base',
        name: 'synthetic.md',
        bytes: new TextEncoder().encode(
          '## Q: Removal evidence?\n\nKeep this synthetic knowledge and its index.',
        ),
      });
    });
    await waitForAsync(application, async () => globalThis.removalCheck.indexing);
    let state = await page.evaluate(() => window.desktop.components({ op: 'remove', id: 'rag' }));
    assert.match(state.error, /正在使用/);
    assert.equal(state.items.find((item) => item.id === 'rag').phase, 'ready');
    await application.evaluate(() => globalThis.releaseIndex());
    const imported = await page.evaluate(() => window.removalImport);
    assert.equal(imported.ok, true, imported.error);
    // Unknown top-level originals/directories must survive both deletion attempts.
    for (const directory of [false, true]) {
      await application.evaluate((_electron, directory) => {
        const fs = process.getBuiltinModule('fs');
        const file = globalThis.removalLocations.rag + '/protected-original';
        if (directory) fs.mkdirSync(file);
        else fs.writeFileSync(file, 'Synthetic original must survive');
      }, directory);
      state = await page.evaluate(() => window.desktop.components({ op: 'remove', id: 'rag' }));
      assert.ok(state.error);
      assert.equal(state.items.find((item) => item.id === 'rag').phase, 'ready');
      await application.evaluate((_electron, directory) => {
        const fs = process.getBuiltinModule('fs');
        const file = globalThis.removalLocations.rag + '/protected-original';
        if (directory) fs.rmdirSync(file);
        else {
          if (fs.readFileSync(file, 'utf8') !== 'Synthetic original must survive')
            throw Error('Original changed');
          fs.unlinkSync(file);
        }
      }, directory);
    }
    const reloaded = await page.evaluate(() =>
      window.desktop.knowledge({
        op: 'search',
        requestId: 'reload-before-removal',
        query: 'Removal evidence',
        topK: 5,
        mode: 'vector',
        baseId: 'removal-base',
      }),
    );
    assert.equal(reloaded.ok, true, reloaded.error);
    assert.ok(reloaded.value.length);
    await application.evaluate(() => {
      globalThis.holdRagRemoval = true;
      globalThis.removalCheck.ragUnloaded = false;
    });
    await page.evaluate(() => {
      window.ragRemovalTask = window.desktop.components({ op: 'remove', id: 'rag' });
    });
    await waitForAsync(application, async () => globalThis.removalCheck.ragRemoving);
    const blocked = await page.evaluate(() =>
      window.desktop.knowledge({
        op: 'import',
        requestId: 'blocked-import',
        documentId: 'blocked-doc',
        baseId: 'removal-base',
        name: 'blocked.md',
        bytes: new TextEncoder().encode('Must not enter the model during removal'),
      }),
    );
    assert.equal(blocked.ok, false);
    assert.match(blocked.error, /知识库检索.*尚未就绪/);
    await application.evaluate(() => globalThis.releaseRagRemoval());
    await waitForAsync(application, async () => globalThis.removalCheck.ragUnloaded);
    const ragFiles = await application.evaluate(() => globalThis.removalFiles.rag);
    assert.equal(probe('exclusive', ...ragFiles).exclusiveFiles, ragFiles.length);
    await application.evaluate(() => globalThis.releaseRagProbe());
    state = await page.evaluate(() => window.ragRemovalTask);
    assert.equal(state.error, null);
    assert.equal(state.items.find((item) => item.id === 'rag').phase, 'pending');
    assert.equal(await application.evaluate(() => globalThis.removalCheck.ragUnloaded), true);
    assert.equal(
      await application.evaluate(() =>
        process.getBuiltinModule('fs').existsSync(globalThis.removalLocations.rag),
      ),
      false,
    );
    assert.equal(
      (
        await page.evaluate(() =>
          window.desktop.dictation({ op: 'start', microphone: 'synthetic-mic' }),
        )
      ).state,
      'running',
    );
    state = await page.evaluate(() => window.desktop.components({ op: 'remove', id: 'speech' }));
    assert.match(state.error, /正在使用/);
    assert.equal(state.items.find((item) => item.id === 'speech').phase, 'ready');
    await page.evaluate(() => window.desktop.dictation({ op: 'stop' }));
    await page.evaluate(() => {
      window.removalTask = window.desktop.components({ op: 'remove', id: 'speech' });
    });
    await waitForAsync(application, async () => globalThis.removalCheck.closing);
    assert.equal(
      await page.evaluate(async () => {
        try {
          await window.desktop.dictation({ op: 'start' });
          return false;
        } catch {
          return true;
        }
      }),
      true,
      'New inference must be blocked throughout removal',
    );
    assert.equal(
      await page.evaluate(async () => {
        try {
          await window.desktop.components({ op: 'download', id: 'speech' });
          return false;
        } catch {
          return true;
        }
      }),
      true,
      'Download and removal must be mutually exclusive',
    );
    await application.evaluate(() => globalThis.releaseRemoval());
    await waitForAsync(application, async () => globalThis.removalCheck.speechExited);
    const speechFiles = await application.evaluate(() => globalThis.removalFiles.speech);
    assert.equal(probe('exclusive', ...speechFiles).exclusiveFiles, speechFiles.length);
    await application.evaluate(() => globalThis.releaseSpeechProbe());
    state = await page.evaluate(() => window.removalTask);
    assert.equal(state.error, null);
    assert.equal(await application.evaluate(() => globalThis.removalCheck.speechExited), true);
    assert.equal(
      await application.evaluate(() =>
        process.getBuiltinModule('fs').existsSync(globalThis.removalLocations.speech),
      ),
      false,
    );
    const preserved = await page.evaluate(() => window.desktop.knowledge({ op: 'status' }));
    assert.equal(preserved.ok, true);
    assert.ok(preserved.value.documents.some((item) => item.documentId === 'removal-doc'));
    await application.evaluate(({ session }) => {
      session
        .fromPartition('voxcue-components')
        .webRequest.onBeforeRequest((_details, callback) => callback({}));
    });
    if (restoreCached) {
      await restoreCached();
      state = await page.evaluate(() => window.desktop.components({ op: 'status' }));
    } else state = await page.evaluate(() => window.desktop.components({ op: 'download' }));
    assert.equal(state.phase, 'ready', state.error);
    await application.evaluate(({ session }) => {
      globalThis.removalNetworkAttempts = [];
      session.fromPartition('voxcue-components').webRequest.onBeforeRequest((details, callback) => {
        globalThis.removalNetworkAttempts.push(details.url);
        callback({ cancel: true });
      });
    });
    const speechReloaded = await page.evaluate(() =>
      window.desktop.dictation({
        op: 'start',
        microphone: 'synthetic-mic',
      }),
    );
    assert.equal(speechReloaded.state, 'running');
    assert.equal(
      (await page.evaluate(() => window.desktop.dictation({ op: 'stop' }))).state,
      'idle',
    );
    const recovered = await page.evaluate(() =>
      window.desktop.knowledge({
        op: 'search',
        requestId: 'removal-reload',
        query: 'Removal evidence',
        topK: 5,
        mode: 'hybrid',
        baseId: 'removal-base',
      }),
    );
    assert.equal(recovered.ok, true, recovered.error);
    assert.ok(recovered.value.length);
    const original = await page.evaluate(
      (itemId) =>
        window.desktop.knowledge({
          op: 'item',
          requestId: 'removal-original',
          itemId,
        }),
      recovered.value[0].itemId,
    );
    assert.equal(original.ok, true, original.error);
    assert.match(original.value.content, /Keep this synthetic knowledge and its index/);
    assert.deepEqual(await application.evaluate(() => globalThis.removalNetworkAttempts), []);
    console.log(
      `PASS: live Windows ONNX unload, speech process exit, locked-operation guards, protected originals, model deletion/${restoreCached ? 'verified local restore' : 'redownload'} and preserved knowledge/index.`,
    );
  } finally {
    await application.evaluate(() => globalThis.restoreRemovalChecks());
  }
}
