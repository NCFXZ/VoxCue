import {
  testRoot,
  electron,
  spawnTestProcess,
} from '../../../shared/test/scripts/test-workspace.mjs';
import { mkdir, mkdtemp } from 'node:fs/promises';

import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { offlineElectronEntry } from '../../../shared/test/scripts/offline-electron-entry.mjs';

await mkdir(path.join(testRoot, 'test/results'), { recursive: true });
const output = await mkdtemp(path.resolve(path.join(testRoot, 'test/results/launcher-native-')));
const executable = path.resolve('VoxCue.app/Contents/MacOS/VoxCue');
assert.equal(
  execFileSync(
    '/usr/libexec/PlistBuddy',
    ['-c', 'Print :LSMinimumSystemVersion', path.resolve('VoxCue.app/Contents/Info.plist')],
    { encoding: 'utf8' },
  ).trim(),
  '14.2',
);
const env = { ...process.env, COPILOT_TEST_USER_DATA: output, VITE_DEV_SERVER_URL: '' };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ executablePath: executable, args: [], env });
const testProcess = app.process();
try {
  const page = await app.firstWindow();
  await page.getByRole('heading', { name: '登录 VoxCue', exact: true }).waitFor();
  const application = await app.evaluate(({ app }) => ({
    path: app.getAppPath(),
    packaged: app.isPackaged,
    name: app.getName(),
    loadedWindowsModules: Object.keys(
      process.getBuiltinModule('module').createRequire(app.getAppPath() + '/package.json').cache,
    ).filter((file) => file.includes('/dist-electron/windows/')).length,
  }));
  assert.equal(application.path, process.cwd());
  assert.equal(application.packaged, false);
  assert.equal(application.name, 'VoxCue');
  assert.equal(application.loadedWindowsModules, 0);
  await app.evaluate(({ app, BrowserWindow }) => {
    app.once('second-instance', () => {
      globalThis.launcherRefocused = true;
    });
    BrowserWindow.getAllWindows()[0].minimize();
  });
  // This second launch is uninstrumented. Load main immediately, as the
  // development launcher does, so it checks the single-instance lock before ready.
  const second = spawnTestProcess(
    executable,
    [await offlineElectronEntry(), '--use-mock-keychain'],
    { env, stdio: ['ignore', 'ignore', 'pipe'] },
  );
  // Capture only the owned, offline secondary process. Keep a bounded tail so
  // its last native diagnostic survives without buffering arbitrary output.
  let stderr = '';
  second.stderr.setEncoding('utf8');
  second.stderr.on('data', (text) => { stderr = (stderr + text).slice(-4096); });
  const diagnostic = () => {
    const message = stderr.replaceAll(process.cwd(), '<workspace>').replaceAll(testRoot, '<test>');
    return JSON.stringify({ primaryPid: testProcess.pid, secondaryPid: second.pid,
      code: second.exitCode, signal: second.signalCode, stderr: message });
  };
  const exit = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      second.kill();
      reject(Error('Second launcher did not exit: ' + diagnostic()));
    }, 10000);
    second.once('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
    second.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
  assert.deepEqual(exit, { code: 0, signal: null }, 'Second launcher exit: ' + diagnostic());
  await page.waitForFunction(() => document.visibilityState === 'visible');
  assert.equal(await app.evaluate(() => globalThis.launcherRefocused), true);
  assert.equal(app.windows().length, 1);
  await app.close();
  await console.log(
    JSON.stringify(
      {
        status: 'passed',
        application,
        secondLaunchFocusedExistingWindow: true,
        noTerminalOrBuildOnLaunch: true,
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ status: 'passed', output }));
} catch (error) {
  await console.log(JSON.stringify({ status: 'failed', error: String(error) }, null, 2));
  throw error;
} finally {
  if (testProcess.exitCode === null) testProcess.kill();
}
