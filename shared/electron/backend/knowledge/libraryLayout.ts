import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { validKnowledgeId } from '../../contracts/knowledge';
import { atomicFile, syncDirectory } from '../atomicFile';
import { KnowledgeError } from './errors';

export const libraryDirectory = 'libraries';
export const layoutFile = 'layout.json';
export const ownerFile = 'owner.json';
export const uuid = '[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}';
export const catalogFile = new RegExp(`^(?:catalog\\.json|catalog-backup-${uuid}\\.json|catalog-${uuid}\\.tmp)$`);
const pendingBackup = new RegExp(`^\\.catalog-backup-${uuid}\\.tmp$`);
export const legacyIndexFile = (name: string) => catalogFile.test(name) || pendingBackup.test(name) ||
  name === '.library-erasure.json' || name === '.index-batch.json';
export const ownedTable = /^chunks_[a-f0-9]+$/;
export const revisionFile = /^rev-[\w-]+\.json$/;
const directoryKey = /^[a-f0-9]{24}$/;
const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT';
export const invalidLayout = () => new KnowledgeError('integrity', '知识库目录或索引归属异常，已保留资料。');

export interface LegacyIndexFiles {
  catalogs: string[];
  revisions: string[];
  tables: string[];
}

export async function checkedDirectory(folder: string) {
  const info = await lstat(folder).catch(error => { if (!missing(error)) throw error; });
  if (info && !info.isDirectory()) throw invalidLayout();
  return !!info;
}

export async function checkedFile(file: string) {
  const info = await lstat(file).catch(error => { if (!missing(error)) throw error; });
  if (info && !info.isFile()) throw invalidLayout();
  return info;
}

export async function ensureDirectory(folder: string) {
  await mkdir(folder, { recursive: true, mode: 0o700 });
  if (!(await checkedDirectory(folder))) throw invalidLayout();
}

export async function readJson(file: string, maxBytes?: number): Promise<unknown> {
  const info = await checkedFile(file);
  if (!info) return;
  if (maxBytes !== undefined && info.size > maxBytes) throw invalidLayout();
  try { return JSON.parse(await readFile(file, 'utf8')); }
  catch (error) {
    if (missing(error)) return;
    if (error instanceof SyntaxError) throw invalidLayout();
    throw error;
  }
}

export function libraryKey(id: string) {
  if (!validKnowledgeId(id)) throw new KnowledgeError('invalid_request', '无效知识库 ID。');
  return createHash('sha256').update(id).digest('hex').slice(0, 24);
}

export async function ownerOf(folder: string) {
  const owner = await readJson(path.join(folder, ownerFile), 512) as { version?: unknown; baseId?: unknown } | undefined;
  if (owner?.version !== 1 || !validKnowledgeId(owner.baseId) || libraryKey(owner.baseId) !== path.basename(folder))
    throw invalidLayout();
  return owner.baseId;
}

export async function libraryPaths(root: string) {
  const folder = path.join(root, libraryDirectory);
  const paths = new Map<string, string>();
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    if (!directoryKey.test(entry.name)) continue;
    if (!entry.isDirectory()) throw invalidLayout();
    const child = path.join(folder, entry.name);
    try { paths.set(await ownerOf(child), child); }
    catch (error) { if (await checkedDirectory(child)) throw error; }
  }
  return paths;
}

export async function readLayout(root: string) {
  if (!(await checkedDirectory(root))) return;
  const folder = path.join(root, libraryDirectory);
  if (!(await checkedDirectory(folder))) return;
  const layout = await readJson(path.join(folder, layoutFile)) as { version?: unknown; legacy?: LegacyIndexFiles } | undefined;
  const names = (items: unknown, pattern: RegExp) => Array.isArray(items) && items.every(name => typeof name === 'string' && pattern.test(name));
  const legacy = layout?.legacy;
  if (layout?.version !== 1 || (legacy !== undefined && (!legacy ||
      !Array.isArray(legacy.catalogs) || !legacy.catalogs.every(name => typeof name === 'string' && legacyIndexFile(name)) ||
      !names(legacy.tables, ownedTable) || !names(legacy.revisions, revisionFile)))) throw invalidLayout();
  return { legacy };
}

export async function createLibraryFolder(folder: string, baseId: string) {
  await ensureDirectory(folder);
  const file = path.join(folder, ownerFile);
  if (!(await checkedFile(file))) {
    // A crash can leave a directory before the owner file is published.
    // Only a previously empty directory can acquire its first owner.
    if ((await readdir(folder)).length) throw invalidLayout();
    await atomicFile(file, JSON.stringify({ version: 1, baseId }));
    await syncDirectory(path.dirname(folder));
  }
  if (await ownerOf(folder) !== baseId) throw invalidLayout();
}

export async function ensurePublishedLibrary(root: string, baseId: string) {
  const key = libraryKey(baseId), libraries = path.join(root, libraryDirectory);
  const folder = path.join(libraries, key);
  if (!(await checkedDirectory(folder))) {
    const staging = path.join(root, 'new-libraries'), stage = path.join(staging, key);
    await ensureDirectory(staging);
    await createLibraryFolder(stage, baseId);
    await rename(stage, folder);
    await syncDirectory(libraries);
    await syncDirectory(staging);
  }
  if (await ownerOf(folder) !== baseId) throw invalidLayout();
}

export async function removeLibraryFolder(root: string, baseId: string, signal: AbortSignal) {
  const key = libraryKey(baseId), activeRoot = path.join(root, libraryDirectory);
  const active = path.join(activeRoot, key), trash = path.join(root, 'removed-libraries');
  const job = path.join(trash, key), retired = path.join(job, 'index');
  const exists = await checkedDirectory(active);
  const pending = await checkedDirectory(trash) && await checkedDirectory(job);
  if (!exists && !pending) return;
  signal.throwIfAborted();
  await ensureDirectory(trash);
  await syncDirectory(root);
  await createLibraryFolder(job, baseId);
  if (exists) {
    if (await ownerOf(active) !== baseId || await checkedDirectory(retired)) throw invalidLayout();
    signal.throwIfAborted();
    await rename(active, retired);
    await syncDirectory(job);
    await syncDirectory(activeRoot);
  }
  // The outer owner file stays until recursive deletion completes, even on restart.
  if (await checkedDirectory(retired)) await rm(retired, { recursive: true });
  await rm(job, { recursive: true });
  await syncDirectory(trash);
}
