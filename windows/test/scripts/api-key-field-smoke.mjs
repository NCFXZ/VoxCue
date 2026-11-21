import assert from 'node:assert/strict';
import { once } from 'node:events';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { testRoot, spawnTestProcess } from '../../../shared/test/scripts/test-workspace.mjs';
import { watchTestDesktop } from '../../../shared/test/scripts/desktop-guard.mjs';
import { probe } from './window-probe.mjs';

const compiler = path.join(process.env.WINDIR, 'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
const executable = path.join(testRoot, 'ApiKeyFieldProbe.exe');
const source = fileURLToPath(new URL('../fixtures/ApiKeyFieldProbe.cs', import.meta.url));
const helper = fileURLToPath(new URL('../../native/bin/VoxCue.ApiKeyPrompt.exe', import.meta.url));
const compiled = spawnSync(compiler, ['/nologo', '/codepage:65001', '/platform:x64', '/r:System.Windows.Forms.dll', '/r:Accessibility.dll',
  '/r:System.Drawing.dll', '/out:' + executable, source], { encoding: 'utf8', windowsHide: true });
assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr);
const unlocked = () => assert.equal(probe('desktop').interactive, true, 'Unlocked owner console required');
unlocked();
const child = spawnTestProcess(executable, [helper], { stdio: 'inherit', windowsHide: true });
const guard = watchTestDesktop(child, unlocked);
const timer = setTimeout(() => child.kill(), 45000);
try {
  const [code] = await once(child, 'close');
  if (guard.failure) throw guard.failure;
  assert.equal(code, 0, 'Native API key field verification failed');
} finally {
  clearTimeout(timer);
  guard.release();
}
// A WinForms owner alone cannot exercise Chromium airspace, mouse focus or
// what is actually painted in the Electron window surrounding the native edit.
await import('./api-key-dialog-native.mjs');
