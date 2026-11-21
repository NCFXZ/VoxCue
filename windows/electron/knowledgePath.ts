import {
  closeSync, fstatSync, ftruncateSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync,
  readdirSync, readlinkSync, realpathSync, rmdirSync, statSync, symlinkSync, unlinkSync,
  writeFileSync, type BigIntStats,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import type { PrepareKnowledgeDatabase } from '../../shared/electron/platform/types';

// Lance's Windows local writer can open a long path but fail to rename its temporary
// file. Only its connection sees this short path. Tables and manifests stay in place.
const marker = 'owner.json';
const alias = 'd';
interface Owner {
  host: number;
  worker?: number;
  parentId: string;
  markerId: string;
  linkId: string;
  targetId: string;
}
const identity = (stat: BigIntStats) => `${stat.dev}:${stat.ino}`;
const samePath = (a: string, b: string) => path.relative(a, b) === '';

function realDirectory(folder: string) {
  const info = lstatSync(folder, { bigint: true });
  if (!info.isDirectory() || info.isSymbolicLink() || !info.ino || !samePath(folder, realpathSync.native(folder)))
    throw Error('知识库目录不可用。');
  return identity(info);
}

function ensureDirectory(folder: string): void {
  const parent = path.dirname(folder);
  if (parent !== folder) ensureDirectory(parent);
  let info = lstatSync(folder, { bigint: true, throwIfNoEntry: false });
  if (!info) {
    try { mkdirSync(folder, { mode: 0o700 }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    info = lstatSync(folder, { bigint: true });
  }
  if (!info.isDirectory() || info.isSymbolicLink()) throw Error('知识库目录不可用。');
}

function running(pid: number) {
  if (!Number.isSafeInteger(pid) || pid < 1) return true;
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code !== 'ESRCH'; }
}

function removeOwned(folder: string, target: string, owner: Owner) {
  const link = path.join(folder, alias);
  if (realDirectory(folder) !== owner.parentId) return;
  const contents = readdirSync(folder);
  if (contents.length !== 2 || !contents.includes(marker) || !contents.includes(alias)) return;
  const markerStat = lstatSync(path.join(folder, marker), { bigint: true });
  const linkStat = lstatSync(link, { bigint: true });
  if (!markerStat.isFile() || markerStat.nlink !== 1n || identity(markerStat) !== owner.markerId || !linkStat.isSymbolicLink() ||
      identity(linkStat) !== owner.linkId || !samePath(readlinkSync(link), target)) return;
  // Unlink the reparse point itself. Never walk, empty, rename or remove its target.
  unlinkSync(link);
  unlinkSync(path.join(folder, marker));
  rmdirSync(folder);
}

function recoverOrphans(root: string, target: string, targetId: string) {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^k-[A-Za-z0-9]{6}$/.test(entry.name)) continue;
    const folder = path.join(root, entry.name);
    try {
      const file = path.join(folder, marker);
      realDirectory(folder);
      const stat = lstatSync(file);
      if (!stat.isFile() || stat.nlink !== 1 || stat.size > 512) continue;
      const old: Owner = JSON.parse(readFileSync(file, 'utf8'));
      // A PID with unknown ownership (including reuse or denied access) stays live.
      if (old.targetId === targetId && old.worker && !running(old.host) && !running(old.worker))
        removeOwned(folder, target, old);
    } catch { /* Unrecognized, changing or occupied directories grant no deletion authority. */ }
  }
}

export const prepareKnowledgeDatabase: PrepareKnowledgeDatabase = (directory) => {
  const requested = path.resolve(directory);
  if (requested.length <= 100) return;
  // Windows Store may virtualize ordinary AppData directories. Resolve its physical
  // destination only after checking every supplied component for reparse points.
  ensureDirectory(requested);
  const target = realpathSync.native(requested);
  const targetId = realDirectory(target);
  // TEMP can be redirected to a shared drive. Keep this namespace in the current
  // user's local app data when its configured temporary folder is outside it.
  const local = realpathSync.native(process.env.LOCALAPPDATA || path.join(homedir(), 'AppData', 'Local'));
  const temp = realpathSync.native(tmpdir());
  const relative = path.relative(local, temp);
  const localTemp = path.join(local, 'Temp');
  const privateTemp = path.isAbsolute(relative) || relative === '..' || relative.startsWith('..' + path.sep) || temp.length > localTemp.length
    ? localTemp : temp;
  const root = path.join(privateTemp, 'VoxCue-k');
  ensureDirectory(root);
  recoverOrphans(root, target, targetId);
  const folder = mkdtempSync(path.join(root, 'k-'));
  const parentId = realDirectory(folder);
  const link = path.join(folder, alias);
  let linkId: string | undefined, markerId: string | undefined;
  const file = path.join(folder, marker);
  try {
    symlinkSync(target, link, 'junction');
    linkId = identity(lstatSync(link, { bigint: true }));
    if (!samePath(realpathSync.native(link), target) || identity(statSync(link, { bigint: true })) !== targetId)
      throw Error('知识库目录不可用。');
    const first = openSync(file, 'wx', 0o600);
    const owner: Owner = { host: process.pid, parentId, linkId, targetId, markerId: '' };
    try {
      owner.markerId = markerId = identity(fstatSync(first, { bigint: true }));
      writeFileSync(first, JSON.stringify(owner));
    } finally { closeSync(first); }
    return {
      path: link,
      spawned(pid) {
        // Main still owns the in-memory lease if a marker update fails.
        try {
          if (realDirectory(folder) !== parentId || !lstatSync(file).isFile()) return;
          const descriptor = openSync(file, 'r+');
          try {
            const stat = fstatSync(descriptor, { bigint: true });
            if (identity(stat) !== owner.markerId || stat.nlink !== 1n) return;
            const bytes = Buffer.from(JSON.stringify({ ...owner, worker: pid }));
            writeFileSync(descriptor, bytes);
            ftruncateSync(descriptor, bytes.length);
          } finally { closeSync(descriptor); }
        } catch { /* Leave an unverifiable orphan untouched on a later launch. */ }
      },
      release() {
        try { removeOwned(folder, target, owner); }
        catch { /* A busy link can be reclaimed on a later launch. */ }
      },
    };
  } catch (error) {
    if (realDirectory(folder) === parentId) {
      if (linkId && identity(lstatSync(link, { bigint: true })) === linkId && samePath(readlinkSync(link), target))
        unlinkSync(link);
      if (markerId && identity(lstatSync(file, { bigint: true })) === markerId) unlinkSync(file);
      if (!readdirSync(folder).length) rmdirSync(folder);
    }
    throw error;
  }
};
