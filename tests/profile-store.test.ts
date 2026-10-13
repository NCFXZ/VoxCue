import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { usePreparation } from '../src/stores/preparation';
import { useChatConnection } from '../src/stores/chatConnection';
import { streamChat } from '../src/services/chat';
import { defaultAnswerStyle, validateAnswerStyle } from '../src/services/answerStyle';
vi.mock('../src/services/chat', () => ({ streamChat: vi.fn(), failureText: vi.fn() }));
const base = { name: '旧姓名', role: '旧岗位', jobDescription: '旧 JD', background: '已有背景' };
beforeEach(() => {
  vi.stubGlobal('window', {});
  const values = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key),
    setItem: (key: string, value: string) => values.set(key, value),
  });
  usePreparation.getState().reset();
  usePreparation.setState({
    conversations: [],
    viewing: true,
    info: { ...base },
    resume: null,
    answerStyle: { ...defaultAnswerStyle },
  });
  useChatConnection.setState({
    live: true,
    models: [{ id: 'test', label: 'Test', description: '' }],
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
describe('聊天附件更新需要同意', () => {
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
      provider: 'chatgpt',
    });
    expect(usePreparation.getState().streaming).toBe(false);
  });
  it('保存风格并发送实际指令，不改变个人资料；超长要求或存储失败不更新设置', async () => {
    const style = { preset: 'concise' as const, custom: '使用自然口语，第一人称' };
    expect(usePreparation.getState().updateAnswerStyle(style)).toBe(true);
    expect(JSON.parse(localStorage.getItem('copilot-answer-style-v1')!)).toEqual(style);
    await usePreparation.getState().send('你好');
    const request = vi.mocked(streamChat).mock.calls[0][0];
    expect(request.instructions).toContain('回答风格：简洁直接');
    expect(request.instructions).toContain(style.custom);
    expect(usePreparation.getState().info).toEqual(base);
    expect(() => validateAnswerStyle({ ...style, custom: 'a'.repeat(1201) })).toThrow();
    expect(() => validateAnswerStyle({ preset: 'unknown', custom: '' })).toThrow();
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('full');
    });
    expect(usePreparation.getState().updateAnswerStyle({ preset: 'detailed', custom: '' })).toBe(
      false,
    );
    expect(usePreparation.getState().answerStyle).toEqual(style);
  });
  it('仅上传聊天附件即可请求资料整理，确认之前不写入个人信息或简历', async () => {
    usePreparation.getState().addAttachments([new File(['简历内容'], 'resume.md')]);
    await usePreparation.getState().send('');
    expect(vi.mocked(streamChat).mock.calls[0][0].profile).toEqual(base);
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
  it('普通提问不启用资料提取，失败回答不能应用提案', async () => {
    vi.mocked(streamChat).mockRejectedValueOnce(new Error('失败'));
    await usePreparation.getState().send('你好');
    expect(vi.mocked(streamChat).mock.calls[0][0].profile).toBeUndefined();
    const message = usePreparation.getState().messages[1];
    expect(message.status).toBe('failed');
    expect(usePreparation.getState().updateInfo({ name: '绕过' }, message.id)).toBe(false);
    expect(usePreparation.getState().info).toEqual(base);
  });
});

describe('聊天文字确认实际保存', () => {
  it('确认最新完整提案后持久化所有字段，不再发送确认消息给模型', async () => {
    await usePreparation.getState().send('更新个人信息');
    const calls = vi.mocked(streamChat).mock.calls.length;
    await usePreparation.getState().send('确认更新');
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
  it('没有提案、拒绝过的提案和已手动修改的提案不能通过文字确认覆盖', async () => {
    await usePreparation.getState().send('确认更新');
    expect(usePreparation.getState().error).toContain('没有可确认');
    expect(streamChat).not.toHaveBeenCalled();
    await usePreparation.getState().send('更新个人信息');
    usePreparation.getState().dismissProfile(usePreparation.getState().messages.at(-1)!.id);
    await usePreparation.getState().send('确认更新');
    expect(usePreparation.getState().info).toEqual(base);
    await usePreparation.getState().send('更新个人信息');
    usePreparation.getState().updateInfo({ name: '手动修改' });
    await usePreparation.getState().send('确认更新');
    expect(usePreparation.getState().info.name).toBe('手动修改');
    expect(usePreparation.getState().error).toContain('较新的修改');
  });
});

describe('附带文件的确认不重复发起模型调用', () => {
  it('确认完成提案即保存，待发送文件保留供后续使用', async () => {
    await usePreparation.getState().send('更新个人信息');
    const calls = vi.mocked(streamChat).mock.calls.length;
    usePreparation.getState().addAttachments([new File(['新附件'], 'resume.md')]);
    await usePreparation.getState().send('确认更新');
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
