import { spawnSync } from 'node:child_process';
import { copyFile, mkdtemp, realpath, rm, writeFile, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createCipheriv, pbkdf2Sync, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import workspace from '../../../shared/scripts/workspace.mjs';
import { loadDevelopmentSigning, signLocalCode } from '../../scripts/development-signing.mjs';
import { holdDesktopAwake, requireUnlockedDesktop } from './desktop-session.mjs';
import { writeCredentialFixtureSource } from './credential-fixture-source.mjs';

// Fixed v8 credential helper: single-source copy, probe and non-interactive
// cleanup on owned temporary keychains only. The host login keychain, real
// accounts and the production parent identity are never used for Keychain work.
if (process.platform !== 'darwin' || process.arch !== 'arm64')
  throw Error('Apple Silicon required');
if (process.argv.length !== 2) throw Error('credential-vault-smoke accepts no arguments');
const releaseAwake = holdDesktopAwake();
const directory = await realpath(await mkdtemp(path.join(tmpdir(), 'voxcue-credential-vault-')));
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
  const vaultSource = await writeCredentialFixtureSource(directory, 'vault-v8', parentIdentifier);
  const hardenedSource = await writeCredentialFixtureSource(
    directory,
    'hardened',
    parentIdentifier,
  );
  let definitions = [
    '-DVOXCUE_FIXTURE_VAULT_SOURCE=' + JSON.stringify(vaultSource),
    '-DVOXCUE_FIXTURE_VAULT_ACCOUNT="VoxCue Key v8"',
    '-DVOXCUE_FIXTURE_HARDENED_SOURCE=' + JSON.stringify(hardenedSource),
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
      ...definitions,
      ...args,
      source,
      '-framework',
      'Foundation',
      '-framework',
      'Security',
      '-o',
      destination,
    ]);
  const sign = (file, identifier, runtime = true, entitlements) =>
    signLocalCode(file, signing, identifier, { preserveMetadata: false, runtime, entitlements });
  const fixture = (name) => path.join(workspace.platformRoot, 'test/fixtures', name);
  const helper = path.join(directory, 'vault');
  compile(fixture('credential-vault-probe.mm'), helper);
  sign(helper, 'com.voxcue.credentials.vault');
  const moved = path.join(directory, 'vault-moved');
  await copyFile(helper, moved);
  const previous = new Map();
  for (const [generation, kind] of [
    [6, 'vault'],
    [7, 'vault-v7'],
  ]) {
    const binary = path.join(directory, 'previous-v' + generation);
    const source = await writeCredentialFixtureSource(directory, kind, parentIdentifier);
    compile(fixture('credential-vault-probe.mm'), binary, [
      '-UVOXCUE_FIXTURE_VAULT_SOURCE',
      '-DVOXCUE_FIXTURE_VAULT_SOURCE=' + JSON.stringify(source),
    ]);
    sign(binary, 'com.voxcue.credentials.vault');
    previous.set(generation, binary);
  }
  // The archived v2 fixture stands for an older helper that historical entries trust.
  const old = path.join(directory, 'hardened');
  compile(fixture('credential-hardening-probe.mm'), old);
  sign(old, 'com.voxcue.credentials.hardened');
  const rejected = [];
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
    const binary = path.join(directory, 'unsafe-' + index);
    await copyFile(helper, binary);
    sign(binary, 'com.voxcue.credentials.vault', true, policy);
    rejected.push(binary);
  }
  const noRuntime = path.join(directory, 'no-runtime');
  await copyFile(helper, noRuntime);
  sign(noRuntime, 'com.voxcue.credentials.vault', false);
  const wrongIdentity = path.join(directory, 'wrong-identity');
  await copyFile(helper, wrongIdentity);
  sign(wrongIdentity, 'com.voxcue.credentials.migrating');
  rejected.push(noRuntime, wrongIdentity);
  const codeHash = (file) => {
    const hash = run('/usr/bin/codesign', ['-d', '--verbose=4', file]).stderr.match(
      /CDHash=(\w+)/,
    )?.[1];
    assert.ok(hash);
    return hash;
  };
  definitions = [
    ...definitions,
    '-DVOXCUE_FIXTURE_HELPERS=@{' +
      [helper, moved, ...previous.values(), old, ...rejected]
        .map((file) => '@' + JSON.stringify(file) + ':@' + JSON.stringify(codeHash(file)))
        .join(',') +
      '}',
    '-DVOXCUE_FIXTURE_LEGACY_PATH=' + JSON.stringify(old),
    '-DVOXCUE_FIXTURE_HARDENED_PATH=' + JSON.stringify(helper),
  ];
  admin = path.join(directory, 'admin');
  compile(fixture('credential-hardening-admin.mm'), admin);
  sign(admin, 'com.voxcue.credential-fixture');
  const parents = {};
  for (const [name, identifier, runtime] of [
    ['formal', parentIdentifier, true],
    ['development', 'com.voxcue.development', true],
    ['non-runtime', parentIdentifier, false],
  ]) {
    parents[name] = path.join(directory, 'parent-' + name);
    compile(fixture('credential-hardening-parent.mm'), parents[name], ['-DVOXCUE_REVISION=1']);
    sign(parents[name], identifier, runtime);
  }
  parents.spoof = path.join(directory, 'parent-spoof');
  await copyFile(parents.formal, parents.spoof);
  run('/usr/bin/codesign', [
    '--force',
    '--sign',
    '-',
    '--identifier',
    parentIdentifier,
    '--options',
    'runtime',
    parents.spoof,
  ]);

  const call = (selected, request, { binary = helper, parent = parents.formal, env } = {}) =>
    run(
      parent,
      [binary, ...(Array.isArray(selected) ? selected : [selected])],
      JSON.stringify(request),
      true,
      env ?? process.env,
    );
  const ok = (result) => {
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  };
  const count = (result, marker) => (result.stderr.match(new RegExp(marker, 'g')) ?? []).length;
  const plaintext = Buffer.from('Synthetic credentials for the v8 single-source copy');
  const cipher = createCipheriv(
    'aes-128-cbc',
    pbkdf2Sync('synthetic-safe-storage-password', 'saltysalt', 1003, 16, 'sha1'),
    Buffer.alloc(16, ' '),
  );
  const ciphertext = Buffer.concat([Buffer.from('v10'), cipher.update(plaintext), cipher.final()]);
  const decrypt = (selected, value = ciphertext, options) =>
    call(selected, { operation: 'decrypt', data: value.toString('base64') }, options);
  const encrypt = (selected, value = plaintext) =>
    call(selected, { operation: 'encrypt', data: value.toString('base64') });
  const probe = (selected) => ok(call(selected, { operation: 'probe' })).state;
  const cleanup = (selected, env) => ok(call(selected, { operation: 'cleanup' }, { env }));
  const validate = (selected, value = ciphertext) =>
    call(selected, { operation: 'validate', data: value.toString('base64') });
  const legacy = (keychain) => JSON.parse(run(admin, ['inspect', keychain]).stdout);
  const vault = (keychain) => JSON.parse(run(admin, ['vault', keychain]).stdout);
  const keychain = (name, mode) => {
    const file = path.join(directory, name + '.keychain-db');
    run(admin, ['create', file]);
    keychains.push(file);
    if (mode) run(admin, ['seed', file, old, helper, mode]);
    return file;
  };
  const assertOwnVault = (file) => {
    const own = vault(file);
    assert.ok(own, 'The own v8 entry must exist');
    assert.equal(own.readable, false, 'An unrelated program must not read the own entry');
    const rules = own.rules.filter(
      (rule) =>
        !rule.tags.includes('ACLAuthorizationIntegrity') &&
        !rule.tags.includes('ACLAuthorizationPartitionID'),
    );
    assert.ok(rules.length >= 3);
    for (const rule of rules) {
      assert.equal(rule.applications, 1, 'Every own rule names only the current helper');
      assert.equal(rule.description, 'VoxCue 登录信息');
    }
  };

  // Identity and request boundaries before any scenario.
  const boundary = keychain('guard', 'normal');
  for (const binary of rejected)
    assert.equal(call(boundary, { operation: 'probe' }, { binary }).status, 77);
  for (const parent of [parents.development, parents['non-runtime'], parents.spoof])
    assert.equal(call(boundary, { operation: 'probe' }, { parent }).status, 77);
  for (const request of [
    { operation: 'probe', data: 'AAAA' },
    { operation: 'cleanup', extra: true },
    { operation: 'encrypt' },
    { operation: 'erase' },
    { operation: 'decrypt', data: 7 },
  ])
    assert.equal(call(boundary, request).status, 79);
  const malformed = decrypt(boundary, Buffer.from('not v10 data'));
  assert.equal(malformed.status, 80);
  assert.equal(count(malformed, 'fixture-item-read'), 0, 'Malformed input never reaches Keychain');
  assert.equal(vault(boundary), null);

  // Fresh install: no prompt expected, first write creates the own entry.
  const fresh = keychain('fresh');
  assert.equal(probe(fresh), 'ready');
  assert.deepEqual(ok(validate(fresh)), { validation: 'unavailable' });
  assert.equal(vault(fresh), null, 'Background validation must never create a key');
  assert.equal(decrypt(fresh).status, 80, 'A missing key never becomes a replacement');
  assert.equal(vault(fresh), null);
  const written = Buffer.from(ok(encrypt(fresh)).data, 'base64');
  assert.ok(written.subarray(0, 3).equals(Buffer.from('v10')));
  assert.deepEqual(Buffer.from(ok(decrypt(fresh, written)).data, 'base64'), plaintext);
  assert.deepEqual(
    Buffer.from(ok(decrypt(fresh, written, { binary: moved })).data, 'base64'),
    plaintext,
    'The unchanged signed helper retains access after its path changes',
  );
  assert.deepEqual(Buffer.from(ok(validate(fresh, written)).data, 'base64'), plaintext);
  assertOwnVault(fresh);
  assert.deepEqual(cleanup(fresh), {
    cleanup: 'complete',
    removed: 0,
    retained: 0,
    reason: 'none',
  });

  // Normal history: one source read, copy, then cleanup removes all three aliases.
  const normal = keychain('normal', 'normal');
  const seeded = legacy(normal);
  assert.deepEqual(ok(validate(normal)), { validation: 'unavailable' });
  assert.equal(vault(normal), null, 'Background validation must never migrate a historical key');
  assert.equal(probe(normal), 'ready');
  const migrated = decrypt(normal);
  assert.deepEqual(Buffer.from(ok(migrated).data, 'base64'), plaintext);
  assert.equal(
    count(migrated, 'fixture-item-read'),
    2,
    'One source read plus one stored read-back',
  );
  assert.equal(count(migrated, 'fixture-item-delete'), 0, 'Copying never deletes');
  assert.deepEqual(legacy(normal), seeded, 'Copying never rewrites historical access');
  assertOwnVault(normal);
  const repeated = decrypt(normal);
  assert.deepEqual(Buffer.from(ok(repeated).data, 'base64'), plaintext);
  assert.equal(count(repeated, 'fixture-item-read'), 1, 'Later requests read only the own entry');
  assert.equal(ok(decrypt(normal, ciphertext, { binary: old })).data.length > 0, true);
  assert.deepEqual(cleanup(normal), {
    cleanup: 'complete',
    removed: 3,
    retained: 0,
    reason: 'none',
  });

  // Both frozen vault generations are sources; later reads use v8 only.
  for (const [revision, binary] of previous) {
    const generation = keychain(revision === 6 ? 'generation' : 'generation-v7', 'normal');
    ok(decrypt(generation, ciphertext, { binary }));
    assert.equal(vault(generation), null);
    assert.deepEqual(ok(validate(generation)), { validation: 'unavailable' });
    assert.deepEqual(Buffer.from(ok(decrypt(generation)).data, 'base64'), plaintext);
    assertOwnVault(generation);
    assert.deepEqual(cleanup(generation), {
      cleanup: 'complete',
      removed: 4,
      retained: 0,
      reason: 'none',
    });
    assert.deepEqual(Buffer.from(ok(validate(generation)).data, 'base64'), plaintext);
    assert.notEqual(
      decrypt(generation, ciphertext, { binary }).status,
      0,
      `The archived v${revision} generation no longer has a readable old alias`,
    );
  }
  assert.deepEqual(legacy(normal), [null, null, null]);
  assert.equal(run(admin, ['unrelated', normal], undefined, true).status, 0);
  assertOwnVault(normal);
  assert.deepEqual(Buffer.from(ok(decrypt(normal)).data, 'base64'), plaintext);
  assert.notEqual(decrypt(normal, ciphertext, { binary: old }).status, 0, 'Old helper lost access');
  assert.deepEqual(cleanup(normal), {
    cleanup: 'complete',
    removed: 0,
    retained: 0,
    reason: 'none',
  });

  // Authorization needed: probe reports it; non-interactive calls change nothing.
  const denied = keychain('denied', 'denied');
  const deniedItems = legacy(denied);
  assert.equal(probe(denied), 'authorize');
  assert.equal(decrypt(denied).status, 80);
  assert.equal(vault(denied), null);
  assert.deepEqual(cleanup(denied), {
    cleanup: 'deferred',
    removed: 0,
    retained: 0,
    reason: 'current',
  });
  assert.deepEqual(legacy(denied), deniedItems);

  // Source order, unchecked different alias and cross-keychain placement.
  for (const [name, removed] of [
    ['legacy-only', 2],
    ['current-only', 1],
    ['different', 3],
  ]) {
    const file = keychain(name, name);
    assert.deepEqual(Buffer.from(ok(decrypt(file)).data, 'base64'), plaintext);
    assertOwnVault(file);
    assert.deepEqual(cleanup(file), { cleanup: 'complete', removed, retained: 0, reason: 'none' });
    assert.deepEqual(legacy(file), [null, null, null]);
  }
  const primary = keychain('cross');
  const secondary = keychain('cross-secondary', 'normal');
  assert.deepEqual(Buffer.from(ok(decrypt([primary, secondary])).data, 'base64'), plaintext);
  assert.equal(vault(primary), null, 'The copy stays in the source keychain');
  assertOwnVault(secondary);
  assert.deepEqual(cleanup([primary, secondary]).removed, 3);

  // A foreign same-name entry is never read, used, replaced or cleaned around.
  run(admin, ['plant', boundary]);
  assert.equal(probe(boundary), 'conflict');
  assert.deepEqual(ok(validate(boundary)), { validation: 'unavailable' });
  const conflict = decrypt(boundary);
  assert.equal(conflict.status, 80);
  assert.equal(count(conflict, 'fixture-item-read'), 0);
  assert.deepEqual(cleanup(boundary), {
    cleanup: 'deferred',
    removed: 0,
    retained: 0,
    reason: 'current',
  });
  assert.deepEqual(legacy(boundary).filter(Boolean).length, 3);

  // Deletion needing interaction keeps that entry and is retried next time.
  const partial = keychain('partial', 'normal');
  ok(decrypt(partial));
  assert.deepEqual(cleanup(partial, { ...process.env, VOXCUE_CREDENTIAL_FAIL_DELETE_AT: '1' }), {
    cleanup: 'partial',
    removed: 2,
    retained: 1,
    reason: 'authorization',
  });
  assert.equal(legacy(partial).filter(Boolean).length, 1);
  assert.deepEqual(cleanup(partial), {
    cleanup: 'complete',
    removed: 1,
    retained: 0,
    reason: 'none',
  });

  // Undecryptable data still leaves every historical copy for the caller's gate.
  const invalid = keychain('invalid-cipher', 'normal');
  const corrupt = Buffer.from(ciphertext);
  corrupt[corrupt.length - 17] ^= 1; // Deterministically invalidate the final CBC padding.
  const broken = decrypt(invalid, corrupt);
  assert.equal(broken.status, 80);
  assert.equal(count(broken, 'fixture-item-delete'), 0);
  assert.equal(legacy(invalid).filter(Boolean).length, 3);
  assert.deepEqual(ok(validate(invalid, corrupt)), { validation: 'invalid' });

  // Production JS queue + the real native fixture, through the nonce-bound
  // parent. No formal production helper is given any Keychain request.
  const adapterKeychain = keychain('adapter', 'normal');
  const require = createRequire(import.meta.url);
  const processes = require('node:child_process');
  const originalSpawn = processes.spawn;
  let active = 0,
    maximum = 0,
    deletionFailure = false;
  processes.spawn = (executable, args, options) => {
    assert.equal(executable, helper);
    assert.deepEqual(args, []);
    const child = originalSpawn(parents.formal, [helper, adapterKeychain], {
      ...options,
      env: {
        ...options.env,
        ...(deletionFailure ? { VOXCUE_CREDENTIAL_FAIL_DELETE_AT: '1' } : {}),
      },
    });
    maximum = Math.max(maximum, ++active);
    child.once('close', () => --active);
    return child;
  };
  try {
    const { createCredentialEncryption } = require(
      path.join(workspace.platformRoot, 'dist-electron/macos/electron/credentials.js'),
    );
    const port = createCredentialEncryption(helper, async () => {
      throw Error('This preauthorized synthetic source must not request authorization');
    });
    const encrypted = await Promise.all(
      Array.from({ length: 4 }, () => port.encrypt('owned synthetic account')),
    );
    assert.deepEqual(
      await Promise.all(encrypted.map((value) => port.decrypt(value))),
      Array(4).fill('owned synthetic account'),
    );
    assert.equal(
      await port.maintain(async (decrypt) => {
        try {
          await decrypt(corrupt);
        } catch {
          /* A swallowed validation failure still blocks cleanup. */
        }
        return true;
      }),
      undefined,
    );
    assert.equal(legacy(adapterKeychain).filter(Boolean).length, 3);
    deletionFailure = true;
    assert.deepEqual(
      await port.maintain(
        async (decrypt) => (await decrypt(encrypted[0])) === 'owned synthetic account',
      ),
      {
        cleanup: 'partial',
        removed: 2,
        retained: 1,
        reason: 'authorization',
      },
    );
    deletionFailure = false;
    assert.equal(await port.decrypt(encrypted[0]), 'owned synthetic account');
    assert.deepEqual(
      await port.maintain(
        async (decrypt) => (await decrypt(encrypted[0])) === 'owned synthetic account',
      ),
      {
        cleanup: 'complete',
        removed: 1,
        retained: 0,
        reason: 'none',
      },
    );
    assert.equal(maximum, 1, 'Crypto and maintenance must share the actual-close queue');
    assert.equal(active, 0);
  } finally {
    processes.spawn = originalSpawn;
  }

  // The frozen production bytes accept only the formal parent; the harness sends
  // fixed invalid input that is rejected before any Keychain access.
  const canonical = path.join(
    workspace.platformRoot,
    '.tools/credential-helper-v8/VoxCue.Credentials',
  );
  if (await lstat(canonical).catch(() => null)) {
    const production = path.join(directory, 'production-v8');
    await copyFile(canonical, production);
    for (const extra of [false, true]) {
      const positive = path.join(directory, 'production-parent-' + Number(extra));
      compile(fixture('credential-production-parent.mm'), positive, [
        '-DVOXCUE_PRODUCTION_HELPER_PATH=' + JSON.stringify(production),
        '-DVOXCUE_PRODUCTION_HELPER_HASH=' + JSON.stringify(codeHash(production)),
        '-DVOXCUE_PRODUCTION_EXTRA_ARGUMENT=' + Number(extra),
      ]);
      sign(positive, 'com.voxcue.app');
      assert.equal(run(positive, [], '', true).status, extra ? 78 : 80);
    }
    console.log('PASS: frozen v8 production bytes accept only the formal parent boundary.');
  } else console.log('SKIP: frozen v8 production bytes are not prepared yet.');
  console.log(
    'PASS: v8 single-source copy, v6/v7 migration, unchanged-helper path moves, no-interaction validation, JS/native serial maintenance, conflicts, partial deletion retries and identity boundaries. Synthetic keychains only.',
  );
} finally {
  try {
    for (const file of keychains.reverse()) run(admin, ['delete', file]);
    assert.equal(lists(), before, 'The original Keychain search list must be unchanged');
  } finally {
    await rm(directory, { recursive: true, force: true });
    releaseAwake();
  }
}
