import { expect, it, vi } from 'vitest';
import {
  SpeechCoordinator,
  validateInterviewConfiguration,
  validateInterviewModel,
} from '../../../shared/electron/application/speech';
import { defaultInterviewConfiguration } from '../../../shared/src/services/speech';
import type {
  SpeechServiceCall,
  InterviewConfiguration,
} from '../../../shared/electron/contracts/speech';
import { questionSource } from '../../../shared/electron/contracts/speechSettings';
function setup() {
  const port = {
    call: vi.fn(async (call: SpeechServiceCall) => ({
      state: ['start', 'switch-recognizer'].includes(call.op)
        ? ('running' as const)
        : ('idle' as const),
      model: 'test',
    })),
    stop: vi.fn(),
  };
  return { port, coordinator: new SpeechCoordinator(port) };
}
const transcriptionConfiguration = (): InterviewConfiguration => ({
  ...defaultInterviewConfiguration(),
  inputMode: 'transcription',
  options: { sources: ['microphone'], microphone: 'selected-mic' },
});
it.each(['reported', 'rejected'])('重连后保留前一条管线的未完整转写，下一场不继承（%s）', async reason => {
  const { coordinator, port } = setup();
  const configuration = transcriptionConfiguration();
  await coordinator.confirm(configuration);
  await coordinator.interview({ op: 'start', options: configuration.options });
  if (reason === 'reported') port.call.mockResolvedValueOnce({
    state: 'idle', model: 'test', transcriptTailIncomplete: true, recordingError: 'synthetic disk error',
  } as Awaited<ReturnType<typeof port.call>>);
  else port.call.mockRejectedValueOnce(Error('synthetic drain failure'));
  expect((await coordinator.reconnect()).state).toBe('running');
  await coordinator.reconnect();
  const end = await coordinator.interview({ op: 'stop' });
  expect(end.transcriptTailIncomplete).toBe(true);
  expect(end.recordingError).toBe(reason === 'reported' ? 'synthetic disk error' : undefined);
  coordinator.releaseInterview(true);
  await coordinator.confirm(configuration);
  await coordinator.interview({ op: 'start', options: configuration.options });
  expect(await coordinator.interview({ op: 'stop' })).not.toHaveProperty('transcriptTailIncomplete');
});
it('输入方式缺省兼容远程，只有仅转录允许单麦且初始不能无麦', () => {
  const legacy = defaultInterviewConfiguration();
  delete legacy.inputMode;
  expect(validateInterviewConfiguration(legacy).inputMode).toBeUndefined();
  expect(questionSource()).toBe('system');
  expect(questionSource('remote')).toBe('system');
  expect(questionSource('transcription')).toBe('microphone');
  expect(
    validateInterviewConfiguration({ ...legacy, inputMode: 'remote' }).options.sources,
  ).toContain('system');
  expect(validateInterviewConfiguration(transcriptionConfiguration())).toMatchObject({
    inputMode: 'transcription',
    mode: 'local',
    options: { sources: ['microphone'], microphone: 'selected-mic' },
  });
  for (const inputMode of [null, 'other', true, [], {}])
    expect(() => validateInterviewConfiguration({ ...legacy, inputMode })).toThrow('无效');
  for (const sources of [[], ['system'], ['system', 'microphone'], ['microphone', 'microphone']])
    for (const mode of ['local', 'mock'])
      expect(() =>
        validateInterviewConfiguration({
          ...transcriptionConfiguration(),
          mode,
          options: { sources },
        }),
      ).toThrow();
  expect(
    validateInterviewConfiguration({ ...transcriptionConfiguration(), mode: 'mock' }),
  ).toMatchObject({ mode: 'mock', options: { sources: ['microphone'] } });
  expect(() =>
    validateInterviewConfiguration({ ...legacy, options: { sources: ['microphone'] } }),
  ).toThrow('系统音频');
});
it('仅转录锁定输入方式且保留独立资料快照，不能借开始或重连打开系统音频', async () => {
  const { coordinator, port } = setup();
  const value = {
    ...transcriptionConfiguration(),
    profile: {
      name: 'Synthetic',
      background: 'Confirmed background',
      jobDescription: 'Fixture JD',
    },
  };
  await coordinator.confirm(value);
  value.profile.background = 'Caller changed this';
  value.options.sources.push('system');
  const confirmed = coordinator.configuration!;
  expect(confirmed.options.sources).toEqual(['microphone']);
  expect(confirmed.profile!.background).toBe('Confirmed background');
  await coordinator.interview({ op: 'start', options: confirmed.options });
  expect(port.call).toHaveBeenLastCalledWith({
    op: 'start',
    options: confirmed.options,
    inputState: { inputMode: 'transcription', microphoneMuted: false },
  });
  const count = port.call.mock.calls.length;
  for (const sources of [[], ['system'], ['microphone', 'system']])
    expect(() => coordinator.reconnect({ sources } as any)).toThrow();
  expect(() => coordinator.reconnect({ ...confirmed.options, inputMode: 'remote' } as any)).toThrow(
    'Invalid speech option',
  );
  await expect(coordinator.confirm(defaultInterviewConfiguration())).rejects.toThrow(
    '输入方式已锁定',
  );
  await expect(
    coordinator.interview({ op: 'start', options: { sources: ['system'] } }),
  ).rejects.toThrow('已锁定');
  expect(port.call.mock.calls.length).toBe(count);
  expect(coordinator.configuration).toEqual(confirmed);
  coordinator.releaseInterview(true);
  await coordinator.confirm(defaultInterviewConfiguration());
  expect(questionSource(coordinator.configuration?.inputMode)).toBe('system');
  coordinator.releaseInterview(true);
});
it('同场缺省与显式远程等价，确认排队也不能把远程切成仅转录', async () => {
  const { coordinator, port } = setup();
  const first = coordinator.confirm(defaultInterviewConfiguration());
  const changed = coordinator.confirm(transcriptionConfiguration());
  await first;
  await expect(changed).rejects.toThrow('输入方式已锁定');
  const before = port.stop.mock.calls.length;
  await coordinator.confirm({ ...defaultInterviewConfiguration(), inputMode: 'remote' });
  expect(port.stop).toHaveBeenCalledTimes(before);
  expect(coordinator.configuration?.options.sources).toContain('system');
  expect(() => coordinator.reconnect({ sources: ['microphone'] })).toThrow('系统音频');
  coordinator.releaseInterview(true);
});
it('仅转录暂停保留已确认单麦，重连不变输入方式，失败和迟到结果不换入新设备', async () => {
  const { coordinator, port } = setup();
  await coordinator.confirm(transcriptionConfiguration());
  const confirmed = coordinator.configuration!;
  await coordinator.interview({ op: 'start', options: confirmed.options });
  await coordinator.interview({ op: 'pause' });
  expect(coordinator.configuration).toEqual(confirmed);
  await coordinator.reconnect();
  expect(port.call).toHaveBeenLastCalledWith({
    op: 'start',
    options: confirmed.options,
    inputState: { inputMode: 'transcription', microphoneMuted: false },
  });
  const next = { ...confirmed.options, microphone: 'new-mic' };
  port.call
    .mockResolvedValueOnce({ state: 'idle', model: 'test' })
    .mockRejectedValueOnce(Error('synthetic device failure'));
  await expect(coordinator.reconnect(next)).rejects.toThrow('device failure');
  expect(coordinator.configuration).toEqual(confirmed);
  let release!: (status: { state: 'running'; model: string }) => void;
  port.call.mockResolvedValueOnce({ state: 'idle', model: 'test' }).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const connecting = coordinator.reconnect(next);
  await vi.waitFor(() => expect(release).toBeTypeOf('function'));
  const paused = coordinator.interview({ op: 'pause' });
  release({ state: 'running', model: 'late' });
  expect(await connecting).toMatchObject({ state: 'idle' });
  await paused;
  expect(coordinator.configuration).toEqual(confirmed);
  await coordinator.reconnect(next);
  expect(coordinator.configuration).toEqual({ ...confirmed, options: next });
  expect(
    port.call.mock.calls
      .filter(([call]) => call.op === 'start')
      .every(
        ([call]) =>
          call.op === 'start' &&
          call.options.sources.length === 1 &&
          call.options.sources[0] === 'microphone',
      ),
  ).toBe(true);
  coordinator.releaseInterview(true);
});
it('开场电平自检不会继承面试的 Qwen/CUDA 推理选择', async () => {
  const { coordinator, port } = setup();
  await coordinator.dictation({
    op: 'test',
    id: 'qwen-audio-test',
    options: { sources: ['system'], speechModel: 'qwen', inferenceDevice: 'cuda' },
  });
  expect(port.call).toHaveBeenLastCalledWith({ op: 'start', options: { sources: ['system'] } });
  coordinator.releaseDictation();
});
it.each(['start', 'test'] as const)(
  '仅安装Qwen时%s通过可信CPU回退保留语音输入与自检',
  async (op) => {
    const { coordinator, port } = setup();
    const fallback = { speechModel: 'qwen' as const, inferenceDevice: 'cpu' as const };
    await coordinator.dictation(
      op === 'start'
        ? { op }
        : {
            op,
            id: 'only-qwen',
            options: { sources: ['microphone'], speechModel: 'qwen', inferenceDevice: 'metal' },
          },
      fallback,
    );
    expect(port.call).toHaveBeenLastCalledWith({
      op: 'start',
      options: { sources: ['microphone'], ...fallback },
    });
    coordinator.releaseDictation();
  },
);

it.each(['qwen', 'device'] as const)(
  '面试中切换 %s 保持采集，成功才提交设置；回答设置仍能独立更新',
  async (kind) => {
    const { coordinator, port } = setup();
    const configuration = {
      ...defaultInterviewConfiguration(),
      aiEnabled: true,
      modelId: 'old',
      options: {
        sources: ['system' as const],
        speechModel: kind === 'qwen' ? ('paraformer' as const) : ('qwen' as const),
        inferenceDevice: 'cpu' as const,
      },
    };
    await coordinator.confirm(configuration);
    await coordinator.interview({ op: 'start', options: configuration.options });
    const options = {
      ...configuration.options,
      speechModel: 'qwen' as const,
      inferenceDevice: 'metal' as const,
    };
    let finish!: (value: any) => void;
    port.call.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
    port.stop.mockClear();
    const pending = coordinator.reconnect(options);
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    expect(port.call).toHaveBeenLastCalledWith({ op: 'switch-recognizer', options });
    expect(port.stop).not.toHaveBeenCalled();
    expect(coordinator.configuration!.options).toEqual(configuration.options);
    coordinator.updateModel({ modelId: 'next', effort: 'auto' }, [
      { id: 'next', label: 'Next', description: '' },
    ]);
    finish({ state: 'running', model: 'new recognizer' });
    await pending;
    expect(coordinator.configuration).toMatchObject({ modelId: 'next', options });
    coordinator.releaseInterview(true);
  },
);
it('后台语音切换不阻塞暂停和结束，迟到成功不能写入确认配置', async () => {
  for (const end of [false, true]) {
    const { coordinator, port } = setup();
    const configuration = defaultInterviewConfiguration();
    await coordinator.confirm(configuration);
    await coordinator.interview({ op: 'start', options: configuration.options });
    let finish!: (value: any) => void;
    port.call.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
    const pending = coordinator.reconnect({
      ...configuration.options,
      speechModel: 'qwen',
      inferenceDevice: 'metal',
    });
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    if (end) coordinator.releaseInterview(true);
    else await coordinator.interview({ op: 'pause' });
    finish({ state: 'running', model: 'late recognizer' });
    expect(await pending).toMatchObject({ state: 'idle' });
    expect(coordinator.configuration?.options.speechModel).toBeUndefined();
    coordinator.releaseInterview(true);
  }
});
it('Qwen 首次加载卡住时，切回 Paraformer 先释放旧服务再启动轻量模型', async () => {
  const { coordinator, port } = setup();
  const options = { sources: ['system' as const], speechModel: 'qwen' as const, inferenceDevice: 'cpu' as const };
  await coordinator.confirm({ ...defaultInterviewConfiguration(), options });
  let release!: () => void;
  port.call.mockImplementationOnce(() => new Promise(resolve => {
    release = () => resolve({ state: 'idle', model: 'retired' });
  }));
  const starting = coordinator.interview({ op: 'start', options });
  await vi.waitFor(() => expect(release).toBeTypeOf('function'));
  port.stop.mockClear().mockImplementationOnce(release);
  const next = { ...options, speechModel: 'paraformer' as const };
  await expect(coordinator.reconnect(next)).resolves.toMatchObject({ state: 'running' });
  await expect(starting).resolves.toMatchObject({ state: 'idle' });
  expect(port.stop).toHaveBeenCalledOnce();
  expect(port.call.mock.calls.map(([call]) => call.op)).toEqual(['start', 'start']);
  expect(coordinator.configuration!.options).toEqual(next);
});
it('后台积压已停机时，从设置切换模型会重新连接采集', async () => {
  const { coordinator, port } = setup();
  const options = { sources: ['system' as const], speechModel: 'qwen' as const };
  await coordinator.confirm({ ...defaultInterviewConfiguration(), options });
  await coordinator.interview({ op: 'start', options });
  coordinator.observeInterviewStatus({ state: 'error', model: 'Qwen', failureSource: 'model' });
  await coordinator.reconnect({ ...options, speechModel: 'paraformer' });
  expect(port.call.mock.calls.map(([call]) => call.op)).toEqual(['start', 'stop', 'start']);
  expect(coordinator.configuration!.options.speechModel).toBe('paraformer');
});
it('双音源自检限时10秒，过期停止令牌不影响新的采集', async () => {
  vi.useFakeTimers();
  const { coordinator, port } = setup();
  try {
    const options = {
      sources: ['system', 'microphone'] as const,
      microphone: 'mic-1',
      system: 'out-1',
    };
    await coordinator.dictation({
      op: 'test',
      id: 'test-1',
      options: { ...options, sources: [...options.sources] },
    });
    expect(coordinator.target).toBe('audio-test');
    expect(port.call).toHaveBeenLastCalledWith({ op: 'start', options });
    await coordinator.dictation({ op: 'test-stop', id: 'old-test' });
    expect(coordinator.target).toBe('audio-test');
    await vi.advanceTimersByTimeAsync(9999);
    expect(port.call).toHaveBeenLastCalledWith({ op: 'start', options });
    await vi.advanceTimersByTimeAsync(1);
    expect(port.call).toHaveBeenLastCalledWith({ op: 'stop' });
    expect(coordinator.target).toBeUndefined();
    await coordinator.dictation({ op: 'start' });
    const count = port.call.mock.calls.length;
    await coordinator.dictation({ op: 'test-stop', id: 'test-1' });
    expect(port.call).toHaveBeenCalledTimes(count);
    expect(coordinator.target).toBe('dictation');
  } finally {
    coordinator.releaseDictation();
    vi.useRealTimers();
  }
});
it('keeps a level-only preview until its owner releases it', async () => {
  vi.useFakeTimers();
  const { coordinator, port } = setup();
  const options = { sources: ['microphone', 'system'] };
  try {
    await coordinator.dictation({ op: 'preview', id: 'dialog', options });
    expect(port.call).toHaveBeenLastCalledWith({ op: 'start', levelsOnly: true, options });
    await vi.advanceTimersByTimeAsync(30000);
    await coordinator.dictation({ op: 'test-stop', id: 'old-dialog' });
    expect(coordinator.target).toBe('audio-test');
    await coordinator.dictation({ op: 'test-stop', id: 'dialog' });
    expect(port.call).toHaveBeenLastCalledWith({ op: 'stop' });
    expect(coordinator.target).toBeUndefined();
  } finally {
    coordinator.releaseDictation();
    vi.useRealTimers();
  }
});
it('自检不能抢占面试，取消尚未启动的自检不采集音频', async () => {
  const { coordinator, port } = setup();
  const checking = coordinator.dictation({
    op: 'test',
    id: 'check',
    options: { sources: ['system'] },
  });
  const canceled = coordinator.dictation({ op: 'test-stop', id: 'check' });
  await checking;
  await canceled;
  expect(port.call).not.toHaveBeenCalled();
  await coordinator.confirm(defaultInterviewConfiguration());
  await expect(
    coordinator.dictation({ op: 'test', id: 'during-interview', options: { sources: ['system'] } }),
  ).rejects.toThrow('先结束');
  coordinator.releaseInterview(true);
});
it('音频恢复只改变本场设备，强制退休故障宿主并保留模型及资料配置', async () => {
  const { coordinator, port } = setup();
  await expect(coordinator.reconnect()).rejects.toThrow('先开始');
  await coordinator.confirm(defaultInterviewConfiguration());
  const before = coordinator.configuration!;
  port.call.mockRejectedValueOnce(Error('synthetic stop failed'));
  const options = { sources: ['system'] as ('system' | 'microphone')[], system: 'new-output' };
  await expect(coordinator.reconnect(options)).resolves.toMatchObject({ state: 'running' });
  expect(coordinator.configuration).toEqual({ ...before, options });
  expect(port.call).toHaveBeenLastCalledWith({
    op: 'start',
    options,
    inputState: { inputMode: 'remote', microphoneMuted: true },
  });
  await expect(coordinator.interview({ op: 'start', options: before.options })).rejects.toThrow(
    '已锁定',
  );
  expect(() => coordinator.reconnect({ sources: ['microphone'] })).toThrow('系统音频');
  coordinator.releaseInterview(true);
});
it('设备重连失败不提交新设备；关闭期间迟到的连接不能重启采集', async () => {
  const { coordinator, port } = setup();
  await coordinator.confirm(defaultInterviewConfiguration());
  const options = coordinator.configuration!.options;
  port.call
    .mockResolvedValueOnce({ state: 'idle', model: 'test' })
    .mockRejectedValueOnce(Error('synthetic reconnect failed'));
  await expect(coordinator.reconnect({ sources: ['system'], system: 'gone' })).rejects.toThrow(
    'reconnect failed',
  );
  expect(coordinator.configuration!.options).toEqual(options);
  let finish;
  port.call.mockResolvedValueOnce({ state: 'idle', model: 'test' }).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const pending = coordinator.reconnect();
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
  coordinator.releaseInterview(true);
  finish({ state: 'running', model: 'test' });
  expect(await pending).toMatchObject({ state: 'idle' });
  expect(coordinator.configuration).toBeUndefined();
  expect(coordinator.target).toBeUndefined();
});
it('停止旧音频期间结束面试，不能迟到后打开新采集', async () => {
  const { coordinator, port } = setup();
  await coordinator.confirm(defaultInterviewConfiguration());
  let finishStop;
  port.call.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishStop = resolve;
      }),
  );
  const pending = coordinator.reconnect();
  await vi.waitFor(() => expect(finishStop).toBeTypeOf('function'));
  coordinator.releaseInterview(true);
  finishStop({ state: 'idle', model: 'test' });
  expect(await pending).toMatchObject({ state: 'idle' });
  expect(port.call).toHaveBeenCalledTimes(1);
  expect(coordinator.target).toBeUndefined();
});
it('确认设置校验系统音频、AI 和长度，并隔离外部引用', () => {
  const config = defaultInterviewConfiguration();
  for (const value of [
    null,
    {},
    { ...config, options: { sources: ['microphone'] } },
    { ...config, aiEnabled: true },
    { ...config, autoAnswer: 'yes' },
    { ...config, modelId: 'x'.repeat(201) },
    { ...config, effort: 'unlimited' },
    { ...config, effort: 'ultra' },
  ])
    expect(() => validateInterviewConfiguration(value)).toThrow();
  const validated = validateInterviewConfiguration(config);
  config.options.sources.pop();
  expect(validated.options.sources).toEqual(['microphone', 'system']);
});
it('确认时只接受账户模型公布的思考强度，未知能力使用自动', () => {
  const config = {
    ...defaultInterviewConfiguration(),
    aiEnabled: true,
    modelId: 'test',
    effort: 'low' as const,
  };
  const model = {
    id: 'test',
    label: 'Test',
    description: '',
    reasoningEfforts: ['low', 'high'] as const,
  };
  expect(() =>
    validateInterviewModel(config, [{ ...model, reasoningEfforts: [...model.reasoningEfforts] }]),
  ).not.toThrow();
  expect(() =>
    validateInterviewModel({ ...config, effort: 'max' }, [{ ...model, reasoningEfforts: ['low'] }]),
  ).toThrow('思考强度');
  expect(() =>
    validateInterviewModel(config, [{ id: 'test', label: 'Unknown', description: '' }]),
  ).toThrow('思考强度');
  expect(() =>
    validateInterviewModel({ ...config, effort: 'auto' }, [
      { id: 'test', label: 'Unknown', description: '' },
    ]),
  ).not.toThrow();
  expect(() => validateInterviewModel(config, [])).toThrow('账户可用');
  expect(validateInterviewConfiguration({ ...config, effort: undefined }).effort).toBe('auto');
});
it('确认后仅接受相同的设备和来源，暂停或重新打开都不会解除锁定', async () => {
  const { port, coordinator } = setup();
  const config = defaultInterviewConfiguration();
  await expect(coordinator.interview({ op: 'start', options: config.options })).rejects.toThrow(
    '先确认',
  );
  await coordinator.confirm(config);
  await coordinator.interview({ op: 'start', options: config.options });
  await coordinator.interview({ op: 'pause' });
  for (const options of [
    { sources: ['system'] },
    { ...config.options, microphone: 'other' },
    { ...config.options, system: 'other' },
  ])
    await expect(coordinator.interview({ op: 'start', options })).rejects.toThrow('已锁定');
  await coordinator.confirm({ ...config, mode: 'mock' });
  expect(coordinator.configuration?.mode).toBe('local');
  const copy = coordinator.configuration!;
  copy.options.sources.pop();
  expect(coordinator.configuration?.options.sources).toHaveLength(2);
  coordinator.releaseInterview();
  expect(coordinator.configuration?.mode).toBe('local');
  await coordinator.interview({ op: 'start', options: config.options });
  coordinator.releaseInterview(true);
  await coordinator.confirm({ ...config, mode: 'mock' });
  await expect(coordinator.interview({ op: 'start', options: config.options })).rejects.toThrow(
    '已锁定',
  );
  expect(port.stop).toHaveBeenCalled();
});
it('语音输入固定麦克风，确认面试先冲刷尾段，之后不能抢占面试采集', async () => {
  const { port, coordinator } = setup();
  expect(coordinator.busy).toBe(false);
  const starting = coordinator.dictation({ op: 'start', options: { sources: ['system'] } });
  expect(coordinator.busy).toBe(true);
  await starting;
  expect(port.call).toHaveBeenLastCalledWith({ op: 'start', options: { sources: ['microphone'] } });
  expect(coordinator.target).toBe('dictation');
  await coordinator.confirm(defaultInterviewConfiguration());
  expect(port.call).toHaveBeenLastCalledWith({ op: 'stop' });
  expect(coordinator.target).toBe('interview');
  await expect(coordinator.dictation({ op: 'start' })).rejects.toThrow('先结束');
  port.call.mockClear();
  await coordinator.dictation({ op: 'stop' });
  expect(port.call).not.toHaveBeenCalled();
  coordinator.releaseInterview(true);
  await coordinator.dictation({ op: 'start' });
  coordinator.releaseDictation();
  expect(coordinator.target).toBeUndefined();
  expect(coordinator.busy).toBe(false);
});
it('加载中立即停止按顺序释放，失败后允许重新启动', async () => {
  const { port, coordinator } = setup();
  let reject!: (error: Error) => void;
  port.call.mockImplementationOnce(async () => {
    await new Promise<void>((_done, fail) => {
      reject = fail;
    });
    return { state: 'running', model: 'test' };
  });
  const start = coordinator.dictation({ op: 'start' });
  await Promise.resolve();
  port.stop.mockImplementationOnce(() => reject(Error('closed during loading')));
  const stop = coordinator.dictation({ op: 'stop' });
  expect(port.call).toHaveBeenCalledTimes(1);
  expect(await start).toMatchObject({ state: 'idle' });
  await stop;
  expect(coordinator.target).toBeUndefined();
  expect(port.stop).toHaveBeenCalledTimes(1);
  port.call.mockRejectedValueOnce(Error('device failure'));
  await expect(coordinator.dictation({ op: 'start' })).rejects.toThrow('device failure');
  expect(coordinator.target).toBeUndefined();
  await coordinator.dictation({ op: 'start' });
  expect(coordinator.target).toBe('dictation');
});
it('尚未执行的语音启动被停止、关闭或开始面试撤销，不能晚到后隐藏采集', async () => {
  const { port, coordinator } = setup();
  const pending = coordinator.dictation({ op: 'start' });
  const stop = coordinator.dictation({ op: 'stop' });
  await pending;
  await stop;
  expect(port.call).not.toHaveBeenCalled();
  const closing = coordinator.dictation({ op: 'start' });
  coordinator.releaseDictation();
  await closing;
  expect(port.call).not.toHaveBeenCalled();
  const replaced = coordinator.dictation({ op: 'start' });
  const confirm = coordinator.confirm(defaultInterviewConfiguration());
  await replaced;
  await confirm;
  expect(port.call).not.toHaveBeenCalled();
  expect(coordinator.target).toBe('interview');
});

it('麦克风测试只允许所选麦克风，设备输入仍经过原生校验', async () => {
  const { port, coordinator } = setup();
  await coordinator.dictation({ op: 'start', microphone: 'selected-mic' });
  expect(port.call).toHaveBeenLastCalledWith({
    op: 'start',
    options: { sources: ['microphone'], microphone: 'selected-mic' },
  });
  expect(() => coordinator.dictation({ op: 'start', microphone: 42 })).toThrow(
    'Invalid audio device',
  );
  coordinator.releaseDictation();
});

it('面试中只更新可用模型与思考强度，资料、知识库、音频和会话保持', async () => {
  const { coordinator, port } = setup();
  await coordinator.confirm({
    ...defaultInterviewConfiguration(),
    aiEnabled: true,
    modelId: 'old',
    knowledgeBaseId: 'kb',
    knowledgeBaseName: '研发面试',
  });
  const before = coordinator.configuration!;
  const models = [
    { id: 'next', label: 'Next', description: '', reasoningEfforts: ['low' as const] },
  ];
  expect(() => coordinator.updateModel({ modelId: 'missing', effort: 'auto' }, models)).toThrow(
    '可用',
  );
  expect(() => coordinator.updateModel({ modelId: 'next', effort: 'high' }, models)).toThrow(
    '不支持',
  );
  expect(() =>
    coordinator.updateModel({ modelId: 'next', effort: 'auto', profile: {} }, models),
  ).toThrow('无效');
  expect(coordinator.configuration).toEqual(before);
  expect(coordinator.updateModel({ modelId: 'next', effort: 'low' }, models)).toEqual({
    modelId: 'next',
    effort: 'low',
  });
  expect(coordinator.configuration).toEqual({ ...before, modelId: 'next', effort: 'low' });
  expect(port.call).not.toHaveBeenCalled();
  coordinator.releaseInterview(true);
  expect(() => coordinator.updateModel({ modelId: 'next', effort: 'low' }, models)).toThrow('请先');
});
