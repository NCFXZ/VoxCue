import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { apiProviderIds, apiProviders, type ApiProvider } from '../../electron/contracts/apiConnections';
import type { ChatEvent, ChatRequest } from '../../electron/contracts/chat';
import {
  createApiChatService,
  readApiBalance,
  type ApiCredential,
} from '../../electron/backend/api/service';
import type { UsageLedger } from '../../electron/backend/chat/usage';

const credential = { key: 'synthetic-api-key' };
const ledger = () => ({ add: vi.fn(), get: vi.fn(), reset: vi.fn() });
const request = (modelId: string): ChatRequest => ({
  id: 'test-request',
  instructions: '答复用户',
  webSearch: false,
  turns: [{ role: 'user', content: '测试' }],
  modelId,
});
function sse(events: unknown[]) {
  return new Response(events.map((value) => 'data: ' + JSON.stringify(value) + '\n\n').join(''), {
    headers: { 'content-type': 'text/event-stream' },
  });
}
const deepModel = {
  id: 'sample',
  input_modalities: ['text', 'image'],
  output_modalities: ['text'],
  effort: { supported_levels: ['low', 'high', 'max'], default_level: 'high' },
};
const chunk = (delta: unknown, finish_reason: string | null = null) => ({
  id: 'response-id',
  choices: [{ delta, finish_reason }],
});
const profileReply = (answer: string) => `<profile_intent>none</profile_intent>\n${answer}`;
const profileProposal = (answer: string, changes: object, skillScope: string | null = null) =>
  `<profile_intent>proposal</profile_intent>\n${answer}\n<profile_proposal>\n${JSON.stringify({ changes, skillScope })}\n</profile_proposal>`;
function fixture(provider: ApiProvider, fetcher: typeof fetch, secret: ApiCredential = credential) {
  const usage = ledger();
  const service = createApiChatService(
    provider,
    async () => secret,
    usage as unknown as UsageLedger,
    fetcher,
  );
  return { service, usage };
}

describe('API key providers', () => {
  it.each([
    { provider: 'deepseek', accepted: ['deepseek-future'], excluded: [], extra: { effort: { supported_levels: [] } } },
  ] as const)('streams newly catalogued $provider models on automatic without inventing manual levels', async row => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({
      data: [...row.accepted, ...row.excluded].map(id => ({ object: 'model', id, ...row.extra })),
    })).mockImplementationOnce(async (_, options) => {
      const body = JSON.parse(String(options?.body));
      expect(body.model).toBe(row.accepted[0]);
      expect(body).not.toHaveProperty('reasoning_effort');
      expect(body).not.toHaveProperty('thinking');
      return sse([chunk({ content: 'ok' }, 'stop')]);
    });
    const { service } = fixture(row.provider, fetcher);
    const catalog = await service.models();
    expect(catalog.map(model => model.id)).toEqual(row.accepted);
    for (const model of catalog) expect(model.reasoningEfforts ?? []).toEqual([]);
    await expect(service.stream(request(row.accepted[0]), vi.fn(), new AbortController().signal))
      .resolves.toMatchObject({ answerText: 'ok' });
  });
  it.each(apiProviderIds)('lists models and completes a streamed reply through the %s preview route', async provider => {
    const { transport } = createRequire(import.meta.url)('../fixtures/api-interactive-preview.cjs');
    const { service, usage } = fixture(provider, transport(provider, credential.key));
    const [model] = await service.models();
    expect(model.provider?.id).toBe(provider);
    const effort = 'high';
    expect(model.reasoningEfforts).toContain(effort);
    const events: ChatEvent[] = [];
    const reply = await service.stream({ ...request(model.id), effort, webSearch: true }, event => events.push(event), new AbortController().signal);
    expect(reply.answerText).toContain(model.id);
    expect(reply.answerText).toContain('思考设置为 ' + effort);
    expect(reply.warning).toBeUndefined();
    expect(events.filter(event => event.type === 'delta').map(event => event.text).join('')).toBe(reply.answerText);
    expect(reply.usage).toEqual({ inputTokens: 48, outputTokens: 24, totalTokens: 72 });
    expect(usage.add).toHaveBeenCalledOnce();
  });
  it.each(apiProviderIds)('keeps an in-flight %s answer running when another model is rejected', async provider => {
    const { transport } = createRequire(import.meta.url)('../fixtures/api-interactive-preview.cjs');
    const vendor = transport(provider, credential.key);
    let start!: () => void, resume!: () => void;
    const sending = new Promise<void>(resolve => { start = resolve; });
    const ready = new Promise<void>(resolve => { resume = resolve; });
    let posts = 0;
    const http = vi.fn<typeof fetch>(async (url, options) => {
      if (options?.method === 'POST') {
        if (++posts > 1) return Response.json({ error: { code: 'model_not_found' } }, { status: 404 });
        start();
        await ready;
      }
      return vendor(url, options);
    });
    const { service } = fixture(provider, http);
    const [first, removed] = await service.models();
    const signal = new AbortController().signal;
    const active = service.stream(request(first.id), vi.fn(), signal);
    try {
      await sending;
      await expect(service.stream(request(removed.id), vi.fn(), signal)).rejects.toMatchObject({ detail: { status: 404 } });
      await service.models();
      expect(http).toHaveBeenCalledTimes(4);
    } finally {
      resume();
      await expect(active).resolves.toMatchObject({ provider: { id: provider } });
    }
  });
  it('keeps Kimi model discovery, preparation search and interview replies on the Moonshot endpoint', async () => {
    const source = { title: 'Synthetic documentation', url: 'https://example.org/guide' };
    const model = 'kimi-k3.1-pro';
    const history = [{ role: 'user', content: '第一轮' }, { role: 'assistant', content: '上一轮回答' },
      { role: 'user', content: '继续' }] as ChatRequest['turns'];
    const http = vi.fn<typeof fetch>(async (url, init) => {
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer synthetic-api-key');
      expect(init?.redirect).toBe('error');
      if (String(url) === 'https://api.moonshot.cn/v1/models')
        return Response.json({ data: [{ id: 'kimi-k2.6' }, { id: model, supports_image_in: false },
          { id: model }, { id: 'kimi-k3.1-pro-highspeed' }, { id: 'kimi-k3', supports_reasoning: false }] });
      expect(String(url)).toBe('https://api.moonshot.cn/v1/responses');
      const body = JSON.parse(String(init?.body));
      expect(body).toMatchObject({ model, stream: true, input: history });
      expect(body).not.toHaveProperty('reasoning');
      const search = !!body.tools;
      if (search) {
        expect(body.tools).toEqual([{ type: 'web_search' }]);
        expect(body.include).toContain('web_search_call.action.sources');
        expect(body.text.format).toMatchObject({ type: 'json_schema', strict: true });
        expect(body.instructions).toContain('搜索词和网址不得包含个人资料');
      }
      const answer = search ? JSON.stringify({ answer: '准备回答', changes: {}, skillScope: null }) : '面试回答';
      return sse([{ type: 'response.completed', response: { status: 'completed', output: [
        ...(search ? [{ type: 'web_search_call', status: 'completed', action: { type: 'search', sources: [source] } }] : []),
        { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: answer }] },
      ] } }]);
    });
    const { service } = fixture('kimi', http);
    const signal = new AbortController().signal;
    const models = await service.models();
    expect(models.map(entry => entry.id)).toEqual([model, 'kimi-k3.1-pro-highspeed', 'kimi-k3']);
    expect(models[0].reasoningEfforts).toEqual(['low', 'high', 'max']);
    expect(models[2].reasoningEfforts).toEqual([]);
    const input = { ...request(model), turns: history };
    await expect(service.stream({ ...input, webSearch: true, profile: { name: '', background: '', jobDescription: '' } }, vi.fn(), signal))
      .resolves.toMatchObject({ answerText: '准备回答', sources: [source], provider: { id: 'kimi', dataRecipient: 'Moonshot AI' } });
    await expect(service.stream(input, vi.fn(), signal)).resolves.toMatchObject({ answerText: '面试回答', sources: [] });
    for (const [name, message] of [['image.png', '不支持图片输入'], ['notes.pdf', '将文档转换成纯文本']]) {
      await expect(service.stream({ ...input, turns: [{ role: 'user', content: '附件', files: [
        { name, bytes: Uint8Array.of(1) },
      ] }] }, vi.fn(), signal)).rejects.toThrow(message);
    }
    expect(http).toHaveBeenCalledTimes(3);
  });

  it('reads Kimi credit from the domestic balance endpoint and rejects an invalid balance', async () => {
    const http = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ code: 0, data: { available_balance: 3.5, voucher_balance: 4, cash_balance: -0.5 } }))
      .mockResolvedValueOnce(Response.json({ code: 0, data: {} }));
    const signal = new AbortController().signal;
    await expect(readApiBalance('kimi', credential, signal, http)).resolves.toEqual([
      { currency: 'CNY', total: '3.5', granted: '4', toppedUp: '-0.5' },
    ]);
    await expect(readApiBalance('kimi', credential, signal, http)).rejects.toThrow('余额格式无效');
    for (const [url, init] of http.mock.calls) {
      expect(String(url)).toBe('https://api.moonshot.cn/v1/users/me/balance');
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer synthetic-api-key');
    }
  });

  it.each([
    ['exceeded_current_quota_error', '余额不足'],
    ['engine_overloaded_error', '模型繁忙'],
    ['rate_limit_reached_error', '调用限额'],
  ])('reports the billing or capacity reason for a Kimi 429 (%s)', async (type, expected) => {
    const http = vi.fn<typeof fetch>().mockResolvedValue(Response.json({
      error: { type, message: 'upstream text containing the synthetic key' },
    }, { status: 429 }));
    const { service } = fixture('kimi', http);
    await expect(service.models()).rejects.toThrow(expected);
  });
  it('regenerates an invalid Kimi proposal visibly instead of inside the short buffered window', async () => {
    const reply = (text: string) => sse([
      { type: 'response.output_text.delta', output_index: 0, content_index: 0, delta: text },
      { type: 'response.completed', response: { status: 'completed', output: [
        { type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] },
      ] } },
    ]);
    const http = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ data: [{ id: 'kimi-k3' }] }))
      .mockResolvedValueOnce(reply('先说明一下：{"answer":"草稿"}'))
      .mockResolvedValueOnce(reply(JSON.stringify({ answer: '已重新整理。', changes: {}, skillScope: null })));
    const { service } = fixture('kimi', http);
    const emit = vi.fn();
    await expect(service.stream({ ...request('kimi-k3'), profile: { name: '', background: '', jobDescription: '' } },
      emit, new AbortController().signal)).resolves.toMatchObject({ answerText: '已重新整理。' });
    expect(emit).toHaveBeenCalledWith({ id: 'test-request', type: 'profile-preview', preview: {} });
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({ type: 'delta', replace: true, text: '已重新整理。' }));
  });
  it.each([
    [{ type: 'error', error: { type: 'rate_limit_exceeded', code: 'rate_limit_exceeded',
      message: 'Your account org-synthetic <ak-synthetic> request reached organization (kimi-k3) RPM rate limit, limit: 3' } },
    '已达到 Kimi 账户的每分钟请求次数上限（3 次），请约 1 分钟后重试'],
    [{ type: 'error', code: 'rate_limit_reached_error', message: 'synthetic' }, '调用限额'],
  ])('keeps the Kimi reason when a 200 stream ends with an error event', async (event, expected) => {
    const http = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ data: [{ id: 'kimi-k3' }] }))
      .mockResolvedValueOnce(sse([{ type: 'response.created' }, event]));
    const { service } = fixture('kimi', http);
    const failure = service.stream(request('kimi-k3'), vi.fn(), new AbortController().signal);
    await expect(failure).rejects.toThrow(expected);
    await expect(failure).rejects.not.toThrow('synthetic');
  });

  it('reports only the DeepSeek default advertised for thinking and leaves automatic requests unset', async () => {
    let entries = [undefined, 'none', 'unknown', 'high'].map((default_level, index) => ({
      ...deepModel, id: 'model-' + index, effort: { supported_levels: ['none', 'high'], default_level },
    }));
    const http = vi.fn<typeof fetch>(async (url, init) => {
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer synthetic-api-key');
      if (String(url) === 'https://api.deepseek.com/models') return Response.json({ data: entries });
      expect(String(url)).toBe('https://api.deepseek.com/chat/completions');
      const body = JSON.parse(String(init?.body));
      expect(body.model).toBe('newly-listed');
      expect(body).not.toHaveProperty('reasoning_effort');
      expect(body).not.toHaveProperty('thinking');
      return sse([chunk({ content: 'ok' }, 'stop')]);
    });
    const { service } = fixture('deepseek', http);
    expect((await service.models()).map((model) => model.defaultReasoningEffort)).toEqual([
      undefined, undefined, undefined, 'high',
    ]);
    entries = [{ ...entries[3], id: 'newly-listed' }];
    expect((await service.models(true)).map(model => model.id)).toEqual(['newly-listed']);
    await expect(service.stream(request('model-3'), vi.fn(), new AbortController().signal)).rejects.toThrow('当前不可用');
    await service.stream(request('newly-listed'), vi.fn(), new AbortController().signal);
    expect(http).toHaveBeenCalledTimes(3);
  });

  it('streams a selected DeepSeek model, keeps reasoning private and stores provider usage', async () => {
    const http = vi.fn<typeof fetch>(async (url, init) => {
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer synthetic-api-key');
      expect(init?.redirect).toBe('error');
      if (String(url).endsWith('/models')) return Response.json({ data: [deepModel] });
      expect(String(url)).toBe('https://api.deepseek.com/chat/completions');
      const body = JSON.parse(String(init?.body));
      expect(body).not.toHaveProperty('response_format');
      expect(body).toMatchObject({
        stream: true,
        thinking: { type: 'enabled' },
        reasoning_effort: 'high',
        messages: [
          { role: 'system' },
          {
            role: 'user',
            content: [
              { type: 'text' },
              { type: 'image_url', image_url: { url: 'data:image/png;base64,AQ==' } },
            ],
          },
        ],
      });
      return sse([
        chunk({ reasoning_content: 'private-thought' }),
        chunk({ content: '答复' }),
        {
          ...chunk({}, 'stop'),
          usage: { prompt_tokens: 4, completion_tokens: 3, total_tokens: 7 },
        },
      ]);
    });
    const { service, usage } = fixture('deepseek', http);
    const models = await service.models();
    expect(models[0]).toMatchObject({
      provider: { id: 'deepseek' },
      reasoningEfforts: ['none', 'low', 'high', 'max'],
    });
    const input = request('sample');
    input.turns[0].files = [{ name: 'image.png', bytes: new Uint8Array([1]) }];
    const events: ChatEvent[] = [];
    const result = await service.stream(
      { ...input, effort: 'high' },
      (e) => events.push(e),
      new AbortController().signal,
    );
    expect(result).toMatchObject({
      answerText: '答复',
      provider: { dataRecipient: 'DeepSeek' },
      usage: { totalTokens: 7 },
    });
    expect(JSON.stringify(events)).not.toContain('private-thought');
    expect(usage.add).toHaveBeenCalledWith(
      expect.stringMatching(/^deepseek:[0-9a-f]{64}$/),
      'response-id',
      result.usage,
    );
    expect(http).toHaveBeenCalledTimes(2);
    await expect(
      service.stream({ ...input, effort: 'xhigh' }, vi.fn(), new AbortController().signal),
    ).rejects.toThrow('思考强度');
    expect(http).toHaveBeenCalledTimes(2);
  });
  it('streams each DeepSeek preparation reply once and validates optional profile proposals', async () => {
    const input = {
      ...request('deepseek-flash'),
      profile: { name: '', background: '合成项目经历', jobDescription: '' },
    };
    const http = vi.fn<typeof fetch>(async (url, init) => {
      if (String(url).endsWith('/models')) return Response.json({ data: [{ ...deepModel, id: input.modelId }] });
      const body = JSON.parse(String(init?.body));
      expect(body).not.toHaveProperty('response_format');
      const instructions = body.messages[0].content as string;
      expect(instructions).toContain('合成项目经历');
      expect(instructions).toContain('普通咨询、分析、草稿和建议使用 none');
      const lastTurn = body.messages.at(-1).content;
      if (lastTurn !== '可以') {
        expect(body).not.toHaveProperty('thinking');
        const answer = lastTurn === '你好' ? '您好！' : '草稿\n\n**项目经历**';
        const payload = profileReply(answer);
        return sse([chunk({ content: payload.slice(0, -1) }), chunk({ content: payload.slice(-1) }, 'stop')]);
      }
      expect(body).toMatchObject({ thinking: { type: 'enabled' }, reasoning_effort: 'high' });
      expect(body.messages.at(-2)).toEqual({ role: 'assistant', content: '要把姓名写作示例吗？' });
      const text = profileProposal('已整理，待确认。', { name: '示例' });
      return sse([
        chunk({ content: text.slice(0, 13) }),
        chunk({ content: text.slice(13) }, 'stop'),
      ]);
    });
    const { service } = fixture('deepseek', http);
    const signal = new AbortController().signal;
    const emit = vi.fn<(event: ChatEvent) => void>();
    await expect(service.stream({ ...input, turns: [{ role: 'user', content: '你好' }] }, emit, signal))
      .resolves.toMatchObject({ answerText: '您好！', profileChanges: undefined });
    expect(emit).toHaveBeenCalledWith({ id: input.id, type: 'delta', text: '您好' });
    await expect(service.stream({ ...input, turns: [{ role: 'user', content: '只给我简历草稿，不要修改保存的摘要。' }] }, emit, signal))
      .resolves.toMatchObject({ answerText: '草稿\n\n**项目经历**', profileChanges: undefined });
    expect(emit).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'profile-preview' }));
    expect(emit).not.toHaveBeenCalledWith(expect.objectContaining({ activity: expect.objectContaining({ phase: 'organizing' }) }));
    emit.mockClear();
    await expect(service.stream({ ...input, effort: 'high', turns: [
      { role: 'user', content: '整理我的资料' },
      { role: 'assistant', content: '要把姓名写作示例吗？' },
      { role: 'user', content: '可以' },
    ] }, emit, signal)).resolves.toMatchObject({ answerText: '已整理，待确认。', profileChanges: { name: '示例' } });
    expect(emit.mock.calls.map(([event]) => event)
      .filter(event => event.type === 'delta').map(event => event.text).join('')).toBe('已整理，待确认。');
    expect(http).toHaveBeenCalledTimes(4);
  });
  it.each([
    { finish: 'stop', truncated: false, error: undefined },
    { finish: 'stop', truncated: true, error: '资料更新提案不完整' },
    { finish: null, truncated: false, error: '回答未完整返回' },
  ])('requires a validated proposal and a normal stop for a DeepSeek JD deletion proposal ($finish/$truncated)', async scenario => {
    const base = { name: '示例姓名', background: '合成经历', jobDescription: '合成职位描述' };
    const answer = '已提出清空职位描述摘要的请求，请确认后保存。';
    const proposal = profileProposal(answer, { jobDescription: '' });
    let attempts = 0;
    const http = vi.fn<typeof fetch>(async (_url, init) => {
      if (init?.method !== 'POST') return Response.json({ data: [{ ...deepModel, id: 'deepseek-flash' }] });
      attempts++;
      const body = JSON.parse(String(init.body));
      const instructions = body.messages[0].content as string;
      expect(instructions).toContain('空字符串表示清除');
      // A structure follow-up repeats the context with the shown answer and the application request.
      if (attempts === 1) expect(body.messages.at(-1)).toEqual({ role: 'user', content: '删除我的JD吧' });
      else expect(body.messages.slice(-3, -1)).toEqual([
        { role: 'user', content: '删除我的JD吧' }, { role: 'assistant', content: answer }]);
      expect(body).toMatchObject({ reasoning_effort: 'low', stream: true });
      expect(body).not.toHaveProperty('response_format');
      const json = scenario.truncated ? proposal.slice(0, -1) : proposal;
      return sse([
        chunk({ content: json.slice(0, 25) }),
        chunk({ content: json.slice(25) }, scenario.finish),
      ]);
    });
    const { service } = fixture('deepseek', http);
    const emit = vi.fn<(event: ChatEvent) => void>();
    const result = service.stream({ ...request('deepseek-flash'), effort: 'low', profile: base,
      turns: [{ role: 'user', content: '删除我的JD吧' }] }, emit, new AbortController().signal);
    if (scenario.error) {
      await expect(result).rejects.toThrow(scenario.error);
    } else {
      await expect(result).resolves.toMatchObject({ answerText: answer, profileChanges: { jobDescription: '' } });
    }
    const visible = emit.mock.calls.reduce((text, [event]) =>
      event.type === 'delta' ? (event.replace ? '' : text) + event.text : text, '');
    expect(visible).toBe(answer);
    expect(base.jobDescription).toBe('合成职位描述');
    expect(http).toHaveBeenCalledTimes(scenario.truncated ? 3 : 2);
  });
  it('retries an empty DeepSeek JSON response once without claiming writing succeeded', async () => {
    const blank = (id: string) => sse([{ ...chunk({ content: ' ' }, 'stop'), id, usage: {
      prompt_tokens: 10, completion_tokens: 2, total_tokens: 12,
    } }]);
    const input = { ...request('sample'), profile: { name: '', background: '', jobDescription: '' } };
    const http = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ data: [deepModel] }))
      .mockImplementation(async () => blank(`response-${http.mock.calls.length}`));
    const { service, usage } = fixture('deepseek', http);
    const emit = vi.fn<(event: ChatEvent) => void>();
    await expect(service.stream(input, emit, new AbortController().signal)).rejects.toMatchObject({
      message: 'DeepSeek 返回了空白回答，请重试。',
    });
    expect(http).toHaveBeenCalledTimes(3);
    expect(usage.add).toHaveBeenCalledTimes(2);
    expect(emit.mock.calls.map(([event]) => event).some(event => event.type === 'delta' ||
      (event.type === 'activity' && event.activity.phase === 'writing'))).toBe(false);

    http.mockClear();
    const controller = new AbortController();
    const cancellation = new DOMException('Stopped during usage recording', 'AbortError');
    usage.add.mockImplementationOnce(() => controller.abort(cancellation));
    await expect(service.stream(input, vi.fn(), controller.signal)).rejects.toBe(cancellation);
    expect(http).toHaveBeenCalledOnce();
  });
  it.each([
    { content: '收到一部分', finish: 'length', failure: '回答达到输出长度上限' },
    { content: ' ', finish: 'insufficient_system_resource', failure: '中断了生成' },
    { content: '收到一部分', finish: null, failure: '回答未完整返回' },
  ])('rejects invalid DeepSeek profile output ($finish)', async ({ content, finish, failure }) => {
    const http = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ data: [deepModel] }))
      .mockResolvedValueOnce(sse([chunk({ content }, finish)]));
    const { service } = fixture('deepseek', http);
    const input = { ...request('sample'), profile: { name: '', background: '', jobDescription: '' } };
    await expect(service.stream(input, vi.fn(), new AbortController().signal)).rejects.toThrow(failure);
    expect(http).toHaveBeenCalledTimes(2);
  });
  it('uses the DeepSeek Flash search tool in preparation and returns real provider sources', async () => {
    const source = { url: 'https://example.com/current-news', title: '合成资讯来源' };
    const search = { id: 'news-search', type: 'deepseek_web_search', action: { type: 'search', queries: ['public news'],
      internal_prompt: 'reserved-tool-argument' } };
    const usageTokens = { prompt_tokens: 13, completion_tokens: 8, total_tokens: 21 };
    const http = vi.fn<typeof fetch>(async (url, init) => {
      if (init?.method !== 'POST') return Response.json({ data: [{ ...deepModel, id: 'deepseek-flash' }] });
      expect(String(url)).toBe('https://api.deepseek.com/chat/completions');
      const body = JSON.parse(String(init.body));
      expect(body).toMatchObject({ model: 'deepseek-flash', stream: true,
        tools: [{ type: 'deepseek_web_search' }], safety_check: { level: 'high' }, reasoning_effort: 'low' });
      expect(body).not.toHaveProperty('response_format');
      expect(body).not.toHaveProperty('tool_choice');
      expect(body.messages[0].content).toContain('搜索词和网址不得包含个人资料');
      expect(body.messages[0].content).not.toContain('未提供联网检索工具');
      expect(body.messages.at(-2)).toEqual({ role: 'assistant', content: '我可以查最新资讯。' });
      return sse([
        { id: 'response-id', choices: [{ server_tool_event: { type: 'call_started', step: 0, call: search } }] },
        chunk({ content: '<profile_intent>none</profile_intent>\n根据查到的合成资料，' }),
        chunk({ content: '这是最新动态。' }),
        {
          ...chunk({ server_tool_calls: [{ reasoning_content: 'reserved-reasoning', calls: [
            { ...search, status: 'completed', sources: [{ type: 'url', ...source }] },
          ] }], annotations: [{ type: 'url_citation', url_citation: source }] }, 'stop'),
          usage: usageTokens,
        },
      ]);
    });
    const { service, usage } = fixture('deepseek', http);
    const events: ChatEvent[] = [];
    const input: ChatRequest = { ...request('deepseek-flash'), effort: 'low', webSearch: true,
      turns: [{ role: 'user', content: '能联网吗' }, { role: 'assistant', content: '我可以查最新资讯。' },
        { role: 'user', content: '帮我查最新资讯' }],
      profile: { name: '合成示例', background: '', jobDescription: '' },
    };
    const result = await service.stream(input, event => events.push(event), new AbortController().signal);
    expect(result).toMatchObject({ answerText: '根据查到的合成资料，这是最新动态。', sources: [source],
      profileChanges: undefined, usage: { inputTokens: 13, outputTokens: 8, totalTokens: 21 } });
    expect(events).toContainEqual({ id: input.id, type: 'sources', sources: [source] });
    const searchEvents = events.filter(event => event.type === 'activity' && event.activity.kind === 'web_search');
    expect(searchEvents).toMatchObject([
      { activity: { status: 'in_progress', detail: 'public news' } },
      { activity: { status: 'completed', detail: 'public news' } },
    ]);
    expect(JSON.stringify(events)).not.toMatch(/reserved-tool-argument|reserved-reasoning/);
    expect(usage.add).toHaveBeenCalledExactlyOnceWith(expect.any(String), 'response-id', result.usage);
    expect(http).toHaveBeenCalledTimes(2);
  });
  it('verifies DeepSeek preparation proposals against actual search sources', async () => {
    const real = { title: '合成已查来源', url: 'https://example.com/actual' };
    const unknown = { title: '合成未查来源', url: 'https://example.com/unknown' };
    const skill = { id: 'fixture', title: '主题', content: '合成资料正文', sources: [real, unknown] };
    const http = vi.fn<typeof fetch>(async (_url, init) => {
      if (init?.method !== 'POST') return Response.json({ data: [{ ...deepModel, id: 'deepseek-flash' }] });
      const body = JSON.parse(String(init.body));
      expect(body.messages[0].content).toContain('<profile_proposal>');
      expect(body.messages[0].content).not.toContain('JSON Schema');
      expect(body).not.toHaveProperty('response_format');
      const proposal = profileProposal('待确认。', { skills: [skill] }, 'all');
      return sse([chunk({ content: proposal, server_tool_calls: [{ calls: [{
        id: 'actual-search', type: 'deepseek_web_search', action: { type: 'search' }, status: 'completed',
        sources: [{ type: 'url', ...real }],
      }] }] }, 'stop')]);
    });
    const { service } = fixture('deepseek', http);
    const input = { ...request('deepseek-flash'), webSearch: true, profileTask: 'skills' as const,
      profile: { name: '', background: '合成经历', jobDescription: '合成职位信息' } };
    await expect(service.stream(input, vi.fn(), new AbortController().signal)).resolves.toMatchObject({
      answerText: '待确认。', sources: [real], profileChanges: { skills: [{ ...skill, sources: [real] }] },
      skillSourceIssues: [{ skillId: skill.id, reason: 'source_unmatched', sources: [unknown] }],
    });
  });
  it.each([
    { model: 'deepseek-flash', preparation: false, webSearch: false },
    { model: 'deepseek-flash', preparation: false, webSearch: true },
    { model: 'deepseek-flash', preparation: true, webSearch: false },
    { model: 'deepseek-v4-pro', preparation: true, webSearch: false },
    { model: 'deepseek-v4-pro', preparation: false, webSearch: true },
  ])('keeps DeepSeek search unavailable for $model with prep=$preparation and webSearch=$webSearch',
    async ({ model, preparation, webSearch }) => {
      const http = vi.fn<typeof fetch>(async (_url, init) => {
        if (init?.method !== 'POST') return Response.json({ data: [{ ...deepModel, id: model }] });
        const body = JSON.parse(String(init.body));
        expect(body).not.toHaveProperty('tools');
        expect(body).not.toHaveProperty('safety_check');
        expect(body.messages[0].content).toContain('未提供联网检索工具');
        const content = preparation ? profileReply('正常答复') : '正常答复';
        return sse([chunk({ content, annotations: [{ type: 'url_citation',
          url_citation: { url: 'https://example.com/unexpected-tool' } }] }, 'stop')]);
      });
      const { service } = fixture('deepseek', http);
      const input = { ...request(model), webSearch,
        ...(preparation ? { profile: { name: '', background: '', jobDescription: '' } } : {}) };
      const emit = vi.fn();
      await expect(service.stream(input, emit, new AbortController().signal))
        .resolves.toMatchObject({ answerText: '正常答复', sources: [] });
      expect(emit).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'sources' }));
    });
  it.each([true, false])('records usage and distinguishes refusal from interrupted web responses (refusal=%s)', async refused => {
    const tokens = { prompt_tokens: 13, completion_tokens: 8, total_tokens: 21 };
    const http = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ data: [{ ...deepModel, id: 'deepseek-flash' }] }))
      .mockResolvedValueOnce(sse([chunk({ content: '{"answer":"收到部分正文' }), refused
        ? { ...chunk({}, 'content_filter'), usage: tokens }
        : { error: { message: 'reserved-error' }, choices: [], usage: tokens }]));
    const { service, usage } = fixture('deepseek', http);
    const input = { ...request('deepseek-flash'), webSearch: true, profile: { name: '', background: '', jobDescription: '' } };
    await expect(service.stream(input, vi.fn(), new AbortController().signal)).rejects.toMatchObject({ detail: refused
      ? { code: 'content_filter', discardPartial: true }
      : { message: '模型服务返回流式错误，已保留收到的回答。' } });
    expect(usage.add).toHaveBeenCalledExactlyOnceWith(expect.any(String), 'response-id',
      { inputTokens: 13, outputTokens: 8, totalTokens: 21 });
  });
  it('stores usage from a length-limited answer without completing a partial proposal', async () => {
    const http = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ data: [deepModel] }))
      .mockResolvedValueOnce(
        sse([
          chunk({ content: 'partial' }, 'length'),
          {
            id: 'response-id',
            choices: [],
            usage: { prompt_tokens: 8, completion_tokens: 2, total_tokens: 10 },
          },
        ]),
      );
    const { service, usage } = fixture('deepseek', http);
    await expect(
      service.stream(request('sample'), vi.fn(), new AbortController().signal),
    ).rejects.toThrow('未完整');
    expect(usage.add).toHaveBeenCalledWith(expect.any(String), 'response-id', {
      inputTokens: 8,
      outputTokens: 2,
      totalTokens: 10,
    });
  });
  it('preserves large image bytes and UTF-8 text on the compatible wire and aborts before sending', async () => {
    const image = Buffer.alloc(4 * 1024 * 1024 + 1, 73);
    const text = 'a'.repeat(32764) + '🚀"\\\n'.repeat(16000);
    const input = request('sample');
    input.turns[0].files = [
      { name: 'sample.png', bytes: image },
      { name: '说明.md', bytes: Buffer.from('\uFEFF' + text) },
    ];
    const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
      expect(init?.body).toBeInstanceOf(Blob);
      const payload = JSON.parse(await (init!.body as Blob).text());
      const [, imagePart, documentPart] = payload.messages.at(-1).content;
      const data = imagePart.image_url.url;
      const prefix = 'data:image/png;base64,';
      expect(data.startsWith(prefix)).toBe(true);
      expect(Buffer.from(data.slice(prefix.length), 'base64').equals(image)).toBe(true);
      expect(documentPart).toEqual({ type: 'text', text: '附件 说明.md：\n' + text });
      return sse([chunk({ content: 'ok' }, 'stop')]);
    });
    fetcher.mockResolvedValueOnce(Response.json({ data: [deepModel] }));
    const { service } = fixture('deepseek', fetcher);
    await service.models();
    fetcher.mockClear();
    const cancel = new AbortController();
    setImmediate(() => cancel.abort());
    await expect(service.stream(input, vi.fn(), cancel.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetcher).not.toHaveBeenCalled();
    await expect(service.stream(input, vi.fn(), new AbortController().signal))
      .resolves.toMatchObject({ answerText: 'ok' });
    for (const bytes of [Buffer.alloc(200001, 97), Buffer.from([0xc2])]) {
      input.turns[0].files = [{ name: '说明.md', bytes }];
      await expect(service.stream(input, vi.fn(), new AbortController().signal)).rejects.toThrow();
    }
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('lists only OpenAI API models compatible with streaming chat', async () => {
    const http = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json({ data: [
          { id: 'gpt-5.4' }, { id: 'gpt-image-1' }, { id: 'whisper-1' },
          { id: 'gpt-5-search-api-2025-10-14' }, { id: 'gpt-live-1.1' },
          { id: 'o1-pro' }, { id: 'o3-pro' }, { id: 'o3-pro-2025-06-10' },
          { id: 'gpt-5.5-pro' }, { id: 'gpt-5.5-pro-2026-04-23' },
          { id: 'o3' }, { id: 'gpt-5-pro' },
          { id: 'new-speech-model', input_modalities: ['text'], output_modalities: ['audio'] },
        ] }),
      );
    const { service } = fixture('openai', http);
    const [model] = await service.models();
    expect(model).toMatchObject({
      id: 'gpt-5.4',
      provider: { id: 'openai', name: apiProviders.openai.name },
      reasoningEfforts: ['none', 'low', 'medium', 'high', 'xhigh'],
    });
    expect((await service.models()).map(({ id }) => id)).toEqual(['gpt-5.4', 'o3', 'gpt-5-pro']);
  });
  it.each([
    ['gpt-5.2-pro', false], ['gpt-5.4-pro-2026-03-05', false], ['new-text-model', false],
    ['gpt-4o-2024-05-13', false], ['gpt-6.2-astra', true], ['gpt-5-pro', true],
  ] as const)('streams profile proposals on %s with the supported schema transport', async (id, native) => {
    const proposal = JSON.stringify({ answer: '已整理', changes: { name: '示例' }, skillScope: null });
    const http = vi.fn<typeof fetch>(async (url, init) => {
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer synthetic-api-key');
      if (String(url) === 'https://api.openai.com/v1/models') return Response.json({ data: [{ id }] });
      expect(String(url)).toBe('https://api.openai.com/v1/responses');
      const body = JSON.parse(String(init?.body));
      expect(body.model).toBe(id);
      expect(body.stream).toBe(true);
      if (native) expect(body.text.format).toMatchObject({ type: 'json_schema', strict: true });
      else {
        expect(body).not.toHaveProperty('text');
        expect(body.instructions).toContain('"required":["answer","changes","skillScope"]');
      }
      return sse([{ type: 'response.output_text.delta', delta: proposal },
        { type: 'response.completed', response: { status: 'completed', output: [] } }]);
    });
    const { service } = fixture('openai', http);
    const input = { ...request(id), profile: { name: '', background: '', jobDescription: '' } };
    await expect(service.stream(input, vi.fn(), new AbortController().signal))
      .resolves.toMatchObject({ answerText: '已整理', profileChanges: { name: '示例' } });
    expect(http).toHaveBeenCalledTimes(2);
  });
  it('keeps text fine-tunes with user-named suffixes and falls back to the ID for invalid optional labels', async () => {
    const fineTune = 'ft:gpt-4.1-mini-2025-04-14:org:my-image-classifier:example';
    const http = vi.fn<typeof fetch>(async (url, init) => {
      if (String(url).endsWith('/models')) return Response.json({ data: [
        { id: fineTune, display_name: null },
        { id: 'future-text', display_name: ' ' },
        { id: 'future-alias', display_name: 'New alias' },
        { id: 'ft:gpt-image-1:org:my-custom-name:example' },
      ] });
      expect(String(url)).toBe('https://api.openai.com/v1/responses');
      expect(JSON.parse(String(init?.body)).model).toBe(fineTune);
      return sse([
        { type: 'response.output_text.delta', delta: 'ok' },
        { type: 'response.completed', response: { status: 'completed', output: [] } },
      ]);
    });
    const { service } = fixture('openai', http);
    expect(await service.models()).toMatchObject([
      { id: fineTune, label: fineTune, reasoningEfforts: [] },
      { id: 'future-text', label: 'future-text' },
      { id: 'future-alias', label: 'New alias' },
    ]);
    await expect(service.stream(request(fineTune), vi.fn(), new AbortController().signal))
      .resolves.toMatchObject({ answerText: 'ok' });
  });
  it('distinguishes OpenAI prepaid credit from throttling in HTTP and streamed Responses errors', async () => {
    const http = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ data: [{ id: 'gpt-6.2-sol' }] }))
      .mockResolvedValueOnce(Response.json({ error: { code: 'credit_balance_exhausted', message: 'private diagnostic' } }, { status: 429 }))
      .mockResolvedValueOnce(sse([{ type: 'error', code: 'rate_limit_exceeded', message: 'private diagnostic' }]));
    const { service } = fixture('openai', http);
    const stream = () => service.stream(request('gpt-6.2-sol'), vi.fn(), new AbortController().signal);
    await expect(stream()).rejects.toMatchObject({ detail: { status: 429, code: 'credit_balance_exhausted', message: 'API 账户可用余额不足，请查看服务商账单。' } });
    await expect(stream()).rejects.toMatchObject({ detail: { code: 'rate_limit_exceeded', message: 'API 服务已达到调用限额，请查看服务商用量或稍后重试。' } });
  });
  it('uses documented GPT-6 capabilities for ID-only catalogs and honors more specific server metadata', async () => {
    const http = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          data: [
            { id: 'gpt-6.2-sol' },
            { id: 'gpt-6.2-astra' },
            { id: 'gpt-6.1-terra' },
            { id: 'gpt-6-luna' },
            {
              id: 'gpt-6.2-sol-2026-11-17',
              supported_reasoning_levels: ['medium'],
              input_modalities: ['text'],
              web_search_tool_type: 'disabled',
            },
          ],
        }),
      )
      .mockImplementationOnce(async (url, init) => {
        expect(String(url)).toBe('https://api.openai.com/v1/responses');
        expect(JSON.parse(String(init?.body))).toMatchObject({
          model: 'gpt-6.2-sol',
          reasoning: { effort: 'max' },
          tools: [{ type: 'web_search' }],
        });
        return sse([
          { type: 'response.output_text.delta', delta: 'ok' },
          {
            type: 'response.completed',
            response: { id: 'resp-6', status: 'completed', output: [] },
          },
        ]);
      });
    const { service } = fixture('openai', http);
    const levels = ['low', 'medium', 'high', 'xhigh', 'max'];
    expect(await service.models()).toMatchObject([
      { reasoningEfforts: levels, imageInput: true, webSearch: true },
      { reasoningEfforts: levels, imageInput: true, webSearch: true },
      { reasoningEfforts: ['none', ...levels], imageInput: true, webSearch: true },
      { reasoningEfforts: ['none', ...levels], imageInput: true, webSearch: true },
      { reasoningEfforts: ['medium'], imageInput: false, webSearch: undefined },
    ]);
    await expect(
      service.stream(
        { ...request('gpt-6.2-sol'), effort: 'none' },
        vi.fn(),
        new AbortController().signal,
      ),
    ).rejects.toThrow('思考强度');
    await expect(
      service.stream(
        { ...request('gpt-6.2-sol'), effort: 'max', webSearch: true },
        vi.fn(),
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({ answerText: 'ok' });
    expect(http).toHaveBeenCalledTimes(2);
  });
  it('reads real balance fields, rejects malformed balances, skips unsupported providers', async () => {
    const http = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          balance_infos: [
            {
              currency: 'CNY',
              total_balance: '1.00',
              granted_balance: '1.00',
              topped_up_balance: '0.00',
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        Response.json({ balance_infos: [{ currency: 'USD', total_balance: 'invalid' }] }),
      );
    const signal = new AbortController().signal;
    await expect(readApiBalance('deepseek', credential, signal, http)).resolves.toEqual([
      { currency: 'CNY', total: '1.00', granted: '1.00', toppedUp: '0.00' },
    ]);
    await expect(readApiBalance('deepseek', credential, signal, http)).rejects.toThrow('余额');
    expect(http.mock.calls.map(call => String(call[0]))).toEqual([
      'https://api.deepseek.com/user/balance', 'https://api.deepseek.com/user/balance',
    ]);
    await expect(readApiBalance('openai', credential, signal, http)).resolves.toEqual([]);
    expect(http).toHaveBeenCalledTimes(2);
  });
  it('never forwards an echoed credential in API errors and cancels blocked streams on disconnect', async () => {
    const bad = fixture(
      'deepseek',
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(Response.json({ error: { message: credential.key } }, { status: 401 })),
    );
    await expect(bad.service.models()).rejects.toMatchObject({ detail: { status: 401 } });
    let waiting!: () => void;
    const active = new Promise<void>((resolve) => {
      waiting = resolve;
    });
    const http = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ data: [deepModel] }))
      .mockImplementationOnce(async (_url, init) => {
        waiting();
        return new Promise<Response>((_resolve, reject) =>
          init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason), {
            once: true,
          }),
        );
      });
    const { service } = fixture('deepseek', http);
    const pending = service.stream(request('sample'), vi.fn(), new AbortController().signal);
    await active;
    service.invalidateModels();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });
});
