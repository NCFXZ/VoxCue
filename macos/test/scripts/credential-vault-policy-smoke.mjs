import { spawnSync } from 'node:child_process';
import { mkdtemp, realpath, readFile, writeFile, rm, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import workspace from '../../../shared/scripts/workspace.mjs';
import { loadDevelopmentSigning, signLocalCode } from '../../scripts/development-signing.mjs';
import { holdDesktopAwake, requireUnlockedDesktop } from './desktop-session.mjs';
import { writeCredentialFixtureSource } from './credential-fixture-source.mjs';

// Execute the v11 ownership checks against in-memory SecAccess objects
// with real CSSM partition subjects. No Keychain database or account is accessed.
if (process.platform !== 'darwin' || process.arch !== 'arm64')
  throw Error('Apple Silicon required');
if (process.argv.length !== 2) throw Error('credential-vault-policy-smoke accepts no arguments');
requireUnlockedDesktop();
const releaseAwake = holdDesktopAwake();
let directory;
try {
  directory = await realpath(await mkdtemp(path.join(tmpdir(), 'voxcue-credential-policy-')));
  const rootInfo = await lstat(directory);
  assert.equal(rootInfo.uid, process.getuid());
  assert.equal(rootInfo.mode & 0o077, 0);
  const run = (executable, args, input, failure = false) => {
    requireUnlockedDesktop();
    const result = spawnSync(executable, args, {
      input,
      env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin' },
      encoding: 'utf8',
      timeout: 30000,
    });
    if (!failure && (result.error || result.status))
      throw (
        result.error ?? Error(`${path.basename(executable)}: ${result.status}, ${result.stderr}`)
      );
    return result;
  };
  const signing = await loadDevelopmentSigning();
  const parentIdentifier = 'com.voxcue.test.credentials.' + randomBytes(12).toString('hex');
  const source = await writeCredentialFixtureSource(directory, 'vault-v11', parentIdentifier);
  const bytes = await readFile(source, 'utf8');
  const declaration = 'int main(int argc, const char **argv) {';
  const parts = bytes.split(declaration);
  assert.equal(parts.length, 2, 'Rename exactly one entry point in the temporary source copy');
  await writeFile(source, parts.join('int vaultFixtureMain(int argc, const char **argv) {'), {
    mode: 0o600,
  });
  const fixture = (name) => path.join(workspace.platformRoot, 'test/fixtures', name);
  const compile = (file, output, extra = []) =>
    run('/usr/bin/xcrun', [
      'clang++',
      '-std=c++17',
      '-fobjc-arc',
      '-Wno-deprecated-declarations',
      '-arch',
      'arm64',
      '-mmacosx-version-min=14.2',
      '-O2',
      '-DVOXCUE_SIGNING_SHA1="' + signing.sha1.toLowerCase() + '"',
      '-DVOXCUE_FIXTURE_ROOT=' + JSON.stringify(directory),
      '-I',
      path.join(workspace.platformRoot, 'native'),
      '-I',
      path.join(workspace.platformRoot, 'test/fixtures'),
      ...extra,
      file,
      '-framework',
      'Foundation',
      '-framework',
      'Security',
      '-o',
      output,
    ]);
  const helper = path.join(directory, 'policy-helper');
  compile(fixture('credential-vault-policy.mm'), helper, [
    '-DVOXCUE_FIXTURE_VAULT_SOURCE=' + JSON.stringify(source),
    '-DVOXCUE_FIXTURE_SELF_PATH=' + JSON.stringify(helper),
  ]);
  signLocalCode(helper, signing, 'com.voxcue.credentials.vault', {
    preserveMetadata: false,
    runtime: true,
  });
  const hash = run('/usr/bin/codesign', ['-d', '--verbose=4', helper]).stderr.match(
    /CDHash=(\w+)/,
  )?.[1];
  assert.match(hash ?? '', /^[a-f0-9]{40}$/);
  const parent = path.join(directory, 'policy-parent');
  compile(fixture('credential-vault-policy-parent.mm'), parent, [
    '-DVOXCUE_FIXTURE_BOUND_HELPER=' + JSON.stringify(helper),
    '-DVOXCUE_FIXTURE_HELPERS=@{@' + JSON.stringify(helper) + ':@' + JSON.stringify(hash) + '}',
  ]);
  signLocalCode(parent, signing, parentIdentifier, { preserveMetadata: false, runtime: true });
  const policy = run(parent, ['policy']);
  assert.equal(
    (policy.stdout.match(/PASS: in-memory ACL policy /g) ?? []).length,
    15,
    policy.stdout,
  );
  process.stdout.write(policy.stdout);
  for (const request of [
    { operation: 'probe' },
    { operation: 'cleanup' },
    {
      operation: 'validate',
      data: Buffer.concat([Buffer.from('v10'), Buffer.alloc(16)]).toString('base64'),
    },
  ]) {
    const denied = run(
      parent,
      ['disable-ui'],
      JSON.stringify({ ...request, language: 'en' }),
      true,
    );
    assert.equal(denied.error, undefined);
    assert.equal(denied.status, 80, denied.stderr);
    assert.match(denied.stderr, /fixture-policy-item-calls:0\b/);
    assert.equal(denied.stdout, '');
  }
  console.log(
    'PASS: failed interaction suppression prevents probe, validation and cleanup from accessing Keychain.',
  );
  console.log(
    'Boundary: in-memory policy coverage does not prove modern Keychain persistence or system dialog counts.',
  );
} finally {
  try {
    if (directory) {
      const info = await lstat(directory);
      assert.ok(info.isDirectory() && !info.isSymbolicLink());
      assert.equal(info.uid, process.getuid());
      assert.equal(await realpath(directory), directory);
      await rm(directory, { recursive: true, force: true });
    }
  } finally {
    releaseAwake();
  }
}
