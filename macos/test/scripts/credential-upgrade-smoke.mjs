import { testRoot } from '../../../shared/test/scripts/test-workspace.mjs';
import workspace from '../../../shared/scripts/workspace.mjs';
import {
  mkdir,
  writeFile,
  readFile,
  copyFile,
  cp,
  realpath,
  symlink,
  unlink,
} from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { pbkdf2Sync, createCipheriv, randomBytes } from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';
import { loadDevelopmentSigning, signLocalCode } from '../../scripts/development-signing.mjs';
import { buildLegacyCredentials as buildCredentials } from '../../scripts/build-credentials.mjs';
import { writeCredentialFixtureSource } from './credential-fixture-source.mjs';

const fixtureRoot = await realpath(testRoot);
const signing = await loadDevelopmentSigning();
const parentIdentifier = 'com.voxcue.test.credentials.' + randomBytes(12).toString('hex');
const fixtureLegacy = await writeCredentialFixtureSource(fixtureRoot, 'legacy', parentIdentifier);
let fixtureDefinitions = ['-DVOXCUE_FIXTURE_LEGACY_SOURCE=' + JSON.stringify(fixtureLegacy)];
const run = (command, args, input, allowFailure = false) => {
  const result = spawnSync(command, args, { input, encoding: 'utf8', timeout: 30000 });
  if (!allowFailure && (result.error || result.status))
    throw (
      result.error ?? Error(`${path.basename(command)} failed (${result.status}): ${result.stderr}`)
    );
  return result;
};
const compile = (source, output) =>
  run('/usr/bin/xcrun', [
    'clang++',
    '-std=c++17',
    '-fobjc-arc',
    '-Wno-deprecated-declarations',
    '-mmacosx-version-min=14.2',
    '-O2',
    '-DVOXCUE_SIGNING_SHA1="' + signing.sha1.toLowerCase() + '"',
    '-DVOXCUE_FIXTURE_ROOT=' + JSON.stringify(fixtureRoot),
    '-I',
    path.join(workspace.platformRoot, 'native'),
    ...fixtureDefinitions,
    source,
    '-framework',
    'Foundation',
    '-framework',
    'Security',
    '-o',
    output,
  ]);
const canonical = await buildCredentials();
// No Keychain access is possible when launched by an unsigned/unrelated parent.
const unrelated = run(canonical, [], '{}', true);
assert.equal(
  unrelated.status,
  77,
  JSON.stringify({
    signal: unrelated.signal,
    error: unrelated.error?.message,
    stderr: unrelated.stderr,
  }),
);
const keychainsBefore = run('/usr/bin/security', ['list-keychains', '-d', 'user']).stdout;
const helper = path.join(fixtureRoot, 'credential-probe');
compile(path.join(workspace.platformRoot, 'test/fixtures/credential-probe.mm'), helper);
signLocalCode(helper, signing, 'com.voxcue.credentials', { preserveMetadata: false });
const helperHash = run('/usr/bin/codesign', ['-d', '--verbose=4', helper]).stderr.match(
  /CDHash=(\w+)/,
)?.[1];
assert.ok(helperHash);
fixtureDefinitions = [
  ...fixtureDefinitions,
  '-DVOXCUE_FIXTURE_HELPERS=@{@' + JSON.stringify(helper) + ':@' + JSON.stringify(helperHash) + '}',
];
const source = path.join(workspace.platformRoot, 'test/fixtures/credential-upgrade-parent.mm');
const parents = [];
const hashes = [];
for (const revision of [1, 2]) {
  const app = path.join(fixtureRoot, `revision-${revision}.app`);
  const executable = path.join(app, 'Contents/MacOS/fixture');
  await mkdir(path.dirname(executable), { recursive: true });
  await mkdir(path.join(app, 'Contents/Resources/native'), { recursive: true });
  await writeFile(
    path.join(app, 'Contents/Info.plist'),
    `<?xml version="1.0"?><plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>${parentIdentifier}</string>
<key>CFBundleExecutable</key><string>fixture</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleVersion</key><string>${revision}</string></dict></plist>`,
  );
  compile(source, executable);
  const embedded = path.join(app, 'Contents/Resources/native/VoxCue.Credentials');
  await copyFile(canonical, embedded);
  // Explicit legacy baseline, not current production packaging.
  signLocalCode(app, signing, parentIdentifier, { preserveMetadata: false, runtime: true });
  assert.deepEqual(await readFile(embedded), await readFile(canonical));
  hashes.push(
    run('/usr/bin/codesign', ['-d', '--verbose=4', app]).stderr.match(/CDHash=(.*)/)?.[1],
  );
  parents.push(executable);
}
assert.notEqual(hashes[0], hashes[1]);
const legacyApp = path.join(fixtureRoot, 'legacy-adhoc.app');
await cp(path.dirname(path.dirname(path.dirname(parents[0]))), legacyApp, { recursive: true });
run('/usr/bin/codesign', ['--force', '--sign', '-', legacyApp]);
const legacyParent = path.join(legacyApp, 'Contents/MacOS/fixture');
const keychain = path.join(fixtureRoot, 'synthetic.keychain-db');
run(parents[0], ['create', keychain]);
try {
  const outside = path.join(path.dirname(fixtureRoot), 'must-not-open.keychain-db');
  assert.equal(run(parents[0], ['helper', keychain, '/bin/sh'], '{}', true).status, 76);
  for (const mode of ['create', 'legacy-write', 'legacy-read', 'delete'])
    assert.equal(run(parents[0], [mode, outside], undefined, true).status, 76);
  const linked = path.join(fixtureRoot, 'symlink.keychain-db');
  await symlink(keychain, linked);
  try {
    assert.equal(run(parents[0], ['helper', linked, helper], '{}', true).status, 76);
    assert.equal(run(parents[0], ['delete', linked], undefined, true).status, 76);
  } finally {
    await unlink(linked);
  }
  assert.equal(run(legacyParent, ['legacy-write', keychain]).stdout, '0');
  const legacyStatus = Number(run(parents[1], ['legacy-read', keychain]).stdout);
  assert.notEqual(
    legacyStatus,
    0,
    'Fixed signing does not authorize a historical ad-hoc Keychain item',
  );
  run(parents[0], ['seed', keychain, helper]);
  const plaintext = Buffer.from('synthetic 登录凭据，仅用于升级验证');
  const key = pbkdf2Sync('synthetic-safe-storage-password', 'saltysalt', 1003, 16, 'sha1');
  const cipher = createCipheriv('aes-128-cbc', key, Buffer.alloc(16, ' '));
  const legacyCipher = Buffer.concat([
    Buffer.from('v10'),
    cipher.update(plaintext),
    cipher.final(),
  ]);
  const request = (parent, operation, bytes) =>
    JSON.parse(
      run(
        parent,
        ['helper', keychain, helper],
        JSON.stringify({ operation, data: bytes.toString('base64') }),
      ).stdout,
    );
  assert.deepEqual(
    Buffer.from(request(parents[0], 'decrypt', legacyCipher).data, 'base64'),
    plaintext,
  );
  // New app code hash; helper bytes and Keychain caller stay identical. Interaction
  // is disabled throughout, so a password prompt would fail this assertion.
  assert.deepEqual(
    Buffer.from(request(parents[1], 'decrypt', legacyCipher).data, 'base64'),
    plaintext,
  );
  const encrypted = Buffer.from(request(parents[1], 'encrypt', plaintext).data, 'base64');
  assert.deepEqual(encrypted, legacyCipher, 'Existing Electron v10 format and key are preserved');
  assert.deepEqual(
    Buffer.from(request(parents[0], 'decrypt', encrypted).data, 'base64'),
    plaintext,
  );
  const invalid = run(
    parents[1],
    ['helper', keychain, helper],
    JSON.stringify({ operation: 'decrypt', data: 'AAAA' }),
    true,
  );
  assert.notEqual(invalid.status, 0);
  assert.equal(invalid.stdout, '');
} finally {
  assert.equal(run(parents[0], ['delete', keychain]).stdout, '0');
}
assert.equal(run('/usr/bin/security', ['list-keychains', '-d', 'user']).stdout, keychainsBefore);
assert.equal(await buildCredentials(), canonical);
console.log(
  JSON.stringify({
    passed: true,
    historicalAdHocItemDeniedWithoutAuthorization: true,
    fixedHelperSurvivesChangedAppHash: true,
    legacyV10Compatible: true,
    unchangedPackagedHelperBytes: true,
    unrelatedParentRejected: true,
    realLoginKeychainAccessed: false,
    userInteractionAllowed: false,
  }),
);
