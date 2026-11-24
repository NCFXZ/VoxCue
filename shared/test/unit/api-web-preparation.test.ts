import { expect, it, vi } from 'vitest';
import { createApiChatService } from '../../electron/backend/api/service';
import type { UsageLedger } from '../../electron/backend/chat/usage';
import type { ApiProvider } from '../../electron/contracts/apiConnections';
import type { ChatEvent, ChatRequest } from '../../electron/contracts/chat';

const profile = { name: '', background: '合成私人简历', jobDescription: '合成职位描述' };
const source = { title: 'Apple Newsroom', url: 'https://www.apple.com/newsroom/' };
const answer = '**本轮回答**\n根据实际检索来源核验。';
const envelope = `<profile_intent>none</profile_intent>\n${answer}`;
const input = (modelId: string): ChatRequest => ({
  id: 'web-preparation', modelId, instructions: '回答当前问题', webSearch: true, profile,
  turns: [{ role: 'user', content: '你好，帮我查询一下苹果的资讯' }],
});

function stream(...events: object[]) {
  return new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''), {
    headers: { 'content-type': 'text/event-stream' },
  });
}

function fixture(provider: ApiProvider, fetcher: typeof fetch) {
  const ledger = { add: vi.fn() } as unknown as UsageLedger;
  return createApiChatService(provider, async () => ({ key: 'synthetic-preparation-key' }), ledger, fetcher);
}

it('tracks actual DeepSeek reasoning, search, reading and answer phases with public tool details', async () => {
  const call = { id: 'live-search', type: 'deepseek_web_search', action: { type: 'search', queries: ['Apple newsroom'] } };
  const page = { id: 'live-page', type: 'deepseek_web_search', action: {
    type: 'open_page', url: source.url,
  } };
  const fetcher = vi.fn<typeof fetch>(async (_url, init) => init?.method !== 'POST'
    ? Response.json({ data: [{ id: 'deepseek-flash' }] })
    : stream(
      { choices: [{ delta: { reasoning_content: 'synthetic private reasoning' } }] },
      { choices: [{ server_tool_event: { type: 'call_started', call } }] },
      { choices: [{ server_tool_event: { type: 'call_completed', call: { id: call.id, status: 'completed' } } }] },
      { choices: [{ server_tool_event: { type: 'call_started', call: page } }] },
      { choices: [{ server_tool_event: { type: 'call_completed', call: { id: page.id, status: 'completed' } } }] },
      { choices: [{ delta: { content: envelope }, finish_reason: 'stop' }] },
    ));
  const events: ChatEvent[] = [];
  const result = await fixture('deepseek', fetcher).stream(input('deepseek-flash'), event => events.push(event), new AbortController().signal);
  const activities = events.flatMap(event => event.type === 'activity' ? [event.activity] : []);
  expect(activities.filter(item => item.kind === 'status' && item.status === 'in_progress').map(item => item.phase))
    .toEqual(['waiting', 'thinking', 'searching', 'reading', 'writing']);
  expect(activities).toContainEqual(expect.objectContaining({ kind: 'web_search', detail: 'Apple newsroom', status: 'in_progress' }));
  expect(activities).toContainEqual(expect.objectContaining({ kind: 'open_page', url: source.url, status: 'completed' }));
  expect(JSON.stringify(events)).not.toContain('synthetic private reasoning');
  expect(result.answerText).toBe(answer);
});

it('uses the same DeepSeek V4 Pro model on Responses only for text preparation search', async () => {
  const model = 'deepseek-v4-pro';
  const posts: { path: string; body: Record<string, unknown> }[] = [];
  const fetcher = vi.fn<typeof fetch>(async (url, init) => {
    if (init?.method !== 'POST') return Response.json({ data: [{ id: model, effort: { supported_levels: ['low'] } }] });
    const path = new URL(String(url)).pathname;
    posts.push({ path, body: JSON.parse(String(init.body)) });
    if (path === '/responses') return stream(
      { type: 'response.output_item.done', item: {
        type: 'web_search_call', id: 'search-test', status: 'completed', action: { type: 'search' },
      } },
      { type: 'response.output_text.annotation.added', annotation: { type: 'url_citation', ...source } },
      { type: 'response.output_text.delta', delta: envelope.slice(0, envelope.indexOf('\n') + 1) },
      { type: 'response.output_text.delta', delta: envelope.slice(envelope.indexOf('\n') + 1) },
      { type: 'response.completed', response: { id: 'response-test', status: 'completed' } },
    );
    const system = (posts.at(-1)?.body.messages as { content: string }[])[0].content;
    const content = system.includes('<profile_intent>') ? envelope : answer;
    return stream({ id: 'web-response', choices: [{ delta: { content }, finish_reason: 'stop' }] });
  });
  const service = fixture('deepseek', fetcher);
  const signal = new AbortController().signal;
  const emit = vi.fn();
  await expect(service.stream({ ...input(model), effort: 'low' }, emit, signal)).resolves.toMatchObject({
    answerText: answer, sources: [source], profileChanges: undefined,
  });
  const withFile: ChatRequest = { ...input(model), turns: [{ role: 'user', content: '整理这份说明',
    files: [{ name: 'synthetic.txt', bytes: Uint8Array.of(65) }] }] };
  await expect(service.stream(withFile, vi.fn(), signal)).resolves.toMatchObject({ sources: [] });
  const { profile: _profile, ...interview } = input(model);
  await expect(service.stream({ ...interview, webSearch: false }, vi.fn(), signal)).resolves.toMatchObject({ sources: [] });
  expect(posts.map(({ path }) => path)).toEqual(['/responses', '/chat/completions', '/chat/completions']);
  expect(posts[0].body).toMatchObject({ model, reasoning: { effort: 'low' }, stream: true, tools: [{ type: 'web_search' }] });
  expect(posts[0].body).not.toHaveProperty('text');
  expect(emit.mock.calls.flatMap(([event]) => event.type === 'delta' ? [event.text] : []).join('')).toBe(answer);
  expect(posts[1].body).not.toHaveProperty('response_format');
  expect(posts[1].body).not.toHaveProperty('tools');
  expect(posts[2].body).not.toHaveProperty('tools');
  expect(posts[2].body).not.toHaveProperty('response_format');
});

it('streams a saved résumé edit proposal on the first V4 Pro attempt when the user cancels only the JD deletion', async () => {
  vi.useFakeTimers();
  const model = 'deepseek-v4-pro';
  const abort = new AbortController();
  let output!: ReadableStreamDefaultController<Uint8Array>;
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({ start(controller) { output = controller; } });
  const send = (event: object) => output.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
  const prompt = '改一下，不要删 JD。把保存的简历缩短一点，另外给我一个准备建议。';
  const fetcher = vi.fn<typeof fetch>(async (url, init) => {
    if (init?.method !== 'POST') return Response.json({ data: [{ id: model }] });
    expect(String(url)).toBe('https://api.deepseek.com/responses');
    const request = JSON.parse(String(init.body));
    expect(request).toMatchObject({ model, tools: [{ type: 'web_search' }] });
    expect(request).not.toHaveProperty('text');
    expect(request.instructions).toContain('“不要删 JD，把简历缩短一点”只修改 background');
    expect(request.input.at(-1)).toMatchObject({ role: 'user', content: prompt });
    return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
  });
  const resultText = '已提出精简简历摘要的提案，请确认保存。\n\n**准备建议**：梳理项目中的主要职责。';
  const partialBackground = '负责工业检测软件';
  const background = partialBackground + '开发及回归测试。';
  const reply = `<profile_intent>proposal</profile_intent>\n${resultText}\n<profile_proposal>\n${
    JSON.stringify({ changes: { background, jobDescription: null }, skillScope: null })}\n</profile_proposal>`;
  const split = reply.indexOf(background) + partialBackground.length;
  const events: ChatEvent[] = [];
  const settled = vi.fn();
  const result = fixture('deepseek', fetcher).stream({ ...input(model), turns: [
    { role: 'user', content: '要不删掉已经保存的 JD？' },
    { role: 'assistant', content: '可以提出清空职位描述的提案。' },
    { role: 'user', content: prompt },
  ] }, event => events.push(event), abort.signal);
  void result.then(settled, settled);
  try {
    send({ type: 'response.output_text.delta', delta: reply.slice(0, split) });
    await vi.advanceTimersByTimeAsync(100);
    expect(settled).not.toHaveBeenCalled();
    expect(events).toContainEqual({ id: 'web-preparation', type: 'profile-preview',
      preview: { background: partialBackground }, generation: { fields: ['background'], skillIndexes: [] } });
    send({ type: 'response.output_text.delta', delta: reply.slice(split) });
    send({ type: 'response.completed', response: { id: 'first-attempt', status: 'completed' } });
    output.close();
    const completion = await result;
    expect(completion.answerText).toBe(resultText);
    expect(completion.profileChanges).toEqual({ background });
    expect(events.flatMap(event => event.type === 'delta' ? [event.text] : []).join('')).toBe(resultText);
    expect(profile.jobDescription).toBe('合成职位描述');
    expect(profile.background).toBe('合成私人简历');
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
  } finally {
    abort.abort();
    await result.catch(() => {});
    vi.useRealTimers();
  }
});
