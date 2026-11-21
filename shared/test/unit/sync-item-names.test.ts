import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { historyStoreNames, openDocumentsDatabase } from '../../src/services/documentsDatabase';
import { historyRepository } from '../../src/services/history';
import { fallbackSyncItemName, loadSyncItemNames } from '../../src/services/syncItemNames';
import { useGeneralSettings } from '../../src/stores/generalSettings';

beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory());
  vi.stubGlobal('localStorage', { getItem: () => null });
  useGeneralSettings.setState({ language: 'zh-CN' });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('uses local file, library, résumé and interview metadata without opening a transcript or screenshot', async () => {
  const db = await openDocumentsDatabase();
  const tx = db.transaction(['documents', 'bases', historyStoreNames[1]], 'readwrite');
  const saved = new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error);
  });
  tx.objectStore('bases').put({ id: 'k', name: '合成资料库', createdAt: 1 });
  for (const [id, baseId, name] of [['f', 'k', '系统设计.txt'], ['r', 'personal-resume', '简历.pdf']])
    tx.objectStore('documents').put({ id, baseId, name, createdAt: 1, blob: new Blob(['fixture']) });
  const directory = tx.objectStore(historyStoreNames[1]);
  directory.put({ id: 'recent', title: '技术面', startedAt: 2, imageIds: ['x', 'y'] });
  directory.put({ id: 'older', title: '', startedAt: 1, imageIds: ['y'] });
  await saved;
  db.close();
  const readOriginal = vi.spyOn(historyRepository, 'get');
  const names = await loadSyncItemNames([
    'profile:main', 'resume:main', 'record:recent', 'record:older', 'image:x', 'image:y', 'base:k', 'file:f', 'file:r',
  ]);
  expect(names).toMatchObject({
    'profile:main': '个人信息', 'resume:main': '简历原件 · 简历.pdf',
    'record:recent': '技术面', 'image:x': '截图 · 技术面 · 1', 'image:y': '截图 · 技术面 · 2',
    'base:k': '合成资料库', 'file:f': '知识库文件 · 合成资料库 / 系统设计.txt',
    'file:r': '知识库文件 · r',
  });
  expect(names['record:older']).toContain('1970');
  expect(readOriginal).not.toHaveBeenCalled();
});

it('keeps names distinguishable for duplicate titles, deleted local items and a failed directory read', async () => {
  vi.spyOn(historyRepository, 'summaries').mockResolvedValue([
    { id: 'offer-aaaa1111', title: '面试', startedAt: 2, imageIds: [] },
    { id: 'offer-bbbb2222', title: '面试', startedAt: 1, imageIds: [] },
  ] as Awaited<ReturnType<typeof historyRepository.summaries>>);
  const keys = ['record:offer-aaaa1111', 'record:offer-bbbb2222', 'image:x12345678', 'image:y12345678'];
  expect(Object.values(await loadSyncItemNames(keys))).toEqual([
    '面试 · aaaa1111', '面试 · bbbb2222', '截图 · x12345678', '截图 · y12345678',
  ]);
  vi.mocked(historyRepository.summaries).mockRejectedValue(Error('temporary read failure'));
  useGeneralSettings.setState({ language: 'en' });
  expect(await loadSyncItemNames(['profile:main', 'record:foo'])).toEqual({
    'profile:main': 'Profile', 'record:foo': 'Interview history · foo',
  });
  expect(fallbackSyncItemName('resume:main')).toBe('Original résumé');
});
