import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DesktopAPI } from '../electron/contracts/desktop';
import type { AIChatService, ChatCompletion } from '../electron/backend/chat/ports';
import { emptyUsage } from '../electron/contracts/chat';

const bridge = vi.hoisted(() => ({
  api: undefined as DesktopAPI | undefined,
  invoke: vi.fn(async (..._args: unknown[]) => undefined),
  send: vi.fn(),
  listeners: new Map<string, (...args: any[]) => void>(),
  handlers: new Map<string, (...args: any[]) => any>(),
}));
vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: (_name: string, value: DesktopAPI) => {
      bridge.api = value;
    },
  },
  ipcRenderer: {
    invoke: bridge.invoke,
    send: bridge.send,
    on: (channel: string, listener: (...args: any[]) => void) =>
      bridge.listeners.set(channel, listener),
    removeListener: (channel: string, listener: (...args: any[]) => void) => {
      if (bridge.listeners.get(channel) === listener) bridge.listeners.delete(channel);
    },
  },
  ipcMain: {
    handle: (channel: string, handler: (...args: any[]) => any) =>
      bridge.handlers.set(channel, handler),
  },
}));
import '../electron/preload';
import { registerHistoryIpc } from '../electron/ipc/history';
import { registerChatIpc } from '../electron/ipc/chat';
import { registerInterviewIpc } from '../electron/ipc/interview';
import { defaultInterviewConfiguration } from '../src/services/speech';

beforeEach(() => {
  bridge.invoke.mockClear();
  bridge.send.mockClear();
  bridge.listeners.clear();
  bridge.handlers.clear();
});

describe('完整面试问题通过既有 AI 接口', () => {
  function interviewSetup(
    demo = false,
    configuration = { ...defaultInterviewConfiguration(), aiEnabled: true, modelId: 'test' },
  ) {
    const state = setup();
    const lifecycle = registerInterviewIpc({
      chat: state.chat,
      isDemo: () => demo,
      configuration: () => configuration,
      requireInterview: (e) => {
        if (e.sender !== state.sender) throw Error('Unauthorized window');
      },
    });
    return { ...state, lifecycle };
  }
  const question = {
    id: 'interview-q',
    question: 'Explain ROS2 scheduling?',
    modelId: 'test',
  };
  it('校验权限和完整文本、Mock 不调用真实服务', async () => {
    const { call, chat } = interviewSetup(true);
    expect(await call('interview:answer', question)).toMatchObject({ ok: false });
    expect(chat.stream).not.toHaveBeenCalled();
    for (const v of [
      { ...question, question: '' },
      { ...question, question: 'x'.repeat(6001) },
      { ...question, id: '../bad' },
    ])
      await expect(call('interview:answer', v)).rejects.toThrow();
    await expect(
      bridge.handlers.get('interview:answer')!({ sender: {} }, question),
    ).rejects.toThrow('Unauthorized');
  });
  it('传递最终问题、取消旧问题、忽略旧事件、保留终稿校准', async () => {
    const { call, chat, sender, lifecycle } = interviewSetup();
    let old!: Parameters<AIChatService['stream']>[1];
    let signal!: AbortSignal;
    chat.stream.mockImplementationOnce(async (_r, emit, s) => {
      old = emit;
      signal = s;
      return new Promise((_resolve, reject) =>
        s.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), {
          once: true,
        }),
      );
    });
    const first = call('interview:answer', question);
    expect(signal.aborted).toBe(false);
    const second = call('interview:answer', {
      ...question,
      id: 'new-q',
      question: 'A complete next question',
    });
    expect(signal.aborted).toBe(true);
    old({ id: question.id, type: 'delta', text: 'late' });
    expect(sender.send).not.toHaveBeenCalled();
    expect(await first).toMatchObject({ ok: false });
    expect(await second).toMatchObject({ ok: true, answerText: 'answer' });
    expect(chat.stream.mock.calls[1][0].turns).toEqual([
      { role: 'user', content: 'A complete next question' },
    ]);
    lifecycle.cancel();
  });
  it('拒绝绕过本场确认去开启 AI 或切换模型', async () => {
    const { call, chat } = interviewSetup();
    await expect(call('interview:answer', { ...question, modelId: 'different' })).rejects.toThrow(
      '已锁定',
    );
    const mock = interviewSetup(false, defaultInterviewConfiguration());
    await expect(mock.call('interview:answer', question)).rejects.toThrow('已锁定');
    expect(chat.stream).not.toHaveBeenCalled();
    expect(mock.chat.stream).not.toHaveBeenCalled();
  });
  it('传递确认的思考强度，拒绝修改、缺失或伪造档位；自动不发送 effort', async () => {
    const configuration = {
      ...defaultInterviewConfiguration(),
      aiEnabled: true,
      modelId: 'test',
      effort: 'high' as const,
    };
    const { call, chat } = interviewSetup(false, configuration);
    for (const effort of [undefined, 'low', 'auto', 'invented'])
      await expect(call('interview:answer', { ...question, effort })).rejects.toThrow();
    expect(chat.stream).not.toHaveBeenCalled();
    expect(await call('interview:answer', { ...question, effort: 'high' })).toMatchObject({
      ok: true,
    });
    expect(chat.stream.mock.calls[0][0]).toMatchObject({ effort: 'high' });
    const auto = interviewSetup();
    await auto.call('interview:answer', question);
    expect(auto.chat.stream.mock.calls[0][0]).not.toHaveProperty('effort');
  });
});

describe('受控 preload 契约', () => {
  it('只暴露类型化桌面白名单，确认参数与语音输入频道一致', async () => {
    const api = bridge.api!;
    const calls: Array<[keyof DesktopAPI, string, unknown[]]> = [
      ['speech', 'speech:call', [{ op: 'status' }]],
      ['dictation', 'dictation:call', [{ op: 'start' }]],
      [
        'generateInterviewTitle',
        'history:generate-title',
        [{ recordId: 'r', modelId: 'test', questions: ['why'] }],
      ],
      ['exportHistory', 'history:export', [{ title: 'title', text: 'text' }]],
      ['interviewModels', 'interview:models', []],
      ['interviewAnswer', 'interview:answer', [{ id: 'q', question: 'why', modelId: 'model' }]],
      ['interviewCancel', 'interview:cancel', ['q']],
      ['systemAccent', 'appearance:accent', []],
      ['authSession', 'auth:session', []],
      ['signInWithChatGPT', 'auth:sign-in', []],
      ['cancelSignIn', 'auth:cancel', []],
      ['enterDemo', 'auth:demo', []],
      ['signOut', 'auth:sign-out', []],
      ['chatModels', 'chat:models', [true]],
      ['chatUsage', 'chat:usage', []],
      ['chatResetUsage', 'chat:usage-reset', []],
      ['chatSend', 'chat:send', [{ id: 'q' }]],
      ['chatCancel', 'chat:cancel', ['q']],
      ['chatOpenLink', 'chat:open-link', ['https://example.test/']],
      ['openInterview', 'interview:open', [defaultInterviewConfiguration()]],
      ['checkInterviewAccess', 'interview:check-access', [defaultInterviewConfiguration()]],
      ['openMicrophoneSettings', 'interview:microphone-settings', []],
      ['interviewState', 'interview:state', []],
      ['allowCapture', 'interview:capture', [false]],
      ['togglePin', 'interview:pin', []],
      ['toggleInterviewCollapse', 'interview:collapse', []],
      ['resizeInterview', 'interview:resize', [-1]],
    ];
    for (const [method, channel, args] of calls) {
      await (api[method] as (...args: unknown[]) => unknown)(...args);
      expect(bridge.invoke).toHaveBeenLastCalledWith(channel, ...args);
    }
    expect(Object.keys(api).sort()).toEqual(
      [
        ...calls.map(([method]) => method),
        'windowAction',
        'confirmInterviewEnd',
        'onInterviewTitle',
        'onChatEvent',
        'onSpeechEvent',
        'onDictationEvent',
        'onSystemAccent',
        'onInterviewEndRequested',
      ].sort(),
    );
    await api.chatModels();
    expect(bridge.invoke).toHaveBeenLastCalledWith('chat:models', false);
    api.windowAction('close');
    api.confirmInterviewEnd();
    expect(bridge.send.mock.calls).toEqual([['window:action', 'close'], ['interview:confirm-end']]);
    (api.windowAction as (value: string) => void)('arbitrary-command');
    expect(bridge.send).toHaveBeenCalledTimes(2);
  });
  it('事件仅传公开 payload，解除订阅释放对应 listener', () => {
    const callback = vi.fn();
    const stop = bridge.api!.onChatEvent(callback);
    const payload = { id: 'q', type: 'delta', text: 'answer' };
    bridge.listeners.get('chat:event')!({ sender: 'private-event' }, payload);
    expect(callback).toHaveBeenCalledExactlyOnceWith(payload);
    stop();
    expect(bridge.listeners.has('chat:event')).toBe(false);
    const accent = vi.fn();
    const end = vi.fn();
    const stopAccent = bridge.api!.onSystemAccent(accent);
    const stopEnd = bridge.api!.onInterviewEndRequested(end);
    bridge.listeners.get('appearance:accent-changed')!({}, '#123456');
    bridge.listeners.get('interview:request-end')!({ sender: 'private-event' });
    expect(accent).toHaveBeenCalledExactlyOnceWith('#123456');
    expect(end).toHaveBeenCalledExactlyOnceWith();
    stopAccent();
    stopEnd();
    expect(bridge.listeners.size).toBe(0);
  });
});

const request = {
  id: 'q',
  modelId: 'test',
  webSearch: false,
  instructions: '',
  turns: [{ role: 'user' as const, content: 'question' }],
};
const completion: ChatCompletion = { usage: null, sources: [], answerText: 'answer' };
function setup(demo = false) {
  const sender = { isDestroyed: () => false, send: vi.fn() };
  const event = { sender };
  const chat = {
    models: vi.fn(async () => [{ id: 'test', label: 'Test', description: '' }]),
    usage: vi.fn(async () => emptyUsage()),
    resetUsage: vi.fn(async () => emptyUsage()),
    stream: vi.fn<AIChatService['stream']>(async () => completion),
  };
  const openLink = vi.fn(async () => {});
  const lifecycle = registerChatIpc({
    chat,
    openLink,
    isDemo: () => demo,
    requireMain: (value) => {
      if (value.sender !== sender) throw new Error('Unauthorized window');
    },
  });
  const call = (channel: string, ...args: unknown[]) =>
    bridge.handlers.get(channel)!(event, ...args);
  return { chat, openLink, lifecycle, call, sender };
}
describe('聊天 IPC 与应用层边界', () => {
  it('未授权窗口不能访问任一聊天路由', async () => {
    const { chat, openLink } = setup();
    for (const channel of bridge.handlers.keys())
      await expect(
        Promise.resolve().then(() => bridge.handlers.get(channel)!({ sender: {} }, request)),
      ).rejects.toThrow('Unauthorized');
    expect(chat.stream).not.toHaveBeenCalled();
    expect(chat.models).not.toHaveBeenCalled();
    expect(openLink).not.toHaveBeenCalled();
  });
  it('内部测试会话返回原有明确状态，不调用真实 Provider', async () => {
    const { chat, call } = setup(true);
    expect(await call('chat:models')).toEqual({ ok: true, models: [] });
    expect(await call('chat:usage')).toEqual({ ok: true, usage: emptyUsage() });
    expect(await call('chat:usage-reset')).toEqual({ ok: true, usage: emptyUsage() });
    expect(await call('chat:send', request)).toMatchObject({ ok: false });
    for (const method of Object.values(chat)) expect(method).not.toHaveBeenCalled();
  });
  it('保持单请求、请求 ID 取消、重置用量互斥和关闭取消，旧事件不再传出', async () => {
    const { chat, call, lifecycle, sender } = setup();
    let pending!: { signal: AbortSignal; emit: Parameters<AIChatService['stream']>[1] };
    chat.stream.mockImplementationOnce(async (_request, emit, signal) => {
      pending = { signal, emit };
      return new Promise((_resolve, reject) =>
        signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), {
          once: true,
        }),
      );
    });
    const first = call('chat:send', request);
    expect(await call('chat:send', { ...request, id: 'other' })).toMatchObject({ ok: false });
    expect(await call('chat:usage-reset')).toMatchObject({ ok: false });
    expect(chat.resetUsage).not.toHaveBeenCalled();
    call('chat:cancel', 'other');
    expect(pending.signal.aborted).toBe(false);
    pending.emit({ id: request.id, type: 'delta', text: 'before' });
    expect(sender.send).toHaveBeenCalledTimes(1);
    call('chat:cancel', request.id);
    expect(pending.signal.aborted).toBe(true);
    pending.emit({ id: request.id, type: 'delta', text: 'late' });
    expect(sender.send).toHaveBeenCalledTimes(1);
    expect(await first).toMatchObject({ ok: false, error: { code: 'cancelled' } });
    expect(await call('chat:send', { ...request, id: 'next' })).toMatchObject({
      ok: true,
      answerText: 'answer',
    });
    chat.stream.mockImplementationOnce(
      async (_request, _emit, signal) =>
        new Promise((_resolve, reject) =>
          signal.addEventListener(
            'abort',
            () => reject(new DOMException('Aborted', 'AbortError')),
            { once: true },
          ),
        ),
    );
    const closing = call('chat:send', request);
    lifecycle.cancelActive();
    expect(await closing).toMatchObject({ ok: false, error: { code: 'cancelled' } });
  });
  it('非法请求不进入 Provider，失败释放请求槽并保持安全错误', async () => {
    const { chat, call } = setup();
    expect(await call('chat:send', { ...request, id: '../../invalid' })).toMatchObject({
      ok: false,
    });
    expect(chat.stream).not.toHaveBeenCalled();
    chat.stream.mockRejectedValueOnce(new Error('private-transport-token'));
    expect(JSON.stringify(await call('chat:send', request))).not.toContain(
      'private-transport-token',
    );
    expect(await call('chat:send', request)).toMatchObject({ ok: true });
  });
  it('拒绝已撤除功能的请求字段，普通请求保持原有行为', async () => {
    const { chat, call } = setup();
    expect(
      await call('chat:send', { ...request, retrieval: true, retrievalScope: ['job'] }),
    ).toMatchObject({ ok: false });
    expect(chat.stream).not.toHaveBeenCalled();
    expect(await call('chat:send', request)).toMatchObject({ ok: true });
  });
  it('仅打开已校验 HTTP(S) 来源链接', async () => {
    const { call, openLink } = setup();
    for (const url of [
      'file:///C:/private.txt',
      'javascript:alert(1)',
      'https://user:pass@example.test',
    ])
      await expect(call('chat:open-link', url)).rejects.toThrow('无效');
    expect(openLink).not.toHaveBeenCalled();
    await call('chat:open-link', 'https://example.test/source');
    expect(openLink).toHaveBeenCalledExactlyOnceWith('https://example.test/source');
  });
});

describe('记录标题与导出 IPC', () => {
  it('限制主窗口导出与已确认面试模型，返回取消结果而不导出', async () => {
    const mainFrame = {};
    const sender = { mainFrame };
    const event = { sender, senderFrame: mainFrame } as unknown as Electron.IpcMainInvokeEvent;
    const state = setup();
    const exportFile = vi.fn(async () => false);
    const emit = vi.fn();
    const jobs = registerHistoryIpc({
      chat: state.chat,
      emit,
      exportFile,
      requireMain: (e) => {
        if (e.sender !== event.sender) throw Error('Unauthorized');
      },
      authorizeTitle: (e) => {
        if (e.sender !== event.sender || e.senderFrame !== mainFrame) throw Error('Unauthorized');
        return 'test';
      },
    });
    const title = bridge.handlers.get('history:generate-title')!;
    const save = bridge.handlers.get('history:export')!;
    const value = { recordId: 'r', modelId: 'test', questions: ['有效问题'] };
    for (const payload of [
      { ...value, modelId: 'other' },
      { ...value, questions: [] },
    ])
      await expect(Promise.resolve().then(() => title(event, payload))).rejects.toThrow();
    await expect(Promise.resolve().then(() => title({ sender: {} }, value))).rejects.toThrow();
    expect(state.chat.stream).not.toHaveBeenCalled();
    for (const payload of [
      { title: 'x', text: 'x'.repeat(3000001) },
      { title: 4, text: 'x' },
      null,
    ])
      await expect(Promise.resolve().then(() => save(event, payload))).rejects.toThrow();
    await expect(
      Promise.resolve().then(() => save({ ...event, senderFrame: {} }, { title: 'x', text: 'x' })),
    ).rejects.toThrow();
    await expect(
      Promise.resolve().then(() => save({ sender: {} }, { title: 'x', text: 'x' })),
    ).rejects.toThrow();
    expect(exportFile).not.toHaveBeenCalled();
    expect(await save(event, { title: 'x', text: 'x' })).toBe(false);
    expect(exportFile).toHaveBeenCalledTimes(1);
    title(event, value);
    await vi.waitFor(() => expect(emit).toHaveBeenCalledTimes(1));
    jobs.cancelAll();
  });
});
