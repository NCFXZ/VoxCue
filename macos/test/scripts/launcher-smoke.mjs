import {
  testRoot,
  electron,
  spawnTestProcess,
} from '../../../shared/test/scripts/test-workspace.mjs';
import { mkdir, mkdtemp } from 'node:fs/promises';

import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

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
  const second = spawnTestProcess(executable, [], { env, stdio: 'ignore' });
  const code = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      second.kill();
      reject(Error('Second launcher did not exit'));
    }, 10000);
    second.once('exit', (code) => {
      clearTimeout(timer);
      resolve(code);
    });
    second.once('error', reject);
  });
  assert.equal(code, 0);
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
