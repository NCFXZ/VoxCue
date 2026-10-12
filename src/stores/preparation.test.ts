import 'fake-indexeddb/auto';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { usePreparation } from './preparation';
import { useHistory } from './history';
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
    usePreparation.getState().updateInfo({ role: '前端工程师' });
    const result = usePreparation.getState().send('帮我准备自我介绍');
    await vi.advanceTimersByTimeAsync(200);
    usePreparation.getState().reset();
    await result;
    await vi.advanceTimersByTimeAsync(10000);
    expect(usePreparation.getState().messages).toEqual([]);
    expect(usePreparation.getState().info.role).toBe('前端工程师');
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
});
