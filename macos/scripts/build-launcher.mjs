import workspace from '../../shared/scripts/workspace.mjs';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, readdir, readlink, realpath, rename, rm, rmdir, symlink, unlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { localSigningCertificate, verifyLocalApp } from './development-signing.mjs';
import { buildMacApp } from './package-app.mjs';

const root = await realpath(workspace.platformRoot);
if (await realpath(process.cwd()) !== root || process.platform !== 'darwin' || process.arch !== 'arm64')
  throw Error('Run from the macos installation on Apple Silicon.');
const entry = path.join(root, 'VoxCue.app');
const tools = path.join(root, '.tools');
const checkout = createHash('sha256').update(root).digest('hex').slice(0, 16);
const local = path.join(os.homedir(), 'Library/Developer/VoxCue', checkout);
const priorLayout = path.join(local, 'VoxCue.app');
const buildName = /^app-[a-zA-Z0-9]{6}$/;
const pin = await localSigningCertificate();
const { protocol, publicKey } = JSON.parse(await readFile(path.join(root, 'update-public-key.json'), 'utf8'));
if (protocol !== 1 || !/^[A-Za-z0-9+/]{43}=$/.test(publicKey))
  throw Error('Missing or invalid pinned update public key.');

function unused(bundle) {
  const result = spawnSync('/usr/sbin/lsof', ['-t', '+D', bundle], { encoding: 'utf8' });
  return !result.error && result.status === 1 && !result.stdout.trim() && !result.stderr.trim();
}

async function existingEntry() {
  const info = await lstat(entry).catch((error) => {
    if (error.code !== 'ENOENT') throw error;
  });
  if (!info) return;
  if (info.isSymbolicLink()) {
    const target = await readlink(entry);
    const relative = path.relative(local, target).split(path.sep);
    if (target !== priorLayout && !(relative.length === 2 && buildName.test(relative[0]) &&
        relative[1] === 'VoxCue.app' && path.join(local, ...relative) === target))
      throw Error('Unexpected VoxCue.app link: ' + entry);
    return 'link';
  }
  if (!info.isDirectory()) throw Error('Unexpected file at ' + entry);
  verifyLocalApp(entry, pin, 'com.voxcue.launcher', { strict: false });
  if (!unused(entry)) throw Error('Close the old launcher before replacing it.');
  return 'launcher';
}

async function retire(bundle) {
  try {
    if (await realpath(bundle) !== bundle || (await lstat(bundle)).uid !== process.getuid()) return;
    verifyLocalApp(bundle, pin, 'com.voxcue.app');
    if (!unused(bundle)) return;
    await rm(bundle, { recursive: true });
    if (bundle !== priorLayout) await rmdir(path.dirname(bundle));
  } catch (error) {
    if (error.code !== 'ENOENT') console.warn('Retained previous local build: ' + bundle);
  }
}

await mkdir(tools, { recursive: true });
await mkdir(local, { recursive: true, mode: 0o700 });
if (await realpath(local) !== local || (await lstat(local)).uid !== process.getuid())
  throw Error('Unexpected local build directory: ' + local);
const lock = path.join(local, 'build.lock');
// shlock reclaims the lock of an exited build.
execFileSync('/usr/bin/shlock', ['-p', String(process.pid), '-f', lock]);
let stage, next, linkStage, published = false;
try {
  await existingEntry();
  // Keep signed resources outside File Provider. Each running version retains its
  // real path while a rebuild atomically updates the single link in the checkout.
  stage = await mkdtemp(path.join(local, '.build-'));
  const app = await buildMacApp(path.join(stage, 'bundle'), publicKey);
  next = await mkdtemp(path.join(local, 'app-'));
  const target = path.join(next, 'VoxCue.app');
  await rename(app, target);
  verifyLocalApp(target, pin, 'com.voxcue.app');

  const existing = await existingEntry();
  linkStage = await mkdtemp(path.join(tools, 'local-entry-'));
  const link = path.join(linkStage, 'new.app');
  const previous = path.join(linkStage, 'previous');
  await symlink(target, link);
  verifyLocalApp(link, pin, 'com.voxcue.app');
  if (existing === 'launcher') await rename(entry, previous);
  try {
    await rename(link, entry);
    published = true;
  } catch (error) {
    if (existing === 'launcher') {
      try {
        await rename(previous, entry);
      } catch (rollback) {
        const retained = linkStage;
        linkStage = undefined;
        throw new AggregateError([error, rollback], 'Previous launcher retained at ' + retained);
      }
    }
    throw error;
  }
  console.log('Created macos/VoxCue.app (com.voxcue.app).');
  await retire(priorLayout);
  for (const item of await readdir(local, { withFileTypes: true })) {
    const folder = path.join(local, item.name);
    if (item.isDirectory() && buildName.test(item.name) && folder !== next)
      await retire(path.join(folder, 'VoxCue.app'));
  }
} finally {
  try {
    if (stage) await rm(stage, { recursive: true, force: true });
    if (!published && next) await rm(next, { recursive: true, force: true });
    if (linkStage) await rm(linkStage, { recursive: true, force: true });
  } finally {
    await unlink(lock);
  }
}
