import { describe, expect, it } from 'vitest';
import { responseEvents } from '../../../shared/electron/backend/chat/responses';
import { modelEfforts } from '../../../shared/electron/backend/chat/models';
import { apiError, publicFailure } from '../../../shared/electron/backend/chat/errors';
import { validateRequest } from '../../../shared/electron/backend/chat/validation';
import { ChatGPTService } from '../../../shared/electron/backend/chat/service';
import type { UsageLedger } from '../../../shared/electron/backend/chat/usage';

async function collect(response: Response) {
  const events = [];
  for await (const event of responseEvents(response, new AbortController().signal))
    events.push(event);
  return events;
}
function chunks(text: string, contentType = 'application/octet-stream') {
  const bytes = new TextEncoder().encode(text);
  let offset = 0;
  return new Response(
    new ReadableStream({
      pull(controller) {
        if (offset === bytes.length) controller.close();
        else controller.enqueue(bytes.slice(offset, ++offset));
      },
    }),
    { headers: { 'content-type': contentType } },
  );
}
describe('兼容真实响应格式', () => {
  it('类型标头缺失或错误时仍可解析逐字节 SSE，包括中文', async () => {
    const events = await collect(
      chunks('data: {"type":"response.output_text.delta","delta":"你好"}\r\n\r\n'),
    );
    expect(events).toEqual([{ type: 'response.output_text.delta', delta: '你好' }]);
  });
  it('完整 JSON 回答转换为内容和 completed，保留服务端状态和用量', async () => {
    const value = {
      object: 'response',
      id: 'resp-1',
      status: 'completed',
      output: [{ content: [{ type: 'output_text', text: '连接成功' }] }],
      usage: { input_tokens: 2, output_tokens: 1, total_tokens: 3 },
    };
    const events = await collect(Response.json(value));
    expect(events).toEqual([
      { type: 'response.output_item.added', output_index: 0, item: value.output[0] },
      { type: 'response.output_text.delta', output_index: 0, delta: '连接成功' },
      { type: 'response.output_item.done', output_index: 0, item: value.output[0] },
      { type: 'response.completed', response: value },
    ]);
  });
  it('不会把 JSON 错误、任意 JSON 或 HTML 错认成成功回答', async () => {
    expect(await collect(Response.json({ error: { code: 'invalid_request' } }))).toEqual([
      { type: 'error', error: { code: 'invalid_request' } },
    ]);
    await expect(collect(Response.json({ text: '假的回答' }))).rejects.toThrow('非预期');
    await expect(
      collect(new Response('<html>secret</html>', { headers: { 'content-type': 'text/html' } })),
    ).rejects.toThrow('HTTP 200，格式 text/html');
  });
  it('JSON 的 incomplete 状态保留，取消后不继续读响应', async () => {
    const events = await collect(
      Response.json({ object: 'response', id: 'resp-1', status: 'incomplete', output: [] }),
    );
    expect(events[0].type).toBe('response.incomplete');
    const controller = new AbortController();
    controller.abort();
    const iterator = responseEvents(Response.json({}), controller.signal);
    await expect(iterator.next()).rejects.toMatchObject({ name: 'AbortError' });
  });
});
describe('effort 能力与请求', () => {
  it('优先使用账户目录公布档位，未知模型不猜测支持范围', () => {
    expect(
      modelEfforts({
        slug: 'unknown',
        supported_reasoning_levels: [
          { effort: 'low' },
          { effort: 'high' },
          { effort: 'unsupported' },
        ],
      }),
    ).toEqual(['low', 'high']);
    expect(modelEfforts({ slug: 'unknown' })).toEqual([]);
    expect(modelEfforts({ slug: 'gpt-6-luna' })).toContain('none');
    expect(modelEfforts({ slug: 'gpt-6.1-sol' })).not.toContain('none');
  });
  it('过滤目录中的无效档位并按强度排序，保留最高 max，遵守已知模型限制', () => {
    const supported_reasoning_levels = ['ultra', 'max', 'high', 'none', 'low', 'minimal', 'max'];
    expect(modelEfforts({ slug: 'gpt-6.1-sol', supported_reasoning_levels })).toEqual([
      'low',
      'high',
      'max',
    ]);
    expect(modelEfforts({ slug: 'unknown', supported_reasoning_levels })).toEqual([
      'none',
      'minimal',
      'low',
      'high',
      'max',
    ]);
    expect(modelEfforts({ slug: 'unknown', supported_reasoning_levels: ['ultra'] })).toEqual([]);
    expect(modelEfforts({ slug: 'gpt-6.1-sol' })).toEqual([
      'low',
      'medium',
      'high',
      'xhigh',
      'max',
    ]);
  });
  it('Ultra 在本机请求校验被拒绝，服务端档位错误不误导用户修改附件', () => {
    expect(() =>
      validateRequest({
        id: 'invalid-effort',
        modelId: 'gpt-6.1-sol',
        effort: 'ultra',
        webSearch: false,
        instructions: '',
        turns: [{ role: 'user', content: '你好' }],
      }),
    ).toThrow();
    const failure = publicFailure(
      apiError(400, {
        error: { code: 'invalid_value', param: 'reasoning.effort', message: 'secret user content' },
      }),
    );
    expect(failure).toMatchObject({
      status: 400,
      code: 'invalid_value',
      param: 'reasoning.effort',
    });
    expect(failure.message).toContain('思考强度');
    expect(failure.message).not.toContain('附件');
    expect(JSON.stringify(failure)).not.toContain('secret');
  });
  it.each(['low', 'max'] as const)(
    '将所选 %s 真实发送，拒绝不支持档位并正常记账',
    async (effort) => {
      const recorded: unknown[] = [];
      const service = new ChatGPTService({
        access: async () => ({ account: 'a', token: 'secret' }),
        ledger: {
          add: async (...args: unknown[]) => {
            recorded.push(args);
          },
        } as unknown as UsageLedger,
        fetch: async (url: any, options?: RequestInit) => {
          if (String(url).endsWith('/models'))
            return Response.json({
              models: [{ slug: 'gpt-6.1-sol', display_name: 'Sol', visibility: 'list' }],
            });
          expect(JSON.parse(options!.body as string).reasoning).toEqual({
            effort,
            summary: 'auto',
          });
          return Response.json({
            object: 'response',
            id: 'resp-1',
            status: 'completed',
            output: [{ content: [{ type: 'output_text', text: '成功' }] }],
            usage: { input_tokens: 2, output_tokens: 1, total_tokens: 3 },
          });
        },
      });
      const request = {
        id: 'test',
        modelId: 'gpt-6.1-sol',
        effort,
        webSearch: false,
        instructions: '',
        turns: [{ role: 'user' as const, content: '你好' }],
      };
      const result = await service.stream(request, () => {}, new AbortController().signal);
      expect(result.usage?.totalTokens).toBe(3);
      expect(recorded).toHaveLength(1);
      await expect(
        service.stream({ ...request, effort: 'minimal' }, () => {}, new AbortController().signal),
      ).rejects.toThrow('不支持该思考强度');
    },
  );
});

describe('完成事件不等待连接清理', () => {
  it('收到 completed 后，即使底层取消一直未返回，也结束请求', async () => {
    let cancelled = false;
    const terminal = {
      type: 'response.completed',
      response: {
        id: 'resp-open',
        status: 'completed',
        output: [],
        usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
      },
    };
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode(
              'data: {"type":"response.output_text.delta","delta":"已完成"}\n\n' +
                `data: ${JSON.stringify(terminal)}\n\n`,
            ),
          );
        },
        cancel() {
          cancelled = true;
          return new Promise<void>(() => {});
        },
      }),
      { headers: { 'content-type': 'text/event-stream' } },
    );
    const service = new ChatGPTService({
      access: async () => ({ account: 'test', token: 'test-only' }),
      ledger: { add: async () => {} } as unknown as UsageLedger,
      fetch: async (url: any) =>
        String(url).endsWith('/models')
          ? Response.json({
              models: [{ slug: 'gpt-6-luna', display_name: 'Luna', visibility: 'list' }],
            })
          : response,
    });
    const result = await Promise.race([
      service.stream(
        {
          id: 'open-stream',
          modelId: 'gpt-6-luna',
          webSearch: false,
          instructions: '',
          turns: [{ role: 'user', content: '你好' }],
        },
        () => {},
        new AbortController().signal,
      ),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('完成事件后仍在等待关闭')), 300),
      ),
    ]);
    expect(result.answerText).toBe('已完成');
    expect(result.usage?.totalTokens).toBe(2);
    expect(cancelled).toBe(true);
  });
});

describe('未完成的连接也必须退出等待', () => {
  it('收到 DONE 即结束读取，但不会伪造 completed', async () => {
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
        },
        cancel() {
          return new Promise<void>(() => {});
        },
      }),
      { headers: { 'content-type': 'text/event-stream' } },
    );
    const iterator = responseEvents(response, new AbortController().signal, 100);
    expect(await iterator.next()).toEqual({ done: true, value: undefined });
  });
  it('正文后连接静默时超时，取消未返回也不会继续等待', async () => {
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode(
              'data: {"type":"response.output_text.delta","delta":"正文"}\n\n',
            ),
          );
        },
        cancel() {
          return new Promise<void>(() => {});
        },
      }),
      { headers: { 'content-type': 'text/event-stream' } },
    );
    const iterator = responseEvents(response, new AbortController().signal, 30);
    expect((await iterator.next()).value?.delta).toBe('正文');
    await expect(iterator.next()).rejects.toThrow('没有新数据');
  });
});
