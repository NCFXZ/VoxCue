/** Inspect the committed synthetic chat data in a Playwright renderer. */
export async function readStoredChatFixture() {
  const value = request => new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const name = 'voxcue-preparation-chats';
  if (!(await indexedDB.databases()).some(db => db.name === name)) return;
  const db = await value(indexedDB.open(name));
  try {
    const store = db.transaction('state').objectStore('state');
    const header = await value(store.get('current'));
    if (header?.version !== 2) return header;
    const conversations = await Promise.all(header.index.map(({ id }) => value(store.get(['conversation', id]))));
    return { ...header, conversations };
  } finally {
    db.close();
  }
}
