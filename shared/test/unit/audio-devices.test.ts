import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { subscribeAudioDevices } from '../../../shared/src/services/audioDevices';
import type { SpeechStatus } from '../../../shared/electron/contracts/speech';
const device = { id: 'output', name: 'Synthetic output', source: 'system' as const };
let view: EventTarget;
let documentEvents: EventTarget & { visibilityState: string };
let media: EventTarget;
let read: ReturnType<typeof vi.fn<(call: unknown) => Promise<SpeechStatus>>>;
beforeEach(() => {
  vi.useFakeTimers();
  media = new EventTarget();
  read = vi.fn(async (_call: unknown): Promise<SpeechStatus> => ({
    state: 'idle',
    model: 'test',
    devices: [device],
  }));
  view = Object.assign(new EventTarget(), {
    desktop: { speech: read },
    navigator: { mediaDevices: media },
  });
  documentEvents = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  vi.stubGlobal('window', view);
  vi.stubGlobal('document', documentEvents);
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it('打开、定时、切回窗口和设备变更自动枚举，隐藏时不轮询且从不启动采集', async () => {
  const receive = vi.fn();
  const stop = subscribeAudioDevices(receive);
  await vi.advanceTimersByTimeAsync(0);
  expect(receive).toHaveBeenLastCalledWith({
    devices: [device],
    loading: false,
    loaded: true,
    error: '',
  });
  await vi.advanceTimersByTimeAsync(5000);
  expect(read).toHaveBeenCalledTimes(2);
  view.dispatchEvent(new Event('focus'));
  await vi.advanceTimersByTimeAsync(0);
  media.dispatchEvent(new Event('devicechange'));
  await vi.advanceTimersByTimeAsync(0);
  expect(read).toHaveBeenCalledTimes(4);
  documentEvents.visibilityState = 'hidden';
  await vi.advanceTimersByTimeAsync(10000);
  expect(read).toHaveBeenCalledTimes(4);
  documentEvents.visibilityState = 'visible';
  documentEvents.dispatchEvent(new Event('visibilitychange'));
  await vi.advanceTimersByTimeAsync(0);
  expect(read).toHaveBeenCalledTimes(5);
  expect(
    read.mock.calls.every((args) => JSON.stringify(args) === JSON.stringify([{ op: 'devices' }])),
  ).toBe(true);
  stop();
  const calls = receive.mock.calls.length;
  view.dispatchEvent(new Event('focus'));
  media.dispatchEvent(new Event('devicechange'));
  await vi.advanceTimersByTimeAsync(10000);
  expect(read).toHaveBeenCalledTimes(5);
  expect(receive).toHaveBeenCalledTimes(calls);
});
it('并发通知最多补读一次；卸载后丢弃迟到结果并释放通知', async () => {
  let finish!: (state: SpeechStatus) => void;
  read.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const receive = vi.fn();
  const stop = subscribeAudioDevices(receive);
  for (let i = 0; i < 5; i++) {
    view.dispatchEvent(new Event('focus'));
    media.dispatchEvent(new Event('devicechange'));
  }
  expect(read).toHaveBeenCalledTimes(1);
  finish({ state: 'idle', model: 'test', devices: [] });
  await vi.advanceTimersByTimeAsync(0);
  expect(read).toHaveBeenCalledTimes(2);
  let late!: (state: SpeechStatus) => void;
  read.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        late = resolve;
      }),
  );
  media.dispatchEvent(new Event('devicechange'));
  stop();
  const count = receive.mock.calls.length;
  late({ state: 'idle', model: 'test', devices: [{ ...device, id: 'late' }] });
  await vi.advanceTimersByTimeAsync(10000);
  expect(receive).toHaveBeenCalledTimes(count);
  expect(read).toHaveBeenCalledTimes(3);
});
it('枚举失败保留最近设备和可用控件，定时成功后清除错误', async () => {
  const receive = vi.fn();
  const stop = subscribeAudioDevices(receive);
  await vi.advanceTimersByTimeAsync(0);
  read.mockRejectedValueOnce(Error('synthetic failure'));
  await vi.advanceTimersByTimeAsync(5000);
  expect(receive).toHaveBeenLastCalledWith({
    devices: [device],
    loading: false,
    loaded: true,
    error: '无法读取音频设备。',
  });
  await vi.advanceTimersByTimeAsync(5000);
  expect(receive).toHaveBeenLastCalledWith({
    devices: [device],
    loading: false,
    loaded: true,
    error: '',
  });
  stop();
});
