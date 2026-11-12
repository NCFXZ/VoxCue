import workspace from '../../shared/scripts/workspace.mjs';
import {
  readFile,
  mkdir,
  mkdtemp,
  rm,
  lstat,
  realpath,
  open,
  rename,
} from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { constants } from 'node:fs';
import path from 'node:path';
import { localSigningCertificate, verifyLocalApp } from './development-signing.mjs';

export const hardenedCredentialIdentifier = 'com.voxcue.credentials.hardened';
export const credentialFile = 'VoxCue.Credentials';
const digest = (value) => createHash('sha256').update(value).digest('hex');
const helperDirectory = path.join(workspace.platformRoot, '.tools/credential-helper-v2');
function checkOwnedNode(info, file, directory) {
  if (
    info.isSymbolicLink() ||
    (directory ? !info.isDirectory() : !info.isFile()) ||
    info.uid !== process.getuid() ||
    info.mode & 0o022 ||
    (!directory && info.nlink !== 1)
  )
    throw Error('Credential helper path must be owned and unredirected: ' + file);
}
async function ownedDirectory(directory, create = false) {
  const info = await lstat(directory).catch((error) => {
    if (error.code !== 'ENOENT') throw error;
  });
  if (!info) {
    if (!create) throw Error('Credential helper directory is missing: ' + directory);
    await ownedDirectory(path.dirname(directory));
    await mkdir(directory).catch((error) => {
      if (error.code !== 'EEXIST') throw error;
    });
  }
  checkOwnedNode(info ?? (await lstat(directory)), directory, true);
  if ((await realpath(directory)) !== path.resolve(directory))
    throw Error('Redirected credential helper directory: ' + directory);
}
async function ownedFile(file, optional = false) {
  await ownedDirectory(path.dirname(file));
  const info = await lstat(file).catch((error) => {
    if (!optional || error.code !== 'ENOENT') throw error;
  });
  if (!info) return undefined;
  checkOwnedNode(info, file, false);
  if ((await realpath(file)) !== path.resolve(file))
    throw Error('Redirected credential helper file: ' + file);
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = await handle.stat();
    checkOwnedNode(opened, file, false);
    if (opened.dev !== info.dev || opened.ino !== info.ino)
      throw Error('Credential helper file changed while opening: ' + file);
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}
export async function readCredentialHelperCache(directory) {
  await ownedDirectory(directory);
  const recordBytes = await ownedFile(path.join(directory, 'build.json'), true);
  const bytes = await ownedFile(path.join(directory, credentialFile), true);
  if (!recordBytes && bytes)
    throw Error('Unrecorded credential helper exists; refusing to replace its identity');
  if (recordBytes && !bytes)
    throw Error('Fixed credential helper is missing; restore its exact identity');
  if (!recordBytes)
    throw Error('Fixed credential helper identity is missing; restore its exact binary and record');
  const record = JSON.parse(recordBytes.toString('utf8'));
  if (!record || typeof record !== 'object' || Array.isArray(record))
    throw Error('Invalid credential helper identity record');
  return { record, bytes };
}
export async function copyCredentialHelper(source, output) {
  const bytes = await ownedFile(source);
  const directory = path.dirname(output);
  await ownedDirectory(directory, true);
  const previous = await ownedFile(output, true);
  if (previous?.equals(bytes)) return output;
  const stage = await mkdtemp(path.join(directory, '.credential-helper-'));
  try {
    const temporary = path.join(stage, credentialFile);
    const handle = await open(
      temporary,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o755,
    );
    try {
      await handle.chmod(0o755);
      await handle.writeFile(bytes);
    } finally {
      await handle.close();
    }
    await ownedDirectory(directory);
    await ownedFile(output, true);
    // Rename replaces the directory entry itself; it cannot write through a
    // destination symlink introduced after validation.
    await rename(temporary, output);
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
  return output;
}
async function readSourceHashes() {
  return Object.fromEntries(
    await Promise.all(
      ['Credentials.mm', 'CredentialsHardened.mm'].map(async (name) => [
        name,
        digest(await readFile(path.join(workspace.platformRoot, 'native', name))),
      ]),
    ),
  );
}
function execute(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 60000 });
  if (result.error || result.status) throw result.error ?? Error(result.stderr);
  return result;
}
export function verifyHardenedCredentials(binary, signing) {
  verifyLocalApp(binary, signing, hardenedCredentialIdentifier);
  const metadata = execute('/usr/bin/codesign', ['-d', '--verbose=4', binary]);
  if (!/flags=0x[0-9a-f]+\([^\n]*\bruntime\b/.test(metadata.stderr))
    throw Error('Credential helper requires Hardened Runtime');
  const entitlements = execute('/usr/bin/codesign', ['-d', '--entitlements', ':-', binary]);
  if (/<key>/.test(entitlements.stdout))
    throw Error('Credential helper must not have entitlement exceptions');
}

export async function verifyFixedHardenedCredentials(binary, signing) {
  const { record, bytes } = await readCredentialHelperCache(helperDirectory);
  if (
    record.certificate !== signing.sha256 ||
    JSON.stringify(record.sourceHashes) !== JSON.stringify(await readSourceHashes()) ||
    record.binaryHash !== digest(bytes) ||
    record.binaryHash !== digest(await ownedFile(binary))
  )
    throw Error('Credential helper does not match the frozen v2 identity and source closure');
  verifyHardenedCredentials(binary, signing);
}

export async function buildHardenedCredentials() {
  const { record, bytes: existing } = await readCredentialHelperCache(helperDirectory);
  const signing = await localSigningCertificate();
  const sourceHashes = await readSourceHashes();
  const canonical = path.join(helperDirectory, credentialFile);
  if (
    record.certificate !== signing.sha256 ||
    JSON.stringify(record.sourceHashes) !== JSON.stringify(sourceHashes) ||
    record.binaryHash !== digest(existing)
  )
    throw Error(
      'Fixed hardened credential helper changed; restore its exact identity or implement a separate compatible migration.',
    );
  verifyHardenedCredentials(canonical, signing);
  const output = path.join(workspace.platformRoot, 'native/bin', credentialFile);
  return copyCredentialHelper(canonical, output);
}
if (process.argv[1] === new URL(import.meta.url).pathname) {
  await buildHardenedCredentials();
  console.log(
    'Prepared fixed hardened credential helper; no credential Keychain item was accessed.',
  );
}
