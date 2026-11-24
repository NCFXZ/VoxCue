import { expect, it, vi } from 'vitest';
import { createApiChatService } from '../../electron/backend/api/service';
import { ChatGPTService } from '../../electron/backend/chat/service';
import type { UsageLedger } from '../../electron/backend/chat/usage';
import type { ApiProvider } from '../../electron/contracts/apiConnections';
import type { ChatEvent, ChatRequest } from '../../electron/contracts/chat';
import type { ProfileChanges } from '../../electron/contracts/profile';
import { codexAccess } from '../fixtures/codex-access';

const openai = 'https://api.openai.com/v1/responses';
const deepseek = 'https://api.deepseek.com/chat/completions';
const deepseekResponses = 'https://api.deepseek.com/responses';
const key = 'synthetic-profile-recovery-key';
const profile = Object.freeze({
  name: '合成测试用户',
  background: '合成简历摘要',
  jobDescription: '合成职位描述原件',
  language: '简体中文',
  customInstructions: '合成答复偏好',
});
const initialText = '第一份可见草稿。';
const malformed = `{"answer":"${initialText}","changes":{`;
const finalText = '已生成资料修改提案，请确认后保存。';

function replyFor(changes: ProfileChanges, answer = finalText) {
  return JSON.stringify({
    answer,
    changes: { name: null, language: null, background: null, jobDescription: null, customInstructions: null, skills: null, ...changes },
    skillScope: null,
  });
}

const intent = (kind: 'none' | 'proposal') => `<profile_intent>${kind}</profile_intent>`;
const deepseekMalformed = `${intent('proposal')}\n${initialText}\n<profile_proposal>\n{"changes":{`;
function deepseekReply(changes?: ProfileChanges, answer = finalText) {
  return changes
    ? `${intent('proposal')}\n${answer}\n<profile_proposal>\n${JSON.stringify({ changes, skillScope: null })}\n</profile_proposal>`
    : `${intent('none')}\n${answer}`;
}

function request(modelId: string, prompt = '把之前的职位描述删掉'): ChatRequest {
  return {
    id: 'api-profile-recovery', modelId, instructions: '根据当前上下文答复。', profile, webSearch: true,
    turns: [
      { role: 'user', content: '之前保存的是哪份岗位资料？' },
      { role: 'assistant', content: '之前保存了一份岗位描述摘要。' },
      { role: 'user', content: prompt },
    ],
  };
}

function sse(...events: object[]) {
  return new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''), {
    headers: { 'content-type': 'text/event-stream' },
  });
}

function completion(text: string, finishReason: string | null = 'stop') {
  return sse({ choices: [{ delta: { content: text }, finish_reason: finishReason }] });
}

const visibleDeltas = (events: ChatEvent[]) => events.reduce((answer, event) => {
  if (event.type !== 'delta') return answer;
  return event.replace ? event.text : answer + event.text;
}, '');

function deepseekCatalog(id = 'deepseek-flash') {
  return Response.json({ data: [{ id, effort: { supported_levels: ['low', 'high', 'max'] } }] });
}

function responses(text: string) {
  return sse(
    { type: 'response.output_text.delta', delta: text },
    { type: 'response.completed', response: { id: 'profile-recovery-test', status: 'completed', output: [] } },
  );
}

const ledger = () => ({ add: vi.fn() }) as unknown as UsageLedger;
const api = (provider: ApiProvider, fetcher: typeof fetch) =>
  createApiChatService(provider, async () => ({ key }), ledger(), fetcher);

it.each(['deepseek-flash', 'deepseek-v4-pro'])('streams an ordinary answer on %s without inventing a profile proposal or retrying', async model => {
  const answer = '根据你已提供的资料，可以从项目实践和技术表达两方面分析优势。';
  const before = { ...profile };
  const fetcher = vi.fn<typeof fetch>(async (url, init) => init?.method !== 'POST'
    ? deepseekCatalog(model)
    : String(url).endsWith('/responses') ? responses(deepseekReply(undefined, answer)) : completion(deepseekReply(undefined, answer)));
  const events: ChatEvent[] = [];
  const result = await api('deepseek', fetcher).stream(request(model, '我的优势是什么'), event => events.push(event), new AbortController().signal);
  expect(result.answerText).toBe(answer);
  expect(visibleDeltas(events)).toBe(answer);
  expect(result.profileChanges).toBeUndefined();
  expect(events.some(event => event.type === 'profile-preview')).toBe(false);
  expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
  expect(profile).toEqual(before);
});

it('reports an unstructured ordinary answer after one structure follow-up without a full retry', async () => {
  const wire = '{"answer":"已收到普通问题。","changes":';
  const fetcher = vi.fn<typeof fetch>(async (_url, init) => init?.method !== 'POST'
    ? deepseekCatalog() : completion(wire));
  const events: ChatEvent[] = [];
  await expect(api('deepseek', fetcher).stream(request('deepseek-flash', '我的优势是什么'), event => events.push(event), new AbortController().signal))
    .rejects.toThrow('DeepSeek 没有标明本轮是否修改资料，个人信息未修改。');
  expect(visibleDeltas(events)).toBe(wire);
  expect(events.some(event => event.type === 'profile-preview')).toBe(false);
  expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(2);
});

const models = [
  { provider: 'openai', model: 'gpt-6.2-astra', firstUrl: openai, retryUrl: openai, prompt: '删掉我之前填的职位描述' },
  { provider: 'deepseek', model: 'deepseek-flash', firstUrl: deepseek, retryUrl: deepseek, prompt: '我的资料里可以用小林称呼我。', changes: { name: '小林' } },
  { provider: 'deepseek', model: 'deepseek-v4-pro', firstUrl: deepseekResponses, retryUrl: deepseek, prompt: '目标岗位要求先删掉' },
] as const;

it.each(models)('recovers a profile proposal on the same API model $model', async row => {
  const deepSeek = row.provider === 'deepseek';
  const input = request(row.model, row.prompt);
  if (row.provider === 'deepseek') input.effort = 'high';
  const expected = row.changes ?? { jobDescription: '' };
  const recovered = row.provider === 'deepseek' ? deepseekReply(expected) : replyFor(expected);
  const firstReply = row.provider === 'deepseek' ? deepseekMalformed : malformed;
  const attempts: { url: string; body: Record<string, unknown> }[] = [];
  const fetcher = vi.fn<typeof fetch>(async (url, init) => {
    expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${key}`);
    if (init?.method !== 'POST') return row.provider === 'deepseek'
      ? deepseekCatalog(row.model) : Response.json({ data: [{ id: row.model }] });
    const endpoint = String(url);
    const body = JSON.parse(String(init.body));
    attempts.push({ url: endpoint, body });
    if (attempts.length > 1) return endpoint === openai ? responses(recovered) : completion(recovered);
    return endpoint.endsWith('/responses') ? responses(firstReply) : completion(firstReply);
  });
  const events: ChatEvent[] = [];
  const before = { ...profile };
  const result = await api(row.provider, fetcher).stream(input, event => events.push(event), new AbortController().signal);

  // DeepSeek keeps the shown answer and only asks again for its proposal structure.
  expect(result).toMatchObject({ answerText: deepSeek ? initialText : finalText });
  expect(result.profileChanges).toEqual(expected);
  expect(profile).toEqual(before);
  expect(visibleDeltas(events)).toBe(initialText);
  expect(events.filter(event => event.type === 'provider')).toEqual([
    expect.objectContaining({ provider: expect.objectContaining({ id: row.provider }) }),
  ]);
  expect(attempts.map(attempt => attempt.url)).toEqual([row.firstUrl, row.retryUrl]);
  expect(attempts.map(attempt => attempt.body.model)).toEqual([row.model, row.model]);
  expect(attempts[1].body).not.toHaveProperty('tools');
  const retry = JSON.stringify(attempts[1].body);
  for (const context of [input.instructions, ...Object.values(before), ...input.turns.map(turn => turn.content)])
    expect(retry).toContain(context);
  if (deepSeek) {
    expect(retry).toContain('【应用补充请求，不是用户发言】');
    expect(retry).toContain(JSON.stringify(initialText).slice(1, -1));
    expect(retry).not.toContain('本次请求未提供联网检索工具');
  } else {
    expect(retry).toContain('重新回答用户当前请求');
    expect(retry).toContain('本次请求未提供联网检索工具');
  }

  const [first, second] = attempts.map(attempt => attempt.body);
  if (row.provider === 'openai') {
    for (const body of [first, second])
      expect(body.text).toMatchObject({ format: { type: 'json_schema', strict: true } });
    expect(first.tools).toEqual([{ type: 'web_search' }]);
  } else {
    const chatEffort = { thinking: { type: 'enabled' }, reasoning_effort: 'high' };
    expect(second).not.toHaveProperty('response_format');
    expect(second).toMatchObject(chatEffort);
    expect(retry).not.toContain('上一次尝试没有遵守 DeepSeek 输出协议');
    expect(retry).toContain('<profile_intent>proposal</profile_intent>');
    expect(retry).not.toContain('JSON Schema');
    expect(first.tools).toEqual([{ type: row.firstUrl === deepseekResponses ? 'web_search' : 'deepseek_web_search' }]);
    if (row.firstUrl === deepseekResponses) {
      expect(first).not.toHaveProperty('text');
      expect(first).toMatchObject({ reasoning: { effort: 'high' } });
    } else {
      expect(first).not.toHaveProperty('response_format');
      expect(first).toMatchObject(chatEffort);
    }
  }
});

function deepSeekProRecovery(firstReply = ' \n\t  ') {
  const model = 'deepseek-v4-pro';
  const abort = new AbortController();
  const started = Promise.withResolvers<void>();
  const cancel = vi.fn();
  let output!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({
    start(controller) { output = controller; },
    cancel,
  });
  const encoder = new TextEncoder();
  const send = (content: string, finish_reason: 'stop' | 'content_filter' | null = null) => {
    output.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason }] })}\n\n`));
  };
  const fetcher = vi.fn<typeof fetch>()
    .mockImplementationOnce(async () => deepseekCatalog(model))
    .mockImplementationOnce(async (url, init) => {
      expect(String(url)).toBe(deepseekResponses);
      expect(JSON.parse(String(init?.body))).not.toHaveProperty('text');
      return responses(firstReply);
    })
    .mockImplementationOnce(async (url, init) => {
      expect(String(url)).toBe(deepseek);
      const payload = JSON.parse(String(init?.body));
      expect(payload).toMatchObject({ model, stream: true });
      expect(payload).not.toHaveProperty('response_format');
      expect(payload).not.toHaveProperty('tools');
      started.resolve();
      return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
    });
  const events: ChatEvent[] = [];
  const input = request(model, '请根据我在工业检测软件项目中的经历更新简历摘要。');
  const result = api('deepseek', fetcher).stream(input, event => events.push(event), abort.signal);
  return { abort, cancel, events, fetcher, result, started: started.promise, send, close: () => output.close() };
}

function useRecoveryClock() {
  vi.useFakeTimers();
  const realTimeout = AbortSignal.timeout;
  const timeout = vi.spyOn(AbortSignal, 'timeout').mockImplementation((milliseconds) => {
    if (milliseconds !== 25000) return realTimeout(milliseconds);
    const controller = new AbortController();
    setTimeout(() => controller.abort(new DOMException('Synthetic timeout', 'TimeoutError')), milliseconds);
    return controller.signal;
  });
  return () => {
    timeout.mockRestore();
    vi.useRealTimers();
  };
}

it.each([
  { reason: 'only whitespace', firstReply: ' \n\t  ', firstVisible: '' },
])('streams the DeepSeek V4 Pro retry after $reason', async ({ firstReply, firstVisible }) => {
  const restoreClock = useRecoveryClock();
  const recovery = deepSeekProRecovery(firstReply);
  const { events, result, send } = recovery;
  const settled = vi.fn();
  void result.then(settled, settled);
  try {
    await vi.advanceTimersByTimeAsync(0);
    expect(recovery.fetcher).toHaveBeenCalledTimes(3);
    const retryEventStart = events.findIndex(event => event.type === 'activity' &&
      event.activity.id?.startsWith('profile-recovery-'));
    expect(retryEventStart).toBeGreaterThan(0);
    const retryEvents = () => events.slice(retryEventStart);
    expect(events[retryEventStart - 1]).toEqual({
      id: 'api-profile-recovery', type: 'profile-preview', preview: {},
    });
    expect(events[retryEventStart]).toMatchObject({
      type: 'activity', activity: { phase: 'waiting', status: 'in_progress' },
    });
    expect(visibleDeltas(events)).toBe(firstVisible);
    const first = '维护工业检测软件';
    const second = first + '，开发自动化分析模块';
    const background = second + '，编写覆盖现场工况的回归测试。';
    const recoveredAnswer = finalText;
    const envelope = deepseekReply({ background }, '  ' + recoveredAnswer);
    const answerStart = envelope.indexOf(finalText);
    const answerFirst = '已生成';
    const answerSplit = answerStart + answerFirst.length;
    const answerEnd = answerStart + finalText.length + 1;
    const fieldStart = envelope.indexOf(background);

    await vi.advanceTimersByTimeAsync(10000);
    send(envelope.slice(0, answerStart));
    await vi.advanceTimersByTimeAsync(100);
    expect(retryEvents().some(event => event.type === 'sources' || event.type === 'delta')).toBe(false);
    expect(visibleDeltas(events)).toBe(firstVisible);

    send(envelope.slice(answerStart, answerSplit));
    await vi.advanceTimersByTimeAsync(100);
    expect(retryEvents().filter(event => event.type === 'sources' || event.type === 'delta')).toEqual([
      { id: 'api-profile-recovery', type: 'sources', sources: [] },
      { id: 'api-profile-recovery', type: 'delta', text: answerFirst, replace: true },
    ]);
    expect(visibleDeltas(events)).toBe(answerFirst);
    expect(retryEvents()).toContainEqual(expect.objectContaining({
      type: 'activity', activity: expect.objectContaining({
        id: expect.stringMatching(/^profile-recovery-/), phase: 'writing', status: 'in_progress',
      }),
    }));

    send(envelope.slice(answerSplit, answerEnd));
    await vi.advanceTimersByTimeAsync(100);
    expect(retryEvents().filter(event => event.type === 'delta')).toEqual([
      { id: 'api-profile-recovery', type: 'delta', text: answerFirst, replace: true },
      { id: 'api-profile-recovery', type: 'delta', text: finalText.slice(answerFirst.length) },
    ]);
    expect(visibleDeltas(events)).toBe(recoveredAnswer);
    expect(retryEvents().some(event => event.type === 'profile-preview')).toBe(false);
    expect(settled).not.toHaveBeenCalled();

    send(envelope.slice(answerEnd, fieldStart + first.length));
    await vi.advanceTimersByTimeAsync(100);
    expect(events.at(-1)).toMatchObject({
      type: 'profile-preview', preview: { background: first }, generation: { fields: ['background'] },
    });

    await vi.advanceTimersByTimeAsync(20000);
    expect(settled).not.toHaveBeenCalled();
    send(envelope.slice(fieldStart + first.length, fieldStart + second.length));
    await vi.advanceTimersByTimeAsync(100);
    expect(events.at(-1)).toMatchObject({
      type: 'profile-preview', preview: { background: second }, generation: { fields: ['background'] },
    });

    send(envelope.slice(fieldStart + second.length));
    await vi.advanceTimersByTimeAsync(100);
    expect(settled).not.toHaveBeenCalled();
    send('', 'stop');
    recovery.close();
    const completed = await result;
    expect(completed).toMatchObject({ answerText: recoveredAnswer, profileChanges: { background } });
    expect(completed.activities).toContainEqual(expect.objectContaining({
      id: expect.stringMatching(/^profile-recovery-/), status: 'completed',
    }));
    expect(visibleDeltas(events)).toBe(recoveredAnswer);
    expect(profile.background).toBe('合成简历摘要');
  } finally {
    recovery.abort.abort();
    await result.catch(() => {});
    restoreClock();
  }
});

it('cancels a DeepSeek V4 Pro recovery after 25 seconds without another attempt or late output', async () => {
  const restoreClock = useRecoveryClock();
  const recovery = deepSeekProRecovery();
  const outcome = recovery.result.then(value => ({ value }), error => ({ error }));
  try {
    await recovery.started;
    recovery.send(`${intent('none')}\n第二次回答还在生成`);
    await vi.advanceTimersByTimeAsync(26000);
    expect(visibleDeltas(recovery.events)).toBe('第二次回答还在生成');
    expect(recovery.cancel).not.toHaveBeenCalled();
    const beforeCancel = [...recovery.events];

    recovery.abort.abort();
    expect(await outcome).toMatchObject({ error: { name: 'AbortError' } });
    await vi.advanceTimersByTimeAsync(100);
    expect(recovery.fetcher).toHaveBeenCalledTimes(3);
    expect(recovery.cancel).toHaveBeenCalledOnce();
    expect(recovery.events).toEqual(beforeCancel);
  } finally {
    recovery.abort.abort();
    await outcome;
    restoreClock();
  }
});

it('clears the streamed DeepSeek V4 Pro recovery preview after terminal content filtering', async () => {
  vi.useFakeTimers();
  const recovery = deepSeekProRecovery();
  const outcome = recovery.result.then(value => ({ value }), error => ({ error }));
  try {
    await recovery.started;
    recovery.send(`${intent('proposal')}\n合成答复\n<profile_proposal>{"changes":{"background":"合成预览`);
    await vi.advanceTimersByTimeAsync(100);
    expect(recovery.events.at(-1)).toMatchObject({
      type: 'profile-preview', preview: { background: '合成预览' }, generation: { fields: ['background'] },
    });
    expect(visibleDeltas(recovery.events)).toBe('合成答复');

    recovery.send('', 'content_filter');
    recovery.close();
    expect(await outcome).toMatchObject({ error: { detail: { code: 'content_filter', discardPartial: true } } });
    expect(recovery.events.at(-1)).toEqual({ id: 'api-profile-recovery', type: 'profile-preview', preview: {} });
    expect(recovery.fetcher).toHaveBeenCalledTimes(3);
  } finally {
    recovery.abort.abort();
    await outcome;
    vi.useRealTimers();
  }
});

it('reports an unresolved proposal after one structure follow-up and keeps the shown answer', async () => {
  const secondDraft = '第二次的可见草稿。';
  const fetcher = vi.fn<typeof fetch>()
    .mockImplementationOnce(async () => deepseekCatalog())
    .mockImplementationOnce(async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      expect(body.messages[0].content).toContain('<profile_intent>proposal</profile_intent>');
      return completion(deepseekMalformed);
    })
    .mockImplementationOnce(async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      expect(body.messages.at(-1).content).toContain('【应用补充请求，不是用户发言】');
      expect(body).not.toHaveProperty('tools');
      return completion(`${intent('proposal')}\n${secondDraft}\n<profile_proposal>{"changes":{"background":"不会混入回答`);
    });
  const events: ChatEvent[] = [];
  await expect(api('deepseek', fetcher).stream(request('deepseek-flash'), event => events.push(event), new AbortController().signal))
    .rejects.toThrow('资料更新提案不完整');
  expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(2);
  expect(visibleDeltas(events)).toBe(initialText);
});

it.each([
  ['authentication', () => Response.json({ error: { message: 'synthetic error' } }, { status: 401 })],
  ['network failure', () => { throw new TypeError('synthetic transport failure'); }],
  ['streamed network failure', () => completion(deepseekMalformed, 'network_error')],
  ['content filter', () => completion(deepseekMalformed, 'content_filter')],
  ['output limit', () => completion(deepseekMalformed, 'length')],
  ['unconfirmed stream termination', () => completion(deepseekMalformed, null)],
] as const)('does not retry after %s', async (_failure, reply) => {
  const fetcher = vi.fn<typeof fetch>(async (_url, init) => init?.method === 'POST' ? reply() : deepseekCatalog());
  await expect(api('deepseek', fetcher).stream(request('deepseek-flash'), vi.fn(), new AbortController().signal)).rejects.toThrow();
  expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
});

it('does not retry after cancellation as the first partial answer is arriving', async () => {
  const fetcher = vi.fn<typeof fetch>(async (_url, init) => init?.method === 'POST' ? completion(`${intent('none')}\n合成正文`) : deepseekCatalog());
  const abort = new AbortController();
  await expect(api('deepseek', fetcher).stream(request('deepseek-flash'), event => {
    if (event.type === 'delta') abort.abort();
  }, abort.signal)).rejects.toMatchObject({ name: 'AbortError' });
  expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
});

it('does not retry the profile output on a ChatGPT account connection', async () => {
  const model = 'synthetic-managed-model';
  const fetcher = vi.fn<typeof fetch>(async (_url, init) => init?.method === 'POST' ? responses(malformed) :
    Response.json({ models: [{ slug: model, display_name: 'Synthetic model', visibility: 'list' }] }));
  const service = new ChatGPTService({ access: async () => codexAccess(), fetch: fetcher, ledger: ledger() });
  await expect(service.stream(request(model), vi.fn(), new AbortController().signal)).rejects.toThrow('资料更新提案不完整');
  expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
});
