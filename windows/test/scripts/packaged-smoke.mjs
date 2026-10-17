import { closeUiApp } from '../../../shared/test/scripts/install-ui-account.mjs';
import { _electron as electron } from 'playwright';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
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
if (
  testPackage &&
  (path.dirname(path.dirname(packageRoot)) !== path.resolve('test/results') ||
    !path.basename(path.dirname(packageRoot)).startsWith('platform-layout-') ||
    path.basename(packageRoot) !== 'VoxCue-win32-x64')
)
  throw Error('Unexpected test package');
const archive = path.join(packageRoot, 'resources/app.asar');
const entries = asar
  .listPackage(archive)
  .map((file) => file.replaceAll('\\', '/').replace(/^\//, ''));
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

await mkdir('test/results', { recursive: true });
const profile = await mkdtemp(path.resolve('test/results/portable-current-'));
const env = { ...process.env, COPILOT_TEST_USER_DATA: profile, VITE_DEV_SERVER_URL: '' };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  executablePath: path.join(packageRoot, 'VoxCue.exe'),
  args: [],
  env,
});
try {
  const page = await app.firstWindow();
  await page.getByRole('button', { name: '使用 ChatGPT 继续', exact: true }).waitFor();
  assert.equal(await page.evaluate(() => 'retrieval' in window.desktop), false);
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
      const model = path.join(process.resourcesPath, 'models/speech');
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
          worker.postMessage({ op: 'init', directory: model });
        });
        workerLoaded = true;
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
        ragModel = path.join(process.resourcesPath, 'models/rag/multilingual-e5-small');
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
        knowledge.child.stderr.on('data', (d) =>
          fs.appendFileSync(path.join(app.getPath('userData'), 'rag-fixture-utility.log'), d),
        );
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
        retiredSpeechBackendAbsent: !fs
          .readdirSync(speech)
          .some((file) => /^(qwen|compute\.)/i.test(file)),
        speechGapReset,
        interviewContext,
        rag,
        packaged: app.isPackaged,
        workerLoaded,
        statuses,
        nativeHelper: fs.existsSync(helper),
        models: fs.readdirSync(path.join(process.resourcesPath, 'models')),
        noOldBackend: !fs.existsSync(
          path.join(unpacked, 'dist-electron/shared/electron/backend/retrieval'),
        ),
      };
    },
    {
      pdf: Array.from(fixtures.pdf()),
      docx: Array.from(await fixtures.docx()),
      english: Array.from(await readFile('../shared/test/fixtures/speech-audio/english.wav')),
    },
  );
  assert.equal(report.packaged, true);
  assert.equal(report.workerLoaded, true);
  assert.equal(report.speechDecoded, true);
  assert.equal(report.retiredSpeechBackendAbsent, true);
  assert.deepEqual(
    report.speechModelFiles,
    [
      'decoder.int8.onnx',
      'encoder.int8.onnx',
      'LICENSE-sherpa.txt',
      'LICENSE-silero.txt',
      'manifest.json',
      'README.md',
      'silero_vad.onnx',
      'tokens.txt',
    ].sort(),
  );
  assert.equal(report.speechGapReset, true);
  assert.equal(report.interviewContext, true);
  assert.equal(report.nativeHelper, true);
  assert.equal(report.noOldBackend, true);
  assert.deepEqual(report.models.sort(), ['rag', 'speech']);
  assert.equal(report.rag.status, 'passed');
  assert.deepEqual(report.statuses, ['idle']);
  await page.screenshot({ path: path.join(profile, 'login.png'), animations: 'disabled' });
  report.dependencyAudit = { sprintfJsAbsent: true, sharpPackages };
  await writeFile(path.join(profile, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ profile, ...report }));
} finally {
  await closeUiApp(app);
}
