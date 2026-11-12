import { execFileSync, spawnSync } from 'node:child_process';
import {
  mkdtemp,
  realpath,
  readFile,
  writeFile,
  rm,
  copyFile,
  symlink,
  unlink,
  rename,
  link,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import workspace from '../../../shared/scripts/workspace.mjs';
import { loadDevelopmentSigning, signLocalCode } from '../../scripts/development-signing.mjs';
import { holdDesktopAwake, requireUnlockedDesktop } from './desktop-session.mjs';
import { createCipheriv, pbkdf2Sync, randomBytes } from 'node:crypto';
import { writeCredentialFixtureSource } from './credential-fixture-source.mjs';

if (process.platform !== 'darwin' || process.arch !== 'arm64')
  throw Error('Apple Silicon required');
if (process.argv.length !== 2) throw Error('Credential hardening regression accepts no arguments');
const releaseAwake = holdDesktopAwake();
const directory = await realpath(
  await mkdtemp(path.join(tmpdir(), 'voxcue-credential-hardening-')),
);
const keychains = [];
const run = (executable, args, input, failure = false, env = process.env) => {
  requireUnlockedDesktop();
  const result = spawnSync(executable, args, { input, env, encoding: 'utf8', timeout: 30000 });
  if (!failure && (result.error || result.status))
    throw result.error ?? Error(`${path.basename(executable)}: ${result.status}, ${result.stderr}`);
  return result;
};
const lists = () =>
  execFileSync('/usr/bin/security', ['list-keychains', '-d', 'user'], { encoding: 'utf8' });
const before = lists();
let admin;
try {
  const signing = await loadDevelopmentSigning();
  const parentIdentifier = 'com.voxcue.test.credentials.' + randomBytes(12).toString('hex');
  const fixtureLegacy = await writeCredentialFixtureSource(directory, 'legacy', parentIdentifier);
  const fixtureHardened = await writeCredentialFixtureSource(
    directory,
    'hardened',
    parentIdentifier,
  );
  let fixtureDefinitions = [
    '-DVOXCUE_FIXTURE_LEGACY_SOURCE=' + JSON.stringify(fixtureLegacy),
    '-DVOXCUE_FIXTURE_HARDENED_SOURCE=' + JSON.stringify(fixtureHardened),
  ];
  const compile = (source, destination, args = []) =>
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
      ...fixtureDefinitions,
      ...args,
      source,
      '-framework',
      'Foundation',
      '-framework',
      'Security',
      '-o',
      destination,
    ]);
  const sign = (file, identifier, runtime = true) =>
    signLocalCode(file, signing, identifier, { preserveMetadata: false, runtime });
  const helper = path.join(directory, 'hardened');
  compile(path.join(workspace.platformRoot, 'test/fixtures/credential-hardening-probe.mm'), helper);
  sign(helper, 'com.voxcue.credentials.hardened');
  const old = path.join(directory, 'legacy');
  compile(path.join(workspace.platformRoot, 'test/fixtures/credential-probe.mm'), old);
  sign(old, 'com.voxcue.credentials', false);
  const unsafeHelpers = new Map();
  for (const [index, entitlement] of [
    'com.apple.security.cs.allow-dyld-environment-variables',
    'com.apple.security.cs.allow-unsigned-executable-memory',
    'com.apple.security.get-task-allow',
  ].entries()) {
    const policy = path.join(directory, entitlement + '.plist');
    await writeFile(
      policy,
      '<?xml version="1.0"?><plist version="1.0"><dict><key>' +
        entitlement +
        '</key><true/></dict></plist>',
    );
    const binary = path.join(directory, 'unsafe-helper-' + index);
    await copyFile(helper, binary);
    signLocalCode(binary, signing, 'com.voxcue.credentials.hardened', {
      preserveMetadata: false,
      runtime: true,
      entitlements: policy,
    });
    unsafeHelpers.set(entitlement, binary);
  }
  const noRuntime = path.join(directory, 'no-runtime-helper');
  await copyFile(helper, noRuntime);
  sign(noRuntime, 'com.voxcue.credentials.hardened', false);
  const wrongPin = path.join(directory, 'wrong-pin-helper');
  compile(
    path.join(workspace.platformRoot, 'test/fixtures/credential-hardening-probe.mm'),
    wrongPin,
    ['-UVOXCUE_SIGNING_SHA1', '-DVOXCUE_SIGNING_SHA1="0000000000000000000000000000000000000000"'],
  );
  sign(wrongPin, 'com.voxcue.credentials.hardened');
  const productionV2 = await realpath(
    path.join(workspace.platformRoot, '.tools/credential-helper-v2/VoxCue.Credentials'),
  );
  const productionV1 = await realpath(
    path.join(workspace.platformRoot, '.tools/credential-helper-v1/VoxCue.Credentials'),
  );
  const productionV2Copy = path.join(directory, 'production-v2-denied');
  const productionV1Copy = path.join(directory, 'production-v1-denied');
  await copyFile(productionV2, productionV2Copy);
  await copyFile(productionV1, productionV1Copy);
  const candidates = [
    old,
    helper,
    ...unsafeHelpers.values(),
    noRuntime,
    wrongPin,
    productionV2Copy,
    productionV1Copy,
  ];
  const codeHash = (file) => {
    const hash = run('/usr/bin/codesign', ['-d', '--verbose=4', file]).stderr.match(
      /CDHash=(\w+)/,
    )?.[1];
    assert.ok(hash);
    return hash;
  };
  fixtureDefinitions = [
    ...fixtureDefinitions,
    '-DVOXCUE_FIXTURE_HELPERS=@{' +
      candidates
        .map((file) => '@' + JSON.stringify(file) + ':@' + JSON.stringify(codeHash(file)))
        .join(',') +
      '}',
    '-DVOXCUE_FIXTURE_LEGACY_PATH=' + JSON.stringify(old),
    '-DVOXCUE_FIXTURE_HARDENED_PATH=' + JSON.stringify(helper),
  ];
  admin = path.join(directory, 'admin');
  compile(path.join(workspace.platformRoot, 'test/fixtures/credential-hardening-admin.mm'), admin);
  sign(admin, 'com.voxcue.credential-fixture');
  const source = path.join(workspace.platformRoot, 'test/fixtures/credential-hardening-parent.mm');
  const parents = [];
  for (const [name, identifier, runtime, revision] of [
    ['formal-1', parentIdentifier, true, 1],
    ['formal-2', parentIdentifier, true, 2],
    ['development', 'com.voxcue.development', true, 1],
    ['non-runtime', parentIdentifier, false, 1],
  ]) {
    const file = path.join(directory, name);
    compile(source, file, ['-DVOXCUE_REVISION=' + revision]);
    sign(file, identifier, runtime);
    parents.push(file);
  }
  const spoof = path.join(directory, 'spoof');
  await copyFile(parents[0], spoof);
  run('/usr/bin/codesign', [
    '--force',
    '--sign',
    '-',
    '--identifier',
    parentIdentifier,
    '--options',
    'runtime',
    spoof,
  ]);
  const request = (parent, binary, keychain, operation, bytes, fail = false, env = process.env) =>
    run(
      parent,
      [binary, ...(Array.isArray(keychain) ? keychain : [keychain])],
      JSON.stringify({ operation, data: bytes.toString('base64') }),
      fail,
      env,
    );
  const plaintext = Buffer.from('Synthetic credentials for v10 hardening migration');
  const cipher = createCipheriv(
    'aes-128-cbc',
    pbkdf2Sync('synthetic-safe-storage-password', 'saltysalt', 1003, 16, 'sha1'),
    Buffer.alloc(16, ' '),
  );
  const ciphertext = Buffer.concat([Buffer.from('v10'), cipher.update(plaintext), cipher.final()]);
  const decoded = (result) => Buffer.from(JSON.parse(result.stdout).data, 'base64');
  const inspect = (keychain) => JSON.parse(run(admin, ['inspect', keychain]).stdout);
  const hash = run('/usr/bin/codesign', ['-d', '--verbose=4', helper]).stderr.match(
    /CDHash=(\w+)/,
  )?.[1];
  assert.ok(hash);
  for (const mode of [
    'normal',
    'different',
    'denied',
    'fresh',
    'partial',
    'no-partition',
    'cross',
  ]) {
    const keychain = path.join(directory, mode + '.keychain-db');
    run(admin, ['create', keychain]);
    keychains.push(keychain);
    if (mode !== 'fresh') run(admin, ['seed', keychain, old, helper, mode]);
    let selectedKeychains = keychain;
    let secondary;
    if (mode === 'cross') {
      secondary = path.join(directory, 'cross-secondary.keychain-db');
      run(admin, ['create', secondary]);
      keychains.push(secondary);
      run(admin, ['seed', secondary, old, helper, 'normal']);
      selectedKeychains = [keychain, secondary];
    }
    const initial = inspect(keychain);
    if (['normal', 'partial', 'no-partition', 'cross'].includes(mode)) {
      assert.deepEqual(
        decoded(request(parents[0], old, keychain, 'decrypt', ciphertext)),
        plaintext,
      );
      if (mode === 'partial') {
        const failed = request(parents[0], helper, keychain, 'encrypt', plaintext, true, {
          ...process.env,
          VOXCUE_CREDENTIAL_FAIL_ACL_AT: '1',
        });
        assert.notEqual(failed.status, 0);
        assert.equal(failed.stdout, '');
        const halfway = inspect(keychain);
        assert.deepEqual(
          halfway[0].flatMap((rule) => rule.partitions),
          ['cdhash:' + hash],
        );
        assert.deepEqual(halfway.slice(1), initial.slice(1));
        assert.notEqual(request(parents[0], old, keychain, 'encrypt', plaintext, true).status, 0);
      }
      assert.deepEqual(
        decoded(request(parents[0], helper, selectedKeychains, 'decrypt', ciphertext)),
        plaintext,
      );
      for (const entry of inspect(keychain)) {
        assert.ok(entry);
        const partitions = entry.flatMap((rule) => rule.partitions);
        assert.deepEqual(partitions, ['cdhash:' + hash]);
        for (const rule of entry.filter((rule) => !rule.partitions.length))
          assert.equal(rule.applications, 1);
      }
      if (secondary) {
        for (const entry of inspect(secondary))
          assert.deepEqual(
            entry.flatMap((rule) => rule.partitions),
            ['cdhash:' + hash],
          );
        const denied = request(parents[0], old, secondary, 'decrypt', ciphertext, true);
        assert.notEqual(denied.status, 0);
        assert.equal(denied.stdout, '');
      }
      const retired = request(parents[0], old, keychain, 'decrypt', ciphertext, true);
      assert.notEqual(retired.status, 0);
      assert.equal(retired.stdout, '');
      assert.deepEqual(
        decoded(request(parents[1], helper, keychain, 'decrypt', ciphertext)),
        plaintext,
      );
      assert.deepEqual(
        decoded(request(parents[1], helper, keychain, 'encrypt', plaintext)),
        ciphertext,
      );
      for (const parent of [...parents.slice(2), spoof]) {
        const denied = request(parent, helper, keychain, 'decrypt', ciphertext, true);
        assert.equal(denied.status, 77);
        assert.equal(denied.stdout, '');
      }
    } else if (mode === 'fresh') {
      assert.notEqual(request(parents[0], helper, keychain, 'decrypt', ciphertext, true).status, 0);
      assert.deepEqual(inspect(keychain), [null, null, null]);
      const fresh = decoded(request(parents[0], helper, keychain, 'encrypt', plaintext));
      const created = inspect(keychain);
      assert.deepEqual(
        created[0].flatMap((rule) => rule.partitions),
        ['cdhash:' + hash],
      );
      for (const rule of created[0].filter((rule) => !rule.partitions.length))
        assert.equal(rule.applications, 1);
      assert.deepEqual(decoded(request(parents[1], helper, keychain, 'decrypt', fresh)), plaintext);
      assert.notEqual(request(parents[0], old, keychain, 'decrypt', fresh, true).status, 0);
    } else {
      const denied = request(parents[0], helper, keychain, 'encrypt', plaintext, true);
      assert.notEqual(denied.status, 0);
      assert.equal(denied.stdout, '');
      assert.deepEqual(
        inspect(keychain),
        initial,
        'Failure must not change ACLs or generate/import a password',
      );
    }
  }
  const invalid = run(helper, [], '{}', true);
  assert.equal(invalid.status, 77);
  const guardKeychain = path.join(directory, 'guard.keychain-db');
  run(admin, ['create', guardKeychain]);
  keychains.push(guardKeychain);
  for (const production of [productionV1Copy, productionV2Copy]) {
    assert.equal(
      run(parents[0], [production, guardKeychain], '{}', true).status,
      77,
      'A nonce test parent must never authorize a real production helper',
    );
  }
  for (const extra of [false, true]) {
    const positive = path.join(directory, 'production-parent-' + Number(extra));
    compile(
      path.join(workspace.platformRoot, 'test/fixtures/credential-production-parent.mm'),
      positive,
      [
        '-DVOXCUE_PRODUCTION_HELPER_PATH=' + JSON.stringify(productionV2),
        '-DVOXCUE_PRODUCTION_HELPER_HASH=' + JSON.stringify(codeHash(productionV2)),
        '-DVOXCUE_PRODUCTION_EXTRA_ARGUMENT=' + Number(extra),
      ],
    );
    sign(positive, 'com.voxcue.app');
    assert.equal(
      run(positive, [], JSON.stringify({ operation: 'encrypt', data: 'AAAA' }), true).status,
      extra ? 78 : 80,
      'Formal harness must send only its hardcoded invalid input before Keychain access',
    );
    assert.equal(run(positive, [helper], '{}', true).status, 76);
  }

  for (const [entitlement, unsafeHelper] of unsafeHelpers) {
    const policy = path.join(directory, entitlement + '.plist');
    const unsafeParent = path.join(directory, 'unsafe-parent');
    await copyFile(parents[0], unsafeParent);
    signLocalCode(unsafeParent, signing, parentIdentifier, {
      preserveMetadata: false,
      runtime: true,
      entitlements: policy,
    });
    assert.equal(run(unsafeParent, [helper, guardKeychain], '{}', true).status, 77);
    assert.equal(run(parents[0], [unsafeHelper, guardKeychain], '{}', true).status, 77);
  }
  assert.equal(run(parents[0], [noRuntime, guardKeychain], '{}', true).status, 77);
  assert.equal(run(parents[0], [wrongPin, guardKeychain], '{}', true).status, 77);

  // Launcher capabilities are restricted before any child or Keychain action.
  assert.equal(run(parents[0], ['/bin/sh', guardKeychain], '{}', true).status, 76);
  const external = path.join(path.dirname(directory), 'must-not-open.keychain-db');
  assert.equal(run(parents[0], [helper, external], '{}', true).status, 76);
  for (const operation of ['create', 'inspect', 'delete'])
    assert.equal(run(admin, [operation, external], undefined, true).status, 76);
  const linkedKeychain = path.join(directory, 'symlink.keychain-db');
  await symlink(guardKeychain, linkedKeychain);
  try {
    assert.equal(run(parents[0], [helper, linkedKeychain], '{}', true).status, 76);
    for (const operation of ['create', 'inspect', 'delete'])
      assert.equal(run(admin, [operation, linkedKeychain], undefined, true).status, 76);
  } finally {
    await unlink(linkedKeychain);
  }
  await link(guardKeychain, linkedKeychain);
  try {
    assert.equal(run(parents[0], [helper, guardKeychain], '{}', true).status, 76);
    assert.equal(run(admin, ['inspect', guardKeychain], undefined, true).status, 76);
  } finally {
    await unlink(linkedKeychain);
  }
  const otherSource = path.join(directory, 'other.mm'),
    other = path.join(directory, 'other-helper');
  await writeFile(otherSource, 'int main(){return 0;}');
  compile(otherSource, other);
  sign(other, 'com.voxcue.credentials.hardened');
  assert.equal(run(parents[0], [other, guardKeychain], '{}', true).status, 76);
  const backup = path.join(directory, 'helper-backup');
  await rename(helper, backup);
  try {
    await copyFile(other, helper);
    assert.equal(run(parents[0], [helper, guardKeychain], '{}', true).status, 76);
    await unlink(helper);
    await symlink(backup, helper);
    assert.equal(run(parents[0], [helper, guardKeychain], '{}', true).status, 76);
  } finally {
    await rm(helper, { force: true });
    await rename(backup, helper);
  }
  assert.equal(
    run(parents[0], [helper, guardKeychain], '{}', true, {
      ...process.env,
      VOXCUE_CREDENTIAL_FAIL_ACL_AT: '1;exec',
    }).status,
    76,
  );
  assert.match(
    run('/usr/bin/csrutil', ['status']).stdout,
    /System Integrity Protection status: enabled/,
  );
  const marker = path.join(directory, 'injected-marker');
  const librarySource = path.join(directory, 'marker.mm');
  const library = path.join(directory, 'marker.dylib');
  await writeFile(
    librarySource,
    '#import <Foundation/Foundation.h>\n__attribute__((constructor)) static void mark(void) { [@"synthetic" writeToFile:@' +
      JSON.stringify(marker) +
      ' atomically:YES encoding:NSUTF8StringEncoding error:nil]; }',
  );
  run('/usr/bin/xcrun', [
    'clang++',
    '-fobjc-arc',
    '-dynamiclib',
    librarySource,
    '-framework',
    'Foundation',
    '-o',
    library,
  ]);
  sign(library, 'com.voxcue.credential-marker');
  assert.equal(
    run(helper, [], '{}', true, { ...process.env, DYLD_INSERT_LIBRARIES: library }).status,
    77,
  );
  await assert.rejects(readFile(marker), { code: 'ENOENT' });
  console.log(
    'PASS: nonce-isolated credential migration fixture; unchanged v10/password, all aliases restricted to new CDHash, old fixture denied, two test-parent revisions, runtime/identity/entitlement and direct DYLD checks, partial retry and fail-closed migration, restricted fresh install. Real v1/v2 helpers reject nonce parents; the fixed formal harness sends only invalid ciphertext/arguments before Keychain access. Synthetic Keychains only.',
  );
} finally {
  try {
    for (const keychain of keychains.reverse()) run(admin, ['delete', keychain]);
    assert.equal(lists(), before, 'The original Keychain search list must be unchanged');
  } finally {
    await rm(directory, { recursive: true, force: true });
    releaseAwake();
  }
}
