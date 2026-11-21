import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, readFile, unlink } from 'node:fs/promises';
import type { Connection, Table } from '@lancedb/lancedb';
import { validKnowledgeId } from '../../contracts/knowledge';
import { atomicFile } from '../atomicFile';
import { INDEX_VERSION } from './types';
import { eachRecoveryCatalog, indexText, tableExists, type Catalog } from './eraseLibrary';
import { KnowledgeError } from './errors';

const invalid = () => new KnowledgeError('integrity', '旧索引归属或替换校验失败，请重试。');
export const supportedIndexVersion = (version?: string) =>
  version === undefined || version === INDEX_VERSION || version === 'qa-linked-v1' || version === 'qa-linked-v2';
const current = (catalog: Catalog) => Object.values(catalog.documents)
  .every(entry => entry.document.indexVersion === INDEX_VERSION);
const legacy = (catalog: Catalog) => !current(catalog) ||
  catalog.indexFormat === 'qa-linked-v1' || catalog.indexFormat === 'qa-linked-v2';
export async function legacyTable(directory: string, catalog: Catalog, progressed?: () => void) {
  if (catalog.indexUpgrade?.source) return catalog.indexUpgrade.source;
  if (catalog.tableName && (catalog.indexUpgrade || legacy(catalog))) return catalog.tableName;
  for await (const [, backup] of eachRecoveryCatalog(directory, progressed, () => {}))
    if (backup.tableName && legacy(backup)) return backup.tableName;
}
const affected = (live: Catalog, id: string) => validKnowledgeId(id) &&
  (!Object.hasOwn(live.documents, id) || live.documents[id].document.indexVersion !== INDEX_VERSION);
export async function legacyDocumentIds(directory: string, live: Catalog, signal: AbortSignal, progressed?: () => void) {
  const ids = new Set<string>();
  const add = (id: string) => {
    if (affected(live, id)) ids.add(id);
  };
  // A resumed receipt can outlive the backup identifying a document. These
  // IDs are used for display only. File erasure still requires its own proof.
  if (Array.isArray(live.indexUpgrade?.documentIds))
    for (const id of live.indexUpgrade.documentIds) add(id);
  for await (const [, snapshot] of eachRecoveryCatalog(directory, progressed, () => {})) {
    signal.throwIfAborted();
    if (!snapshot.tableName || snapshot.modelVersion !== live.modelVersion || !supportedIndexVersion(snapshot.indexFormat)) continue;
    for (const { document } of Object.values(snapshot.documents))
      if (document.indexVersion !== INDEX_VERSION && supportedIndexVersion(document.indexVersion)) add(document.documentId);
  }
  return [...ids].sort();
}
const targetName = (source: string, nonce: string) => 'chunks_' + createHash('sha256')
  .update('index-upgrade:' + source + ':' + nonce).digest('hex').slice(0, 32);
async function checkHistory(db: Connection, name: string) {
  const table = await db.openTable(name);
  try {
    const ownedTag = /^(?:chunks_[a-f0-9]+-v[0-9]+(?:-recovery)*|voxcue-rebuilt-chunks_[a-f0-9]+)$/;
    if (Object.keys(await (await table.branches()).list()).some(branch => branch !== 'main') ||
        Object.keys(await (await table.tags()).list()).some(tag => !ownedTag.test(tag))) throw invalid();
  } finally { table.close(); }
}
function recoverable(value: Catalog, live: boolean) {
  if (current(value)) return value;
  const documents = Object.fromEntries(Object.entries(value.documents).filter(([, entry]) =>
    entry.document.indexVersion === INDEX_VERSION));
  if (!live && !Object.keys(documents).length) return;
  return { ...value, documents, blocked: value.blocked?.filter(id => Object.hasOwn(documents, id)) };
}
async function copySnapshot(source: Table, target: Table, snapshot: Catalog, retained: Catalog,
  signal: AbortSignal, progressed?: () => void) {
  await source.checkout(snapshot.tableVersion!);
  const ids = Object.keys(retained.documents);
  if (ids.some(id => !/^[\w-]{1,100}$/.test(id))) throw invalid();
  const query = retained === snapshot ? source.query() :
    source.query().where('documentId IN (' + ids.map(id => "'" + id + "'").join(',') + ')');
  const counts = new Map<string, number>();
  let total = 0;
  for await (const batch of query) {
    signal.throwIfAborted();
    if (!batch.numRows) continue;
    for (const row of batch) {
      if (!Object.hasOwn(retained.documents, row.documentId) ||
          retained.documents[row.documentId].document.baseId !== row.baseId) throw invalid();
      counts.set(row.documentId, (counts.get(row.documentId) ?? 0) + 1);
    }
    await target.add({ schema: batch.schema, batches: [batch] }, { mode: total ? 'append' : 'overwrite' });
    total += batch.numRows;
    progressed?.();
  }
  if (!total && await target.countRows()) await target.delete('true');
  if (Object.values(retained.documents).some(({ document }) => (counts.get(document.documentId) ?? 0) !== document.chunkCount) ||
      await target.countRows() !== total) throw invalid();
  if (total) await indexText(target);
  progressed?.();
  return target.version();
}

// Called by the exclusive writer after the snapshot reader releases its handles.
// Only generated catalog/revision/Lance paths referenced by this profile are eligible.
export async function finishIndexUpgrade(directory: string, db: Connection, catalog: Catalog,
  signal: AbortSignal, progressed?: () => void) {
  let source: string | undefined;
  while ((source = await legacyTable(directory, catalog, progressed))) {
    signal.throwIfAborted();
    catalog = await cleanTable(directory, db, catalog, source, signal, progressed);
  }
}

async function cleanTable(directory: string, db: Connection, catalog: Catalog, legacySource: string,
  signal: AbortSignal, progressed?: () => void) {
  const file = path.join(directory, 'catalog.json');
  let receipt = catalog.indexUpgrade;
  if (!receipt?.source) {
    if (await tableExists(directory, legacySource)) await checkHistory(db, legacySource);
    receipt = { source: legacySource, nonce: randomUUID(),
      ...(legacySource !== catalog.tableName && { detached: true }) };
    if (await tableExists(directory, targetName(receipt.source!, receipt.nonce!))) throw invalid();
    catalog = { ...catalog, indexUpgrade: receipt };
    await atomicFile(file, JSON.stringify(catalog), signal);
  }
  const { source, nonce, detached } = receipt;
  if (!source || !/^chunks_[a-f0-9]+$/.test(source) || !nonce ||
      !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(nonce)) throw invalid();
  const target = targetName(source, nonce);
  if ((detached !== undefined && detached !== true) ||
      (receipt.versions !== undefined && (!receipt.versions || typeof receipt.versions !== 'object' ||
        Array.isArray(receipt.versions) || Object.values(receipt.versions).some(v => !Number.isSafeInteger(v) || v < 0) ||
        Object.hasOwn(receipt.versions, 'catalog.json') === !!detached))) throw invalid();
  const publishedTable = receipt.versions?.['catalog.json'] === 0 ? undefined : target;
  if (detached ? catalog.tableName === source || catalog.tableName === target :
      catalog.tableName !== (receipt.versions ? publishedTable : source)) throw invalid();
  signal.throwIfAborted();
  // The newest obsolete revision can occur only in the live catalog. Keep its
  // ownership proof across the atomic replacement, including process death.
  if (!detached && !receipt.versions && !current(catalog)) {
    const backup = path.join(directory, 'catalog-backup-' + nonce + '.json');
    const { indexUpgrade, ...original } = catalog;
    try {
      const entry = await lstat(backup);
      if (!entry.isFile() || entry.isSymbolicLink() ||
          JSON.stringify(JSON.parse(await readFile(backup, 'utf8'))) !== JSON.stringify(original)) throw invalid();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      await atomicFile(backup, JSON.stringify(original), signal);
    }
  }
  const retained = new Set<string>(), obsolete = new Set<string>(), obsoleteDocuments = new Set<string>();
  const partial = new Set<string>();
  const catalogs = () => eachRecoveryCatalog(directory, progressed, name => partial.add(name));
  let sourceOwned = false;
  for await (const [, value] of catalogs()) {
    signal.throwIfAborted();
    if (!receipt.versions && value.tableName === target) throw invalid();
    if (value.tableName === source && (value.modelVersion !== catalog.modelVersion || !supportedIndexVersion(value.indexFormat) ||
        Object.values(value.documents).some(entry => !supportedIndexVersion(entry.document.indexVersion)))) throw invalid();
    if (value.tableName === source && legacy(value)) sourceOwned = true;
    for (const entry of Object.values(value.documents)) {
      if (value.tableName === source && entry.document.indexVersion !== INDEX_VERSION) {
        obsolete.add(entry.revision);
        if (affected(catalog, entry.document.documentId)) obsoleteDocuments.add(entry.document.documentId);
      } else retained.add(entry.revision);
    }
  }
  if (!receipt.versions) {
    if (detached && !sourceOwned) throw invalid();
    const hasSource = await tableExists(directory, source);
    if (hasSource) await checkHistory(db, source);
    // An unfinished copy has never been published. Start again at the pinned source versions.
    if (await tableExists(directory, target)) {
      await checkHistory(db, target);
      await db.dropTable(target);
    }
    const old = hasSource ? await db.openTable(source) : undefined;
    let next: Table | undefined;
    try {
      const versions: Record<string, number> = {};
      let live = catalog;
      for await (const [name, snapshot] of catalogs()) {
        signal.throwIfAborted();
        if (snapshot.tableName !== source) continue;
        const isLive = name === 'catalog.json', value = recoverable(snapshot, isLive);
        if (!value) continue;
        if (isLive && snapshot.tableVersion !== catalog.tableVersion) throw invalid();
        if (!Object.keys(value.documents).length) {
          versions[name] = 0;
          if (isLive) {
            const { tableName, tableVersion, ...empty } = value;
            live = empty;
          }
          continue;
        }
        if (!old) throw invalid();
        next ??= await db.createEmptyTable(target, await old.schema());
        versions[name] = await copySnapshot(old, next, snapshot, value, signal, progressed);
        if (isLive) live = { ...value, tableName: target, tableVersion: versions[name] };
      }
      if (!detached && !Object.hasOwn(versions, 'catalog.json')) throw invalid();
      receipt = { ...receipt, versions, documentIds: [...obsoleteDocuments].sort() };
      catalog = { ...live, indexUpgrade: receipt };
      await atomicFile(file, JSON.stringify(catalog), signal);
    } finally { next?.close(); old?.close(); }
  }
  if (!receipt.versions || (Object.values(receipt.versions).some(v => v > 0) && !(await tableExists(directory, target)))) throw invalid();
  const hasOldTable = await tableExists(directory, source);
  if (hasOldTable) await checkHistory(db, source);
  // Keep the obsolete catalog names until their unshared bodies have been
  // removed, so a crash never loses the information needed to resume cleanup.
  const folder = path.join(directory, 'revisions'), info = await lstat(folder);
  if (!info.isDirectory() || info.isSymbolicLink()) throw invalid();
  signal.throwIfAborted();
  for (const revision of obsolete) {
    signal.throwIfAborted();
    if (retained.has(revision)) continue;
    const bodyFile = path.join(folder, revision);
    try {
      const body = await lstat(bodyFile);
      if (!body.isFile() || body.isSymbolicLink()) throw invalid();
      await unlink(bodyFile);
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    progressed?.();
  }
  for await (const [name, value] of catalogs()) {
    signal.throwIfAborted();
    if (name === 'catalog.json') continue;
    if (value.tableName === target && value.indexUpgrade) {
      const { indexUpgrade, ...backup } = value;
      await atomicFile(path.join(directory, name), JSON.stringify(backup), signal);
    } else if (value.tableName === source) {
      const version = receipt.versions[name];
      if (version === undefined) {
        if (current(value)) throw invalid();
        await unlink(path.join(directory, name));
        continue;
      }
      if (!Number.isSafeInteger(version) || version < 0) throw invalid();
      const { indexUpgrade, tableName, tableVersion, ...backup } = value;
      backup.documents = Object.fromEntries(Object.entries(backup.documents).filter(([, entry]) =>
        entry.document.indexVersion === INDEX_VERSION));
      if (!version && Object.keys(backup.documents).length) throw invalid();
      if (backup.blocked) backup.blocked = backup.blocked.filter(id => Object.hasOwn(backup.documents, id));
      await atomicFile(path.join(directory, name), JSON.stringify({ ...backup, indexFormat: INDEX_VERSION,
        ...(version && { tableName: target, tableVersion: version }) }), signal);
    }
    progressed?.();
  }
  if (hasOldTable) {
    await checkHistory(db, source);
    await db.dropTable(source);
  }
  // A standalone writer killed before rename can leave a truncated, unpublished
  // temporary catalog. Its exact name and regular-file ownership were checked.
  for (const name of partial) await unlink(path.join(directory, name));
  const { indexUpgrade, ...clean } = catalog;
  const published = { ...clean, indexFormat: INDEX_VERSION };
  await atomicFile(file, JSON.stringify(published), signal);
  return published;
}
