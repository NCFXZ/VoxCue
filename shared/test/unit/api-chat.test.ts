import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { apiProviderIds, apiProviders, type ApiProvider } from '../../electron/contracts/apiConnections';
import type { ChatEvent, ChatRequest } from '../../electron/contracts/chat';
import { translateUI } from '../../electron/contracts/uiLanguage';
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
  it.each(['anthropic', 'kimi'] as const)('preserves large UTF-8 text and mixed attachment order on the %s wire', async provider => {
    const claude = provider === 'anthropic';
    const model = claude ? 'claude-a' : 'kimi-k3';
    // The BOM leaves the first byte of the four-byte character at the end of a 32 KiB block.
    const text = 'a'.repeat(32764) + '🚀"\\\n\u0000'.repeat(26000);
    const bytes = Buffer.from('\uFEFF' + text);
    const file = { name: '文"件.md', bytes };
    const png = { name: 'pic.png', bytes: Uint8Array.of(0, 1, 2, 3).subarray(1, 3) };
    const input = request(model);
    input.turns = [
      { role: 'user', content: 'old', files: [file, png] },
      { role: 'assistant', content: 'reply' },
      { role: 'user', content: 'current', files: [file, file, file, file] },
    ];
    const note = { type: 'text', text: '附件 ' + file.name + '：\n' + text };
    const image = claude
      ? { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AQI=' } }
      : { type: 'image_url', image_url: { url: 'data:image/png;base64,AQI=' } };
    const current = [{ type: 'text', text: 'current' }, note, note, note, note];
    const history = (key: string, value: string) => ({ type: 'text', text: JSON.stringify({ [key]: value }) });
    const wire = claude ? {
      model, stream: true, max_tokens: 8192, system: input.instructions,
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'old' }, note, image] },
        { role: 'assistant', content: 'reply' }, { role: 'user', content: current },
      ],
    } : {
      model, stream: true, stream_options: { include_usage: true },
      messages: [{ role: 'system', content: input.instructions }, { role: 'user', content: [
        history('historicalRole', 'user'), history('historicalText', 'old'), history('historicalText', note.text),
        image, history('historicalRole', 'assistant'), history('historicalText', 'reply'),
        { type: 'text', text: '以上为历史对话资料。以下为当前用户消息。' }, ...current,
      ] }],
    };
    const http = vi.fn<typeof fetch>(async (_, init) => {
      if (init?.method !== 'POST') return Response.json({ has_more: false, data: [{
        id: model, supports_image_in: true, capabilities: { image_input: { supported: true } },
      }] });
      expect(init.body instanceof Blob).toBe(true);
      const actual = Buffer.from(await (init.body as Blob).arrayBuffer());
      expect(actual.equals(Buffer.from(JSON.stringify(wire)))).toBe(true);
      return sse(claude ? [
        { type: 'content_block_delta', delta: { type: 'text_delta', text: 'ok' } },
        { type: 'message_delta', delta: { stop_reason: 'end_turn' } }, { type: 'message_stop' },
      ] : [chunk({ content: 'ok' }, 'stop')]);
    });
    const { service } = fixture(provider, http);
    await service.models();
    const cancel = new AbortController();
    setImmediate(() => cancel.abort());
    await expect(service.stream(input, vi.fn(), cancel.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(http).toHaveBeenCalledTimes(1);
    await expect(service.stream(input, vi.fn(), new AbortController().signal)).resolves.toMatchObject({ answerText: 'ok' });
    // Invalid trailing UTF-8 and overlength files must still fail before fetch.
    for (const invalid of [Buffer.concat([bytes, Uint8Array.of(0xc2)]), Buffer.alloc(200001, 97)]) {
      input.turns[0].files = [{ ...file, bytes: invalid }];
      await expect(service.stream(input, vi.fn(), new AbortController().signal)).rejects.toThrow();
    }
    expect(http).toHaveBeenCalledTimes(2);
  });
  it.each(['anthropic', 'kimi'] as const)('yields and preserves large attachment bytes on the %s wire', async provider => {
    const claude = provider === 'anthropic';
    const model = claude ? 'claude-a' : 'kimi-k3';
    const bytes = Buffer.alloc(4 * 1024 * 1024 + 1, 73);
    const input = request(model);
    input.turns[0].files = [{ name: 'sample.png', bytes }];
    const http = vi.fn<typeof fetch>(async (_, init) => {
      if (init?.method !== 'POST') return Response.json({ has_more: false, data: [{
        id: model, supports_image_in: true, capabilities: { image_input: { supported: true } },
      }] });
      expect(init.body).toBeInstanceOf(Blob);
      const payload = JSON.parse(await (init.body as Blob).text());
      const part = payload.messages.at(-1).content.at(-1);
      const data = claude ? part.source.data : part.image_url.url.slice('data:image/png;base64,'.length);
      expect(claude ? part.source.media_type : part.image_url.url.split(',')[0])
        .toBe(claude ? 'image/png' : 'data:image/png;base64');
      expect(Buffer.from(data, 'base64').equals(bytes)).toBe(true);
      return sse(claude ? [
        { type: 'message_start', message: { id: 'fixture' } },
        { type: 'content_block_delta', delta: { type: 'text_delta', text: 'ok' } },
        { type: 'message_delta', delta: { stop_reason: 'end_turn' } }, { type: 'message_stop' },
      ] : [chunk({ content: 'ok' }, 'stop')]);
    });
    const { service } = fixture(provider, http);
    await service.models();
    const cancel = new AbortController();
    setImmediate(() => cancel.abort());
    await expect(service.stream(input, vi.fn(), cancel.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(http).toHaveBeenCalledTimes(1);
    await expect(service.stream(input, vi.fn(), new AbortController().signal)).resolves.toMatchObject({ answerText: 'ok' });
  });
  it.each([
    { provider: 'kimi', accepted: ['lunar-preview', 'moonshot-v2-latest'],
      excluded: ['lunar-embedding-v2', 'kimi-audio'], extra: { supports_image_in: true, supports_reasoning: true } },
    { provider: 'glm', accepted: ['GLM-Frontier', 'nebula-chat', 'text-preview'],
      excluded: ['glm-image-v2', 'GLM-Embedding-next', 'cogvideo-chat', 'rerank-text', 'glm-4-assistant', 'GLM-4-AllTools'], extra: {} },
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
    expect(model.reasoningEfforts).toContain('high');
    const events: ChatEvent[] = [];
    const reply = await service.stream({ ...request(model.id), effort: 'high', webSearch: true }, event => events.push(event), new AbortController().signal);
    expect(reply.answerText).toContain(model.id);
    expect(reply.answerText).toContain('思考设置为 high');
    expect(reply.warning).toBeUndefined();
    expect(events.filter(event => event.type === 'delta').map(event => event.text).join('')).toBe(reply.answerText);
    expect(reply.usage).toEqual({ inputTokens: 48, outputTokens: 24, totalTokens: 72 });
    expect(usage.add).toHaveBeenCalledOnce();
  });
  it.each(['openai', 'deepseek'] as const)('keeps an in-flight %s answer running when another model is rejected', async provider => {
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
  it('refreshes Kimi’s domestic catalog and sends the newly returned ID with the same API key', async () => {
    const base = 'https://api.moonshot.cn/v1';
    let reads = 0;
    const http = vi.fn<typeof fetch>(async (url, init) => {
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer ' + credential.key);
      if (String(url) === base + '/models') {
        expect(init?.method ?? 'GET').toBe('GET');
        return Response.json({ object: 'list', data: [
          { id: ++reads === 1 ? 'moonshot-old' : 'moonshot-next', object: 'model', supports_image_in: false },
        ] });
      }
      expect([String(url), init?.method]).toEqual([base + '/chat/completions', 'POST']);
      expect(JSON.parse(String(init?.body))).toMatchObject({ model: 'moonshot-next', stream_options: { include_usage: true } });
      return sse([chunk({ content: 'ok' }, 'stop')]);
    });
    const { service } = fixture('kimi', http);
    expect((await service.models()).map(model => model.id)).toEqual(['moonshot-old']);
    expect((await service.models(true)).map(model => model.id)).toEqual(['moonshot-next']);
    const send = (model: string) => service.stream(request(model), vi.fn(), new AbortController().signal);
    await expect(send('moonshot-old')).rejects.toThrow('刷新模型列表');
    await expect(send('moonshot-next')).resolves.toMatchObject({ answerText: 'ok' });
    expect(http).toHaveBeenCalledTimes(3);
  });

  it('uses the Ark catalog version ID and accepts chat models hosted under other brands', async () => {
    const modalities = { input_modalities: ['text', 'image'], output_modalities: ['text'] };
    const seed = 'doubao-seed-2-1-pro-260915';
    const hosted = 'glm-5-3-flash-260828';
    const http = vi.fn<typeof fetch>(async (url, init) => {
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer synthetic-api-key');
      if (String(url) === 'https://ark.cn-beijing.volces.com/api/v3/models')
        return Response.json({ data: [
          { id: seed, name: 'doubao-seed-2-1-pro', status: 'Published', modalities },
          { id: hosted, status: 'Retiring', modalities },
          { id: 'custom-chat', modalities, features: { thinking: { type: 'enabled' } },
            effort: { supported_levels: ['low', 'high'] } },
          { id: 'retired', status: 'Retired', modalities },
          { id: 'audio-input', modalities: { ...modalities, input_modalities: ['audio'] } },
          { id: 'responses-only', api_supported: { chat_completions: false }, modalities },
        ] });
      expect(String(url)).toBe('https://ark.cn-beijing.volces.com/api/v3/chat/completions');
      expect(JSON.parse(String(init?.body))).toMatchObject({
        model: seed, stream: true, stream_options: { include_usage: true }, reasoning_effort: 'medium',
      });
      return sse([
        chunk({ reasoning_content: 'private' }), chunk({ content: 'ok' }, 'stop'),
        { id: 'response-id', choices: [], usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 } },
      ]);
    });
    const { service, usage } = fixture('doubao', http);
    const catalog = await service.models();
    expect(catalog.map((m) => [m.id, m.reasoningEfforts])).toEqual([
      [seed, ['none', 'low', 'medium', 'high']], [hosted, ['low', 'high', 'max']],
      ['custom-chat', ['low', 'high']],
    ]);
    const result = await service.stream({ ...request(seed), effort: 'medium' }, vi.fn(), new AbortController().signal);
    expect(result.answerText).toBe('ok');
    expect(result.usage).toMatchObject({ inputTokens: 3, outputTokens: 2, totalTokens: 5 });
    expect(usage.add).toHaveBeenCalledTimes(1);
    expect(http).toHaveBeenCalledTimes(2);
  });

  it.each(['deepseek-v4-1-flash-261017', 'deepseek-v4-1-flash-economy-261017'])(
    'reads inline Ark usage from %s without requesting a separate usage packet', async model => {
      const http = vi.fn<typeof fetch>()
        .mockResolvedValueOnce(Response.json({ data: [{ id: model, task_type: ['TextGeneration'] }] }))
        .mockImplementationOnce(async (_, init) => {
          const body = JSON.parse(String(init?.body));
          expect(body).toMatchObject({ model, stream: true });
          expect(body).not.toHaveProperty('stream_options');
          return sse([{ ...chunk({ content: 'ok' }, 'stop'), usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 } }]);
        });
      const { service, usage } = fixture('doubao', http);
      const result = await service.stream(request(model), vi.fn(), new AbortController().signal);
      expect(result.usage).toEqual({ inputTokens: 3, outputTokens: 2, totalTokens: 5 });
      expect(usage.add).toHaveBeenCalledOnce();
    },
  );

  it.each([
    ['kimi', 429, 'type', 'exceeded_current_quota_error', '额度不足'],
    ['kimi', 429, 'type', 'engine_overloaded_error', '服务节点繁忙'],
    ['doubao', 404, 'code', 'ModelNotOpen', '控制台开通'],
    ['doubao', 404, 'code', 'InvalidEndpointOrModel.ModelIDAccessDisabled', '推理接入点'],
  ] as const)('explains %s HTTP %i error.%s=%s without exposing raw messages', async (provider, status, field, code, hint) => {
    const http = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ data: [{ id: 'future-chat', task_type: ['Chat'] }] }))
      .mockResolvedValueOnce(Response.json({ error: { [field]: code, message: credential.key } }, { status }));
    const { service } = fixture(provider, http);
    const send = service.stream(request('future-chat'), vi.fn(), new AbortController().signal);
    await expect(send).rejects.toMatchObject({ detail: { status, code, message: expect.stringContaining(hint) } });
    await expect(send).rejects.not.toThrow(credential.key);
    await send.catch(({ detail }) => expect(translateUI(detail.message, 'en')).not.toMatch(/\p{Script=Han}/u));
  });

  it('discovers and sends a new Ark text model after refreshing the same connection', async () => {
    const fresh = 'new-provider-chat-2030';
    const turns: ChatRequest['turns'] = [
      { role: 'user', content: 'first question' }, { role: 'assistant', content: 'first answer' },
      { role: 'user', content: 'follow-up' },
    ];
    const http = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ data: [] }))
      .mockResolvedValueOnce(Response.json({ data: [
        { id: fresh, domain: 'LLM' },
        { id: 'new-chat-model', task_type: ['Chat'] },
        { id: 'visual-qa', task_type: ['VisualQuestionAnswering'],
          modalities: { input_modalities: ['text', 'image'], output_modalities: ['text'] } },
        { id: 'non-model-record', object: 'endpoint', domain: 'LLM' },
        { id: 'vector-model', domain: 'Embedding' },
        { id: 'translation-model', domain: 'LLM', task_type: ['Translation'], api_supported: { chat_completions: true },
          modalities: { input_modalities: ['text'], output_modalities: ['text'] } },
        { id: 'doubao-seed-translation-250915', task_type: ['TextGeneration'] },
        { id: 'doubao-seed-2-1-pro-260915', task_type: ['Translation'] },
        { id: 'other-endpoint', domain: 'LLM', api_supported: { chat_completions: false } },
        { id: 'image-generator', domain: 'LLM', modalities: { output_modalities: ['image'] } },
      ] }))
      .mockImplementationOnce(async (url, init) => {
        expect(String(url)).toBe('https://ark.cn-beijing.volces.com/api/v3/chat/completions');
        const body = JSON.parse(String(init?.body));
        expect(body.model).toBe(fresh);
        expect(body.messages).toEqual([{ role: 'system', content: '答复用户' }, ...turns]);
        expect(body).not.toHaveProperty('reasoning_effort');
        expect(body).not.toHaveProperty('thinking');
        return sse([chunk({ content: 'ok' }, 'stop')]);
      });
    const { service } = fixture('doubao', http);
    expect(await service.models()).toEqual([]);
    expect(await service.models(true)).toMatchObject([
      { id: fresh, reasoningEfforts: [] }, { id: 'new-chat-model', reasoningEfforts: [] },
      { id: 'visual-qa', imageInput: true },
    ]);
    const reply = await service.stream({ ...request(fresh), turns }, vi.fn(), new AbortController().signal);
    expect(reply.answerText).toBe('ok');
  });

  it('reloads the mainland GLM catalog when a listed model disappears at inference time', async () => {
    const base = 'https://open.bigmodel.cn/api/paas/v4';
    let reads = 0;
    const http = vi.fn<typeof fetch>(async (url, init) => {
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer ' + credential.key);
      if (String(url) === base + '/models') {
        expect(init?.method ?? 'GET').toBe('GET');
        const ids = ++reads === 1 ? ['glm-5.3'] : ['glm-next'];
        return Response.json({ object: 'list', data: ids.map(id => ({ id, object: 'model' })) });
      }
      expect([String(url), init?.method]).toEqual([base + '/chat/completions', 'POST']);
      const { model } = JSON.parse(String(init?.body));
      if (model === 'glm-5.3')
        return Response.json({ error: { code: '1211', message: credential.key } }, { status: 400 });
      expect(model).toBe('glm-next');
      return sse([chunk({ content: 'ok' }, 'stop')]);
    });
    const { service } = fixture('glm', http);
    expect((await service.models()).map(model => model.id)).toEqual(['glm-5.3']);
    const send = (id: string) => service.stream(request(id), vi.fn(), new AbortController().signal);
    await expect(send('glm-5.3')).rejects.toMatchObject({
      detail: { status: 400, code: 'model_not_found', message: '所选 API 模型当前不可用，请刷新模型列表。' },
    });
    expect((await service.models()).map(model => model.id)).toEqual(['glm-next']);
    await expect(send('glm-next')).resolves.toMatchObject({ answerText: 'ok' });
    expect(http).toHaveBeenCalledTimes(4);
  });

  it('distinguishes mainland GLM billing, access and capacity errors across discovery and generation', async () => {
    const error = (code: number | string) => ({ error: { code, message: credential.key } });
    const http = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(error('1315'), { status: 429 }))
      .mockResolvedValueOnce(Response.json({ data: [{ id: 'glm-5.3' }] }))
      .mockResolvedValueOnce(Response.json(error(1113), { status: 429 }))
      .mockResolvedValueOnce(Response.json(error('1311'), { status: 429 }))
      .mockResolvedValueOnce(Response.json(error('1302'), { status: 429 }))
      .mockResolvedValueOnce(Response.json(error('1305'), { status: 429 }))
      .mockResolvedValueOnce(sse([chunk({ content: 'partial' }, 'network_error')]))
      .mockResolvedValueOnce(sse([chunk({}, 'model_context_window_exceeded')]))
      .mockResolvedValueOnce(Response.json(error('9999'), { status: 400 }));
    const { service, usage } = fixture('glm', http);
    await expect(service.models()).rejects.toThrow('通用 API 密钥');
    const send = () => service.stream(request('glm-5.3'), vi.fn(), new AbortController().signal);
    await expect(send()).rejects.toThrow('余额不足');
    await expect(send()).rejects.toThrow('无权访问');
    await expect(send()).rejects.toThrow('调用限额');
    await expect(send()).rejects.toThrow('模型繁忙');
    await expect(send()).rejects.toThrow('推理中断');
    await expect(send()).rejects.toThrow('上下文窗口');
    await expect(send()).rejects.toMatchObject({ detail: {
      status: 400, message: 'API 服务未接受请求，请检查模型、输入及思考设置。',
    } });
    expect(usage.add).not.toHaveBeenCalled();
  });

  it('preserves GLM catalog IDs, distinguishes mandatory thinking, and records final-chunk usage', async () => {
    const ids = ['GLM-5V-Turbo', 'glm-4.5-airx', 'glm-4.6v-flashx', 'GLM-5.3', 'glm-5.3-flashx', 'glm-5.3-flashx-legal', 'glm-image'];
    const http = vi.fn<typeof fetch>(async (url, init) => {
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer synthetic-api-key');
      if (String(url) === 'https://open.bigmodel.cn/api/paas/v4/models')
        return Response.json({ data: ids.map((id) => ({ id })) });
      expect(String(url)).toBe('https://open.bigmodel.cn/api/paas/v4/chat/completions');
      const body = JSON.parse(String(init?.body));
      expect(body).toMatchObject({ model: 'GLM-5V-Turbo', stream: true, thinking: { type: 'disabled' } });
      expect(body).not.toHaveProperty('stream_options');
      return sse([chunk({ reasoning_content: 'private' }), { ...chunk({ content: 'ok' }, 'stop'),
        usage: { prompt_tokens: 4, completion_tokens: 3, total_tokens: 7 } }]);
    });
    const { service, usage } = fixture('glm', http);
    const catalog = await service.models();
    expect(catalog.map((m) => [m.id, m.imageInput, m.reasoningEfforts])).toEqual([
      ['GLM-5V-Turbo', true, ['none', 'on']], ['glm-4.5-airx', false, ['none', 'on']],
      ['glm-4.6v-flashx', true, ['none', 'on']], ['GLM-5.3', false, ['low', 'high', 'max']],
      ['glm-5.3-flashx', true, ['low', 'high', 'max']],
      ['glm-5.3-flashx-legal', true, ['low', 'high', 'max']],
    ]);
    await expect(service.stream({ ...request('GLM-5.3'), effort: 'none' }, vi.fn(), new AbortController().signal))
      .rejects.toThrow('思考强度');
    const result = await service.stream({ ...request('GLM-5V-Turbo'), effort: 'none' }, vi.fn(), new AbortController().signal);
    expect(result).toMatchObject({ answerText: 'ok', usage: { inputTokens: 4, outputTokens: 3, totalTokens: 7 } });
    expect(usage.add).toHaveBeenCalledTimes(1);
    expect(http).toHaveBeenCalledTimes(2);
    http.mockImplementationOnce(async (url, init) => {
      expect(String(url)).toBe('https://open.bigmodel.cn/api/paas/v4/chat/completions');
      expect(JSON.parse(String(init?.body))).toMatchObject({
        model: 'glm-5.3-flashx-legal', reasoning_effort: 'high',
        messages: [{ role: 'system' }, { role: 'user', content: [
          { type: 'text' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,AQ==' } },
        ] }],
      });
      return sse([chunk({ content: 'ok' }, 'stop')]);
    });
    const legal = request('glm-5.3-flashx-legal');
    legal.turns[0].files = [{ name: 'scan.png', bytes: new Uint8Array([1]) }];
    await expect(service.stream({ ...legal, effort: 'high' }, vi.fn(), new AbortController().signal))
      .resolves.toMatchObject({ answerText: 'ok' });
  });

  it('offers each effective Ark Seed model behavior once and preserves other models’ distinct levels', async () => {
    const row = {
      modalities: { input_modalities: ['text'], output_modalities: ['text'] },
      features: { thinking: { type: 'enabled' } },
      effort: { supported_levels: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'], default_level: 'max' },
    };
    const ids = ['doubao-seed-2-1-pro-260628', 'doubao-other'];
    const { service } = fixture('doubao', async () =>
      Response.json({ data: ids.map((id) => ({ ...row, id })) }),
    );
    const catalog = await service.models();
    expect(catalog.find((m) => m.id === ids[0])?.reasoningEfforts).toEqual([
      'none', 'low', 'medium', 'high',
    ]);
    expect(catalog.find((m) => m.id === ids[1])?.reasoningEfforts).toEqual(row.effort.supported_levels);
    expect(catalog.find((m) => m.id === ids[0])?.defaultReasoningEffort).toBeUndefined();
    expect(catalog.find((m) => m.id === ids[1])?.defaultReasoningEffort).toBe('max');
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
      expect(JSON.parse(String(init?.body))).toMatchObject({
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
  it('validates profile proposals and never treats interrupted streams as complete', async () => {
    const input = {
      ...request('sample'),
      profile: { name: '', background: '', jobDescription: '' },
    };
    const text = JSON.stringify({ answer: '已整理', changes: { name: '示例' }, skillScope: null });
    const http = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ data: [deepModel] }))
      .mockResolvedValueOnce(sse([chunk({ content: text }, 'stop')]))
      .mockResolvedValueOnce(sse([chunk({ content: 'partial' })]));
    const { service } = fixture('deepseek', http);
    const events: ChatEvent[] = [];
    const result = await service.stream(input, (e) => events.push(e), new AbortController().signal);
    expect(result).toMatchObject({ answerText: '已整理', profileChanges: { name: '示例' } });
    expect(
      events
        .filter((e) => e.type === 'delta')
        .map((e) => e.text)
        .join(''),
    ).toBe('已整理');
    await expect(
      service.stream(request('sample'), vi.fn(), new AbortController().signal),
    ).rejects.toThrow('未完整');
  });
  it('uses Claude native catalog pagination, effort, cumulative usage and text deltas', async () => {
    const http = vi.fn<typeof fetch>(async (url, init) => {
      const target = new URL(String(url));
      const headers = new Headers(init?.headers);
      expect(target.origin).toBe('https://api.anthropic.com');
      expect(headers.get('authorization')).toBe('Bearer synthetic-api-key');
      expect(headers.get('anthropic-version')).toBe('2026-10-21');
      expect(headers.get('anthropic-workspace-id')).toBe('wrkspc_example');
      if (target.pathname.endsWith('/models')) {
        if (target.searchParams.has('after_id'))
          return Response.json({ data: [{ id: 'future-text-model', display_name: 'New text model' }], has_more: false });
        return Response.json({
          has_more: true,
          last_id: 'claude-a',
          data: [
            {
              id: 'claude-a',
              capabilities: {
                image_input: { supported: true },
                effort: { high: { supported: true } },
                thinking: { types: { adaptive: { supported: true } } },
              },
            },
          ],
        });
      }
      expect(target.pathname).toBe('/v1/messages');
      const body = JSON.parse(String(init?.body));
      for (const removed of ['temperature', 'top_p', 'top_k'])
        expect(body).not.toHaveProperty(removed);
      expect(body).toMatchObject({
        thinking: { type: 'adaptive' },
        output_config: { effort: 'high' },
      });
      return sse([
        {
          type: 'message_start',
          message: { id: 'msg-1', usage: { input_tokens: 3, cache_read_input_tokens: 2 } },
        },
        { type: 'content_block_delta', delta: { type: 'text_delta', text: 'ok' } },
        { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { input_tokens: 3, cache_creation_input_tokens: 1, output_tokens: 2 } },
        { type: 'message_stop' },
      ]);
    });
    const { service } = fixture('anthropic', http, { ...credential, workspace: 'wrkspc_example' });
    const result = await service.stream(
      { ...request('claude-a'), effort: 'high' },
      vi.fn(),
      new AbortController().signal,
    );
    expect(result).toMatchObject({
      answerText: 'ok',
      usage: { inputTokens: 6, outputTokens: 2, totalTokens: 8 },
      provider: { dataRecipient: 'Anthropic' },
    });
    expect(await service.models()).toMatchObject([
      { id: 'claude-a' }, { id: 'future-text-model', label: 'New text model', reasoningEfforts: [] },
    ]);
    expect(http).toHaveBeenCalledTimes(3);
  });
  it.each([
    { type: 'thinking', thinking: '', signature: '' },
    { type: 'redacted_thinking', data: 'opaque-fixture' },
  ])('shows Claude $type activity as soon as the block starts, without exposing its contents', async block => {
    const http = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ data: [{ id: 'claude-a' }], has_more: false }))
      .mockResolvedValueOnce(sse([
        { type: 'message_start', message: { id: 'msg_thinking' } },
        { type: 'content_block_start', index: 0, content_block: block },
        ...(block.type === 'thinking' ? [{
          type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'opaque-fixture' },
        }] : []),
        { type: 'content_block_stop', index: 0 },
        { type: 'ping' },
        { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } },
        { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'answer' } },
        { type: 'content_block_stop', index: 1 },
        { type: 'message_delta', delta: { stop_reason: 'end_turn' } },
        { type: 'message_stop' },
      ]));
    const events: ChatEvent[] = [];
    const { service } = fixture('anthropic', http);
    const result = await service.stream(request('claude-a'), event => events.push(event), new AbortController().signal);
    const phases = events.flatMap(event => event.type === 'activity' && event.activity.kind === 'status' &&
      event.activity.status === 'in_progress' ? [event.activity.phase] : []);
    expect(phases).toEqual(['waiting', 'thinking', 'writing']);
    expect(result.answerText).toBe('answer');
    expect(JSON.stringify(events)).not.toContain('opaque-fixture');
  });
  it('distinguishes a terminal Claude refusal from a stream missing its stop reason and keeps reported usage', async () => {
    const start = { type: 'message_start', message: { id: 'msg_test', usage: { input_tokens: 4 } } };
    const partial = { type: 'content_block_delta', delta: { type: 'text_delta', text: 'partial' } };
    const end = { type: 'message_stop' };
    const http = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ data: [{ id: 'claude-a' }], has_more: false }))
      .mockResolvedValueOnce(sse([start, partial, {
        type: 'message_delta', delta: { stop_reason: 'refusal' }, usage: { output_tokens: 2 },
      }, end]))
      .mockResolvedValueOnce(sse([start, partial, end]));
    const { service, usage } = fixture('anthropic', http);
    const stream = () => service.stream(request('claude-a'), vi.fn(), new AbortController().signal);
    await expect(stream()).rejects.toMatchObject({ detail: { code: 'content_filter' } });
    expect(usage.add).toHaveBeenCalledWith(expect.stringMatching(/^anthropic:/), 'msg_test', {
      inputTokens: 4, outputTokens: 2, totalTokens: 6,
    });
    await expect(stream()).rejects.toThrow('未完整');
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
  it('recognizes GLM sensitive as a completed provider refusal', async () => {
    const http = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ data: [{ id: 'glm-5.2' }] }))
      .mockResolvedValueOnce(sse([chunk({}, 'sensitive')]));
    const { service } = fixture('glm', http);
    await expect(service.stream(request('glm-5.2'), vi.fn(), new AbortController().signal))
      .rejects.toMatchObject({ detail: { code: 'content_filter' } });
  });
  it('uses the Kimi model catalog capability flags and keeps unknown thinking protocols on automatic', async () => {
    const { service } = fixture('kimi', async (url, init) => {
      expect(String(url)).toBe('https://api.moonshot.cn/v1/models');
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer ' + credential.key);
      return Response.json({ data: [
        { id: 'kimi-k3.1-pro', supports_image_in: false, supports_reasoning: false },
        { id: 'kimi-new-chat', supports_image_in: true, supports_reasoning: true },
        { id: 'kimi-k3.1-pro-highspeed', supports_image_in: true, supports_reasoning: true },
      ] });
    });
    const catalog = await service.models();
    expect(catalog).toMatchObject([{ imageInput: false }, { imageInput: true }, { imageInput: true }]);
    expect(catalog.map(m => m.reasoningEfforts)).toEqual([undefined, undefined, ['low', 'high', 'max']]);
  });
  it('replays Kimi K3 public turns and preserves historical images without fabricating private reasoning', async () => {
    const http = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ data: [{ id: 'kimi-k3' }] }))
      .mockImplementationOnce(async (_, init) => {
        const body = JSON.parse(String(init?.body));
        expect(body.messages.map((m: { role: string }) => m.role)).toEqual(['system', 'user']);
        const parts = body.messages[1].content;
        expect(parts).toContainEqual({
          type: 'image_url',
          image_url: { url: 'data:image/png;base64,AQ==' },
        });
        expect(parts.at(-1)).toEqual({ type: 'text', text: '现在的问题' });
        expect(JSON.stringify(parts)).toContain('historicalRole');
        expect(JSON.stringify(body)).not.toContain('reasoning_content');
        return sse([chunk({ content: 'ok' }, 'stop')]);
      });
    const { service } = fixture('kimi', http);
    const input = request('kimi-k3');
    input.turns = [
      {
        role: 'user',
        content: '先前的问题',
        files: [{ name: 'image.png', bytes: new Uint8Array([1]) }],
      },
      { role: 'assistant', content: '先前的回答' },
      { role: 'user', content: '现在的问题' },
    ];
    await expect(
      service.stream(input, vi.fn(), new AbortController().signal),
    ).resolves.toMatchObject({ answerText: 'ok' });
  });
  it('follows native Gemini page tokens and sends the selected ID with Google’s compatibility credentials', async () => {
    const http = vi.fn<typeof fetch>(async (url, init) => {
      const target = new URL(String(url));
      if (target.pathname === '/v1beta/models') {
        expect(target.origin).toBe('https://generativelanguage.googleapis.com');
        expect(target.searchParams.get('pageSize')).toBe('100');
        const headers = new Headers(init?.headers);
        expect(headers.get('x-goog-api-key')).toBe(credential.key);
        expect(headers.has('authorization')).toBe(false);
        if (!target.searchParams.has('pageToken'))
          return Response.json({ models: [{ name: 'models/embedding-1', supportedGenerationMethods: ['embedContent'] }], nextPageToken: '+next/=' });
        expect(target.searchParams.get('pageToken')).toBe('+next/=');
        return Response.json({
          models: [
            {
              name: 'models/gemini-2.5-pro',
              thinking: true,
              supportedGenerationMethods: ['generateContent'],
            },
          ],
        });
      }
      expect(target.href).toBe(
        'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
      );
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer synthetic-api-key');
      expect(new Headers(init?.headers).has('x-goog-api-key')).toBe(false);
      expect(JSON.parse(String(init?.body))).toMatchObject({
        model: 'gemini-2.5-pro', reasoning_effort: 'low', stream: true, stream_options: { include_usage: true },
      });
      return sse([chunk({ content: 'ok' }, 'stop')]);
    });
    const { service } = fixture('gemini', http);
    expect((await service.models()).map((m) => m.id)).toEqual(['gemini-2.5-pro']);
    expect(
      (
        await service.stream(
          { ...request('gemini-2.5-pro'), effort: 'low' },
          vi.fn(),
          new AbortController().signal,
        )
      ).answerText,
    ).toBe('ok');
  });
  it('recognizes a rejected Google key during both discovery and generation and rechecks the catalog', async () => {
    const invalidKey = () => Response.json({ error: { status: 'INVALID_ARGUMENT', message: 'private', details: [
      { '@type': 'type.googleapis.com/google.rpc.ErrorInfo', domain: 'googleapis.com', reason: 'API_KEY_INVALID' },
    ] } }, { status: 400 });
    const catalog = () => Response.json({ models: [{ name: 'models/gemini-2.5-pro', supportedGenerationMethods: ['generateContent'] }] });
    const http = vi.fn<typeof fetch>().mockResolvedValueOnce(invalidKey()).mockResolvedValueOnce(catalog())
      .mockResolvedValueOnce(invalidKey()).mockResolvedValueOnce(catalog());
    const { service } = fixture('gemini', http);
    const detail = { status: 400, code: 'API_KEY_INVALID', message: 'Gemini API 密钥无效，请在 Google AI Studio 检查或更换密钥。' };
    await expect(service.models()).rejects.toMatchObject({ detail });
    await expect(service.stream(request('gemini-2.5-pro'), vi.fn(), new AbortController().signal)).rejects.toMatchObject({ detail });
    await expect(service.models()).resolves.toMatchObject([{ id: 'gemini-2.5-pro' }]);
    expect(http.mock.calls.map(([url]) => new URL(String(url)).pathname)).toEqual([
      '/v1beta/models', '/v1beta/models', '/v1beta/openai/chat/completions', '/v1beta/models',
    ]);
  });
  it('discovers Gemma and new Google text models without offering specialist endpoints or guessing image support', async () => {
    const row = (id: string) => ({ name: 'models/' + id, supportedGenerationMethods: ['generateContent'] });
    const http = vi.fn<typeof fetch>(async (url, init) => {
      if (new URL(String(url)).pathname === '/v1beta/models') return Response.json({ models: [
        row('gemma-4-26b-a4b-it'), row('future-dialog'),
        { ...row('gemini-new-image-understanding'), inputModalities: ['TEXT', 'IMAGE'], outputModalities: ['TEXT'] },
        { ...row('future-image-output'), outputModalities: ['IMAGE'] },
        { ...row('future-audio-input'), inputModalities: ['AUDIO'] },
        { ...row('alias-to-live'), baseModelId: 'gemini-3.8-live' },
        { ...row('unknown-embedder'), supportedGenerationMethods: ['embedContent'] },
        ...['lyria-3.5', 'gemini-nano-banana-2.1', 'gemini-2.5-flash-image', 'gemini-omni-1.2-flash',
          'gemini-3.8-flash-tts', 'gemini-3.5-transcribe', 'gemini-2.5-flash-native-audio-preview', 'gemini-decision-1'].map(row),
      ] });
      expect(String(url)).toBe('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions');
      const body = JSON.parse(String(init?.body));
      expect(body.model).toBe('future-dialog');
      expect(body).not.toHaveProperty('reasoning_effort');
      return sse([chunk({ content: 'ok' }, 'stop')]);
    });
    const { service } = fixture('gemini', http);
    expect(await service.models()).toMatchObject([
      { id: 'gemma-4-26b-a4b-it', imageInput: true },
      { id: 'future-dialog', imageInput: false, reasoningEfforts: [] },
      { id: 'gemini-new-image-understanding', imageInput: true },
    ]);
    await expect(service.stream(request('future-dialog'), vi.fn(), new AbortController().signal))
      .resolves.toMatchObject({ answerText: 'ok' });
    const withImage = request('future-dialog');
    withImage.turns[0].files = [{ name: 'image.png', bytes: new Uint8Array([1]) }];
    await expect(service.stream(withImage, vi.fn(), new AbortController().signal)).rejects.toThrow('未确认支持图片');
    expect(http).toHaveBeenCalledTimes(2);
  });
  it('uses a Gemini alias’s reported family, respects explicit thinking overrides and reports filtered streams', async () => {
    const model = { name: 'models/gemini-flash-latest', baseModelId: 'gemini-4-hydrogen', supportedGenerationMethods: ['generateContent'] };
    const http = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ models: [model, { ...model, name: 'models/gemini-3.8-flash', thinking: false }] }))
      .mockResolvedValueOnce(sse([chunk({}, 'content_filter')]));
    const { service } = fixture('gemini', http);
    const [alias, disabled] = await service.models();
    expect(alias.reasoningEfforts).toEqual(['low', 'medium', 'high', 'xhigh']);
    expect(disabled.reasoningEfforts ?? []).toHaveLength(0);
    await expect(service.stream({ ...request('gemini-flash-latest'), effort: 'xhigh' }, vi.fn(), new AbortController().signal))
      .rejects.toMatchObject({ detail: { code: 'content_filter' } });
  });
  it('routes Qwen to its selected region and distinguishes switch-only from effort models', async () => {
    const http = vi.fn<typeof fetch>(async (url, init) => {
      const target = new URL(String(url));
      expect(target.host).toBe('dashscope-intl.aliyuncs.com');
      if (target.pathname === '/api/v1/models') {
        expect(target.searchParams.get('providers')).toBe('qwen');
        const ids = ['qwen-plus', 'qwen3.8-max', 'qwen3.6-35b-a3b', 'qwen3.8-omni-flash-realtime', 'qwen-mt-flash'];
        return Response.json({
          output: {
            total: ids.length,
            models: ids.map((model) => ({
              model,
              provider: 'qwen',
              capabilities: ['TG', 'Reasoning'],
            })),
          },
        });
      }
      const params = JSON.parse(String(init?.body));
      expect(params.enable_thinking).toBe(true);
      expect(params.reasoning_effort).toBeUndefined();
      return sse([chunk({ content: 'ok' }, 'stop')]);
    });
    const { service } = fixture('qwen', http, { ...credential, region: 'singapore' });
    expect((await service.models()).map((m) => m.reasoningEfforts)).toEqual([
      ['none', 'on'],
      ['none', 'low', 'medium', 'xhigh'],
      ['none', 'on'],
    ]);
    await service.stream(
      { ...request('qwen-plus'), effort: 'on' },
      vi.fn(),
      new AbortController().signal,
    );
  });
  it('accepts sparse rows from the filtered Qwen catalog and leaves new models on automatic', async () => {
    const models = [
      { model: 'qwen3.8-max', name: 'Qwen3.8-Max', features: ['function-calling'],
        inference_metadata: { request_modality: ['Text'], response_modality: ['Text'] } },
      { model: 'new-text-id', inference_metadata: { request_modality: ['Text', 'Image'] } },
      { model: 'qwen-plus', capabilities: ['TG'] },
      { model: 'qwen-plus-character' },
      { model: 'qwen-plus-2025-01-25' },
      { model: 'qwen-plus-2025-04-28' },
      { model: 'qwen4-max-preview' },
      { model: 'qwen3.5-ocr' },
      { model: 'qwen-vl-ocr-2025-11-20' },
      { model: 'qwen3-omni-30b-a3b-captioner' },
      { model: 'other-brand', provider: 'deepseek' },
      { model: 'embedding', capabilities: ['TR'] },
      { model: 'image-generator', inference_metadata: { response_modality: ['Image'] } },
      { model: 'speech-to-text', inference_metadata: { request_modality: ['Audio'] } },
    ];
    const http = vi.fn<typeof fetch>(async (url, init) => {
      const target = new URL(String(url));
      if (target.pathname === '/api/v1/models') {
        expect(target.searchParams.get('providers')).toBe('qwen');
        expect(target.searchParams.getAll('capabilities')).toEqual(['TG']);
        return Response.json({ output: { total: models.length, models } });
      }
      const body = JSON.parse(String(init?.body));
      expect(body.model).toBe('new-text-id');
      expect(body).not.toHaveProperty('enable_thinking');
      expect(body).not.toHaveProperty('reasoning_effort');
      return sse([chunk({ content: 'ok' }, 'stop')]);
    });
    const { service } = fixture('qwen', http);
    expect((await service.models()).map((m) => [m.id, m.imageInput, m.reasoningEfforts])).toEqual([
      ['qwen3.8-max', false, ['none', 'low', 'medium', 'xhigh']],
      ['new-text-id', true, []],
      ['qwen-plus', false, []],
      ['qwen-plus-character', false, []],
      ['qwen-plus-2025-01-25', false, []],
      ['qwen-plus-2025-04-28', false, ['none', 'on']],
    ]);
    await expect(service.stream(request('new-text-id'), vi.fn(), new AbortController().signal))
      .resolves.toMatchObject({ answerText: 'ok' });
  });
  it('refreshes every Qwen catalog page and refuses a partial catalog before sending', async () => {
    const page = (page_no: number, ids: string[]) => Response.json({
      success: true, output: { total: 2, page_no, models: ids.map(model => ({ model })) },
    });
    const http = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(page(1, ['old']))
      .mockResolvedValueOnce(page(2, ['second']))
      .mockResolvedValueOnce(page(1, ['candidate']))
      .mockResolvedValueOnce(page(2, []))
      .mockResolvedValueOnce(page(1, ['current']))
      .mockResolvedValueOnce(page(2, ['second']))
      .mockResolvedValueOnce(sse([chunk({ content: 'ok' }, 'stop')]));
    const { service } = fixture('qwen', http);
    expect((await service.models()).map(m => m.id)).toEqual(['old', 'second']);
    await expect(service.models(true)).rejects.toThrow('模型列表');
    const stream = (id: string) => service.stream(request(id), vi.fn(), new AbortController().signal);
    await expect(stream('candidate')).rejects.toThrow('当前不可用');
    await expect(stream('current')).resolves.toMatchObject({ answerText: 'ok' });
    expect(http.mock.calls.slice(0, 6).map(([url]) => new URL(String(url)).searchParams.get('page_no')))
      .toEqual(['1', '2', '1', '2', '1', '2']);
    expect(http.mock.calls).toHaveLength(7);
  });
  it('replays public Qwen chat history with the documented per-model thinking settings', async () => {
    const ids = ['qwen4-max', 'qwen3.8-omni-flash', 'future-text'];
    const turns: ChatRequest['turns'] = [
      { role: 'user', content: '上一个问题' }, { role: 'assistant', content: '公开回复' },
      { role: 'user', content: '继续' },
    ];
    const http = vi.fn<typeof fetch>(async (url, init) => {
      if (new URL(String(url)).pathname === '/api/v1/models') {
        return Response.json({ output: { total: ids.length, models: ids.map(model => ({ model })) } });
      }
      const body = JSON.parse(String(init?.body));
      expect(body.messages.slice(1)).toEqual(turns);
      if (body.model === 'future-text') expect(body).not.toHaveProperty('preserve_thinking');
      else expect(body.preserve_thinking).toBe(false);
      return sse([chunk({ content: 'ok' }, 'stop')]);
    });
    const { service } = fixture('qwen', http);
    for (const id of ids)
      await service.stream({ ...request(id), turns }, vi.fn(), new AbortController().signal);
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
  it.each([
    ['beijing', undefined, 'dashscope.aliyuncs.com', 'dashscope.aliyuncs.com'],
    ['singapore', undefined, 'dashscope-intl.aliyuncs.com', 'dashscope-intl.aliyuncs.com'],
    ['virginia', undefined, 'dashscope-us.aliyuncs.com', 'dashscope-us.aliyuncs.com'],
    ['hongkong', undefined, 'cn-hongkong.dashscope.aliyuncs.com', 'cn-hongkong.dashscope.aliyuncs.com'],
    ['beijing', 'example', 'example.cn-beijing.maas.aliyuncs.com', 'example.cn-beijing.maas.aliyuncs.com'],
    ['singapore', 'example', 'example.ap-southeast-1.maas.aliyuncs.com', 'example.ap-southeast-1.maas.aliyuncs.com'],
    ['tokyo', 'example', 'example.ap-northeast-1.maas.aliyuncs.com', 'example.ap-northeast-1.maas.aliyuncs.com'],
    ['hongkong', 'example', 'example.cn-hongkong.maas.aliyuncs.com', 'example.cn-hongkong.maas.aliyuncs.com'],
    ['frankfurt', 'example', 'example.eu-central-1.maas.aliyuncs.com', 'example.eu-central-1.maas.aliyuncs.com'],
    ['virginia', 'example', 'dashscope-us.aliyuncs.com', 'example.us-east-1.maas.aliyuncs.com'],
  ] as const)(
    'uses official %s catalog and chat endpoints with workspace %s',
    async (region, workspace, catalogHost, chatHost) => {
      const http = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          Response.json({
            output: {
              total: 1,
              models: [{ model: 'qwen-plus', provider: 'qwen', capabilities: ['TG'] }],
            },
          }),
        )
        .mockResolvedValueOnce(sse([chunk({ content: 'ok' }, 'stop')]));
      const { service } = fixture('qwen', http, { ...credential, region, workspace });
      await service.stream(request('qwen-plus'), vi.fn(), new AbortController().signal);
      expect(String(http.mock.calls[0][0]).split('?')[0]).toBe(
        'https://' + catalogHost + '/api/v1/models',
      );
      expect(String(http.mock.calls[1][0])).toBe(
        'https://' + chatHost + '/compatible-mode/v1/chat/completions',
      );
      expect(http.mock.calls.map(([, init]) => new Headers(init?.headers).get('authorization')))
        .toEqual(['Bearer synthetic-api-key', 'Bearer synthetic-api-key']);
    },
  );
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
      )
      .mockResolvedValueOnce(
        Response.json({ code: 0, data: { available_balance: 4.25, voucher_balance: 4.25, cash_balance: -1 } }),
      );
    const signal = new AbortController().signal;
    await expect(readApiBalance('deepseek', credential, signal, http)).resolves.toEqual([
      { currency: 'CNY', total: '1.00', granted: '1.00', toppedUp: '0.00' },
    ]);
    await expect(readApiBalance('deepseek', credential, signal, http)).rejects.toThrow('余额');
    await expect(readApiBalance('kimi', credential, signal, http)).resolves.toEqual([
      { currency: 'CNY', total: '4.25', granted: '4.25', toppedUp: '-1' },
    ]);
    expect(http.mock.calls.map(call => String(call[0]))).toEqual([
      'https://api.deepseek.com/user/balance', 'https://api.deepseek.com/user/balance',
      'https://api.moonshot.cn/v1/users/me/balance',
    ]);
    await expect(readApiBalance('qwen', credential, signal, http)).resolves.toEqual([]);
    expect(http).toHaveBeenCalledTimes(3);
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
