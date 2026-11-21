import { codexAccess } from '../fixtures/codex-access';
import { afterEach, expect, it, vi } from 'vitest';
import { codexRuntimeVersion } from '../../electron/backend/chat/codexUsage';
import { ChatGPTService } from '../../electron/backend/chat/service';
import { CopilotChatService } from '../../electron/backend/copilot/service';
import type { OpenAIAccess } from '../../electron/backend/chat/models';
import type { UsageLedger } from '../../electron/backend/chat/usage';
import type { ChatRequest } from '../../electron/contracts/chat';

const ledger = {} as UsageLedger;
const listed = (slug: string, display_name = slug) => ({ slug, display_name, visibility: 'list' });
const request = (modelId: string): ChatRequest => ({
  id: 'synthetic',
  modelId,
  webSearch: false,
  instructions: '',
  turns: [{ role: 'user', content: 'Synthetic prompt' }],
});
const completed = () =>
  new Response(
    'data: {"type":"response.output_text.delta","delta":"Hello"}\n\n' +
      'data: {"type":"response.completed","response":{"status":"completed","output":[]}}\n\n',
    { headers: { 'content-type': 'text/event-stream' } },
  );
const signal = () => new AbortController().signal;

afterEach(() => vi.restoreAllMocks());

it('discovers arbitrary Codex model slugs and sends only advertised effort values', async () => {
  const entries = [
    { ...listed('gpt-6.2-sol', 'Synthetic Sol'), supported_reasoning_levels: ['high', 'ultra'] },
    {
      ...listed('gpt-6.2-astra', 'Synthetic Astra'),
      supported_reasoning_levels: [{ effort: 'max' }],
    },
    listed('gpt-7-test', 'Seventh'),
    { ...listed('gpt-8-test', 'Eighth'), supported_reasoning_levels: ['none', 'low', 'low'] },
    listed('future-model-unknown', '未来模型'),
  ];
  const responses: any[] = [];
  const fetch = vi.fn(async (url: string, init: RequestInit) => {
    expect(init.headers).toEqual(
      expect.objectContaining({ authorization: 'Bearer synthetic-client:subject' }),
    );
    expect(init.headers).toMatchObject({ 'ChatGPT-Account-Id': 'subject', originator: 'voxcue' });
    if (url === 'https://chatgpt.com/backend-api/codex/models?client_version=1.2.3') {
      expect(init.cache).toBe('no-store');
      return Response.json({
        models: [
          ...entries,
          listed('gpt-7-test', 'Duplicate'),
          { ...listed('hidden'), visibility: 'hide' },
          { ...listed('unavailable'), available: false },
          listed('long', 'x'.repeat(121)),
          listed('x'.repeat(161)),
          { slug: 'no-name', visibility: 'list' },
          null,
        ],
      });
    }
    expect(url).toBe('https://chatgpt.com/backend-api/codex/responses');
    responses.push(JSON.parse(String(init.body)));
    return completed();
  }) as unknown as typeof globalThis.fetch;
  const service = new ChatGPTService({ access: async () => codexAccess(), ledger, fetch });
  expect(
    (await service.models()).map(({ id, label, reasoningEfforts }) => [
      id,
      label,
      reasoningEfforts,
    ]),
  ).toEqual(
    entries.map(({ slug, display_name }, index) => [
      slug,
      display_name,
      [['high'], ['max'], [], ['none', 'low'], []][index],
    ]),
  );
  await expect(
    service.stream({ ...request('future-model-unknown'), webSearch: true }, vi.fn(), signal()),
  ).resolves.toMatchObject({
    answerText: 'Hello',
    warning: undefined,
  });
  expect(responses[0]).toMatchObject({ model: 'future-model-unknown', store: false, stream: true });
  expect(responses[0]).not.toHaveProperty('reasoning');
  expect(responses[0]).not.toHaveProperty('tools');
  expect(responses[0].instructions).toContain('本次请求未提供联网检索工具');
  await service.stream({ ...request('gpt-6.2-astra'), effort: 'max' }, vi.fn(), signal());
  expect(responses[1]).toMatchObject({ model: 'gpt-6.2-astra', reasoning: { effort: 'max' } });
  await expect(
    service.stream({ ...request('gpt-6.2-astra'), effort: 'high' }, vi.fn(), signal()),
  ).rejects.toThrow('不支持该思考强度');
  await expect(service.stream(request('not-listed'), vi.fn(), signal())).rejects.toThrow(
    '模型当前不可用',
  );
  expect(responses).toHaveLength(2);
});

it('honors the advertised minimum on a Codex refresh even if the server returns the entry', async () => {
  const access = codexAccess();
  const fetch = vi.fn(async () => Response.json({
    models: [
      { ...listed('at-minimum'), minimal_client_version: '1.2.3' },
      { ...listed('older'), minimal_client_version: [1, 1, 10] },
      { ...listed('newer'), minimal_client_version: '1.10.0' },
      { ...listed('invalid'), minimal_client_version: 'invalid' },
      listed('no-minimum'),
    ],
  }));
  const service = new ChatGPTService({ access: async () => access, fetch, ledger });
  expect((await service.models(true)).map(({ id }) => id)).toEqual(['at-minimum', 'older', 'no-minimum']);
  await expect(service.stream(request('newer'), vi.fn(), signal())).rejects.toThrow('模型当前不可用');
  expect(fetch).toHaveBeenCalledOnce();
});

it('discovers both GPT-6.2 models after updating the Codex runtime and refreshing', async () => {
  const modelIds = ['gpt-6.2-sol', 'gpt-6.2-astra'];
  const access = { ...codexAccess(), runtimeVersion: '0.164.0' };
  const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({
    models: modelIds.map((id) => ({ ...listed(id), minimal_client_version: '0.166.0' })),
  }));
  const service = new ChatGPTService({ access: async () => access, ledger, fetch });

  expect(await service.models()).toEqual([]);
  access.runtimeVersion = codexRuntimeVersion;
  expect((await service.models(true)).map(({ id }) => id)).toEqual(modelIds);
  expect(fetch.mock.calls.map(([url]) => String(url))).toEqual(
    ['0.164.0', codexRuntimeVersion].map((version) =>
      `https://chatgpt.com/backend-api/codex/models?client_version=${version}`,
    ),
  );
});

it('keeps API-key and Codex catalog formats, accounts and auth routes distinct', async () => {
  let access: OpenAIAccess = codexAccess();
  const fetch = vi.fn(async (_url: string, init: RequestInit) => {
    if (new Headers(init.headers).get('authorization') === 'Bearer synthetic-api-key')
      return Response.json({
        data: [{ id: 'org/future' }, { id: 'org/future' }, { slug: 'invalid' }],
      });
    return Response.json({ models: [listed('personal-codex')] });
  });
  const service = new ChatGPTService({ access: async () => access, ledger, fetch: fetch as any });
  expect(await service.models()).toMatchObject([{ id: 'personal-codex' }]);
  access = { kind: 'api-key', account: access.account, token: 'synthetic-api-key' };
  expect(await service.models()).toMatchObject([
    { id: 'org/future', label: 'org/future', reasoningEfforts: [] },
  ]);
  expect(fetch).toHaveBeenCalledTimes(2);
  access = codexAccess();
  fetch.mockImplementationOnce(async () => Response.json({ data: [{ id: 'api-only' }] }));
  await expect(service.models(true)).rejects.toMatchObject({
    detail: { code: 'invalid_model_catalog' },
  });
});

it('coalesces fresh reads, honors force and expires the five-minute cache', async () => {
  const now = vi.spyOn(Date, 'now');
  now.mockReturnValue(0);
  let version = 1;
  const fetch = vi.fn(async () => Response.json({ models: [listed('model-' + version)] }));
  const service = new ChatGPTService({ access: async () => codexAccess(), ledger, fetch });
  await Promise.all([service.models(), service.models(), service.models(true)]);
  expect(fetch).toHaveBeenCalledTimes(1);
  version++;
  expect(await service.models()).toMatchObject([{ id: 'model-1' }]);
  expect(await service.models(true)).toMatchObject([{ id: 'model-2' }]);
  version++;
  now.mockReturnValue(300000);
  expect(await service.models()).toMatchObject([{ id: 'model-3' }]);
  expect(fetch).toHaveBeenCalledTimes(3);
});

it.each([401, 403, 429, 503])(
  'HTTP %s invalidates the failed refresh and never serves a stale list',
  async (status) => {
    const fetch = vi.fn(async () => Response.json({ models: [listed('initial')] }));
    const service = new ChatGPTService({ access: async () => codexAccess(), ledger, fetch });
    await service.models();
    fetch.mockImplementationOnce(async () =>
      Response.json({ error: { message: 'private' } }, { status }),
    );
    await expect(service.models(true)).rejects.toMatchObject({ detail: { status } });
    fetch.mockImplementationOnce(async () => Response.json({ models: [] }));
    expect(await service.models()).toEqual([]);
  },
);

it('rejects broken JSON and a transport timeout without preserving the previous list', async () => {
  const fetch = vi.fn(async () => new Response('{'));
  const service = new ChatGPTService({ access: async () => codexAccess(), ledger, fetch });
  await expect(service.models()).rejects.toMatchObject({
    detail: { code: 'invalid_model_catalog' },
  });
  fetch.mockImplementationOnce(async () => {
    throw new DOMException('timed out', 'TimeoutError');
  });
  await expect(service.models()).rejects.toMatchObject({
    detail: { code: 'response_headers_timeout' },
  });
  fetch.mockImplementationOnce(async () => Response.json({ models: [listed('recovered')] }));
  expect(await service.models()).toMatchObject([{ id: 'recovered' }]);
});

it('ignores late results across a workspace switch and disposes an outstanding read', async () => {
  let access = codexAccess('workspace-a');
  let respond!: (response: Response) => void;
  const fetch = vi
    .fn(async () => Response.json({ models: [listed('workspace-b-model')] }))
    .mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          respond = resolve;
        }),
    );
  const service = new ChatGPTService({ access: async () => access, ledger, fetch });
  const first = expect(service.models()).rejects.toMatchObject({ name: 'AbortError' });
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
  access = codexAccess('workspace-b');
  expect(await service.models()).toMatchObject([{ id: 'workspace-b-model' }]);
  respond(Response.json({ models: [listed('workspace-a-model')] }));
  await first;
  expect(await service.models()).toMatchObject([{ id: 'workspace-b-model' }]);
  fetch.mockImplementationOnce(() => new Promise<Response>(() => {}));
  const cancelled = expect(service.models(true)).rejects.toMatchObject({ name: 'AbortError' });
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
  service.invalidateModels();
  await cancelled;
});

it('keeps an independent catalog consumer alive after one cancels', async () => {
  let respond!: (value: Response) => void;
  const fetch = vi.fn(
    () =>
      new Promise<Response>((resolve) => {
        respond = resolve;
      }),
  );
  const service = new ChatGPTService({ access: async () => codexAccess(), ledger, fetch });
  const controller = new AbortController();
  const cancelled = expect(service.models(false, controller.signal)).rejects.toMatchObject({
    name: 'AbortError',
  });
  const other = service.models();
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
  controller.abort();
  await cancelled;
  respond(Response.json({ models: [listed('future')] }));
  expect(await other).toMatchObject([{ id: 'future' }]);
});

it('cancels a stalled catalog body at the request deadline and permits a later refresh', async () => {
  const deadline = new AbortController();
  const timeout = AbortSignal.timeout;
  vi.spyOn(AbortSignal, 'timeout')
    .mockImplementation((ms) => timeout(ms))
    .mockImplementationOnce((ms) => timeout(ms))
    .mockReturnValueOnce(deadline.signal);
  const cancel = vi.fn();
  const pull = vi.fn();
  const fetch = vi
    .fn(async () => Response.json({ models: [listed('recovered')] }))
    .mockImplementationOnce(async () => new Response(new ReadableStream({ pull, cancel })));
  const service = new ChatGPTService({ access: async () => codexAccess(), ledger, fetch });
  const rejected = expect(service.models()).rejects.toMatchObject({ name: 'TimeoutError' });
  await vi.waitFor(() => expect(pull).toHaveBeenCalled());
  deadline.abort(new DOMException('Synthetic deadline', 'TimeoutError'));
  await rejected;
  await vi.waitFor(() => expect(cancel).toHaveBeenCalledOnce());
  expect(await service.models()).toMatchObject([{ id: 'recovered' }]);
});

it('reports a selected model rejection once and rechecks the catalog before another send', async () => {
  const fetch = vi.fn(async (url: string) =>
    new URL(url).pathname.endsWith('/models')
      ? Response.json({ models: [listed('removed')] })
      : Response.json({ error: { code: 'model_not_found' } }, { status: 404 }),
  );
  const service = new ChatGPTService({ access: async () => codexAccess(), ledger, fetch: fetch as any });
  await expect(service.stream(request('removed'), vi.fn(), signal())).rejects.toMatchObject({
    detail: { status: 404, code: 'model_not_found' },
  });
  expect(fetch).toHaveBeenCalledTimes(2);
  fetch.mockImplementationOnce(async () => Response.json({ models: [listed('replacement')] }));
  await expect(service.stream(request('removed'), vi.fn(), signal())).rejects.toThrow(
    '模型当前不可用',
  );
  expect(fetch).toHaveBeenCalledTimes(3);
});

it('maps future Copilot models, refreshes policy through RPC, and creates sessions using the exact ID', async () => {
  let account = 'github:a';
  let disabled = false;
  const models = vi.fn(async () => ({
    models: [
      {
        id: 'claude-future-test',
        name: 'First',
        vendor: 'Synthetic Vendor',
        capabilities: { supports: { reasoningEffort: true, vision: false } },
        supportedReasoningEfforts: ['max', 'high', 'none', 'unrecognized'],
        policy: { state: disabled ? 'disabled' : 'enabled' },
        metadata: { future: {} },
      },
      {
        id: 'gemini-future-test',
        name: 'Second',
        policy: { state: 'unknown-state' },
        futureField: true,
      },
      {
        id: 'gpt-future-test',
        name: 'Third',
        capabilities: { supports: { reasoningEffort: false } },
        supportedReasoningEfforts: ['max'],
      },
      { id: 'gpt-future-test', name: 'Duplicate' },
      null,
    ],
  }));
  let onEvent: (event: unknown) => void;
  const createSession = vi.fn(async () => ({
    sessionId: 'session',
    on: (handler: typeof onEvent) => {
      onEvent = handler;
      return vi.fn();
    },
    send: async () => {
      onEvent({ type: 'assistant.message', data: { messageId: '1', content: 'Reply' } });
      onEvent({ type: 'session.idle' });
    },
    abort: vi.fn(async () => {}),
  }));
  const deleteSession = vi.fn(async () => {});
  const service = new CopilotChatService({
    client: async () =>
      ({ rpc: { models: { list: models } }, createSession, deleteSession }) as any,
    control: vi.fn(),
    access: async () => ({ account }),
    ledger,
  });
  expect(await service.models()).toMatchObject([
    {
      id: 'claude-future-test',
      label: 'First',
      reasoningEfforts: ['high', 'max'],
      provider: { modelVendor: 'Synthetic Vendor' },
    },
    { id: 'gemini-future-test', label: 'Second', reasoningEfforts: [] },
    { id: 'gpt-future-test', label: 'Third', reasoningEfforts: [] },
  ]);
  await expect(
    service.stream(request('gemini-future-test'), vi.fn(), signal()),
  ).resolves.toMatchObject({ answerText: 'Reply' });
  expect(createSession).toHaveBeenCalledWith(
    expect.objectContaining({
      model: 'gemini-future-test',
      allowedModels: ['gemini-future-test'],
    }),
  );
  expect(createSession.mock.calls[0]?.[0]).not.toHaveProperty('reasoningEffort');
  expect(deleteSession).toHaveBeenCalledWith('session');
  expect(models).toHaveBeenCalledTimes(1);
  disabled = true;
  expect((await service.models(true)).map((model) => model.id)).toEqual([
    'gemini-future-test',
    'gpt-future-test',
  ]);
  await expect(service.stream(request('claude-future-test'), vi.fn(), signal())).rejects.toThrow(
    '模型当前不可用',
  );
  account = 'github:b';
  await service.models();
  expect(models).toHaveBeenCalledTimes(3);
});
