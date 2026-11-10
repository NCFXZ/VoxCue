import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { testRoot, electron } from '../../../shared/test/scripts/test-workspace.mjs';
import { closeUiApp } from '../../../shared/test/scripts/install-ui-account.mjs';
import { offlineElectronEntry } from '../../../shared/test/scripts/offline-electron-entry.mjs';

const executable = path.join(testRoot, 'ScreenshotMonitorProbe.exe');
const compiled = spawnSync(
  path.join(process.env.WINDIR, 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'),
  [
    '/nologo',
    '/platform:x64',
    '/target:exe',
    '/main:ScreenshotMonitorProbe',
    '/r:System.Drawing.dll',
    '/out:' + executable,
    path.resolve('native/Screenshot.cs'),
    path.resolve('test/fixtures/ScreenshotMonitorProbe.cs'),
  ],
  { encoding: 'utf8', windowsHide: true, timeout: 30000 },
);
assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr);
const result = spawnSync(executable, [], { encoding: 'utf8', windowsHide: true, timeout: 10000 });
assert.equal(result.status, 0, result.stdout + result.stderr);
console.log(result.stdout.trim());
const entry = path.join(testRoot, 'monitor-window.cjs');
await writeFile(
  entry,
  `
const {app,BrowserWindow}=require('electron');
app.setPath('userData',process.env.COPILOT_TEST_USER_DATA);
app.setPath('sessionData',process.env.COPILOT_TEST_USER_DATA);
app.whenReady().then(async()=>{
  globalThis.monitorWindow=new BrowserWindow({width:640,height:240,frame:false,
    webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});
  await globalThis.monitorWindow.loadURL('data:text/html,<p>Synthetic monitor geometry</p>');
});
`,
);
const app = await electron.launch({
  args: [await offlineElectronEntry(entry)],
  env: {
    ...process.env,
    COPILOT_TEST_USER_DATA: path.join(testRoot, 'profile'),
    VITE_DEV_SERVER_URL: '',
  },
});
try {
  await (
    await app.firstWindow()
  )
    .getByText('Synthetic monitor geometry', { exact: true })
    .waitFor();
  const handle = await app.evaluate(() =>
    globalThis.monitorWindow.getNativeWindowHandle().readBigUInt64LE().toString(),
  );
  const read = () => {
    const native = spawnSync(executable, [handle], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 10000,
    });
    assert.equal(native.status, 0, native.stdout + native.stderr);
    const geometry = native.stdout.split(/\r?\n/).find((line) => line.startsWith('WINDOW:'));
    assert.ok(geometry, 'The production Win32 geometry path must return its owned monitor');
    return geometry;
  };
  const shown = read();
  await app.evaluate(() => globalThis.monitorWindow.hide());
  assert.equal(await app.evaluate(() => globalThis.monitorWindow.isVisible()), false);
  assert.equal(read(), shown, 'Hiding the owned window must preserve its native screenshot target');
  console.log(
    'PASS: production Win32 window/DPI/monitor calls preserve the same target while fully hidden; no frame captured.',
  );
} finally {
  await closeUiApp(app);
}
