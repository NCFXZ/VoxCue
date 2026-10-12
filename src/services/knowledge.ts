export interface KnowledgeBase {
  id: string;
  name: string;
  createdAt: number;
}
export interface LocalDocument {
  id: string;
  baseId: string;
  name: string;
  size: number;
  type: string;
  createdAt: number;
  blob: Blob;
}
export interface KnowledgeManagementService {
  listBases(): Promise<KnowledgeBase[]>;
  saveBase(base: KnowledgeBase): Promise<void>;
  deleteBase(id: string): Promise<void>;
  listDocuments(baseId: string): Promise<LocalDocument[]>;
  importDocuments(baseId: string, files: File[]): Promise<void>;
  deleteDocument(id: string): Promise<void>;
}
const supported = new Set(['pdf', 'doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx', 'txt', 'md']);
export const documentAccept = '.pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,.md';
export function validateFiles(files: Pick<File, 'name' | 'size'>[]) {
  if (!files.length) throw new Error('请选择文件。');
  if (files.length > 20) throw new Error('每次最多导入 20 个文件。');
  for (const file of files) {
    if (!supported.has(file.name.split('.').pop()?.toLowerCase() ?? ''))
      throw new Error(`不支持的文件格式：${file.name}`);
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
    request.onblocked = () => reject(new Error('本地文档存储被占用，请关闭其他应用窗口后重试。'));
  });
}
async function transaction<T>(
  stores: string[],
  mode: IDBTransactionMode,
  operation: (tx: IDBTransaction, result: (value: T) => void) => void,
): Promise<T> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(stores, mode);
    let value: T;
    tx.oncomplete = () => {
      db.close();
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
      tx.objectStore('bases').put({ ...base, name: base.name.trim() });
    }),
  deleteBase: (id) =>
    transaction(['bases', 'documents'], 'readwrite', (tx) => {
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
    }),
  listDocuments: (baseId) =>
    transaction(['documents'], 'readonly', (tx, result) => {
      const request = tx.objectStore('documents').index('baseId').getAll(baseId);
      request.onsuccess = () =>
        result(
          request.result.sort((a: LocalDocument, b: LocalDocument) => b.createdAt - a.createdAt),
        );
    }),
  async importDocuments(baseId, files) {
    validateFiles(files);
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
  },
  deleteDocument: (id) =>
    transaction(['documents'], 'readwrite', (tx) => {
      tx.objectStore('documents').delete(id);
    }),
};
export async function previewDocument(doc: LocalDocument): Promise<string> {
  if (!/\.(txt|md)$/i.test(doc.name))
    return '文件已保存在本地。PDF 和 Office 文档解析尚未接入，此处不生成虚假的解析结果。';
  return (
    (await doc.blob.slice(0, 100000).text()) +
    (doc.size > 100000 ? '\n\n…预览仅显示前 100 KB。' : '')
  );
}
