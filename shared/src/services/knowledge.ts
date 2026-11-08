import { deactivateOriginal } from './knowledgeIndex';
import { localChanged } from './localChanges';
import { isKnowledgeFileName, knowledgeDocumentAccept } from '../../electron/contracts/knowledge';
import type { KnowledgeBase, LocalDocument, KnowledgeManagementService } from './knowledgeTypes';
export type { KnowledgeBase, LocalDocument, KnowledgeManagementService } from './knowledgeTypes';
export const documentAccept = knowledgeDocumentAccept;
let importing = false;
export function validateFiles(files: Pick<File, 'name' | 'size'>[]) {
  if (!files.length) throw new Error('请选择文件。');
  if (files.length > 20) throw new Error('每次最多导入 20 个文件。');
  const unsupported = [
    ...new Set(files.filter((file) => !isKnowledgeFileName(file.name)).map((file) => file.name)),
  ];
  if (unsupported.length)
    throw new Error(
      `不支持的文件格式：${unsupported.map((name) => (name.length > 240 ? name.slice(0, 120) + '…' + name.slice(-119) : name)).join('、')}`,
    );
  for (const file of files) {
    if (!file.size) throw new Error(`文件为空：${file.name}`);
    if (file.size > 20 * 1024 * 1024) throw new Error(`文件超过 20 MB：${file.name}`);
  }
}
function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('copilot-local-documents', 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore('bases', { keyPath: 'id' });
      const docs = db.createObjectStore('documents', { keyPath: 'id' });
      docs.createIndex('baseId', 'baseId');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('无法打开本地文档存储。'));
    request.onblocked = () => reject(new Error('文档存储被占用，请关闭其他窗口后重试。'));
  });
}
async function transaction<T>(
  stores: string[],
  mode: IDBTransactionMode,
  operation: (tx: IDBTransaction, result: (value: T) => void) => void,
  notify = true,
): Promise<T> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(stores, mode);
    let value: T;
    tx.oncomplete = () => {
      db.close();
      if (mode === 'readwrite' && notify) localChanged('knowledgebase');
      resolve(value);
    };
    tx.onerror = tx.onabort = () => {
      db.close();
      reject(new Error('本地保存失败，请检查设备存储空间。'));
    };
    try {
      operation(tx, (result) => {
        value = result;
      });
    } catch (error) {
      tx.abort();
      db.close();
      reject(error);
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
  saveBase: (base) =>
    transaction(['bases'], 'readwrite', (tx) => {
      if (!base.name.trim() || base.name.trim().length > 60)
        throw new Error('名称需要 1–60 个字符。');
      tx.objectStore('bases').put({
        ...base,
        name: base.name.trim(),
        localRevision: crypto.randomUUID(),
      });
    }),
  async deleteBase(id) {
    for (const doc of await localKnowledge.listDocuments(id))
      await deactivateOriginal(doc.id, true);
    return transaction(['bases', 'documents'], 'readwrite', (tx) => {
      tx.objectStore('bases').delete(id);
      const docs = tx.objectStore('documents');
      const request = docs.index('baseId').openCursor(id);
      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        }
      };
    });
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
    validateFiles(files);
    if (importing) throw new Error('资料处理中，请稍后重试。');
    importing = true;
    try {
      const old = await localKnowledge.listDocuments(baseId);
      const replaced =
        baseId === 'personal-resume'
          ? old
          : old.filter((doc) => files.some((file) => file.name === doc.name));
      await backupOriginals(replaced);
      for (const doc of replaced) await deactivateOriginal(doc.id);
      await transaction<void>(['documents', 'bases'], 'readwrite', (tx) => {
        const write = () => {
          const docs = tx.objectStore('documents');
          // Re-importing a file with the same name replaces that file, rather than duplicating it.
          const request = docs.index('baseId').getAll(baseId);
          request.onsuccess = () => {
            const existing: LocalDocument[] = request.result;
            const names = new Map(existing.map((doc) => [doc.name, doc.id]));
            for (const file of files) {
              const id = names.get(file.name) ?? crypto.randomUUID();
              names.set(file.name, id);
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
    } finally {
      importing = false;
    }
  },
  async deleteDocument(id) {
    await deactivateOriginal(id, true);
    return transaction(['documents'], 'readwrite', (tx) => {
      tx.objectStore('documents').delete(id);
    });
  },
};
/** Originals only. Local parser/vector/model caches are never part of cloud sync. */
export async function syncKnowledgeSnapshot() {
  return transaction<{ bases: KnowledgeBase[]; documents: LocalDocument[] }>(
    ['bases', 'documents'],
    'readonly',
    (tx, result) => {
      let bases: KnowledgeBase[] = [],
        documents: LocalDocument[] = [];
      const b = tx.objectStore('bases').getAll(),
        d = tx.objectStore('documents').getAll();
      b.onsuccess = () => {
        bases = b.result;
        result({ bases, documents });
      };
      d.onsuccess = () => {
        documents = d.result;
        result({ bases, documents });
      };
    },
  );
}
export function documentRevision(value: KnowledgeBase | LocalDocument | undefined): string | null {
  if (!value) return null;
  return (
    value.localRevision ??
    JSON.stringify(Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'blob')))
  );
}
export async function restoreSyncedBase(
  base: KnowledgeBase,
  expectedRevision: string | null,
  guard = () => {},
) {
  return transaction(
    ['bases'],
    'readwrite',
    (tx) => {
      const store = tx.objectStore('bases'),
        current = store.get(base.id);
      current.onsuccess = () => {
        try {
          guard();
        } catch {
          tx.abort();
          return;
        }
        if (documentRevision(current.result) !== expectedRevision) tx.abort();
        else store.put({ ...base, localRevision: crypto.randomUUID() });
      };
    },
    false,
  );
}
export async function restoreSyncedDocument(
  doc: LocalDocument,
  expectedRevision: string | null,
  guard = () => {},
) {
  const old = await localKnowledge.listDocuments(doc.baseId);
  const replaced = old.filter((item) => item.id === doc.id || doc.baseId === 'personal-resume');
  await backupOriginals(replaced);
  for (const item of replaced) await deactivateOriginal(item.id);
  return transaction(
    ['documents'],
    'readwrite',
    (tx) => {
      const store = tx.objectStore('documents');
      const current =
        doc.baseId === 'personal-resume'
          ? store.index('baseId').getAll(doc.baseId)
          : store.get(doc.id);
      current.onsuccess = () => {
        try {
          guard();
        } catch {
          tx.abort();
          return;
        }
        const actual = Array.isArray(current.result) ? current.result[0] : current.result;
        if (documentRevision(actual) !== expectedRevision) {
          tx.abort();
          return;
        }
        for (const item of replaced) store.delete(item.id);
        store.put({ ...doc, localRevision: crypto.randomUUID() });
      };
    },
    false,
  );
}
export async function previewDocument(doc: LocalDocument): Promise<string> {
  if (!/\.(txt|md)$/i.test(doc.name))
    return '原件已保存在本地。当前仅支持 TXT 和 Markdown 文本预览。';
  return (
    (await doc.blob.slice(0, 100000).text()) +
    (doc.size > 100000 ? '\n\n…预览仅显示前 100 KB。' : '')
  );
}

async function backupOriginals(documents: LocalDocument[]) {
  if (!documents.length) return;
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('voxcue-original-backups', 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore('versions', { keyPath: 'backupId' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(Error('原件备份失败，未替换文档。'));
  });
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('versions', 'readwrite');
    for (const doc of documents)
      tx.objectStore('versions').add({
        ...doc,
        backupId: crypto.randomUUID(),
        backedUpAt: Date.now(),
      });
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = tx.onabort = () => {
      db.close();
      reject(Error('原件备份失败，未替换文档。'));
    };
  });
}
