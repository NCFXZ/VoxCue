import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { usePreparation } from '../../../shared/src/stores/preparation';
import { useChatConnection } from '../../../shared/src/stores/chatConnection';
import { useGeneralSettings } from '../../src/stores/generalSettings';
import { localChats, openChatDatabase, transferStoredChats } from '../../src/services/chats';
import { recoverConfirmations } from '../../src/services/profileConfirmations';
import { streamChat, ChatRequestError } from '../../../shared/src/services/chat';
import { chatGPTProvider } from '../../../shared/electron/contracts/chat';
vi.mock('../../../shared/src/services/chat', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../shared/src/services/chat')>()),
  streamChat: vi.fn(),
}));
const base = { name: '旧姓名', role: '旧岗位', jobDescription: '旧 JD', background: '已有背景' };

it('shows replacement text and a growing proposal before recovery completes without saving it', async () => {
  const pending = Promise.withResolvers<Extract<Awaited<ReturnType<typeof streamChat>>, { ok: true }>>();
  const started = Promise.withResolvers<void>();
  vi.mocked(streamChat).mockImplementationOnce((request, emit) => {
    const { id } = request;
    emit({ id, type: 'delta', text: '旧草稿' });
    emit({ id, type: 'delta', text: '新回答', replace: true });
    emit({ id, type: 'delta', text: '正在改写' });
    emit({ id, type: 'profile-preview', preview: { background: '新摘要片段' },
      generation: { fields: ['background'], skillIndexes: [] } });
    started.resolve();
    return pending.promise;
  });
  const sending = usePreparation.getState().send('请缩短简历摘要');
  await started.promise;
  const reply = usePreparation.getState().messages.at(-1)!;
  expect(reply).toMatchObject({ content: '新回答正在改写', status: 'streaming', profilePreview: { background: '新摘要片段' } });
  expect(reply.changes).toBeUndefined();
  expect(usePreparation.getState().updateInfo({ background: '新摘要片段' }, reply.id)).toBe(false);
  expect(usePreparation.getState().info).toEqual(base);
  pending.resolve({ ok: true, answerText: '新回答正在改写', profileChanges: { background: '新摘要完整内容' }, usage: null, sources: [] });
  await sending;
  expect(usePreparation.getState().messages.at(-1)).toMatchObject({ status: 'completed', changes: { background: '新摘要完整内容' } });
  expect(usePreparation.getState().info).toEqual(base);
});

it('失败结果补齐先于IPC事件返回的正文和只读预览，不成为可保存提案', async () => {
  vi.mocked(streamChat).mockRejectedValueOnce(
    new ChatRequestError(
      { code: 'skill_sources_unverified', message: '来源校验失败，尚未保存。' },
      {
        answerText: '已收到的短说明',
        profilePreview: { skills: [{ title: '只读技能', content: '收到的公开内容' }] },
        sources: [{ title: '真实来源', url: 'https://example.com/' }],
      },
    ),
  );
  await usePreparation.getState().send('更新个人信息');
  const message = usePreparation.getState().messages.at(-1)!;
  expect(message).toMatchObject({
    status: 'failed',
    errorCode: 'skill_sources_unverified',
    content: '已收到的短说明',
    profilePreview: { skills: [{ title: '只读技能', content: '收到的公开内容' }] },
  });
  expect(message.changes).toBeUndefined();
  expect(usePreparation.getState().info).toEqual(base);
  expect(usePreparation.getState().updateInfo({}, message.id)).toBe(false);
});
it('clears streamed answer, preview and sources when terminal review withholds the response', async () => {
  const activity = { id: 'search', phase: 'searching', kind: 'web_search', status: 'completed' } as const;
  const sources = [{ title: '示例来源', url: 'https://example.com/' }];
  const modelId = 'deepseek-flash';
  useChatConnection.setState({ models: [{
    id: modelId, label: 'DeepSeek V4.1 Flash', description: '',
    provider: { id: 'deepseek', name: 'DeepSeek', dataRecipient: 'DeepSeek' },
  }] });
  usePreparation.setState({ modelId });
  vi.mocked(streamChat).mockImplementationOnce(async (request, emit) => {
    expect(request).toMatchObject({ modelId, webSearch: true, profile: { name: base.name } });
    const { id } = request;
    emit({ id, type: 'activity', activity });
    emit({ id, type: 'delta', text: '待审核正文' });
    emit({ id, type: 'reasoning-summary', text: '待审核摘要' });
    emit({ id, type: 'sources', sources });
    emit({ id, type: 'profile-preview', preview: { name: '待审核姓名' },
      generation: { fields: ['name'], skillIndexes: [] } });
    expect(usePreparation.getState().messages.at(-1)?.content).toBe('待审核正文');
    throw new ChatRequestError({
      code: 'content_filter', message: '模型服务拒绝了这次请求。', discardPartial: true,
    });
  });
  await usePreparation.getState().send('更新个人信息');
  const reply = usePreparation.getState().messages.at(-1)!;
  expect(reply).toMatchObject({ content: '', status: 'failed', errorCode: 'content_filter', activities: [activity] });
  expect(reply.reasoningSummary).toBeUndefined();
  expect(reply.profilePreview).toBeUndefined();
  expect(reply.profileGeneration).toBeUndefined();
  expect(reply.sources).toBeUndefined();
  expect(usePreparation.getState().info).toEqual(base);
});
beforeEach(() => {
  useGeneralSettings.setState({ language: 'zh-CN' });
  vi.stubGlobal('window', {});
  const values = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key),
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
  usePreparation.getState().reset();
  usePreparation.setState({
    conversations: [],
    viewing: true,
    info: { ...base },
    resume: null,
    selectedKnowledgeBaseId: null,
    skillsNeedUpdate: false,
    modelId: '',
  });
  useChatConnection.setState({
    live: true,
    models: [{ id: 'test', label: 'Test', description: '', provider: chatGPTProvider }],
  });
  vi.mocked(streamChat).mockImplementation(async (_request, emit) => {
    emit({ id: _request.id, type: 'delta', text: '请确认资料修改' });
    return {
      ok: true,
      usage: null,
      sources: [],
      profileChanges: { name: '新姓名', jobDescription: '新 JD' },
    };
  });
});
afterEach(() => {
  usePreparation.getState().reset();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
it.each(['affected', 'healthy-0'])('isolates a missing historical attachment with %s initially selected and retries after its original returns', async activeConversation => {
  vi.stubGlobal('indexedDB', new IDBFactory());
  const state = usePreparation.getState;
  usePreparation.setState({ chatsReady: false });
  const file = new File(['synthetic notes'], 'notes.txt');
  const attachment = { id: 'lost', name: file.name, size: file.size, file };
  const source = {
    id: 'affected', title: '旧会话', draft: '保留草稿',
    messages: [{ id: 'old-message', role: 'user' as const, content: '原始问题',
      options: { modelId: 'test', webSearch: true, attachments: [attachment] } }],
  };
  const others = Array.from({ length: 64 }, (_, i) => ({
    id: 'healthy-' + i, title: '正常会话', messages: [], attachments: [{ ...attachment, id: 'file-' + i }],
  }));
  const healthy = others[0];
  await localChats.write({ conversations: [source, ...others], activeConversation, draft: '', attachments: [],
    modelId: 'test', effort: 'auto', webSearch: true });
  const db = await openChatDatabase();
  const originals = (change: (store: IDBObjectStore) => void) => new Promise<void>((resolve, reject) => {
    const tx = db.transaction('files', 'readwrite');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    change(tx.objectStore('files'));
  });
  const gets = vi.spyOn(IDBObjectStore.prototype, 'get');
  const all = vi.spyOn(IDBObjectStore.prototype, 'getAll');
  try {
    await originals(store => store.delete(attachment.id));
    await state().restoreChats();
    if (activeConversation === healthy.id) {
      expect(state()).toMatchObject({ chatsReady: true, activeConversation: healthy.id, chatStorageError: null, error: null });
      state().selectConversation(source.id);
    }
    await vi.waitFor(() => expect(state().error).toContain('聊天附件无法读取'));
    expect(state()).toMatchObject({ chatsReady: true, chatStorageError: null, draft: '保留草稿' });
    expect(gets.mock.contexts.filter(s => s.name === 'files')).toHaveLength(0);
    expect(all.mock.contexts.filter(s => s.name === 'files')).toHaveLength(0);
    await state().send('继续');
    expect(state().messages).toHaveLength(1);
    expect(vi.mocked(streamChat)).not.toHaveBeenCalled();
    state().selectConversation(healthy.id);
    await state().send('正常提问');
    expect(state().messages.at(-1)?.status).toBe('completed');
    expect(vi.mocked(streamChat).mock.calls[0][0].turns[0].files?.[0].bytes)
      .toEqual(new Uint8Array(await file.arrayBuffer()));
    expect(gets.mock.calls.filter((_, i) => gets.mock.contexts[i].name === 'files').map(([key]) => key))
      .toEqual(['file-0']);
    expect(await state().flushChats()).toBe(true);
    const saved = await transferStoredChats(db);
    expect(saved?.conversations[0]).toMatchObject({ draft: '保留草稿', messages: [
      { content: '原始问题', options: { attachments: [{ id: attachment.id }] } },
    ] });
    state().selectConversation(source.id);
    state().selectConversation(healthy.id);
    await vi.waitFor(() => expect(state().error).toBeNull());
    state().selectConversation(source.id);
    await vi.waitFor(() => expect(state().error).toContain('聊天附件无法读取'));
    await originals(store => store.put({ id: attachment.id, blob: file, lastModified: file.lastModified }));
    state().selectConversation(source.id);
    await vi.waitFor(() => expect(state().error).toBeNull());
    await state().send('继续');
    expect(state().messages.at(-1)?.status).toBe('completed');
    expect(vi.mocked(streamChat)).toHaveBeenCalledTimes(2);
    state().deleteConversation(source.id);
    expect(await state().flushChats()).toBe(true);
    expect((await localChats.read())?.conversations.some(c => c.id === source.id)).toBe(false);
  } finally {
    all.mockRestore();
    gets.mockRestore();
    db.close();
    usePreparation.setState({ chatsReady: false });
  }
});
it('合并连续输入，在切换会话和关闭时立即保存最新内容', async () => {
  vi.useFakeTimers();
  const write = vi.spyOn(localChats, 'write').mockResolvedValue();
  try {
    usePreparation.setState({ chatsReady: true, conversations: [{ id: 'saved', title: '旧会话', messages: [] }] });
    usePreparation.getState().setDraft('a');
    usePreparation.getState().setDraft('ab');
    expect(write).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(400);
    expect(write).toHaveBeenCalledTimes(1);
    expect(write.mock.calls[0][0].draft).toBe('ab');
    usePreparation.getState().setDraft('abc');
    usePreparation.getState().selectConversation('saved');
    expect(write).toHaveBeenCalledTimes(2);
    expect(write.mock.calls[1][0].conversations.some(c => c.draft === 'abc')).toBe(true);
    usePreparation.getState().setDraft('关窗时的草稿');
    expect(await usePreparation.getState().flushChats()).toBe(true);
    expect(write.mock.calls.at(-1)![0].draft).toBe('关窗时的草稿');
    write.mockClear();
    usePreparation.getState().setModel('test');
    expect(write).toHaveBeenCalledTimes(1);
    await usePreparation.getState().flushChats();
    write.mockClear();
    usePreparation.getState().setEffort('auto');
    expect(write).toHaveBeenCalledTimes(1);
    await usePreparation.getState().flushChats();
  } finally {
    usePreparation.setState({ chatsReady: false });
    write.mockRestore();
    vi.useRealTimers();
  }
});
it('聊天写盘失败后重载，从本账号的确认记录恢复勾选项并写回原会话', async () => {
  const state = () => usePreparation.getState();
  const proposal = { id: 'proposal', role: 'assistant' as const, content: '合成提案',
    status: 'completed' as const, changes: { name: '新姓名', background: '新背景' }, profileBase: base };
  const other = { id: 'second', title: '另一会话', messages: [proposal] };
  const original = { id: 'first', title: '确认的会话', messages: [proposal] };
  usePreparation.setState({ chatsReady: true, activeConversation: original.id,
    conversations: [original, other], messages: original.messages });
  try {
    await state().flushChats();
    state().selectProfileFields(proposal.id, ['name']);
    const write = vi.spyOn(localChats, 'write').mockRejectedValue(Error('storage full'));
    expect(state().updateInfo({}, proposal.id)).toBe(true);
    expect(write).toHaveBeenCalled();
    expect(await state().flushChats()).toBe(false);
    expect((await localChats.read())!.conversations[0].messages[0].applied).toBeUndefined();
    write.mockRestore();
    // A fresh renderer reads the previously committed chat; the profile is already durable.
    usePreparation.setState({ chatsReady: false, activeConversation: null, conversations: [], messages: [] });
    await state().restoreChats();
    expect(state().messages[0]).toMatchObject({ applied: true, appliedProfileFields: ['name'] });
    expect(state().conversations.find(c => c.id === other.id)!.messages[0].applied).toBeUndefined();
    expect(await state().flushChats()).toBe(true);
    expect((await localChats.read())!.conversations[0].messages[0].applied).toBe(true);
    expect(localStorage.getItem('voxcue-pending-profile-confirmations-v1')).toBeUndefined();
  } finally {
    vi.restoreAllMocks();
    usePreparation.setState({ chatsReady: false });
  }
});
it('确认回执写入失败时保留旧资料，可直接重试', async () => {
  await usePreparation.getState().send('修改资料');
  const message = usePreparation.getState().messages.at(-1)!;
  const write = localStorage.setItem.bind(localStorage);
  const failing = vi.spyOn(localStorage, 'setItem').mockImplementation((key, value) => {
    if (key === 'voxcue-pending-profile-confirmations-v1') throw Error('quota');
    write(key, value);
  });
  try {
    expect(usePreparation.getState().updateInfo({}, message.id)).toBe(false);
    expect(localStorage.getItem('copilot-personal-info-v1')).toBeUndefined();
    expect(usePreparation.getState().messages.at(-1)?.applied).toBeUndefined();
  } finally {
    failing.mockRestore();
  }
  expect(usePreparation.getState().updateInfo({}, message.id)).toBe(true);
});
it('逐次截取确认期间的已落盘状态，恢复不误认未写资料，不复活被移除的消息', async () => {
  const state = () => usePreparation.getState();
  await state().send('修改姓名');
  const owner = state().conversations.find(c => c.id === state().activeConversation)!;
  const proposal = owner.messages.at(-1)!;
  const snapshots: Storage[] = [];
  const values = new Map<string, string>();
  const write = localStorage.setItem.bind(localStorage);
  const capture = vi.spyOn(localStorage, 'setItem').mockImplementation((key, value) => {
    write(key, value);
    values.set(key, value);
    const copy = new Map(values);
    snapshots.push({ getItem: (name: string) => copy.get(name) ?? null } as Storage);
  });
  try {
    expect(state().updateInfo({}, proposal.id)).toBe(true);
    expect(snapshots.map(storage => !!recoverConfirmations(storage, [owner])[0].messages.at(-1)?.applied))
      .toEqual([false, true, true]);
    expect(recoverConfirmations(snapshots[1], [{ ...owner, messages: [] }])[0].messages).toEqual([]);
    const stale = { ...proposal, dismissed: true };
    expect(recoverConfirmations(snapshots[1], [{ ...owner, messages: [stale] }])[0].messages[0]).toEqual(stale);
  } finally {
    capture.mockRestore();
  }
});
it('回执损坏时普通聊天仍可恢复、编辑并写盘', async () => {
  const state = () => usePreparation.getState();
  usePreparation.setState({ chatsReady: true, conversations: [] });
  try {
    state().setDraft('新草稿');
    expect(await state().flushChats()).toBe(true);
    localStorage.setItem('voxcue-pending-profile-confirmations-v1', '{');
    usePreparation.setState({ chatsReady: false, conversations: [], draft: '' });
    await state().restoreChats();
    expect(state().chatsReady).toBe(true);
    expect(state().draft).toBe('新草稿');
    state().setDraft('下一份草稿');
    expect(await state().flushChats()).toBe(true);
    expect((await localChats.read())!.draft).toBe('下一份草稿');
  } finally {
    usePreparation.setState({ chatsReady: false });
  }
});
it.each(['button', 'reject', 'stale'])(
  '来源未核验提案先保留，明确操作才保存，警告不丢失：%s',
  async (action) => {
    const skills = [
      { id: 'unverified', title: '待审阅技能', content: '完整保留的合成资料', sources: [] },
    ];
    const skillSourceIssues = [
      {
        skillId: 'unverified',
        reason: 'source_unmatched' as const,
        sources: [{ title: '未匹配', url: 'https://example.com/unmatched' }],
      },
    ];
    vi.mocked(streamChat).mockResolvedValueOnce({
      ok: true,
      usage: null,
      sources: [],
      answerText: '请审阅',
      profileChanges: { skills },
      skillSourceIssues,
    });
    await usePreparation.getState().send('更新技能');
    const message = usePreparation.getState().messages.at(-1)!;
    expect(message).toMatchObject({ status: 'completed', changes: { skills }, skillSourceIssues });
    expect(usePreparation.getState().info).toEqual(base);
    if (action === 'reject') {
      usePreparation.getState().dismissProfile(message.id);
    } else if (action === 'stale') {
      usePreparation.getState().updateInfo({ skills: [{ ...skills[0], content: '较新修改' }] });
      expect(usePreparation.getState().updateInfo({}, message.id)).toBe(false);
      expect(usePreparation.getState().info.skills?.[0].content).toBe('较新修改');
    } else {
      expect(usePreparation.getState().updateInfo({}, message.id)).toBe(true);
      expect(usePreparation.getState().info.skills).toEqual(skills);
      expect(
        usePreparation.getState().messages.find((entry) => entry.id === message.id)?.applied,
      ).toBe(true);
    }
    expect(
      usePreparation.getState().messages.find((entry) => entry.id === message.id)
        ?.skillSourceIssues,
    ).toEqual(skillSourceIssues);
    if (action === 'reject') expect(usePreparation.getState().info).toEqual(base);
  },
);
it('选择联网更新后立即收起提示，失败后也不重新弹出', async () => {
  usePreparation.setState({ skillsNeedUpdate: true });
  vi.mocked(streamChat).mockImplementationOnce(async () => {
    expect(usePreparation.getState().skillsNeedUpdate).toBe(false);
    throw Error('合成请求失败');
  });
  await usePreparation.getState().generateSkills();
  expect(usePreparation.getState().skillsNeedUpdate).toBe(false);
  expect(usePreparation.getState().messages.at(-1)?.status).toBe('failed');
});
describe('聊天附件更新需要同意', () => {
  it('流式预览只读，停止后拒绝迟到预览和不完整确认', async () => {
    let late!: Parameters<typeof streamChat>[1];
    let started!: () => void;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    vi.mocked(streamChat).mockImplementation(async (request, emit, signal) => {
      late = (event) => emit({ ...event, id: request.id });
      emit({ id: request.id, type: 'profile-preview', preview: { background: '实时部分摘要' } });
      const message = usePreparation.getState().messages.at(-1)!;
      expect(message.profilePreview).toEqual({ background: '实时部分摘要' });
      expect(usePreparation.getState().updateInfo({}, message.id)).toBe(false);
      started();
      await new Promise<void>((_resolve, reject) =>
        signal.addEventListener('abort', () => reject(new DOMException('stopped', 'AbortError')), {
          once: true,
        }),
      );
      return { ok: true, usage: null, sources: [] };
    });
    const request = usePreparation.getState().send('更新我的简历');
    await ready;
    usePreparation.getState().stop();
    await request;
    late({ id: 'late', type: 'profile-preview', preview: { background: '迟到内容' } });
    expect(usePreparation.getState().messages.at(-1)?.profilePreview?.background).toBe(
      '实时部分摘要',
    );
    expect(usePreparation.getState().info.background).toBe(base.background);
  });
  it('回答采用服务返回的实际来源，后续切换模型不会改写已完成回复', async () => {
    const provider = { id: 'other', name: 'Other', dataRecipient: 'Other Company' };
    vi.mocked(streamChat).mockResolvedValue({
      ok: true,
      usage: null,
      sources: [],
      answerText: '合成回答',
      provider,
    });
    await usePreparation.getState().send('你好');
    expect(usePreparation.getState().messages.at(-1)?.provider).toEqual(provider);
    useChatConnection.setState({
      models: [{ id: 'new', label: '新模型', description: '', provider: chatGPTProvider }],
    });
    usePreparation.getState().setModel('new');
    expect(usePreparation.getState().messages.at(-1)?.provider).toEqual(provider);
  });
  it('目录刷新保留有效选择，模型下架后必须重新选定才发送', async () => {
    const current = { id: 'test', label: 'Renamed', description: '' };
    const next = { id: 'future', label: 'Future', description: '' };
    useChatConnection.setState({ models: [next, current] });
    expect(usePreparation.getState().modelId).toBe(current.id);
    useChatConnection.setState({ models: [next] });
    await usePreparation.getState().send('旧模型已下架');
    expect(usePreparation.getState().error).toContain('请重新选择模型');
    expect(vi.mocked(streamChat)).not.toHaveBeenCalled();
    usePreparation.getState().setModel(next.id);
    await usePreparation.getState().send('明确选择新模型');
    expect(vi.mocked(streamChat).mock.calls[0]?.[0]).toMatchObject({ modelId: next.id });
  });
  it('最终正文补齐尚未送达的 IPC 增量，完成后结束活动状态', async () => {
    vi.mocked(streamChat).mockImplementation(async (_request, emit) => {
      emit({ id: _request.id, type: 'activity', activity: { phase: 'searching' } });
      expect(usePreparation.getState().messages.at(-1)?.activity?.phase).toBe('searching');
      emit({ id: _request.id, type: 'delta', text: '前半段' });
      return { ok: true, usage: null, sources: [], answerText: '前半段和完整正文' };
    });
    await usePreparation.getState().send('你好');
    expect(usePreparation.getState().messages.at(-1)).toMatchObject({
      content: '前半段和完整正文',
      status: 'completed',
      provider: chatGPTProvider,
    });
    expect(usePreparation.getState().streaming).toBe(false);
  });
  it('冷启动时即使聊天仍在恢复，已保存的个人资料也可立即编辑', async () => {
    const saved = { ...base, name: '新姓名' };
    localStorage.setItem('copilot-personal-info-v1', JSON.stringify(saved));
    usePreparation.setState({ chatsReady: false, info: { name: '', background: '', jobDescription: '' } });
    let release!: () => void;
    const pending = new Promise<null>((resolve) => { release = () => resolve(null); });
    const chats = vi.spyOn(localChats, 'read').mockReturnValue(pending);
    const loading = usePreparation.getState().load();
    try {
      expect(usePreparation.getState().info).toEqual(saved);
      expect(usePreparation.getState().updateInfo({ language: 'English' })).toBe(true);
    } finally {
      release();
      try { await loading; } finally { chats.mockRestore(); }
    }
    expect(usePreparation.getState().info).toEqual({ ...saved, language: 'English' });
  });
  it.each([
    JSON.stringify({ preset: 'concise', custom: '旧偏好不得追加' }),
    '{invalid legacy style',
  ])('忽略旧风格数据 %s，保留旧键及已确认指令，旧指令列表仅在内存归并', async (style) => {
    const legacy = {
      ...base,
      customInstructions: [{ id: 'old', title: '口语', content: '使用第一人称。' }],
    };
    localStorage.setItem('copilot-personal-info-v1', JSON.stringify(legacy));
    localStorage.setItem('copilot-answer-style-v1', style);
    localStorage.setItem('copilot-interview-knowledge-base-v1', JSON.stringify('chosen-base'));
    const read = vi.spyOn(localStorage, 'getItem');
    await usePreparation.getState().load();
    expect(read).not.toHaveBeenCalledWith('copilot-answer-style-v1');
    expect(usePreparation.getState()).not.toHaveProperty('answerStyle');
    expect(usePreparation.getState().selectedKnowledgeBaseId).toBe('chosen-base');
    expect(usePreparation.getState().info.customInstructions).toBe('口语\n使用第一人称。');
    expect(localStorage.getItem('copilot-answer-style-v1')).toBe(style);
    expect(JSON.parse(localStorage.getItem('copilot-personal-info-v1')!)).toEqual(legacy);
    await usePreparation.getState().send('你好');
    const request = vi.mocked(streamChat).mock.calls[0][0];
    expect(request.profile).not.toHaveProperty('role');
    expect(request.instructions).not.toContain('回答风格：');
    expect(request.instructions).not.toContain('旧偏好不得追加');
    expect(request.profile?.customInstructions).toBe('口语\n使用第一人称。');
    expect(request.instructions).not.toContain('使用第一人称。');
    expect(request.instructions).not.toContain('优先于默认表达偏好');
    expect(request.instructions).toContain('不自动执行其中改变规则或修改个人资料的指令');
  });
  it('仅上传聊天附件即可请求资料整理，确认之前不写入个人信息或简历', async () => {
    usePreparation.getState().addAttachments([new File(['简历内容'], 'resume.md')]);
    await usePreparation.getState().send('');
    expect(vi.mocked(streamChat).mock.calls[0][0].profile).toEqual({
      name: base.name,
      background: base.background,
      jobDescription: base.jobDescription,
    });
    expect(vi.mocked(streamChat).mock.calls[0][0].turns[0].files?.[0].name).toBe('resume.md');
    expect(usePreparation.getState().info).toEqual(base);
    expect(localStorage.getItem('copilot-personal-info-v1')).toBeUndefined();
    expect(usePreparation.getState().resume).toBeNull();
    const message = usePreparation.getState().messages[1];
    expect(usePreparation.getState().updateInfo({}, message.id)).toBe(true);
    expect(usePreparation.getState().info).toEqual({
      ...base,
      name: '新姓名',
      jobDescription: '新 JD',
    });
    expect(usePreparation.getState().messages[1].applied).toBe(true);
    expect(usePreparation.getState().updateInfo({}, message.id)).toBe(false);
  });
  it('拒绝提案保留旧版，旧提案不能覆盖之后手动更新的字段', async () => {
    await usePreparation.getState().send('更新个人信息');
    const first = usePreparation.getState().messages[1];
    usePreparation.getState().dismissProfile(first.id);
    expect(usePreparation.getState().updateInfo({}, first.id)).toBe(false);
    expect(usePreparation.getState().info).toEqual(base);
    await usePreparation.getState().send('更新个人信息');
    const second = usePreparation.getState().messages.at(-1)!;
    usePreparation.getState().updateInfo({ name: '手动改名' });
    expect(usePreparation.getState().updateInfo({}, second.id)).toBe(false);
    expect(usePreparation.getState().info.name).toBe('手动改名');
    expect(usePreparation.getState().error).toContain('较新的修改');
  });
  it('普通聊天也可读取并提出资料更新，失败回答不能应用提案', async () => {
    vi.mocked(streamChat).mockRejectedValueOnce(new Error('失败'));
    await usePreparation.getState().send('你好');
    expect(vi.mocked(streamChat).mock.calls[0][0].profile).toEqual({
      name: base.name,
      background: base.background,
      jobDescription: base.jobDescription,
    });
    const message = usePreparation.getState().messages[1];
    expect(message.status).toBe('failed');
    expect(usePreparation.getState().updateInfo({ name: '绕过' }, message.id)).toBe(false);
    expect(usePreparation.getState().info).toEqual(base);
  });
});

describe('资料提案保存与后续聊天', () => {
  it('新消息保留当前会话全部未处理提案的原资料，并持久化状态而不影响其他会话', async () => {
    vi.stubGlobal('indexedDB', new IDBFactory());
    const state = usePreparation.getState;
    usePreparation.setState({ chatsReady: true });
    try {
      await state().send('提出资料修改');
      const first = state().messages.at(-1)!;
      const second = { ...first, id: 'pending-clear', changes: { jobDescription: '' } };
      const applied = { ...first, id: 'already-saved', applied: true };
      const retained = { ...first, id: 'already-retained', dismissed: true };
      const otherProposal = { ...first, id: 'other-proposal' };
      usePreparation.setState({
        messages: [...state().messages, second, applied, retained],
        conversations: [...state().conversations, { id: 'other', title: '其他对话', messages: [otherProposal] }],
      });
      vi.mocked(streamChat).mockResolvedValueOnce({ ok: true, answerText: '你好', usage: null, sources: [] });
      await state().send('你好');

      for (const id of [first.id, second.id])
        expect(state().messages.find(message => message.id === id)).toMatchObject({ dismissed: true });
      expect(state().messages.find(message => message.id === applied.id)).toBe(applied);
      expect(state().messages.find(message => message.id === retained.id)).toBe(retained);
      expect(state().conversations.find(conversation => conversation.id === 'other')?.messages[0]).toBe(otherProposal);
      expect(state().info).toEqual(base);
      expect(localStorage.getItem('copilot-personal-info-v1')).toBeUndefined();
      const request = vi.mocked(streamChat).mock.calls.at(-1)![0];
      expect(request.turns.filter(turn => turn.role === 'assistant' && turn.content.includes('已拒绝这份提案并保留旧资料')))
        .toHaveLength(3);

      expect(await state().flushChats()).toBe(true);
      usePreparation.setState({ chatsReady: false, activeConversation: null, conversations: [], messages: [] });
      await state().restoreChats();
      expect(state().messages.find(message => message.id === first.id)?.dismissed).toBe(true);
      expect(state().messages.find(message => message.id === second.id)?.dismissed).toBe(true);
      expect(state().conversations.find(conversation => conversation.id === 'other')?.messages[0].dismissed).not.toBe(true);
      expect(state().updateInfo({}, first.id)).toBe(false);
      expect(state().info).toEqual(base);
    } finally {
      usePreparation.setState({ chatsReady: false });
    }
  });

  it('空消息或发送前校验失败不会处理旧提案', async () => {
    const state = usePreparation.getState;
    await state().send('提出资料修改');
    const messages = state().messages;
    await state().send('  ');
    usePreparation.setState({ modelId: 'unavailable' });
    await state().send('你好');
    expect(streamChat).toHaveBeenCalledTimes(1);
    expect(state().messages).toBe(messages);
    expect(state().messages.at(-1)?.dismissed).not.toBe(true);
    expect(state().info).toEqual(base);
  });

  it('重试现有回答不作为新消息处理此前提案', async () => {
    const state = usePreparation.getState;
    await state().send('提出资料修改');
    const proposal = state().messages.at(-1)!;
    usePreparation.setState({ messages: [...state().messages,
      { id: 'retry-user', role: 'user', content: '普通问题' },
      { id: 'retry-answer', role: 'assistant', content: '', status: 'failed' },
    ] });
    vi.mocked(streamChat).mockResolvedValueOnce({ ok: true, answerText: '重试成功', usage: null, sources: [] });
    await state().retry('retry-answer');
    expect(state().messages.find(message => message.id === proposal.id)?.dismissed).not.toBe(true);
    expect(vi.mocked(streamChat).mock.calls.at(-1)![0].turns.find(turn => turn.role === 'assistant')?.content)
      .toContain('这份提案尚未保存');
    expect(state().info).toEqual(base);
  });

  it('用 API 恢复后的完整提案替换旧预览，清空摘要仍须通过保存确认', async () => {
    const provider = { id: 'deepseek', name: 'DeepSeek', dataRecipient: 'DeepSeek' };
    const answerText = '职位描述摘要将清空，请确认后保存。';
    useChatConnection.setState({
      models: [{ id: 'deepseek-v4-pro', label: 'deepseek-v4-pro', description: '', provider }],
    });
    usePreparation.setState({ modelId: 'deepseek-v4-pro' });
    vi.mocked(streamChat).mockImplementationOnce(async ({ id }, emit) => {
      emit({ id, type: 'delta', text: '正在准备提案' });
      emit({ id, type: 'profile-preview', preview: { jobDescription: '未完成的内容' } });
      return {
        ok: true, provider, answerText, sources: [], usage: null,
        profileChanges: { jobDescription: '' },
      };
    });
    await usePreparation.getState().send('之前保存的岗位说明已经用不上了，请帮我清掉。');
    const proposal = usePreparation.getState().messages.at(-1)!;
    expect(proposal).toMatchObject({
      status: 'completed', content: answerText, changes: { jobDescription: '' },
    });
    expect(proposal.profilePreview).toBeUndefined();
    expect(usePreparation.getState().info).toEqual(base);
    expect(localStorage.getItem('copilot-personal-info-v1')).toBeUndefined();
    expect(usePreparation.getState().updateInfo({}, proposal.id)).toBe(true);
    expect(usePreparation.getState().info).toEqual({ ...base, jobDescription: '' });
  });

  it('无JD时按钮保存后普通聊天继续，并传递实际保存状态', async () => {
    usePreparation.setState({ info: { ...base, jobDescription: '' } });
    vi.mocked(streamChat).mockResolvedValueOnce({
      ok: true,
      usage: null,
      sources: [],
      answerText: '待确认简历',
      profileChanges: { background: '新简历摘要' },
    });
    await usePreparation.getState().send('更新简历');
    const proposal = usePreparation.getState().messages.at(-1)!;
    expect(usePreparation.getState().updateInfo({}, proposal.id)).toBe(true);
    vi.mocked(streamChat).mockResolvedValueOnce({
      ok: true,
      usage: null,
      sources: [],
      answerText: '普通问题可以回答',
    });
    await usePreparation.getState().send('讲讲面试准备');
    const next = vi.mocked(streamChat).mock.calls.at(-1)![0];
    expect(next.instructions).toContain('用户明确要求按该指令试写面试回答时除外');
    expect(next.turns.find((turn) => turn.role === 'assistant')?.content).toContain('已成功保存');
    expect(next.profileTask).toBeUndefined();

    expect(usePreparation.getState().info).toMatchObject({
      background: '新简历摘要',
      jobDescription: '',
    });
    expect(usePreparation.getState()).toMatchObject({
      streaming: false,
      error: null,
      skillsNeedUpdate: true,
    });
  });
  it.each(['确认', '拒绝', '确认更新', '确认保存', '只保存简历摘要', '只更新姓名'])(
    '发送聊天文字不保存资料，并自动保留旧提案原资料：%s',
    async (text) => {
      await usePreparation.getState().send('更新简历');
      const proposal = usePreparation.getState().messages.at(-1)!;
      vi.mocked(streamChat).mockResolvedValueOnce({
        ok: true,
        usage: null,
        sources: [],
        answerText: '请在提案中勾选并点击保存所选。',
      });
      await usePreparation.getState().send(text);
      expect(streamChat).toHaveBeenCalledTimes(2);
      expect(usePreparation.getState().info).toEqual(base);
      const unchanged = usePreparation.getState().messages.find((m) => m.id === proposal.id)!;
      expect(unchanged.applied).not.toBe(true);
      expect(unchanged.dismissed).toBe(true);
      expect(unchanged.selectedProfileFields).toEqual(proposal.selectedProfileFields);
      const next = vi.mocked(streamChat).mock.calls.at(-1)![0];
      expect(next.turns.find(turn => turn.role === 'assistant')?.content).toContain('已拒绝这份提案并保留旧资料，不再等待确认');
    },
  );
  it.each(['简历', '职位描述', '简历和职位描述'])(
    '补充%s使用正常资料请求并保留附件，不因“不生成技能”被阻止',
    async (missing) => {
      const info = {
        ...base,
        ...(missing.includes('简历') ? { background: '' } : {}),
        ...(missing.includes('职位描述') ? { jobDescription: '' } : {}),
      };
      usePreparation.setState({ info });
      usePreparation.getState().addAttachments([new File(['Synthetic facts'], 'context.txt')]);
      const prompt = `请根据以下内容整理${missing}摘要。简历保留个人经历、职责、项目、技术和成果；职位描述保留岗位定位、职责、任职要求及明确的优先条件。合并重复表述，保留事实和条件边界，不把岗位要求写成个人经历。仅补充缺少的摘要并展示待确认提案，不修改其他资料，也不生成技能。\n\n以下是${missing}内容：\n合成资料。`;
      await usePreparation.getState().send(prompt);
      expect(streamChat).toHaveBeenCalledTimes(1);
      const request = vi.mocked(streamChat).mock.calls[0][0];
      expect(request.profileTask).toBeUndefined();
      expect(request.webSearch).toBe(true);
      expect(request.turns.at(-1)?.content).toBe(prompt);
      expect(request.turns.at(-1)?.files?.[0].name).toBe('context.txt');
      expect(usePreparation.getState().info).toEqual(info);
      expect(usePreparation.getState().messages.at(-1)?.status).toBe('completed');
    },
  );
  it('处理用时记录实际完成/停止时间，不被后续请求改写', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1000);
    vi.mocked(streamChat).mockImplementationOnce(async () => {
      now.mockReturnValue(334000);
      return { ok: true, usage: null, sources: [], answerText: '完成' };
    });
    await usePreparation.getState().send('计时');
    const first = usePreparation.getState().messages.at(-1)!;
    expect(first.durationMs).toBe(333000);
    let ready!: () => void;
    const started = new Promise<void>((resolve) => {
      ready = resolve;
    });
    vi.mocked(streamChat).mockImplementationOnce(async (_request, _emit, signal) => {
      ready();
      await new Promise((_resolve, reject) =>
        signal.addEventListener('abort', () => reject(signal.reason)),
      );
      return { ok: true, usage: null, sources: [] };
    });
    const pending = usePreparation.getState().send('停止计时');
    await started;
    now.mockReturnValue(336000);
    usePreparation.getState().stop();
    now.mockReturnValue(341000); // Late cancellation settlement must not extend the stopped reply.
    await pending;
    expect(usePreparation.getState().messages.at(-1)).toMatchObject({
      status: 'stopped',
      durationMs: 2000,
    });
    expect(
      usePreparation.getState().messages.find((message) => message.id === first.id)?.durationMs,
    ).toBe(333000);
    now.mockRestore();
  });
  it('按钮保存完整提案后持久化所有字段，不再请求模型', async () => {
    await usePreparation.getState().send('更新个人信息');
    const calls = vi.mocked(streamChat).mock.calls.length;
    expect(
      usePreparation.getState().updateInfo({}, usePreparation.getState().messages.at(-1)!.id),
    ).toBe(true);
    expect(vi.mocked(streamChat)).toHaveBeenCalledTimes(calls);
    expect(usePreparation.getState().info).toEqual({
      ...base,
      name: '新姓名',
      jobDescription: '新 JD',
    });
    expect(JSON.parse(localStorage.getItem('copilot-personal-info-v1')!)).toEqual(
      usePreparation.getState().info,
    );
    expect(usePreparation.getState().messages[1].applied).toBe(true);
    expect(usePreparation.getState().streaming).toBe(false);
  });
  it('没有提案、拒绝过的提案和已手动修改的提案不能被保存覆盖', async () => {
    expect(usePreparation.getState().updateInfo({}, 'missing')).toBe(false);
    expect(streamChat).not.toHaveBeenCalled();
    await usePreparation.getState().send('更新个人信息');
    const dismissed = usePreparation.getState().messages.at(-1)!;
    usePreparation.getState().dismissProfile(dismissed.id);
    expect(usePreparation.getState().updateInfo({}, dismissed.id)).toBe(false);
    expect(usePreparation.getState().info).toEqual(base);
    await usePreparation.getState().send('更新个人信息');
    const stale = usePreparation.getState().messages.at(-1)!;
    usePreparation.getState().updateInfo({ name: '手动修改' });
    expect(usePreparation.getState().updateInfo({}, stale.id)).toBe(false);
    expect(usePreparation.getState().info.name).toBe('手动修改');
    expect(usePreparation.getState().error).toContain('较新的修改');
  });
});

describe('逐项勾选保存', () => {
  const changes = {
    name: '提案姓名',
    background: '提案简历',
    jobDescription: '提案JD',
    language: 'English',
    customInstructions: '提案指令',
    skills: [],
  };
  const prepare = async () => {
    vi.mocked(streamChat).mockResolvedValueOnce({
      ok: true,
      usage: null,
      sources: [],
      profileChanges: changes,
    });
    await usePreparation.getState().send('更新个人信息');
    return usePreparation.getState().messages.at(-1)!;
  };
  it('仅保存勾选字段，不采用调用者额外传入的字段值，历史记录反映实际保存范围', async () => {
    const message = await prepare();
    usePreparation.getState().selectProfileFields(message.id, ['background']);
    expect(usePreparation.getState().info).toEqual(base);
    expect(usePreparation.getState().updateInfo({ name: '未授权覆盖' }, message.id)).toBe(true);
    expect(usePreparation.getState().info).toEqual({ ...base, background: changes.background });
    expect(usePreparation.getState().messages.find((m) => m.id === message.id)).toMatchObject({
      applied: true,
      appliedProfileFields: ['background'],
      changes,
    });
    await usePreparation.getState().send('继续聊天');
    const request = vi.mocked(streamChat).mock.calls.at(-1)![0];
    expect(request.profile?.name).toBe(base.name);
    expect(request.turns.find((turn) => turn.content.includes('本机操作状态'))?.content).toContain(
      '已成功保存：简历摘要；其余字段保持原值',
    );
  });
  it('空选择不能保存，重新勾选后一次点击直接保存', async () => {
    const message = await prepare();
    usePreparation.getState().selectProfileFields(message.id, []);
    expect(usePreparation.getState().updateInfo({}, message.id)).toBe(false);
    expect(usePreparation.getState().info).toEqual(base);
    usePreparation.getState().selectProfileFields(message.id, ['jobDescription']);
    expect(usePreparation.getState().updateInfo({}, message.id)).toBe(true);
    expect(usePreparation.getState().info).toEqual({
      ...base,
      jobDescription: changes.jobDescription,
    });
    expect(streamChat).toHaveBeenCalledTimes(1);
  });
  it('清空职位描述的提案只在确认保存后生效', async () => {
    vi.mocked(streamChat).mockResolvedValueOnce({
      ok: true,
      usage: null,
      sources: [],
      profileChanges: { jobDescription: '' },
    });
    await usePreparation.getState().send('删除我的JD吧');
    const message = usePreparation.getState().messages.at(-1)!;
    expect(message).toMatchObject({ status: 'completed', changes: { jobDescription: '' } });
    expect(usePreparation.getState().info).toEqual(base);
    usePreparation.getState().selectProfileFields(message.id, ['jobDescription']);
    expect(usePreparation.getState().updateInfo({}, message.id)).toBe(true);
    expect(usePreparation.getState().info).toEqual({ ...base, jobDescription: '' });
    expect(streamChat).toHaveBeenCalledTimes(1);
  });
  it('未选字段的较新修改保留，所选字段及技能依赖摘要的冲突仍拒绝', async () => {
    const message = await prepare();
    usePreparation.getState().updateInfo({ name: '较新姓名' });
    usePreparation.getState().selectProfileFields(message.id, ['background']);
    expect(usePreparation.getState().updateInfo({}, message.id)).toBe(true);
    expect(usePreparation.getState().info).toEqual({
      ...base,
      name: '较新姓名',
      background: changes.background,
    });
    const second = await prepare();
    usePreparation.getState().updateInfo({ background: '较新简历' });
    usePreparation.getState().selectProfileFields(second.id, ['background']);
    expect(usePreparation.getState().updateInfo({}, second.id)).toBe(false);
    usePreparation.getState().selectProfileFields(second.id, ['skills']);
    expect(usePreparation.getState().updateInfo({}, second.id)).toBe(false);
    expect(usePreparation.getState().info.skills).toBeUndefined();
  });
  it.each(['failed', 'stopped', 'dismissed', 'absent'])('无效提案不能保存：%s', async (status) => {
    const message = await prepare();
    if (status === 'dismissed') usePreparation.getState().dismissProfile(message.id);
    else if (status === 'absent') usePreparation.setState({ messages: [] });
    else
      usePreparation.setState({
        messages: [{ ...message, status: status as 'failed' | 'stopped' }],
      });
    expect(usePreparation.getState().updateInfo({}, message.id)).toBe(false);
    expect(usePreparation.getState().info).toEqual(base);
    expect(streamChat).toHaveBeenCalledTimes(1);
  });
  it('忽略不在提案中的勾选；损坏的选择数据不能保存', async () => {
    await usePreparation.getState().send('更新资料');
    const message = usePreparation.getState().messages.at(-1)!;
    usePreparation.getState().selectProfileFields(message.id, ['language']);
    expect(usePreparation.getState().messages.at(-1)?.selectedProfileFields).toEqual(
      message.selectedProfileFields,
    );
    usePreparation.setState({ messages: [{ ...message, selectedProfileFields: ['language'] }] });
    expect(usePreparation.getState().updateInfo({}, message.id)).toBe(false);
    expect(usePreparation.getState().info).toEqual(base);
  });
  it('写入失败保留勾选和原资料，重试按钮直接保存', async () => {
    const message = await prepare();
    usePreparation.getState().selectProfileFields(message.id, ['background']);
    const write = vi.spyOn(localStorage, 'setItem').mockImplementationOnce(() => {
      throw Error('quota');
    });
    expect(usePreparation.getState().updateInfo({}, message.id)).toBe(false);
    expect(usePreparation.getState().info).toEqual(base);
    expect(usePreparation.getState().messages.find((m) => m.id === message.id)).toMatchObject({
      selectedProfileFields: ['background'],
    });
    expect(usePreparation.getState().messages.find((m) => m.id === message.id)?.applied).not.toBe(
      true,
    );
    write.mockRestore();
    expect(usePreparation.getState().updateInfo({}, message.id)).toBe(true);
    expect(usePreparation.getState().info).toEqual({ ...base, background: changes.background });
    expect(streamChat).toHaveBeenCalledTimes(1);
  });
});

describe('逐条技能选择保存', () => {
  const old = { id: 'old', title: 'C++', content: '原C++', sources: [] };
  const keep = {
    id: 'keep',
    title: 'Qt',
    content: '原Qt',
    sources: [{ title: '原始来源', url: 'https://example.com/qt' }],
  };
  const changed = { ...old, content: '新C++' };
  const added = { id: 'add', title: 'Rust', content: '新增Rust', sources: [] };
  const omitted = { id: 'omit', title: 'Python', content: '未选Python', sources: [] };
  const prepare = async (skills = [changed, added, omitted]) => {
    usePreparation.setState({ info: { ...base, skills: [old, keep] } });
    vi.mocked(streamChat).mockResolvedValueOnce({
      ok: true,
      usage: null,
      sources: [],
      profileChanges: { skills },
    });
    await usePreparation.getState().send('更新技能');
    return usePreparation.getState().messages.at(-1)!;
  };
  it('混合修改/新增只应用勾选项，遗漏的已有条目不被误删', async () => {
    const proposal = await prepare();
    usePreparation.getState().selectSkillIds(proposal.id, ['old', 'add']);
    expect(usePreparation.getState().updateInfo({}, proposal.id)).toBe(true);
    expect(usePreparation.getState().info.skills).toEqual([changed, keep, added]);
    expect(
      usePreparation.getState().messages.find((message) => message.id === proposal.id),
    ).toMatchObject({ appliedSkillIds: ['old', 'add'], appliedProfileFields: ['skills'] });
    expect(streamChat).toHaveBeenCalledTimes(1);
  });
  it('删除提案只有勾选的已有技能被删除，其余不清空', async () => {
    const proposal = await prepare([]);
    usePreparation.getState().selectSkillIds(proposal.id, ['old']);
    expect(usePreparation.getState().updateInfo({}, proposal.id)).toBe(true);
    expect(usePreparation.getState().info.skills).toEqual([keep]);
  });
  it('未选技能的较新修改及并发新增保持，所选冲突仍拒绝', async () => {
    const proposal = await prepare();
    const newer = { ...keep, content: '较新Qt' };
    usePreparation.getState().updateInfo({ skills: [old, newer, omitted] });
    usePreparation.getState().selectSkillIds(proposal.id, ['old', 'add']);
    expect(usePreparation.getState().updateInfo({}, proposal.id)).toBe(true);
    expect(usePreparation.getState().info.skills).toEqual([changed, newer, omitted, added]);
    const second = await prepare();
    usePreparation.getState().updateInfo({ skills: [{ ...old, content: '较新C++' }, keep] });
    usePreparation.getState().selectSkillIds(second.id, ['old']);
    expect(usePreparation.getState().updateInfo({}, second.id)).toBe(false);
    expect(usePreparation.getState().info.skills?.[0].content).toBe('较新C++');
  });
  it('取消所有技能后不能空保存，可同时仅保存其他字段', async () => {
    const proposal = await prepare();
    usePreparation.getState().selectSkillIds(proposal.id, []);
    expect(usePreparation.getState().updateInfo({}, proposal.id)).toBe(false);
    usePreparation.setState({
      messages: usePreparation
        .getState()
        .messages.map((message) =>
          message.id === proposal.id
            ? { ...message, changes: { ...message.changes, name: '仅保存姓名' } }
            : message,
        ),
    });
    usePreparation.getState().selectProfileFields(proposal.id, ['name']);
    expect(usePreparation.getState().updateInfo({}, proposal.id)).toBe(true);
    expect(usePreparation.getState().info.name).toBe('仅保存姓名');
    expect(usePreparation.getState().info.skills).toEqual([old, keep]);
  });
  it('选中新增但未删除已有技能导致超过十项时明确拒绝，不截断或偷删', async () => {
    const proposal = await prepare();
    const ten = Array.from({ length: 10 }, (_, index) => ({ ...old, id: 's' + index }));
    usePreparation.setState({
      info: { ...base, skills: ten },
      messages: [{ ...proposal, profileBase: { ...base, skills: ten } }],
    });
    usePreparation.getState().selectSkillIds(proposal.id, ['add']);
    expect(usePreparation.getState().updateInfo({}, proposal.id)).toBe(false);
    expect(usePreparation.getState().error).toContain('超过10项');
    expect(usePreparation.getState().info.skills).toEqual(ten);
  });
});

describe('摘要、指令与技能需要逐次确认', () => {
  it('旧主题任务重试不被整套摘要门槛拦截，旧关闭搜索快照不关闭新请求', async () => {
    usePreparation.setState({
      info: { ...base, jobDescription: '' },
      messages: [
        {
          id: 'legacy-user',
          role: 'user',
          content: 'Add a Kafka skill',
          options: {
            modelId: 'test',
            modelLabel: 'Test',
            live: true,
            webSearch: false,
            profileTask: 'skills',
            attachments: [],
          },
        },
        { id: 'legacy-answer', role: 'assistant', content: '', status: 'failed' },
      ],
    });
    vi.mocked(streamChat).mockResolvedValueOnce({
      ok: true,
      answerText: '请审阅',
      usage: null,
      sources: [],
    });
    await usePreparation.getState().retry('legacy-answer');
    const request = vi.mocked(streamChat).mock.calls[0][0];
    expect(request.profileTask).toBeUndefined();
    expect(request.webSearch).toBe(true);
    expect(request.turns.at(-1)?.content).toBe('Add a Kafka skill');
    expect(usePreparation.getState().info).toEqual({ ...base, jobDescription: '' });
  });
  it.each(['需要', '可以', 'yes', 'sí', 'Generate skills', '更新技能', '不要联网，只整理简历'])(
    '当前文本和上下文原样传递，不用语言关键词清除附件或强加任务：%s',
    async (prompt) => {
      usePreparation.setState({
        messages: [
          { id: 'user', role: 'user', content: '更新资料' },
          {
            id: 'assistant',
            role: 'assistant',
            content: '是否需要更新技能？',
            status: 'completed',
          },
        ],
      });
      usePreparation.getState().addAttachments([new File(['context'], 'context.txt')]);
      await usePreparation.getState().send(prompt);
      const request = vi.mocked(streamChat).mock.calls.at(-1)![0];
      expect(request.webSearch).toBe(true);
      expect(request.profileTask).toBeUndefined();
      expect(request.turns.at(-1)?.content).toBe(prompt);
      expect(request.turns.at(-1)?.files?.[0].name).toBe('context.txt');
      expect(request.turns.some((turn) => turn.content === '是否需要更新技能？')).toBe(true);
      expect(usePreparation.getState().info).toEqual(base);
    },
  );
  it.each([
    { background: '', jobDescription: '' },
    { background: '已确认简历', jobDescription: '' },
    { background: '', jobDescription: '已确认JD' },
  ])('指定主题可缺摘要，整套生成仍拒绝，提案确认前不保存：%j', async (summaries) => {
    usePreparation.setState({ info: { ...base, ...summaries } });
    await usePreparation.getState().generateSkills();
    expect(streamChat).not.toHaveBeenCalled();
    const skill = { id: 'kafka', title: 'Kafka', content: '合成检索资料', sources: [] };
    vi.mocked(streamChat).mockResolvedValueOnce({
      ok: true,
      usage: null,
      sources: [],
      profileChanges: { skills: [skill] },
    });
    await usePreparation.getState().send('帮我加一条Kafka');
    const request = vi.mocked(streamChat).mock.calls[0][0];
    expect(request).toMatchObject({
      webSearch: true,
      knowledgeBaseId: null,
      profile: summaries,
    });
    expect(usePreparation.getState().info.skills).toBeUndefined();
    const id = usePreparation.getState().messages.at(-1)!.id;
    expect(usePreparation.getState().updateInfo({}, id)).toBe(true);
    expect(usePreparation.getState().info.skills).toEqual([skill]);
    expect(usePreparation.getState().info).toMatchObject(summaries);
  });
  it('指定主题失败后可重试，否定请求与普通技术提问不启动技能研究', async () => {
    usePreparation.setState({ info: { ...base, background: '', jobDescription: '' } });
    vi.mocked(streamChat).mockRejectedValueOnce(new Error('合成搜索失败'));
    await usePreparation.getState().send('请新增Kafka技能');
    const failed = usePreparation.getState().messages.at(-1)!;
    expect(failed.status).toBe('failed');
    expect(failed.changes).toBeUndefined();
    await usePreparation.getState().retry(failed.id);
    expect(vi.mocked(streamChat).mock.calls.at(-1)![0]).toMatchObject({
      webSearch: true,
    });
    for (const prompt of ['不要生成Kafka技能', '解释Kafka消费顺序']) {
      await usePreparation.getState().send(prompt);
      expect(vi.mocked(streamChat).mock.calls.at(-1)![0].profileTask).toBeUndefined();
    }
  });
  it('摘要确认后主动提示技能更新，未确认或拒绝不改变原资料或调用技能生成', async () => {
    await usePreparation.getState().send('更新个人信息');
    expect(usePreparation.getState().skillsNeedUpdate).toBe(false);
    const id = usePreparation.getState().messages.at(-1)!.id;
    usePreparation.getState().updateInfo({}, id);
    expect(usePreparation.getState().skillsNeedUpdate).toBe(true);
    expect(streamChat).toHaveBeenCalledTimes(1);
    usePreparation.getState().dismissSkillUpdate();
    expect(usePreparation.getState().skillsNeedUpdate).toBe(false);
  });
  it('技能入口提供可选搜索，使用已确认摘要，保留未发送草稿和附件，摘要变动使结果过期', async () => {
    const skill = {
      id: 'skill',
      title: '技能',
      content: '已查询的专业解释',
      sources: [{ title: 'source', url: 'https://example.com/' }],
    };
    vi.mocked(streamChat).mockResolvedValueOnce({
      ok: true,
      usage: null,
      sources: skill.sources,
      profileChanges: { skills: [skill] },
    });
    usePreparation.getState().setDraft('尚未发送的私人草稿');
    usePreparation.getState().addAttachments([new File(['draft'], 'unrelated.txt')]);
    await usePreparation.getState().generateSkills();
    const request = vi.mocked(streamChat).mock.calls[0][0];
    expect(request).toMatchObject({
      webSearch: true,
      profileTask: 'skills',
      knowledgeBaseId: null,
      profile: {
        name: base.name,
        background: base.background,
        jobDescription: base.jobDescription,
      },
    });
    expect(request.turns.flatMap((turn) => turn.files ?? [])).toEqual([]);
    expect(request.turns.at(-1)?.content).toContain('作为技能更新提案');
    expect(request.turns.at(-1)?.content).toContain('按当前目标岗位重新评估整套面试技能');
    expect(request.turns.at(-1)?.content).toContain('删除与当前岗位无关的');
    expect(request.turns.at(-1)?.content).toContain('确认保存后生效');
    expect(request.turns.at(-1)?.content).not.toContain('保留未要求变更的已有条目');
    expect(request.turns.at(-1)?.content).toContain('不要把参考资料写成我已掌握的技能或经历');
    expect(request.turns.at(-1)?.content).not.toMatch(/120|220|3–5|附1–2/);
    expect(usePreparation.getState().messages.at(-1)?.changes?.skills?.[0].sources).toEqual(
      skill.sources,
    );
    expect(usePreparation.getState().draft).toBe('尚未发送的私人草稿');
    expect(usePreparation.getState().attachments).toHaveLength(1);
    expect(usePreparation.getState().info.skills).toBeUndefined();
    usePreparation.getState().updateInfo({ jobDescription: '新 JD' });
    expect(
      usePreparation.getState().updateInfo({}, usePreparation.getState().messages.at(-1)!.id),
    ).toBe(false);
    expect(usePreparation.getState().info.skills).toBeUndefined();
  });
  it('AI新增/删除指令只在确认后落盘，不能在提案中设置知识库', async () => {
    const instruction = { id: 'spoken', title: '自然口语', content: '使用第一人称直接回答。' };
    vi.mocked(streamChat).mockResolvedValueOnce({
      ok: true,
      usage: null,
      sources: [],
      profileChanges: { customInstructions: instruction.content },
    });
    await usePreparation.getState().send('以后说得自然一些');
    expect(usePreparation.getState().info.customInstructions).toBeUndefined();
    expect(
      usePreparation.getState().updateInfo({}, usePreparation.getState().messages.at(-1)!.id),
    ).toBe(true);
    expect(usePreparation.getState().info.customInstructions).toEqual(instruction.content);
    vi.mocked(streamChat).mockResolvedValueOnce({
      ok: true,
      usage: null,
      sources: [],
      profileChanges: { customInstructions: '' },
    });
    await usePreparation.getState().send('删除全部自定义指令');
    expect(usePreparation.getState().info.customInstructions).toBe(instruction.content);
    expect(
      usePreparation.getState().updateInfo({}, usePreparation.getState().messages.at(-1)!.id),
    ).toBe(true);
    expect(usePreparation.getState().info.customInstructions).toEqual('');
    vi.mocked(streamChat).mockResolvedValueOnce({
      ok: true,
      usage: null,
      sources: [],
      profileChanges: { knowledgeBaseId: 'other' } as any,
    });
    await usePreparation.getState().send('帮我选择知识库');
    expect(usePreparation.getState().messages.at(-1)?.status).toBe('failed');
    expect(usePreparation.getState().selectedKnowledgeBaseId).toBeNull();
  });
});

describe('附带文件的按钮保存不重复发起模型调用', () => {
  it('确认完成提案即保存，待发送文件保留供后续使用', async () => {
    await usePreparation.getState().send('更新个人信息');
    const calls = vi.mocked(streamChat).mock.calls.length;
    usePreparation.getState().addAttachments([new File(['新附件'], 'resume.md')]);
    expect(
      usePreparation.getState().updateInfo({}, usePreparation.getState().messages.at(-1)!.id),
    ).toBe(true);
    expect(vi.mocked(streamChat)).toHaveBeenCalledTimes(calls);
    expect(usePreparation.getState().info.name).toBe('新姓名');
    expect(usePreparation.getState().attachments).toHaveLength(1);
    expect(JSON.parse(localStorage.getItem('copilot-personal-info-v1')!).name).toBe('新姓名');
  });
});

it('切换对话和新对话不取消生成，增量与摘要仍归属原对话', async () => {
  let emit!: Parameters<typeof streamChat>[1];
  let finish!: (value: any) => void;
  let signal!: AbortSignal;
  vi.mocked(streamChat).mockImplementation(async (_request, callback, abort) => {
    emit = callback;
    signal = abort;
    return await new Promise((resolve) => {
      finish = resolve;
    });
  });
  const sending = usePreparation.getState().send('后台生成');
  await vi.waitFor(() => expect(emit).toBeTypeOf('function'));
  const owner = usePreparation.getState().activeConversation!;
  usePreparation.getState().reset(true);
  usePreparation.setState((state) => ({
    conversations: [...state.conversations, { id: 'other', title: '其他', messages: [] }],
  }));
  usePreparation.getState().selectConversation('other');
  expect(signal.aborted).toBe(false);
  emit({ id: 'event', type: 'reasoning-summary', text: '公开摘要' });
  emit({ id: 'event', type: 'delta', text: '后台正文' });
  expect(usePreparation.getState().messages).toEqual([]);
  finish({
    ok: true,
    usage: null,
    sources: [],
    answerText: '完整正文',
    reasoningSummary: '完整公开摘要',
  });
  await sending;
  expect(usePreparation.getState().streaming).toBe(false);
  expect(usePreparation.getState().conversations.find((c) => c.id === owner)?.unread).toBe(true);
  usePreparation.getState().selectConversation(owner);
  expect(usePreparation.getState().conversations.find((c) => c.id === owner)?.unread).toBe(false);
  expect(usePreparation.getState().messages.at(-1)).toMatchObject({
    content: '完整正文',
    reasoningSummary: '完整公开摘要',
    status: 'completed',
  });
});

it('离开页面后原对话完成会标为未读，回到可见页面清除；当前查看完成不标记', async () => {
  let finish!: (value: any) => void;
  vi.mocked(streamChat).mockImplementation(
    async () =>
      await new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const first = usePreparation.getState().send('隐藏页面');
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
  usePreparation.getState().setViewing(false);
  finish({ ok: true, usage: null, sources: [], answerText: '后台完成' });
  await first;
  expect(usePreparation.getState().conversations[0].unread).toBe(true);
  usePreparation.getState().setViewing(true);
  expect(usePreparation.getState().conversations[0].unread).toBe(false);
  finish = undefined as any;
  const second = usePreparation.getState().send('正在查看');
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
  finish({ ok: true, usage: null, sources: [], answerText: '前台完成' });
  await second;
  expect(usePreparation.getState().conversations[0].unread).toBe(false);
});

it('删除当前其他对话不会停止后台回复，完成后仍只标记原对话', async () => {
  let finish!: (value: any) => void;
  let signal!: AbortSignal;
  vi.mocked(streamChat).mockImplementation(async (_request, _emit, abort) => {
    signal = abort;
    return await new Promise((resolve) => {
      finish = resolve;
    });
  });
  const sending = usePreparation.getState().send('后台原对话');
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
  const owner = usePreparation.getState().activeConversation;
  usePreparation.setState((state) => ({
    conversations: [...state.conversations, { id: 'delete-other', title: '其他', messages: [] }],
  }));
  usePreparation.getState().selectConversation('delete-other');
  usePreparation.getState().deleteConversation('delete-other');
  expect(signal.aborted).toBe(false);
  finish({ ok: true, usage: null, sources: [], answerText: '继续完成' });
  await sending;
  expect(usePreparation.getState().messages).toEqual([]);
  expect(usePreparation.getState().conversations).toHaveLength(1);
  expect(usePreparation.getState().conversations[0]).toMatchObject({ id: owner, unread: true });
  expect(usePreparation.getState().conversations[0].messages.at(-1)?.content).toBe('继续完成');
});

it('失败与手动停止不会标成已完成未读', async () => {
  usePreparation.getState().setViewing(false);
  vi.mocked(streamChat).mockRejectedValueOnce(new Error('fixture failure'));
  await usePreparation.getState().send('失败');
  expect(usePreparation.getState().conversations[0].unread).not.toBe(true);
  vi.mocked(streamChat).mockImplementation(
    async (_request, _emit, signal) =>
      await new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('Stopped', 'AbortError')), {
          once: true,
        });
      }),
  );
  const sending = usePreparation.getState().send('停止');
  await vi.waitFor(() => expect(usePreparation.getState().streaming).toBe(true));
  usePreparation.getState().stop();
  await sending;
  expect(usePreparation.getState().conversations[0].unread).not.toBe(true);
});

it('并行回复按会话更新，停止后立即重试不会被旧回调覆盖', async () => {
  const state = usePreparation.getState;
  vi.stubGlobal('indexedDB', new IDBFactory());
  usePreparation.setState({ chatsReady: false });
  await state().restoreChats();
  const finish: Array<(text: string) => void> = [];
  const chat = vi.mocked(streamChat).mockImplementation(() => new Promise(resolve => {
    finish.push(answerText => resolve({ ok: true, sources: [], usage: null, answerText }));
  }));
  const first = state().send('会话甲的问题');
  await vi.waitFor(() => expect(finish).toHaveLength(1));
  const a = state().activeConversation!;
  state().reset(true);
  expect(state()).toMatchObject({ streaming: false, anyStreaming: true });
  const second = state().send('会话乙的问题');
  await vi.waitFor(() => expect(finish).toHaveLength(2));
  const b = state().activeConversation!;
  expect(chat.mock.calls.map(([request]) => request.turns.map(turn => turn.content)))
    .toEqual([['会话甲的问题'], ['会话乙的问题']]);
  state().setDraft('乙的下一条');
  state().selectConversation(a);
  state().setDraft('甲的下一条');
  chat.mock.calls[1][1]({ type: 'delta', id: chat.mock.calls[1][0].id, text: '乙的中间回复' });
  expect(state().messages.at(-1)?.content).toBe('');
  await state().send('同一会话重复发送');
  expect(chat).toHaveBeenCalledTimes(2);
  state().stop();
  expect(chat.mock.calls.map(([, , signal]) => signal.aborted)).toEqual([true, false]);
  expect(state()).toMatchObject({ streaming: false, anyStreaming: true, draft: '甲的下一条' });
  const retry = state().retry(state().messages.at(-1)!.id);
  await vi.waitFor(() => expect(finish).toHaveLength(3));
  chat.mock.calls[0][1]({ type: 'delta', id: chat.mock.calls[0][0].id, text: '迟到的旧回复' });
  finish[0]('旧终态');
  await first;
  finish[1]('乙完成');
  await second;
  expect(state()).toMatchObject({ activeConversation: a, streaming: true, anyStreaming: true });
  expect(state().messages.at(-1)).toMatchObject({ status: 'streaming', content: '' });
  expect(state().conversations.find(c => c.id === b)).toMatchObject({ unread: true, draft: '乙的下一条' });
  finish[2]('甲重试完成');
  await retry;
  expect(state()).toMatchObject({ streaming: false, anyStreaming: false, draft: '甲的下一条' });
  expect(state().messages.at(-1)?.content).toBe('甲重试完成');
  expect(await state().flushChats()).toBe(true);
  const restored = await localChats.read();
  expect(restored?.activeConversation).toBe(a);
  expect(restored?.conversations.map(c => [c.id, c.draft, c.messages.at(-1)?.content, c.unread === true])).toEqual([
    [a, '甲的下一条', '甲重试完成', false], [b, '乙的下一条', '乙完成', true],
  ]);
  state().selectConversation(b);
  expect(state().messages.at(-1)).toMatchObject({ status: 'completed', content: '乙完成' });
});

it('关闭所有会话会取消后台回复，并作废仍在校验附件的发送', async () => {
  const state = usePreparation.getState;
  const finish: Array<() => void> = [];
  const chat = vi.mocked(streamChat).mockImplementation(() => new Promise(resolve => {
    finish.push(() => resolve({ ok: true, sources: [], usage: null, answerText: '迟到的结果' }));
  }));
  const first = state().send('第一条');
  await vi.waitFor(() => expect(finish).toHaveLength(1));
  const firstId = state().activeConversation!;
  state().reset(true);
  const second = state().send('第二条');
  await vi.waitFor(() => expect(finish).toHaveLength(2));
  state().reset(true);
  const third = state().send('第三条');
  await vi.waitFor(() => expect(finish).toHaveLength(3));
  state().deleteConversation(firstId);
  expect(chat.mock.calls.map(([, , signal]) => signal.aborted)).toEqual([true, false, false]);
  state().reset(true);
  let release!: () => void;
  const check = vi.spyOn(localChats, 'checkFiles').mockReturnValueOnce(new Promise<void>(resolve => { release = resolve; }));
  try {
    const pending = state().send('仍在校验');
    state().stopAll();
    expect(chat.mock.calls.every(([, , signal]) => signal.aborted)).toBe(true);
    release();
    for (const done of finish) done();
    await Promise.all([first, second, third, pending]);
    expect(chat).toHaveBeenCalledTimes(3);
    expect(state()).toMatchObject({ streaming: false, anyStreaming: false, activeConversation: null });
    expect(state().conversations.map(c => c.messages.at(-1)?.status)).toEqual(['stopped', 'stopped']);
    expect(state().conversations.some(c => c.id === firstId)).toBe(false);
  } finally {
    check.mockRestore();
  }
});
