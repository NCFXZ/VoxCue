import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { testRoot, spawnTestProcess } from '../../../shared/test/scripts/test-workspace.mjs';
import workspace from '../../../shared/scripts/workspace.mjs';

assert.equal(process.platform, 'win32');
assert.equal(process.argv.length, 2, 'This check builds only the current production Store payload');
const output = path.join(testRoot, 'platform-layout-store-package');
const { version } = JSON.parse(
  await readFile(path.join(workspace.repositoryRoot, 'shared/package.json'), 'utf8'),
);
async function run(script, args) {
  const child = spawnTestProcess(process.execPath, [script, ...args], {
    cwd: workspace.platformRoot,
    env: process.env,
    stdio: 'inherit',
    windowsHide: true,
  });
  await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) =>
      code === 0 ? resolve() : reject(Error(`${script} failed: ${signal ?? code}`)),
    );
  });
}
await run('scripts/package-store.mjs', ['--test-output=' + output]);
await run('test/scripts/store-sandbox-smoke.mjs', [
  '--appx=' + path.join(output, `VoxCue-Store-${version}-x64.appx`),
]);
