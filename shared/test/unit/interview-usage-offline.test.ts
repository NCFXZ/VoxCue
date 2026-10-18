import { afterEach, expect, it, vi } from 'vitest';
import { useInterview } from '../../src/stores/interview';
import type { SpeechEvent, SpeechSegment } from '../../electron/contracts/speech';
import type { ChatEvent } from '../../electron/contracts/chat';

afterEach(() => {
  useInterview.getState().reset();
  useInterview.setState({ configurationLocked: false });
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function liveFixture() {
  vi.useFakeTimers();
  let receive!: (event: SpeechEvent) => void;
  const answer = vi.fn(
    async (_request: { question: string; modelId: string; effort?: string }) => ({
      ok: true,
      answerText: '仅验证载荷与生命周期的合成响应',
      usage: null,
      sources: [],
    }),
  );
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} });
  vi.stubGlobal('window', {
    desktop: {
      speech: vi.fn(async () => ({ state: 'running', model: 'offline-synthetic' })),
      onSpeechEvent: (callback: typeof receive) => {
        receive = callback;
        return () => {
          receive = () => {};
        };
      },
      onChatEvent: () => () => {},
      interviewCancel: vi.fn(async () => {}),
      interviewAnswer: answer,
    },
  });
  useInterview.getState().reset();
  useInterview.setState({ configurationLocked: false });
  useInterview
    .getState()
    .configure({ mode: 'local', aiEnabled: true, modelId: 'offline-model', effort: 'high' });
  useInterview.getState().setAutoAnswer(true);
  useInterview.getState().start();
  await vi.advanceTimersByTimeAsync(1);
  receive({ type: 'status', status: { state: 'running', model: 'offline-synthetic' } });
  let serial = 0;
  const emit = (text: string, patch: Partial<SpeechSegment> = {}) => {
    const segment: SpeechSegment = {
      id: 'oral-' + ++serial,
      source: 'system',
      text,
      final: true,
      reason: 'silence',
      startMs: Date.now(),
      endMs: Date.now() + 10,
      ...patch,
    };
    receive({ type: 'segment', segment });
    return segment;
  };
  return { answer, emit, receive };
}

it.each([
  '那为啥这么选',
  'PostgreSQL咋保证一致性的',
  '没听清再说一遍',
  '我刚说岔了是SQLite',
  '继续',
  '能不能整一个例子',
  '俩方案有啥不一样',
  '不对不对归档库才用SQLite',
  '木有缓存的时候咋整',
  'why postgres instead of redis',
])('带语气词、无标点的有效口语仍按原节奏原样发送：%s', async (question) => {
  const { answer, emit } = await liveFixture();
  const prefixes = ['', '嗯', '呃就是', '那个', '嗯嗯，', 'uh '];
  for (const prefix of prefixes) {
    const text = prefix + question;
    const before = answer.mock.calls.length;
    const segment = emit(text);
    await vi.advanceTimersByTimeAsync(2199);
    expect(answer).toHaveBeenCalledTimes(before);
    await vi.advanceTimersByTimeAsync(1);
    expect(answer).toHaveBeenCalledTimes(before + 1);
    expect(answer.mock.calls.at(-1)?.[0]).toMatchObject({
      question: text,
      modelId: 'offline-model',
      effort: 'high',
    });
    expect(useInterview.getState().answers.at(-1)?.sourceTranscriptIds).toEqual([segment.id]);
    expect(useInterview.getState().transcripts.at(-1)?.text).toBe(text);
  }
});

it('连续明确回应逐次自动提交，手动发送及随后的实质问题完整保留', async () => {
  const { answer, emit } = await liveFixture();
  const phrases = [
    '嗯',
    '好的',
    '谢谢',
    '嗯嗯嗯',
    '呃呃',
    '哦哦好的明白了',
    '嗯好的谢谢',
    'OK, thank you!',
  ];
  for (const [index, phrase] of phrases.entries()) {
    emit(phrase);
    await vi.advanceTimersByTimeAsync(2199);
    expect(answer).toHaveBeenCalledTimes(index);
    await vi.advanceTimersByTimeAsync(1);
    expect(answer).toHaveBeenCalledTimes(index + 1);
    expect(answer.mock.calls.at(-1)?.[0].question).toBe(phrase);
    expect(useInterview.getState().draftQuestion).toBe('');
  }
  useInterview.getState().setAutoAnswer(false);
  emit('谢谢您');
  await vi.advanceTimersByTimeAsync(3000);
  expect(answer).toHaveBeenCalledTimes(phrases.length);
  await useInterview.getState().submitTranscript();
  expect(answer.mock.calls.at(-1)?.[0].question).toBe('谢谢您');
  useInterview.getState().setAutoAnswer(true);
  emit('嗯那为啥不用Redis');
  await vi.advanceTimersByTimeAsync(2200);
  expect(answer.mock.calls.at(-1)?.[0].question).toBe('嗯那为啥不用Redis');
  expect(useInterview.getState().transcripts.map((row) => row.text)).toEqual([
    ...phrases,
    '谢谢您',
    '嗯那为啥不用Redis',
  ]);
});

it('临时语气词不会提前回答，终稿修订、重复终稿和迟到临时结果不引发重复调用', async () => {
  const { answer, emit } = await liveFixture();
  emit('嗯', { id: 'revised', final: false });
  await vi.advanceTimersByTimeAsync(3000);
  expect(answer).not.toHaveBeenCalled();
  const text = '嗯嗯不是这个我想问PostgreSQL的并发问题';
  emit(text, { id: 'revised' });
  emit('嗯', { id: 'revised', final: false });
  emit(text, { id: 'revised' });
  await vi.advanceTimersByTimeAsync(2200);
  expect(answer).toHaveBeenCalledOnce();
  expect(answer.mock.calls[0][0].question).toBe(text);
  expect(useInterview.getState().transcripts.map((row) => row.text)).toEqual([text]);
  await vi.advanceTimersByTimeAsync(6000);
  expect(answer).toHaveBeenCalledOnce();
});

it('语气词后出现尚未完成的问句会取消旧定时器，等完整终稿再发送', async () => {
  const { answer, emit } = await liveFixture();
  emit('嗯好的');
  await vi.advanceTimersByTimeAsync(500);
  emit('那那个', { id: 'half', final: false });
  await vi.advanceTimersByTimeAsync(3000);
  expect(answer).not.toHaveBeenCalled();
  emit('那那个项目咋做回滚', { id: 'half' });
  await vi.advanceTimersByTimeAsync(2200);
  expect(answer).toHaveBeenCalledOnce();
  expect(answer.mock.calls[0][0].question).toBe('嗯好的 那那个项目咋做回滚');
});

it('长句分段和短停顿合并，麦克风插话不触发模型或丢掉系统问题', async () => {
  const { answer, emit } = await liveFixture();
  const first = emit('嗯说说PostgreSQL', { reason: 'limit' });
  await vi.advanceTimersByTimeAsync(3000);
  expect(answer).not.toHaveBeenCalled();
  emit('我刚说岔了是SQLite', { source: 'microphone' });
  const second = emit('就是那个一致性咋处理');
  await vi.advanceTimersByTimeAsync(1200);
  const third = emit('尤其是并发写入的时候');
  await vi.advanceTimersByTimeAsync(2199);
  expect(answer).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(answer).toHaveBeenCalledOnce();
  expect(answer.mock.calls[0][0].question).toBe(
    '嗯说说PostgreSQL 就是那个一致性咋处理 尤其是并发写入的时候',
  );
  expect(useInterview.getState().answers[0].sourceTranscriptIds).toEqual([
    first.id,
    second.id,
    third.id,
  ]);
  expect(useInterview.getState().transcripts.find((row) => row.source === 'microphone')?.text).toBe(
    '我刚说岔了是SQLite',
  );
});

it('生成期间排队的口语纠正只提交一次，保留排队语气词和下一轮关联', async () => {
  const { answer, emit } = await liveFixture();
  let finish!: (value: Awaited<ReturnType<typeof answer>>) => void;
  answer.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const pending = useInterview.getState().ask('介绍项目A');
  emit('嗯嗯嗯');
  await vi.advanceTimersByTimeAsync(2200);
  emit('不是不是我刚讲反了是SQLite');
  await vi.advanceTimersByTimeAsync(2200);
  expect(answer).toHaveBeenCalledOnce();
  finish({ ok: true, answerText: '旧回答', usage: null, sources: [] });
  await pending;
  await vi.advanceTimersByTimeAsync(1);
  expect(answer).toHaveBeenCalledTimes(2);
  expect(answer.mock.calls[1][0].question).toBe('嗯嗯嗯 不是不是我刚讲反了是SQLite');
  expect(useInterview.getState().draftQuestion).toBe('');
  await vi.advanceTimersByTimeAsync(6000);
  expect(answer).toHaveBeenCalledTimes(2);
});

it.each(['off', 'pause', 'reset'] as const)('待发口语问题在%s后不产生后台调用', async (action) => {
  const { answer, emit } = await liveFixture();
  emit('嗯嗯那咋保证实时性');
  await vi.advanceTimersByTimeAsync(2199);
  if (action === 'off') useInterview.getState().setAutoAnswer(false);
  else if (action === 'pause') useInterview.getState().pause();
  else useInterview.getState().reset();
  await vi.advanceTimersByTimeAsync(6000);
  expect(answer).not.toHaveBeenCalled();
});

it('按优化前静音规则与恢复后的自动规则离线回放，请求、原文和时序一致', async () => {
  const phrases = [
    '介绍项目A',
    '好的',
    '为什么选PostgreSQL',
    '嗯',
    '继续',
    '谢谢',
    '刚才项目A的延迟是多少',
    '不对，应该是42毫秒',
    '为什么这样',
    '明白了',
  ];
  const replay = async (automatic: boolean) => {
    vi.useFakeTimers();
    let emit!: (event: SpeechEvent) => void;
    let chatEvent!: (event: ChatEvent) => void;
    const requests: { question: string; modelId: string; effort?: string; at: number }[] = [];
    const submitted: number[] = [];
    const arrivals: number[] = [];
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} });
    vi.stubGlobal('window', {
      desktop: {
        speech: vi.fn(async () => ({ state: 'running', model: 'offline-synthetic' })),
        onSpeechEvent: (callback: typeof emit) => {
          emit = callback;
          return () => {};
        },
        onChatEvent: (callback: typeof chatEvent) => {
          chatEvent = callback;
          return () => {};
        },
        interviewCancel: vi.fn(async () => {}),
        interviewAnswer: vi.fn(
          async (request: { id: string; question: string; modelId: string; effort?: string }) => {
            requests.push({
              question: request.question,
              modelId: request.modelId,
              effort: request.effort,
              at: Date.now(),
            });
            submitted.push(Date.now());
            await new Promise((resolve) => setTimeout(resolve, 12));
            chatEvent({ id: request.id, type: 'delta', text: '离线合成响应' });
            return { ok: true, answerText: '离线合成响应', usage: null, sources: [] };
          },
        ),
      },
    });
    useInterview.getState().reset();
    useInterview.setState({ configurationLocked: false });
    useInterview
      .getState()
      .configure({ mode: 'local', aiEnabled: true, modelId: 'offline-model', effort: 'high' });
    useInterview.getState().setAutoAnswer(automatic);
    useInterview.getState().start();
    await vi.advanceTimersByTimeAsync(1);
    emit({ type: 'status', status: { state: 'running', model: 'offline-synthetic' } });
    for (const [index, text] of phrases.entries()) {
      arrivals.push(Date.now());
      emit({
        type: 'segment',
        segment: {
          id: 'phrase-' + index,
          source: 'system',
          text,
          final: true,
          reason: 'silence',
          startMs: Date.now(),
          endMs: Date.now() + 10,
        },
      });
      await vi.advanceTimersByTimeAsync(2200);
      const manual = automatic ? undefined : useInterview.getState().submitTranscript();
      await vi.advanceTimersByTimeAsync(20);
      await manual;
    }
    const transcripts = useInterview.getState().transcripts.map((row) => row.text);
    const delays = submitted.map(
      (time) => time - [...arrivals].reverse().find((arrival) => arrival <= time)!,
    );
    useInterview.getState().reset();
    return { requests, transcripts, delays };
  };
  const before = await replay(false);
  const after = await replay(true);
  expect(before.requests).toHaveLength(10);
  expect(after.requests).toHaveLength(phrases.length);
  expect(after.requests.map((request) => request.question)).toEqual(phrases);
  expect(after.requests.map((request) => request.question)).toEqual(
    before.requests.map((request) => request.question),
  );
  expect(after.transcripts).toEqual(phrases);
  expect(after.transcripts).toEqual(before.transcripts);
  for (const phrase of phrases)
    expect(after.requests.some((request) => request.question.includes(phrase))).toBe(true);
  for (const request of [...before.requests, ...after.requests])
    expect(request).toMatchObject({ modelId: 'offline-model', effort: 'high' });
  expect(before.delays.every((delay) => delay === 2200)).toBe(true);
  expect(after.delays.every((delay) => delay === 2200)).toBe(true);
  console.log(
    'OFFLINE_REQUESTS ' +
      JSON.stringify({
        oldRule: before.requests.length,
        restored: after.requests.length,
        retainedTranscripts: after.transcripts.length,
        autoSubmitMs: 2200,
      }),
  );
});
