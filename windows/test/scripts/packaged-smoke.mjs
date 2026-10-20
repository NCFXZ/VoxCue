import { waitForAsync } from '../../../shared/test/scripts/wait-for-async.mjs';
import { closeUiApp } from '../../../shared/test/scripts/install-ui-account.mjs';
import { checkComponents } from './components-check.mjs';
import { checkComponentRemoval } from './component-removal-check.mjs';
import { prepareSpeechFixtures } from '../../../shared/test/scripts/model-fixtures.mjs';
import { testRoot, electron } from '../../../shared/test/scripts/test-workspace.mjs';
import { mkdir, mkdtemp, readFile, cp } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { lstatSync, realpathSync, readFileSync } from 'node:fs';
import os from 'node:os';
const fixtures = createRequire(import.meta.url)('../../../shared/test/scripts/rag-fixtures.cjs');
const asar = createRequire(import.meta.url)('@electron/asar');
const testPackage = process.argv
  .find((argument) => argument.startsWith('--test-package='))
  ?.slice('--test-package='.length);
const packageRoot = path.resolve(
  testPackage ??
    (process.argv.includes('--installer-stage')
      ? 'release/installer-stage/VoxCue-win32-x64'
      : 'release-smoke/VoxCue-win32-x64'),
);
if (testPackage) {
  const parent = path.dirname(path.dirname(packageRoot));
  if (
    path.dirname(parent) !== realpathSync(os.tmpdir()) ||
    !path.basename(parent).startsWith('voxcue-test-run-') ||
    !path.basename(path.dirname(packageRoot)).startsWith('platform-layout-') ||
    path.basename(packageRoot) !== 'VoxCue-win32-x64' ||
    lstatSync(parent).isSymbolicLink() ||
    realpathSync(parent) !== parent
  )
    throw Error('Unexpected test package');
  const owner = JSON.parse(readFileSync(path.join(parent, '.voxcue-test-owner.json'), 'utf8'));
  if (owner.kind !== 'voxcue-test-run-' || !Number.isSafeInteger(owner.pid) || owner.pid <= 0)
    throw Error('Unknown test package owner');
  process.kill(owner.pid, 0);
}
const archive = path.join(packageRoot, 'resources/app.asar');
const entries = asar
  .listPackage(archive)
  .map((file) => file.replaceAll('\\', '/').replace(/^\//, ''));
assert.ok(
  !entries.some((file) =>
    /node_modules\/(?:onnxruntime-web(?:\/|$)|@github\/copilot-sdk(?:\/|-)|koffi(?:\/|$))/.test(
      file,
    ),
  ),
);
assert.ok(
  !entries.some((file) =>
    /(?:dist-electron\/macos\/|backend\/copilot\/|Sparkle|sf-symbols)/i.test(file),
  ),
);
assert.ok(
  !entries.some((file) => /\.(?:dylib|so(?:\.\d+)*|icns)$|\.framework\//i.test(file)),
  'Foreign platform native libraries must not enter the Windows package',
);
for (const dependency of [
  '@ennuicastr/webrtcaec3.js',
  'adm-zip',
  'onnxruntime-node',
  'sherpa-onnx-win-x64',
  '@lancedb/lancedb',
])
  assert.ok(
    entries.some((file) => file.includes('node_modules/' + dependency + '/')),
    dependency,
  );
for (const file of ['dist/webrtcaec3-0.3.0.js', 'dist/webrtcaec3-0.3.0.wasm', 'license.js'])
  assert.ok(entries.includes('node_modules/@ennuicastr/webrtcaec3.js/' + file), file);
assert.deepEqual(
  JSON.parse(await readFile(path.join(packageRoot, 'resources/voxcue-components.json'), 'utf8')),
  { schemaVersion: 1 },
);
assert.equal(
  (await import('node:fs')).existsSync(path.join(packageRoot, 'resources/models')),
  false,
);
assert.equal(
  entries.some((file) => /(?:^|\/)sprintf-js\//.test(file)),
  false,
  'Unused vulnerable CLI dependency must not be packaged',
);
const sharpPackages = entries
  .filter((file) => /(?:^|\/)sharp\/package\.json$/.test(file))
  .map((file) => {
    const pkg = JSON.parse(asar.extractFile(archive, path.normalize(file)));
    const [major, minor, patch] = pkg.version.split('.').map(Number);
    assert.ok(
      major > 0 || minor > 35 || (minor === 35 && patch >= 5),
      `Vulnerable sharp ${pkg.version} at ${file}`,
    );
    return { file, version: pkg.version };
  });

await mkdir(path.join(testRoot, 'test/results'), { recursive: true });
const profile = await mkdtemp(path.resolve(path.join(testRoot, 'test/results/portable-current-')));
const speechFixtures = process.env.VOXCUE_SPEECH_FIXTURE_DIR ?? (await prepareSpeechFixtures());
const env = { ...process.env, COPILOT_TEST_USER_DATA: profile, VITE_DEV_SERVER_URL: '' };
delete env.ELECTRON_RUN_AS_NODE;
let app = await electron.launch({
  executablePath: path.join(packageRoot, 'VoxCue.exe'),
  args: [],
  env,
});
try {
  let { page, errors } = await checkComponents(app);
  assert.equal(await page.evaluate(() => 'retrieval' in window.desktop), false);
  assert.deepEqual(errors, []);
  await closeUiApp(app);
  // Replace the application in a new location while retaining only this run's cache.
  // The source package stays available to the caller's subsequent native checks.
  const replacement = path.join(testRoot, 'replacement/VoxCue-win32-x64');
  await cp(packageRoot, replacement, { recursive: true });
  app = await electron.launch({
    executablePath: path.join(replacement, 'VoxCue.exe'),
    args: [],
    env,
  });
  await app.evaluate(({ session }) => {
    globalThis.componentRequests = [];
    session.fromPartition('voxcue-components').webRequest.onBeforeRequest((details, callback) => {
      globalThis.componentRequests.push(details.url);
      callback({ cancel: true });
    });
  });
  page = await app.firstWindow();
  await waitForAsync(
    page,
    async () => (await window.desktop.components({ op: 'status' })).phase === 'ready',
    undefined,
    { timeout: 30000 },
  );
  assert.deepEqual(await app.evaluate(() => globalThis.componentRequests), []);
  const report = await app.evaluate(
    async ({ app, utilityProcess }, fixture) => {
      const require = process
        .getBuiltinModule('module')
        .createRequire(app.getAppPath() + '/package.json');
      const fs = require('node:fs');
      const path = require('node:path');
      const { Worker } = require('node:worker_threads');
      const unpacked = app.getAppPath().replace(/app\.asar$/, 'app.asar.unpacked');
      const speech = path.join(unpacked, 'dist-electron/shared/electron/backend/speech');
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
      const model = models.speechModels;
      const helper = path.join(process.resourcesPath, 'native/VoxCue.Audio.exe');
      const worker = new Worker(path.join(speech, 'worker.js'));
      let workerLoaded = false;
      let speechGapReset = false;
      let speechDecoded = false;
      try {
        await new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(Error('Packaged ASR Worker timeout')), 45000);
          worker.once('error', (error) => {
            clearTimeout(timer);
            reject(error);
          });
          worker.on('message', (message) => {
            if (message.ready || message.error) {
              clearTimeout(timer);
              message.error ? reject(Error(message.error)) : resolve();
            }
          });
          worker.postMessage({
            op: 'init',
            directory: model,
            preprocessorFile: path.join(
              unpacked,
              'dist-electron/windows/electron/speech/echoCancellation.js',
            ),
          });
        });
        workerLoaded = true;
        await new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(Error('Packaged AEC prepare timeout')), 10000);
          const listener = (message) => {
            if (message.prepared !== 9 && !message.error) return;
            clearTimeout(timer);
            worker.off('message', listener);
            message.error ? reject(Error(message.error)) : resolve();
          };
          worker.on('message', listener);
          worker.postMessage({ op: 'prepare', id: 9, sources: ['system', 'microphone'] });
        });
        await new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(Error('Packaged ASR gap reset timeout')), 15000);
          const listener = (message) => {
            if (message.flushed === 7 || message.error) {
              clearTimeout(timer);
              worker.off('message', listener);
              message.error ? reject(Error(message.error)) : resolve();
            }
          };
          worker.on('message', listener);
          worker.postMessage({
            op: 'audio',
            source: 'system',
            samples: new Float32Array(1600),
            rate: 16000,
            timestamp: Date.now(),
            sequence: 1,
            ms: 100,
          });
          worker.postMessage({ op: 'gap', source: 'system' });
          worker.postMessage({
            op: 'audio',
            source: 'system',
            samples: new Float32Array(1600),
            rate: 16000,
            timestamp: Date.now(),
            sequence: 2,
            ms: 100,
          });
          worker.postMessage({
            op: 'audio',
            source: 'microphone',
            samples: new Float32Array(883),
            rate: 44100,
            timestamp: Date.now(),
            captureClock: 100,
            sequence: 3,
            ms: 20,
          });
          worker.postMessage({
            op: 'audio',
            source: 'microphone',
            samples: new Float32Array(883),
            rate: 44100,
            timestamp: Date.now(),
            sequence: 4,
            ms: 20,
          });
          worker.postMessage({ op: 'flush', id: 7, reason: 'pause' });
        });
        speechGapReset = true;
        const audioFile = path.join(app.getPath('userData'), 'synthetic-english.wav');
        fs.writeFileSync(audioFile, Buffer.from(fixture.english));
        const wave = require('sherpa-onnx-node').readWave(audioFile, false);
        await new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(Error('Packaged speech decode timeout')), 15000);
          const listener = (message) => {
            if (
              message.event?.type === 'segment' &&
              message.event.segment.final &&
              message.event.segment.text.trim()
            )
              speechDecoded = true;
            if (message.flushed !== 8 && !message.error) return;
            clearTimeout(timer);
            worker.off('message', listener);
            message.error ? reject(Error(message.error)) : resolve();
          };
          worker.on('message', listener);
          for (let offset = 0; offset < wave.samples.length; offset += 512) {
            const samples = wave.samples.slice(offset, offset + 512);
            worker.postMessage({
              op: 'audio',
              source: 'system',
              samples,
              rate: wave.sampleRate,
              timestamp: Date.now(),
              sequence: offset + 3,
              ms: (samples.length / wave.sampleRate) * 1000,
            });
          }
          worker.postMessage({ op: 'flush', id: 8, reason: 'stop' });
        });
      } finally {
        await worker.terminate();
      }
      const child = utilityProcess.fork(
        path.join(unpacked, 'dist-electron/windows/electron/speech/process.js'),
        [],
        {
          serviceName: 'VoxCue package verification',
          stdio: 'pipe',
        },
      );
      const statuses = [];
      try {
        await new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(Error('Packaged utilityProcess timeout')), 15000);
          child.once('exit', (code) => {
            clearTimeout(timer);
            reject(Error('Exited: ' + code));
          });
          child.on('message', (message) => {
            if (message.error) {
              clearTimeout(timer);
              reject(Error(message.error));
            } else if (message.id === 'init')
              child.postMessage({ id: 'status', call: { op: 'status' } });
            else if (message.id === 'status') {
              clearTimeout(timer);
              statuses.push(message.value.state);
              resolve();
            }
          });
          child.postMessage({ id: 'init', init: true, model, helper });
        });
      } finally {
        child.kill();
      }
      const { KnowledgeHost } = require(
        app.getAppPath() + '/dist-electron/shared/electron/backend/knowledge/host.js',
      );
      const directory = path.join(app.getPath('userData'), 'rag-package-verification'),
        ragModel = models.ragModel;
      let knowledge = new KnowledgeHost(directory, ragModel);
      const signal = () => new AbortController().signal;
      const input = {
        documentId: 'sensor',
        baseId: 'packaged',
        name: 'sensor.md',
        bytes: Buffer.from(
          '## Q001. PID sensor lift-off control?\n\n' +
            'PID feedback sensor control. '.repeat(120) +
            ' tailxyz is 37.\n\n### 追问 1：如何限幅？\n\n输出限制为 2。',
        ),
      };
      let rag;
      try {
        const starting = knowledge.initialize();
        knowledge.child.stderr.on('data', (d) => process.stderr.write(d));
        await starting;
        await knowledge.indexDocument(input, signal());
        await knowledge.indexDocument(
          {
            documentId: 'pdf',
            baseId: 'packaged',
            name: 'fixture.pdf',
            bytes: new Uint8Array(fixture.pdf),
          },
          signal(),
        );
        await knowledge.indexDocument(
          {
            documentId: 'docx',
            baseId: 'packaged',
            name: 'fixture.docx',
            bytes: new Uint8Array(fixture.docx),
          },
          signal(),
        );
        const modes = [];
        for (const mode of ['keyword', 'vector', 'hybrid']) {
          const hits = await knowledge.search('PID sensor 提离 control', 5, mode, signal());
          const item = await knowledge.getItem(hits[0].itemId);
          if (!item.content.includes('tailxyz') || !item.content.includes('限制为 2'))
            throw Error('Packaged full QA retrieval failed');
          modes.push(mode);
        }
        const pdfHits = await knowledge.search('gain', 5, 'keyword', signal());
        if (pdfHits[0].page !== 2) throw Error('Packaged PDF page metadata failed');
        await knowledge.close();
        knowledge = new KnowledgeHost(directory, ragModel);
        if ((await knowledge.listDocuments()).length !== 3) throw Error('Packaged restart failed');
        await knowledge.removeDocument('sensor', signal());
        if ((await knowledge.search('tailxyz', 5, 'keyword', signal())).length)
          throw Error('Packaged delete failed');
        rag = {
          status: 'passed',
          modes,
          pdf: true,
          docx: true,
          offlineModel: true,
          restart: true,
          delete: true,
          wholeQa: true,
        };
      } finally {
        await knowledge.close();
      }
      const { InterviewContext } = require(
        path.join(
          app.getAppPath(),
          'dist-electron/shared/electron/application/interviewContext.js',
        ),
      );
      const context = new InterviewContext();
      context.event({
        type: 'segment',
        segment: {
          id: 'package-fixture',
          source: 'microphone',
          text: 'Synthetic packaged answer',
          final: true,
          startMs: Date.now(),
          endMs: Date.now(),
        },
      });
      const interviewContext = context
        .prepare('package-question', 'Synthetic follow-up')
        .turns[0].content.includes('interviewee');
      return {
        speechDecoded,
        speechModelFiles: fs.readdirSync(model).sort(),
        qwenBackendPresent: typeof require(path.join(speech, 'qwen.js')).QwenEngine === 'function',
        qwenComponent: packagesFor(process.platform, process.arch)
          .filter((item) => item.id === 'qwen')
          .map((item) => ({
            optional: item.optional,
            assets: item.parts.map((part) => part.asset),
          })),
        retiredSpeechBackendAbsent: !fs
          .readdirSync(speech)
          .some((file) => /^(qwen(?!\.js$)|compute\.)/i.test(file)),
        speechGapReset,
        interviewContext,
        rag,
        packaged: app.isPackaged,
        workerLoaded,
        statuses,
        nativeHelper: fs.existsSync(helper),
        models: fs.readdirSync(path.join(app.getPath('userData'), 'component-cache')),
        noOldBackend: !fs.existsSync(
          path.join(unpacked, 'dist-electron/shared/electron/backend/retrieval'),
        ),
      };
    },
    {
      pdf: Array.from(fixtures.pdf()),
      docx: Array.from(await fixtures.docx()),
      english: Array.from(await readFile(path.join(speechFixtures, 'english.wav'))),
    },
  );
  assert.equal(report.packaged, true);
  assert.equal(report.workerLoaded, true);
  assert.equal(report.speechDecoded, true);
  assert.equal(report.qwenBackendPresent, true);
  assert.deepEqual(report.qwenComponent, [
    {
      optional: true,
      assets: [
        'VoxCue-Qwen-ASR-1.0.0.zip',
        'VoxCue-Qwen-Aligner-1.0.0.zip',
        'VoxCue-Qwen-Windows-x64-Runtime-1.0.0.zip',
      ],
    },
  ]);
  assert.equal(report.retiredSpeechBackendAbsent, true);
  assert.deepEqual(
    report.speechModelFiles,
    [
      'decoder.int8.onnx',
      'encoder.int8.onnx',
      'LICENSE-sherpa.txt',
      'LICENSE-silero.txt',
      'manifest.json',
      'NOTICE.txt',
      'README.md',
      'silero_vad.onnx',
      'tokens.txt',
    ].sort(),
  );
  assert.equal(report.speechGapReset, true);
  assert.equal(report.interviewContext, true);
  assert.equal(report.nativeHelper, true);
  assert.equal(report.noOldBackend, true);
  assert.equal(report.models.length, 2);
  assert.ok(report.models.every((name) => /^(speech|rag)-1\.0\.0-[a-f0-9]{64}$/.test(name)));
  assert.deepEqual(await app.evaluate(() => globalThis.componentRequests), []);
  assert.equal(report.rag.status, 'passed');
  assert.deepEqual(report.statuses, ['idle']);
  await page.screenshot({ animations: 'disabled' });
  report.dependencyAudit = { sprintfJsAbsent: true, sharpPackages };
  await console.log(JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ profile, ...report }));
  await checkComponentRemoval(app, page);
} finally {
  await closeUiApp(app);
}
