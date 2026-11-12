import {
  createHash,
  createCipheriv,
  createDecipheriv,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
  scryptSync,
  sign,
} from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, mkdir, readFile, realpath, unlink, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const directory = path.join(root, '.tools/update-signing');
const privateFile = path.join(directory, 'ed25519.key');
const publicFile = path.join(root, 'update-public-key.json');
const require = createRequire(import.meta.url);
const absent = (error) => error.code === 'ENOENT';
const backupFormat = 'voxcue-windows-update-backup-v1';
const backupKdf = { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };

async function regular(file, limit) {
  const stat = await lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > limit)
    throw Error('Unsafe Windows update signing file');
}

async function ownedDirectory() {
  const stat = await lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (await realpath(directory)) !== directory)
    throw Error('Unsafe Windows update signing directory');
}

function protectedIdentity(includeFile = true) {
  if (process.platform !== 'win32')
    throw Error('Windows signing requires the current Windows owner');
  const script =
    '$ErrorActionPreference="Stop"; $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value; ' +
    '$dir=[IO.Directory]::GetAccessControl($env:VOXCUE_SIGNING_DIRECTORY); if(!$dir.AreAccessRulesProtected){throw "Unprotected signing directory"}; ' +
    'foreach($p in @($env:VOXCUE_SIGNING_DIRECTORY,$env:VOXCUE_SIGNING_FILE)){' +
    '$acl=if([IO.Directory]::Exists($p)){[IO.Directory]::GetAccessControl($p)}else{[IO.File]::GetAccessControl($p)}; if($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $sid){throw "Unexpected signing owner"}; ' +
    'foreach($r in $acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])){' +
    'if($r.AccessControlType -eq "Allow" -and $r.IdentityReference.Value -ne $sid){throw "Unexpected signing key access"}}}';
  execFileSync(
    path.join(
      process.env.SystemRoot || 'C:\\Windows',
      'System32/WindowsPowerShell/v1.0/powershell.exe',
    ),
    ['-NoProfile', '-NonInteractive', '-Command', script],
    {
      windowsHide: true,
      stdio: 'pipe',
      timeout: 10000,
      env: {
        ...process.env,
        VOXCUE_SIGNING_DIRECTORY: directory,
        VOXCUE_SIGNING_FILE: includeFile ? privateFile : directory,
      },
    },
  );
}

async function prepareIdentityDirectory() {
  if (process.platform !== 'win32')
    throw Error('Windows update identity must be provisioned on Windows');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await ownedDirectory();
  const sid = execFileSync('whoami.exe', ['/user', '/fo', 'csv', '/nh'], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 10000,
  }).match(/S-1-5-\d+(?:-\d+)+/)?.[0];
  if (!sid) throw Error('Cannot resolve the Windows signing identity owner');
  execFileSync('icacls.exe', [directory, '/inheritance:r', '/grant:r', `*${sid}:(OI)(CI)F`], {
    windowsHide: true,
    stdio: 'pipe',
    timeout: 10000,
  });
  protectedIdentity(false);
}

/** Explicit one-time provisioning only; packaging never creates or rotates an identity. */
async function initialize() {
  for (const file of [privateFile, publicFile]) {
    if (await exists(file))
      throw Error('Windows update identity already exists; automatic replacement is forbidden');
  }
  await prepareIdentityDirectory();
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const raw = Buffer.from(publicKey.export({ format: 'jwk' }).x, 'base64url').toString('base64');
  await writeFile(privateFile, privateKey.export({ type: 'pkcs8', format: 'pem' }), {
    flag: 'wx',
    mode: 0o600,
  });
  protectedIdentity();
  await writeFile(publicFile, JSON.stringify({ protocol: 1, publicKey: raw }, null, 2) + '\n', {
    flag: 'wx',
  });
  console.log(
    'Created Windows update signing identity; private key stays in the protected ignored directory.',
  );
}

export async function signingIdentity() {
  await ownedDirectory();
  await regular(privateFile, 4096);
  await regular(publicFile, 4096);
  protectedIdentity();
  const config = JSON.parse(await readFile(publicFile, 'utf8'));
  const key = createPrivateKey(await readFile(privateFile));
  const raw = Buffer.from(createPublicKey(key).export({ format: 'jwk' }).x, 'base64url').toString(
    'base64',
  );
  if (key.asymmetricKeyType !== 'ed25519' || config.protocol !== 1 || config.publicKey !== raw)
    throw Error('Windows update signing identity is missing or mismatched');
  return key;
}

async function exists(file) {
  return lstat(file).then(
    () => true,
    (error) => (absent(error) ? false : Promise.reject(error)),
  );
}

async function externalBackupPath(file) {
  if (typeof file !== 'string' || !path.isAbsolute(file))
    throw Error('An absolute offline backup path is required');
  const resolved = path.resolve(file);
  const relative = path.relative(path.dirname(root), resolved);
  if (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep))
    throw Error('Keep encrypted update backups outside the source workspace');
  if ((await realpath(path.dirname(resolved))) !== path.dirname(resolved))
    throw Error('Update backup parent must not be redirected');
  return resolved;
}

function checkPassphrase(passphrase) {
  if (
    !Buffer.isBuffer(passphrase) ||
    passphrase.length > 1024 ||
    [...passphrase.toString('utf8')].length < 20 ||
    new Set(passphrase).size < 8
  )
    throw Error('Use a strong passphrase of at least 20 characters');
}

function backupBytes(value, size) {
  if (typeof value !== 'string' || value.length > 8192)
    throw Error('Invalid encrypted update backup');
  const bytes = Buffer.from(value, 'base64');
  if (bytes.toString('base64') !== value || (size && bytes.length !== size))
    throw Error('Invalid encrypted update backup');
  return bytes;
}

/** Owner-invoked development operation; no backup or passphrase enters the application. */
export async function backupSigningIdentity(destination, passphrase) {
  checkPassphrase(passphrase);
  destination = await externalBackupPath(destination);
  if (await exists(destination)) throw Error('Encrypted update backup already exists');
  const identity = await signingIdentity();
  const publicKey = Buffer.from(
    createPublicKey(identity).export({ format: 'jwk' }).x,
    'base64url',
  ).toString('base64');
  const salt = randomBytes(32),
    iv = randomBytes(12);
  const derived = scryptSync(passphrase, salt, 32, backupKdf);
  const plaintext = Buffer.from(identity.export({ type: 'pkcs8', format: 'pem' }));
  try {
    const cipher = createCipheriv('aes-256-gcm', derived, iv);
    cipher.setAAD(Buffer.from(JSON.stringify([backupFormat, publicKey])));
    const data = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    await writeFile(
      destination,
      JSON.stringify({
        format: backupFormat,
        publicKey,
        salt: salt.toString('base64'),
        iv: iv.toString('base64'),
        tag: cipher.getAuthTag().toString('base64'),
        data: data.toString('base64'),
      }) + '\n',
      { flag: 'wx', mode: 0o600 },
    );
  } finally {
    derived.fill(0);
    plaintext.fill(0);
  }
}

/** Restore the same pinned identity only. Existing keys and public configuration stay untouched. */
export async function restoreSigningIdentity(source, passphrase) {
  checkPassphrase(passphrase);
  source = await externalBackupPath(source);
  if (await exists(privateFile))
    throw Error('Windows update identity already exists; restore will not overwrite it');
  await regular(publicFile, 4096);
  await regular(source, 16384);
  const pinned = JSON.parse(await readFile(publicFile, 'utf8'));
  let backup;
  try {
    backup = JSON.parse(await readFile(source, 'utf8'));
  } catch {
    throw Error('Invalid encrypted update backup');
  }
  if (
    !backup ||
    typeof backup !== 'object' ||
    Array.isArray(backup) ||
    pinned.protocol !== 1 ||
    backup.format !== backupFormat ||
    backup.publicKey !== pinned.publicKey
  )
    throw Error('Encrypted backup does not match the pinned Windows update identity');
  const derived = scryptSync(passphrase, backupBytes(backup.salt, 32), 32, backupKdf);
  const chunks = [];
  let plaintext;
  try {
    const decipher = createDecipheriv('aes-256-gcm', derived, backupBytes(backup.iv, 12));
    decipher.setAAD(Buffer.from(JSON.stringify([backupFormat, backup.publicKey])));
    decipher.setAuthTag(backupBytes(backup.tag, 16));
    try {
      chunks.push(decipher.update(backupBytes(backup.data)));
      chunks.push(decipher.final());
      plaintext = Buffer.concat(chunks);
    } catch {
      throw Error('Encrypted update backup is invalid or the passphrase is incorrect');
    }
    const identity = createPrivateKey(plaintext);
    const publicKey = Buffer.from(
      createPublicKey(identity).export({ format: 'jwk' }).x,
      'base64url',
    ).toString('base64');
    if (identity.asymmetricKeyType !== 'ed25519' || publicKey !== pinned.publicKey)
      throw Error('Encrypted backup does not match the pinned Windows update identity');
    await prepareIdentityDirectory();
    await writeFile(privateFile, plaintext, { flag: 'wx', mode: 0o600 });
    try {
      protectedIdentity();
    } catch (error) {
      await unlink(privateFile);
      throw error;
    }
  } finally {
    derived.fill(0);
    plaintext?.fill(0);
    for (const chunk of chunks) chunk.fill(0);
  }
}

function readPassphrase(prompt) {
  if (!process.stdin.isTTY || !process.stdout.isTTY)
    throw Error(
      'Backup and restore require an interactive terminal; passphrases are never accepted through arguments or environment variables',
    );
  return new Promise((resolve, reject) => {
    const bytes = [];
    const wasRaw = !!process.stdin.isRaw;
    let finished = false;
    const finish = (error) => {
      if (finished) return;
      finished = true;
      process.stdin.removeListener('data', input);
      process.stdin.removeListener('end', ended);
      process.stdin.removeListener('error', ended);
      process.stdin.setRawMode(wasRaw);
      process.stdin.pause();
      process.stdout.write('\n');
      const secret = error ? undefined : Buffer.from(bytes);
      bytes.fill(0);
      if (error) reject(error);
      else resolve(secret);
    };
    const ended = () => finish(Error('Signing terminal closed'));
    const input = (data) => {
      for (const byte of data) {
        if (byte === 13 || byte === 10) return finish();
        if (byte === 3 || byte === 4 || byte === 27)
          return finish(Error('Signing operation cancelled'));
        if (byte === 8 || byte === 127) {
          let removed = bytes.pop();
          while (removed !== undefined && (removed & 0xc0) === 0x80) removed = bytes.pop();
        } else if (byte >= 32) bytes.push(byte);
        if (bytes.length > 1024) return finish(Error('Passphrase exceeds the size limit'));
      }
    };
    process.stdout.write(prompt);
    process.stdin.setRawMode(true);
    process.stdin.on('data', input);
    process.stdin.once('end', ended);
    process.stdin.once('error', ended);
    process.stdin.resume();
  });
}

export async function signWindowsManifest(file) {
  const expected = path.join(root, 'release/installer/latest.yml');
  if (
    path.resolve(file) !== expected ||
    (await realpath(path.dirname(file))) !== path.dirname(expected)
  )
    throw Error('Sign only the current Windows installer staging manifest');
  await regular(file, 128 * 1024);
  const key = await signingIdentity();
  const yaml = createRequire(require.resolve('electron-updater/package.json'))('js-yaml');
  const metadata = yaml.load(await readFile(file, 'utf8'));
  const name = `VoxCue-Setup-${metadata.version}-x64.exe`;
  const binary = path.join(path.dirname(file), name);
  if (path.dirname(binary) !== path.dirname(file)) throw Error('Invalid Windows installer name');
  await regular(binary, 4 * 1024 ** 3);
  const stat = await lstat(binary);
  const hash = createHash('sha512');
  for await (const chunk of createReadStream(binary)) hash.update(chunk);
  const candidate = {
    version: metadata.version,
    tag: 'signing',
    manifest: 'latest.yml',
    publishedAt: 0,
    binary: { name, size: stat.size },
  };
  const { manifestFile } = require('../dist-electron/shared/electron/backend/updates/releases.js');
  const {
    windowsUpdatePayload,
    signedWindowsUpdate,
  } = require('../dist-electron/shared/electron/backend/updates/windowsManifest.js');
  const selected = manifestFile(metadata, candidate);
  if (selected.sha512 !== hash.digest('base64')) throw Error('Installer changed before signing');
  const selectedFile = metadata.files.find((entry) => entry.url === name);
  selectedFile.voxcueSignature = sign(
    null,
    windowsUpdatePayload({ ...selected, version: candidate.version }),
    key,
  ).toString('base64');
  const config = JSON.parse(await readFile(publicFile, 'utf8'));
  signedWindowsUpdate(metadata, candidate, config.publicKey);
  await writeFile(file, yaml.dump(metadata));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3) throw Error('Expected --init, --backup=PATH or --restore=PATH');
  const operation = process.argv[2];
  if (operation === '--init') await initialize();
  else {
    const match = /^--(backup|restore)=(.+)$/.exec(operation);
    if (!match) throw Error('Expected --init, --backup=PATH or --restore=PATH');
    const passphrase = await readPassphrase('Encrypted backup passphrase (hidden): ');
    try {
      checkPassphrase(passphrase);
      if (match[1] === 'backup') {
        const confirmation = await readPassphrase('Confirm passphrase (hidden): ');
        try {
          if (!passphrase.equals(confirmation)) throw Error('Passphrases do not match');
        } finally {
          confirmation.fill(0);
        }
        await backupSigningIdentity(match[2], passphrase);
      } else await restoreSigningIdentity(match[2], passphrase);
      console.log(
        match[1] === 'backup'
          ? 'Created encrypted update backup.'
          : 'Restored the same pinned Windows update identity.',
      );
    } finally {
      passphrase.fill(0);
    }
  }
}
