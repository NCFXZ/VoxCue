import { testRoot, electron } from '../../../shared/test/scripts/test-workspace.mjs';
import { mkdtemp, mkdir } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { closeUiApp } from '../../../shared/test/scripts/install-ui-account.mjs';

// Windows regression only: real native loading/enumeration, no audio capture.
assert.equal(process.platform, 'win32', 'This native smoke requires Windows x64.');
assert.equal(process.arch, 'x64', 'This native smoke requires Windows x64.');
await mkdir(path.join(testRoot, 'test/results'), { recursive: true });
const profile = await mkdtemp(path.resolve(path.join(testRoot, 'test/results/platform-native-')));
const env = { ...process.env, COPILOT_TEST_USER_DATA: profile, VITE_DEV_SERVER_URL: '' };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: ['.'], env });
try {
  const page = await app.firstWindow();
  await page.getByRole('button', { name: '使用 ChatGPT 继续', exact: true }).waitFor();
  const report = await app.evaluate(async ({ app }) => {
    const require = process
      .getBuiltinModule('module')
      .createRequire(app.getAppPath() + '/package.json');
    const path = require('node:path');
    const { Worker } = require('node:worker_threads');
    const root = app.getAppPath();
    const { selectDesktopPlatform, desktopResources } = require(
      path.join(root, 'dist-electron/shared/electron/platform'),
    );
    const resources = desktopResources(
      {
        appPath: root,
        resourcesPath: process.resourcesPath,
        packaged: app.isPackaged,
      },
      selectDesktopPlatform(),
    );
    const { SpeechHost } = require(
      path.join(root, 'dist-electron/shared/electron/backend/speech/host.js'),
    );
    const host = new SpeechHost(
      resources.speechModels,
      resources.audioHelper,
      () => {},
      resources.speechProcess,
    );
    const worker = new Worker(
      path.join(root, 'dist-electron/shared/electron/backend/speech/worker.js'),
    );
    let timer;
    try {
      const ready = new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(Error('Native Worker load timeout')), 45000);
        worker.once('error', reject);
        worker.on('message', (message) => {
          if (message.error) reject(Error(message.error));
          else if (message.ready) resolve(true);
        });
      });
      worker.postMessage({ op: 'init', directory: resources.speechModels });
      await ready;
      clearTimeout(timer);
      // This starts utilityProcess and runs only helper "devices", never Start/read.
      const status = await host.call({ op: 'devices' });
      if (!Array.isArray(status.devices)) throw Error('Native device inventory was not returned');
      return {
        workerLoaded: true,
        utilityProcessState: status.state,
        deviceCount: status.devices.length,
        audioCaptureStarted: false,
        packaged: app.isPackaged,
      };
    } finally {
      clearTimeout(timer);
      await worker.terminate();
      host.stop();
    }
  });
  assert.equal(report.workerLoaded, true);
  assert.equal(report.utilityProcessState, 'idle');
  await console.log(JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report, profile }, null, 2));
} finally {
  await closeUiApp(app);
}
