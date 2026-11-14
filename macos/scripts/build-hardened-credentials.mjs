import { mkdir, mkdtemp, rm, lstat, realpath, open, rename } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { constants } from 'node:fs';
import path from 'node:path';
import { verifyLocalApp } from './development-signing.mjs';

export const credentialFile = 'VoxCue.Credentials';
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
export async function ownedFile(file, optional = false) {
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
function execute(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 60000 });
  if (result.error || result.status) throw result.error ?? Error(result.stderr);
  return result;
}
export function verifyHardenedCredentials(binary, signing, identifier) {
  if (typeof identifier !== 'string' || !identifier)
    throw Error('Credential helper identifier is required');
  verifyLocalApp(binary, signing, identifier);
  const metadata = execute('/usr/bin/codesign', ['-d', '--verbose=4', binary]);
  if (!/flags=0x[0-9a-f]+\([^\n]*\bruntime\b/.test(metadata.stderr))
    throw Error('Credential helper requires Hardened Runtime');
  const entitlements = execute('/usr/bin/codesign', ['-d', '--entitlements', ':-', binary]);
  if (/<key>/.test(entitlements.stdout))
    throw Error('Credential helper must not have entitlement exceptions');
}
