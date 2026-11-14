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
import { loadDevelopmentSigning, signLocalCode as signOwnedCode } from '../../scripts/development-signing.mjs';
import { holdDesktopAwake, requireUnlockedDesktop } from './desktop-session.mjs';
import { createCipheriv, pbkdf2Sync, randomBytes } from 'node:crypto';
import { writeCredentialFixtureSource } from './credential-fixture-source.mjs';

if (process.platform !== 'darwin' || process.arch !== 'arm64')
  throw Error('Apple Silicon required');
const cleanup = process.argv.includes('--cleanup');
const fixedV5 = process.argv.includes('--fixed-v5');
const compatible = fixedV5 || process.argv.includes('--compatible');
const fixedV4 = process.argv.includes('--fixed-v4');
if (
  process.argv
    .slice(2)
    .some((arg) => !['--cleanup', '--fixed-v4', '--fixed-v5', '--compatible'].includes(arg)) ||
  ((fixedV4 || compatible) && !cleanup) ||
  (fixedV4 && compatible)
)
  throw Error(
    'Use --cleanup --fixed-v5 for current compatible migration; --fixed-v4 verifies the archived revision',
  );
const stopAwake = holdDesktopAwake();
let awakeReleased = false;
const releaseAwake = () => {
  if (awakeReleased) return;
  awakeReleased = true;
  stopAwake();
};
const directory = await realpath(
  await mkdtemp(path.join(tmpdir(), 'voxcue-credential-hardening-')),
);
const keychains = [];
const processGroups = new Set();
let stopping = false;
const signLocalCode = (...args) => {
  if (stopping) throw Error('The owned credential fixture is stopping');
  return signOwnedCode(...args);
};
const pause = (milliseconds) =>
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
const groupAlive = (pid) => {
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    if (error.code === 'ESRCH') return false;
    throw error;
  }
};
const signalGroup = (pid, signal) => {
  try {
    process.kill(-pid, signal);
  } catch (error) {
    if (error.code !== 'ESRCH') throw error;
  }
};
const retireGroup = (pid) => {
  if (!processGroups.has(pid)) return;
  if (groupAlive(pid)) {
    signalGroup(pid, 'SIGTERM');
    const forceAt = Date.now() + 1000;
    while (groupAlive(pid) && Date.now() < forceAt) pause(25);
    if (groupAlive(pid)) signalGroup(pid, 'SIGKILL');
    const deadline = Date.now() + 5000;
    while (groupAlive(pid) && Date.now() < deadline) pause(25);
    if (groupAlive(pid)) throw Error(`Owned credential fixture process group ${pid} did not exit`);
  }
  processGroups.delete(pid);
};
const retireGroups = async () => {
  // Yield while asynchronous children exit so Node can reap them before the
  // group proof. Synchronous command children have already been reaped.
  const delay = () => new Promise((resolve) => setTimeout(resolve, 25));
  for (const pid of processGroups) {
    if (groupAlive(pid)) {
      signalGroup(pid, 'SIGTERM');
      const forceAt = Date.now() + 1000;
      while (groupAlive(pid) && Date.now() < forceAt) await delay();
      if (groupAlive(pid)) signalGroup(pid, 'SIGKILL');
      const deadline = Date.now() + 5000;
      while (groupAlive(pid) && Date.now() < deadline) await delay();
      if (groupAlive(pid)) throw Error(`Owned credential fixture process group ${pid} did not exit`);
    }
    processGroups.delete(pid);
  }
};
const run = (executable, args, input, failure = false, env = process.env, teardown = false) => {
  if (stopping && !teardown) throw Error('The owned credential fixture is stopping');
  if (teardown) {
    assert.equal(executable, admin);
    assert.equal(args.length, 2);
    assert.equal(args[0], 'delete');
    assert.ok(keychains.includes(args[1]), 'Teardown may delete only this run’s synthetic Keychain');
  } else requireUnlockedDesktop();
  const result = spawnSync(executable, args, {
    input, env, encoding: 'utf8', timeout: 30000, detached: true,
  });
  if (Number.isSafeInteger(result.pid) && result.pid > 0) processGroups.add(result.pid);
  const descendants = processGroups.has(result.pid) && groupAlive(result.pid);
  retireGroup(result.pid);
  if (result.error || result.signal || !Number.isInteger(result.status))
    throw Error(
      `${result.error?.message ?? `${path.basename(executable)} terminated by ${result.signal}`}\n${result.stderr?.slice(-4096) ?? ''}`,
      { cause: result.error },
    );
  if ([75, 82, 83].includes(result.status))
    throw Error(`Credential fixture failed (${result.status}): ${result.stderr}`);
  if (descendants) throw Error(`${path.basename(executable)} left a fixture descendant running`);
  if (!failure && result.status !== 0)
    throw result.error ?? Error(`${path.basename(executable)}: ${result.status}, ${result.stderr}`);
  return result;
};
const lists = () =>
  execFileSync('/usr/bin/security', ['list-keychains', '-d', 'user'], { encoding: 'utf8' });
const before = lists();
let admin;
let cleanupTask;
const cleanupOwned = () =>
  (cleanupTask ??= (async () => {
    await retireGroups();
    for (const keychain of keychains.reverse())
      run(admin, ['delete', keychain], undefined, false, process.env, true);
    assert.equal(lists(), before, 'The original Keychain search list must be unchanged');
    await retireGroups();
    await rm(directory, { recursive: true, force: true });
  })());
const interrupt = async (code) => {
  if (stopping) return;
  stopping = true;
  try {
    await cleanupOwned();
  } catch (error) {
    console.error('Credential fixture cleanup failed; owned directory retained:', directory, error);
  } finally {
    releaseAwake();
    process.exit(code);
  }
};
// Node dispatches these only after an in-flight spawnSync returns. SIGKILL
// cannot run this cleanup; do not treat a forced runner death as clean exit.
const onInterrupt = () => { void interrupt(130); };
const onTerminate = () => { void interrupt(143); };
process.once('SIGINT', onInterrupt);
process.once('SIGTERM', onTerminate);
try {
  const signing = await loadDevelopmentSigning();
  const parentIdentifier = 'com.voxcue.test.credentials.' + randomBytes(12).toString('hex');
  const fixtureLegacy = await writeCredentialFixtureSource(directory, 'legacy', parentIdentifier);
  const fixtureHardened = await writeCredentialFixtureSource(
    directory,
    'hardened',
    parentIdentifier,
  );
  const fixtureMigrating = cleanup
    ? await writeCredentialFixtureSource(directory, 'migrating', parentIdentifier)
    : undefined;
  // Frozen includes redefine/undefine main internally. Rename only these
  // temporary entry points so the probe can restore its interaction policy.
  for (const file of [fixtureHardened, fixtureMigrating].filter(Boolean)) {
    const source = await readFile(file, 'utf8');
    const entry = 'int main(int argc, const char **argv) {';
    const parts = source.split(entry);
    assert.equal(parts.length, 2, 'Exactly one archived fixture entry point is required');
    await writeFile(file, parts.join('int archivedFixtureMain(int argc, const char **argv) {'));
  }
  const fixtureStable =
    cleanup && !compatible ? path.join(directory, 'fixture-CredentialsStable.mm') : undefined;
  if (fixtureStable)
    await copyFile(path.join(workspace.platformRoot, 'native/CredentialsStable.mm'), fixtureStable);
  const fixtureCompatible = compatible
    ? path.join(directory, 'fixture-CredentialsCompatible.mm')
    : undefined;
  if (compatible)
    await copyFile(
      path.join(workspace.platformRoot, 'native/CredentialsCompatible.mm'),
      fixtureCompatible,
    );
  let fixtureDefinitions = [
    '-DVOXCUE_FIXTURE_CHECKED_INTERACTION=1',
    '-DVOXCUE_FIXTURE_LEGACY_SOURCE=' + JSON.stringify(fixtureLegacy),
    '-DVOXCUE_FIXTURE_HARDENED_SOURCE=' + JSON.stringify(fixtureHardened),
    ...(cleanup
      ? [
          '-DVOXCUE_FIXTURE_MIGRATING_SOURCE=' + JSON.stringify(fixtureCompatible ?? fixtureStable),
          '-DVOXCUE_CREDENTIAL_CLEANUP_SOURCE=' + JSON.stringify(fixtureMigrating),
        ]
      : []),
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
  const helperIdentifier = cleanup
    ? 'com.voxcue.credentials.migrating'
    : 'com.voxcue.credentials.hardened';
  const currentFlags = cleanup ? ['-DVOXCUE_FIXTURE_CLEANUP=1'] : [];
  compile(
    path.join(workspace.platformRoot, 'test/fixtures/credential-hardening-probe.mm'),
    helper,
    currentFlags,
  );
  sign(helper, helperIdentifier);
  const old = path.join(directory, 'legacy');
  compile(
    path.join(
      workspace.platformRoot,
      'test/fixtures',
      cleanup ? 'credential-hardening-probe.mm' : 'credential-probe.mm',
    ),
    old,
  );
  sign(old, cleanup ? 'com.voxcue.credentials.hardened' : 'com.voxcue.credentials', cleanup);
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
    signLocalCode(binary, signing, helperIdentifier, {
      preserveMetadata: false,
      runtime: true,
      entitlements: policy,
    });
    unsafeHelpers.set(entitlement, binary);
  }
  const noRuntime = path.join(directory, 'no-runtime-helper');
  await copyFile(helper, noRuntime);
  sign(noRuntime, helperIdentifier, false);
  const wrongPin = path.join(directory, 'wrong-pin-helper');
  compile(
    path.join(workspace.platformRoot, 'test/fixtures/credential-hardening-probe.mm'),
    wrongPin,
    [
      ...currentFlags,
      '-UVOXCUE_SIGNING_SHA1',
      '-DVOXCUE_SIGNING_SHA1="0000000000000000000000000000000000000000"',
    ],
  );
  sign(wrongPin, helperIdentifier);
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
  const productionFixed =
    fixedV4 || fixedV5
      ? await realpath(
          path.join(
            workspace.platformRoot,
            '.tools/credential-helper-v' + (fixedV5 ? '5' : '4') + '/VoxCue.Credentials',
          ),
        )
      : undefined;
  const productionCopies = [productionV1Copy, productionV2Copy];
  if (productionFixed) {
    const copy = path.join(directory, 'production-fixed-denied');
    await copyFile(productionFixed, copy);
    productionCopies.push(copy);
  }
  const candidates = [
    old,
    helper,
    ...unsafeHelpers.values(),
    noRuntime,
    wrongPin,
    ...productionCopies,
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
  const request = (parent, binary, keychain, operation, bytes, fail = false, env = process.env) => {
    const selected = Array.isArray(keychain) ? keychain : [keychain];
    try {
      return run(
        parent,
        [binary, ...selected],
        JSON.stringify({ operation, data: bytes.toString('base64') }),
        fail,
        env,
      );
    } catch (error) {
      throw Error(
        `${selected.map((file) => path.basename(file)).join(',')} ${operation}: ${error.message}`,
      );
    }
  };
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
  // SecKeychainCreate fixtures use the legacy database: they do not carry the
  // OS-owned modern partition layer. Real default-Keychain coverage is in the
  // final package guest acceptance, including preservation of those records.
  const applicationRules = (items) =>
    items.map(
      (entry) =>
        entry && entry.filter((rule) => !rule.tags.includes('ACLAuthorizationPartitionID')),
    );
  for (const mode of [
    'normal',
    'different',
    'denied',
    'fresh',
    'partial',
    'no-partition',
    'cross',
    ...(cleanup ? ['legacy-only', 'current-only'] : []),
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
    const expectedPartition = compatible
      ? (initial
          .find(Boolean)
          ?.filter((rule) => rule.subject === 0x1000c)
          .flatMap((rule) => rule.partitions) ?? [])
      : ['cdhash:' + hash];
    if (
      ['normal', 'partial', 'no-partition', 'cross', 'legacy-only', 'current-only'].includes(mode)
    ) {
      if (!cleanup)
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
        if (cleanup) assert.doesNotMatch(failed.stderr, /fixture-item-delete/);
        const halfway = inspect(keychain);
        assert.deepEqual(
          halfway[0].flatMap((rule) => rule.partitions),
          expectedPartition,
        );
        assert.deepEqual(
          compatible ? applicationRules(halfway.slice(1)) : halfway.slice(1),
          compatible ? applicationRules(initial.slice(1)) : initial.slice(1),
        );
        assert.notEqual(request(parents[0], old, keychain, 'encrypt', plaintext, true).status, 0);
      }
      const migrated = request(parents[0], helper, selectedKeychains, 'decrypt', ciphertext);
      assert.deepEqual(decoded(migrated), plaintext);
      assert.equal(
        (migrated.stderr.match(/fixture-acl-write/g) ?? []).length -
          (migrated.stderr.match(/fixture-structural-repair/g) ?? []).length,
        mode === 'partial'
          ? 2
          : mode === 'cross'
            ? 6
            : mode === 'legacy-only'
              ? 2
              : mode === 'current-only'
                ? 1
                : 3,
        'Instrumentation must observe the actual one-time writes for all matching items',
      );
      const retained = inspect(keychain);
      if (cleanup)
        assert.deepEqual(
          retained.slice(1),
          [null, null],
          'Both exact legacy aliases must be removed',
        );
      if (cleanup) {
        assert.equal(
          (migrated.stderr.match(/fixture-item-delete/g) ?? []).length,
          mode === 'cross' ? 4 : mode === 'current-only' ? 0 : 2,
        );
        run(admin, ['unrelated', keychain]);
      }
      for (const entry of retained.filter(Boolean)) {
        assert.ok(entry);
        const partitions = entry.flatMap((rule) => rule.partitions);
        assert.deepEqual(partitions, expectedPartition);
        for (const rule of entry.filter((rule) => !rule.partitions.length))
          assert.equal(rule.applications, 1);
      }
      if (secondary) {
        const secondaryItems = inspect(secondary);
        if (cleanup) assert.deepEqual(secondaryItems.slice(1), [null, null]);
        for (const entry of secondaryItems.filter(Boolean))
          assert.deepEqual(
            entry.flatMap((rule) => rule.partitions),
            expectedPartition,
          );
        const denied = request(parents[0], old, secondary, 'decrypt', ciphertext, true);
        assert.notEqual(denied.status, 0);
        assert.equal(denied.stdout, '');
      }
      const retired = request(parents[0], old, keychain, 'decrypt', ciphertext, true);
      assert.notEqual(retired.status, 0);
      assert.equal(retired.stdout, '');
      for (let restart = 0; restart < 4; restart++) {
        for (const operation of ['decrypt', 'encrypt']) {
          const reopened = request(
            parents[restart % 2],
            helper,
            selectedKeychains,
            operation,
            operation === 'decrypt' ? ciphertext : plaintext,
          );
          assert.deepEqual(decoded(reopened), operation === 'decrypt' ? plaintext : ciphertext);
          assert.doesNotMatch(
            reopened.stderr,
            /fixture-acl-write/,
            'A new process after completed migration must not rewrite any item ACL',
          );
          if (cleanup)
            assert.doesNotMatch(
              reopened.stderr,
              /fixture-item-delete/,
              'Completed cleanup must be idempotent in later processes',
            );
        }
      }
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
        expectedPartition,
      );
      for (const rule of created[0].filter((rule) => !rule.partitions.length))
        assert.equal(rule.applications, 1);
      const reopened = request(parents[1], helper, keychain, 'decrypt', fresh);
      assert.deepEqual(decoded(reopened), plaintext);
      assert.doesNotMatch(reopened.stderr, /fixture-acl-write/);
      assert.notEqual(request(parents[0], old, keychain, 'decrypt', fresh, true).status, 0);
    } else {
      const denied = request(parents[0], helper, keychain, 'encrypt', plaintext, true);
      assert.notEqual(denied.status, 0);
      assert.equal(denied.stdout, '');
      if (cleanup) assert.doesNotMatch(denied.stderr, /fixture-item-delete/);
      assert.deepEqual(
        compatible ? applicationRules(inspect(keychain)) : inspect(keychain),
        compatible ? applicationRules(initial) : initial,
        'Failure must not change application authority or generate/import a password',
      );
    }
  }
  if (cleanup) {
    for (const phase of ['cleanup-0', 'cleanup-1', 'invalid-cipher']) {
      const keychain = path.join(directory, phase + '.keychain-db');
      run(admin, ['create', keychain]);
      keychains.push(keychain);
      run(admin, ['seed', keychain, old, helper, 'normal']);
      const brokenCipher = phase === 'invalid-cipher';
      const failureAt = phase.endsWith('1') ? 1 : 0;
      const failed = request(
        parents[0],
        helper,
        keychain,
        'decrypt',
        brokenCipher ? Buffer.concat([ciphertext, Buffer.of(0)]) : ciphertext,
        true,
        brokenCipher
          ? process.env
          : { ...process.env, VOXCUE_CREDENTIAL_FAIL_DELETE_AT: String(failureAt) },
      );
      assert.notEqual(failed.status, 0);
      assert.equal(failed.stdout, '');
      const remaining = inspect(keychain);
      assert.ok(remaining[0], 'The current retained item must survive every failure');
      assert.equal(remaining.slice(1).filter(Boolean).length, brokenCipher ? 2 : 2 - failureAt);
      run(admin, ['unrelated', keychain]);
      const resumed = request(parents[1], helper, keychain, 'decrypt', ciphertext);
      assert.deepEqual(decoded(resumed), plaintext);
      assert.doesNotMatch(resumed.stderr, /fixture-acl-write/);
      assert.equal(
        (resumed.stderr.match(/fixture-item-delete/g) ?? []).length,
        brokenCipher ? 2 : 2 - failureAt,
      );
      assert.deepEqual(inspect(keychain).slice(1), [null, null]);
      run(admin, ['unrelated', keychain]);
    }
    const keychain = path.join(directory, 'synthetic.keychain-db');
    run(admin, ['create', keychain]);
    keychains.push(keychain);
    run(admin, ['seed', keychain, old, helper, 'normal']);
    const fixedParent = path.join(directory, 'bound-parent');
    compile(source, fixedParent, [
      '-DVOXCUE_REVISION=3',
      '-DVOXCUE_FIXTURE_BOUND_HELPER=' + JSON.stringify(helper),
      '-DVOXCUE_FIXTURE_BOUND_KEYCHAIN=' + JSON.stringify(keychain),
    ]);
    sign(fixedParent, parentIdentifier);
    assert.equal(run(fixedParent, [helper], '{}', true).status, 76);
    const records = [
      'synthetic-cloud-session',
      'synthetic-chatgpt-session',
      'synthetic-telemetry-proof',
    ];
    const files = records.map((_, index) => path.join(directory, 'vault-' + index + '.bin'));
    const originals = [];
    for (const [index, record] of records.entries()) {
      const cipher = createCipheriv(
        'aes-128-cbc',
        pbkdf2Sync('synthetic-safe-storage-password', 'saltysalt', 1003, 16, 'sha1'),
        Buffer.alloc(16, ' '),
      );
      const bytes = Buffer.concat([Buffer.from('v10'), cipher.update(record), cipher.final()]);
      originals.push(bytes);
      await writeFile(files[index], bytes, { mode: 0o600 });
    }
    const childProcess = workspace.platformRequire('node:child_process');
    const spawn = childProcess.spawn;
    let active = 0,
      peak = 0,
      calls = 0,
      retirementError;
    childProcess.spawn = function (executable, args, options) {
      if (stopping) throw Error('The owned credential fixture is stopping');
      assert.equal(executable, fixedParent);
      assert.deepEqual(args, []);
      assert.deepEqual(options.env, { PATH: '/usr/bin:/bin:/usr/sbin:/sbin' });
      active++;
      calls++;
      peak = Math.max(peak, active);
      const child = spawn.call(this, executable, args, { ...options, detached: true });
      if (Number.isSafeInteger(child.pid) && child.pid > 0) processGroups.add(child.pid);
      child.once('exit', () => {
        try {
          if (processGroups.has(child.pid) && groupAlive(child.pid)) {
            retirementError ??= Error('Credential fixture parent exited before its helper');
            signalGroup(child.pid, 'SIGKILL');
          } else processGroups.delete(child.pid);
        } catch (error) {
          retirementError ??= error;
        }
      });
      const end = child.stdin.end.bind(child.stdin);
      child.stdin.end = function (input, ...rest) {
        try {
          const request = JSON.parse(input);
          assert.deepEqual(Object.keys(request).sort(), ['data', 'language', 'operation']);
          assert.equal(request.language, 'zh-CN');
          assert.ok(['encrypt', 'decrypt'].includes(request.operation));
          assert.equal(typeof request.data, 'string');
          // The archived v5 fixture predates language metadata. Check the
          // current JS request, then adapt only this owned legacy transport.
          return end(JSON.stringify({ operation: request.operation, data: request.data }), ...rest);
        } catch (error) {
          if (processGroups.has(child.pid)) signalGroup(child.pid, 'SIGTERM');
          throw error;
        }
      };
      child.once('close', () => active--);
      return child;
    };
    try {
      const { createCredentialEncryption } = workspace.platformRequire(
        path.join(workspace.platformRoot, 'dist-electron/macos/electron/credentials.js'),
      );
      const port = createCredentialEncryption(fixedParent);
      const loaded = await Promise.all(
        files.map(async (file) => port.decrypt(await readFile(file))),
      );
      assert.deepEqual(loaded, records);
      assert.deepEqual(inspect(keychain).slice(1), [null, null]);
      for (const [index, file] of files.entries())
        assert.deepEqual(await readFile(file), originals[index]);
      const saved = await Promise.all(records.map((record) => port.encrypt(record)));
      for (const [index, file] of files.entries()) {
        assert.deepEqual(saved[index], originals[index]);
        await writeFile(file, saved[index], { mode: 0o600 });
      }
      const restarted = createCredentialEncryption(fixedParent);
      assert.deepEqual(
        await Promise.all(files.map(async (file) => restarted.decrypt(await readFile(file)))),
        records,
      );
      assert.equal(peak, 1);
      assert.equal(active, 0);
      assert.equal(calls, 9);
      assert.equal(retirementError, undefined);
      assert.notEqual(request(parents[0], old, keychain, 'decrypt', ciphertext, true).status, 0);
      run(admin, ['unrelated', keychain]);
      console.log(
        'PASS: actual Mac JS port + current native cleanup preserves three legacy vaults, writes identical v10 bytes, serializes helpers and reads again after restart.',
      );
    } finally {
      try {
        await retireGroups();
      } finally {
        childProcess.spawn = spawn;
      }
    }
  }
  const invalid = run(helper, [], '{}', true);
  assert.equal(invalid.status, 77);
  const guardKeychain = path.join(directory, 'guard.keychain-db');
  run(admin, ['create', guardKeychain]);
  keychains.push(guardKeychain);
  for (const production of productionCopies) {
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
        '-DVOXCUE_PRODUCTION_HELPER_PATH=' + JSON.stringify(productionFixed ?? productionV2),
        '-DVOXCUE_PRODUCTION_HELPER_HASH=' +
          JSON.stringify(codeHash(productionFixed ?? productionV2)),
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
  if (cleanup)
    assert.equal(
      run(parents[0], [helper, guardKeychain], '{}', true, {
        ...process.env,
        VOXCUE_CREDENTIAL_FAIL_DELETE_AT: '1;exec',
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
    'PASS: nonce-isolated credential migration fixture; unchanged v10/password, all aliases restricted to the current helper, malformed partition records removed for compatible mode, old fixture denied, two test-parent revisions, runtime/identity/entitlement and direct DYLD checks, partial retry and fail-closed migration, restricted fresh install. Real v1/v2 helpers reject nonce parents; the fixed formal harness sends only invalid ciphertext/arguments before Keychain access. Synthetic Keychains only.',
  );
  if (cleanup)
    console.log(
      'PASS: current helper cleans only validated legacy aliases after v10 roundtrip; retained current key, unrelated items, partial-delete retry, invalid-cipher no-delete, old-v2 denial and repeated new-process reads verified.',
    );
} finally {
  try {
    await cleanupOwned();
  } finally {
    process.removeListener('SIGINT', onInterrupt);
    process.removeListener('SIGTERM', onTerminate);
    releaseAwake();
  }
}
