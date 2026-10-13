import { _electron as electron } from 'playwright';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

await mkdir('test-results', { recursive: true });
const profile = await mkdtemp(path.resolve('test-results/portable-current-'));
const env = { ...process.env, COPILOT_TEST_USER_DATA: profile, VITE_DEV_SERVER_URL: '' };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  executablePath: path.resolve('release-smoke/VoxCue-win32-x64/VoxCue.exe'),
  args: [],
  env,
});
try {
  const page = await app.firstWindow();
  await page.getByRole('button', { name: 'Continue with ChatGPT', exact: true }).waitFor();
  assert.equal(await page.evaluate(() => 'retrieval' in window.desktop), false);
  const report = await app.evaluate(async ({ app, utilityProcess }) => {
    const require = process
      .getBuiltinModule('module')
      .createRequire(app.getAppPath() + '/package.json');
    const fs = require('node:fs');
    const path = require('node:path');
    const { Worker } = require('node:worker_threads');
    const unpacked = app.getAppPath().replace(/app\.asar$/, 'app.asar.unpacked');
    const speech = path.join(unpacked, 'dist-electron/backend/speech');
    const model = path.join(process.resourcesPath, 'models/speech');
    const helper = path.join(process.resourcesPath, 'native/VoxCue.Audio.exe');
    const worker = new Worker(path.join(speech, 'worker.js'));
    let workerLoaded = false;
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
    } finally {
      await worker.terminate();
    }
    const child = utilityProcess.fork(path.join(speech, 'process.js'), [], {
      serviceName: 'VoxCue package verification',
      stdio: 'pipe',
    });
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
    return {
      packaged: app.isPackaged,
      workerLoaded,
      statuses,
      nativeHelper: fs.existsSync(helper),
      models: fs.readdirSync(path.join(process.resourcesPath, 'models')),
      noOldBackend: !fs.existsSync(path.join(unpacked, 'dist-electron/backend/retrieval')),
    };
  });
  assert.equal(report.packaged, true);
  assert.equal(report.workerLoaded, true);
  assert.equal(report.nativeHelper, true);
  assert.equal(report.noOldBackend, true);
  assert.deepEqual(report.models, ['speech']);
  assert.deepEqual(report.statuses, ['idle']);
  await page.screenshot({ path: path.join(profile, 'login.png'), animations: 'disabled' });
  await writeFile(path.join(profile, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ profile, ...report }));
} finally {
  await app.close();
}
