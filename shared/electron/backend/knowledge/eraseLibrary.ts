import path from 'node:path';
import { lstat, readFile, readdir, unlink } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import * as lance from '@lancedb/lancedb';
import { atomicFile } from '../atomicFile';
import { KnowledgeError } from './errors';
import type { KnowledgeDocument } from '../../contracts/knowledge';

export function indexText(table: lance.Table) {
  return table.createIndex('text', {
    config: lance.Index.fts({
      baseTokenizer: 'icu',
      stem: false,
      removeStopWords: false,
      asciiFolding: false,
      lowercase: true,
      withPosition: false,
    }),
    replace: true,
  });
}

export interface Catalog {
  schemaVersion: 1;
  modelVersion: string;
  tableName?: string;
  tableVersion?: number;
  documents: Record<string, { document: KnowledgeDocument; revision: string }>;
  blocked?: string[];
  indexFormat?: string;
  indexUpgrade?: { source?: string; nonce?: string; detached?: boolean; versions?: Record<string, number>; documentIds?: string[] };
}

const journalName = '.library-erasure.json';
const uuid = '[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}';
const catalogFile = new RegExp(
  '^(?:catalog\\.json|catalog-backup-' + uuid + '\\.json|catalog-' + uuid + '\\.tmp)$',
);
const ownedTable = /^chunks_[a-f0-9]+$/;
const revisionFile = /^rev-[\w-]+\.json$/;
const invalid = () => new KnowledgeError('integrity', '知识库恢复文件归属或版本异常，已中止清理。');
const unowned = () =>
  new KnowledgeError('integrity', '旧索引正文的所属知识库无法确认，已保留原件，整库清理尚未完成。');
const missing = (e: unknown) => (e as NodeJS.ErrnoException).code === 'ENOENT';
const replacement = (from: string, id: string) =>
  'chunks_' +
  createHash('sha256')
    .update(from + ':' + id)
    .digest('hex')
    .slice(0, 32);
interface TableVersionMap {
  from: string;
  versions: Record<string, number>;
}
interface Receipt {
  version: 1;
  id: string;
  baseId: string;
  committed: boolean;
  tables: TableVersionMap[];
  revisions: string[];
}
function receiptBytes(receipt: Receipt) {
  const checksum = createHash('sha256').update(JSON.stringify(receipt)).digest('hex');
  return JSON.stringify({ receipt, checksum });
}
async function ownedFiles(directory: string, matches: RegExp) {
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink()) throw invalid();
  const files = (await readdir(directory, { withFileTypes: true })).filter((e) =>
    matches.test(e.name),
  );
  if (files.some((e) => !e.isFile() || e.isSymbolicLink())) throw invalid();
  return files.map((e) => e.name);
}
export async function* eachRecoveryCatalog(directory: string, progressed?: () => void, incomplete?: (file: string) => void) {
  for (const file of await ownedFiles(directory, catalogFile)) {
    const raw = await readFile(path.join(directory, file), 'utf8');
    let catalog: Catalog;
    try { catalog = JSON.parse(raw) as Catalog; }
    catch (error) {
      if (!incomplete || !file.endsWith('.tmp') || !(error instanceof SyntaxError)) throw error;
      incomplete(file);
      continue;
    }
    if (
      catalog?.schemaVersion !== 1 ||
      !catalog.documents ||
      typeof catalog.documents !== 'object' ||
      Array.isArray(catalog.documents) ||
      (catalog.tableName !== undefined &&
        (!ownedTable.test(catalog.tableName) || !Number.isSafeInteger(catalog.tableVersion))) ||
      Object.entries(catalog.documents).some(
        ([docId, entry]) =>
          !entry?.document ||
          entry.document.documentId !== docId ||
          !revisionFile.test(entry.revision),
      ) ||
      (catalog.blocked !== undefined && !Array.isArray(catalog.blocked))
    )
      throw invalid();
    if (Object.values(catalog.documents).some(e => typeof e.document.baseId !== 'string' ||
        !/^[\w-]{1,100}$/.test(e.document.baseId))) throw unowned();
    progressed?.();
    yield [file, catalog] as const;
  }
}
async function recoveryCatalogs(directory: string, progressed?: () => void) {
  const entries = new Map<string, Catalog>();
  for await (const [file, catalog] of eachRecoveryCatalog(directory, progressed)) entries.set(file, catalog);
  return entries;
}
async function removeIfPresent(file: string) {
  await unlink(file).catch((e) => {
    if (!missing(e)) throw e;
  });
}
export async function tableExists(directory: string, name: string) {
  try {
    const folder = path.join(directory, 'lance'), parent = await lstat(folder);
    if (!parent.isDirectory() || parent.isSymbolicLink()) throw invalid();
    const info = await lstat(path.join(folder, name + '.lance'));
    if (!info.isDirectory() || info.isSymbolicLink()) throw invalid();
    return true;
  } catch (e) {
    if (missing(e)) return false;
    throw e;
  }
}
function sanitize(catalog: Catalog, receipt: Receipt) {
  let changed = false;
  const blocked = new Set(catalog.blocked);
  for (const [id, entry] of Object.entries(catalog.documents))
    if (entry.document.baseId === receipt.baseId) {
      delete catalog.documents[id];
      blocked.delete(id);
      changed = true;
    }
  if (catalog.blocked && blocked.size !== catalog.blocked.length) catalog.blocked = [...blocked];
  const table = receipt.tables.find((t) => t.from === catalog.tableName);
  if (table) {
    const version = table.versions[String(catalog.tableVersion)];
    if (!Number.isSafeInteger(version)) throw invalid();
    catalog.tableName = replacement(table.from, receipt.id);
    catalog.tableVersion = version;
    changed = true;
  }
  return changed;
}
async function finish(directory: string, db: lance.Connection, receipt: Receipt, progressed?: () => void) {
  if (receipt.committed) {
    // Publish every catalog before withdrawing any original table or revision.
    for (const table of receipt.tables)
      if (!(await tableExists(directory, replacement(table.from, receipt.id)))) throw invalid();
    for (const [file, catalog] of await recoveryCatalogs(directory, progressed)) {
      if (sanitize(catalog, receipt)) {
        await atomicFile(path.join(directory, file), JSON.stringify(catalog));
        progressed?.();
      }
    }
    for (const file of receipt.revisions) {
      await removeIfPresent(path.join(directory, 'revisions', file));
      progressed?.();
    }
  }
  for (const table of receipt.tables) {
    const name = receipt.committed ? table.from : replacement(table.from, receipt.id);
    if (await tableExists(directory, name)) await db.dropTable(name);
    progressed?.();
  }
  await removeIfPresent(path.join(directory, journalName));
}
export async function recoverLibraryErasure(
  directory: string,
  db: lance.Connection,
  reader: boolean,
  progressed?: () => void,
) {
  const file = path.join(directory, journalName);
  let raw: string;
  try {
    const info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink()) throw invalid();
    raw = await readFile(file, 'utf8');
  } catch (e) {
    if (missing(e)) return;
    throw e;
  }
  if (reader) throw new KnowledgeError('unavailable', '知识库清理正在完成，请稍后重试。');
  const envelope = JSON.parse(raw);
  const r: Receipt = envelope?.receipt;
  if (!r || typeof envelope.checksum !== 'string' ||
      createHash('sha256').update(JSON.stringify(r)).digest('hex') !== envelope.checksum) throw invalid();
  if (
    r?.version !== 1 ||
    !new RegExp('^' + uuid + '$').test(r.id) ||
    typeof r.baseId !== 'string' ||
    !/^[\w-]{1,100}$/.test(r.baseId) ||
    typeof r.committed !== 'boolean' ||
    !Array.isArray(r.tables) ||
    r.tables.some(
      (t) =>
        !t ||
        !ownedTable.test(t.from) ||
        !t.versions ||
        typeof t.versions !== 'object' ||
        Object.values(t.versions).some((v) => !Number.isSafeInteger(v) || v < 1),
    ) ||
    !Array.isArray(r.revisions) ||
    r.revisions.some((f) => !revisionFile.test(f))
  )
    throw invalid();
  progressed?.();
  await finish(directory, db, r, progressed);
}
async function targetRevisions(
  directory: string,
  db: lance.Connection,
  tables: string[],
  signal: AbortSignal,
  baseId: string,
  entries: Catalog[],
  progressed?: () => void,
) {
  const owners = new Map<string, Set<string>>(),
    known = new Map<string, Set<string>>();
  const add = (map: Map<string, Set<string>>, key: string, base: string) => {
    const set = map.get(key) ?? new Set<string>();
    set.add(base);
    map.set(key, set);
  };
  for (const catalog of entries)
    for (const [id, e] of Object.entries(catalog.documents)) {
      add(owners, id, e.document.baseId);
      add(known, e.revision, e.document.baseId);
    }
  const target: string[] = [],
    folder = path.join(directory, 'revisions');
  const unidentified = new Map<string, string[]>();
  for (const name of await ownedFiles(folder, revisionFile)) {
    signal.throwIfAborted();
    const bases = known.get(name);
    if (bases) {
      if (bases.has(baseId) && bases.size !== 1) throw invalid();
      if (bases.has(baseId)) target.push(name);
      continue;
    }
    // Old interrupted writes have no catalog entry. Use only positive, unambiguous
    // provenance; unidentifiable legacy/foreign files cannot authorize deletion.
    const rev = JSON.parse(await readFile(path.join(folder, name), 'utf8'));
    progressed?.();
    if (rev?.baseId === baseId) target.push(name);
    else if (typeof rev?.baseId !== 'string' || !/^[\w-]{1,100}$/.test(rev.baseId)) {
      if (!Array.isArray(rev?.items) || !rev.items.length) throw unowned();
      const ids = new Set<string>();
      for (const item of rev.items) {
        if (typeof item?.documentId !== 'string' || !/^[\w-]{1,100}$/.test(item.documentId))
          throw unowned();
        ids.add(item.documentId);
      }
      unidentified.set(name, [...ids]);
    }
  }
  if (!unidentified.size) return target;
  const ids = [...new Set([...unidentified.values()].flat())];
  // A cancelled old-format write may predate its catalog publication. Compare
  // surviving row ownership across *all* versions, including earlier deletions.
  for (const name of tables) {
    const table = await db.openTable(name);
    try {
      for (const { version } of await table.listVersions()) {
        signal.throwIfAborted();
        await table.checkout(version);
        for (let i = 0; i < ids.length; i += 128) {
          const filter =
            'documentId IN (' +
            ids
              .slice(i, i + 128)
              .map((id) => "'" + id + "'")
              .join(',') +
            ')';
          for await (const batch of table.query().where(filter).select(['documentId', 'baseId'])) {
            for (const row of batch) add(owners, row.documentId, row.baseId);
            progressed?.();
          }
          progressed?.();
        }
      }
    } finally {
      table.close();
    }
  }
  for (const [name, ids] of unidentified) {
    const owner = new Set<string>();
    for (const id of ids) {
      const found = owners.get(id);
      if (!found?.size) throw unowned();
      for (const candidate of found) {
        if (typeof candidate !== 'string' || !candidate.length) throw unowned();
        owner.add(candidate);
      }
    }
    if (owner.has(baseId)) {
      if (owner.size !== 1) throw unowned();
      target.push(name);
    }
  }
  return target;
}
const lastRebuild = (name: string) => 'voxcue-rebuilt-' + name;
async function historyContains(table: lance.Table, baseId: string, signal: AbortSignal, progressed?: () => void) {
  for (const { version } of await table.listVersions()) {
    signal.throwIfAborted();
    await table.checkout(version);
    if (await table.countRows('baseId IS NULL')) throw unowned();
    const rows = await table.countRows("baseId = '" + baseId + "'");
    progressed?.();
    if (rows) return true;
  }
  return false;
}
async function rewriteHistory(
  db: lance.Connection,
  source: lance.Table,
  receipt: Receipt,
  target: TableVersionMap,
  catalogs: Catalog[],
  signal: AbortSignal,
  progressed?: () => void,
) {
  const original = (await source.listVersions()).sort((a, b) => a.version - b.version);
  const sourceTags = await (await source.tags()).list();
  const marker = lastRebuild(target.from);
  const through = sourceTags[marker]?.version ?? 0;
  const retained = new Set(Object.values(sourceTags).map((t) => t.version));
  for (const catalog of catalogs)
    if (catalog.tableName === target.from) retained.add(catalog.tableVersion!);
  const dest = await db.createEmptyTable(
    replacement(target.from, receipt.id),
    await source.schema(),
  );
  try {
    const tags = await dest.tags();
    for (const { version } of original) {
      // Prior rewrites can require several physical batches. Only real recovery
      // points and subsequent application writes create new recovery points.
      if (version <= through && !retained.has(version)) continue;
      signal.throwIfAborted();
      await source.checkout(version);
      const indexes = await source.listIndices();
      if (indexes.some((i) => i.indexType.toUpperCase() !== 'FTS' || i.columns.join() !== 'text'))
        throw invalid();
      // Only filtered Arrow batches enter the replacement, including its own historical fragments.
      if (await source.countRows('baseId IS NULL')) throw unowned();
      const retain = "baseId != '" + receipt.baseId + "'";
      let rows = 0;
      for await (const batch of source.query().where(retain)) {
        signal.throwIfAborted();
        if (!batch.numRows) continue;
        await dest.add(
          { schema: batch.schema, batches: [batch] },
          { mode: rows ? 'append' : 'overwrite' },
        );
        rows += batch.numRows;
        progressed?.();
      }
      if (!rows) await dest.delete('true');
      if (indexes.length) await indexText(dest);
      else for (const index of await dest.listIndices()) await dest.dropIndex(index.name);
      if ((await dest.countRows()) !== rows || (await source.countRows(retain)) !== rows)
        throw invalid();
      const mapped = await dest.version();
      target.versions[String(version)] = mapped;
      // Catalog backups point directly to their replacement versions. Keep individually
      // addressable Lance recovery points for intermediate versions without a catalog.
      if (version > through) {
        let alias = target.from + '-v' + version;
        while (Object.hasOwn(sourceTags, alias)) alias += '-recovery';
        await tags.create(alias, mapped);
      }
      progressed?.();
    }
    for (const [name, tag] of Object.entries(sourceTags)) {
      if (name === marker) continue;
      const version = target.versions[String(tag.version)];
      if (!version) throw invalid();
      await tags.create(name, version);
    }
    await tags.create(lastRebuild(replacement(target.from, receipt.id)), await dest.version());
  } finally {
    dest.close();
  }
}
export async function eraseLibrary(
  directory: string,
  db: lance.Connection,
  baseId: string,
  signal: AbortSignal,
  progressed?: () => void,
) {
  const entries = [...(await recoveryCatalogs(directory, progressed)).values()];
  const folder = path.join(directory, 'lance'),
    journal = path.join(directory, journalName);
  const info = await lstat(folder).catch((e) => {
    if (!missing(e)) throw e;
  });
  if (info && (!info.isDirectory() || info.isSymbolicLink())) throw invalid();
  const tables: string[] = [];
  for (const file of info ? await readdir(folder, { withFileTypes: true }) : []) {
    if (!file.name.endsWith('.lance')) continue;
    const name = file.name.slice(0, -6);
    if (!ownedTable.test(name)) continue;
    if (!file.isDirectory() || file.isSymbolicLink()) throw invalid();
    tables.push(name);
  }
  const receipt: Receipt = {
    version: 1,
    id: randomUUID(),
    baseId,
    committed: false,
    tables: [],
    revisions: await targetRevisions(directory, db, tables, signal, baseId, entries, progressed),
  };
  for (const name of tables) {
    const table = await db.openTable(name);
    try {
      const affected = await historyContains(table, baseId, signal, progressed);
      const branches = await table.branches();
      for (const branch of Object.keys(await branches.list()).filter((n) => n !== 'main')) {
        // VoxCue writes only main. Never discard a foreign branch, including
        // one whose only copy of the retired library is in an older version.
        if (affected) throw invalid();
        const other = await branches.checkout(branch);
        try {
          if (await historyContains(other, baseId, signal, progressed)) throw invalid();
        } finally {
          other.close();
        }
      }
      if (!affected) continue;
      if (await tableExists(directory, replacement(name, receipt.id))) throw invalid();
      receipt.tables.push({ from: name, versions: {} });
    } finally {
      table.close();
    }
  }
  await atomicFile(journal, receiptBytes(receipt), signal);
  for (const target of receipt.tables) {
    const source = await db.openTable(target.from);
    try {
      await rewriteHistory(db, source, receipt, target, entries, signal, progressed);
    } finally {
      source.close();
    }
  }
  // Validate every mapping before committing a single live catalog. After this
  // point cleanup is idempotent and is resumed before the writer next opens.
  for (const catalog of entries) sanitize(catalog, receipt);
  receipt.committed = true;
  await atomicFile(journal, receiptBytes(receipt), signal);
  await finish(directory, db, receipt, progressed);
}
