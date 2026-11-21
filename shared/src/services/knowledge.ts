import { assertLibrariesWritable, deactivateOriginal, holdOriginalReplacements, removeIndexedOriginals, hasKnowledgeEngine, knowledgeCall, markBaseRemoval, pendingBaseRemovals } from './knowledgeIndex';
import { CloudDataConflict, localChanged } from './localChanges';
import { applyHistoryChanges, historyChanged, historyRepository, historyStoreNames, type HistoryChange, type HistorySummary } from './history';
import { sameValue } from './storedEqual';
import { openOriginalBackups, originalBackupsDatabase } from './originalBackups';
import { isKnowledgeFileName, knowledgeBatchLimit, knowledgeDocumentAccept, validKnowledgeDocumentName, validKnowledgeId } from '../../electron/contracts/knowledge';
import { maxRestoreItems } from '../../electron/contracts/restoreData';
import type { KnowledgeBase, LocalDocument, KnowledgeManagementService } from './knowledgeTypes';
import { openDocumentsDatabase, hasDocumentsDatabase } from './documentsDatabase';
export { openDocumentsDatabase, hasDocumentsDatabase } from './documentsDatabase';
export type { KnowledgeBase, LocalDocument, KnowledgeManagementService } from './knowledgeTypes';
export const documentAccept = knowledgeDocumentAccept;
let importing = false;
const baseRemovals = new Map<string, Promise<void>>();
export async function recoverKnowledgeBaseRemovals() {
  let failure: unknown;
  for (const id of pendingBaseRemovals()) {
    try { await localKnowledge.deleteBase(id); }
    catch (error) { failure ??= error; }
  }
  if (failure) throw failure;
}
export function validateFiles(files: Pick<File, 'name' | 'size'>[]) {
  if (!files.length) throw new Error('请选择文件。');
  if (files.length > knowledgeBatchLimit) throw new Error('每次最多导入 20 个文件。');
  const unsupported = [
    ...new Set(files.filter((file) => !isKnowledgeFileName(file.name)).map((file) => file.name)),
  ];
  if (unsupported.length)
    throw new Error(
      `不支持的文件格式：${unsupported.map((name) => (name.length > 240 ? name.slice(0, 120) + '…' + name.slice(-119) : name)).join(', ')}`,
    );
  for (const file of files) {
    if (!validKnowledgeDocumentName(file.name)) throw new Error('文件名无效，请检查文件名称后重试。');
    if (!file.size) throw new Error(`文件为空：${file.name}`);
    if (file.size > 20 * 1024 * 1024) throw new Error(`文件超过 20 MB：${file.name}`);
  }
  if (new Set(files.map((file) => file.name)).size !== files.length)
    throw new Error('同一批次包含同名文件，请分批导入。');
}
async function transaction<T>(
  stores: string[],
  mode: IDBTransactionMode,
  operation: (tx: IDBTransaction, result: (value: T) => void, abort: (reason: unknown) => void) => void,
  existingOnly = false,
): Promise<T> {
  const db = await openDocumentsDatabase(existingOnly);
  return new Promise((resolve, reject) => {
    const tx = db.transaction(stores, mode);
    let value: T;
    let reason: unknown;
    tx.oncomplete = () => {
      db.close();
      resolve(value);
    };
    tx.onerror = tx.onabort = () => {
      db.close();
      reject(reason ?? new Error('本地保存失败，请检查设备存储空间。'));
    };
    try {
      operation(tx, (result) => {
        value = result;
      }, error => {
        reason = error;
        tx.abort();
      });
    } catch (error) {
      tx.abort();
      db.close();
      reject(error);
    }
  });
}
export function readKnowledgeOriginal(store: 'documents', id: string): Promise<LocalDocument | undefined>;
export function readKnowledgeOriginal(store: 'bases', id: string): Promise<KnowledgeBase | undefined>;
export function readKnowledgeOriginal(store: 'bases' | 'documents', id: string) {
  return transaction<LocalDocument | KnowledgeBase | undefined>([store], 'readonly', (tx, result) => {
    const request = tx.objectStore(store).get(id);
    request.onsuccess = () => result(request.result);
  });
}
export function readKnowledgeDocumentNames(ids: readonly string[]) {
  type Name = Pick<LocalDocument, 'id' | 'baseId' | 'name'>;
  return transaction<Name[]>(['documents'], 'readonly', (tx, result) => {
    const names: Name[] = [];
    result(names);
    const store = tx.objectStore('documents');
    for (const id of ids) {
      const request = store.get(id);
      request.onsuccess = () => {
        const doc: LocalDocument | undefined = request.result;
        if (doc && doc.baseId !== 'personal-resume')
          names.push({ id: doc.id, baseId: doc.baseId, name: doc.name });
      };
    }
  });
}
export const localKnowledge: KnowledgeManagementService = {
  listBases: () =>
    transaction(['bases'], 'readonly', (tx, result) => {
      const request = tx.objectStore('bases').getAll();
      request.onsuccess = () =>
        result(
          request.result.sort((a: KnowledgeBase, b: KnowledgeBase) => b.createdAt - a.createdAt),
        );
    }),
  async saveBase(base) {
    await transaction(['bases'], 'readwrite', (tx) => {
      assertLibrariesWritable([base.id]);
      if (!base.name.trim() || base.name.trim().length > 60)
        throw new Error('名称需要 1–60 个字符。');
      tx.objectStore('bases').put({
        ...base,
        name: base.name.trim(),
        localRevision: crypto.randomUUID(),
      });
    });
    localChanged('knowledgebase', ['base:' + base.id]);
  },
  deleteBase(id) {
    const active = baseRemovals.get(id);
    if (active) return active;
    const changed = ['base:' + id];
    const work = removeIndexedOriginals({ baseId: id }, async () => {
      const native = id !== 'personal-resume' && (hasKnowledgeEngine() || pendingBaseRemovals().includes(id));
      if (native) {
        markBaseRemoval(id, true);
        await knowledgeCall({ op: 'remove-base', baseId: id, requestId: crypto.randomUUID() });
      } else if (id === 'personal-resume') {
        for (const doc of await localKnowledge.listDocuments(id)) await deactivateOriginal(doc.id, true);
      }
      await deleteOriginalBackups('baseId', id);
      await transaction(['bases', 'documents'], 'readwrite', (tx) => {
        tx.objectStore('bases').delete(id);
        const docs = tx.objectStore('documents');
        const request = docs.index('baseId').openCursor(id);
        request.onsuccess = () => {
          const cursor = request.result;
          if (cursor) {
            changed.push('file:' + cursor.primaryKey);
            cursor.delete();
            cursor.continue();
          }
        };
      });
      if (native) markBaseRemoval(id, false);
      if (id === 'personal-resume') localChanged('profile', ['resume:main']);
      else localChanged('knowledgebase', changed);
    }).finally(() => baseRemovals.delete(id));
    baseRemovals.set(id, work);
    return work;
  },
  listDocuments: (baseId) =>
    transaction(['documents'], 'readonly', (tx, result) => {
      const request = tx.objectStore('documents').index('baseId').getAll(baseId);
      request.onsuccess = () =>
        result(
          request.result.sort((a: LocalDocument, b: LocalDocument) => b.createdAt - a.createdAt),
        );
    }),
  async importDocuments(baseId, files) {
    if (!files.length) return;
    assertLibrariesWritable([baseId]);
    validateFiles(files);
    if (baseId === 'personal-resume' && files.length !== 1)
      throw new Error('每次只能导入一份简历。');
    if (importing) throw new Error('资料处理中，请稍后重试。');
    importing = true;
    let release: (() => void) | undefined;
    try {
      const old = await localKnowledge.listDocuments(baseId);
      const replaced =
        baseId === 'personal-resume'
          ? old
          : old.filter((doc) => files.some((file) => file.name === doc.name));
      const versions = new Map(replaced.map(doc => [doc.id, documentRevision(doc)]));
      release = holdOriginalReplacements(replaced.map(doc => doc.id));
      for (const doc of replaced) await deactivateOriginal(doc.id);
      const changed = ['base:' + baseId];
      await transaction<void>(['documents', 'bases'], 'readwrite', (tx, _, abort) => {
        const write = () => {
          const docs = tx.objectStore('documents');
          // Re-importing a file with the same name replaces that file, rather than duplicating it.
          const request = docs.index('baseId').getAll(baseId);
          request.onsuccess = () => {
            try { assertLibrariesWritable([baseId]); }
            catch (error) { abort(error); return; }
            const existing: LocalDocument[] = request.result;
            const targets = baseId === 'personal-resume' ? existing : existing.filter(doc => files.some(file => file.name === doc.name));
            if (targets.length !== versions.size || targets.some(doc => versions.get(doc.id) !== documentRevision(doc))) {
              abort(Error('同步期间本地文件已更改。'));
              return;
            }
            const names = new Map(existing.map((doc) => [doc.name, doc.id]));
            if (baseId === 'personal-resume') for (const doc of existing) docs.delete(doc.id);
            for (const file of files) {
              const id = names.get(file.name) ?? crypto.randomUUID();
              names.set(file.name, id);
              changed.push('file:' + id);
              docs.put({
                id,
                baseId,
                name: file.name,
                size: file.size,
                type: file.type,
                createdAt: Date.now(),
                blob: file,
                localRevision: crypto.randomUUID(),
              });
            }
          };
        };
        if (baseId === 'personal-resume') write();
        else {
          const base = tx.objectStore('bases').get(baseId);
          base.onsuccess = () => {
            if (!base.result) tx.abort();
            else write();
          };
        }
      });
      if (baseId === 'personal-resume') localChanged('profile', ['resume:main']);
      else localChanged('knowledgebase', changed);
    } finally {
      release?.();
      importing = false;
    }
  },
  async deleteDocument(id) {
    const doc = await readKnowledgeOriginal('documents', id);
    if (doc?.baseId === 'personal-resume') return localKnowledge.deleteBase(doc.baseId);
    await removeIndexedOriginals({ documentId: id }, async () => {
      await deactivateOriginal(id, true);
      await deleteOriginalBackups('id', id);
      await transaction(['documents'], 'readwrite', (tx) => {
        tx.objectStore('documents').delete(id);
      });
    });
    if (doc) localChanged('knowledgebase', ['base:' + doc.baseId, 'file:' + id]);
  },
};

async function deleteOriginalBackups(index: 'id' | 'baseId', id: string) {
  if (
    typeof indexedDB.databases === 'function' &&
    !(await indexedDB.databases()).some((database) => database.name === originalBackupsDatabase)
  )
    return;
  const failure = () => Error('原件备份删除失败，请重试。');
  const db = await openOriginalBackups('indexed', failure);
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('versions', 'readwrite');
      const versions = tx.objectStore('versions');
      const request = versions.index(index).openKeyCursor(id);
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        versions.delete(cursor.primaryKey);
        cursor.continue();
      };
      tx.oncomplete = () => resolve();
      tx.onerror = tx.onabort = () => reject(failure());
    });
  } finally { db.close(); }
}
/** Originals only. Local parser/vector/model caches are never part of cloud sync. */
export async function syncKnowledgeSnapshot(existingOnly = false) {
  if (existingOnly && !(await hasDocumentsDatabase()))
    return { bases: [], documents: [] };
  return transaction<{ bases: KnowledgeBase[]; documents: LocalDocument[] }>(
    ['bases', 'documents'],
    'readonly',
    (tx, result) => {
      let bases: KnowledgeBase[] = [],
        documents: LocalDocument[] = [];
      const count = existingOnly ? maxRestoreItems + 1 : undefined;
      const b = tx.objectStore('bases').getAll(undefined, count),
        d = tx.objectStore('documents').getAll(undefined, count);
      b.onsuccess = () => {
        bases = b.result;
        result({ bases, documents });
      };
      d.onsuccess = () => {
        documents = d.result;
        result({ bases, documents });
      };
    },
    existingOnly,
  );
}
export function documentRevision(value: KnowledgeBase | LocalDocument | undefined): string | null {
  if (!value) return null;
  return (
    value.localRevision ??
    JSON.stringify(Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'blob' && key !== 'modifiedAt')))
  );
}

type OriginalsSnapshot = { bases: KnowledgeBase[]; documents: LocalDocument[] };
type ImportedHistory = { changes: HistoryChange[]; expectedDirectory?: HistorySummary[] };

/** Publish synchronous stores after all original writes were accepted, and undo them on abort. */
async function updateMigrationOriginals<T>(
  update: (bases: IDBObjectStore, docs: IDBObjectStore, current: OriginalsSnapshot) => T,
  publish: () => () => void,
  guard: () => void,
  existingOnly = false,
  history?: ImportedHistory,
  readOriginals = true,
) {
  let rollback: (() => void) | undefined;
  if (history) await historyRepository.ready();
  const stores = ['bases', 'documents', ...(history ? historyStoreNames : [])];
  try {
    const value = await transaction<T>(stores, 'readwrite', (tx, result, abort) => {
      const baseStore = tx.objectStore('bases'),
        docStore = tx.objectStore('documents');
      const prepare = (current: OriginalsSnapshot) => {
        try {
          guard();
          result(update(baseStore, docStore, current));
          const commitText = () => {
            try {
              guard();
              rollback = publish();
            } catch (error) {
              abort(error);
            }
          };
          if (!history) docStore.count().onsuccess = commitText;
          else {
            const apply = () => applyHistoryChanges(tx, history.changes, commitText, abort);
            if (history.expectedDirectory) {
              // New references in another interview can protect a screenshot selected for removal.
              const expected = history.expectedDirectory;
              const read = tx.objectStore(historyStoreNames[1]).getAll();
              read.onsuccess = () => {
                const byId = new Map(read.result.map((row: HistorySummary) => [row.id, row]));
                if (byId.size !== expected.length || expected.some(row => {
                  const current = byId.get(row.id);
                  // Legacy source rows gain their first directory revision during this move.
                  return !current || (row.revision && current.revision !== row.revision) ||
                    !sameValue(current.imageIds, row.imageIds);
                }))
                  abort(Error('来源资料已改变，请重新选择。'));
                else apply();
              };
            } else apply();
          }
        } catch (error) {
          abort(error);
        }
      };
      if (readOriginals) {
        const bases = baseStore.getAll();
        const documents = docStore.getAll();
        documents.onsuccess = () => prepare({ bases: bases.result, documents: documents.result });
      } else prepare({ bases: [], documents: [] });
    }, existingOnly);
    if (history?.changes.length) historyChanged(history.changes.map(row => row.id), false);
    return value;
  } catch (error) {
    rollback?.();
    throw error;
  }
}
export function mergeImportedOriginals(
  bases: KnowledgeBase[],
  documents: LocalDocument[],
  verify: (current: OriginalsSnapshot) => void,
  publish: () => () => void,
  guard: () => void,
  history?: ImportedHistory,
  readOriginals = true,
) {
  return updateMigrationOriginals((baseStore, docStore, current) => {
    verify(current);
    for (const base of bases) baseStore.put({ ...base, localRevision: crypto.randomUUID() });
    const originals = documents.map(doc => ({ ...doc, localRevision: crypto.randomUUID() }));
    for (const doc of originals) docStore.put(doc);
    return originals;
  }, publish, guard, false, history, readOriginals);
}
export async function removeMovedOriginals(
  baseIds: ReadonlySet<string>,
  documentIds: ReadonlySet<string>,
  verify: (current: OriginalsSnapshot) => void,
  publish: () => () => void,
  history?: ImportedHistory,
) {
  if (!history && (!(baseIds.size || documentIds.size) || !(await hasDocumentsDatabase()))) {
    verify({ bases: [], documents: [] });
    publish();
    return;
  }
  await updateMigrationOriginals((bases, docs, current) => {
    verify(current);
    for (const id of baseIds) bases.delete(id);
    for (const id of documentIds) docs.delete(id);
  }, publish, () => {}, true, history, !!(baseIds.size || documentIds.size));
}
/** Keep all reviewed originals together until the last cloud check and one IndexedDB commit. */
export async function removeSyncedLibraryOriginals(root: string, revisions: ReadonlyMap<string, string | null>,
  keys: string[], recheckCloud: () => Promise<void>, guard: () => void) {
  const baseId = root.slice(5);
  const conflict = () => new CloudDataConflict('同步期间本地数据已有修改，已保留两端版本。');
  const removeBase = keys.includes(root);
  const files = keys.filter(key => key !== root);
  if (!root.startsWith('base:') || !validKnowledgeId(baseId) || baseId === 'personal-resume' ||
      new Set(keys).size !== keys.length || keys.some(key => !revisions.get(key)) ||
      files.some(key => !key.startsWith('file:') || !validKnowledgeId(key.slice(5))) ||
      (removeBase && revisions.size !== keys.length)) throw conflict();
  const check = (commit: boolean) => transaction<void>(['bases', 'documents'], commit ? 'readwrite' : 'readonly',
    (tx, _, abort) => {
      const bases = tx.objectStore('bases'), documents = tx.objectStore('documents');
      const base = bases.get(baseId);
      const members = documents.index('baseId').getAll(baseId);
      members.onsuccess = () => {
        try {
          guard();
          assertLibrariesWritable([baseId]);
          const docs: LocalDocument[] = members.result;
          if (docs.length + (base.result ? 1 : 0) !== revisions.size ||
              (base.result && revisions.get(root) !== documentRevision(base.result)) ||
              docs.some(doc => revisions.get('file:' + doc.id) !== documentRevision(doc))) throw conflict();
          if (commit) {
            for (const file of files) documents.delete(file.slice(5));
            if (removeBase) bases.delete(baseId);
          }
        } catch (error) { abort(error); }
      };
    });
  await check(false);
  const release = holdOriginalReplacements(files.map(key => key.slice(5)));
  try {
    if (removeBase && hasKnowledgeEngine()) {
      guard();
      await knowledgeCall({ op: 'remove-base', baseId, requestId: crypto.randomUUID() });
    } else for (const key of files) {
      guard();
      await deactivateOriginal(key.slice(5), true);
    }
    await recheckCloud();
    await check(true);
  } finally { release(); }
}
/** A cloud version can omit a local original. Only remove the reviewed revision.
 * A library row is removed last, once its reviewed documents have been removed. */
export async function removeSyncedKnowledgeOriginal(
  kind: 'base' | 'file' | 'resume', id: string, baseId: string, expectedRevision: string, guard: () => void,
) {
  const base = kind === 'base';
  const changed = () => new CloudDataConflict('同步期间本地数据已有修改，已保留两端版本。');
  const verify = (original: KnowledgeBase | LocalDocument | undefined, count: number) => {
    guard();
    assertLibrariesWritable([baseId]);
    if (!original || (kind === 'resume') !== (baseId === 'personal-resume') ||
        (kind === 'resume' && count !== 1) || documentRevision(original) !== expectedRevision ||
        (base ? (id !== baseId || count !== 0) : (!('baseId' in original) || original.baseId !== baseId)))
      throw changed();
  };
  const checkOriginal = (remove: boolean) => transaction<void>(
    ['documents', 'bases'], remove ? 'readwrite' : 'readonly', (tx, _, abort) => {
      const docs = tx.objectStore('documents');
      const store = base ? tx.objectStore('bases') : docs;
      const children = base || kind === 'resume' ? docs.index('baseId').count(baseId) : undefined;
      const current = store.get(id);
      current.onsuccess = () => {
        try {
          verify(current.result, children?.result ?? 0);
          if (remove) store.delete(id);
        } catch (error) { abort(error); }
      };
    },
  );
  await removeIndexedOriginals(base ? { baseId } : { documentId: id }, async () => {
    await checkOriginal(false);
    guard();
    if (!base) await deactivateOriginal(id, true);
    else if (hasKnowledgeEngine()) await knowledgeCall({ op: 'remove-base', baseId, requestId: crypto.randomUUID() });
    await checkOriginal(true);
  });
}

export async function restoreSyncedBase(
  base: KnowledgeBase,
  expectedRevision: string | null,
  guard = () => {},
) {
  return transaction(
    ['bases'],
    'readwrite',
    (tx, _, abort) => {
      const store = tx.objectStore('bases'),
        current = store.get(base.id);
      current.onsuccess = () => {
        try {
          guard();
          assertLibrariesWritable([base.id]);
        } catch (error) {
          abort(error);
          return;
        }
        if (documentRevision(current.result) !== expectedRevision) tx.abort();
        else store.put({ ...base, localRevision: crypto.randomUUID() });
      };
    },
  );
}
export async function restoreSyncedDocument(
  doc: LocalDocument,
  expectedRevision: string | null,
  guard = () => {},
) {
  assertLibrariesWritable([doc.baseId]);
  const resume = doc.baseId === 'personal-resume';
  const previous = await readKnowledgeOriginal('documents', doc.id);
  const ownershipConflict = () => new CloudDataConflict('文件标识已用于其他资料，已保留两端版本。');
  if (previous && (previous.baseId === 'personal-resume') !== resume) throw ownershipConflict();
  const replaced = resume
    ? await localKnowledge.listDocuments(doc.baseId) : previous ? [previous] : [];
  const scopes = [doc.baseId, ...replaced.map(item => item.baseId)];
  assertLibrariesWritable(scopes);
  if (!resume && previous && documentRevision(previous) !== expectedRevision) throw Error('同步期间本地文件已更改。');
  const release = holdOriginalReplacements(replaced.map(item => item.id));
  try {
    for (const item of replaced) await deactivateOriginal(item.id);
    return await transaction<LocalDocument>(
      ['documents', 'bases'],
      'readwrite',
      (tx, result, abort) => {
        const store = tx.objectStore('documents');
        const parent = resume ? undefined : tx.objectStore('bases').getKey(doc.baseId);
        const claimed = resume ? store.getKey(doc.id) : undefined;
        const current = resume ? store.index('baseId').getAll(doc.baseId) : store.get(doc.id);
        current.onsuccess = () => {
          try {
            guard();
            assertLibrariesWritable(scopes);
            if (parent && parent.result === undefined) throw Error('知识库无效。');
            if (Array.isArray(current.result)
              ? claimed?.result !== undefined && !current.result.some(item => item.id === doc.id)
              : current.result?.baseId === 'personal-resume') throw ownershipConflict();
          } catch (error) {
            abort(error);
            return;
          }
          const actual = Array.isArray(current.result) ? current.result[0] : current.result;
          if (documentRevision(actual) !== expectedRevision) {
            tx.abort();
            return;
          }
          for (const item of replaced) store.delete(item.id);
          const committed = { ...doc, localRevision: crypto.randomUUID() };
          store.put(committed);
          result(committed);
        };
      },
    );
  } finally { release(); }
}
export async function previewDocument(doc: LocalDocument): Promise<string> {
  if (!/\.(txt|md)$/i.test(doc.name))
    return '原件已保存在本地。当前仅支持 TXT 和 Markdown 文本预览。';
  return (
    (await doc.blob.slice(0, 100000).text()) +
    (doc.size > 100000 ? '\n\n…预览仅显示前 100 KB。' : '')
  );
}
