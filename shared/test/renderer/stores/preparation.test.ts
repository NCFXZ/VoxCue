import 'fake-indexeddb/auto';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { usePreparation } from '../../../../shared/src/stores/preparation';
import { useHistory } from '../../../../shared/src/stores/history';
import { useChatConnection } from '../../../../shared/src/stores/chatConnection';
import { chatModels } from '../../../../shared/src/services/chatOptions';
import { localChats } from '../../../../shared/src/services/chats';
import type { ChatModel } from '../../../electron/contracts/chat';
const model = (id: string): ChatModel => ({
  id, label: id, description: '', reasoningEfforts: ['low', 'high'],
});
describe('准备聊天与个人信息', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
    });
    usePreparation.getState().reset();
    usePreparation.setState({ conversations: [], modelId: '' });
    useChatConnection.setState({ service: null, live: false, models: [...chatModels] });
    useHistory.setState({ records: [], error: null });
  });
  afterEach(() => {
    usePreparation.getState().reset();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
  it.each(['catalog first', 'history first'])('restores the matching legacy chat choice with %s', async order => {
    usePreparation.setState({ chatsReady: false, modelId: '', effort: 'auto' });
    useChatConnection.setState({ service: 'chatgpt', live: true, models: [] });
    const read = vi.spyOn(localChats, 'read').mockResolvedValue({
      conversations: [], activeConversation: null, draft: 'Unsaved question', attachments: [],
      modelId: 'legacy', effort: 'high', webSearch: true,
    });
    try {
      const restore = usePreparation.getState().restoreChats();
      const models = [model('default'), model('legacy')];
      if (order === 'catalog first') useChatConnection.setState({ models });
      await restore;
      if (order === 'history first') useChatConnection.setState({ models });
      expect(usePreparation.getState()).toMatchObject({ modelId: 'legacy', effort: 'high', draft: 'Unsaved question', error: null });
    } finally {
      read.mockRestore();
    }
  });
  it('retains service-specific choices with overlapping IDs and sends the selected service model and effort', async () => {
    usePreparation.setState({ chatsReady: true, modelId: '', effort: 'auto' });
    const chatgpt = [model('gpt-default'), model('shared')];
    const copilot = [model('copilot-default'), model('shared')];
    useChatConnection.setState({ service: 'chatgpt', live: true, models: chatgpt });
    usePreparation.getState().setModel('shared');
    usePreparation.getState().setEffort('high');
    useChatConnection.setState({ service: 'copilot', models: [] });
    useChatConnection.setState({ models: copilot });
    expect(usePreparation.getState()).toMatchObject({ modelId: 'copilot-default', effort: 'auto' });
    usePreparation.getState().setModel('shared');
    usePreparation.getState().setEffort('low');
    useChatConnection.setState({ service: 'chatgpt', models: chatgpt });
    expect(usePreparation.getState()).toMatchObject({ modelId: 'shared', effort: 'high' });
    useChatConnection.setState({ service: null, live: false, models: [] });
    useChatConnection.setState({ service: 'copilot', live: true, models: copilot });
    expect(usePreparation.getState()).toMatchObject({ modelId: 'shared', effort: 'low' });
    const chatSend = vi.fn().mockResolvedValue({ ok: true, answerText: 'Synthetic answer' });
    vi.stubGlobal('window', { desktop: {
      onChatEvent: () => () => {}, chatSend, chatAccountUsage: vi.fn().mockResolvedValue({ ok: true, usage: null }),
    } });
    await usePreparation.getState().send('Synthetic request');
    expect(chatSend).toHaveBeenCalledWith(expect.objectContaining({ modelId: 'shared', effort: 'low' }));
    useChatConnection.setState({ models: [model('copilot-default')] });
    expect(usePreparation.getState().error).toContain('所选模型当前不可用');
    await usePreparation.getState().send('Do not silently switch models');
    expect(chatSend).toHaveBeenCalledTimes(1);
    usePreparation.getState().setModel('copilot-default');
    expect(usePreparation.getState().error).toBeNull();
  });
  it('keeps a manual choice made before IndexedDB finishes restoring chats', async () => {
    usePreparation.setState({ chatsReady: false, modelId: '', effort: 'auto' });
    useChatConnection.setState({ service: 'copilot', live: true, models: [model('old'), model('chosen')] });
    const read = vi.spyOn(localChats, 'read').mockResolvedValue({
      conversations: [], activeConversation: null, draft: '', attachments: [],
      modelId: 'old', effort: 'low', webSearch: true,
    });
    try {
      const loading = usePreparation.getState().restoreChats();
      usePreparation.getState().setModel('chosen');
      usePreparation.getState().setEffort('high');
      await loading;
      expect(usePreparation.getState()).toMatchObject({ modelId: 'chosen', effort: 'high' });
    } finally {
      read.mockRestore();
    }
  });
  it('preserves automatic effort and explicit choices that the catalog supports', async () => {
    useChatConnection.setState({ models: [] });
    usePreparation.setState({ chatsReady: false });
    const read = vi.spyOn(localChats, 'read').mockResolvedValue({
      conversations: [], activeConversation: null, draft: '', attachments: [],
      modelId: 'reasoning', effort: 'auto', webSearch: true,
    });
    try {
      await usePreparation.getState().restoreChats();
      expect(usePreparation.getState().effort).toBe('auto');
      useChatConnection.setState({ models: [
        { id: 'reasoning', label: 'Reasoning', description: '', reasoningEfforts: ['medium', 'high'] },
        { id: 'plain', label: 'Plain', description: '' },
      ] });
      expect(usePreparation.getState().effort).toBe('auto');
      usePreparation.getState().setEffort('high');
      useChatConnection.setState({ models: [...useChatConnection.getState().models] });
      expect(usePreparation.getState().effort).toBe('high');
      usePreparation.getState().setModel('plain');
      expect(usePreparation.getState().effort).toBe('auto');
      usePreparation.getState().setModel('reasoning');
      expect(usePreparation.getState().effort).toBe('auto');
      usePreparation.getState().setEffort('max');
      expect(usePreparation.getState().effort).toBe('auto');
    } finally {
      read.mockRestore();
    }
  });
  it('omits an explicit effort at submission when automatic is selected', async () => {
    usePreparation.setState({ modelId: chatModels[0].id, effort: 'auto' });
    const response = usePreparation.getState().send('合成档位兼容检查');
    await vi.advanceTimersByTimeAsync(10000);
    await response;
    expect(usePreparation.getState().messages[0].options?.effort).toBeUndefined();
    expect(usePreparation.getState().effort).toBe('auto');
  });
  it('流式聊天不写入面试记录，资料更新需确认后保存', async () => {
    const result = usePreparation.getState().send('姓名：小林\n岗位：前端工程师');
    await vi.advanceTimersByTimeAsync(10000);
    await result;
    const reply = usePreparation.getState().messages[1];
    expect(reply.content.length).toBeGreaterThan(30);
    expect(reply.changes?.name).toBe('小林');
    expect(usePreparation.getState().info.name).not.toBe('小林');
    usePreparation.getState().updateInfo(reply.changes!, reply.id);
    expect(usePreparation.getState().info.name).toBe('小林');
    expect(usePreparation.getState().messages[1].applied).toBe(true);
    expect(useHistory.getState().records).toEqual([]);
  });
  it('新对话取消旧回复，但保留个人资料', async () => {
    usePreparation.getState().updateInfo({ jobDescription: '前端工程师' });
    const result = usePreparation.getState().send('帮我准备自我介绍');
    await vi.advanceTimersByTimeAsync(200);
    usePreparation.getState().reset();
    await result;
    await vi.advanceTimersByTimeAsync(10000);
    expect(usePreparation.getState().messages).toEqual([]);
    expect(usePreparation.getState().info.jobDescription).toBe('前端工程师');
  });
  it('附件独立于简历，发送时保留模型与搜索快照并清空待发送附件', async () => {
    const state = usePreparation.getState();
    state.setModel('mock-reasoning');
    state.addAttachments([new File(['项目经历'], 'project.txt')]);
    expect(usePreparation.getState().attachments).toHaveLength(1);
    const resume = usePreparation.getState().resume;
    const result = state.send('');
    state.setModel('mock-general');
    await vi.advanceTimersByTimeAsync(10000);
    await result;
    const messages = usePreparation.getState().messages;
    expect(messages[0].options?.modelId).toBe('mock-reasoning');
    expect(messages[0].options?.webSearch).toBe(true);
    expect(messages[0].options?.attachments[0].name).toBe('project.txt');
    expect(messages[1].content).toContain('尚未联网检索');
    expect(messages[1].content).toContain('尚未上传或解析');
    expect(usePreparation.getState().attachments).toEqual([]);
    expect(usePreparation.getState().resume).toBe(resume);
    expect(useHistory.getState().records).toEqual([]);
  });
  it('无效附件不会清空已有附件，同名替换，重置清空附件', () => {
    usePreparation.getState().addAttachments([new File(['内容'], 'notes.md')]);
    usePreparation.getState().addAttachments([new File(['替换'], 'notes.md')]);
    expect(usePreparation.getState().attachments).toHaveLength(1);
    usePreparation.getState().addAttachments([new File(['bad'], 'app.exe')]);
    expect(usePreparation.getState().error).toContain('不支持');
    expect(usePreparation.getState().attachments).toHaveLength(1);
    usePreparation.getState().reset();
    expect(usePreparation.getState().attachments).toEqual([]);
  });
  it('真实聊天在读取历史附件或发送 IPC 前拒绝超出上下文预算', async () => {
    const chatSend = vi.fn();
    vi.stubGlobal('window', {
      desktop: {
        chatSend,
        chatAccountUsage: vi.fn().mockResolvedValue({ ok: true, usage: null }),
      },
    });
    const files = ['old.txt', 'new.txt'].map((name) => {
      const file = new File(['synthetic'], name);
      Object.defineProperty(file, 'size', { value: 20 * 1024 ** 2 });
      const read = vi.spyOn(file, 'arrayBuffer');
      return { file, read, id: name, name, size: file.size };
    });
    usePreparation.setState({
      messages: [{
        id: 'old-message', role: 'user', content: '旧资料',
        options: { modelId: chatModels[0].id, webSearch: true, attachments: [files[0]] },
      }],
      attachments: [files[1]],
    });
    useChatConnection.setState({ live: true });
    await usePreparation.getState().send('合成上下文预算检查');
    expect(files.map(({ read }) => read.mock.calls.length)).toEqual([0, 0]);
    expect(chatSend).not.toHaveBeenCalled();
    expect(usePreparation.getState().messages.at(-1)?.status).toBe('failed');
    expect(usePreparation.getState().error).toContain('合计 32 MB');
    expect(usePreparation.getState().streaming).toBe(false);
  });
  it('切换对话保留消息，删除其他对话不影响当前消息或个人资料', async () => {
    const firstReply = usePreparation.getState().send('第一条对话');
    await vi.advanceTimersByTimeAsync(10000);
    await firstReply;
    const first = usePreparation.getState().activeConversation!;
    const firstMessages = usePreparation.getState().messages;
    usePreparation.getState().reset();
    const secondReply = usePreparation.getState().send('第二条对话');
    await vi.advanceTimersByTimeAsync(10000);
    await secondReply;
    const second = usePreparation.getState().activeConversation!;
    usePreparation.getState().selectConversation(first);
    expect(usePreparation.getState().messages).toEqual(firstMessages);
    const info = usePreparation.getState().info;
    const resume = usePreparation.getState().resume;
    usePreparation.getState().deleteConversation(second);
    expect(usePreparation.getState().activeConversation).toBe(first);
    expect(usePreparation.getState().messages).toEqual(firstMessages);
    expect(usePreparation.getState().conversations.map((item) => item.id)).toEqual([first]);
    expect(usePreparation.getState().info).toBe(info);
    expect(usePreparation.getState().resume).toBe(resume);
    expect(useHistory.getState().records).toEqual([]);
  });
  it('删除正在回复的当前对话会取消生成且不会被异步回复恢复', async () => {
    const result = usePreparation.getState().send('正在生成的对话');
    await vi.advanceTimersByTimeAsync(200);
    usePreparation.getState().deleteConversation(usePreparation.getState().activeConversation!);
    await result;
    await vi.advanceTimersByTimeAsync(10000);
    expect(usePreparation.getState().streaming).toBe(false);
    expect(usePreparation.getState().activeConversation).toBeNull();
    expect(usePreparation.getState().messages).toEqual([]);
    expect(usePreparation.getState().conversations).toEqual([]);
  });
  it('未发送的新草稿在新建或切换对话后可恢复，附件按对话归属', () => {
    const state = usePreparation.getState();
    state.setDraft('尚未发送的第一条草稿');
    state.addAttachments([new File(['a'], 'draft.txt')]);
    state.reset(true);
    const first = usePreparation.getState().conversations.at(-1)!.id;
    expect(usePreparation.getState().draft).toBe('');
    state.setDraft('第二条草稿');
    state.selectConversation(first);
    expect(usePreparation.getState().draft).toBe('尚未发送的第一条草稿');
    expect(usePreparation.getState().attachments[0].name).toBe('draft.txt');
    const second = usePreparation.getState().conversations.at(-1)!.id;
    state.selectConversation(second);
    expect(usePreparation.getState().draft).toBe('第二条草稿');
    expect(usePreparation.getState().attachments).toEqual([]);
  });
  it('停止后重试仅替换对应回答，保留待发送草稿与附件', async () => {
    const state = usePreparation.getState();
    const sentAt = Date.now();
    const first = state.send('原始问题');
    await vi.advanceTimersByTimeAsync(100);
    state.stop();
    await first;
    expect(usePreparation.getState().messages[0].startedAt).toBe(sentAt);
    const stopped = usePreparation.getState().messages.at(-1)!;
    state.setDraft('下一条问题');
    state.addAttachments([new File(['later'], 'later.txt')]);
    const retry = state.retry(stopped.id);
    await vi.advanceTimersByTimeAsync(20000);
    await retry;
    expect(usePreparation.getState().messages).toHaveLength(2);
    expect(usePreparation.getState().messages[0].content).toBe('原始问题');
    expect(usePreparation.getState().messages[0].startedAt).toBe(sentAt);
    expect(usePreparation.getState().messages[1].startedAt).toBeGreaterThan(sentAt);
    expect(usePreparation.getState().messages[1].status).toBe('completed');
    expect(usePreparation.getState().draft).toBe('下一条问题');
    expect(usePreparation.getState().attachments[0].name).toBe('later.txt');
  });
});
