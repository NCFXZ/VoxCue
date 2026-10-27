import { testRoot, spawnTestProcess } from '../../../shared/test/scripts/test-workspace.mjs';
import { packageInstaller } from '../../scripts/package-installer.mjs';
import workspace from '../../../shared/scripts/workspace.mjs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { requireUnlockedDesktop } from './desktop-session.mjs';

// Build and verify the final artifacts in this owned temporary run. No release
// directory, historical artifact, installed app or production account is changed.
const output = path.join(testRoot, 'release');
await packageInstaller(output);
await assert.rejects(packageInstaller(output), /already exists/);
let pending;
try {
  requireUnlockedDesktop();
} catch (error) {
  pending = error.message;
}
for (const [name, args] of [
  ['package-runtimes-smoke.mjs', []],
  ['package-smoke.mjs', pending ? ['--static-only'] : ['--install-archive']],
]) {
  const child = spawnTestProcess(
    process.execPath,
    [path.join(workspace.platformRoot, 'test/scripts', name), ...args],
    {
      cwd: workspace.platformRoot,
      env: { ...process.env, VOXCUE_TEST_RELEASE_DIR: output },
      stdio: 'inherit',
    },
  );
  const timer = setTimeout(() => child.kill('SIGTERM'), 900000);
  const code = await new Promise((resolve, reject) => {
    child.once('exit', resolve);
    child.once('error', reject);
  }).finally(() => clearTimeout(timer));
  assert.equal(code, name === 'package-smoke.mjs' && pending ? 2 : 0, name);
}
if (pending) {
  console.log(
    'PENDING: final package interactive acceptance: ' +
      pending +
      '; runtime and static archive checks passed, temporary artifacts removed on exit.',
  );
  process.exitCode = 2;
} else
  console.log(
    'PASS: temporary final App/DMG/signed ZIP/manifest, runtime handshakes and staged-then-cancelled update verified; temporary artifacts are removed on exit.',
  );
