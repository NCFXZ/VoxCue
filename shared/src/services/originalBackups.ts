export const originalBackupsDatabase = 'voxcue-original-backups';
const schemaVersion = 2;

/** A migration reader leaves the source at its existing version. */
export function openOriginalBackups(mode: 'source' | 'indexed', failure: () => Error) {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(originalBackupsDatabase, mode === 'source' ? undefined : schemaVersion);
    let blocked = false;
    request.onblocked = () => {
      blocked = true;
      reject(failure());
    };
    request.onupgradeneeded = ({ oldVersion }) => {
      // A blocked request can resume after its caller has already received the error.
      if (blocked || mode === 'source') {
        request.transaction!.abort();
        return;
      }
      const versions = oldVersion
        ? request.transaction!.objectStore('versions')
        : request.result.createObjectStore('versions', { keyPath: 'backupId' });
      versions.createIndex('id', 'id');
      versions.createIndex('baseId', 'baseId');
    };
    request.onerror = () => reject(failure());
    request.onsuccess = () => {
      const db = request.result;
      if (blocked || db.version > schemaVersion) {
        db.close();
        reject(failure());
        return;
      }
      db.onversionchange = () => db.close();
      resolve(db);
    };
  });
}
