import { afterEach, expect, it, vi } from 'vitest';
import {
  RecognitionRouter,
  type RecognizerFactory,
} from '../../electron/backend/speech/recognition';
import type { RecognizerPort } from '../../electron/backend/speech/recognizer';
import type { AudioSource, SpeechEvent } from '../../electron/contracts/speech';

class FakeRecognizer implements RecognizerPort {
  metadata = { chunkMs: 1000 };
  healthy = true;
  audioMs = 0;
  inferenceMs = 0;
  idle = { system: true, microphone: true };
  progress = new Map<AudioSource, number>();
  emit: (event: SpeechEvent) => void = () => {};
  feed = vi.fn(
    async (source: AudioSource, samples: Float32Array, rate: number, timestamp: number) => {
      this.audioMs += (samples.length / rate) * 1000;
      this.progress.set(source, timestamp + (samples.length / rate) * 1000);
    },
  );
  flush = vi.fn(async () => {});
  discontinuity = vi.fn(async () => {});
  discard = vi.fn(async () => {});
  close = vi.fn(async () => {
    this.healthy = false;
  });
  processedThrough(source: AudioSource) {
    return this.progress.get(source);
  }
  canSwitch(source: AudioSource) {
    return this.idle[source];
  }
}
const routers: RecognitionRouter[] = [];
afterEach(async () => {
  await Promise.all(routers.splice(0).map((router) => router.close()));
  vi.useRealTimers();
});
async function setup() {
  const old = new FakeRecognizer(),
    candidate = new FakeRecognizer();
  const events: SpeechEvent[] = [],
    phases: string[] = [];
  let load!: () => void, fail!: (error: Error) => void;
  const factory: RecognizerFactory = vi.fn(async (_options, emit, signal) => {
    if (!(factory as ReturnType<typeof vi.fn>).mock.calls.slice(0, -1).length) {
      old.emit = emit;
      return old;
    }
    candidate.emit = emit;
    await new Promise<void>((resolve, reject) => {
      load = resolve;
      fail = reject;
      signal.addEventListener('abort', () => reject(Error('canceled')), { once: true });
    });
    return candidate;
  });
  const router = new RecognitionRouter(factory, (event) => events.push(event));
  routers.push(router);
  await router.initialize({}, ['system', 'microphone']);
  const switching = () => router.stage({}, (phase) => phases.push(phase));
  const feed = (source: AudioSource = 'system', ms = 100, at = 1000) =>
    router.feed(source, new Float32Array(ms * 16), 16000, at);
  return {
    old,
    candidate,
    router,
    events,
    phases,
    switching,
    feed,
    load: () => load(),
    fail: () => fail(Error('model load failed')),
  };
}
it('后台加载不阻塞旧识别，两路都停顿后原子交接，只转发当前识别器事件', async () => {
  const s = await setup();
  s.old.idle.microphone = false;
  const pending = s.switching();
  await s.feed();
  expect(s.old.feed).toHaveBeenCalledOnce();
  expect(s.phases).toEqual(['loading']);
  const event = { type: 'speech-start', source: 'system' } as const;
  s.candidate.emit(event);
  expect(s.events).toEqual([]);
  s.load();
  await Promise.resolve();
  await Promise.resolve();
  expect(s.phases).toEqual(['loading', 'waiting']);
  await s.feed();
  expect(s.candidate.feed).not.toHaveBeenCalled();
  s.old.idle.microphone = true;
  await s.feed('microphone');
  await expect(pending).resolves.toEqual({ chunkMs: 1000 });
  expect(s.old.close).toHaveBeenCalledOnce();
  s.old.emit(event);
  expect(s.events).toEqual([]);
  s.candidate.emit(event);
  expect(s.events).toEqual([event]);
  await s.feed();
  expect(s.old.feed).toHaveBeenCalledTimes(3);
});
it('新模型就绪后取消会释放候选模型，下一包语音仍由原模型处理', async () => {
  const s = await setup();
  s.old.idle.system = false;
  const pending = s.switching();
  s.load();
  await s.feed();
  expect(s.phases).toEqual(['loading', 'waiting']);
  const reason = Error('cancelled by user');
  s.router.cancel(reason);
  await expect(pending).rejects.toBe(reason);
  await s.feed();
  expect(s.candidate.close).toHaveBeenCalledOnce();
  expect(s.candidate.feed).not.toHaveBeenCalled();
  expect(s.old.close).not.toHaveBeenCalled();
  expect(s.old.feed).toHaveBeenCalledTimes(2);
});
it('两路输入都关闭时，候选就绪即可交接，无需等待下一包音频', async () => {
  const s = await setup();
  s.router.prepare([]);
  const switching = s.switching();
  s.load();
  await switching;
  expect(s.old.close).toHaveBeenCalledOnce();
  expect(s.events).toEqual([]);
});
it.each([false, true])('积压降级可在候选就绪前后请求，旧推理一直无响应也能切换 (%s)', async (alreadyReady) => {
  const s = await setup();
  let interrupt!: (error: Error) => void;
  s.old.feed.mockImplementationOnce(() => new Promise((_resolve, reject) => { interrupt = reject; }));
  s.old.close.mockImplementationOnce(async () => { interrupt(Error('retired')); });
  s.old.idle.system = false;
  const audio = s.feed();
  const switching = s.switching();
  if (alreadyReady) {
    s.load();
    await Promise.resolve();
    await Promise.resolve();
  }
  s.router.expedite();
  if (!alreadyReady) {
    expect(s.old.close).not.toHaveBeenCalled();
    s.load();
  }
  await switching;
  await audio;
  expect(s.old.close).toHaveBeenCalledOnce();
  expect(s.router.processedThrough('system')).toBeUndefined();
  expect(s.events).toContainEqual(expect.objectContaining({ type: 'gap', source: 'system' }));
  s.old.emit({ type: 'speech-start', source: 'system' });
  expect(s.events.some(event => event.type === 'speech-start')).toBe(false);
  await s.feed();
  expect(s.candidate.feed).toHaveBeenCalledOnce();
});
it('交接缓存仅含最后300ms的处理后PCM，切片后的时间戳连续，长包也有界', async () => {
  const s = await setup();
  await s.router.feed(
    'system',
    Float32Array.from({ length: 16000 }, (_, i) => i),
    16000,
    1000,
  );
  const pending = s.switching();
  s.load();
  await Promise.resolve();
  await Promise.resolve();
  await s.router.feed(
    'system',
    Float32Array.from({ length: 1600 }, (_, i) => 16000 + i),
    16000,
    2000,
  );
  await pending;
  const calls = s.candidate.feed.mock.calls;
  expect(calls.map((call) => call[1].length)).toEqual([3200, 1600]);
  expect(calls.map((call) => call[3])).toEqual([1800, 2000]);
  expect(calls.flatMap((call) => [...call[1]])).toEqual(
    Array.from({ length: 4800 }, (_, i) => i + 12800),
  );
  expect(s.router.processedThrough('system')).toBe(2100);
});
it('加载失败保留旧识别器、音频进度和后续转写，允许再次切换', async () => {
  const s = await setup();
  const pending = s.switching();
  const rejection = expect(pending).rejects.toThrow('model load failed');
  await s.feed();
  s.fail();
  await rejection;
  expect(s.old.close).not.toHaveBeenCalled();
  await s.feed('system', 100, 1100);
  expect(s.router.processedThrough('system')).toBe(1200);
  const retry = s.switching();
  s.load();
  await Promise.resolve();
  await Promise.resolve();
  await s.feed();
  await retry;
  expect(s.old.close).toHaveBeenCalledOnce();
});
it('候选预热失败或退出不会丢弃旧识别器，预热事件失败时不泄漏', async () => {
  for (const crash of [false, true]) {
    const s = await setup();
    s.candidate.feed.mockImplementationOnce(async () => {
      s.candidate.emit({ type: 'speech-start', source: 'system' });
      throw Error('prime failed');
    });
    const pending = s.switching();
    const rejection = expect(pending).rejects.toThrow(crash ? '已退出' : 'prime failed');
    s.load();
    await Promise.resolve();
    await Promise.resolve();
    if (crash) s.candidate.healthy = false;
    await s.feed();
    await rejection;
    expect(s.events).toEqual([]);
    expect(s.old.close).not.toHaveBeenCalled();
    await s.feed();
    expect(s.old.feed).toHaveBeenCalledTimes(2);
  }
});
it.each(['pause', 'stop', 'gap', 'close'] as const)(
  '%s 立即取消后台加载，不等待模型或静音',
  async (action) => {
    const s = await setup();
    const pending = s.switching(),
      rejection = expect(pending).rejects.toThrow('取消');
    if (action === 'gap') await s.router.discontinuity('system');
    else if (action === 'close') await s.router.close();
    else await s.router.flush(action);
    await rejection;
    expect(s.candidate.feed).not.toHaveBeenCalled();
    if (action !== 'close') expect(s.old.close).not.toHaveBeenCalled();
  },
);
it('120秒未等到共同停顿则撤销候选，不强行截断仍在说话的音源', async () => {
  vi.useFakeTimers();
  const s = await setup();
  s.old.idle.system = false;
  const pending = s.switching(),
    rejection = expect(pending).rejects.toThrow('安全停顿');
  s.load();
  await Promise.resolve();
  await Promise.resolve();
  await s.feed();
  await vi.advanceTimersByTimeAsync(120000);
  await rejection;
  expect(s.candidate.close).toHaveBeenCalledOnce();
  expect(s.old.close).not.toHaveBeenCalled();
});
it('180秒加载超时可取消，旧识别持续可用', async () => {
  vi.useFakeTimers();
  const s = await setup();
  const pending = s.switching(),
    rejection = expect(pending).rejects.toThrow('加载超时');
  await vi.advanceTimersByTimeAsync(180000);
  await rejection;
  await s.feed();
  expect(s.old.feed).toHaveBeenCalledOnce();
});
it('交接成功前保留候选预热的语音起点，成功后只转发一次', async () => {
  const s = await setup();
  s.candidate.feed.mockImplementationOnce(async () =>
    s.candidate.emit({ type: 'speech-start', source: 'system' }),
  );
  const pending = s.switching();
  s.load();
  await Promise.resolve();
  await Promise.resolve();
  await s.feed();
  await pending;
  expect(s.events).toEqual([{ type: 'speech-start', source: 'system' }]);
});
it('候选交接卡住至多占用旧队列1秒，撤销后旧识别继续', async () => {
  vi.useFakeTimers();
  const s = await setup();
  s.candidate.feed.mockImplementationOnce(() => new Promise(() => {}));
  const pending = s.switching(),
    rejection = expect(pending).rejects.toThrow('交接准备超时');
  s.load();
  await Promise.resolve();
  await Promise.resolve();
  const feed = s.feed();
  await vi.advanceTimersByTimeAsync(1000);
  await feed;
  await rejection;
  expect(s.old.close).not.toHaveBeenCalled();
  await s.feed();
  expect(s.old.feed).toHaveBeenCalledTimes(2);
});
it('旧识别器实际释放前禁止第三份模型并发加载，结束仍等待释放', async () => {
  const s = await setup();
  let released!: () => void;
  s.old.close.mockImplementationOnce(() => new Promise((resolve) => (released = resolve)));
  const pending = s.switching();
  s.load();
  await Promise.resolve();
  await Promise.resolve();
  await s.feed();
  await pending;
  await expect(s.switching()).rejects.toThrow('尚未确认释放');
  const closing = s.router.close();
  let done = false;
  void closing.then(() => (done = true));
  await Promise.resolve();
  expect(done).toBe(false);
  released();
  await closing;
  expect(done).toBe(true);
});
it('当前识别器释放失败仍等待退休识别器退出，最后才报告原故障', async () => {
  const s = await setup();
  let release!: () => void;
  s.old.close.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));
  const switching = s.switching();
  s.load();
  await Promise.resolve();
  await Promise.resolve();
  await s.feed();
  await switching;
  s.candidate.close.mockRejectedValueOnce(Error('current cleanup failed'));
  let settled = false;
  const closing = s.router.close().finally(() => (settled = true));
  const rejected = expect(closing).rejects.toThrow('current cleanup failed');
  try {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toBe(false);
  } finally {
    release();
    await rejected;
  }
});
