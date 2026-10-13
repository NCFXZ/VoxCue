import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { useDictation } from '../src/stores/dictation';
import type { SpeechEvent } from '../electron/contracts/speech';
let emit: (event: SpeechEvent) => void;
let start: ReturnType<typeof vi.fn>;
beforeEach(() => {
  start = vi.fn(async () => ({ state: 'running', model: 'test' }));
  vi.stubGlobal('window', {
    desktop: {
      dictation: vi.fn((c) =>
        c.op === 'start' ? start() : Promise.resolve({ state: 'idle', model: 'test' }),
      ),
      onDictationEvent: vi.fn((callback) => {
        emit = callback;
        return vi.fn();
      }),
    },
  });
  useDictation.setState({ phase: 'idle', error: null });
});
afterEach(async () => {
  await useDictation.getState().stop();
  vi.unstubAllGlobals();
});
const segment = (id: string, text: string, final = false): SpeechEvent => ({
  type: 'segment',
  segment: {
    id,
    text,
    final,
    source: 'microphone',
    startMs: 0,
    endMs: 1000,
  },
});
it('临时文字替换而非重复追加，终稿冻结，只接收麦克风，停止保留最后一句', async () => {
  const onText = vi.fn();
  await useDictation.getState().start(onText);
  emit(segment('one', '请'));
  emit(segment('one', '请帮我'));
  emit(segment('one', '请帮我', true));
  emit(segment('one', '迟到文字'));
  emit({
    type: 'segment',
    segment: {
      id: 'system',
      text: '不应输入',
      final: true,
      source: 'system',
      startMs: 0,
      endMs: 1,
    },
  });
  expect(onText).toHaveBeenLastCalledWith('请帮我');
  vi.mocked(window.desktop!.dictation).mockImplementationOnce(async () => {
    emit(segment('two', '准备面试', true));
    emit({ type: 'status', status: { state: 'idle', model: 'test' } });
    return { state: 'idle', model: 'test' };
  });
  await useDictation.getState().stop();
  expect(onText).toHaveBeenLastCalledWith('请帮我 准备面试');
  expect(useDictation.getState().phase).toBe('idle');
  const count = onText.mock.calls.length;
  emit(segment('late', '不可回写'));
  expect(onText).toHaveBeenCalledTimes(count);
});
it('加载期间可停止，旧启动回包不会重新亮起麦克风或写入下一次输入', async () => {
  let resolve!: (value: unknown) => void;
  start.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const oldText = vi.fn();
  const loading = useDictation.getState().start(oldText);
  const oldEmit = emit;
  expect(useDictation.getState().phase).toBe('loading');
  await useDictation.getState().stop();
  resolve({ state: 'running', model: 'test' });
  await loading;
  expect(useDictation.getState().phase).toBe('idle');
  const newText = vi.fn();
  await useDictation.getState().start(newText);
  oldEmit(segment('old', '旧录音'));
  emit(segment('new', '新问题'));
  expect(oldText).not.toHaveBeenCalled();
  expect(newText).toHaveBeenLastCalledWith('新问题');
});
it('真实语音失败显示错误，可再次点击重试，不回退模拟', async () => {
  start.mockRejectedValueOnce(Error('麦克风不可用'));
  const onText = vi.fn();
  await useDictation.getState().start(onText);
  expect(useDictation.getState()).toMatchObject({ phase: 'idle', error: '麦克风不可用' });
  expect(onText).not.toHaveBeenCalled();
  await useDictation.getState().start(onText);
  expect(useDictation.getState()).toMatchObject({ phase: 'recording', error: null });
});
