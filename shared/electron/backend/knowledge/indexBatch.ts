import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, readFile, rm } from 'node:fs/promises';
import type { Connection } from '@lancedb/lancedb';
import { knowledgeBatchLimit } from '../../contracts/knowledge';
import { atomicFile } from '../atomicFile';
import { KnowledgeError } from './errors';
import { eachRecoveryCatalog, tableExists } from './eraseLibrary';

const marker = '.index-batch.json';
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const invalid = () => new KnowledgeError('integrity', '索引暂存归属异常，已保留原文件。');
const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT';
export interface BatchReservation {
  nonce: string;
  baseId: string;
  documents: string[];
  createsTable: boolean;
}
export const reservedRevision = (batch: BatchReservation, id: string) =>
  'rev-batch-' + batch.nonce + '-' + digest(id).slice(0, 24) + '.json';
export const reservedTable = (batch: BatchReservation) =>
  'chunks_' + digest('index-batch:' + batch.nonce).slice(0, 32);
export async function reserveBatch(directory: string, baseId: string, documents: string[], createsTable: boolean) {
  if (await regularFile(path.join(directory, marker))) throw invalid();
  const batch: BatchReservation = { nonce: randomUUID(), baseId, documents, createsTable };
  await atomicFile(path.join(directory, marker), JSON.stringify({ batch, checksum: digest(JSON.stringify(batch)) }));
  return batch;
}
export async function clearBatchMarker(directory: string) {
  await rm(path.join(directory, marker), { force: true });
}
async function regularFile(file: string) {
  try {
    const stat = await lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw invalid();
    return stat;
  } catch (error) { if (!missing(error)) throw error; }
}
export async function recoverIndexBatch(directory: string, db: Connection) {
  const file = path.join(directory, marker), stat = await regularFile(file);
  if (!stat) return;
  if (stat.size > 8192) throw invalid();
  const { batch, checksum } = JSON.parse(await readFile(file, 'utf8')) as { batch: BatchReservation; checksum: string };
  if (!batch || digest(JSON.stringify(batch)) !== checksum ||
      !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(batch.nonce) ||
      typeof batch.baseId !== 'string' || !/^[\w-]{1,100}$/.test(batch.baseId) ||
      typeof batch.createsTable !== 'boolean' || !Array.isArray(batch.documents) ||
      batch.documents.length < 1 || batch.documents.length > knowledgeBatchLimit ||
      !batch.documents.every(id => typeof id === 'string' && /^[\w-]{1,100}$/.test(id)) ||
      new Set(batch.documents).size !== batch.documents.length) throw invalid();
  // Before rename these files have no published readers, after rename the temporary name is absent.
  for (const name of ['catalog-' + batch.nonce + '.tmp', '.catalog-backup-' + batch.nonce + '.tmp']) {
    const temp = path.join(directory, name);
    if (await regularFile(temp)) await rm(temp);
  }
  const table = reservedTable(batch), unused = new Set(batch.documents.map(id => reservedRevision(batch, id)));
  let removeTable = batch.createsTable;
  // Recovery catalogs may be numerous. Retain only this batch's bounded candidate names.
  for await (const [, catalog] of eachRecoveryCatalog(directory)) {
    if (catalog.tableName === table) removeTable = false;
    for (const entry of Object.values(catalog.documents)) unused.delete(entry.revision);
    if (!unused.size && !removeTable) break;
  }
  const folder = path.join(directory, 'revisions'), directoryInfo = await lstat(folder);
  if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink()) throw invalid();
  for (const name of unused) {
    const target = path.join(folder, name);
    if (await regularFile(target)) await rm(target);
  }
  if (removeTable && await tableExists(directory, table)) await db.dropTable(table);
  await clearBatchMarker(directory);
}
