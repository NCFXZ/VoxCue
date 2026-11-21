import {
  testRoot,
  electron,
  spawnTestProcess,
} from '../../../shared/test/scripts/test-workspace.mjs';
import { mkdir, mkdtemp, readFile, realpath } from 'node:fs/promises';

import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { offlineElectronEntry } from '../../../shared/test/scripts/offline-electron-entry.mjs';
import workspace from '../../../shared/scripts/workspace.mjs';
import { verifyLocalApp } from '../../scripts/development-signing.mjs';
import { verifyFixedVaultCredentials } from '../../scripts/build-vault-credentials.mjs';
import { productionFuses } from '../../scripts/production-runtime.mjs';
import { prepareRuntime } from '../../scripts/prepare-runtime.mjs';

await mkdir(path.join(testRoot, 'test/results'), { recursive: true });
const output = await mkdtemp(path.resolve(path.join(testRoot, 'test/results/launcher-native-')));
const bundle = path.resolve('VoxCue.app');
const mode = process.argv.slice(2);
if (mode.length > 1 || mode.some(arg => !['--static-only', '--host-only'].includes(arg)))
  throw Error('Use either --static-only, --host-only, or no argument.');
if (!process.argv.includes('--host-only')) {
  const pin = JSON.parse(await readFile('local-signing-public.json', 'utf8'));
  const version = JSON.parse(await readFile(path.join(workspace.sharedRoot, 'package.json'), 'utf8')).version;
  verifyLocalApp(bundle, pin, 'com.voxcue.app');
  const signature = spawnSync('/usr/bin/codesign', ['-d', '--verbose=4', bundle], { encoding: 'utf8' });
  assert.equal(signature.status, 0);
  assert.match(signature.stderr, /flags=.*\bruntime\b/);
  await productionFuses(path.join(bundle, 'Contents/Frameworks/Electron Framework.framework/Electron Framework'));
  const info = JSON.parse(execFileSync('/usr/bin/plutil', [
    '-convert', 'json', '-o', '-', path.join(bundle, 'Contents/Info.plist'),
  ]));
  assert.equal(info.CFBundleExecutable, 'VoxCue');
  assert.equal(info.CFBundleIdentifier, 'com.voxcue.app');
  assert.equal(info.CFBundleShortVersionString, version);
  assert.equal(info.LSMinimumSystemVersion, '14.2');
  // The workspace entry may link to the local bundle. Inside it the fixed
  // helper still requires canonical, non-redirected directories and file.
  const resources = path.join(await realpath(bundle), 'Contents/Resources');
  await verifyFixedVaultCredentials(path.join(resources, 'native/VoxCue'), pin);
  const archive = path.join(resources, 'app.asar');
  const asar = await import(workspace.platformRequire.resolve('@electron/asar'));
  const manifest = JSON.parse(asar.extractFile(archive, 'package.json'));
  assert.equal(manifest.version, version);
  assert.equal(manifest.main, 'dist-electron/shared/electron/main.js');
  assert.ok(asar.statFile(archive, manifest.main).size > 0);
  assert.deepEqual(info.ElectronAsarIntegrity['Resources/app.asar'], {
    algorithm: 'SHA256',
    hash: createHash('sha256').update(asar.getRawHeader(archive).headerString).digest('hex'),
  });
  console.log('PASS product entry, fixed signature, frozen v11 helper, version and sealed ASAR.');
}
if (process.argv.includes('--static-only')) process.exit(0);
const { executable } = await prepareRuntime();
const env = { ...process.env, COPILOT_TEST_USER_DATA: output, VITE_DEV_SERVER_URL: '' };
delete env.ELECTRON_RUN_AS_NODE;
const entry = await offlineElectronEntry();
const app = await electron.launch({ executablePath: executable, args: [entry], env });
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
  // Both processes use this run's isolated profile and development host.
  const second = spawnTestProcess(
    executable,
    [entry, '--use-mock-keychain'],
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
        host: 'offline-development',
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
