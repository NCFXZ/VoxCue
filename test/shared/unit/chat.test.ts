import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  ChatGPTService,
  publicFailure,
  validSource,
} from '../../../shared/electron/backend/chat/service';
import { UsageLedger } from '../../../shared/electron/backend/chat/usage';
import {
  ChatGPTAuthService,
  type CredentialRecord,
} from '../../../shared/electron/backend/auth/service';

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
    { slug: 'model-one', display_name: 'First', visibility: 'list' },
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
  it('使用账户模型顺序、完整上下文和实际搜索工具，保留来源与服务端用量', async () => {
    const usage = await ledger();
    const transport = vi.fn(async (url: any, options?: RequestInit) => {
      if (String(url).endsWith('/models')) return Response.json(models);
      const body = JSON.parse(options!.body as string);
      expect(body).toMatchObject({
        model: 'model-one',
        store: false,
        stream: true,
        input: request.turns,
        tools: [{ type: 'web_search' }],
        tool_choice: 'required',
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
      access: async () => ({ token: 'secret', account: 'account' }),
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
      access: async () => ({ token: 'secret', account: 'account' }),
      ledger: await ledger(),
      fetch: vi.fn(async (url: any, options?: RequestInit) => {
        if (String(url).endsWith('/models')) return Response.json(models);
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
      access: async () => ({ token: 'secret', account: 'account' }),
      ledger: await ledger(),
      fetch: async () =>
        Response.json(
          { error: { code: 'subscription_sharing_usage_limit_exceeded', message: 'secret' } },
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
        code: 'subscription_sharing_usage_limit_exceeded',
      });
      expect(JSON.stringify(publicFailure(error))).not.toContain('secret');
    }
    expect(validSource({ url: 'file:///C:/private.txt' })).toBeNull();
  });
  it('停止请求和 incomplete 事件不会标记完成；返回的失败用量仍被记账', async () => {
    const usage = await ledger();
    const service = new ChatGPTService({
      access: async () => ({ token: 'secret', account: 'account' }),
      ledger: usage,
      fetch: async (url: any) =>
        String(url).endsWith('/models')
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
describe('原生授权续期', () => {
  function setup(transport: typeof fetch) {
    let record: CredentialRecord = {
      version: 1,
      hostId: 'host',
      clientId: 'issued-client',
      subject: 'user',
      name: 'User',
      email: '',
      expiresAt: 0,
      accessExpiresAt: 1,
      accessToken: 'old-access',
      refreshToken: 'old-refresh',
      idToken: 'identity',
      grantedScopes: ['chatgpt.tokens.use.direct'],
    };
    const auth = new ChatGPTAuthService({
      storage: {
        hostId: async () => 'host',
        read: async () => record,
        write: async (value) => {
          record = value;
        },
      },
      openBrowser: async () => {},
      fetch: transport,
    });
    return { auth, record: () => record };
  }
  it('并发请求只轮换一次，使用已签发 client_id，保存新凭据', async () => {
    const transport = vi.fn(async (_url: any, options?: RequestInit) => {
      const body = options!.body as URLSearchParams;
      expect(body.get('client_id')).toBe('issued-client');
      expect(body.get('resource')).toBe('https://api.openai.com/v1');
      expect(body.has('scope')).toBe(false);
      return Response.json({
        access_token: 'new-access',
        refresh_token: 'new-refresh',
        expires_in: 3600,
      });
    });
    const { auth, record } = setup(transport);
    const values = await Promise.all([auth.access(), auth.access()]);
    expect(transport).toHaveBeenCalledTimes(1);
    expect(values.map((value) => value.token)).toEqual(['new-access', 'new-access']);
    expect(record().refreshToken).toBe('new-refresh');
    expect(JSON.stringify(await auth.session())).not.toContain('new-access');
  });
  it('invalid grant 清除授权，临时服务失败保留凭据', async () => {
    const invalid = setup(async () => Response.json({ error: 'invalid_grant' }, { status: 400 }));
    await expect(invalid.auth.access()).rejects.toThrow('失效');
    expect(await invalid.auth.session()).toBeNull();
    const temporary = setup(async () => new Response('', { status: 503 }));
    await expect(temporary.auth.access()).rejects.toThrow('暂时不可用');
    expect(temporary.record().refreshToken).toBe('old-refresh');
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
