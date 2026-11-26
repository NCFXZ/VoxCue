import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { expect, it, vi } from 'vitest';
import { localChats, openChatDatabase, transferStoredChats, type ChatSnapshot } from '../../../shared/src/services/chats';

it('stores grounded answer text and its timestamp without Google suggestions or search metadata', async () => {
  vi.stubGlobal('indexedDB', new IDBFactory());
  const now = Date.now();
  const snapshot: ChatSnapshot = {
    conversations: [{ id: 'grounded', title: '合成搜索', messages: [{
      id: 'google-answer', role: 'assistant', status: 'completed', content: '保留给用户查看的回答',
      googleSearchGroundedAt: now, googleSearchSuggestions: '<div>transient-google-widget</div>',
      sources: [{ title: 'transient-source', url: 'https://example.com/transient-source' }],
      reasoningSummary: 'transient-reasoning',
      activity: { kind: 'web_search', phase: 'searching', status: 'completed', detail: 'transient-query' },
      activities: [{ id: 'google-query', kind: 'web_search', phase: 'searching', status: 'completed', detail: 'transient-query-log' }],
    }] }], activeConversation: 'grounded', draft: '后续草稿', attachments: [], modelId: 'gemini-4-hydrogen',
    effort: 'auto', webSearch: true,
  };
  try {
    await localChats.write(snapshot);
    const restored = (await localChats.read())!;
    expect(restored.conversations[0].messages[0]).toMatchObject({
      content: '保留给用户查看的回答', googleSearchGroundedAt: now,
    });
    const db = await openChatDatabase();
    try {
      const request = db.transaction('state').objectStore('state').get(['conversation', 'grounded']);
      const row = await new Promise<unknown>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      expect(JSON.stringify(row)).not.toContain('transient-');
    } finally { db.close(); }
  } finally { vi.unstubAllGlobals(); }
});

it('prunes a marked grounded assistant after two years on read while preserving its user question and unmarked history', async () => {
  vi.stubGlobal('indexedDB', new IDBFactory());
  const clock = vi.spyOn(Date, 'now');
  const created = 1_800_000_000_000;
  const lifetime = 730 * 24 * 60 * 60 * 1000;
  clock.mockReturnValue(created);
  const snapshot: ChatSnapshot = {
    conversations: [{ id: 'history', title: '合成历史', messages: [
      { id: 'question', role: 'user', content: '保留原问题' },
      { id: 'grounded-answer', role: 'assistant', content: 'expired-grounded-answer', googleSearchGroundedAt: created },
      { id: 'legacy-answer', role: 'assistant', content: '保留旧版普通回答' },
    ] }], activeConversation: 'history', draft: '保留草稿', attachments: [], modelId: 'test',
    effort: 'auto', webSearch: true,
  };
  try {
    await localChats.write(snapshot);
    clock.mockReturnValue(created + lifetime);
    expect((await localChats.read())?.conversations[0].messages).toHaveLength(3);
    clock.mockReturnValue(created + lifetime + 1);
    const restored = (await localChats.read())!;
    expect(restored.conversations[0].messages.map(message => message.id)).toEqual(['question', 'legacy-answer']);
    expect(restored.draft).toBe('保留草稿');
    const db = await openChatDatabase();
    try {
      expect(JSON.stringify(await transferStoredChats(db))).not.toContain('expired-grounded-answer');
    } finally { db.close(); }
  } finally {
    clock.mockRestore();
    vi.unstubAllGlobals();
  }
});

it('连续重载和迁移均保留尚未写入主目录的新会话、消息、附件和多行草稿', async () => {
  vi.stubGlobal('indexedDB', new IDBFactory());
  const view = new EventTarget();
  vi.stubGlobal('window', view);
  const base: ChatSnapshot = {
    activeConversation: 'first', conversations: [{ id: 'first', title: '原聊天', messages: [] }],
    attachments: [], draft: '', modelId: '', effort: 'auto', webSearch: true,
  };
  const file = new File(['resume contents'], 'resume.txt');
  const attachment = { id: 'draft-file', name: file.name, size: file.size, file };
  try {
    await localChats.write(base);
    let prior: ChatSnapshot | null = null;
    let next = base;
    const reload = () => ({ snapshot: next, previous: prior?.conversations });
    prior = (await localChats.read(reload))!;
    next = { ...prior, activeConversation: 'second', draft: '第一行\n第二行', attachments: [attachment],
      conversations: [...prior.conversations, { id: 'second', title: '新聊天', draft: '第一行\n第二行',
        attachments: [attachment], messages: [{ id: 'user', role: 'user', content: '保留消息' }] }] };
    view.dispatchEvent(new Event('pagehide'));
    prior = (await localChats.read(reload))!;
    expect(await (await localChats.readFile(prior.attachments[0])).text()).toBe('resume contents');
    next = { ...prior, activeConversation: 'first', draft: '', attachments: [],
      conversations: [{ ...prior.conversations[0], draft: '' }, prior.conversations[1]] };
    view.dispatchEvent(new Event('pagehide'));
    const db = await openChatDatabase();
    try {
      const transfer = await transferStoredChats(db);
      expect(transfer?.conversations[1]).toMatchObject({
        id: 'second', draft: '第一行\n第二行', messages: [{ content: '保留消息' }], attachments: [{ id: 'draft-file' }],
      });
    } finally { db.close(); }
    prior = (await localChats.read())!;
    await localChats.write(prior, prior.conversations);
    expect((await localChats.read())?.conversations[1]).toMatchObject({
      draft: '第一行\n第二行', messages: [{ content: '保留消息' }], attachments: [{ name: 'resume.txt' }],
    });
  } finally {
    view.dispatchEvent(new Event('pagehide'));
    vi.unstubAllGlobals();
  }
});

it('retires an older write before its directory requests resolve and commits the newest messages, draft and originals', async () => {
  vi.stubGlobal('indexedDB', new IDBFactory());
  const view = new EventTarget();
  vi.stubGlobal('window', view);
  const first = new File(['retained original'], 'first.txt');
  const original = { id: 'retained', name: first.name, size: first.size, file: first };
  const base: ChatSnapshot = {
    activeConversation: 'active', draft: 'old', attachments: [original], modelId: '', effort: 'auto', webSearch: true,
    conversations: [
      { id: 'active', title: 'Synthetic chat', draft: 'old', attachments: [original], messages: [] },
      { id: 'history', title: 'Unchanged history', messages: [{ id: 'history-message', role: 'user', content: 'Retain unchanged history' }] },
    ],
  };
  const get = IDBObjectStore.prototype.get;
  const reads = vi.spyOn(IDBObjectStore.prototype, 'get');
  try {
    await localChats.write(base);
    let latest = base, previous: ChatSnapshot['conversations'];
    const restored = (await localChats.read(() => ({ snapshot: latest, previous, writing: true })))!;
    previous = restored.conversations;
    const second = new File(['new original'], 'second.txt');
    const added = { id: 'added', name: second.name, size: second.size, file: second };
    const attachments = [...restored.attachments, added];
    latest = { ...restored, draft: 'new\nlatest', attachments, conversations: restored.conversations.map(row => row.id !== 'active' ? row : ({
      ...row, draft: 'new\nlatest', attachments, messages: [{ id: 'new-message', role: 'user', content: 'Retain newest message' }],
    })) };
    let directoryRead = false;
    reads.mockImplementation(function(key) {
      const request = get.call(this, key);
      if (this.name === 'state' && key === 'current')
        request.addEventListener('success', () => { directoryRead = true; });
      return request;
    });
    const older = localChats.write(restored, restored.conversations).then(() => undefined, error => error);
    expect(directoryRead).toBe(false);
    view.dispatchEvent(new Event('pagehide'));
    expect(await older).toMatchObject({ cause: { name: 'AbortError' } });
    const db = await openChatDatabase();
    try {
      const request = db.transaction('state').objectStore('state').get('reload-checkpoint-v1');
      const checkpoint = await new Promise<{ conversations: unknown[] }>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      expect(checkpoint.conversations[1]).toBe('history');
    } finally { db.close(); }
    const recovered = (await localChats.read())!;
    expect(recovered.draft).toBe('new\nlatest');
    expect(recovered.conversations[0]).toMatchObject({ draft: 'new\nlatest', messages: [{ id: 'new-message' }] });
    expect(recovered.conversations[1].messages).toEqual(base.conversations[1].messages);
    expect(await Promise.all(recovered.attachments.map(async item => (await localChats.readFile(item)).text())))
      .toEqual(['retained original', 'new original']);
  } finally {
    reads.mockRestore();
    view.dispatchEvent(new Event('pagehide'));
    vi.unstubAllGlobals();
  }
});

it.each(['committing', 'finished'])('checkpoints rows and originals when an older %s write has changed the previous base', async phase => {
  vi.stubGlobal('indexedDB', new IDBFactory());
  const view = new EventTarget();
  vi.stubGlobal('window', view);
  const file = new File(['restore removed original'], 'restore.txt');
  const original = { id: 'restore-original', name: file.name, size: file.size, file };
  const base: ChatSnapshot = {
    activeConversation: 'restore', draft: 'Restore this draft', attachments: [original], modelId: '', effort: 'auto', webSearch: true,
    conversations: [
      { id: 'restore', title: 'Restore this row', draft: 'Restore this draft', attachments: [original],
        messages: [{ id: 'restore-message', role: 'user', content: 'Restore this message' }] },
      { id: 'other', title: 'Other row', messages: [] },
    ],
  };
  const put = IDBObjectStore.prototype.put;
  const puts = vi.spyOn(IDBObjectStore.prototype, 'put');
  try {
    await localChats.write(base);
    let latest = base;
    const restored = (await localChats.read(() => ({ snapshot: latest, previous: latest.conversations, writing: true })))!;
    latest = restored;
    let retired = false;
    puts.mockImplementation(function(value, key) {
      const request = put.call(this, value, key);
      if (this.name === 'state' && key === 'current' && !retired) {
        const tx = this.transaction;
        const retire = () => {
          retired = true;
          if (phase === 'committing') tx.commit();
          view.dispatchEvent(new Event('pagehide'));
        };
        if (phase === 'committing') request.addEventListener('success', retire, { once: true });
        else tx.addEventListener('complete', retire, { once: true });
      }
      return request;
    });
    await localChats.write({ ...restored, activeConversation: 'other', draft: 'Superseded draft', attachments: [],
      conversations: restored.conversations.filter(row => row.id !== 'restore') }, restored.conversations);
    expect(retired).toBe(true);
    const recovered = (await localChats.read())!;
    expect(recovered.activeConversation).toBe('restore');
    expect(recovered.draft).toBe('Restore this draft');
    expect(recovered.conversations[0]).toMatchObject({ id: 'restore',
      messages: [{ id: 'restore-message', content: 'Restore this message' }] });
    expect(await (await localChats.readFile(recovered.attachments[0])).text()).toBe('restore removed original');
  } finally {
    puts.mockRestore();
    view.dispatchEvent(new Event('pagehide'));
    vi.unstubAllGlobals();
  }
});

it.each(['before-directory-read', 'after-delete-request'])('reloading a metadata-only draft preserves its original against an older write at %s', async phase => {
  vi.stubGlobal('indexedDB', new IDBFactory());
  const view = new EventTarget();
  vi.stubGlobal('window', view);
  const file = new File(['my notes'], 'notes.txt');
  const attachment = { id: 'notes-file', name: file.name, size: file.size, file };
  const base: ChatSnapshot = { activeConversation: null, draft: '旧稿', attachments: [attachment],
    conversations: [], modelId: '', effort: 'auto', webSearch: true };
  const remove = IDBObjectStore.prototype.delete;
  const deletes = vi.spyOn(IDBObjectStore.prototype, 'delete');
  try {
    await localChats.write(base);
    let latest = base;
    const restored = (await localChats.read(() => ({ snapshot: latest, writing: true })))!;
    latest = { ...restored, draft: '刚粘贴的草稿' };
    expect(latest.attachments[0].file).toBeUndefined();
    deletes.mockImplementation(function (key) {
      const request = remove.call(this, key);
      if (phase === 'after-delete-request' && this.name === 'files' && key === attachment.id)
        view.dispatchEvent(new Event('pagehide'));
      return request;
    });
    const older = localChats.write({ ...base, attachments: [], draft: '' }).then(() => undefined, error => error);
    if (phase === 'before-directory-read') view.dispatchEvent(new Event('pagehide'));
    expect(await older).toMatchObject({ message: '聊天保存失败，请检查本机存储空间后重试。' });
    const recovered = (await localChats.read())!;
    expect(recovered.draft).toBe('刚粘贴的草稿');
    expect(await (await localChats.readFile(recovered.attachments[0])).text()).toBe('my notes');
  } finally {
    deletes.mockRestore();
    view.dispatchEvent(new Event('pagehide'));
    vi.unstubAllGlobals();
  }
});

it('editing a restored draft across reloads preserves every attachment reference in an unrelated damaged conversation', async () => {
  vi.stubGlobal('indexedDB', new IDBFactory());
  const view = new EventTarget();
  vi.stubGlobal('window', view);
  const attachment = (id: string) => {
    const file = new File([id], id + '.txt');
    return { id, name: file.name, size: file.size, file };
  };
  const lost = attachment('missing'), shared = attachment('shared'), replacement = attachment('new');
  const initial: ChatSnapshot = {
    activeConversation: 'current', draft: '旧稿', attachments: [shared], modelId: '', effort: 'auto', webSearch: true,
    conversations: [
      { id: 'current', title: 'Current', draft: '旧稿', messages: [], attachments: [shared] },
      { id: 'damaged', title: 'Damaged', messages: [{ id: 'old', role: 'user', content: '保留历史正文',
        options: { modelId: '', webSearch: true, attachments: [lost, shared] } }] },
    ],
  };
  try {
    await localChats.write(initial);
    const db = await openChatDatabase();
    const tx = db.transaction('files', 'readwrite');
    tx.objectStore('files').delete(lost.id);
    await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
    let previous: ChatSnapshot | null = null;
    let next = initial;
    const checkpoint = () => ({ snapshot: next, previous: previous?.conversations });
    for (const draft of ['清空附件', '重新添加']) {
      previous = (await localChats.read(checkpoint))!;
      const files = draft === '清空附件' ? [] : [replacement];
      next = { ...previous, draft, attachments: files, conversations: previous.conversations.map(c =>
        c.id === 'current' ? { ...c, draft, attachments: files } : c) };
      view.dispatchEvent(new Event('pagehide'));
    }
    const restored = (await localChats.read())!;
    await localChats.write(restored, restored.conversations);
    const migrated = await transferStoredChats(db);
    db.close();
    expect(migrated?.conversations[1]).toMatchObject({ id: 'damaged', messages: [
      { content: '保留历史正文', options: { attachments: [{ id: lost.id }, { id: shared.id }] } },
    ] });
    expect(await (await localChats.readFile(restored.attachments[0])).text()).toBe(replacement.id);
    const [absent, present] = restored.conversations[1].messages[0].options!.attachments;
    await expect(localChats.readFile(absent)).rejects.toThrow('聊天附件无法读取');
    expect(await (await localChats.readFile(present)).text()).toBe(shared.id);
  } finally {
    view.dispatchEvent(new Event('pagehide'));
    vi.unstubAllGlobals();
  }
});

it('旧版整份聊天在首次保存时完整转存，随后只写改动的会话', async () => {
  const conversations = ['old', 'edited', 'other'].map(id => ({
    id, title: id, messages: [{ id: id + '-m', role: 'user' as const, content: '保留 ' + id }],
  }));
  const db = await openChatDatabase();
  const tx = db.transaction('state', 'readwrite');
  tx.objectStore('state').put({ version: 1, conversations, attachments: [], draft: '',
    activeConversation: 'edited', modelId: 'test', effort: 'auto', webSearch: true }, 'current');
  await new Promise<void>((resolve) => { tx.oncomplete = () => resolve(); });
  db.close();
  const legacy = (await localChats.read())!;
  await localChats.write(legacy, legacy.conversations);
  const next = { ...legacy, conversations: legacy.conversations.map(c =>
    c.id === 'edited' ? { ...c, draft: 'new draft' } : c) };
  const put = vi.spyOn(IDBObjectStore.prototype, 'put');
  try {
    await localChats.write(next, legacy.conversations);
    expect(put.mock.calls.map(call => call[1])).toEqual([['conversation', 'edited'], 'current']);
    expect((await localChats.read())?.conversations).toEqual(next.conversations);
  } finally { put.mockRestore(); }
});

it('来源未核验提案及问题在确认前后均完整恢复', async () => {
  const message = {
    id: 'proposal',
    role: 'assistant' as const,
    status: 'completed' as const,
    content: '请审阅',
    profileBase: { name: '', background: '', jobDescription: '' },
    changes: {
      name: '未采用姓名',
      skills: [{ id: 's', title: '合成技能', content: '完整正文', sources: [] }],
    },
    selectedProfileFields: ['skills' as const],
    selectedSkillIds: ['s'],
    skillSourceIssues: [
      {
        skillId: 's',
        reason: 'source_unmatched' as const,
        sources: [{ title: '待核验', url: 'https://example.com/unreturned' }],
      },
    ],
  };
  const snapshot: ChatSnapshot = {
    conversations: [{ id: 'c', title: '来源审阅', messages: [message] }],
    activeConversation: 'c',
    draft: '',
    attachments: [],
    modelId: 'test',
    effort: 'low',
    webSearch: true,
  };
  for (const applied of [false, true]) {
    const savedMessage = {
      ...message,
      applied,
      ...(applied ? { appliedProfileFields: ['skills' as const], appliedSkillIds: ['s'] } : {}),
    };
    await localChats.write({
      ...snapshot,
      conversations: [{ ...snapshot.conversations[0], messages: [savedMessage] }],
    });
    expect((await localChats.read())?.conversations[0].messages[0]).toEqual({
      ...savedMessage,
      options: undefined,
    });
  }
});

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
            profileGeneration: { fields: ['background'], skillIndexes: [] },
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
  expect(await (await localChats.readFile(restored.conversations[0].messages[0].options!.attachments[0])).text()).toBe(
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
  expect(restored.conversations[0].messages[1].profileGeneration).toBeUndefined();
  const directoryDb = await openChatDatabase();
  try {
    const transaction = directoryDb.transaction('state', 'readwrite');
    const store = transaction.objectStore('state');
    const get = store.get('current');
    let original: unknown;
    get.onsuccess = () => {
      original = get.result;
      store.put({ ...get.result, index: [{ id: 'c', files: [] }] }, 'current');
    };
    await new Promise<void>(resolve => { transaction.oncomplete = () => resolve(); });
    await expect(localChats.read()).rejects.toThrow('聊天目录');
    const fix = directoryDb.transaction('state', 'readwrite');
    fix.objectStore('state').put(original, 'current');
    await new Promise<void>(resolve => { fix.oncomplete = () => resolve(); });
  } finally {
    directoryDb.close();
  }
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
