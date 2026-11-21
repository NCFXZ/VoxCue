import { expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { exportAccountData } from '../../src/services/accountExport';
import { recordMovedCloudItems } from '../../src/services/migrationSyncProtection';
import { packCloudItem, digestCloudBlob } from '../../src/services/cloudData';
import { historyRepository } from '../../src/services/history';
import { useCloudAccount } from '../../src/stores/cloudAccount';
import type { AccountExportCall } from '../../electron/contracts/accountData';
import type { CloudSyncCall } from '../../electron/contracts/cloudSync';

it('exports a moved interview from its verified cloud head without restoring its source account', async () => {
  const userId = crypto.randomUUID(), key = 'record:synthetic';
  const storage = new Map<string, string>();
  vi.stubGlobal('indexedDB', new IDBFactory());
  vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, v: string) => storage.set(key, v), removeItem: (key: string) => storage.delete(key) });
  const before = useCloudAccount.getState();
  try {
    useCloudAccount.setState({ state: { user: { id: userId, email: 'fixture@example.test', createdAt: 1 }, configured: true, verified: true } });
    recordMovedCloudItems(userId, [key], []);
    const blob = packCloudItem(key, JSON.stringify({
      id: 'synthetic', title: 'Saved cloud interview', startedAt: 1, endedAt: 2,
      status: 'ended', transcripts: [], answers: [], mock: false,
    }));
    const hash = await digestCloudBlob(blob);
    const resource = { id: crypto.randomUUID(), name: key, kind: 'history', headVersion: crypto.randomUUID(),
      bytes: blob.size, sha256: hash, revision: 1, createdAt: 1 };
    const files: AccountExportCall[] = [];
    let corrupt = false;
    vi.stubGlobal('window', { desktop: {
      accountData: async (call: AccountExportCall) => {
        files.push(call);
        return { ok: true, token: 'fixture', saved: true };
      },
      cloudSync: async (call: CloudSyncCall) => {
        expect(call.userId).toBe(userId);
        switch (call.action) {
          case 'list': return { ok: true, value: { items: [resource], nextCursor: null } };
          case 'manifest': return { ok: true, value: { bytes: blob.size, sha256: hash, chunkBytes: 1048576,
            parts: [{ index: 0, bytes: blob.size, sha256: hash }] } };
          case 'read': return { ok: true, value: corrupt ? new Uint8Array(blob.size) : new Uint8Array(await blob.arrayBuffer()) };
          default: throw Error('unexpected cloud mutation');
        }
      },
    } });
    expect(await exportAccountData()).toBe(true);
    expect(files).toContainEqual(expect.objectContaining({ kind: 'record', name: '1-Saved cloud interview.txt' }));
    expect(await historyRepository.list()).toEqual([]);
    corrupt = true;
    files.length = 0;
    await expect(exportAccountData()).rejects.toThrow('校验失败');
    expect(files.at(-1)?.action).toBe('cancel');
  } finally {
    useCloudAccount.setState(before, true);
    vi.unstubAllGlobals();
  }
});
