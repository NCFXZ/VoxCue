import 'fake-indexeddb/auto';
import { expect, it, vi } from 'vitest';
import { localChats, type ChatSnapshot } from '../../../shared/src/services/chats';

it('聊天、草稿与附件恢复；同一附件只保存一次；删除仅回收聊天自有附件', async () => {
  const attachment = {
    id: 'chat-file',
    name: 'notes.md',
    size: 4,
    file: new File(['正文'], 'notes.md'),
  };
  const snapshot: ChatSnapshot = {
    conversations: [
      {
        id: 'c',
        title: '普通聊天',
        draft: '后续草稿',
        attachments: [attachment],
        messages: [
          {
            id: 'u',
            role: 'user',
            content: '问题',
            options: { modelId: 'test', webSearch: false, attachments: [attachment] },
          },
          {
            id: 'a',
            role: 'assistant',
            content: '部分回答',
            status: 'streaming',
            startedAt: 1000,
            durationMs: 333000,
            activities: [
              {
                id: 'search',
                kind: 'web_search',
                phase: 'searching',
                detail: 'official sources',
                status: 'completed',
              },
            ],
            profilePreview: { background: '未完成摘要' },
          },
        ],
      },
    ],
    activeConversation: 'c',
    draft: '后续草稿',
    attachments: [attachment],
    modelId: 'test',
    effort: 'low',
    webSearch: false,
  };
  const put = vi.spyOn(IDBObjectStore.prototype, 'put');
  await localChats.write(snapshot);
  await localChats.write({ ...snapshot, draft: '最新草稿' });
  expect(put.mock.contexts.filter((store) => store.name === 'files')).toHaveLength(1);
  const restored = (await localChats.read())!;
  expect(await restored.conversations[0].messages[0].options!.attachments[0].file.text()).toBe(
    '正文',
  );
  expect(restored.conversations[0].messages[1]).toMatchObject({
    status: 'stopped',
    profilePreview: { background: '未完成摘要' },
    durationMs: 333000,
    activities: [
      {
        id: 'search',
        kind: 'web_search',
        phase: 'searching',
        detail: 'official sources',
        status: 'completed',
      },
    ],
  });
  expect(restored.draft).toBe('最新草稿');
  // A failing metadata write aborts the whole transaction and leaves the last version.
  put.mockRestore();
  const nativePut = IDBObjectStore.prototype.put;
  const write = vi.spyOn(IDBObjectStore.prototype, 'put');
  write.mockImplementation(function (...args) {
    if (this.name === 'state') throw Error('quota');
    return nativePut.apply(this, args);
  });
  await expect(localChats.write({ ...snapshot, draft: '不可落盘' })).rejects.toThrow('保存失败');
  write.mockRestore();
  expect((await localChats.read())!.draft).toBe('最新草稿');
  await localChats.write({
    ...snapshot,
    conversations: [],
    attachments: [],
    draft: '',
    activeConversation: null,
  });
  expect((await localChats.read())!.conversations).toEqual([]);
  const db = await new Promise<IDBDatabase>((resolve) => {
    const req = indexedDB.open('voxcue-preparation-chats', 1);
    req.onsuccess = () => resolve(req.result);
  });
  const request = db.transaction('files').objectStore('files').count();
  expect(
    await new Promise((resolve) => {
      request.onsuccess = () => resolve(request.result);
    }),
  ).toBe(0);
  db.close();
});
