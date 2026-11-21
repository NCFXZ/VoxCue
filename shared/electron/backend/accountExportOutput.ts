import { createReadStream } from 'node:fs';
import { lstat, mkdir, open, readFile, readdir, realpath, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { atomicFile } from './atomicFile';
import { holdOperationLease, operationLeaseAbsent } from './operationLease';

const outputId = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
const journalFolder = (userData: string) => path.join(userData, 'pending-account-exports');
const outputName = (id: string) => '.voxcue-export-' + id + '.tmp';
type OutputIdentity = { parent: string; dev: string; ino: string; birth: string };
type OutputMarker = OutputIdentity & ({ version: 2 } | { version?: undefined; pid: number });

async function removeIfOwned(id: string, identity: OutputIdentity) {
  if (typeof identity?.parent !== 'string' || !path.isAbsolute(identity.parent) ||
      ![identity.dev, identity.ino, identity.birth].every(value => typeof value === 'string' && /^\d+$/.test(value)))
    throw Error('导出临时文件标记无效。');
  const parent = await realpath(identity.parent);
  if (parent !== identity.parent) throw Error('临时导出路径已变化。');
  const file = path.join(parent, outputName(id));
  const stat = await lstat(file, { bigint: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error;
  });
  if (stat?.isFile() && stat.dev.toString() === identity.dev && stat.ino.toString() === identity.ino &&
      stat.birthtimeNs.toString() === identity.birth) await unlink(file);
}

// The journal is private to the application's user data. Never scan a user-selected destination.
export async function recoverExportOutputs(userData: string) {
  const directory = journalFolder(userData);
  const entries = await readdir(directory, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error;
    return [];
  });
  for (const entry of entries) {
    if (!entry.isFile() || !outputId.test(entry.name)) continue;
    const marker = path.join(directory, entry.name);
    try {
      const stat = await lstat(marker);
      if (!stat.isFile() || stat.size > 64 * 1024) continue;
      const identity: OutputMarker = JSON.parse(await readFile(marker, 'utf8'));
      if (identity.version === 2) {
        if (!(await operationLeaseAbsent('account-export', entry.name.replaceAll('-', '')))) continue;
      } else {
        if (identity.version !== undefined || !Number.isSafeInteger(identity.pid) ||
            identity.pid < 1 || identity.pid > 0x7fffffff) continue;
        try { process.kill(identity.pid, 0); continue; }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') continue; }
      }
      await removeIfOwned(entry.name, identity);
      await unlink(marker);
    } catch { /* A disconnected volume or unreadable marker can be retried on a later launch. */ }
  }
}

// Persist the identity while the file is empty, before copying any account data into it.
export async function copyAccountExport(zip: string, destination: string, userData: string, signal: AbortSignal) {
  signal.throwIfAborted();
  const parent = await realpath(path.dirname(destination));
  if (parent !== path.dirname(destination)) throw Error('临时导出路径已变化。');
  const id = randomUUID();
  const directory = journalFolder(userData);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const marker = path.join(directory, id);
  const temporary = path.join(parent, outputName(id));
  const handle = await open(temporary, 'wx', 0o600);
  let identity: OutputMarker | undefined;
  let releaseLease: (() => Promise<void>) | undefined;
  let registered = false;
  let published = false;
  try {
    try {
      const stat = await handle.stat({ bigint: true });
      identity = { parent, dev: String(stat.dev), ino: String(stat.ino), birth: String(stat.birthtimeNs), version: 2 };
      releaseLease = await holdOperationLease('account-export', id.replaceAll('-', ''));
      await atomicFile(marker, JSON.stringify(identity), signal);
      registered = true;
      await pipeline(createReadStream(zip), handle.createWriteStream(), { signal });
    } finally {
      await handle.close();
    }
    signal.throwIfAborted();
    await rename(temporary, destination);
    published = true;
  } finally {
    try {
      if (identity && !published) await removeIfOwned(id, identity);
      if (registered) await unlink(marker).catch(() => { /* Retried on startup. */ });
    } finally { await releaseLease?.(); }
  }
}
