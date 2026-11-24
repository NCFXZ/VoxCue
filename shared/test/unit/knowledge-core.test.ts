import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import { lstat, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { temporaryDirectory } from '../temp';
import path from 'node:path';
import * as lance from '@lancedb/lancedb';
import { KnowledgeService } from '../../../shared/electron/backend/knowledge/service';
import { checkOrRemoveMovedProfileAssets } from '../../electron/movedProfileAssets';
import { RecordingLibrary } from '../../electron/backend/interview/recordings';
import { profileDirectory } from '../../electron/accountProfilePaths';
import type { ProfileMoveReceipt } from '../../electron/backend/profileMoveReceipt';
import type { OldIndexDeletion } from '../../../shared/electron/contracts/knowledge';
import type { Catalog } from '../../../shared/electron/backend/knowledge/eraseLibrary';
import { migrateLibraryLayout } from '../../electron/backend/knowledge/libraryMigration';
import { ensurePublishedLibrary, libraryKey, readLayout, removeLibraryFolder } from '../../electron/backend/knowledge/libraryLayout';
import { parseText, searchUnits } from '../../../shared/electron/backend/knowledge/chunks';
import type { Embedder } from '../../../shared/electron/backend/knowledge/types';
import type { PrepareKnowledgeDatabase } from '../../electron/platform/types';
const fork = vi.hoisted(() => vi.fn());
vi.mock('electron', () => ({ utilityProcess: { fork } }));
const signal = () => new AbortController().signal;
const deletionEvents = (...documentIds: string[]): OldIndexDeletion[] => [
  { type: 'old-index-deletion', active: true, documentIds }, { type: 'old-index-deletion', active: false },
];
// Test-only synthetic vectors isolate storage, cancellation and content relationships.
const embedder = (): Embedder => ({
  initialize: async () => {},
  count: (text) => text.length,
  encode: async (texts) =>
    texts.map((text) =>
      Array.from({ length: 384 }, (_, i) =>
        i === 0
          ? /PID|alpha/.test(text)
            ? 1
            : 0.01
          : i === 1
            ? /Qt|beta/.test(text)
              ? 1
              : 0.01
            : 0,
      ),
    ),
  close: async () => {},
});
const input = (id: string, text: string) => ({
  documentId: id,
  baseId: 'base-a',
  name: id + '.md',
  bytes: new TextEncoder().encode(text),
});
async function directory() {
  return temporaryDirectory('rag-core');
}
async function readCatalog(root: string, name = 'catalog.json'): Promise<Catalog> {
  return JSON.parse(await readFile(path.join(root, name), 'utf8'));
}

async function markOldDocuments(root: string, ids: string[], legacyFormat = true) {
  const names = (await readdir(root)).filter(name => name === 'catalog.json' || name.startsWith('catalog-backup-'));
  for (const name of names) {
    const catalog = await readCatalog(root, name);
    if (legacyFormat) delete catalog.indexFormat;
    for (const id of ids) {
      if (catalog.documents[id]) catalog.documents[id].document.indexVersion = 'qa-linked-v2';
    }
    await writeFile(path.join(root, name), JSON.stringify(catalog));
  }
  return names;
}

describe('LanceDB 正式知识核心（真实 DB、合成测试向量）', () => {
  it('replays moved-source document cleanup against an inactive mixed-version catalog', async () => {
    const userData = await directory(), root = path.join(profileDirectory(userData, 'local'), 'knowledge-v1');
    const prepareDatabase: PrepareKnowledgeDatabase | undefined = process.platform === 'win32'
      ? (await import('../../../windows/electron/knowledgePath')).prepareKnowledgeDatabase
      : undefined;
    const open = (databasePath?: string, directory = root) =>
      new KnowledgeService(directory, embedder(), undefined, undefined, undefined, false, databasePath);
    const lease = prepareDatabase?.(path.join(root, 'lance'));
    const seed = open(lease?.path), original = input('moved', 'Synthetic moved original.');
    const kept = { ...input('keep', 'Retained unrelated original.'), baseId: 'another' };
    try {
      await seed.indexDocument(original, signal());
      await seed.indexDocument(input('recent', 'Current-format selected original.'), signal());
      await seed.indexDocument({ ...input('retired', 'Historical original.'), baseId: 'emptied' }, signal());
      await seed.removeDocument('retired', signal());
      await seed.indexDocument(kept, signal());
    } finally {
      try { await seed.close(); }
      finally { lease?.release(); }
    }
    await markOldDocuments(root, ['moved'], false);
    const prior = await readCatalog(root);
    const body = path.join(root, 'revisions', prior.documents.keep.revision);
    const expected = await readFile(body);
    const oldLease = prepareDatabase?.(path.join(root, 'lance'));
    const old = open(oldLease?.path);
    try {
      await expect(old.removeDocument('moved', signal())).rejects.toMatchObject({
        code: 'unavailable', message: '旧索引清理尚未完成，请重试。',
      });
    } finally {
      try { await old.close(); }
      finally { oldLease?.release(); }
    }

    // Keep the real host, index upgrade, LanceDB and receipt cleanup. Only the Electron IPC transport is in process.
    fork.mockImplementation(() => {
      let core: KnowledgeService;
      const child = Object.assign(new EventEmitter(), {
        kill: () => { void Promise.resolve(core?.close()).finally(() => child.emit('exit', 0)); return true; },
        postMessage: async (m: { id: string; init?: { directory: string; databasePath?: string }; op?: string; baseId?: string }) => {
          try {
            let value;
            if (m.init) {
              core = open(m.init.databasePath, m.init.directory);
              await core.initialize();
            }
            else if (m.op === 'list') value = await core.listDocuments();
            else if (m.op === 'clean-upgraded-index') await core.cleanUpgradedIndex(signal());
            else if (m.op === 'remove-base') await core.removeBase(m.baseId!, signal());
            else if (m.op === 'close') await core.close();
            else throw Error('Unexpected migration index operation');
            child.emit('message', { id: m.id, value, needsIndexCleanup: core?.needsIndexCleanup });
          } catch (error) {
            child.emit('message', { id: m.id, error: String(error) });
          }
        },
      });
      return child;
    });
    const receipt: ProfileMoveReceipt = { version: 1, target: 'account:11111111-1111-4111-8111-111111111111',
      source: 'local', clips: [], images: [],
      plan: { items: [{ key: 'base:base-a', hash: 'a'.repeat(64) },
        { key: 'file:moved', baseId: 'base-a', hash: 'b'.repeat(64) },
        { key: 'file:recent', baseId: 'base-a', hash: 'c'.repeat(64) }] } };
    const removed = { documentIds: ['moved', 'recent'], imageIds: [], recordIds: [], localRevision: null };
    const recordings = new RecordingLibrary(path.join(userData, 'recordings'));
    try {
      for (let attempt = 0; attempt < 2; attempt++)
        await checkOrRemoveMovedProfileAssets(userData, '', recordings, receipt, removed, signal(), prepareDatabase);
      await checkOrRemoveMovedProfileAssets(userData, '', recordings,
        { ...receipt, plan: { items: [{ key: 'base:emptied', hash: 'd'.repeat(64) }] } },
        { ...removed, documentIds: [] }, signal(), prepareDatabase);
      expect(Object.keys((await readCatalog(root)).documents)).toEqual(['keep']);
      for (const name of (await readdir(root)).filter(name => name.startsWith('catalog-backup-')))
        expect(Object.values((await readCatalog(root, name)).documents).every(entry => entry.document.baseId === 'another')).toBe(true);
      expect(await readdir(path.join(root, 'revisions'))).toEqual([prior.documents.keep.revision]);
      expect(await readFile(body)).toEqual(expected);
    } finally { fork.mockReset(); }
  }, 30000);

  it('discards old shared indexes before rebuilding and resumes interrupted cleanup', async () => {
    const root = await directory(), legacy = new KnowledgeService(root, embedder());
    const first = input('leaving', 'Synthetic erasure marker.');
    const keep = { ...input('retained', 'Synthetic retained marker.'), baseId: 'keep' };
    try {
      await legacy.indexDocument(first, signal());
      await legacy.indexDocument(keep, signal());
    } finally { await legacy.close(); }
    const original = await readCatalog(root);
    const raw = await readFile(path.join(root, 'catalog.json'));
    const publish = fs.rename;
    const swapping = vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
      if (to === path.join(root, 'libraries')) throw Error('synthetic activation interrupted');
      await publish(from, to);
    });
    syncBuiltinESMExports();
    try {
      await expect(migrateLibraryLayout(root)).rejects.toThrow('synthetic activation interrupted');
      expect(await readLayout(root)).toBeUndefined();
      expect(await readFile(path.join(root, 'catalog.json'))).toEqual(raw);
    } finally { swapping.mockRestore(); syncBuiltinESMExports(); }

    const remove = fs.rm;
    const oldTable = path.join(root, 'lance', original.tableName + '.lance');
    const interrupted = vi.spyOn(fs, 'rm').mockImplementation(async (file, options) => {
      if (file === oldTable) throw Error('synthetic interruption after publishing');
      await remove(file, options);
    });
    syncBuiltinESMExports();
    try {
      await expect(migrateLibraryLayout(root)).rejects.toThrow('synthetic interruption after publishing');
      expect((await readLayout(root))?.legacy?.tables).toEqual([original.tableName]);
      expect(await readFile(path.join(root, 'catalog.json'))).toEqual(raw);
    } finally { interrupted.mockRestore(); syncBuiltinESMExports(); }

    await migrateLibraryLayout(root);
    expect(await readLayout(root)).toEqual({ legacy: undefined });
    await expect(lstat(oldTable)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(lstat(path.join(root, 'catalog.json'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readdir(path.join(root, 'libraries'))).toEqual(['layout.json']);
    expect(await readdir(path.join(root, 'revisions'))).toEqual([]);
    for (const doc of [first, keep]) {
      await ensurePublishedLibrary(root, doc.baseId);
      const library = new KnowledgeService(path.join(root, 'libraries', libraryKey(doc.baseId)), embedder());
      try { await library.indexDocument(doc, signal()); }
      finally { await library.close(); }
    }
    await migrateLibraryLayout(root);
    const key = libraryKey(first.baseId), pending = path.join(root, 'removed-libraries', key, 'index');
    const interruptedDelete = vi.spyOn(fs, 'rm').mockImplementation(async (file, options) => {
      if (file === pending) {
        await remove(path.join(pending, 'owner.json'));
        throw Error('synthetic interruption after detaching');
      }
      await remove(file, options);
    });
    syncBuiltinESMExports();
    try { await expect(removeLibraryFolder(root, first.baseId, signal())).rejects.toThrow('synthetic interruption after detaching'); }
    finally { interruptedDelete.mockRestore(); syncBuiltinESMExports(); }
    await expect(lstat(path.join(root, 'libraries', key))).rejects.toMatchObject({ code: 'ENOENT' });
    await removeLibraryFolder(root, first.baseId, signal());
    await expect(lstat(pending)).rejects.toMatchObject({ code: 'ENOENT' });
    const retained = new KnowledgeService(path.join(root, 'libraries', libraryKey(keep.baseId)), embedder());
    try {
      expect((await retained.listDocuments()).map(doc => doc.documentId)).toEqual([keep.documentId]);
      expect((await retained.search('retained marker', 5, 'keyword', signal(), keep.baseId))[0]?.documentId).toBe(keep.documentId);
    } finally { await retained.close(); }
  }, 30000);
  it('cleans every legacy revision before ordinary indexing, resumes cleanup on reopen and re-encodes even unchanged originals', async () => {
    const root = await directory();
    const steady = input('steady', '# Stable heading\nUnchanged original paragraph.');
    const changed = input('changed', '# Fresh heading\nfreshpassage from the original.');
    const old = new KnowledgeService(root, embedder(), undefined, async doc =>
      parseText(doc.documentId === 'changed' ? 'obsoletepassage only in the old index' :
        new TextDecoder().decode(doc.bytes), doc.documentId, doc.name));
    try {
      await old.indexDocument(steady, signal());
      await old.indexDocument(changed, signal());
    } finally { await old.close(); }
    const names = await markOldDocuments(root, ['changed', 'steady']);
    const prior = await readCatalog(root), oldTable = path.join(root, 'lance', prior.tableName + '.lance');
    const backups = await Promise.all(names.filter(name => name !== 'catalog.json').map(name => readCatalog(root, name)));
    // The active catalog is the only ownership record for the last revision.
    expect(backups.some(backup => backup.documents.changed)).toBe(false);
    const partial = 'catalog-00000000-1111-2222-3333-444444444444.tmp';
    await writeFile(path.join(root, partial), '{"documents":');
    const encoder = embedder(), encode = vi.spyOn(encoder, 'encode');
    const first = new KnowledgeService(root, encoder);
    const phases: OldIndexDeletion[] = [];
    try {
      await first.initialize();
      expect(first.needsIndexCleanup).toBe(true);
      await expect(first.indexDocument(steady, signal())).rejects.toThrow();
      expect(encode).not.toHaveBeenCalled();
      const abort = new AbortController();
      await expect(first.cleanUpgradedIndex(abort.signal, undefined, event => {
        phases.push(event);
        if (event.active) { expect(existsSync(oldTable)).toBe(true); abort.abort(); }
      })).rejects.toMatchObject({ name: 'AbortError' });
      expect(phases).toEqual(deletionEvents('changed', 'steady'));
      expect(encode).not.toHaveBeenCalled();
    } finally { await first.close(); }
    const interrupted = new KnowledgeService(root, encoder);
    const lastBody = path.join(root, 'revisions', prior.documents.changed.revision);
    const unlink = fs.unlink;
    const failUnlink = vi.spyOn(fs, 'unlink').mockImplementation(async file => {
      if (file === lastBody) throw Error('synthetic disk busy while removing last revision');
      return unlink(file);
    });
    syncBuiltinESMExports();
    try {
      const cleanup = vi.fn();
      await expect(interrupted.cleanUpgradedIndex(signal(), undefined, cleanup)).rejects.toThrow('synthetic disk busy');
      expect(cleanup.mock.calls.flat()).toEqual(deletionEvents('changed', 'steady'));
      expect((await readCatalog(root)).documents.changed).toBeUndefined();
      expect(existsSync(lastBody)).toBe(true);
      expect(encode).not.toHaveBeenCalled();
    } finally {
      failUnlink.mockRestore();
      syncBuiltinESMExports();
      await interrupted.close();
    }
    const reopened = new KnowledgeService(root, encoder);
    try {
      await reopened.initialize();
      expect(reopened.needsIndexCleanup).toBe(true);
      const cleanup = vi.fn();
      await reopened.cleanUpgradedIndex(signal(), undefined, cleanup);
      expect(cleanup.mock.calls.flat()).toEqual(deletionEvents('changed', 'steady'));
      expect(encode).not.toHaveBeenCalled();
      expect(await reopened.listDocuments()).toEqual([]);
      expect(existsSync(oldTable)).toBe(false);
      expect(await readdir(root)).not.toContain(partial);
      const revisions = await readdir(path.join(root, 'revisions'));
      for (const entry of Object.values(prior.documents)) expect(revisions).not.toContain(entry.revision);
      expect((await readCatalog(root)).indexUpgrade).toBeUndefined();
      expect(reopened.needsIndexCleanup).toBe(false);
      await reopened.indexDocument(steady, signal());
      expect(encode.mock.calls.some(([texts, mode]) => mode === 'passage' && texts.some(text =>
        text.includes('Unchanged original paragraph')))).toBe(true);
      expect((await readCatalog(root)).documents.steady.revision).not.toBe(prior.documents.steady.revision);
      encode.mockRejectedValueOnce(Error('synthetic embedding interrupted'));
      await expect(reopened.indexDocument(changed, signal())).rejects.toThrow('synthetic embedding interrupted');
      expect((await reopened.search('obsoletepassage', 2, 'keyword', signal()))).toEqual([]);
    } finally { await reopened.close(); }
    const retry = new KnowledgeService(root, encoder);
    try {
      await retry.initialize();
      expect(retry.needsIndexCleanup).toBe(false);
      await retry.indexDocument(changed, signal());
      expect(encode.mock.calls.some(([texts, mode]) => mode === 'passage' && texts.some(text =>
        text.includes('freshpassage from the original')))).toBe(true);
      expect((await retry.search('freshpassage', 2, 'keyword', signal())).map(hit => hit.documentId)).toEqual(['changed']);
      expect((await retry.search('obsoletepassage', 2, 'keyword', signal()))).toEqual([]);
      const ready = await readCatalog(root);
      const noCleanup = vi.fn();
      await retry.cleanUpgradedIndex(signal(), undefined, noCleanup);
      expect(noCleanup).not.toHaveBeenCalled();
      expect(await readCatalog(root)).toEqual(ready);
    } finally { await retry.close(); }
  }, 30_000);

  it('protects private history while cleaning a mixed table and keeps current plus backup-only v3 vectors and bodies', async () => {
    const root = await directory(), old = new KnowledgeService(root, embedder());
    const obsolete = input('obsolete', 'obsoleteonly search token');
    const kept = { ...input('kept', 'archivequasar preserved in an earlier version'), baseId: 'other-library' };
    const latest = { ...kept, bytes: new TextEncoder().encode('livequasar preserved in the active revision') };
    try {
      await old.indexDocument(kept, signal());
      await old.indexDocument(obsolete, signal());
      await old.indexDocument(latest, signal());
    } finally { await old.close(); }
    const names = await markOldDocuments(root, ['obsolete'], false);
    const prior = await readCatalog(root);
    const beforeBackups = await Promise.all(names.filter(name => name !== 'catalog.json').map(name => readCatalog(root, name)));
    const historical = beforeBackups.find(backup => backup.documents.obsolete && backup.documents.kept);
    expect(historical?.documents.kept.revision).toBeTruthy();
    const oldKept = historical!.documents.kept.revision;
    expect(oldKept).not.toBe(prior.documents.kept.revision);
    const encoder = embedder(), encode = vi.spyOn(encoder, 'encode');
    const migrated = new KnowledgeService(root, encoder);
    const db = await lance.connect(path.join(root, 'lance'));
    try {
      await migrated.initialize();
      expect(migrated.needsIndexCleanup).toBe(true);
      const source = await db.openTable(prior.tableName!);
      try {
        const tags = await source.tags();
        await tags.create('external-recovery-tag', prior.tableVersion!);
        await expect(migrated.cleanUpgradedIndex(signal())).rejects.toMatchObject({ code: 'integrity' });
        expect(await tags.list()).toHaveProperty('external-recovery-tag');
        expect(await source.countRows("documentId = 'obsolete'")).toBeGreaterThan(0);
        await tags.delete('external-recovery-tag');
        const branches = await source.branches();
        (await branches.create('private-recovery', 'main', prior.tableVersion)).close();
        await expect(migrated.cleanUpgradedIndex(signal())).rejects.toMatchObject({ code: 'integrity' });
        expect(await branches.list()).toHaveProperty('private-recovery');
        await branches.delete('private-recovery');
      } finally { source.close(); }
      const cleanup = vi.fn();
      await migrated.cleanUpgradedIndex(signal(), undefined, cleanup);
      expect(cleanup.mock.calls.flat()).toEqual(deletionEvents('obsolete'));
      expect(encode).not.toHaveBeenCalled();
      const clean = await readCatalog(root);
      expect(clean.documents).toEqual({ kept: prior.documents.kept });
      expect((await migrated.search('livequasar', 2, 'keyword', signal(), kept.baseId)).map(hit => hit.documentId)).toEqual(['kept']);
      expect((await migrated.search('obsoleteonly', 2, 'keyword', signal()))).toEqual([]);
      const remaining = (await readdir(root)).filter(name => name.startsWith('catalog-backup-'));
      const recovery = (await Promise.all(remaining.map(name => readCatalog(root, name))))
        .find(backup => backup.documents.kept?.revision === oldKept);
      expect(recovery?.documents).toEqual({ kept: historical!.documents.kept });
      expect(recovery?.tableName).toBe(clean.tableName);
      const retained = await db.openTable(recovery!.tableName!);
      try {
        await retained.checkout(recovery!.tableVersion!);
        expect((await retained.search('archivequasar', 'fts').toArray()).some(row => row.documentId === 'kept')).toBe(true);
        for (const { version } of await retained.listVersions()) {
          await retained.checkout(version);
          expect(await retained.countRows("documentId = 'obsolete'")).toBe(0);
        }
      } finally { retained.close(); }
      expect(await readFile(path.join(root, 'revisions', oldKept), 'utf8')).toContain('archivequasar');
      expect(await readdir(path.join(root, 'revisions'))).not.toContain(prior.documents.obsolete.revision);
      expect(await readdir(path.join(root, 'lance'))).not.toContain(prior.tableName + '.lance');
    } finally { db.close(); await migrated.close(); }
  }, 30_000);
  it.each([false, true])('cleans only recovery-owned history and scopes row events to obsolete documents (archive already current: %s)', async alreadyCurrent => {
    const root = await directory(), archive = await directory();
    const active = new KnowledgeService(root, embedder()), previous = new KnowledgeService(archive, embedder());
    try {
      await active.indexDocument(input('live', 'orbitkeep remains searchable'), signal());
      if (alreadyCurrent) await active.indexDocument(input('archived', 'current revision remains available'), signal());
      await previous.indexDocument(input('live', 'historical copy predating the active index'), signal());
      await previous.indexDocument(input('archived', 'retired archive data'), signal());
    } finally { await active.close(); await previous.close(); }
    const healthy = await readCatalog(root);
    await markOldDocuments(archive, ['archived', 'live']);
    const legacy = await readCatalog(archive);
    const bodyName = legacy.documents.archived.revision, tableName = legacy.tableName + '.lance';
    for (const { revision } of Object.values(legacy.documents))
      await rename(path.join(archive, 'revisions', revision), path.join(root, 'revisions', revision));
    await rename(path.join(archive, 'lance', tableName), path.join(root, 'lance', tableName));
    const archivedCatalog = 'catalog-backup-abcddcba-1234-4123-8123-123456789abc.json';
    await rename(path.join(archive, 'catalog.json'), path.join(root, archivedCatalog));
    const foreignBody = 'rev-unowned.json';
    await writeFile(path.join(root, 'revisions', foreignBody), 'independent recovery artifact');
    const db = await lance.connect(path.join(root, 'lance'));
    const foreignName = 'chunks_bbbbaaaaccccddddeeeeffff00001111';
    try { (await db.createTable(foreignName, [{ text: 'independent table' }])).close(); }
    finally { db.close(); }
    const service = new KnowledgeService(root, embedder());
    try {
      await service.initialize();
      expect(service.needsIndexCleanup).toBe(true);
      const deleted = vi.fn();
      await service.cleanUpgradedIndex(signal(), undefined, deleted);
      expect(deleted.mock.calls.flat()).toEqual(alreadyCurrent ? deletionEvents() : deletionEvents('archived'));
      expect((await readCatalog(root)).documents).toEqual(healthy.documents);
      expect((await readCatalog(root)).tableName).toBe(healthy.tableName);
      expect((await service.search('orbitkeep', 2, 'keyword', signal())).map(hit => hit.documentId)).toEqual(['live']);
      expect(await readdir(root)).not.toContain(archivedCatalog);
      expect(await readdir(path.join(root, 'lance'))).not.toContain(tableName);
      expect(await readdir(path.join(root, 'revisions'))).not.toContain(bodyName);
      expect(await readFile(path.join(root, 'revisions', foreignBody), 'utf8')).toBe('independent recovery artifact');
      expect(await readdir(path.join(root, 'lance'))).toContain(foreignName + '.lance');
      expect(service.needsIndexCleanup).toBe(false);
    } finally { await service.close(); }
  }, 30_000);
  it.each([
    { layout: 'entirely legacy', hasCurrent: false },
    { layout: 'mixed with a current v3 revision', hasCurrent: true },
  ])('handles an externally lost $layout source table with a corrupt obsolete revision', async ({ hasCurrent }) => {
    const root = await directory(), fixture = new KnowledgeService(root, embedder());
    const original = input('legacy', 'reconstructedtoken present in the original bytes');
    try {
      await fixture.indexDocument(original, signal());
      if (hasCurrent) await fixture.indexDocument(input('current', 'curated existing revision'), signal());
    } finally { await fixture.close(); }
    await markOldDocuments(root, ['legacy']);
    const before = await readCatalog(root), obsolete = path.join(root, 'revisions', before.documents.legacy.revision);
    await writeFile(obsolete, '{corrupt obsolete body');
    const db = await lance.connect(path.join(root, 'lance'));
    try { await db.dropTable(before.tableName!); }
    finally { db.close(); }
    const encoder = embedder(), encoded = vi.spyOn(encoder, 'encode');
    const service = new KnowledgeService(root, encoder);
    try {
      const cleanup = async () => {
        await service.initialize();
        await service.cleanUpgradedIndex(signal());
      };
      if (hasCurrent) {
        const current = before.documents.current;
        const revision = path.join(root, 'revisions', current.revision), bytes = await readFile(revision);
        await expect(cleanup()).rejects.toMatchObject({ code: expect.stringMatching(/^(integrity|unavailable)$/) });
        expect((await readCatalog(root)).documents.current).toEqual(current);
        expect(await readFile(revision)).toEqual(bytes);
        expect(encoded).not.toHaveBeenCalled();
      } else {
        await cleanup();
        expect(await service.listDocuments()).toEqual([]);
        expect(existsSync(obsolete)).toBe(false);
        expect(encoded).not.toHaveBeenCalled();
        await service.indexDocument(original, signal());
        expect(encoded.mock.calls.some(([texts, mode]) => mode === 'passage' &&
          texts.some(text => text.includes('reconstructedtoken')))).toBe(true);
        expect((await service.search('reconstructedtoken', 2, 'keyword', signal())).map(hit => hit.documentId)).toEqual(['legacy']);
      }
    } finally { await service.close(); }
  }, 30_000);
  it('cleans a legacy table even when the final original was previously removed, then resumes after the old table disappears', async () => {
    const root = await directory(), old = new KnowledgeService(root, embedder());
    const file = path.join(root, 'catalog.json');
    let priorTable = '';
    try {
      await old.indexDocument(input('removed', 'obsolete deleted content'), signal());
      await old.removeDocument('removed', signal());
      for (const name of (await readdir(root)).filter(n => n === 'catalog.json' || n.startsWith('catalog-backup-'))) {
        const target = path.join(root, name), cat = JSON.parse(await readFile(target, 'utf8'));
        delete cat.indexFormat;
        priorTable = cat.tableName;
        for (const entry of Object.values(cat.documents) as {document: {indexVersion: string}}[])
          entry.document.indexVersion = 'qa-linked-v2';
        await writeFile(target, JSON.stringify(cat));
      }
    } finally { await old.close(); }
    const migrated = new KnowledgeService(root, embedder());
    const connection = await lance.connect(path.join(root, 'lance'));
    const prototype: lance.Connection = Object.getPrototypeOf(connection);
    connection.close();
    const drop = prototype.dropTable;
    const interrupt = vi.spyOn(prototype, 'dropTable').mockImplementation(async function(this: lance.Connection, ...args) {
      await drop.apply(this, args);
      if (args[0] === priorTable) throw Error('lost reply after dropping the obsolete table');
    });
    try {
      await migrated.initialize();
      expect(migrated.needsIndexCleanup).toBe(true);
      await expect(migrated.cleanUpgradedIndex(signal())).rejects.toThrow('lost reply');
    } finally { interrupt.mockRestore(); await migrated.close(); }
    const reopened = new KnowledgeService(root, embedder());
    try {
      await reopened.initialize();
      const cleanup = vi.fn();
      await reopened.cleanUpgradedIndex(signal(), undefined, cleanup);
      expect(cleanup.mock.calls.flat()).toEqual(deletionEvents('removed'));
      expect(await reopened.listDocuments()).toEqual([]);
      expect(JSON.parse(await readFile(file, 'utf8')).indexUpgrade).toBeUndefined();
      expect(await readdir(path.join(root, 'revisions'))).toEqual([]);
      expect(await readdir(path.join(root, 'lance'))).not.toContain(priorTable + '.lance');
    } finally { await reopened.close(); }
  });
  it('scores only readable documents in scope and can cancel a streamed corpus scan', async () => {
    const root = await directory(), encoder = embedder();
    encoder.encode = async (texts, mode) => texts.map(text => {
      const vector = Array<number>(384).fill(0);
      if (mode === 'query') { vector[0] = 0.28; vector[1] = 0.96; }
      else vector[text.includes('leftward') ? 0 : text.includes('rightward') ? 1 : 2] = 1;
      return vector;
    });
    const core = new KnowledgeService(root, encoder);
    const search = (token = signal()) =>
      core.search('AlphaController', 2, 'hybrid', token, 'base-a', { grounded: true, rawLimit: 20 });
    try {
      await core.indexDocument(input('healthy', '# AlphaController leftward\nLeft evidence.\n# AlphaController rightward\nRight evidence.'), signal());
      await core.indexDocument(input('broken', 'Unique irrelevant source text.'), signal());
      await core.indexDocument({ ...input('other', 'Unrelated other library.'), baseId: 'base-b' }, signal());
      const catalog = JSON.parse(await readFile(path.join(root, 'catalog.json'), 'utf8'));
      await writeFile(path.join(root, 'revisions', catalog.documents.broken.revision), '{}');
      const abort = new AbortController();
      const scan = lance.Query.prototype[Symbol.asyncIterator];
      const stream = vi.spyOn(lance.Query.prototype, Symbol.asyncIterator).mockImplementationOnce(async function* (this: lance.Query) {
        const cursor = scan.call(this);
        try {
          const first = await cursor.next();
          if (!first.done) { abort.abort(); yield first.value; }
        } finally { await cursor.return?.(); }
      });
      try { await expect(search(abort.signal)).rejects.toMatchObject({ name: 'AbortError' }); }
      finally { stream.mockRestore(); }
      const hits = await search();
      expect(hits.map(hit => hit.title)).toEqual(['AlphaController rightward', 'AlphaController leftward']);
      expect(hits[0].score).toBeCloseTo(0.96 + 0.05, 6);
      expect(hits[1].score).toBeCloseTo(0.28 + 0.05, 6);
    } finally { await core.close(); }
  });
  it('opens metadata without loading bodies, isolates a corrupt body and reindexes it from the same original', async () => {
    const root = await directory();
    const writer = new KnowledgeService(root, embedder()), reader = new KnowledgeService(root, embedder());
    const cold = new KnowledgeService(root, embedder());
    try {
      const add = (i: number) => writer.indexDocument({
        ...input('snap-' + i, 'Stable synthetic revision ' + i), baseId: i % 2 ? 'second' : 'first',
      }, signal());
      for (let i = 0; i < 5; i++) await add(i);
      await reader.initialize();
      await add(5);
      const dir = path.join(root, 'revisions');
      const reads = vi.spyOn(fs, 'readFile');
      syncBuiltinESMExports();
      try {
        await reader.refreshSnapshot();
        await reader.version('first', signal());
        expect(reads.mock.calls.filter(([file]) => typeof file === 'string' && path.dirname(file) === dir)).toHaveLength(0);
        await reader.search('stable', 1, 'keyword', signal(), 'first');
        const catalog = JSON.parse(await readFile(path.join(root, 'catalog.json'), 'utf8'));
        const allowed = new Set(Object.values(catalog.documents as Record<string, {document: {baseId: string}; revision: string}>)
          .filter(e => e.document.baseId === 'first').map(e => e.revision));
        const bodies = reads.mock.calls.flatMap(([file]) => typeof file === 'string' && path.dirname(file) === dir ? [path.basename(file)] : []);
        expect(bodies.length).toBeGreaterThan(0);
        expect(bodies.every(file => allowed.has(file))).toBe(true);
        reads.mockClear();
        await reader.refreshSnapshot();
        expect(reads.mock.calls.filter(([file]) => typeof file === 'string' && path.dirname(file) === dir)).toHaveLength(0);
      } finally { reads.mockRestore(); syncBuiltinESMExports(); }
      const catalog = JSON.parse(await readFile(path.join(root, 'catalog.json'), 'utf8'));
      const file = path.join(dir, catalog.documents['snap-0'].revision);
      const { items } = JSON.parse(await readFile(file, 'utf8'));
      await writeFile(file, '{"items":false,"text":"invalid"}');
      await reader.refreshSnapshot();
      await cold.initialize();
      for (const client of [reader, cold]) {
        expect(await client.search('stable', 2, 'keyword', signal(), 'second')).toHaveLength(2);
        await expect(client.getItem(items[0].itemId)).rejects.toMatchObject({ code: 'integrity' });
        expect((await client.listDocuments()).find(d => d.documentId === 'snap-0')?.available).toBe(false);
        const hits = await client.search('stable', 2, 'keyword', signal(), 'first');
        expect(hits).toHaveLength(2);
        expect(hits.every(h => h.documentId !== 'snap-0')).toBe(true);
      }
      await add(0);
      await cold.refreshSnapshot();
      expect((await cold.getItem(items[0].itemId))?.content).toContain('Stable synthetic revision');
      expect((await cold.listDocuments()).find(d => d.documentId === 'snap-0')?.available).toBe(true);
    } finally { await Promise.all([writer.close(), reader.close(), cold.close()]); }
  }, 30_000);
  it('isolates inconsistent item IDs, counts and follow-ups, then repairs each from the same original', async () => {
    const root = await directory(), core = new KnowledgeService(root, embedder());
    const original = input('relations', '## Q1. PID alpha?\n\nShared sensor original.\n### 追问 1：如何？\n\nShared sensor followup.');
    try {
      await core.indexDocument(original, signal());
      await core.indexDocument(input('healthy', '## Q1. Healthy shared sensor?\n\nShared sensor intact.'), signal());
      const id = (await core.search('alpha', 1, 'keyword', signal()))[0].itemId;
      for (const damage of ['count', 'duplicate', 'missing', 'unrelated', 'dangling', 'unlisted', 'wrong-base']) {
        const catalog = JSON.parse(await readFile(path.join(root, 'catalog.json'), 'utf8'));
        const file = path.join(root, 'revisions', catalog.documents.relations.revision);
        const body = JSON.parse(await readFile(file, 'utf8'));
        if (damage === 'count') body.items = [];
        if (damage === 'duplicate') body.items[1].itemId = body.items[0].itemId;
        if (damage === 'missing') delete body.items[1].itemId;
        if (damage === 'unrelated') body.items[1].itemId = 'relations:' + '0'.repeat(24);
        if (damage === 'dangling') body.items[0].followUpIds = ['other'];
        if (damage === 'unlisted') body.items[0].followUpIds = [];
        if (damage === 'wrong-base') body.baseId = 'wrong';
        await writeFile(file, JSON.stringify(body));
        await core.refreshSnapshot();
        expect((await core.search('shared', 5, 'keyword', signal())).map(hit => hit.documentId)).toEqual(['healthy']);
        await expect(core.getItem(id)).rejects.toMatchObject({ code: 'integrity' });
        await core.refreshSnapshot();
        expect((await core.search('healthy', 5, 'hybrid', signal(), 'base-a', { grounded: true, rawLimit: 20 }))
          .map(hit => hit.documentId)).toEqual(['healthy']);
        await core.indexDocument(original, signal());
        expect((await core.getItem(id))?.followUps).toHaveLength(1);
        expect((await core.listDocuments()).find(doc => doc.documentId === 'relations')?.available).toBe(true);
      }
    } finally { await core.close(); }
  }, 30_000);
  it('reads a valid body over the cache budget only once per keyword or grounded query', async () => {
    const root = await directory(), core = new KnowledgeService(root, embedder());
    const text = Array.from({ length: 12 }, (_, i) => '## Q' + i + '. PID alpha ' + i + '?\n\nalpha sensor ' + i).join('\n\n');
    try {
      await core.indexDocument(input('oversized', text + '\n' + '\u3000'.repeat(5_800_000)), signal());
      const catalog = JSON.parse(await readFile(path.join(root, 'catalog.json'), 'utf8'));
      const file = path.join(root, 'revisions', catalog.documents.oversized.revision);
      expect((await lstat(file)).size).toBeGreaterThan(16 * 1024 * 1024);
      const reads = vi.spyOn(fs, 'readFile');
      syncBuiltinESMExports();
      try {
        for (const mode of ['keyword', 'hybrid', 'hybrid'] as const) {
          reads.mockClear();
          const hits = await core.search('PID alpha', 12, mode, signal(), 'base-a', { grounded: true, rawLimit: 40 });
          expect(hits).toHaveLength(mode === 'keyword' ? 12 : 6);
          expect(reads.mock.calls.filter(([name]) => name === file)).toHaveLength(1);
        }
      } finally { reads.mockRestore(); syncBuiltinESMExports(); }
    } finally { await core.close(); }
  }, 30_000);
  it('evicts older revision bodies by byte size while retaining their readable originals', async () => {
    const root = await directory(), core = new KnowledgeService(root, embedder());
    const ids: string[] = [];
    const padding = '\u3000'.repeat(1_450_000);
    try {
      for (let i = 0; i < 5; i++) await core.indexDocument(input('cache-' + i, 'Synthetic readable data ' + i), signal());
      const catalog = JSON.parse(await readFile(path.join(root, 'catalog.json'), 'utf8'));
      for (const entry of Object.values(catalog.documents) as { revision: string }[]) {
        const file = path.join(root, 'revisions', entry.revision);
        const value = JSON.parse(await readFile(file, 'utf8'));
        value.text += '\n' + padding;
        ids.push(value.items[0].itemId);
        await writeFile(file, JSON.stringify(value));
      }
      const reads = vi.spyOn(fs, 'readFile');
      syncBuiltinESMExports();
      try {
        for (const id of ids) expect((await core.getItem(id))?.content).toContain('Synthetic readable data');
        expect(reads).toHaveBeenCalledTimes(5);
        await core.getItem(ids[4]);
        expect(reads).toHaveBeenCalledTimes(5);
        expect((await core.getItem(ids[0]))?.content).toContain('Synthetic readable data');
        expect(reads).toHaveBeenCalledTimes(6);
      } finally { reads.mockRestore(); syncBuiltinESMExports(); }
    } finally { await core.close(); }
  }, 30_000);
  it('publishes one full-text index for an entire batch and keeps the old snapshot searchable until commit', async () => {
    const root = await directory(), ready: string[] = [];
    const core = new KnowledgeService(root, embedder(), event => {
      if (event.phase === 'ready') ready.push(event.documentId);
    }), reader = new KnowledgeService(root, embedder(), undefined, undefined, undefined, true);
    let db: lance.Connection | undefined, probe: lance.Table | undefined;
    try {
      await core.indexDocument(input('a', 'legacy searchable text'), signal());
      const catalog = JSON.parse(await readFile(path.join(root, 'catalog.json'), 'utf8'));
      db = await lance.connect(path.join(root, 'lance'));
      probe = await db.openTable(catalog.tableName);
      const index = vi.spyOn(Object.getPrototypeOf(probe), 'createIndex');
      try {
        ready.length = 0;
        await core.beginIndexBatch('batch', 'base-a', ['a', 'b'], signal());
        await core.indexDocument({ ...input('a', 'replacement sensor text'), batchId: 'batch' }, signal());
        await core.indexDocument({ ...input('b', 'second sensor text'), batchId: 'batch' }, signal());
        expect(ready).toEqual([]);
        expect(index).not.toHaveBeenCalled();
        for (const view of [core, reader]) {
          expect((await view.listDocuments()).map(doc => doc.documentId)).toEqual(['a']);
          expect((await view.search('legacy', 2, 'keyword', signal())).map(hit => hit.documentId)).toEqual(['a']);
          expect(await view.search('sensor', 2, 'keyword', signal())).toEqual([]);
        }
        await core.finishIndexBatch('batch', true, signal());
        expect(ready).toEqual(['a', 'b']);
        expect(index).toHaveBeenCalledTimes(1);
        await reader.refreshSnapshot();
        expect((await reader.search('sensor', 2, 'keyword', signal())).map(hit => hit.documentId).sort()).toEqual(['a', 'b']);
        expect(await reader.search('legacy', 2, 'keyword', signal())).toEqual([]);
        await core.beginIndexBatch('retry', 'base-a', ['a', 'b'], signal());
        for (const [id, body] of [['a', 'replacement sensor text'], ['b', 'second sensor text']])
          await core.indexDocument({ ...input(id, body), batchId: 'retry' }, signal());
        await core.finishIndexBatch('retry', true, signal());
        expect(index).toHaveBeenCalledTimes(1);
        expect(ready).toEqual(['a', 'b', 'a', 'b']);
      } finally { index.mockRestore(); }
    } finally { probe?.close(); db?.close(); await Promise.all([core.close(), reader.close()]); }
  });
  it('discards unpublished rows on parser errors, withdrawal, final-index failure and close', async () => {
    const root = await directory(), core = new KnowledgeService(root, embedder());
    let db: lance.Connection | undefined, probe: lance.Table | undefined;
    try {
      await core.indexDocument(input('a', 'legacy searchable text'), signal());
      const catalogFile = path.join(root, 'catalog.json'), catalog = await readFile(catalogFile, 'utf8');
      db = await lance.connect(path.join(root, 'lance'));
      probe = await db.openTable(JSON.parse(catalog).tableName);
      const begin = async () => {
        await core.beginIndexBatch('staging', 'base-a', ['a', 'b'], signal());
        await core.indexDocument({ ...input('a', 'unpublished new version'), batchId: 'staging' }, signal());
      };
      await begin();
      await expect(core.indexDocument({ ...input('b', 'x'), batchId: 'staging' }, signal())).rejects.toThrow();
      await expect(core.finishIndexBatch('staging', true, signal())).rejects.toThrow();
      await begin();
      await core.finishIndexBatch('staging', false, signal());
      await begin();
      await core.invalidateDocument('b', signal());
      await expect(core.finishIndexBatch('staging', true, signal())).rejects.toThrow();
      await begin();
      await core.indexDocument({ ...input('b', 'another new version'), batchId: 'staging' }, signal());
      const index = vi.spyOn(Object.getPrototypeOf(probe), 'createIndex').mockRejectedValueOnce(Error('synthetic index failure'));
      try { await expect(core.finishIndexBatch('staging', true, signal())).rejects.toThrow('synthetic index failure'); }
      finally { index.mockRestore(); }
      expect(await readFile(catalogFile, 'utf8')).toBe(catalog);
      expect(await readdir(path.join(root, 'revisions'))).toHaveLength(1);
      expect((await core.search('legacy', 1, 'keyword', signal()))[0].documentId).toBe('a');
      expect(await core.search('unpublished', 2, 'keyword', signal())).toEqual([]);
      await begin();
    } finally { probe?.close(); db?.close(); await core.close(); }
    const reopened = new KnowledgeService(root, embedder());
    try {
      expect(await readdir(path.join(root, 'revisions'))).toHaveLength(1);
      expect((await reopened.search('legacy', 1, 'keyword', signal()))[0].documentId).toBe('a');
      await reopened.indexDocument(input('b', 'healthy individual retry'), signal());
      expect((await reopened.search('healthy', 1, 'keyword', signal()))[0].documentId).toBe('b');
      expect(await reopened.search('unpublished', 2, 'keyword', signal())).toEqual([]);
    } finally { await reopened.close(); }
  });
  it.each([false, true])('recovers an interrupted batch from disk without losing a prior table (prior=%s)', async (prior) => {
    const directory = await temporaryDirectory('batch-crash'), marker = path.join(directory, '.index-batch.json');
    const writer = new KnowledgeService(directory, embedder()), next = new KnowledgeService(directory, embedder());
    const reader = new KnowledgeService(directory, embedder(), undefined, undefined, undefined, true);
    const folder = path.join(directory, 'revisions');
    try {
      if (prior) await writer.indexDocument({ ...input('keep', 'prior searchable content'), baseId: 'keep' }, signal());
      const initial = prior ? await readdir(folder) : [];
      await writer.beginIndexBatch('batch', 'base-a', ['a', 'b'], signal());
      const nonce = JSON.parse(await readFile(marker, 'utf8')).batch.nonce;
      await writer.indexDocument({ ...input('a', 'unpublished private text'), batchId: 'batch' }, signal());
      const before = await readdir(folder);
      expect(before.length).toBe(initial.length + 1);
      // Persist precisely the disk state of a killed writer, bypassing cooperative rollback.
      const handles = writer as unknown as { stage?: { table?: lance.Table } };
      handles.stage!.table?.close();
      handles.stage = undefined;
      await writer.close();
      await writeFile(path.join(directory, 'catalog-' + nonce + '.tmp'), '{partial');
      await writeFile(path.join(directory, '.catalog-backup-' + nonce + '.tmp'), '{partial');
      expect((await reader.listDocuments()).map(doc => doc.documentId)).toEqual(prior ? ['keep'] : []);
      expect(await readdir(folder)).toEqual(before);
      await reader.close();
      await next.initialize();
      expect(await readdir(folder)).toEqual(initial);
      expect((await readdir(path.join(directory, 'lance'))).filter(f => f.endsWith('.lance'))).toHaveLength(prior ? 1 : 0);
      expect(await readdir(directory)).not.toContain('.index-batch.json');
      if (prior) expect((await next.search('prior', 1, 'keyword', signal()))[0].documentId).toBe('keep');
      expect(await next.search('unpublished', 1, 'keyword', signal())).toEqual([]);
      await next.indexDocument(input('b', 'healthy standalone file'), signal());
      expect(await next.search('unpublished', 1, 'keyword', signal())).toEqual([]);
    } finally { await Promise.all([writer.close(), reader.close(), next.close()]); }
  });
  it('keeps current and backup-only batch revisions when the writer dies after publishing the catalog', async () => {
    const directory = await temporaryDirectory('committed-batch'), marker = path.join(directory, '.index-batch.json');
    const writer = new KnowledgeService(directory, embedder()), next = new KnowledgeService(directory, embedder());
    try {
      await writer.beginIndexBatch('batch', 'base-a', ['a', 'b'], signal());
      const receipt = await readFile(marker);
      for (const id of ['a', 'b'])
        await writer.indexDocument({ ...input(id, 'published original ' + id), batchId: 'batch' }, signal());
      await writer.finishIndexBatch('batch', true, signal());
      const oldRefs = await readdir(path.join(directory, 'revisions'));
      // One revision remains current; the other is now referenced only by a valid recovery catalog.
      await writer.indexDocument(input('b', 'updated published body'), signal());
      await writer.close();
      await writeFile(marker, receipt);
      expect((await next.listDocuments()).map(doc => doc.documentId)).toEqual(['a', 'b']);
      expect((await next.search('updated', 1, 'keyword', signal()))[0].documentId).toBe('b');
      for (const name of oldRefs) expect(await readFile(path.join(directory, 'revisions', name), 'utf8')).toContain('published original');
      expect(await readdir(directory)).not.toContain('.index-batch.json');
    } finally { await Promise.all([writer.close(), next.close()]); }
  });
  it('indexes a legacy 255-character original name without truncation', async () => {
    const core = new KnowledgeService(await directory(), embedder());
    const name = 'a'.repeat(251) + '.txt';
    try {
      await core.indexDocument({ ...input('long-name', 'sample text for indexing'), name }, signal());
      expect((await core.listDocuments()).map(doc => doc.name)).toEqual([name]);
    } finally {
      await core.close();
    }
  });
  it('erases an entire library from catalog backups, immutable bodies and every Lance version while retaining another library’s FTS recovery', async () => {
    const root = await directory();
    const core = new KnowledgeService(root, embedder());
    const catalogPath = path.join(root, 'catalog.json');
    const refs = (id: string, baseId: string, value: string) =>
      ({ ...input(id, value), baseId });
    let db: lance.Connection | undefined;
    try {
      await core.indexDocument(refs('b', 'keep', 'quasar recovery original'), signal());
      await core.indexDocument(refs('a', 'erase', 'alpha private original'), signal());
      const mixed = JSON.parse(await readFile(catalogPath, 'utf8'));
      const firstRevision = path.join(root, 'revisions', mixed.documents.a.revision);
      const legacy = JSON.parse(await readFile(firstRevision, 'utf8'));
      delete legacy.baseId;
      await writeFile(firstRevision, JSON.stringify(legacy));
      const orphan = path.join(root, 'revisions', 'rev-unidentified.json');
      await writeFile(orphan, JSON.stringify({ text: 'unknown owner', items: [{ documentId: 'unknown' }] }));
      await core.removeDocument('a', signal());
      await core.indexDocument(refs('b', 'keep', 'quasar updated content'), signal());
      await core.indexDocument(refs('c', 'erase', 'beta private replacement'), signal());
      await core.indexDocument(refs('third', 'third', 'a third library'), signal());
      const active = JSON.parse(await readFile(catalogPath, 'utf8'));
      const named = (await readdir(root)).filter(x => x === 'catalog.json' || x.startsWith('catalog-backup-'));
      const originals = new Map(await Promise.all(named.map(async name =>
        [name, JSON.parse(await readFile(path.join(root, name), 'utf8'))] as const)));
      db = await lance.connect(path.join(root, 'lance'));
      const originalTable = await db.openTable(mixed.tableName);
      try { await (await originalTable.tags()).create(mixed.tableName + '-v1', mixed.tableVersion); }
      finally { originalTable.close(); }
      await expect(core.removeBase('erase', signal())).rejects.toThrow('所属知识库无法确认');
      expect(await readFile(orphan, 'utf8')).toContain('unknown owner');
      await rename(orphan, path.join(root, 'retained-foreign-original.json'));
      // Simulate an interruption after all catalog pointers have been published.
      const proto = Object.getPrototypeOf(db) as lance.Connection;
      const drop = vi.spyOn(proto, 'dropTable').mockRejectedValueOnce(Error('synthetic disk busy'));
      try {
        await expect(core.removeBase('erase', signal())).rejects.toThrow('synthetic disk busy');
      } finally { drop.mockRestore(); }
      expect((await core.listDocuments()).map(d => d.documentId)).toEqual(['b', 'third']);
      await expect(readFile(firstRevision)).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(readFile(path.join(root, 'revisions', active.documents.c.revision))).rejects.toMatchObject({ code: 'ENOENT' });
      expect(await db.tableNames()).not.toContain(mixed.tableName);
      await expect(lstat(path.join(root, 'lance', mixed.tableName + '.lance'))).rejects.toMatchObject({ code: 'ENOENT' });
      for (const [name, before] of originals) {
        const after = JSON.parse(await readFile(path.join(root, name), 'utf8'));
        expect(Object.values(after.documents)).toEqual(Object.values(before.documents)
          .filter((e: any) => e.document.baseId !== 'erase'));
        const retained = after.documents.b;
        if (!after.tableName) continue;
        const table = await db.openTable(after.tableName);
        try {
          await table.checkout(after.tableVersion);
          expect(await table.countRows("baseId = 'erase'")).toBe(0);
          if (retained) {
            const body = JSON.parse(await readFile(path.join(root, 'revisions', retained.revision), 'utf8')).text;
            const results = await table.search('quasar', 'fts').toArray();
            expect(results.some(r => r.text.includes(body))).toBe(true);
          }
          for (const { version } of await table.listVersions()) {
            await table.checkout(version);
            expect(await table.countRows("baseId = 'erase'")).toBe(0);
          }
        } finally { table.close(); }
      }
      expect(await core.removeBase('erase', signal())).toBeNull();
      const recoveries = async () => {
        const catalog = JSON.parse(await readFile(catalogPath, 'utf8'));
        const table = await db!.openTable(catalog.tableName);
        try { return Object.keys(await (await table.tags()).list()).filter(s => !s.startsWith('voxcue-rebuilt-')).sort(); }
        finally { table.close(); }
      };
      const previousTags = await recoveries();
      await core.removeBase('third', signal());
      expect(await recoveries()).toEqual(previousTags);
      await core.indexDocument(refs('d', 'keep', 'a new retained document'), signal());
      expect((await core.listDocuments()).map(d => d.documentId)).toEqual(['b', 'd']);
    } finally { db?.close(); await core.close(); }
  }, 60_000);
  it('rolls back a cancelled history rewrite before any published data is changed', async () => {
    const root = await directory(), core = new KnowledgeService(root, embedder());
    let db: lance.Connection | undefined;
    try {
      await core.indexDocument(input('a', 'alpha private text'), signal());
      await core.indexDocument({ ...input('b', 'a retained document'), baseId: 'other' }, signal());
      const raw = await readFile(path.join(root, 'catalog.json'), 'utf8');
      const name = JSON.parse(raw).tableName;
      db = await lance.connect(path.join(root, 'lance'));
      const table = await db.openTable(name);
      const proto = Object.getPrototypeOf(table) as lance.Table;
      table.close();
      const ctrl = new AbortController(), add = proto.add;
      const spy = vi.spyOn(proto, 'add').mockImplementationOnce(async function (this: lance.Table, ...params) {
        const result = await add.call(this, ...params);
        ctrl.abort();
        return result;
      });
      try { await expect(core.removeBase('base-a', ctrl.signal)).rejects.toBeDefined(); }
      finally { spy.mockRestore(); }
      expect(await readdir(root)).not.toContain('.library-erasure.json');
      expect(await db.tableNames()).toEqual([name]);
      expect(await readFile(path.join(root, 'catalog.json'), 'utf8')).toBe(raw);
      await core.indexDocument({ ...input('c', 'another retained document'), baseId: 'other' }, signal());
      await core.removeBase('base-a', signal());
      expect((await core.listDocuments()).map(d => d.documentId)).toEqual(['b', 'c']);
    } finally { db?.close(); await core.close(); }
  }, 30_000);
  it('keeps the reader on committed versions during an import and refreshes after commit', async () => {
    const dir = await directory();
    const embeddings = embedder();
    const writer = new KnowledgeService(dir, embeddings);
    const reader = new KnowledgeService(dir, embedder());
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    try {
      await writer.indexDocument(input('old', 'alpha calibrated sensor'), signal());
      await reader.initialize();
      const encode = embeddings.encode.bind(embeddings);
      const stalled = vi.spyOn(embeddings, 'encode').mockImplementation(async (...args) => {
        await gate;
        return encode(...args);
      });
      const pending = writer.indexDocument(input('new', 'beta motor control'), signal());
      await vi.waitFor(() => expect(stalled).toHaveBeenCalled());
      expect((await reader.search('alpha', 5, 'keyword', signal()))[0].documentId).toBe('old');
      release();
      await pending;
      expect((await reader.listDocuments()).map((d) => d.documentId)).toEqual(['old']);
      await reader.refreshSnapshot();
      expect((await reader.search('beta', 5, 'keyword', signal()))[0].documentId).toBe('new');
    } finally {
      release();
      await Promise.all([reader.close(), writer.close()]);
    }
  });
  it('加粗口语稿主问和追问与普通问答生成相同的条目和切片，保留原始文字', () => {
    const plain = [
      '问题：如何验证测量精度？', '**主问口语回答｜约45秒：**', '使用独立参考件比对。',
      '追问2：如何复验漂移？', '应复测同一块参考件。',
      '问题：怎么记录变化？', '保存测量前后的读数。',
      '追问：原始数据存在哪里？', '原始数据存入采集文件。',
    ];
    const script = [...plain];
    script[0] = '**AB-001｜主问（专业）：** 如何验证测量精度？';
    script[3] = '  ↳ **追问 2（口语）：** 如何复验漂移？';
    script[5] = '**主问:** 怎么记录变化？';
    script[7] = '**追问：**原始数据存在哪里？';
    const source = script.join('\r\n');
    const parsed = parseText(source, 'oral', '面试稿.md');
    const expected = parseText(plain.join('\n'), 'oral', '面试稿.md');
    expect(parsed.text).toBe(source);
    expect(parsed.items).toEqual(expected.items);
    expect(parsed.items.map((item) => item.parentId)).toEqual([
      undefined, parsed.items[0].itemId, undefined, parsed.items[2].itemId,
    ]);
    expect(parsed.items[0].answer).toContain('**主问口语回答｜约45秒：**');
    expect(searchUnits(parsed.items, embedder())).toEqual(searchUnits(expected.items, embedder()));
  });
  it('答案标签、代码示例及超长主问行保留为正文', () => {
    const source = [
      '问题：这份示例记录了什么格式？',
      '**主问：**', '**主问口语回答｜约45秒：**',
      '```markdown', '**主问：** 这是代码示例。', '```',
      '**主问：** ' + '长'.repeat(301),
    ];
    const parsed = parseText(source.join('\n'), 'example', '格式.md');
    expect(parsed.items).toHaveLength(1);
    expect(parsed.items[0].answer).toBe(source.slice(1).join('\n'));
  });
  it('大量标题保持层级、代码块边界及父子检索关系', () => {
    const count = 2000;
    const source = Array.from({ length: count }, (_, index) =>
      `# Section ${index}\n\n## Q${index}. Question?\n\nAnswer ${index}.\n\n### 追问 1：Boundary ${index}?\n\nFollow-up ${index}.\n\n\`\`\`md\n# Not a heading\n\`\`\``,
    ).join('\n\n');
    const parsed = parseText(source, 'synthetic', 'questions.md');
    const qa = parsed.items.filter((item) => item.kind === 'qa');
    expect(qa).toHaveLength(count * 2);
    for (const index of [0, 1, count / 2, count - 1]) {
      const root = qa[index * 2], child = qa[index * 2 + 1];
      expect(root.section).toBe(`Section ${index} / Q${index}. Question?`);
      expect(root.parentId).toBeUndefined();
      expect(root.followUpIds).toEqual([child.itemId]);
      expect(child.parentId).toBe(root.itemId);
      expect(child.section).toBe(`Section ${index} / Q${index}. Question? / 追问 1：Boundary ${index}?`);
      expect(child.content).toContain('```md\n# Not a heading\n```');
    }
    const units = searchUnits(parsed.items, embedder());
    for (const index of [0, count / 2, count - 1]) {
      const root = qa[index * 2], child = qa[index * 2 + 1];
      const unit = units.find((value) => value.itemId === child.itemId)!;
      expect(unit.rootItemId).toBe(root.itemId);
      expect(unit.text).toContain('问题：Question?\n追问：');
    }
  });
  it('替换和删除释放旧文档内存缓存，保留磁盘恢复原件及其他文档', async () => {
    const root = await directory();
    const core = new KnowledgeService(root, embedder());
    const cached = core as unknown as { revisions: Map<string, unknown>; grounding?: unknown };
    try {
      await core.indexDocument(input('alpha', '## Q1. PID old?\n\nalpha original body.'), signal());
      await core.indexDocument(input('beta', '## Q1. Qt stable?\n\nbeta retained body.'), signal());
      const original = JSON.parse(await readFile(path.join(root, 'catalog.json'), 'utf8'));
      const recovery = path.join(root, 'revisions', original.documents.alpha.revision);
      const originalBytes = await readFile(recovery);
      await core.search('PID old', 5, 'keyword', signal());
      await core.search('Qt stable', 5, 'keyword', signal());
      expect(cached.revisions.size).toBe(2);
      for (let revision = 0; revision < 3; revision++) {
        await core.indexDocument(input('alpha', `## Q1. PID new?\n\nalpha replacement ${revision}.`), signal());
        const hits = await core.search('PID new', 5, 'keyword', signal());
        expect((await core.getItem(hits[0].itemId))?.content).toContain(`replacement ${revision}`);
        expect(cached.revisions.size).toBe(2);
      }
      await core.search('PID new', 5, 'hybrid', signal(), 'base-a', { rawLimit: 20, grounded: true });
      expect(cached.grounding).toBeDefined();
      await core.removeDocument('alpha', signal());
      expect(cached.revisions.size).toBe(1);
      expect(cached.grounding).toBeUndefined();
      expect(await core.search('PID new', 5, 'keyword', signal())).toEqual([]);
      const beta = await core.search('Qt stable', 5, 'keyword', signal());
      expect((await core.getItem(beta[0].itemId))?.content).toContain('retained body');
      expect(await readFile(recovery)).toEqual(originalBytes);
    } finally {
      await core.close();
    }
  });
  it('gates on the winning root’s raw cosine, keeps six distinct roots and skips unrelated history', async () => {
    const encoder = embedder();
    encoder.encode = vi.fn(async (texts, mode) => texts.map((text: string) => {
      let cosine = 1;
      if (mode === 'passage') cosine = text.includes('rareAnchor') ? 0.875 : 0.9;
      const v = Array<number>(384).fill(0);
      v[0] = cosine; v[1] = Math.sqrt(1 - cosine * cosine);
      return v;
    }));
    const core = new KnowledgeService(await directory(), encoder);
    const grounded = { rawLimit: 60 as const, grounded: true };
    try {
      await core.indexDocument(input('roots', Array.from({ length: 8 }, (_, i) =>
        `## Q${i + 1}. ${i === 0 ? 'rareAnchor' : 'otherTerm'} ${i}?\n\ncontent for item ${i}`).join('\n\n')), signal());
      const ask = (q: string, history?: string[]) => core.search(q, 12, 'hybrid', signal(), 'base-a', { ...grounded, history });
      // The lexical bonus lifts the 0.875 root above 0.90. The standalone gate still uses 0.875.
      const past = ['清洗流程', '早期范围', '上一次话题'];
      expect(await ask('Please describe rareAnchor', past)).toEqual([]);
      expect(vi.mocked(encoder.encode).mock.lastCall?.[0]).toEqual(['Please describe rareAnchor']);
      const hits = await ask('rareAnchor');
      expect(hits).toHaveLength(6);
      expect(new Set(hits.map(hit => hit.itemId)).size).toBe(6);
      expect(hits[0].similarity).toBeCloseTo(0.875, 6);
      expect(hits[0].grounding?.contextual).toBe(false);
      await ask('回到之前那题？', [...past.slice(0, 2), 'rareAnchor']);
      expect(vi.mocked(encoder.encode).mock.lastCall?.[0]).toEqual(['回到之前那题？', '早期范围', '清洗流程']);
      const switched = await ask('Please describe otherTerm', past);
      expect(switched[0].similarity).toBeCloseTo(0.90, 6);
      expect(switched.every(hit => !hit.grounding?.contextual)).toBe(true);
    } finally { await core.close(); }
  });
  it('changes the winning evidence root for a return cue after an intervening interview question', async () => {
    const encoder = embedder();
    encoder.encode = async texts => texts.map(text => {
      const v = Array<number>(384).fill(0);
      const older = text.includes('olderAnchor'), latest = text.includes('latestAnchor');
      v[0] = older ? 0.95 : latest ? 0.9 : 1;
      v[1] = (latest ? -1 : 1) * Math.sqrt(1 - v[0] * v[0]);
      return v;
    });
    const core = new KnowledgeService(await directory(), encoder);
    try {
      await core.indexDocument(input('older', '## Q1. olderAnchor?\n\nFirst synthetic evidence.'), signal());
      await core.indexDocument(input('latest', '## Q1. latestAnchor?\n\nSecond synthetic evidence.'), signal());
      const options = { rawLimit: 20 as const, grounded: true, history: ['olderAnchor', 'latestAnchor'] };
      const latest = await core.search('那怎么验证？', 1, 'hybrid', signal(), 'base-a', options);
      const earlier = await core.search('回到之前那个问题，怎么验证？', 1, 'hybrid', signal(), 'base-a', options);
      expect(latest[0].documentId).toBe('latest');
      expect(earlier[0].documentId).toBe('older');
      expect(earlier[0].grounding?.contextual).toBe(true);
    } finally { await core.close(); }
  });
  it('committed versions and matched children remain scoped across update, disable and restart', async () => {
    const root = await directory(),
      traces: any[] = [];
    let core = new KnowledgeService(root, embedder(), undefined, undefined, (trace) =>
      traces.push(trace),
    );
    try {
      await core.indexDocument(
        input(
          'alpha',
          '## Q001. PID principle?\n\nPID root.\n\n### 追问 1：PID saturation?\n\nSaturation limit.\n\n### 追问 2：PID optimize?\n\nFilter derivative.',
        ),
        signal(),
      );
      const version = await core.version('base-a', signal());
      const hits = await core.search('PID saturation', 12, 'hybrid', signal(), 'base-a', {
        rawLimit: 60,
      });
      expect(hits[0].matchedItemId).toBeTruthy();
      expect(hits[0].revision).toMatch(/^[a-f0-9]{64}$/);
      const expected = { baseId: 'base-a', documentId: 'alpha', revision: hits[0].revision! };
      const item = await core.getItem(hits[0].itemId, signal(), expected);
      expect(item?.rootContent).toContain('PID root');
      expect(item?.content).toContain('Filter derivative');
      expect(
        await core.getItem(hits[0].itemId, signal(), { ...expected, baseId: 'base-b' }),
      ).toBeNull();
      expect(traces[0]).toMatchObject({ distinctRoots: 1, hits: [hits[0].itemId] });
      expect(JSON.stringify(traces[0])).not.toContain('Saturation limit');
      await core.close();
      core = new KnowledgeService(root, embedder());
      expect(await core.version('base-a', signal())).toBe(version);
      await core.indexDocument(input('alpha', '## Q001. PID new revision?\n\nNew body.'), signal());
      expect(await core.version('base-a', signal())).not.toBe(version);
      expect(await core.getItem(hits[0].itemId, signal(), expected)).toBeNull();
      const updated = await core.version('base-a', signal());
      await core.invalidateDocument('alpha', signal());
      expect(await core.version('base-a', signal())).not.toBe(updated);
    } finally {
      await core.close();
    }
  });
  it('encodes the subject and final question once within the 512-token interview query budget', async () => {
    const encoder = embedder();
    encoder.encode = vi.fn(encoder.encode);
    const core = new KnowledgeService(await directory(), encoder);
    try {
      await core.indexDocument(input('alpha', '## Q1. PID alpha?\n\nSynthetic evidence.'), signal());
      const raw = 'PID subject ' + 'x'.repeat(900) + ' final correction';
      vi.mocked(encoder.encode).mockClear();
      await core.search(raw, 6, 'hybrid', signal(), 'base-a', { rawLimit: 20, grounded: true });
      expect(encoder.encode).toHaveBeenCalledTimes(1);
      const encoded = vi.mocked(encoder.encode).mock.calls[0][0][0];
      expect(encoded).toMatch(/^PID subject/);
      expect(encoded).toMatch(/final correction$/);
      expect(encoder.count(encoded, 'query')).toBeLessThanOrEqual(512);
    } finally { await core.close(); }
  });
  it.each([null, [], { schemaVersion: 99, documents: {} }])(
    '参数和损坏配置 %j 保留不可回退的错误码',
    async (catalog) => {
      const root = await directory();
      const core = new KnowledgeService(root, embedder());
      try {
        await expect(
          core.search('PID', 5, 'hybrid', signal(), 'constructor'),
        ).rejects.toMatchObject({
          code: 'invalid_request',
        });
      } finally {
        await core.close();
      }
      await writeFile(path.join(root, 'catalog.json'), JSON.stringify(catalog));
      const incompatible = new KnowledgeService(root, embedder());
      try {
        await expect(incompatible.search('PID', 5, 'hybrid', signal())).rejects.toMatchObject({
          code: 'configuration',
        });
      } finally {
        await incompatible.close();
      }
    },
  );
  it('离线重复查询每次重新编码并执行真实数据库检索', async () => {
    const vectors = embedder();
    const encode = vi.fn(vectors.encode);
    vectors.encode = encode;
    const core = new KnowledgeService(await directory(), vectors);
    try {
      await core.indexDocument(
        input('alpha', '## Q001. PID sensor?\n\nalpha PID 参数37。'),
        signal(),
      );
      const cold: number[] = [],
        warm: number[] = [];
      for (let index = 0; index < 20; index++) {
        const start = performance.now();
        await core.search('PID query ' + index, 5, 'hybrid', signal());
        cold.push(performance.now() - start);
      }
      const expected = await core.search('PID sensor', 5, 'hybrid', signal());
      const table = (core as unknown as { table: lance.Table }).table;
      const searches = vi.spyOn(table, 'vectorSearch');
      const before = encode.mock.calls.filter((call) => call[1] === 'query').length;
      for (let index = 0; index < 100; index++) {
        const start = performance.now();
        const hits = await core.search('PID sensor', 5, 'hybrid', signal());
        warm.push(performance.now() - start);
        expect(hits).toEqual(expected);
      }
      expect(encode.mock.calls.filter((call) => call[1] === 'query')).toHaveLength(before + 100);
      expect(searches).toHaveBeenCalledTimes(100);
      const p95 = (values: number[]) =>
        +values.sort((a, b) => a - b)[Math.floor(values.length * 0.95)].toFixed(3);
      console.log(
        'OFFLINE_RETRIEVAL_MS ' +
          JSON.stringify({
            coldP95: p95(cold),
            warmP95: p95(warm),
            repeatedQueries: warm.length,
            additionalEncodes: 100,
            syntheticVectors: true,
          }),
      );
    } finally {
      await core.close();
    }
  });
  it('相同查询每次检索，参数、知识库隔离，调用方修改不污染后续结果', async () => {
    const vectors = embedder();
    const encode = vi.fn(vectors.encode);
    vectors.encode = encode;
    const core = new KnowledgeService(await directory(), vectors);
    const queryCount = () => encode.mock.calls.filter((call) => call[1] === 'query').length;
    try {
      await core.indexDocument(
        input('alpha', '## Q001. PID sensor?\n\nalpha PID 参数37。'),
        signal(),
      );
      await core.indexDocument(
        { ...input('beta', '## Q001. PID sensor?\n\nbeta PID 参数42。'), baseId: 'base-b' },
        signal(),
      );
      const [first, concurrent] = await Promise.all([
        core.search('PID sensor', 5, 'hybrid', signal(), 'base-a'),
        core.search('PID sensor', 5, 'hybrid', signal(), 'base-a'),
      ]);
      expect(queryCount()).toBe(2);
      expect(first).toEqual(concurrent);
      first[0].title = '被调用方改写';
      concurrent.length = 0;
      expect(
        (await core.search('PID sensor', 5, 'hybrid', signal(), 'base-a'))[0].title,
      ).not.toContain('改写');
      expect(queryCount()).toBe(3);
      expect((await core.search('PID sensor', 5, 'hybrid', signal(), 'base-b'))[0].documentId).toBe(
        'beta',
      );
      await core.search('PID sensor', 1, 'hybrid', signal(), 'base-a');
      await core.search('PID sensor', 5, 'vector', signal(), 'base-a');
      await core.search('PID sensor ', 5, 'hybrid', signal(), 'base-a');
      expect(queryCount()).toBe(7);
      const keyword = await core.search('PID', 5, 'keyword', signal(), 'base-a');
      expect(keyword[0].mode).toBe('keyword');
      const table = (core as unknown as { table: lance.Table }).table;
      const keywordSearches = vi.spyOn(table, 'query');
      expect(await core.search('PID', 5, 'keyword', signal(), 'base-a')).toEqual(keyword);
      expect(await core.search('PID', 5, 'keyword', signal(), 'base-a')).toEqual(keyword);
      expect(keywordSearches).toHaveBeenCalledTimes(2);
      const cancelled = new AbortController();
      cancelled.abort();
      await expect(
        core.search('PID sensor', 5, 'hybrid', cancelled.signal, 'base-a'),
      ).rejects.toThrow();
      await expect(core.search('PID sensor', 5, 'hybrid', signal(), "bad'base")).rejects.toThrow();
      expect(queryCount()).toBe(7);
    } finally {
      await core.close();
    }
  });
  it('资料更新、停用、重新索引、删除和模型卸载保持正确，失败或取消后重新检索', async () => {
    const vectors = embedder();
    const encode = vi.fn(vectors.encode);
    vectors.encode = encode;
    const core = new KnowledgeService(await directory(), vectors);
    const search = () => core.search('PID sensor', 5, 'hybrid', signal());
    const original = input('alpha', '## Q001. PID sensor?\n\nalpha PID 参数37。');
    try {
      await core.indexDocument(original, signal());
      const before = await search();
      await core.updateDocument(
        input('alpha', '## Q001. PID sensor?\n\nalpha PID 参数42。'),
        signal(),
      );
      const updated = await search();
      expect(updated[0].excerpt).toContain('参数42');
      expect(await core.getItem(before[0].itemId)).toBeNull();
      expect((await core.getItem(updated[0].itemId))!.content).toContain('参数42');
      await core.invalidateDocument('alpha', signal());
      expect(await search()).toEqual([]);
      await core.indexDocument(original, signal());
      expect((await search())[0].excerpt).toContain('参数37');
      const queries = () => encode.mock.calls.filter((call) => call[1] === 'query').length;
      const prior = queries();
      await core.unloadModel();
      expect(await search()).toHaveLength(1);
      expect(queries()).toBe(prior + 1);
      encode.mockRejectedValueOnce(Error('合成检索失败'));
      await expect(core.search('PID sensor retry', 5, 'hybrid', signal())).rejects.toThrow(
        '合成检索失败',
      );
      const afterFailure = queries();
      await core.search('PID sensor retry', 5, 'hybrid', signal());
      expect(queries()).toBe(afterFailure + 1);
      const aborted = new AbortController();
      const originalEncode = vectors.encode;
      vectors.encode = async (...args) => {
        const result = await originalEncode(...args);
        aborted.abort();
        return result;
      };
      await expect(
        core.search('PID sensor cancelled', 5, 'hybrid', aborted.signal),
      ).rejects.toThrow();
      vectors.encode = originalEncode;
      const afterAbort = queries();
      await core.search('PID sensor cancelled', 5, 'hybrid', signal());
      expect(queries()).toBe(afterAbort + 1);
      await core.removeDocument('alpha', signal());
      expect(await search()).toEqual([]);
      await core.close();
      await expect(search()).rejects.toThrow('已关闭');
    } finally {
      await core.close();
    }
  });
  it('连续重复检索始终重新执行，每个知识核心实例保持独立', async () => {
    const vectors = embedder();
    const encode = vi.fn(vectors.encode);
    vectors.encode = encode;
    const core = new KnowledgeService(await directory(), vectors);
    const other = new KnowledgeService(await directory(), embedder());
    try {
      await core.indexDocument(
        input('alpha', '## Q001. PID sensor?\n\nalpha PID 参数37。'),
        signal(),
      );
      await other.indexDocument(
        input('beta', '## Q001. PID sensor?\n\nbeta PID 参数42。'),
        signal(),
      );
      await core.search('PID sensor', 5, 'vector', signal());
      expect((await other.search('PID sensor', 5, 'vector', signal()))[0].documentId).toBe('beta');
      for (let index = 0; index < 64; index++)
        await core.search('PID cache ' + index, 5, 'vector', signal());
      const before = encode.mock.calls.filter((call) => call[1] === 'query').length;
      await core.search('PID sensor', 5, 'vector', signal());
      expect(encode.mock.calls.filter((call) => call[1] === 'query')).toHaveLength(before + 1);
    } finally {
      await core.close();
      await other.close();
    }
  });
  it('口语查询每次原样检索，不把语气词、否定或纠正合并成旧问题', async () => {
    const vectors = embedder();
    const encode = vi.fn(vectors.encode);
    vectors.encode = encode;
    const core = new KnowledgeService(await directory(), vectors);
    try {
      await core.indexDocument(input('alpha', '# PID\n\nalpha PID 使用条件。'), signal());
      const queries = [
        'PID sensor',
        '嗯PID sensor',
        'PID sensor呢',
        '不是PID sensor',
        '呃刚说岔了PID sensor',
      ];
      for (const query of queries) await core.search(query, 5, 'vector', signal());
      expect(
        encode.mock.calls.filter((call) => call[1] === 'query').map((call) => call[0][0]),
      ).toEqual(queries);
      const before = encode.mock.calls.length;
      for (const query of queries) await core.search(query, 5, 'vector', signal());
      expect(encode.mock.calls).toHaveLength(before + queries.length);
      expect(
        encode.mock.calls.filter((call) => call[1] === 'query').map((call) => call[0][0]),
      ).toEqual([...queries, ...queries]);
    } finally {
      await core.close();
    }
  });
  it('长口语查询重复执行，不因查询新旧而跳过检索', async () => {
    const vectors = embedder();
    const encode = vi.fn(vectors.encode);
    vectors.encode = encode;
    const core = new KnowledgeService(await directory(), vectors);
    const query = (index: number) => 'PID ' + '哈'.repeat(5900) + index;
    const queryCount = () => encode.mock.calls.filter((call) => call[1] === 'query').length;
    try {
      await core.indexDocument(input('alpha', '# PID\n\nalpha PID 使用条件。'), signal());
      for (let index = 0; index < 40; index++)
        await core.search(query(index), 5, 'vector', signal());
      const before = queryCount();
      await core.search(query(39), 5, 'vector', signal());
      expect(queryCount()).toBe(before + 1);
      await core.search(query(0), 5, 'vector', signal());
      expect(queryCount()).toBe(before + 2);
      expect(encode.mock.calls.at(-1)?.[0]).toEqual([query(0)]);
    } finally {
      await core.close();
    }
  });
  it('并发更新与查询按顺序读取当前提交，失败更新保留可用旧结果', async () => {
    const vectors = embedder();
    const encode = vi.fn(vectors.encode);
    vectors.encode = encode;
    const core = new KnowledgeService(await directory(), vectors);
    const search = () => core.search('PID sensor', 5, 'vector', signal());
    try {
      await core.indexDocument(input('alpha', '# PID\n\nalpha PID 参数37。'), signal());
      await search();
      const [before, , after] = await Promise.all([
        search(),
        core.updateDocument(input('alpha', '# PID\n\nalpha PID 参数42。'), signal()),
        search(),
      ]);
      expect(before[0].excerpt).toContain('参数37');
      expect(after[0].excerpt).toContain('参数42');
      encode.mockRejectedValueOnce(Error('合成索引失败'));
      await expect(
        core.updateDocument(input('alpha', '# PID\n\nalpha PID 参数99。'), signal()),
      ).rejects.toThrow('合成索引失败');
      expect((await search())[0].excerpt).toContain('参数42');
      expect((await core.getItem(after[0].itemId))?.content).toContain('参数42');
    } finally {
      await core.close();
    }
  });
  it('卸载模型保留资料原件、索引与打开的文档列表', async () => {
    const dir = await directory(),
      vectors = embedder();
    let releases = 0;
    vectors.close = async () => {
      releases++;
    };
    const core = new KnowledgeService(dir, vectors);
    try {
      await core.indexDocument(input('alpha', '# PID\n\nOriginal document.'), signal());
      const catalog = await readFile(path.join(dir, 'catalog.json'));
      const documents = await core.listDocuments();
      await core.unloadModel();
      expect(releases).toBe(1);
      expect(await readFile(path.join(dir, 'catalog.json'))).toEqual(catalog);
      expect(await core.listDocuments()).toEqual(documents);
      expect((await core.search('PID', 5, 'hybrid', signal()))[0].documentId).toBe('alpha');
    } finally {
      await core.close();
    }
  });
  it('中英混合三模式、完整追问、重复导入、更新、删除及重启', async () => {
    const dir = await directory();
    let core = new KnowledgeService(dir, embedder());
    const a = input(
      'alpha',
      '# Alpha\n\n## Q001. How does PID 控制 sensor 提离?\n\nlegacyalpha uses PID for lift-off.\n\n### 追问 1：怎样限幅？\n\n限制输出并保留完整尾段。',
    );
    try {
      const first = await core.indexDocument(a, signal());
      expect((await core.indexDocument(a, signal())).updatedAt).toBe(first.updatedAt);
      await core.indexDocument(
        input('beta', '# Qt\n\n## Q001. Qt thread 怎么运行？\n\nbeta queued signal.'),
        signal(),
      );
      for (const mode of ['keyword', 'vector', 'hybrid'] as const) {
        const hits = await core.search('PID sensor 提离', 5, mode, signal());
        expect(hits[0].documentId).toBe('alpha');
        expect((await core.getItem(hits[0].itemId))!.content).toContain('完整尾段');
      }
      await core.close();
      core = new KnowledgeService(dir, embedder());
      expect((await core.listDocuments()).length).toBe(2);
      await core.updateDocument(
        input(
          'alpha',
          '# Alpha\n\n## Q001. PID sensor 如何调整？\n\nnewalpha PID controls lift-off.',
        ),
        signal(),
      );
      expect(await core.search('legacyalpha', 5, 'keyword', signal())).toEqual([]);
      expect((await core.search('newalpha', 5, 'keyword', signal()))[0].documentId).toBe('alpha');
      await core.removeDocument('alpha', signal());
      expect(await core.search('newalpha', 5, 'keyword', signal())).toEqual([]);
      expect((await core.listDocuments()).map((d) => d.documentId)).toEqual(['beta']);
    } finally {
      await core.close();
    }
  });
  it('未提交的数据版本不污染恢复；下次写入从已提交快照恢复', async () => {
    const dir = await directory();
    let core = new KnowledgeService(dir, embedder());
    await core.indexDocument(
      input('alpha', '# Alpha\n\n## Q001. PID sensor?\n\nlegacyalpha PID.'),
      signal(),
    );
    await core.close();
    const catalog = JSON.parse(await readFile(path.join(dir, 'catalog.json'), 'utf8'));
    const db = await lance.connect(path.join(dir, 'lance')),
      table = await db.openTable(catalog.tableName);
    await table.delete("documentId = 'alpha'");
    table.close();
    db.close();
    core = new KnowledgeService(dir, embedder());
    try {
      expect((await core.search('legacyalpha', 5, 'keyword', signal())).length).toBeGreaterThan(0);
      await core.indexDocument(
        input('beta', '# beta\n\n## Q001. Qt thread?\n\nbeta Qt signal.'),
        signal(),
      );
      expect((await core.search('legacyalpha', 5, 'keyword', signal()))[0].documentId).toBe(
        'alpha',
      );
    } finally {
      await core.close();
    }
  });
  it('失败与取消不覆盖旧文档，非法 ID 不进入 SQL', async () => {
    const dir = await directory(),
      core = new KnowledgeService(dir, embedder());
    try {
      await core.indexDocument(
        input('alpha', '# Alpha\n\n## Q001. PID sensor?\n\nlegacyalpha PID.'),
        signal(),
      );
      const abort = new AbortController();
      abort.abort();
      await expect(core.updateDocument(input('alpha', 'replaced'), abort.signal)).rejects.toThrow();
      await expect(core.indexDocument(input("x' OR 1=1", 'malicious'), signal())).rejects.toThrow(
        '无效',
      );
      expect((await core.search('legacyalpha', 5, 'keyword', signal()))[0].documentId).toBe(
        'alpha',
      );
    } finally {
      await core.close();
    }
  });
  it('长答案检索分片覆盖尾部、每片满足上限，完整答案只保存一份', () => {
    const body = '尾部重要参数 '.repeat(300),
      parsed = parseText('## Q001. 如何控制？\n\n' + body, 'a', 'a.md');
    const units = searchUnits(parsed.items, embedder());
    expect(units.length).toBeGreaterThan(1);
    expect(units.every((u) => u.text.length <= 512)).toBe(true);
    expect(units.map((u) => u.text.replace(/^问题：[^\n]*\n/, '')).join('')).toBe(body.trim());
    expect(parsed.items).toHaveLength(1);
    expect(parsed.items[0].answer).toBe(body.trim());
  });
  it('损坏 catalog 明确失败并保留文件', async () => {
    const dir = await directory(),
      file = path.join(dir, 'catalog.json');
    await writeFile(file, 'broken');
    const core = new KnowledgeService(dir, embedder());
    try {
      await expect(core.initialize()).rejects.toThrow('损坏');
      expect(await readFile(file, 'utf8')).toBe('broken');
    } finally {
      await core.close();
    }
  });
  it('替换前停用旧索引；失败、取消和重启均不得继续返回旧资料', async () => {
    const dir = await directory();
    let core = new KnowledgeService(dir, embedder());
    const a = input('alpha', '## Q001. PID sensor?\n\nlegacyalpha PID parameters.');
    await core.indexDocument(a, signal());
    const id = (await core.search('legacyalpha', 5, 'keyword', signal()))[0].itemId;
    await core.invalidateDocument('alpha', signal());
    expect(await core.search('legacyalpha', 5, 'keyword', signal())).toEqual([]);
    expect(await core.getItem(id)).toBeNull();
    await core.close();
    core = new KnowledgeService(dir, embedder());
    try {
      expect(await core.search('legacyalpha', 5, 'keyword', signal())).toEqual([]);
      expect((await core.listDocuments())[0].available).toBe(false);
      await core.indexDocument(
        input('alpha', '## Q001. PID sensor?\n\nnewalpha PID parameters.'),
        signal(),
      );
      expect(await core.search('legacyalpha', 5, 'keyword', signal())).toEqual([]);
      expect((await core.search('newalpha', 5, 'keyword', signal()))[0].documentId).toBe('alpha');
    } finally {
      await core.close();
    }
  });
  it('纯文本 Q&A 建立追问关系，普通段落保持代码块完整与来源层级', () => {
    const qa = parseText(
      'Q1. PID 如何调节？\n\n完整答案。\n\n追问 1：如何限幅？\n\n限幅为 2。',
      'qa',
      'qa.txt',
    );
    expect(qa.items[0].followUpIds).toEqual([qa.items[1].itemId]);
    expect(qa.items[1].parentId).toBe(qa.items[0].itemId);
    const code = '```ts\n' + 'const value = 37;\n\n'.repeat(100) + '```';
    const ordinary = parseText(
      '# Parent\n\n## First\n\n' +
        '第一段文字。'.repeat(300) +
        '\n\n' +
        code +
        '\n\n## Second\n\n第二段解释。',
      'doc',
      'doc.md',
    );
    expect(ordinary.items.filter((i) => i.content.includes('```'))).toHaveLength(1);
    expect(ordinary.items.find((i) => i.content.includes('```'))!.content).toContain(code);
    expect(ordinary.items.at(-1)!.section).toBe('Parent / Second');
  });
});
