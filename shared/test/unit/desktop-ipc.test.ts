import { registerKnowledgeIpc } from '../../../shared/electron/ipc/knowledge';
import { registerUpdateIpc } from '../../../shared/electron/ipc/updates';
import { registerComponentIpc } from '../../../shared/electron/ipc/components';
import type { ComponentService } from '../../../shared/electron/backend/components/service';
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
import { registerInterviewImageIpc } from '../../../shared/electron/ipc/interviewImages';
import type { InterviewImageStore } from '../../../shared/electron/backend/interview/images';
import { ChatServiceError } from '../../../shared/electron/backend/chat/errors';
import { InterviewContext } from '../../../shared/electron/application/interviewContext';
import {
  validateInterviewConfiguration,
  validateInterviewModel,
} from '../../../shared/electron/application/speech';
import { defaultInterviewConfiguration } from '../../../shared/src/services/speech';

describe('归档截图 IPC', () => {
  it('仅授权主frame可读取有界ID，只有主窗口可保存/删除；不泄露本地路径', async () => {
    const main = { mainFrame: {} },
      floating = { mainFrame: {} };
    const store = {
      read: vi.fn(async () => 'data:image/png;base64,eA=='),
      preview: vi.fn(async () => 'data:image/jpeg;base64,eA=='),
      original: vi.fn(async () => ({ bytes: Buffer.from('original'), extension: 'png' as const })),
      remove: vi.fn(async () => {}),
    };
    const saveFile = vi.fn(async () => true);
    registerInterviewImageIpc({
      store: store as unknown as InterviewImageStore,
      saveFile,
      requireReader(event) {
        if (![main, floating].includes(event.sender as any)) throw Error('Unauthorized');
      },
      requireMain(event) {
        if (event.sender !== main) throw Error('Main only');
      },
    });
    const route = bridge.handlers.get('interview:image')!;
    const mainEvent = { sender: main, senderFrame: main.mainFrame };
    const floatingEvent = { sender: floating, senderFrame: floating.mainFrame };
    const id = '11111111-1111-4111-8111-111111111111';
    expect(await route(mainEvent, { op: 'preview', id })).toMatchObject({ ok: true });
    expect(await route(floatingEvent, { op: 'read', id })).toMatchObject({ ok: true });
    await expect(route(floatingEvent, { op: 'save', id })).rejects.toThrow('Main only');
    expect(saveFile).not.toHaveBeenCalled();
    expect(await route(mainEvent, { op: 'save', id })).toEqual({ ok: true, canceled: false });
    expect(saveFile).toHaveBeenCalledWith(mainEvent, {
      bytes: Buffer.from('original'),
      extension: 'png',
    });
    saveFile.mockResolvedValueOnce(false);
    expect(await route(mainEvent, { op: 'save', id })).toEqual({ ok: true, canceled: true });
    await expect(route({ sender: {}, senderFrame: {} }, { op: 'read', id })).rejects.toThrow(
      'Unauthorized',
    );
    await expect(route({ sender: main, senderFrame: {} }, { op: 'read', id })).rejects.toThrow();
    await expect(route(floatingEvent, { op: 'remove', ids: [id] })).rejects.toThrow('Main only');
    for (const input of [
      { op: 'read', id: '../file' },
      { op: 'read', id, path: '/private/image.png' },
      { op: 'save', id, path: '/private/image.png' },
      { op: 'save', id, bytes: new Uint8Array([1]) },
      { op: 'remove', ids: Array(101).fill(id) },
      { op: 'write', id },
    ])
      await expect(route(mainEvent, input)).rejects.toThrow();
    await expect(route(mainEvent, { op: 'read', id }, { path: '/private' })).rejects.toThrow();
    expect(store.remove).not.toHaveBeenCalled();
    expect(await route(mainEvent, { op: 'remove', ids: [id] })).toMatchObject({ ok: true });
    store.read.mockRejectedValueOnce(Error('ENOENT /private/synthetic/image.png'));
    const failed = await route(mainEvent, { op: 'read', id });
    expect(failed.ok).toBe(false);
    expect(JSON.stringify(failed)).not.toContain('/private');
    saveFile.mockRejectedValueOnce(Error('EACCES /private/destination.png'));
    const saveFailed = await route(mainEvent, { op: 'save', id });
    expect(saveFailed.ok).toBe(false);
    expect(JSON.stringify(saveFailed)).not.toContain('/private');
  });
});

beforeEach(() => {
  bridge.invoke.mockClear();
  bridge.send.mockClear();
  bridge.listeners.clear();
  bridge.handlers.clear();
});

describe('更新 IPC 白名单', () => {
  it('面试浮窗只读组件状态，不能通过状态授权下载、取消或删除组件', async () => {
    const sender = { mainFrame: {} },
      event = { sender, senderFrame: undefined as unknown };
    event.senderFrame = sender.mainFrame;
    const service = { status: vi.fn(), download: vi.fn(), cancel: vi.fn(), remove: vi.fn() };
    registerComponentIpc(
      service as unknown as ComponentService,
      () => {
        throw Error('main only');
      },
      undefined,
      (event) => {
        if (event.sender !== sender) throw Error('unauthorized');
      },
    );
    const handle = bridge.handlers.get('components:call')!;
    await handle(event, { op: 'status' });
    expect(service.status).toHaveBeenCalledOnce();
    for (const call of [
      { op: 'download', id: 'qwen' },
      { op: 'remove', id: 'qwen' },
      { op: 'cancel' },
      { op: 'status', id: 'qwen' },
    ])
      expect(() => handle(event, call)).toThrow('main only');
    expect(() => handle({ sender, senderFrame: {} }, { op: 'status' })).toThrow('Unauthorized');
    expect(service.download).not.toHaveBeenCalled();
    expect(service.remove).not.toHaveBeenCalled();
  });
  it('组件下载只接受已注册窗口主 frame 的固定组件和操作', async () => {
    const sender = { mainFrame: {} },
      event = { sender, senderFrame: undefined as unknown };
    event.senderFrame = sender.mainFrame;
    const service = { status: vi.fn(), download: vi.fn(), cancel: vi.fn(), remove: vi.fn() };
    registerComponentIpc(service as unknown as ComponentService, (event) => {
      if (event.sender !== sender) throw Error('Unauthorized window');
    });
    const handle = bridge.handlers.get('components:call')!;
    for (const call of [
      null,
      [],
      {},
      { op: 'download', url: 'https://evil.test' },
      { op: 'download', id: '../private' },
      { op: 'download', id: 'copilot' },
      { op: 'cancel', id: 'speech' },
      { op: 'status', path: '/' },
      { op: 'remove' },
      { op: 'remove', id: '../private' },
      { op: 'remove', id: 'speech', path: '/' },
      Object.assign(Object.create({ op: 'remove' }), { id: 'speech', path: '/' }),
    ])
      expect(() => handle(event, call)).toThrow();
    expect(() => handle({ sender, senderFrame: {} }, { op: 'download' })).toThrow();
    expect(() => handle({ sender: {}, senderFrame: {} }, { op: 'download' })).toThrow();
    expect(() => handle(event, { op: 'download' }, { url: 'https://evil.test' })).toThrow();
    await handle(event, { op: 'download', id: 'rag' });
    expect(service.download).toHaveBeenCalledWith('rag');
    await handle(event, { op: 'remove', id: 'speech' });
    expect(service.remove).toHaveBeenCalledWith('speech');
    registerComponentIpc(
      service as unknown as ComponentService,
      () => {},
      () => {
        throw Error('Only main window can remove');
      },
    );
    expect(() =>
      bridge.handlers.get('components:call')!(event, { op: 'remove', id: 'rag' }),
    ).toThrow('Only main window can remove');
  });
  it('只接受主窗口主 frame 的固定操作；桥接订阅可释放', async () => {
    const sender = { mainFrame: {} };
    const service = {
      state: vi.fn(() => ({ phase: 'idle' })),
      check: vi.fn(),
      download: vi.fn(),
      cancel: vi.fn(),
      install: vi.fn(),
      setAutoDownload: vi.fn(),
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
      { op: 'set-auto-download' },
      { op: 'set-auto-download', enabled: 'true' },
      { op: 'set-auto-download', enabled: true, path: '/private' },
      { op: 'check', enabled: true },
    ])
      expect(() => handle(event, value)).toThrow();
    expect(() => handle({ sender, senderFrame: {} }, { op: 'install' })).toThrow(
      'Unauthorized frame',
    );
    expect(() => handle({ sender: {}, senderFrame: {} }, { op: 'install' })).toThrow(
      'Unauthorized window',
    );
    expect(service.install).not.toHaveBeenCalled();
    await handle(event, { op: 'cancel' });
    expect(service.cancel).toHaveBeenCalledOnce();
    await handle(event, { op: 'set-auto-download', enabled: false });
    expect(service.setAutoDownload).toHaveBeenCalledExactlyOnceWith(false);
    expect(() =>
      handle({ sender, senderFrame: {} }, { op: 'set-auto-download', enabled: true }),
    ).toThrow('Unauthorized frame');
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
      file: { name: 'screenshot.png', bytes: new Uint8Array([137, 80, 78, 71]) },
      preview: 'data:image/jpeg;base64,fixture',
    }));
    const lifecycle = registerInterviewIpc({
      chat: state.chat,
      isDemo: () => demo,
      configuration: () => configuration,
      updateModel: (value, models) => {
        const next = validateInterviewConfiguration({ ...configuration, ...(value as object) });
        validateInterviewModel(next, models);
        Object.assign(configuration, { modelId: next.modelId, effort: next.effort });
        return { modelId: configuration.modelId, effort: configuration.effort };
      },
      context,
      captureScreen,
      archiveImages: vi.fn(async (images) => images.map(({ id, preview }) => ({ id, preview }))),
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
  it('失败后最多自动重试三次，复用问题快照并丢弃旧尝试的迟到事件', async () => {
    vi.useFakeTimers();
    try {
      const { call, chat, sender, context } = interviewSetup();
      const prepare = vi.spyOn(context, 'prepare');
      const saved = vi.spyOn(context, 'answer');
      const callbacks: Parameters<AIChatService['stream']>[1][] = [];
      chat.stream.mockImplementation(async (_request, emit) => {
        callbacks.push(emit);
        if (callbacks.length < 4)
          throw new ChatServiceError({ message: '连接中断', code: 'network_error' });
        emit({ id: question.id, type: 'delta', text: '成功正文' });
        return { answerText: '成功正文', usage: null, sources: [] };
      });
      const pending = call('interview:answer', question);
      await vi.advanceTimersByTimeAsync(3500);
      expect(await pending).toMatchObject({ ok: true, answerText: '成功正文' });
      expect(chat.stream).toHaveBeenCalledTimes(4);
      expect(prepare).toHaveBeenCalledOnce();
      expect(saved).toHaveBeenCalledOnce();
      const request = chat.stream.mock.calls[0][0];
      expect(chat.stream.mock.calls.every(([value]) => value === request)).toBe(true);
      expect(
        sender.send.mock.calls
          .map(([, event]) => event)
          .filter((event) => event.type === 'interview-retry'),
      ).toEqual(
        [1, 2, 3].map((attempt) => ({
          id: question.id,
          type: 'interview-retry',
          attempt,
          limit: 3,
        })),
      );
      const sent = sender.send.mock.calls.length;
      for (const emit of callbacks) emit({ id: question.id, type: 'delta', text: '迟到内容' });
      expect(sender.send).toHaveBeenCalledTimes(sent);
    } finally {
      vi.useRealTimers();
    }
  });
  it.each(['manual', 'end'] as const)('%s 取消重试等待后不再发起请求', async (mode) => {
    vi.useFakeTimers();
    try {
      const { call, chat, lifecycle } = interviewSetup();
      chat.stream.mockRejectedValue(
        new ChatServiceError({ message: '连接中断', code: 'network_error' }),
      );
      const pending = call('interview:answer', question);
      await vi.advanceTimersByTimeAsync(0);
      if (mode === 'manual') await call('interview:cancel', question.id);
      else lifecycle.cancel();
      await vi.advanceTimersByTimeAsync(10000);
      expect(await pending).toMatchObject({ ok: false, error: { code: 'cancelled' } });
      expect(chat.stream).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });
  it('自动重试中的活动请求被停止后不再重试，空回答同样最多尝试四次', async () => {
    vi.useFakeTimers();
    try {
      const { call, chat } = interviewSetup();
      chat.stream
        .mockRejectedValueOnce(new ChatServiceError({ message: '连接中断', code: 'network_error' }))
        .mockImplementationOnce(
          async (_request, _emit, signal) =>
            new Promise((_resolve, reject) => {
              signal.addEventListener('abort', () => reject(signal.reason), { once: true });
            }),
        );
      const pending = call('interview:answer', question);
      await vi.advanceTimersByTimeAsync(500);
      expect(chat.stream).toHaveBeenCalledTimes(2);
      await call('interview:cancel', question.id);
      await vi.advanceTimersByTimeAsync(10000);
      expect(await pending).toMatchObject({ ok: false, error: { code: 'cancelled' } });
      expect(chat.stream).toHaveBeenCalledTimes(2);
      chat.stream.mockClear().mockResolvedValue({ answerText: '', usage: null, sources: [] });
      const empty = call('interview:answer', { ...question, id: 'empty-question' });
      await vi.advanceTimersByTimeAsync(3500);
      expect(await empty).toMatchObject({ ok: false });
      expect(chat.stream).toHaveBeenCalledTimes(4);
    } finally {
      vi.useRealTimers();
    }
  });
  it.each([400, 401, 403, 429, 500])('确定性或未批准的 %s 错误不自动重试', async (status) => {
    const { call, chat } = interviewSetup();
    chat.stream.mockRejectedValue(new ChatServiceError({ message: '拒绝', status }));
    expect(await call('interview:answer', question)).toMatchObject({ ok: false });
    expect(chat.stream).toHaveBeenCalledOnce();
  });
  it('未知错误不猜测文案重试，结束时释放请求作用域', async () => {
    const { call, chat } = interviewSetup();
    const stream = vi.fn().mockRejectedValue(Error('network temporarily unavailable'));
    const dispose = vi.fn();
    const beginRequest = vi.fn(() => ({ stream, dispose }));
    Object.assign(chat, { beginRequest });
    expect(await call('interview:answer', question)).toMatchObject({ ok: false });
    expect(beginRequest).toHaveBeenCalledOnce();
    expect(stream).toHaveBeenCalledOnce();
    expect(dispose).toHaveBeenCalledOnce();
    expect(chat.stream).not.toHaveBeenCalled();
  });
  it('重试共享单一请求作用域，完成后清除证据', async () => {
    vi.useFakeTimers();
    try {
      const { call, chat } = interviewSetup();
      const stream = vi
        .fn()
        .mockRejectedValueOnce(new ChatServiceError({ message: '暂时故障', status: 503 }))
        .mockResolvedValue({ answerText: '完成', usage: null, sources: [] });
      const dispose = vi.fn(),
        beginRequest = vi.fn(() => ({ stream, dispose }));
      Object.assign(chat, { beginRequest });
      const pending = call('interview:answer', question);
      await vi.advanceTimersByTimeAsync(500);
      expect(await pending).toMatchObject({ ok: true });
      expect(beginRequest).toHaveBeenCalledOnce();
      expect(stream).toHaveBeenCalledTimes(2);
      expect(dispose).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });
  it('回答中切换模型与强度保留当前流快照，下一题使用新配置；非面试窗口仍拒绝', async () => {
    const { call, chat, sender } = interviewSetup();
    chat.models.mockImplementation(async () => [
      { id: 'test', label: 'Test', description: '' },
      { id: 'next', label: 'Next', description: '', reasoningEfforts: ['high' as const] },
    ]);
    expect(
      await call('interview:update-model', { modelId: 'missing', effort: 'auto' }),
    ).toMatchObject({ ok: false });
    let finish!: () => void;
    chat.stream.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = () => resolve({ answerText: 'old answer', usage: null, sources: [] });
        }),
    );
    const answering = call('interview:answer', question);
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    expect(await call('interview:update-model', { modelId: 'next', effort: 'high' })).toMatchObject(
      { ok: true, modelId: 'next', effort: 'high' },
    );
    expect(chat.stream.mock.calls[0][0]).toMatchObject({ modelId: 'test' });
    expect(chat.stream.mock.calls[0][0].effort).toBeUndefined();
    expect(chat.stream.mock.calls[0][2]!.aborted).toBe(false);
    chat.stream.mock.calls[0][1]({ id: question.id, type: 'delta', text: 'old stream continues' });
    expect(sender.send).toHaveBeenLastCalledWith('chat:event', {
      id: question.id,
      type: 'delta',
      text: 'old stream continues',
    });
    const handler = bridge.handlers.get('interview:update-model')!;
    await expect(
      handler({ sender: {}, senderFrame: {} }, { modelId: 'test', effort: 'auto' }),
    ).rejects.toThrow('Unauthorized');
    finish();
    await answering;
    await call('interview:answer', {
      ...question,
      id: 'next-question',
      modelId: 'next',
      effort: 'high',
    });
    expect(chat.stream.mock.calls[1][0]).toMatchObject({ modelId: 'next', effort: 'high' });
  });
  it('截图先暂存且不调用模型，手动发送引用原图片，成功后释放', async () => {
    const { call, chat, captureScreen } = interviewSetup(false, {
      ...defaultInterviewConfiguration(),
      aiEnabled: true,
      modelId: 'test',
      profile: { name: '合成候选人', language: '', customInstructions: '', skills: [] },
    });
    await call('interview:answer', question);
    expect(captureScreen).not.toHaveBeenCalled();
    expect(chat.stream.mock.calls[0][0].instructions).toContain(
      '回答语言：简体中文\n\n本场补充要求：\n无\n',
    );
    const staged = await call('interview:screenshot', { op: 'capture' });
    expect(chat.stream).toHaveBeenCalledOnce();
    expect(staged.screenshot.preview).toBe('data:image/jpeg;base64,fixture');
    await call('interview:answer', {
      ...question,
      id: 'attached',
      screenshotIds: [staged.screenshot.id],
    });
    await expect(
      call('interview:answer', { ...question, screenshotIds: [staged.screenshot.id] }),
    ).rejects.toThrow('Invalid');
    expect(captureScreen).toHaveBeenCalledOnce();
    expect(chat.stream.mock.calls[1][0].turns.at(-1)).toMatchObject({
      content: question.question,
      files: [{ name: 'screenshot.png', bytes: new Uint8Array([137, 80, 78, 71]) }],
    });
    expect(chat.stream.mock.calls[1][0].instructions).toContain('局部不清但不影响题意时照常作答');
  });
  it('仅截图不传转写、历史回答、个人信息或知识库；拒绝夹带文字和伪造截图', async () => {
    const configuration = {
      ...defaultInterviewConfiguration(),
      aiEnabled: true,
      modelId: 'test',
      profile: {
        name: '私人姓名',
        language: 'English',
        background: '私人背景',
        jobDescription: '私人JD',
        customInstructions: '私人指令',
        skills: [],
      },
      knowledgeBaseId: 'private-kb',
    };
    const { call, chat, context, captureScreen } = interviewSetup(false, configuration);
    await call('interview:answer', question);
    const ordinary = chat.stream.mock.calls[0][0];
    expect(ordinary.instructions).toContain('回答语言：English');
    expect(ordinary.instructions).toContain('\n本场补充要求：\n私人指令\n');
    expect(ordinary.instructions).toContain('与直接作答或个人事实规则冲突的部分不执行');
    expect(ordinary.instructions).toContain(
      '职位描述摘要（jobDescription）是岗位要求；技能（skills）是面试准备参考资料',
    );
    expect(ordinary.instructions).toContain('不能据此声称面试者已经掌握');
    expect(ordinary.instructions).toContain('"background":"私人背景"');
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
    const staged = await call('interview:screenshot', { op: 'capture' });
    await call('interview:answer', {
      id: 'only',
      modelId: 'test',
      screenshotIds: [staged.screenshot.id],
    });
    const request = chat.stream.mock.calls[1][0];
    expect(request.turns).toHaveLength(1);
    expect(request.turns[0]).toMatchObject({
      content: '请直接解答截图中的题目。',
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
  it('截图失败、关闭和迟到结果不进入模型；五张上限、移除及引用校验在主进程执行', async () => {
    const { call, chat, captureScreen, lifecycle } = interviewSetup();
    captureScreen.mockRejectedValueOnce(Error('截图权限不可用'));
    expect(await call('interview:screenshot', { op: 'capture' })).toMatchObject({ ok: false });
    const ids: string[] = [];
    for (let i = 0; i < 5; i++)
      ids.push((await call('interview:screenshot', { op: 'capture' })).screenshot.id);
    expect(await call('interview:screenshot', { op: 'capture' })).toMatchObject({ ok: false });
    expect(captureScreen).toHaveBeenCalledTimes(6);
    expect(chat.stream).not.toHaveBeenCalled();
    for (const invalid of [
      { ...question, screenshotIds: ids.concat(ids[0]) },
      { ...question, screenshotIds: [ids[0], ids[0]] },
      { ...question, screenshotIds: ['unknown'] },
      { ...question, screenshotIds: null },
      { ...question, files: [] },
    ])
      await expect(call('interview:answer', invalid)).rejects.toThrow('Invalid');
    await call('interview:screenshot', { op: 'remove', id: ids[0] });
    await expect(
      call('interview:answer', { ...question, screenshotIds: [ids[0]] }),
    ).rejects.toThrow('Invalid');
    let finish!: (value: Awaited<ReturnType<typeof captureScreen>>) => void;
    captureScreen.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const pending = call('interview:screenshot', { op: 'capture' });
    expect(await call('interview:screenshot', { op: 'capture' })).toMatchObject({ ok: false });
    lifecycle.cancel();
    finish({ file: { name: 'screenshot.png', bytes: new Uint8Array([1]) }, preview: 'fixture' });
    expect(await pending).toMatchObject({ ok: false, error: { code: 'cancelled' } });
    await expect(
      call('interview:answer', { ...question, screenshotIds: [ids[1]] }),
    ).rejects.toThrow('Invalid');
    expect(chat.stream).not.toHaveBeenCalled();
  });
  it('失败保留全部截图供重试；自动文字请求不消费待发送截图', async () => {
    const { call, chat, captureScreen } = interviewSetup();
    const ids = [];
    for (let i = 0; i < 5; i++)
      ids.push((await call('interview:screenshot', { op: 'capture' })).screenshot.id);
    await call('interview:answer', question);
    expect(chat.stream.mock.calls[0][0].turns.at(-1).files).toBeUndefined();
    chat.stream.mockRejectedValue(Error('模型失败'));
    expect(await call('interview:answer', { ...question, screenshotIds: ids })).toMatchObject({
      ok: false,
    });
    chat.stream.mockResolvedValue({ answerText: '重试成功', usage: null, sources: [] });
    await call('interview:answer', { ...question, screenshotIds: ids });
    expect(chat.stream.mock.calls.at(-1)![0].turns.at(-1)!.files).toHaveLength(5);
    expect(captureScreen).toHaveBeenCalledTimes(5);
    expect(await call('interview:screenshot', { op: 'capture' })).toMatchObject({ ok: true });
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
    expect(request.instructions).toContain('不等于面试者说过的话或本人经历');
    expect(request.instructions).toContain('实际发言缺失时可借助最近的 AI 建议理解所指');
    expect(request.instructions).toContain('直接写出面试者能当场口述的第一人称答案');
    expect(request.instructions).toContain('用自然口语');
    expect(request.instructions).toContain('代码不计入口述时长');
    expect(request.instructions).toContain('面试官肯定、致谢或收尾时只简短回应');
    expect(request.instructions).toContain('回答语言：简体中文');
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
      ['accountData', 'account:data', [{ action: 'begin', files: 1 }]],
      ['updates', 'updates:call', [{ op: 'check' }]],
      ['components', 'components:call', [{ op: 'download', id: 'rag' }]],
      ['updateSessionState', 'session:state', [true]],
      ['finishSessionClose', 'session:close-ready', ['close-id', true]],
      ['speech', 'speech:call', [{ op: 'status' }]],
      ['speechHardware', 'speech:hardware', []],
      ['reconnectInterviewAudio', 'interview:reconnect-audio', [{ sources: ['system'] }]],
      ['dictation', 'dictation:call', [{ op: 'start' }]],
      [
        'generateInterviewTitle',
        'history:generate-title',
        [{ recordId: 'r', modelId: 'test', questions: ['why'] }],
      ],
      ['exportHistory', 'history:export', [{ title: 'title', text: 'text' }]],
      ['interviewModels', 'interview:models', []],
      ['updateInterviewModel', 'interview:update-model', [{ modelId: 'test', effort: 'auto' }]],
      ['interviewAnswer', 'interview:answer', [{ id: 'q', question: 'why', modelId: 'model' }]],
      ['interviewCancel', 'interview:cancel', ['q']],
      ['interviewScreenshot', 'interview:screenshot', [{ op: 'capture' }]],
      ['interviewImage', 'interview:image', [{ op: 'read', id: 'stored-image' }]],
      ['setNativeTheme', 'appearance:theme', ['dark']],
      ['systemAccent', 'appearance:accent', []],
      ['authSession', 'auth:session', []],
      ['cloudAccount', 'cloud:account', [{ action: 'status' }]],
      [
        'cloudSync',
        'cloud:sync',
        [{ action: 'list', userId: '11111111-1111-4111-8111-111111111111' }],
      ],
      ['signInWithChatGPT', 'auth:sign-in', []],
      ['signInWithCopilot', 'auth:copilot-sign-in', []],
      ['cancelSignIn', 'auth:cancel', []],
      ['enterDemo', 'auth:demo', []],
      ['signOut', 'auth:sign-out', []],
      ['chatModels', 'chat:models', [true]],
      ['chatUsage', 'chat:usage', []],
      ['chatAccountUsage', 'chat:account-usage', []],
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
      ['moveInterviewWindow', 'interview:move', [{ phase: 'start' }]],
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
        'onComponentEvent',
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
    expect(bridge.api).not.toHaveProperty('setContentControls');
    expect(bridge.api).not.toHaveProperty('popUpNativeMenu');
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
    accountUsage: vi.fn(async () => null),
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
  it('账户额度只接受主窗口主 frame 的零参数读取，不接收账户、令牌或 URL', async () => {
    const { chat, call, sender } = setup();
    expect(await call('chat:account-usage')).toEqual({ ok: true, usage: null });
    chat.accountUsage.mockClear();
    await expect(
      call('chat:account-usage', { token: 'private', url: 'https://example.test' }),
    ).rejects.toThrow('Invalid request');
    for (const senderFrame of [undefined, {}])
      await expect(
        bridge.handlers.get('chat:account-usage')!({ sender, senderFrame }),
      ).rejects.toThrow('Unauthorized');
    expect(chat.accountUsage).not.toHaveBeenCalled();
    expect(bridge.handlers.has('chat:account-usage-connect')).toBe(false);
    expect(bridge.handlers.has('chat:account-usage-connect-cancel')).toBe(false);
  });
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
    expect(await call('chat:account-usage')).toEqual({ ok: true, usage: null });
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
    expect(lifecycle.isBusy()).toBe(true);
    expect(await call('chat:send', { ...request, id: 'other' })).toMatchObject({ ok: false });
    expect(await call('chat:usage-reset')).toMatchObject({ ok: false });
    expect(chat.resetUsage).not.toHaveBeenCalled();
    call('chat:cancel', 'other');
    expect(pending.signal.aborted).toBe(false);
    pending.emit({ id: request.id, type: 'delta', text: 'before' });
    expect(sender.send).toHaveBeenCalledTimes(1);
    call('chat:cancel', request.id);
    expect(lifecycle.isBusy()).toBe(true);
    expect(pending.signal.aborted).toBe(true);
    pending.emit({ id: request.id, type: 'delta', text: 'late' });
    expect(sender.send).toHaveBeenCalledTimes(1);
    expect(await first).toMatchObject({ ok: false, error: { code: 'cancelled' } });
    expect(lifecycle.isBusy()).toBe(false);
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
