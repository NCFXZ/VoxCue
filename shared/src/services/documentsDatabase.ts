const documentsDatabase = 'copilot-local-documents';
export const historyStoreNames = ['interviewRecords', 'interviewDirectory'] as const;

export async function hasDocumentsDatabase() {
  return (await indexedDB.databases()).some((db) => db.name === documentsDatabase);
}

// Opening a migration source must neither create an empty database nor upgrade an old one.
export function openDocumentsDatabase(existingOnly = false): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(documentsDatabase, existingOnly ? undefined : 2);
    let blocked = false;
    request.onupgradeneeded = ({ oldVersion }) => {
      if (existingOnly || blocked) {
        request.transaction!.abort();
        return;
      }
      const db = request.result;
      if (oldVersion < 1) {
        db.createObjectStore('bases', { keyPath: 'id' });
        const docs = db.createObjectStore('documents', { keyPath: 'id' });
        docs.createIndex('baseId', 'baseId');
      }
      if (oldVersion < 2) {
        db.createObjectStore(historyStoreNames[0], { keyPath: 'id' });
        const directory = db.createObjectStore(historyStoreNames[1], { keyPath: 'id' });
        directory.createIndex('imageIds', 'imageIds', { multiEntry: true });
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      if (blocked) db.close();
      else {
        db.onversionchange = () => db.close();
        resolve(db);
      }
    };
    request.onerror = () => reject(new Error('无法打开本地文档存储。'));
    request.onblocked = () => {
      blocked = true;
      reject(new Error('文档存储被占用，请关闭其他窗口后重试。'));
    };
  });
}
