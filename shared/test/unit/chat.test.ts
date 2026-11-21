import { codexAccess } from '../fixtures/codex-access';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  ChatGPTService,
  ChatServiceError,
  publicFailure,
  validSource,
} from '../../../shared/electron/backend/chat/service';
import { UsageLedger } from '../../../shared/electron/backend/chat/usage';

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});
async function ledger() {
  const directory = await mkdtemp(path.join(tmpdir(), 'copilot-chat-test-'));
  directories.push(directory);
  return new UsageLedger(directory);
}
const request = {
  id: 'request-1',
  modelId: 'model-one',
  webSearch: true,
  instructions: '中文回答',
  turns: [{ role: 'user' as const, content: '问题' }],
};
const models = {
  models: [
    { slug: 'model-one', display_name: 'First', visibility: 'list', web_search_tool_type: 'text' },
    { slug: 'hidden', display_name: 'Hidden', visibility: 'hidden' },
    { slug: 'model-two', display_name: 'Second', visibility: 'list' },
  ],
};
function sse(events: unknown[]) {
  const bytes = new TextEncoder().encode(
    events.map((event) => `data: ${JSON.stringify(event)}\r\n\r\n`).join(''),
  );
  // Split UTF-8 characters and CRLF across transport chunks.
  let offset = 0;
  return new Response(
    new ReadableStream({
      pull(controller) {
        if (offset >= bytes.length) controller.close();
        else {
          controller.enqueue(bytes.slice(offset, offset + 7));
          offset += 7;
        }
      },
    }),
    { headers: { 'content-type': 'text/event-stream' } },
  );
}
describe('原生 ChatGPT 请求与用量', () => {
  it('旧账本的长 ID 压缩后仍可去重，与普通 ID 独立，重置后迟到事件不重复计数', async () => {
    const usage = await ledger();
    const tokens = { inputTokens: 1, outputTokens: 1, totalTokens: 2 };
    await usage.add('a', 'short', tokens);
    const directory = directories.at(-1)!;
    const [name] = await readdir(directory);
    const file = path.join(directory, name);
    const old = JSON.parse(await readFile(file, 'utf8'));
    const id = 'r'.repeat(4096);
    old.ids = [id];
    await writeFile(file, JSON.stringify(old));
    await usage.add('a', id, tokens);
    expect(await usage.get('a')).toEqual(old.usage);
    const { ids } = JSON.parse(await readFile(file, 'utf8'));
    expect(ids[0].sha256).toMatch(/^[a-f0-9]{64}$/);
    const reopen = new UsageLedger(directory);
    await reopen.add('a', ids[0].sha256, tokens);
    await reopen.add('a', id, tokens);
    await reopen.add('a', id + 'x', tokens);
    expect(await reopen.get('a')).toMatchObject({ requests: 3, totalTokens: 6 });
    await reopen.reset('a');
    await reopen.add('a', id, tokens);
    expect(await reopen.get('a')).toMatchObject({ requests: 0, totalTokens: 0 });
  });
  it('Responses 大文本附件可取消且保留完整请求字节', async () => {
    const text = '合成文本\n'.repeat(23000);
    const files = Array.from({ length: 3 }, (_, index) => ({
      name: index + '.txt', bytes: Buffer.from(text),
    }));
    const input = { ...request, webSearch: false, turns: [{ role: 'user' as const, content: '资料', files }] };
    const expected = JSON.stringify({
      model: input.modelId, instructions: input.instructions,
      input: [{ role: 'user', content: [{ type: 'input_text', text: '资料' },
        ...files.map(file => ({ type: 'input_text', text: '附件 ' + file.name + '：\n' + text }))] }],
      store: false, stream: true,
    });
    const transport = vi.fn<typeof fetch>(async (url, options) => {
      if (!String(url).endsWith('/responses')) return Response.json(models);
      expect(options?.body instanceof Blob).toBe(true);
      expect(Buffer.from(await (options!.body as Blob).arrayBuffer()).equals(Buffer.from(expected))).toBe(true);
      return sse([{ type: 'response.output_text.delta', delta: 'ok' },
        { type: 'response.completed', response: { id: 'synthetic' } }]);
    });
    const service = new ChatGPTService({ access: async () => codexAccess(), fetch: transport, ledger: await ledger() });
    const cancel = new AbortController();
    await expect(service.stream(input, event => {
      if (event.type === 'provider') setImmediate(() => cancel.abort());
    }, cancel.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(transport).toHaveBeenCalledTimes(1);
    await expect(service.stream(input, vi.fn(), new AbortController().signal)).resolves.toMatchObject({ answerText: 'ok' });
  });
  it('大附件分段后仍是完整 JSON，保持内容转义、多轮顺序、字节偏移和末尾填充', async () => {
    const source = new Uint8Array(4 * 1024 * 1024 + 10);
    for (let i = 0; i < source.length; i++) source[i] = i % 251;
    const bytes = source.subarray(7, -1);
    const marker = '转义 "image_url":0，换行\n和反斜线\\';
    const filename = '测试"一".pdf';
    const transport = vi.fn(async (url: string | URL | Request, options?: RequestInit) => {
      if (String(url).endsWith('/responses')) {
        expect(options?.body).toBeInstanceOf(Blob);
        const wire = new Request(url, options);
        expect(wire.headers.get('content-type')).toBe('application/json');
        const json = await wire.text();
        expect(Buffer.byteLength(json)).toBe((options!.body as Blob).size);
        expect(JSON.parse(json)).toMatchObject({ instructions: marker, input: [
          { role: 'user', content: [
            { type: 'input_text', text: marker },
            { type: 'input_file', filename, file_data: 'data:application/pdf;base64,' + Buffer.from(bytes).toString('base64') },
          ] },
          { role: 'assistant', content: 'ok' },
          { role: 'user', content: [
            { type: 'input_text', text: '附件' },
            { type: 'input_text', text: '附件 注.txt：\n' + marker },
            { type: 'input_image', image_url: 'data:image/png;base64,/wI=' },
          ] },
        ] });
        return sse([{ type: 'response.output_text.delta', delta: 'ok' },
          { type: 'response.completed', response: { id: 'synthetic' } }]);
      }
      return Response.json(models);
    });
    const service = new ChatGPTService({
      access: async () => codexAccess(), fetch: transport, ledger: await ledger(),
    });
    const result = await service.stream({ ...request, instructions: marker, turns: [
      { role: 'user', content: marker, files: [{ name: filename, bytes }] },
      { role: 'assistant', content: 'ok' },
      { role: 'user', content: '附件', files: [
        { name: '注.txt', bytes: new TextEncoder().encode(marker) },
        { name: 'image.png', bytes: new Uint8Array([255, 2]) },
      ] },
    ] }, vi.fn(), new AbortController().signal);
    expect(result.answerText).toBe('ok');
  });
  it('大附件编码期间取消不会发起回答请求', async () => {
    const controller = new AbortController();
    const transport = vi.fn(async () => Response.json(models));
    const service = new ChatGPTService({
      access: async () => codexAccess(), fetch: transport, ledger: await ledger(),
    });
    const stop = Error('synthetic cancellation');
    const pending = service.stream({ ...request, turns: [
      { ...request.turns[0], files: [{ name: 'file.pdf', bytes: new Uint8Array(8 * 1024 * 1024) }] },
    ] }, (event) => {
      if (event.type === 'provider') setImmediate(() => controller.abort(stop));
    }, controller.signal);
    await expect(pending).rejects.toBe(stop);
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it('预先取消的请求不读取身份或启动目录网络请求', async () => {
    const controller = new AbortController();
    controller.abort();
    const access = vi.fn(),
      fetch = vi.fn();
    const service = new ChatGPTService({ access, fetch, ledger: await ledger() });
    await expect(service.stream(request, vi.fn(), controller.signal)).rejects.toBe(
      controller.signal.reason,
    );
    expect(access).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each(['models', 'identity'])(
    '等待 %s 的前置阶段也立即响应取消，不发迟到请求',
    async (stage) => {
      let entered!: () => void, release!: () => void;
      const waiting = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const access = codexAccess('synthetic', 'synthetic');
      let reads = 0;
      const transport = vi.fn(async () => {
        if (stage === 'models')
          return new Promise<Response>((resolve) => {
            release = () => resolve(Response.json(models));
            entered();
          });
        return Response.json(models);
      });
      const service = new ChatGPTService({
        access: async () => {
          if (++reads === 2 && stage === 'identity')
            return new Promise<typeof access>((resolve) => {
              release = () => resolve(access);
              entered();
            });
          return access;
        },
        ledger: await ledger(),
        fetch: transport,
      });
      const controller = new AbortController(),
        emit = vi.fn();
      let settled = false,
        outcome: unknown;
      const pending = service.stream(request, emit, controller.signal).then(
        (value) => {
          settled = true;
          outcome = value;
        },
        (error) => {
          settled = true;
          outcome = error;
        },
      );
      await waiting;
      controller.abort();
      try {
        await vi.waitFor(() => expect(settled).toBe(true), { timeout: 200 });
        expect(outcome).toMatchObject({ name: 'AbortError' });
      } finally {
        release();
        await pending;
      }
      expect(transport).toHaveBeenCalledOnce();
      expect(emit).not.toHaveBeenCalled();
    },
  );
  it('损坏的模型目录不把中文响应或账号片段带进公开错误', async () => {
    const service = new ChatGPTService({
      access: async () => codexAccess('synthetic', 'synthetic'),
      ledger: await ledger(),
      fetch: async () => new Response('{"密钥":"synthetic-secret",invalid}'),
    });
    const failure = await service.models().catch((error) => error);
    expect(publicFailure(failure)).toEqual({
      message: '模型列表响应无效，请重试。',
      code: 'invalid_model_catalog',
    });
    expect(failure.message).not.toMatch(/synthetic|密钥|invalid/);
  });
  it('模型目录按实际流量设上限，拒绝超大响应并允许下次重新获取', async () => {
    const cancel = vi.fn();
    const transport = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          new ReadableStream({
            pull(controller) {
              controller.enqueue(new Uint8Array(1024 * 1024).fill(32));
            },
            cancel,
          }),
          { headers: { 'content-length': '1' } },
        ),
      )
      .mockImplementationOnce(async () => Response.json(models));
    const service = new ChatGPTService({
      access: async () => codexAccess('synthetic', 'synthetic'),
      ledger: await ledger(),
      fetch: transport,
    });
    await expect(service.models()).rejects.toThrow();
    expect(cancel).toHaveBeenCalledOnce();
    expect((await service.models()).map((model) => model.id)).toEqual(['model-one', 'model-two']);
    expect(transport).toHaveBeenCalledTimes(2);
  });
  it.each([
    new TypeError('synthetic connection reset'),
    new DOMException('synthetic deadline', 'TimeoutError'),
  ])('模型目录的受控网络故障也保留分类', async (error) => {
    const service = new ChatGPTService({
      access: async () => codexAccess('synthetic', 'synthetic'),
      ledger: await ledger(),
      fetch: vi.fn().mockRejectedValue(error),
    });
    const failure = await service.models().catch((value) => value);
    expect(failure).toBeInstanceOf(ChatServiceError);
    expect(failure.detail.code).toBe(
      error instanceof TypeError ? 'network_error' : 'response_headers_timeout',
    );
    expect(failure.message).not.toContain('synthetic');
  });
  it('使用账户模型顺序、完整上下文和实际搜索工具，保留来源与服务端用量', async () => {
    const usage = await ledger();
    const transport = vi.fn(async (url: any, options?: RequestInit) => {
      if (new URL(String(url)).pathname.endsWith('/models')) return Response.json(models);
      const body = JSON.parse(options!.body as string);
      expect(body).toMatchObject({
        model: 'model-one',
        store: false,
        stream: true,
        input: request.turns,
        tools: [{ type: 'web_search' }],
        tool_choice: 'auto',
      });
      expect(body).not.toHaveProperty('previous_response_id');
      return sse([
        { type: 'response.output_text.delta', delta: '你好' },
        {
          type: 'response.completed',
          response: {
            id: 'response-1',
            usage: { input_tokens: 12, output_tokens: 3, total_tokens: 15 },
            output: [
              {
                content: [
                  {
                    annotations: [
                      { url: 'https://example.org/source', title: '来源' },
                      { url: 'javascript:alert(1)' },
                    ],
                  },
                ],
              },
            ],
          },
        },
      ]);
    });
    const service = new ChatGPTService({
      access: async () => codexAccess('account', 'secret'),
      ledger: usage,
      fetch: transport,
    });
    expect((await service.models()).map((model) => model.id)).toEqual(['model-one', 'model-two']);
    expect((await service.models())[0].provider).toEqual({
      id: 'chatgpt',
      name: 'ChatGPT',
      dataRecipient: 'OpenAI',
    });
    const events: unknown[] = [];
    const result = await service.stream(
      request,
      (event) => events.push(event),
      new AbortController().signal,
    );
    expect(result.sources).toEqual([{ url: 'https://example.org/source', title: '来源' }]);
    expect(result.provider).toEqual({ id: 'chatgpt', name: 'ChatGPT', dataRecipient: 'OpenAI' });
    expect(events).toContainEqual({ id: request.id, type: 'delta', text: '你好' });
    expect(result.answerText).toBe('你好');
    expect(events).toContainEqual({
      id: request.id,
      type: 'activity',
      activity: { phase: 'writing' },
    });
    expect(await service.usage()).toMatchObject({
      inputTokens: 12,
      outputTokens: 3,
      totalTokens: 15,
      requests: 1,
    });
    expect(JSON.stringify(events)).not.toContain('secret');
    await usage.add('account', 'response-1', result.usage!);
    expect((await usage.get('account')).requests).toBe(1);
    expect((await usage.get('other-account')).totalTokens).toBe(0);
  });
  it('关闭搜索不发送工具；未收到 completed 的断流不视作成功', async () => {
    const service = new ChatGPTService({
      access: async () => codexAccess('account', 'secret'),
      ledger: await ledger(),
      fetch: vi.fn(async (url: any, options?: RequestInit) => {
        if (new URL(String(url)).pathname.endsWith('/models')) return Response.json(models);
        expect(JSON.parse(options!.body as string)).not.toHaveProperty('tools');
        return sse([{ type: 'response.output_text.delta', delta: '部分内容' }]);
      }),
    });
    await expect(
      service.stream({ ...request, webSearch: false }, () => {}, new AbortController().signal),
    ).rejects.toThrow('提前中断');
    expect((await service.usage()).totalTokens).toBe(0);
    await expect(
      service.stream({ ...request, modelId: 'unlisted' }, () => {}, new AbortController().signal),
    ).rejects.toThrow('不可用');
  });
  it('额度失败保留安全诊断信息，不泄露服务端原始错误', async () => {
    const service = new ChatGPTService({
      access: async () => codexAccess('account', 'secret'),
      ledger: await ledger(),
      fetch: async () =>
        Response.json(
          { error: { code: 'rate_limit_exceeded', message: 'secret' } },
          { status: 429, headers: { 'x-request-id': 'req-123' } },
        ),
    });
    try {
      await service.models();
      throw new Error('should fail');
    } catch (error) {
      expect(publicFailure(error)).toMatchObject({
        status: 429,
        requestId: 'req-123',
        code: 'rate_limit_exceeded',
      });
      expect(JSON.stringify(publicFailure(error))).not.toContain('secret');
    }
    expect(validSource({ url: 'file:///C:/private.txt' })).toBeNull();
  });
  it('停止请求和 incomplete 事件不会标记完成；返回的失败用量仍被记账', async () => {
    const usage = await ledger();
    const service = new ChatGPTService({
      access: async () => codexAccess('account', 'secret'),
      ledger: usage,
      fetch: async (url: any) =>
        new URL(String(url)).pathname.endsWith('/models')
          ? Response.json(models)
          : sse([
              {
                type: 'response.incomplete',
                response: {
                  id: 'incomplete-1',
                  usage: { input_tokens: 8, output_tokens: 2, total_tokens: 10 },
                },
              },
            ]),
    });
    const controller = new AbortController();
    controller.abort();
    await expect(service.stream(request, () => {}, controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
    await expect(service.stream(request, () => {}, new AbortController().signal)).rejects.toThrow(
      '未完成',
    );
    expect((await usage.get('account')).totalTokens).toBe(10);
  });
});
describe('本地用量重置', () => {
  it('按账户持久化清零，保留其他账户及旧响应去重信息', async () => {
    const usage = await ledger();
    const tokens = { inputTokens: 8, outputTokens: 2, totalTokens: 10 };
    await usage.add('a', 'old', tokens);
    await usage.add('b', 'other', tokens);
    expect(await usage.reset('a')).toMatchObject({ totalTokens: 0, requests: 0 });
    expect(await usage.get('a')).toMatchObject({
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      requests: 0,
    });
    expect(await usage.get('b')).toMatchObject({ totalTokens: 10, requests: 1 });
    await usage.add('a', 'old', tokens);
    expect((await usage.get('a')).totalTokens).toBe(0);
    await usage.add('a', 'new', tokens);
    expect(await usage.get('a')).toMatchObject({ totalTokens: 10, requests: 1 });
  });
  it('与在先和后续写入串行执行，重置后仅累计新的请求', async () => {
    const usage = await ledger();
    const tokens = { inputTokens: 3, outputTokens: 1, totalTokens: 4 };
    await Promise.all([
      usage.add('a', 'before', tokens),
      usage.reset('a'),
      usage.add('a', 'after', tokens),
    ]);
    expect(await usage.get('a')).toMatchObject({ totalTokens: 4, requests: 1 });
  });
});
