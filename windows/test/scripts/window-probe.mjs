import { spawnSync } from 'node:child_process';
import path from 'node:path';
import assert from 'node:assert/strict';
import { testRoot } from '../../../shared/test/scripts/test-workspace.mjs';

assert.equal(process.platform, 'win32');
const executable = path.join(testRoot, 'WindowProbe.exe');
const framework = path.join(process.env.WINDIR, 'Microsoft.NET/Framework64/v4.0.30319');
const compiled = spawnSync(
  path.join(framework, 'csc.exe'),
  [
    '/nologo',
    '/platform:x64',
    '/target:exe',
    '/r:System.Drawing.dll',
    '/r:System.Web.Extensions.dll',
    ...['UIAutomationClient', 'UIAutomationTypes', 'WindowsBase'].map(
      (name) => '/r:' + path.join(framework, 'WPF', name + '.dll'),
    ),
    '/out:' + executable,
    path.resolve('test/fixtures/WindowProbe.cs'),
  ],
  { encoding: 'utf8', windowsHide: true, timeout: 30000 },
);
assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr);
export function probe(...args) {
  const result = spawnSync(executable, args.map(String), {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 15000,
  });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  return JSON.parse(result.stdout);
}
