import { afterEach, expect, it, vi } from 'vitest';
import { useInterview } from '../../src/stores/interview';
import type { SpeechEvent, SpeechSegment } from '../../electron/contracts/speech';
import type { ChatEvent } from '../../electron/contracts/chat';

let audioEvents: ((event: SpeechEvent) => void) | undefined;
async function advanceAudio(ms: number) {
  await vi.advanceTimersByTimeAsync(ms);
  audioEvents?.({
    type: 'audio-progress',
    source: 'system',
    pending: false,
    processedThroughMs: Date.now(),
  });
  await vi.advanceTimersByTimeAsync(0);
}
afterEach(() => {
  audioEvents = undefined;
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
        audioEvents = callback;
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
  await advanceAudio(1);
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
      endMs: Date.now(),
      silenceStartMs: Date.now() - 800,
      ...patch,
    };
    receive({ type: 'segment', segment });
    return segment;
  };
  return { answer, emit, receive };
}

it('resumes the interview after automatic audio recovery without submitting the interrupted question', async () => {
  const { answer, emit, receive } = await liveFixture();
  emit('为什么这段输入会中断', { final: false });
  receive({ type: 'status', status: {
    state: 'error', model: 'offline-synthetic', error: '音频已中断，正在自动重新连接…',
  } });
  receive({ type: 'gap', source: 'system', message: '音频已中断，正在自动重新连接…' });
  expect(useInterview.getState()).toMatchObject({
    status: 'paused', speechError: '音频已中断，正在自动重新连接…', draftQuestion: '',
  });
  receive({ type: 'status', status: { state: 'loading', model: 'offline-synthetic' } });
  await advanceAudio(2000);
  expect(answer).not.toHaveBeenCalled();
  receive({ type: 'status', status: { state: 'running', model: 'offline-synthetic' } });
  expect(useInterview.getState()).toMatchObject({ status: 'running', speechError: null });
  receive({ type: 'activity', source: 'system', level: 0.1, speaking: true });
  expect(useInterview.getState().speechWarnings.system).toBeUndefined();
  emit('PostgreSQL 如何保证一致性');
  await advanceAudio(1000);
  expect(answer).toHaveBeenCalledOnce();
  expect(answer.mock.calls[0][0].question).toBe('PostgreSQL 如何保证一致性');
});

it('ignores a late recovered-running event after the interview session has been reset', async () => {
  const { answer, receive } = await liveFixture();
  receive({ type: 'status', status: {
    state: 'error', model: 'offline-synthetic', error: '音频已中断，正在自动重新连接…',
  } });
  useInterview.getState().reset();
  receive({ type: 'status', status: { state: 'running', model: 'offline-synthetic' } });
  expect(useInterview.getState().status).toBe('idle');
  await advanceAudio(2000);
  expect(answer).not.toHaveBeenCalled();
});

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
    await advanceAudio(999);
    expect(answer).toHaveBeenCalledTimes(before);
    await advanceAudio(1);
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

it('连续纯回应不发起 AI 请求，原文与关联保留且手动仍可发送', async () => {
  const { answer, emit } = await liveFixture();
  const phrases = ['嗯', '好的', '嗯嗯嗯', '呃呃', '哦哦好的明白', '嗯好的'];
  for (const [index, phrase] of phrases.entries()) {
    emit(phrase);
    await advanceAudio(999);
    expect(answer).not.toHaveBeenCalled();
    await advanceAudio(1);
    expect(answer).not.toHaveBeenCalled();
    expect(useInterview.getState().draftQuestion).toBe(phrases.slice(0, index + 1).join(' '));
  }
  expect(useInterview.getState().answers).toEqual([]);
  await advanceAudio(6000);
  expect(answer).not.toHaveBeenCalled();
  await useInterview.getState().submitTranscript();
  expect(answer).toHaveBeenCalledOnce();
  expect(answer.mock.calls[0][0].question).toBe(phrases.join(' '));
  expect(useInterview.getState().answers[0].sourceTranscriptIds).toHaveLength(phrases.length);
  await advanceAudio(6000);
  expect(answer).toHaveBeenCalledOnce();
  expect(useInterview.getState().draftQuestion).toBe('');
  useInterview.getState().setAutoAnswer(false);
  emit('谢谢您');
  await advanceAudio(3000);
  expect(answer).toHaveBeenCalledOnce();
  await useInterview.getState().submitTranscript();
  expect(answer.mock.calls.at(-1)?.[0].question).toBe('谢谢您');
  useInterview.getState().setAutoAnswer(true);
  emit('嗯那为啥不用Redis');
  await advanceAudio(1000);
  expect(answer.mock.calls.at(-1)?.[0].question).toBe('嗯那为啥不用Redis');
  expect(useInterview.getState().transcripts.map((row) => row.text)).toEqual([
    ...phrases,
    '谢谢您',
    '嗯那为啥不用Redis',
  ]);
});

it.each([
  '那个',
  '这个',
  '就是',
  '然后',
  '怎么说呢',
  '然后呢？',
  '为什么呢？',
  '行吗？',
  '谢谢',
  '谢谢您',
  'OK, thank you!',
])('未批准过滤的口头衔接或有效短问继续原样自动发送：%s', async (text) => {
  const { answer, emit } = await liveFixture();
  emit(text);
  await advanceAudio(1000);
  expect(answer).toHaveBeenCalledOnce();
  expect(answer.mock.calls[0][0].question).toBe(text);
});

it('纯回应被忽略后保留原文与 Qwen continuation，后续有效追问仍只发送一次', async () => {
  const { answer, emit } = await liveFixture();
  const original = emit('嗯？', { speechModel: 'qwen' });
  await advanceAudio(1000);
  expect(answer).not.toHaveBeenCalled();
  emit('嗯？', { ...original });
  const continuation = emit('为什么呢？', {
    id: 'continued',
    continuationOf: original.id,
    speechModel: 'qwen',
  });
  await advanceAudio(1000);
  expect(answer).toHaveBeenCalledOnce();
  expect(answer.mock.calls[0][0].question).toBe('嗯？ 为什么呢？');
  expect(useInterview.getState().answers[0].sourceTranscriptIds).toEqual([
    original.id,
    continuation.id,
  ]);
  await advanceAudio(6000);
  expect(answer).toHaveBeenCalledOnce();
});

it('生成期间排队的纯回应在旧回答完成后仍不产生追加请求或回答', async () => {
  const { answer, emit } = await liveFixture();
  let finish!: (value: Awaited<ReturnType<typeof answer>>) => void;
  answer.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const first = useInterview.getState().ask('介绍项目');
  emit('呃，嗯，好的？');
  await advanceAudio(2000);
  finish({ ok: true, answerText: '旧回答', usage: null, sources: [] });
  await first;
  await advanceAudio(6000);
  expect(answer).toHaveBeenCalledOnce();
  expect(useInterview.getState().answers).toHaveLength(1);
  expect(useInterview.getState().draftQuestion).toBe('呃，嗯，好的？');
  await useInterview.getState().submitTranscript();
  expect(answer).toHaveBeenCalledTimes(2);
  expect(answer.mock.calls[1][0].question).toBe('呃，嗯，好的？');
});

it('换模型期间就绪的纯回应不在模型切换完成后误发，手动使用新模型正常发送', async () => {
  const { answer, emit } = await liveFixture();
  let finish!: (value: any) => void;
  Object.assign(window.desktop!, {
    updateInterviewModel: vi.fn(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    ),
  });
  const changing = useInterview.getState().updateModel('new-model', 'high');
  emit('哦好的');
  await advanceAudio(2000);
  expect(answer).not.toHaveBeenCalled();
  finish({ ok: true, modelId: 'new-model', effort: 'high' });
  await changing;
  await advanceAudio(6000);
  expect(answer).not.toHaveBeenCalled();
  expect(useInterview.getState().draftQuestion).toBe('哦好的');
  await useInterview.getState().submitTranscript();
  expect(answer).toHaveBeenCalledOnce();
  expect(answer.mock.calls[0][0]).toMatchObject({ question: '哦好的', modelId: 'new-model' });
});

it('临时语气词不会提前回答，终稿修订、重复终稿和迟到临时结果不引发重复调用', async () => {
  const { answer, emit } = await liveFixture();
  emit('嗯', { id: 'revised', final: false });
  await advanceAudio(3000);
  expect(answer).not.toHaveBeenCalled();
  const text = '嗯嗯不是这个我想问PostgreSQL的并发问题';
  emit(text, { id: 'revised' });
  emit('嗯', { id: 'revised', final: false });
  emit(text, { id: 'revised' });
  await advanceAudio(1000);
  expect(answer).toHaveBeenCalledOnce();
  expect(answer.mock.calls[0][0].question).toBe(text);
  expect(useInterview.getState().transcripts.map((row) => row.text)).toEqual([text]);
  await advanceAudio(6000);
  expect(answer).toHaveBeenCalledOnce();
});

it('语气词后出现尚未完成的问句会取消旧定时器，等完整终稿再发送', async () => {
  const { answer, emit } = await liveFixture();
  emit('嗯好的');
  await advanceAudio(500);
  emit('那那个', { id: 'half', final: false });
  await advanceAudio(3000);
  expect(answer).not.toHaveBeenCalled();
  emit('那那个项目咋做回滚', { id: 'half' });
  await advanceAudio(1000);
  expect(answer).toHaveBeenCalledOnce();
  expect(answer.mock.calls[0][0].question).toBe('嗯好的 那那个项目咋做回滚');
});

it('长句分段和短停顿合并，麦克风插话不触发模型或丢掉系统问题', async () => {
  const { answer, emit } = await liveFixture();
  const first = emit('嗯说说PostgreSQL', { reason: 'limit' });
  await advanceAudio(3000);
  expect(answer).not.toHaveBeenCalled();
  emit('我刚说岔了是SQLite', { source: 'microphone' });
  const second = emit('就是那个一致性咋处理');
  await advanceAudio(999);
  const third = emit('尤其是并发写入的时候');
  await advanceAudio(999);
  expect(answer).not.toHaveBeenCalled();
  await advanceAudio(1);
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
  await advanceAudio(1000);
  emit('不是不是我刚讲反了是SQLite');
  await advanceAudio(1000);
  expect(answer).toHaveBeenCalledOnce();
  finish({ ok: true, answerText: '旧回答', usage: null, sources: [] });
  await pending;
  await advanceAudio(1);
  expect(answer).toHaveBeenCalledTimes(2);
  expect(answer.mock.calls[1][0].question).toBe('嗯嗯嗯 不是不是我刚讲反了是SQLite');
  expect(useInterview.getState().draftQuestion).toBe('');
  await advanceAudio(6000);
  expect(answer).toHaveBeenCalledTimes(2);
});

it.each(['off', 'pause', 'reset'] as const)('待发口语问题在%s后不产生后台调用', async (action) => {
  const { answer, emit } = await liveFixture();
  emit('嗯嗯那咋保证实时性');
  await advanceAudio(999);
  if (action === 'off') useInterview.getState().setAutoAnswer(false);
  else if (action === 'pause') useInterview.getState().pause();
  else useInterview.getState().reset();
  await advanceAudio(6000);
  expect(answer).not.toHaveBeenCalled();
});

it('离线回放减少纯回应独立请求，完整原文和有效问题关联保持', async () => {
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
          audioEvents = callback;
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
    await advanceAudio(1);
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
          endMs: Date.now(),
          silenceStartMs: Date.now() - 800,
        },
      });
      await advanceAudio(1000);
      const manual = automatic ? undefined : useInterview.getState().submitTranscript();
      await advanceAudio(20);
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
  expect(before.requests.map((request) => request.question)).toEqual(phrases);
  expect(after.requests.map((request) => request.question)).toEqual([
    '介绍项目A',
    '好的 为什么选PostgreSQL',
    '嗯 继续',
    ...phrases.slice(5),
  ]);
  expect(after.requests).toHaveLength(8);
  expect(after.transcripts).toEqual(phrases);
  expect(after.transcripts).toEqual(before.transcripts);
  for (const phrase of phrases)
    expect(after.requests.some((request) => request.question.includes(phrase))).toBe(true);
  for (const request of [...before.requests, ...after.requests])
    expect(request).toMatchObject({ modelId: 'offline-model', effort: 'high' });
  expect(before.delays.every((delay) => delay === 1000)).toBe(true);
  expect(after.delays.every((delay) => delay === 1000)).toBe(true);
  console.log(
    'OFFLINE_REQUESTS ' +
      JSON.stringify({
        manualRequests: before.requests.length,
        automaticRequests: after.requests.length,
        retainedTranscripts: after.transcripts.length,
        silenceBeforeFinalMs: 800,
        totalSilenceMs: 1800,
        remainingAudioMs: 1000,
      }),
  );
});
