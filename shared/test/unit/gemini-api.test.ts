import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { GOOGLE_SEARCH_SUGGESTIONS_LIMIT, type ChatEvent, type ChatRequest } from '../../electron/contracts/chat';
import { createApiChatService, readApiBalance } from '../../electron/backend/api/service';
import { noWebSearchInstructions } from '../../electron/backend/chat/input';
import { profileFormat, profileSchemaInstructions } from '../../electron/backend/chat/profile';
import type { UsageLedger } from '../../electron/backend/chat/usage';

const base = 'https://generativelanguage.googleapis.com/v1beta';
const key = 'synthetic-gemini-key';
const model = {
  name: 'models/gemini-2.5-flash', displayName: 'Gemini 2.5 Flash',
  supportedGenerationMethods: ['generateContent'], thinking: true,
};
const input = (overrides: Partial<ChatRequest> = {}): ChatRequest => ({
  id: 'gemini-request', modelId: 'gemini-2.5-flash', instructions: '回答当前问题', webSearch: false,
  turns: [{ role: 'user', content: '合成问题' }], ...overrides,
});
const sse = (events: unknown[]) => new Response(
  events.map(event => 'data: ' + JSON.stringify(event) + '\n\n').join(''),
  { headers: { 'content-type': 'text/event-stream' } },
);
const candidate = (text: string, finishReason?: string) => ({
  responseId: 'synthetic-gemini-response',
  candidates: [{ content: { parts: [{ text }] }, ...(finishReason ? { finishReason } : {}) }],
});
function fixture(http: typeof fetch) {
  const ledger = { add: vi.fn(), get: vi.fn(), reset: vi.fn() };
  return {
    ledger,
    service: createApiChatService('gemini', async () => ({ key }), ledger as unknown as UsageLedger, http),
  };
}

describe('Gemini API', () => {
  it.each(['gemini-4-hydrogen', 'gemini-2.5-flash'])('accepts profile replies from the shared preview transport for %s', async modelId => {
    const { transport } = createRequire(import.meta.url)('../fixtures/api-interactive-preview.cjs');
    const { service } = fixture(transport('gemini', key));
    const events: ChatEvent[] = [];
    const result = await service.stream(input({ modelId, profile: { name: '', background: '', jobDescription: '' } }),
      event => events.push(event), new AbortController().signal);
    expect(result.answerText).toContain(modelId);
    expect(result.profileChanges).toEqual({});
    expect(events.flatMap(event => event.type === 'delta' ? [event.text] : []).join('')).toBe(result.answerText);
  });

  it('discovers paginated generation models and preserves automatic-only support for a new model', async () => {
    const http = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ models: [model,
        { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] },
      ], nextPageToken: 'next-page' }))
      .mockResolvedValueOnce(Response.json({ models: [model,
        { name: 'models/gemini-future', displayName: 'Future', supportedGenerationMethods: ['generateContent'] },
      ] }));
    const { service } = fixture(http);
    const models = await service.models();
    expect(models.map(entry => entry.id)).toEqual(['gemini-2.5-flash', 'gemini-future']);
    expect(models[0]).toMatchObject({ label: 'Gemini 2.5 Flash', provider: { id: 'gemini', dataRecipient: 'Google' } });
    expect(models[0].reasoningEfforts).toContain('high');
    expect(models[1].reasoningEfforts ?? []).toEqual([]);
    for (const [url, init] of http.mock.calls) {
      const endpoint = new URL(String(url));
      expect(endpoint.origin + endpoint.pathname).toBe(base + '/models');
      expect(endpoint.searchParams.has('key')).toBe(false);
      expect(new Headers(init?.headers).get('x-goog-api-key')).toBe(key);
      expect(init?.redirect).toBe('error');
    }
    expect(new URL(String(http.mock.calls[1][0])).searchParams.get('pageToken')).toBe('next-page');
  });

  it('streams an interview with history and image input, counts thinking tokens and keeps thoughts private', async () => {
    const http = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ models: [model] }))
      .mockImplementationOnce(async (url, init) => {
        expect(String(url)).toBe(base + '/models/gemini-2.5-flash:streamGenerateContent?alt=sse');
        expect(new Headers(init?.headers).get('x-goog-api-key')).toBe(key);
        const body = JSON.parse(init?.body instanceof Blob ? await init.body.text() : String(init?.body));
        expect(body.contents).toEqual([
          { role: 'user', parts: [{ text: '第一轮' }] },
          { role: 'model', parts: [{ text: '上一轮回答' }] },
          { role: 'user', parts: [{ text: '图片问题' }, { inlineData: { mimeType: 'image/png', data: 'AQID' } }] },
        ]);
        expect(body.generationConfig.thinkingConfig.thinkingBudget).toBe(24576);
        expect(body).not.toHaveProperty('tools');
        return sse([
          { candidates: [{ content: { parts: [{ text: 'private synthetic thought', thought: true }] } }] },
          candidate('回答'),
          { ...candidate('正文', 'STOP'), usageMetadata: {
            promptTokenCount: 12, candidatesTokenCount: 5, thoughtsTokenCount: 3, totalTokenCount: 20,
          } },
        ]);
      });
    const { service, ledger } = fixture(http);
    const events: ChatEvent[] = [];
    const reply = await service.stream(input({ effort: 'high', webSearch: true, turns: [
      { role: 'user', content: '第一轮' }, { role: 'assistant', content: '上一轮回答' },
      { role: 'user', content: '图片问题', files: [{ name: 'synthetic.png', bytes: Uint8Array.of(1, 2, 3) }] },
    ] }), event => events.push(event), new AbortController().signal);
    expect(reply).toMatchObject({ answerText: '回答正文', provider: { id: 'gemini' },
      usage: { inputTokens: 12, outputTokens: 8, totalTokens: 20 } });
    expect(events.filter(event => event.type === 'delta').map(event => event.text).join('')).toBe('回答正文');
    expect(JSON.stringify(events)).not.toContain('private synthetic thought');
    expect(ledger.add).toHaveBeenCalledWith(expect.stringMatching(/^gemini:[a-f0-9]{64}$/),
      'synthetic-gemini-response', { inputTokens: 12, outputTokens: 8, totalTokens: 20 });
  });

  it('uses only Google Search for eligible preparation and preserves its suggestions and verified sources', async () => {
    const text = JSON.stringify({ answer: '已生成待确认的姓名提案。', changes: { name: '合成姓名' }, skillScope: null });
    const html = '<style>.chip{color:blue}</style><a class="chip" href="https://www.google.com/search?q=synthetic">Synthetic search</a>';
    const source = { title: 'Synthetic guide', url: 'https://example.org/guide' };
    const http = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ models: [model] }))
      .mockImplementationOnce(async (url, init) => {
        expect(String(url)).toContain('https://generativelanguage.googleapis.com/');
        const body = JSON.parse(init?.body instanceof Blob ? await init.body.text() : String(init?.body));
        expect(body.tools).toEqual([{ google_search: {} }]);
        expect(body.systemInstruction.parts[0].text).toContain('搜索词和网址不得包含个人资料');
        const result = candidate(text, 'STOP');
        Object.assign(result.candidates[0], { groundingMetadata: {
          webSearchQueries: ['synthetic query'], searchEntryPoint: { renderedContent: html },
          groundingChunks: [{ web: { uri: source.url, title: source.title } },
            { web: { uri: source.url + '#overview', title: 'Duplicate' } },
            { web: { uri: 'file:///synthetic/private', title: 'Unsafe' } }],
        } });
        return sse([result]);
      });
    const { service } = fixture(http);
    const events: ChatEvent[] = [];
    const reply = await service.stream(input({ webSearch: true,
      profile: { name: '', background: '', jobDescription: '' },
      turns: [{ role: 'user', content: '把姓名修改为合成姓名，并核验公开资料。' }],
    }), event => events.push(event), new AbortController().signal);
    expect(reply).toMatchObject({ answerText: '已生成待确认的姓名提案。', sources: [source],
      googleSearchSuggestions: html, profileChanges: { name: '合成姓名' }, provider: { id: 'gemini' } });
    const suggestionsAt = events.findIndex(event => event.type === 'google-search-suggestions');
    expect(suggestionsAt).toBeGreaterThan(-1);
    expect(events.findIndex(event => event.type === 'sources')).toBeGreaterThan(suggestionsAt);
    expect(events.findIndex(event => event.type === 'delta')).toBeGreaterThan(suggestionsAt);
    expect(events).toContainEqual({ id: 'gemini-request', type: 'search' });
    expect(http).toHaveBeenCalledTimes(2);
  });

  it('constrains Gemini 3 profile replies with the native schema and keeps older models on the prompt schema', async () => {
    const current = { name: 'models/gemini-3.5-flash-lite', displayName: 'Gemini 3.5 Flash Lite',
      supportedGenerationMethods: ['generateContent'], thinking: true };
    const profile = { name: '', background: '', jobDescription: '' };
    // Native JSON arrives indented and split mid-string, as Gemini 3.5 Flash Lite returned it live.
    const reply = () => sse([candidate('{\n  "answer": "合成'), candidate('回答",\n  "changes": {},\n'),
      candidate('  "skillScope": null\n}', 'STOP')]);
    const bodies: Array<{ tools?: unknown; generationConfig?: Record<string, unknown>;
      systemInstruction: { parts: Array<{ text: string }> } }> = [];
    const http = vi.fn<typeof fetch>(async (url, init) => {
      if (String(url).endsWith('/models?pageSize=1000')) return Response.json({ models: [current, model] });
      bodies.push(JSON.parse(String(init?.body)));
      return reply();
    });
    const { service } = fixture(http);
    const signal = new AbortController().signal;
    const events: ChatEvent[] = [];
    await expect(service.stream(input({ modelId: 'gemini-3.5-flash-lite', effort: 'minimal', webSearch: true, profile }),
      event => events.push(event), signal)).resolves.toMatchObject({ answerText: '合成回答' });
    expect(events.flatMap(event => event.type === 'delta' ? [event.text] : [])).toEqual(['合成', '回答']);
    await service.stream(input({ modelId: 'gemini-3.5-flash-lite' }), vi.fn(), signal);
    await service.stream(input({ webSearch: true, profile }), vi.fn(), signal);
    const [native, interview, older] = bodies;
    expect(native.tools).toEqual([{ google_search: {} }]);
    expect(native.generationConfig).toEqual({ thinkingConfig: { thinkingLevel: 'minimal' },
      responseMimeType: 'application/json', responseJsonSchema: profileFormat.format.schema });
    expect(native.systemInstruction.parts[0].text).not.toContain(profileSchemaInstructions);
    expect(interview.generationConfig).toEqual({ thinkingConfig: {} });
    expect(older.generationConfig).toEqual({ thinkingConfig: {} });
    expect(older.systemInstruction.parts[0].text).toContain(profileSchemaInstructions);
  });

  it.each([false, true])('does not invent a search when Google returns no grounding (enabled=%s)', async webSearch => {
    const http = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ models: [model] }))
      .mockImplementationOnce(async (_, init) => {
        const body = JSON.parse(String(init?.body));
        expect(body.tools).toEqual(webSearch ? [{ google_search: {} }] : undefined);
        return sse([candidate(JSON.stringify({ answer: '普通回答', changes: {}, skillScope: null }), 'STOP')]);
      });
    const { service } = fixture(http);
    const events: ChatEvent[] = [];
    const result = await service.stream(input({ webSearch, profile: { name: '', background: '', jobDescription: '' } }),
      event => events.push(event), new AbortController().signal);
    expect(result).toMatchObject({ answerText: '普通回答', sources: [] });
    expect(result.googleSearchSuggestions).toBeUndefined();
    expect(events.some(event => event.type === 'search')).toBe(false);
  });

  it('keeps an unrecognized model on its own endpoint without guessing search support', async () => {
    const http = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ models: [{ ...model, name: 'models/gemini-future' }] }))
      .mockImplementationOnce(async (_, init) => {
        expect(JSON.parse(String(init?.body))).not.toHaveProperty('tools');
        return sse([candidate(JSON.stringify({ answer: '未知模型的普通回答', changes: {}, skillScope: null }), 'STOP')]);
      });
    await expect(fixture(http).service.stream(input({ modelId: 'gemini-future', webSearch: true,
      profile: { name: '', background: '', jobDescription: '' },
    }), vi.fn(), new AbortController().signal)).resolves.toMatchObject({ sources: [] });
    expect(http).toHaveBeenCalledTimes(2);
  });

  it.each([undefined, 'x'.repeat(GOOGLE_SEARCH_SUGGESTIONS_LIMIT + 1)])('rejects grounded output without a complete suggestions widget', async html => {
    const result = candidate(JSON.stringify({ answer: '需要配套建议的回答', changes: {}, skillScope: null }), 'STOP');
    Object.assign(result.candidates[0], { groundingMetadata: {
      webSearchQueries: ['synthetic query'], searchEntryPoint: { renderedContent: html },
    } });
    const http = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ models: [model] })).mockResolvedValueOnce(sse([result]));
    await expect(fixture(http).service.stream(input({ webSearch: true,
      profile: { name: '', background: '', jobDescription: '' },
    }), vi.fn(), new AbortController().signal)).rejects.toMatchObject({ detail: { discardPartial: true, code: 'grounding_suggestions_missing' } });
  });

  it('discards unpaired grounded content when the upstream stream fails before suggestions arrive', async () => {
    const result = candidate('部分回答');
    Object.assign(result.candidates[0], { groundingMetadata: { webSearchQueries: ['synthetic query'] } });
    const http = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ models: [model] }))
      .mockResolvedValueOnce(sse([result, { error: { code: 429, status: 'RESOURCE_EXHAUSTED' } }]));
    await expect(fixture(http).service.stream(input({ webSearch: true,
      profile: { name: '', background: '', jobDescription: '' },
    }), vi.fn(), new AbortController().signal)).rejects.toMatchObject({ detail: { discardPartial: true, code: 'grounding_suggestions_missing' } });
  });

  it('verifies a skill proposal against actual Google grounding and rejects invented sources', async () => {
    const real = { title: 'Synthetic official guide', url: 'https://example.org/gemini-guide' };
    const invented = { title: 'Invented guide', url: 'https://example.org/invented' };
    const skill = { id: 'synthetic-skill', title: '合成技能', content: '依据本轮资料准备面试。', sources: [real, invented] };
    const result = candidate(JSON.stringify({ answer: '已整理待确认技能。', changes: { skills: [skill] }, skillScope: 'all' }), 'STOP');
    Object.assign(result.candidates[0], { groundingMetadata: {
      webSearchQueries: ['synthetic official guide'], searchEntryPoint: { renderedContent: '<div>Google Search suggestions</div>' },
      groundingChunks: [{ web: { uri: real.url, title: real.title } }],
    } });
    const http = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ models: [model] })).mockResolvedValueOnce(sse([result]));
    const response = await fixture(http).service.stream(input({ webSearch: true, profileTask: 'skills',
      profile: { name: '', background: '合成背景', jobDescription: '合成职位描述' },
    }), vi.fn(), new AbortController().signal);
    expect(response.profileChanges?.skills).toEqual([{ ...skill, sources: [real] }]);
    expect(response.skillSourceIssues).toEqual([{ skillId: skill.id, reason: 'source_unmatched', sources: [invented] }]);
  });

  it('rejects unsupported manual thinking before sending a generation request', async () => {
    const http = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ models: [{ ...model, thinking: false }] }));
    const { service } = fixture(http);
    await expect(service.stream(input({ effort: 'high' }), vi.fn(), new AbortController().signal))
      .rejects.toThrow('思考');
    expect(http).toHaveBeenCalledOnce();
  });

  it('preserves large image and UTF-8 attachment contents on the native wire', async () => {
    const image = Buffer.alloc(4 * 1024 * 1024 + 1, 73);
    const text = '合成附件🚀\"\\\n'.repeat(12000);
    const http = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ models: [model] }))
      .mockImplementationOnce(async (_, init) => {
        const body = JSON.parse(init?.body instanceof Blob ? await init.body.text() : String(init?.body));
        const parts = body.contents[0].parts;
        expect(Buffer.from(parts[1].inlineData.data, 'base64').equals(image)).toBe(true);
        expect(parts[2].text).toBe('附件 合成.txt：\n' + text);
        return sse([candidate('已接收合成附件', 'STOP')]);
      });
    const { service } = fixture(http);
    await expect(service.stream(input({ turns: [{ role: 'user', content: '附件问题', files: [
      { name: 'synthetic.png', bytes: image }, { name: '合成.txt', bytes: Buffer.from(text) },
    ] }] }), vi.fn(), new AbortController().signal)).resolves.toMatchObject({ answerText: '已接收合成附件' });
  });

  it.each(['MAX_TOKENS', 'SAFETY'])('does not accept a truncated or blocked completion (%s)', async finishReason => {
    const http = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ models: [model] }))
      .mockResolvedValueOnce(sse([candidate('部分内容', finishReason)]));
    const { service } = fixture(http);
    await expect(service.stream(input(), vi.fn(), new AbortController().signal)).rejects.toThrow();
  });

  it('keeps received token usage when a stream ends in a provider error', async () => {
    const http = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ models: [model] }))
      .mockResolvedValueOnce(sse([
        { ...candidate('已接收部分正文'), usageMetadata: {
          promptTokenCount: 12, candidatesTokenCount: 5, thoughtsTokenCount: 3, totalTokenCount: 20,
        } },
        { error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: key } },
      ]));
    const { service, ledger } = fixture(http);
    const failure = service.stream(input(), vi.fn(), new AbortController().signal);
    await expect(failure).rejects.toMatchObject({ detail: { status: 429 } });
    await expect(failure).rejects.not.toThrow(key);
    expect(ledger.add).toHaveBeenCalledWith(expect.stringMatching(/^gemini:[a-f0-9]{64}$/),
      'synthetic-gemini-response', { inputTokens: 12, outputTokens: 8, totalTokens: 20 });
  });

  it('keeps a prompt safety block effective when a later candidate reports STOP', async () => {
    const http = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ models: [model] }))
      .mockResolvedValueOnce(sse([
        { promptFeedback: { blockReason: 'SAFETY' } }, candidate('被屏蔽的合成正文', 'STOP'),
      ]));
    const { service } = fixture(http);
    await expect(service.stream(input(), vi.fn(), new AbortController().signal))
      .rejects.toMatchObject({ detail: { code: 'content_filter', discardPartial: true } });
  });

  it('redacts remote diagnostics and skips a balance request when the provider has no balance API', async () => {
    const http = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ error: {
      code: 400, status: 'INVALID_ARGUMENT', message: key,
    } }, { status: 400 }));
    const { service } = fixture(http);
    const failure = service.models();
    await expect(failure).rejects.toThrow();
    await expect(failure).rejects.not.toThrow(key);
    expect(http).toHaveBeenCalledTimes(1);
    http.mockClear();
    await expect(readApiBalance('gemini', { key }, new AbortController().signal, http)).resolves.toEqual([]);
    expect(http).not.toHaveBeenCalled();
  });

  it('cancels an in-flight generation when the connection is invalidated', async () => {
    const started = Promise.withResolvers<void>();
    const http = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ models: [model] }))
      .mockImplementationOnce(async (_, init) => {
        started.resolve();
        return new Promise<Response>((_, reject) => init!.signal!.addEventListener('abort',
          () => reject(init!.signal!.reason), { once: true }));
      });
    const { service } = fixture(http);
    const pending = service.stream(input(), vi.fn(), new AbortController().signal);
    await started.promise;
    service.invalidateModels();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  describe('temporary overload', () => {
    const busy = () => Response.json({ error: { code: 503, status: 'UNAVAILABLE', message: key } }, { status: 503 });
    const limited = (retryDelay?: string) => Response.json({ error: {
      code: 429, status: 'RESOURCE_EXHAUSTED', message: key,
      details: retryDelay ? [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay }] : [],
    } }, { status: 429 });
    const retryStatus = (status: string, detail: string) => expect.objectContaining({
      type: 'activity', activity: expect.objectContaining({ id: 'gemini-retry', status, detail }),
    });
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('resends an overloaded generation after 1 s and 3 s and reports the retry while waiting', async () => {
      const http = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ models: [model] }))
        .mockResolvedValueOnce(busy()).mockResolvedValueOnce(busy())
        .mockResolvedValueOnce(sse([candidate('重试后的合成回答', 'STOP')]));
      const { service } = fixture(http);
      const events: ChatEvent[] = [];
      const pending = service.stream(input(), event => events.push(event), new AbortController().signal);
      await vi.advanceTimersByTimeAsync(999);
      expect(http).toHaveBeenCalledTimes(2);
      expect(events).toContainEqual(retryStatus('in_progress', '模型服务繁忙，正在自动重试'));
      await vi.advanceTimersByTimeAsync(1000);
      expect(http).toHaveBeenCalledTimes(3);
      await vi.advanceTimersByTimeAsync(3000);
      await expect(pending).resolves.toMatchObject({ answerText: '重试后的合成回答' });
      expect(http).toHaveBeenCalledTimes(4);
      expect(http.mock.calls[3][1]?.body).toBe(http.mock.calls[1][1]?.body);
      expect(events).toContainEqual(retryStatus('completed', '模型服务繁忙，已自动重试'));
    });

    it('gives up after two retries, stops waiting on cancellation and keeps the provider text private', async () => {
      const http = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ models: [model] }))
        .mockImplementation(async () => busy());
      const { service } = fixture(http);
      const failure = service.stream(input(), vi.fn(), new AbortController().signal);
      failure.catch(() => {});
      await vi.advanceTimersByTimeAsync(4000);
      await expect(failure).rejects.toMatchObject({ detail: { status: 503, code: 'UNAVAILABLE' } });
      await expect(failure).rejects.not.toThrow(key);
      expect(http).toHaveBeenCalledTimes(4);

      http.mockClear();
      const controller = new AbortController();
      const cancelled = service.stream(input(), vi.fn(), controller.signal);
      cancelled.catch(() => {});
      await vi.advanceTimersByTimeAsync(500);
      controller.abort();
      await expect(cancelled).rejects.toMatchObject({ name: 'AbortError' });
      await vi.advanceTimersByTimeAsync(5000);
      expect(http).toHaveBeenCalledTimes(1);
    });

    it('waits out only a short per-minute limit and retries model discovery the same way', async () => {
      const short = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ models: [model] }))
        .mockResolvedValueOnce(limited('2.5s'))
        .mockResolvedValueOnce(sse([candidate('限额恢复后的合成回答', 'STOP')]));
      const pending = fixture(short).service.stream(input(), vi.fn(), new AbortController().signal);
      await vi.advanceTimersByTimeAsync(2499);
      expect(short).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(1);
      await expect(pending).resolves.toMatchObject({ answerText: '限额恢复后的合成回答' });

      for (const response of [limited('40s'), limited()]) {
        const http = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ models: [model] }))
          .mockResolvedValueOnce(response);
        await expect(fixture(http).service.stream(input(), vi.fn(), new AbortController().signal))
          .rejects.toMatchObject({ detail: { status: 429 } });
        expect(http).toHaveBeenCalledTimes(2);
      }

      const discovery = vi.fn<typeof fetch>().mockResolvedValueOnce(busy())
        .mockResolvedValueOnce(Response.json({ models: [model] }));
      const models = fixture(discovery).service.models();
      await vi.advanceTimersByTimeAsync(1000);
      await expect(models).resolves.toHaveLength(1);
    });

    it('answers without Google Search when only the search quota is exhausted and says so', async () => {
      const preparation = input({ webSearch: true, profile: { name: '', background: '', jobDescription: '' } });
      const bodies: Array<{ tools?: unknown; systemInstruction: { parts: Array<{ text: string }> } }> = [];
      const record = async (_: unknown, init?: RequestInit) => {
        bodies.push(JSON.parse(String(init?.body)));
      };
      const http = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ models: [model] }))
        .mockImplementationOnce(async (url, init) => (await record(url, init), limited()))
        .mockImplementationOnce(async (url, init) => (await record(url, init), sse([
          candidate(JSON.stringify({ answer: '未联网的合成回答', changes: {}, skillScope: null }), 'STOP'),
        ])));
      const { service } = fixture(http);
      const events: ChatEvent[] = [];
      const result = await service.stream(preparation, event => events.push(event), new AbortController().signal);
      expect(bodies.map(body => body.tools)).toEqual([[{ google_search: {} }], undefined]);
      expect(bodies[1].systemInstruction.parts[0].text).toContain(noWebSearchInstructions);
      expect(result).toMatchObject({ answerText: '未联网的合成回答', sources: [],
        warning: 'Google 搜索额度已用完，本次未联网回答。' });
      expect(result.googleSearchSuggestions).toBeUndefined();
      expect(events).toContainEqual(expect.objectContaining({ type: 'activity', activity: expect.objectContaining({
        id: 'gemini-search-quota', detail: 'Google 搜索额度已用完，改为不联网回答' }) }));

      // The fallback is tried once; a request that never searched reports its own limit directly.
      const exhausted = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ models: [model] }))
        .mockResolvedValueOnce(limited()).mockResolvedValueOnce(limited());
      await expect(fixture(exhausted).service.stream(preparation, vi.fn(), new AbortController().signal))
        .rejects.toMatchObject({ detail: { status: 429 } });
      expect(exhausted).toHaveBeenCalledTimes(3);
      const plain = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ models: [model] }))
        .mockResolvedValueOnce(limited());
      await expect(fixture(plain).service.stream(input(), vi.fn(), new AbortController().signal))
        .rejects.toMatchObject({ detail: { status: 429 } });
      expect(plain).toHaveBeenCalledTimes(2);
    });
  });
});
