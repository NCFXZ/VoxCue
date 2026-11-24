import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, copyFile, writeFile, readFile, unlink } from 'node:fs/promises';
import { execFileSync, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { testRoot } from '../../../shared/test/scripts/test-workspace.mjs';
import { probe } from './window-probe.mjs';

assert.equal(probe('desktop').interactive, true);
const root = path.join(testRoot, 'signing/windows');
const script = path.join(root, 'scripts/update-signing.mjs');
const output = path.join(root, 'release/installer');
const compiled = 'dist-electron/shared/electron';
await mkdir(path.dirname(script), { recursive: true });
await mkdir(output, { recursive: true });
await copyFile('scripts/update-signing.mjs', script);
for (const file of [
  'backend/updates/windowsManifest.js',
  'backend/updates/releases.js',
  'backend/updates/cache.js',
  'backend/atomicFile.js',
  'backend/downloads.js',
  'contracts/versions.js',
]) {
  const staged = path.join(root, compiled, file);
  await mkdir(path.dirname(staged), { recursive: true });
  await copyFile(path.join(compiled, file), staged);
}
const env = { ...process.env, NODE_PATH: path.resolve('node_modules') };
const run = (args, success = true) => {
  assert.equal(probe('desktop').interactive, true);
  const result = spawnSync(process.execPath, args, {
    cwd: root,
    env,
    windowsHide: true,
    encoding: 'utf8',
    timeout: 15000,
  });
  if (success) assert.equal(result.status, 0, result.stderr);
  else assert.notEqual(result.status, 0);
  return result;
};
run([script, '--init']);
assert.match(run([script, '--init'], false).stderr, /already exists/);
const version = '9.8.7';
const name = `VoxCue-Setup-${version}-x64.exe`;
const payload = Buffer.from('inert synthetic installer, never executed');
const digest = createHash('sha512').update(payload).digest('base64');
await writeFile(path.join(output, name), payload);
const manifest = path.join(output, 'latest.yml');
await writeFile(
  manifest,
  JSON.stringify({ version, files: [{ url: name, size: payload.length, sha512: digest }] }),
);
const invoke = (operation) => [
  '--input-type=module',
  '-e',
  `const tool=await import(${JSON.stringify(pathToFileURL(script).href)}); ${operation}`,
];
run(invoke(`await tool.signWindowsManifest(${JSON.stringify(manifest)});`));
const require = createRequire(import.meta.url);
const yaml = createRequire(require.resolve('electron-updater/package.json'))('js-yaml');
const signed = yaml.load(await readFile(manifest, 'utf8'));
const key = JSON.parse(await readFile(path.join(root, 'update-public-key.json'), 'utf8'));
const { signedWindowsUpdate } = require(
  path.resolve('dist-electron/shared/electron/backend/updates/windowsManifest.js'),
);
const candidate = {
  version,
  tag: 'fixture',
  publishedAt: 1700000000000,
  manifest: 'latest.yml',
  binary: { name, size: payload.length },
};
assert.equal(signedWindowsUpdate(signed, candidate, key.publicKey).version, version);
const before = await readFile(manifest);
await writeFile(path.join(output, name), Buffer.alloc(payload.length));
assert.match(
  run(invoke(`await tool.signWindowsManifest(${JSON.stringify(manifest)});`), false).stderr,
  /changed before signing/,
);
assert.deepEqual(await readFile(manifest), before);
assert.match(
  run(
    invoke(
      `await tool.signWindowsManifest(${JSON.stringify(path.join(testRoot, 'unowned.yml'))});`,
    ),
    false,
  ).stderr,
  /current Windows installer/,
);
const privateFile = path.join(root, '.tools/update-signing/ed25519.key');
const offline = path.join(testRoot, 'offline');
await mkdir(offline);
const backupFile = path.join(offline, 'synthetic-update-key.encrypted.json');
const tool = await import(pathToFileURL(script).href);
const passphrase = Buffer.from('synthetic-only unique backup passphrase 2026!');
const wrongPassphrase = Buffer.from('different-only unique backup passphrase 2026!');
try {
  assert.match(run([script, '--backup=' + backupFile], false).stderr, /interactive terminal/);
  await assert.rejects(
    tool.backupSigningIdentity(backupFile, Buffer.from('weak')),
    /strong passphrase/,
  );
  await assert.rejects(
    tool.backupSigningIdentity(path.join(root, 'backup.json'), passphrase),
    /outside the source workspace/,
  );
  await tool.backupSigningIdentity(backupFile, passphrase);
  const encrypted = await readFile(backupFile, 'utf8');
  assert.ok(!encrypted.includes('BEGIN PRIVATE KEY'));
  assert.ok(!encrypted.includes(passphrase.toString()));
  await assert.rejects(tool.backupSigningIdentity(backupFile, passphrase), /already exists/);
  await assert.rejects(tool.restoreSigningIdentity(backupFile, passphrase), /will not overwrite/);
  assert.equal(await readFile(backupFile, 'utf8'), encrypted);
  // Only this run's synthetic key is removed to simulate loss; the public pin stays unchanged.
  await unlink(privateFile);
  await assert.rejects(
    tool.restoreSigningIdentity(backupFile, wrongPassphrase),
    /passphrase is incorrect/,
  );
  await assert.rejects(readFile(privateFile), { code: 'ENOENT' });
  const invalidFile = path.join(offline, 'invalid.encrypted.json');
  await writeFile(invalidFile, 'synthetic invalid backup text, never echo this content');
  await assert.rejects(tool.restoreSigningIdentity(invalidFile, passphrase), {
    message: 'Invalid encrypted update backup',
  });
  const tampered = JSON.parse(encrypted);
  const data = Buffer.from(tampered.data, 'base64');
  data[0] ^= 1;
  tampered.data = data.toString('base64');
  const tamperedFile = path.join(offline, 'tampered.encrypted.json');
  await writeFile(tamperedFile, JSON.stringify(tampered));
  await assert.rejects(
    tool.restoreSigningIdentity(tamperedFile, passphrase),
    /passphrase is incorrect/,
  );
  await assert.rejects(readFile(privateFile), { code: 'ENOENT' });
  const publicFile = path.join(root, 'update-public-key.json');
  const pinned = await readFile(publicFile);
  await writeFile(
    publicFile,
    JSON.stringify({ protocol: 1, publicKey: Buffer.alloc(32, 8).toString('base64') }),
  );
  try {
    await assert.rejects(
      tool.restoreSigningIdentity(backupFile, passphrase),
      /does not match the pinned/,
    );
  } finally {
    await writeFile(publicFile, pinned);
  }
  await tool.restoreSigningIdentity(backupFile, passphrase);
  assert.deepEqual(await readFile(publicFile), pinned);
  await writeFile(path.join(output, name), payload);
  run(invoke(`await tool.signWindowsManifest(${JSON.stringify(manifest)});`));
  const recovered = yaml.load(await readFile(manifest, 'utf8'));
  assert.equal(
    signedWindowsUpdate(recovered, candidate, key.publicKey).voxcueSignature,
    signed.files[0].voxcueSignature,
  );
  await assert.rejects(tool.restoreSigningIdentity(backupFile, passphrase), /will not overwrite/);
} finally {
  passphrase.fill(0);
  wrongPassphrase.fill(0);
}
execFileSync('icacls.exe', [privateFile, '/grant', '*S-1-1-0:R'], {
  stdio: 'pipe',
  windowsHide: true,
  timeout: 10000,
});
assert.match(
  run(invoke('await tool.signingIdentity();'), false).stderr,
  /Unexpected signing key access/,
);
const unsafeRoot = path.join(testRoot, 'unsafe-signing');
const unsafeDirectory = path.join(unsafeRoot, '.tools/update-signing');
const unsafeScript = path.join(unsafeRoot, 'scripts/update-signing.mjs');
await mkdir(unsafeDirectory, { recursive: true });
await mkdir(path.dirname(unsafeScript), { recursive: true });
await copyFile('scripts/update-signing.mjs', unsafeScript);
execFileSync('icacls.exe', [unsafeDirectory, '/grant', '*S-1-1-0:R'], {
  stdio: 'pipe',
  windowsHide: true,
  timeout: 10000,
});
assert.match(run([unsafeScript, '--init'], false).stderr, /Unexpected signing key access/);
await assert.rejects(readFile(path.join(unsafeDirectory, 'ed25519.key')), { code: 'ENOENT' });
console.log(
  'Windows signing tool: protected initialization, encrypted same-identity backup/restore, tamper and wrong-passphrase rejection, no overwrite/rotation, staging signatures and unsafe-ACL refusal verified with temporary synthetic keys only.',
);
