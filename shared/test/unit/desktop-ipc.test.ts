import { registerKnowledgeIpc } from '../../../shared/electron/ipc/knowledge';
import { registerUpdateIpc } from '../../../shared/electron/ipc/updates';
import { registerScreenCaptureIpc } from '../../../shared/electron/ipc/screenCapture';
import type { UpdateService } from '../../../shared/electron/backend/updates/service';
import type { KnowledgeCoordinator } from '../../../shared/electron/application/knowledge';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DesktopAPI } from '../../../shared/electron/contracts/desktop';
import type { AIChatService, ChatCompletion } from '../../../shared/electron/backend/chat/ports';
import { emptyUsage } from '../../../shared/electron/contracts/chat';

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
import '../../../shared/electron/preload';
import { registerHistoryIpc } from '../../../shared/electron/ipc/history';
import { registerChatIpc } from '../../../shared/electron/ipc/chat';
import { registerInterviewIpc } from '../../../shared/electron/ipc/interview';
import { InterviewContext } from '../../../shared/electron/application/interviewContext';
import { defaultInterviewConfiguration } from '../../../shared/src/services/speech';

beforeEach(() => {
  bridge.invoke.mockClear();
  bridge.send.mockClear();
  bridge.listeners.clear();
  bridge.handlers.clear();
});

describe('更新 IPC 白名单', () => {
  it('只接受主窗口主 frame 的固定操作；桥接订阅可释放', async () => {
    const sender = { mainFrame: {} };
    const service = {
      state: vi.fn(() => ({ phase: 'idle' })),
      check: vi.fn(),
      download: vi.fn(),
      install: vi.fn(),
    };
    registerUpdateIpc(service as unknown as UpdateService, (event) => {
      if (event.sender !== sender) throw Error('Unauthorized window');
    });
    const handle = bridge.handlers.get('updates:call')!;
    const event = { sender, senderFrame: sender.mainFrame };
    for (const value of [
      null,
      [],
      {},
      { op: 'execute' },
      { op: 'install', path: 'C:/private' },
      { op: 'check', url: 'https://example.com' },
    ])
      expect(() => handle(event, value)).toThrow();
    expect(() => handle({ sender, senderFrame: {} }, { op: 'install' })).toThrow(
      'Unauthorized frame',
    );
    expect(() => handle({ sender: {}, senderFrame: {} }, { op: 'install' })).toThrow(
      'Unauthorized window',
    );
    expect(service.install).not.toHaveBeenCalled();
    expect(handle(event, { op: 'status' })).toEqual({ phase: 'idle' });
    await bridge.api!.updates({ op: 'check' });
    expect(bridge.invoke).toHaveBeenLastCalledWith('updates:call', { op: 'check' });
    const listener = vi.fn();
    const remove = bridge.api!.onUpdateEvent(listener);
    bridge.listeners.get('updates:event')!({}, { phase: 'idle' });
    expect(listener).toHaveBeenCalledOnce();
    remove();
    expect(bridge.listeners.has('updates:event')).toBe(false);
  });
});
describe('屏幕权限 IPC', () => {
  it('仅主窗口主 frame 接受三个固定操作，拒绝任意对象/URL/额外参数', async () => {
    const sender = { mainFrame: {} };
    const call = vi.fn(async () => ({ status: 'denied' as const, message: '未允许' }));
    registerScreenCaptureIpc({ call }, (event) => {
      if (event.sender !== sender) throw Error('Unauthorized window');
    });
    const handler = bridge.handlers.get('interview:screen-permission')!;
    const event = { sender, senderFrame: sender.mainFrame };
    for (const value of [
      null,
      undefined,
      {},
      [],
      'grant',
      'https://example.com',
      { action: 'request' },
    ])
      expect(() => handler(event, value)).toThrow('Invalid');
    expect(() => handler(event, 'request', { path: '/private' })).toThrow('Invalid');
    expect(() => handler({ sender, senderFrame: {} }, 'request')).toThrow('Unauthorized frame');
    expect(() => handler({ sender: {}, senderFrame: {} }, 'request')).toThrow(
      'Unauthorized window',
    );
    expect(call).not.toHaveBeenCalled();
    for (const action of ['check', 'request', 'open-settings'])
      expect(await handler(event, action)).toEqual({ status: 'denied', message: '未允许' });
    expect(call.mock.calls).toHaveLength(3);
  });
  it('没有平台实现时明确拒绝，不套用其他平台权限实现', () => {
    const sender = { mainFrame: {} };
    registerScreenCaptureIpc(undefined, () => {});
    expect(() =>
      bridge.handlers.get('interview:screen-permission')!(
        { sender, senderFrame: sender.mainFrame },
        'request',
      ),
    ).toThrow('当前系统');
  });
});

describe('完整面试问题通过既有 AI 接口', () => {
  function interviewSetup(
    demo = false,
    configuration = { ...defaultInterviewConfiguration(), aiEnabled: true, modelId: 'test' },
  ) {
    const state = setup();
    const context = new InterviewContext();
    const captureScreen = vi.fn(async (_signal: AbortSignal) => ({
      name: 'screenshot.png',
      bytes: new Uint8Array([137, 80, 78, 71]),
    }));
    const lifecycle = registerInterviewIpc({
      chat: state.chat,
      isDemo: () => demo,
      configuration: () => configuration,
      context,
      captureScreen,
      requireInterview: (e) => {
        if (e.sender !== state.sender) throw Error('Unauthorized window');
      },
    });
    return { ...state, lifecycle, context, captureScreen };
  }
  const question = {
    id: 'interview-q',
    question: 'Explain ROS2 scheduling?',
    modelId: 'test',
  };
  it('普通发送不截图，附截图发送完整题目与当次图片', async () => {
    const { call, chat, captureScreen } = interviewSetup();
    await call('interview:answer', question);
    expect(captureScreen).not.toHaveBeenCalled();
    await call('interview:answer', { ...question, id: 'attached', screenshot: 'attach' });
    expect(captureScreen).toHaveBeenCalledOnce();
    expect(chat.stream.mock.calls[1][0].turns.at(-1)).toMatchObject({
      content: question.question,
      files: [{ name: 'screenshot.png', bytes: new Uint8Array([137, 80, 78, 71]) }],
    });
  });
  it('仅截图不传转写、历史回答、个人信息或知识库；拒绝夹带文字和伪造截图', async () => {
    const configuration = {
      ...defaultInterviewConfiguration(),
      aiEnabled: true,
      modelId: 'test',
      profile: {
        name: '私人姓名',
        background: '私人背景',
        jobDescription: '私人JD',
        customInstructions: '私人指令',
        skills: [],
      },
      knowledgeBaseId: 'private-kb',
    };
    const { call, chat, context, captureScreen } = interviewSetup(false, configuration);
    await call('interview:answer', question);
    context.event({
      type: 'segment',
      segment: {
        id: 'mic-private',
        source: 'microphone',
        text: '私人转写',
        final: true,
        startMs: Date.now(),
        endMs: Date.now(),
      },
    });
    await call('interview:answer', { id: 'only', modelId: 'test', screenshot: 'only' });
    const request = chat.stream.mock.calls[1][0];
    expect(request.turns).toHaveLength(1);
    expect(request.turns[0]).toMatchObject({
      content: '请解答当前屏幕截图中的题目。',
      files: [{ name: 'screenshot.png' }],
    });
    expect(request.knowledgeBaseId).toBeNull();
    expect(JSON.stringify(request.turns)).not.toMatch(/私人|Explain ROS2|ai_suggestion|"answer"/);
    expect(request.instructions).not.toContain('私人');
    for (const invalid of [
      { ...question, screenshot: 'only' },
      { ...question, screenshot: true },
      { ...question, screenshot: 'attach', files: [] },
      { id: 'missing', modelId: 'test', screenshot: 'attach' },
    ])
      await expect(call('interview:answer', invalid)).rejects.toThrow('Invalid');
    expect(captureScreen).toHaveBeenCalledOnce();
  });
  it('截图失败或截取期间停止都不调用模型、不降级为仅文字', async () => {
    const { call, chat, captureScreen } = interviewSetup();
    captureScreen.mockRejectedValueOnce(Error('截图权限不可用'));
    expect(await call('interview:answer', { ...question, screenshot: 'attach' })).toMatchObject({
      ok: false,
      error: { message: '截图权限不可用' },
    });
    expect(chat.stream).not.toHaveBeenCalled();
    let finish!: (file: { name: string; bytes: Uint8Array }) => void;
    captureScreen.mockImplementationOnce(
      async () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const pending = call('interview:answer', {
      ...question,
      id: 'cancel-capture',
      screenshot: 'attach',
    });
    await call('interview:cancel', 'cancel-capture');
    finish({ name: 'screenshot.png', bytes: new Uint8Array([1, 2, 3]) });
    expect(await pending).toMatchObject({ ok: false, error: { code: 'cancelled' } });
    expect(chat.stream).not.toHaveBeenCalled();
  });
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
    expect(chat.stream.mock.calls[1][0].turns.at(-1)).toEqual({
      role: 'user',
      content: 'A complete next question',
    });
    expect(chat.stream.mock.calls[1][0].turns[0].content).toContain(question.question);
    lifecycle.cancel();
  });
  it('只发送原生终稿上下文，实际面试者答案与 AI 建议分开；取消的迟到结果不进上下文', async () => {
    const { call, chat, context, lifecycle } = interviewSetup();
    context.event({
      type: 'segment',
      segment: {
        id: 'mic',
        source: 'microphone',
        text: '我实际使用 PostgreSQL',
        final: true,
        startMs: Date.now(),
        endMs: Date.now(),
      },
    });
    let finish!: (value: ChatCompletion) => void;
    chat.stream.mockImplementationOnce(
      async () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const pending = call('interview:answer', question);
    lifecycle.cancel();
    finish({ answerText: '迟到建议不能污染本场', usage: null, sources: [] });
    expect(await pending).toMatchObject({ ok: false });
    await call('interview:answer', { ...question, id: 'followup', question: '为什么这么选？' });
    const request = chat.stream.mock.calls[1][0];
    expect(request.turns[0].content).toContain('我实际使用 PostgreSQL');
    expect(request.turns[0].content).not.toContain('迟到建议');
    expect(request.instructions).toContain('不能当成面试者已说过的话');
    expect(request.instructions).toContain('只输出面试者可以直接念出的答案正文');
    expect(request.instructions).toContain('第一人称自然口语表达');
    expect(request.instructions).toContain('面试官肯定、致谢或收尾时，只给简短得体的直接回应');
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
      ['updates', 'updates:call', [{ op: 'check' }]],
      ['updateSessionState', 'session:state', [true]],
      ['finishSessionClose', 'session:close-ready', ['close-id', true]],
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
      ['setNativeTheme', 'appearance:theme', ['dark']],
      ['systemAccent', 'appearance:accent', []],
      ['authSession', 'auth:session', []],
      ['signInWithChatGPT', 'auth:sign-in', []],
      ['signInWithCopilot', 'auth:copilot-sign-in', []],
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
      ['screenCapturePermission', 'interview:screen-permission', ['check']],
      ['openMicrophoneSettings', 'interview:microphone-settings', []],
      ['interviewState', 'interview:state', []],
      ['allowCapture', 'interview:capture', [false]],
      ['togglePin', 'interview:pin', []],
      ['toggleInterviewCollapse', 'interview:collapse', []],
      ['setInterviewTranscriptVisible', 'interview:transcript', [false]],
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
        'platform',
        'nativeWindowControls',
        'presentation',
        'screenCapturePermissionSupported',
        'confirmInterviewEnd',
        'setInterviewMousePassthrough',
        'onInterviewTitle',
        'knowledge',
        'onKnowledgeEvent',
        'onChatEvent',
        'onSpeechEvent',
        'onDictationEvent',
        'onSystemAccent',
        'onInterviewEndRequested',
        'onSessionCloseRequested',
        'onUpdateEvent',
      ].sort(),
    );
    await api.chatModels();
    expect(bridge.invoke).toHaveBeenLastCalledWith('chat:models', false);
    api.windowAction('close');
    api.confirmInterviewEnd();
    api.setInterviewMousePassthrough(true);
    expect(bridge.send.mock.calls).toEqual([
      ['window:action', 'close'],
      ['interview:confirm-end'],
      ['interview:mouse-passthrough', true],
    ]);
    (api.windowAction as (value: string) => void)('arbitrary-command');
    expect(bridge.send).toHaveBeenCalledTimes(3);
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
    const closing = vi.fn();
    const stopClosing = bridge.api!.onSessionCloseRequested(closing);
    bridge.listeners.get('session:request-close')!({ sender: 'private-event' }, 'close-id');
    expect(closing).toHaveBeenCalledExactlyOnceWith('close-id');
    bridge.listeners.get('appearance:accent-changed')!({}, '#123456');
    bridge.listeners.get('interview:request-end')!({ sender: 'private-event' });
    expect(accent).toHaveBeenCalledExactlyOnceWith('#123456');
    expect(end).toHaveBeenCalledExactlyOnceWith();
    stopAccent();
    stopEnd();
    stopClosing();
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
  const sender = { mainFrame: {}, isDestroyed: () => false, send: vi.fn() };
  const event = { sender, senderFrame: sender.mainFrame };
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

describe('知识库 IPC 白名单与调用者', () => {
  it('只接收主窗口主 frame 的受控请求，非法路径与缺失字段不进入服务', async () => {
    const sender = { mainFrame: {}, isDestroyed: () => false };
    const call = vi.fn(async () => null);
    registerKnowledgeIpc({ call } as unknown as KnowledgeCoordinator, (event) => {
      if (event.sender !== sender) throw Error('Unauthorized window');
    });
    const handle = bridge.handlers.get('knowledge:call')!;
    await expect(handle({ sender: {}, senderFrame: {} }, { op: 'status' })).rejects.toThrow(
      'Unauthorized',
    );
    await expect(handle({ sender, senderFrame: {} }, { op: 'status' })).rejects.toThrow(
      'Unauthorized frame',
    );
    const event = { sender, senderFrame: sender.mainFrame };
    expect(await handle(event, { op: 'status', path: 'C:/private' })).toMatchObject({ ok: false });
    expect(await handle(event, { op: 'search', query: 'PID' })).toMatchObject({ ok: false });
    expect(call).not.toHaveBeenCalled();
    expect(await handle(event, { op: 'status' })).toEqual({ ok: true, value: null });
    expect(call).toHaveBeenCalledOnce();
    await bridge.api!.knowledge({ op: 'status' });
    expect(bridge.invoke).toHaveBeenLastCalledWith('knowledge:call', { op: 'status' });
    const listener = vi.fn(),
      remove = bridge.api!.onKnowledgeEvent(listener);
    bridge.listeners.get('knowledge:event')!(
      {},
      { documentId: 'd', phase: 'ready', completed: 1, total: 1 },
    );
    expect(listener).toHaveBeenCalledOnce();
    remove();
    expect(bridge.listeners.has('knowledge:event')).toBe(false);
  });
});
