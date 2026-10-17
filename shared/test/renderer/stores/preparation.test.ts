import 'fake-indexeddb/auto';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { usePreparation } from '../../../../shared/src/stores/preparation';
import { useHistory } from '../../../../shared/src/stores/history';
import { useChatConnection } from '../../../../shared/src/stores/chatConnection';
import { chatModels } from '../../../../shared/src/services/chatOptions';
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
    usePreparation.setState({ conversations: [] });
    useChatConnection.setState({ live: false, models: [...chatModels] });
    useHistory.setState({ records: [], error: null });
  });
  afterEach(() => {
    usePreparation.getState().reset();
    vi.useRealTimers();
    vi.unstubAllGlobals();
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
    state.setWebSearch(true);
    state.addAttachments([new File(['项目经历'], 'project.txt')]);
    expect(usePreparation.getState().attachments).toHaveLength(1);
    const resume = usePreparation.getState().resume;
    const result = state.send('');
    state.setModel('mock-general');
    state.setWebSearch(false);
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
    const first = state.send('原始问题');
    await vi.advanceTimersByTimeAsync(100);
    state.stop();
    await first;
    const stopped = usePreparation.getState().messages.at(-1)!;
    state.setDraft('下一条问题');
    state.addAttachments([new File(['later'], 'later.txt')]);
    const retry = state.retry(stopped.id);
    await vi.advanceTimersByTimeAsync(20000);
    await retry;
    expect(usePreparation.getState().messages).toHaveLength(2);
    expect(usePreparation.getState().messages[0].content).toBe('原始问题');
    expect(usePreparation.getState().messages[1].status).toBe('completed');
    expect(usePreparation.getState().draft).toBe('下一条问题');
    expect(usePreparation.getState().attachments[0].name).toBe('later.txt');
  });
});
