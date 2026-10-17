import { expect, it, vi } from 'vitest';
import {
  SpeechCoordinator,
  validateInterviewConfiguration,
  validateInterviewModel,
} from '../../../shared/electron/application/speech';
import { defaultInterviewConfiguration } from '../../../shared/src/services/speech';
import type { SpeechCall } from '../../../shared/electron/contracts/speech';
function setup() {
  const port = {
    call: vi.fn(async (call: SpeechCall) => ({
      state: call.op === 'start' ? ('running' as const) : ('idle' as const),
      model: 'test',
    })),
    stop: vi.fn(),
  };
  return { port, coordinator: new SpeechCoordinator(port) };
}
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
  await coordinator.dictation({ op: 'start', options: { sources: ['system'] } });
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
