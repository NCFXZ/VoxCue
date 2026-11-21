import { randomUUID } from 'node:crypto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, expect, it, vi } from 'vitest';
import { eraseLegacyBrowserData } from '../../src/services/legacyBrowserData';

afterEach(() => vi.unstubAllGlobals());
it('erases only the assigned legacy application data and the claimant’s sync row, including after a retry', async () => {
  vi.stubGlobal('indexedDB', new IDBFactory());
  const a = randomUUID(),
    b = randomUUID();
  const values = new Map([
    ['voxcue-sync-owner', b],
    ['copilot-personal-info-v1', 'synthetic'],
    ['device-setting', 'keep'],
  ]);
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    removeItem: (key: string) => values.delete(key),
  });
  const open = (name: string) =>
    new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(name, 1);
      req.onupgradeneeded = () => req.result.createObjectStore('accounts');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  const saved = await open('voxcue-cloud-sync');
  const tx = saved.transaction('accounts', 'readwrite');
  tx.objectStore('accounts').put('A', a);
  tx.objectStore('accounts').put('B', b);
  await new Promise<void>((resolve) => {
    tx.oncomplete = () => resolve();
  });
  saved.close();
  for (const name of ['voxcue-preparation-chats', 'copilot-local-documents', 'unrelated'])
    (await open(name)).close();
  await eraseLegacyBrowserData('account:' + a);
  await eraseLegacyBrowserData('account:' + a);
  expect(values.get('voxcue-sync-owner')).toBe(b);
  expect(values.get('device-setting')).toBe('keep');
  expect(values.has('copilot-personal-info-v1')).toBe(false);
  expect((await indexedDB.databases()).map((db) => db.name).sort()).toEqual([
    'unrelated',
    'voxcue-cloud-sync',
  ]);
  const db = await open('voxcue-cloud-sync');
  const remaining = db.transaction('accounts').objectStore('accounts').getAllKeys();
  await new Promise<void>((resolve) => {
    remaining.onsuccess = () => resolve();
  });
  expect(remaining.result).toEqual([b]);
  db.close();
});
