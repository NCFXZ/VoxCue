import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { testRoot } from '../../../shared/test/scripts/test-workspace.mjs';

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
