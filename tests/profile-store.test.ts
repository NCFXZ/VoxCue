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
