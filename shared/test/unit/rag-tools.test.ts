import { describe, it, expect, vi } from 'vitest';
import { ChatGPTService, publicFailure } from '../../../shared/electron/backend/chat/service';
import { KnowledgeTools } from '../../../shared/electron/application/ragTools';
import { RagChatService } from '../../../shared/electron/application/rag';
import { ragInstructions } from '../../../shared/electron/application/ragContext';
import type { KnowledgePort } from '../../../shared/electron/backend/knowledge/types';
import type { LocalTools } from '../../../shared/electron/backend/chat/ports';
import { UsageLedger } from '../../../shared/electron/backend/chat/usage';
import { temporaryDirectory } from '../temp';
const request = {
  id: 'tool-test',
  modelId: 'account-model',
  webSearch: false,
  instructions: 'Answer using evidence',
  turns: [{ role: 'user' as const, content: 'PID sensor 控制？' }],
};
it('思考强度被拒绝不改写成工具权限错误，也不误标工具不支持', async () => {
  const provider = await service(async (url) =>
    String(url).endsWith('/models')
      ? Response.json({
          models: [{ slug: 'account-model', display_name: 'Account', visibility: 'list' }],
        })
      : Response.json(
          { error: { code: 'invalid_value', param: 'reasoning.effort' } },
          { status: 400 },
        ),
  );
  await expect(
    provider.streamWithTools(request, vi.fn(), new AbortController().signal, {
      definitions: [],
      execute: vi.fn(),
    }),
  ).rejects.toThrow('思考强度');
  expect(provider.functionCallingStatus.supported).toBeNull();
});
const item = {
  itemId: 'doc:1',
  documentId: 'doc',
  kind: 'qa' as const,
  title: 'PID sensor',
  content: 'Complete answer and follow-up. Tailxyz 37.',
  followUpIds: [],
  section: 'PID',
};
const hit = {
  chunkId: 'doc:1:0',
  itemId: item.itemId,
  documentId: 'doc',
  name: 'sensor.md',
  title: item.title,
  excerpt: 'PID controls lift-off',
  mode: 'hybrid' as const,
  score: 0.02,
};
function core(): KnowledgePort {
  return {
    initialize: vi.fn(),
    indexDocument: vi.fn(),
    updateDocument: vi.fn(),
    invalidateDocument: vi.fn(),
    removeDocument: vi.fn(),
    listDocuments: vi.fn(),
    search: vi.fn(async () => [hit]),
    getItem: vi.fn(async () => item),
    close: vi.fn(),
  };
}
const call = (name: string, args: unknown, id = 'call_1') => ({
  type: 'function_call',
  namespace: 'voxcue_knowledge',
  name,
  arguments: typeof args === 'string' ? args : JSON.stringify(args),
  call_id: id,
  id: 'fc_' + id,
});
function sse(events: unknown[]) {
  return new Response(events.map((event) => 'data: ' + JSON.stringify(event) + '\n\n').join(''), {
    headers: { 'content-type': 'text/event-stream' },
  });
}
async function service(transport: typeof fetch) {
  const dir = await temporaryDirectory('rag-tools');
  return new ChatGPTService({
    access: async () => ({ token: 'test-only', account: 'test-only-account' }),
    ledger: new UsageLedger(dir),
    fetch: transport,
  });
}
const terminal = (id: string, output: unknown[], text?: string) =>
  sse([
    ...(text ? [{ type: 'response.output_text.delta', delta: text }] : []),
    {
      type: 'response.completed',
      response: { id, output, usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12 } },
    },
  ]);
describe('Function Calling（模拟 HTTP/SSE，真实 Provider 协议代码）', () => {
  it('模型可直接回答；空结果、数据库故障、未知工具和过期工具期限均明确处理', async () => {
    const knowledge = core(),
      runtime = new KnowledgeTools(knowledge),
      signal = new AbortController().signal;
    const provider = await service(
      vi.fn(async (url) =>
        String(url).endsWith('/models')
          ? Response.json({
              models: [{ slug: 'account-model', display_name: 'Account', visibility: 'list' }],
            })
          : terminal('direct', [], 'General technical answer'),
      ),
    );
    expect(
      (await provider.streamWithTools(request, vi.fn(), signal, runtime)).answerText,
    ).toContain('General technical');
    expect(knowledge.search).not.toHaveBeenCalled();
    expect(JSON.parse(await runtime.execute(call('unknown_tool', {}), signal)).error).toContain(
      '未知',
    );
    vi.mocked(knowledge.search).mockResolvedValue([]);
    expect(
      JSON.parse(
        await runtime.execute(
          call('search_knowledge_base', { query: 'empty', topK: 5, mode: 'hybrid' }),
          signal,
        ),
      ).candidates,
    ).toEqual([]);
    vi.mocked(knowledge.search).mockRejectedValue(Error('synthetic database fault'));
    expect(
      JSON.parse(
        await runtime.execute(
          call('search_knowledge_base', { query: 'fault', topK: 5, mode: 'hybrid' }),
          signal,
        ),
      ).error,
    ).toContain('不可用');
    const timeout = vi
      .spyOn(AbortSignal, 'timeout')
      .mockReturnValue(AbortSignal.abort(new DOMException('synthetic timeout', 'TimeoutError')));
    try {
      vi.mocked(knowledge.search).mockImplementation(async (_q, _k, _m, lookup) => {
        lookup.throwIfAborted();
        return [];
      });
      expect(
        JSON.parse(
          await runtime.execute(
            call('search_knowledge_base', { query: 'timeout', topK: 5, mode: 'hybrid' }),
            signal,
          ),
        ).error,
      ).toContain('超时');
    } finally {
      timeout.mockRestore();
    }
  });
  it('一次返回多个调用仍只执行六次，401 不执行本地工具或伪装成功', async () => {
    const runtime: LocalTools = { definitions: [], execute: vi.fn(async () => '{"ok":true}') };
    let round = 0;
    const provider = await service(
      vi.fn(async (url, options) => {
        if (String(url).endsWith('/models'))
          return Response.json({
            models: [{ slug: 'account-model', display_name: 'Account', visibility: 'list' }],
          });
        round++;
        if (round === 1)
          return terminal(
            'many',
            Array.from({ length: 8 }, (_, i) => call('search_knowledge_base', {}, 'many_' + i)),
          );
        expect(JSON.parse(options!.body as string).tool_choice).toBe('none');
        return terminal('final', [], 'Final within budget');
      }),
    );
    expect(
      (await provider.streamWithTools(request, vi.fn(), new AbortController().signal, runtime))
        .warning,
    ).toContain('预算');
    expect(runtime.execute).toHaveBeenCalledTimes(6);
    const expired = await service(
      vi.fn(async () =>
        Response.json({ error: { code: 'subscription_sharing_invalid_user' } }, { status: 401 }),
      ),
    );
    vi.mocked(runtime.execute).mockClear();
    try {
      await expired.streamWithTools(request, vi.fn(), new AbortController().signal, runtime);
      throw Error('should reject');
    } catch (error) {
      expect(publicFailure(error).status).toBe(401);
    }
    expect(runtime.execute).not.toHaveBeenCalled();
  });
  it('搜索 -> 完整回取 -> 流式答案；命名空间、stateless 历史与 reasoning 保留且不泄露', async () => {
    const knowledge = core(),
      bodies: any[] = [];
    const events: any[] = [];
    const provider = await service(
      vi.fn(async (url, options) => {
        if (String(url).endsWith('/models'))
          return Response.json({
            models: [{ slug: 'account-model', display_name: 'Account', visibility: 'list' }],
          });
        const body = JSON.parse(options!.body as string);
        bodies.push(body);
        expect(body.store).toBe(false);
        expect(body.stream).toBe(true);
        expect(body.tools[0].type).toBe('namespace');
        expect(body.instructions).toContain(ragInstructions);
        expect(body.instructions).toContain('需要本地证据时，先搜索，再按需读取相关的完整条目');
        expect(body.instructions).toContain('实时面试中不要求用户重试、补充资料或切换模式');
        expect(body).not.toHaveProperty('previous_response_id');
        expect(body.input.some((i: any) => i.role === 'system')).toBe(false);
        if (bodies.length === 1)
          return terminal('r1', [
            {
              type: 'reasoning',
              id: 'rs1',
              encrypted_content: 'PRIVATE_ENCRYPTED_TEST',
              summary: [],
            },
            call('search_knowledge_base', { query: 'PID sensor', topK: 5, mode: 'hybrid' }),
          ]);
        if (bodies.length === 2) {
          expect(body.input).toContainEqual(
            expect.objectContaining({
              type: 'function_call_output',
              call_id: 'call_1',
              output: expect.stringContaining('doc:1'),
            }),
          );
          expect(body.input).toContainEqual(
            expect.objectContaining({ encrypted_content: 'PRIVATE_ENCRYPTED_TEST' }),
          );
          return terminal('r2', [call('get_knowledge_item', { itemId: 'doc:1' }, 'call_2')]);
        }
        expect(body.input).toContainEqual(
          expect.objectContaining({
            type: 'function_call_output',
            call_id: 'call_2',
            output: expect.stringContaining('Tailxyz 37'),
          }),
        );
        return terminal('r3', [], 'The answer is 37.');
      }),
    );
    const rag = new RagChatService(provider, knowledge, async () => 'function');
    const result = await rag.stream(request, (e) => events.push(e), new AbortController().signal);
    expect(result.answerText).toBe('The answer is 37.');
    expect(result.usage?.totalTokens).toBe(36);
    expect((await provider.usage()).totalTokens).toBe(36);
    expect(knowledge.search).toHaveBeenCalledTimes(1);
    expect(knowledge.getItem).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(events)).not.toContain('PRIVATE_ENCRYPTED_TEST');
  });
  it('组装 arguments delta，最终调用字段补齐后才能执行', async () => {
    let round = 0;
    const runtime: LocalTools = { definitions: [], execute: vi.fn(async () => '{"ok":true}') };
    const provider = await service(
      vi.fn(async (url) => {
        if (String(url).endsWith('/models'))
          return Response.json({
            models: [{ slug: 'account-model', display_name: 'Account', visibility: 'list' }],
          });
        if (round++) return terminal('end', [], 'Done');
        const c = call('search_knowledge_base', '');
        return sse([
          { type: 'response.output_item.added', output_index: 0, item: c },
          {
            type: 'response.function_call_arguments.delta',
            output_index: 0,
            delta: '{"query":"PID"',
          },
          {
            type: 'response.function_call_arguments.delta',
            output_index: 0,
            delta: ',"topK":5,"mode":"hybrid"}',
          },
          { type: 'response.completed', response: { id: 'split', output: [] } },
        ]);
      }),
    );
    await provider.streamWithTools(request, vi.fn(), new AbortController().signal, runtime);
    expect(runtime.execute).toHaveBeenCalledWith(
      expect.objectContaining({ arguments: '{"query":"PID","topK":5,"mode":"hybrid"}' }),
      expect.any(AbortSignal),
    );
  });
  it('工具参数与读取范围校验，解析错误、越权条目和超大完整答案明确返回错误', async () => {
    const knowledge = core(),
      runtime = new KnowledgeTools(knowledge),
      signal = new AbortController().signal;
    expect(
      JSON.parse(await runtime.execute(call('search_knowledge_base', '{bad'), signal)).error,
    ).toContain('JSON');
    expect(
      JSON.parse(await runtime.execute(call('get_knowledge_item', { itemId: 'guessed' }), signal))
        .error,
    ).toContain('本次请求');
    expect(knowledge.getItem).not.toHaveBeenCalled();
    expect(
      JSON.parse(
        await runtime.execute(
          call('search_knowledge_base', { query: 'PID', topK: 5, mode: 'hybrid', sql: 'select *' }),
          signal,
        ),
      ).error,
    ).toContain('参数');
    await runtime.execute(
      call('search_knowledge_base', { query: 'PID', topK: 5, mode: 'hybrid' }),
      signal,
    );
    vi.mocked(knowledge.getItem).mockResolvedValue({ ...item, content: 'long '.repeat(10000) });
    expect(
      JSON.parse(await runtime.execute(call('get_knowledge_item', { itemId: item.itemId }), signal))
        .error,
    ).toContain('未截断');
  });
  it('循环调用只执行预算内的工具，最终禁用工具生成回答；重复 call_id 拒绝', async () => {
    let round = 0;
    const runtime: LocalTools = { definitions: [], execute: vi.fn(async () => '{"ok":true}') };
    const choices: string[] = [];
    const provider = await service(
      vi.fn(async (url, options) => {
        if (String(url).endsWith('/models'))
          return Response.json({
            models: [{ slug: 'account-model', display_name: 'Account', visibility: 'list' }],
          });
        const body = JSON.parse(options!.body as string);
        choices.push(body.tool_choice);
        round++;
        return round < 4
          ? terminal('loop' + round, [call('search_knowledge_base', {}, 'call_' + round)])
          : terminal('end', [], 'Budget-aware answer');
      }),
    );
    expect(
      (await provider.streamWithTools(request, vi.fn(), new AbortController().signal, runtime))
        .answerText,
    ).toContain('Budget-aware');
    expect(runtime.execute).toHaveBeenCalledTimes(3);
    expect(choices).toEqual(['auto', 'auto', 'auto', 'none']);
    let duplicate = 0;
    const bad = await service(
      vi.fn(async (url) =>
        String(url).endsWith('/models')
          ? Response.json({
              models: [{ slug: 'account-model', display_name: 'Account', visibility: 'list' }],
            })
          : terminal('dupe' + duplicate++, [call('search_knowledge_base', {})]),
      ),
    );
    await expect(
      bad.streamWithTools(request, vi.fn(), new AbortController().signal, runtime),
    ).rejects.toThrow('ID');
  });
  it('取消阻断回填，账户不支持工具时明确失败且不改用其他 API', async () => {
    const controller = new AbortController(),
      runtime: LocalTools = {
        definitions: [],
        execute: vi.fn(async () => {
          controller.abort();
          return '{}';
        }),
      };
    let requests = 0;
    const provider = await service(
      vi.fn(async (url) => {
        if (String(url).endsWith('/models'))
          return Response.json({
            models: [{ slug: 'account-model', display_name: 'Account', visibility: 'list' }],
          });
        requests++;
        return terminal('cancel', [call('search_knowledge_base', {})]);
      }),
    );
    await expect(
      provider.streamWithTools(request, vi.fn(), controller.signal, runtime),
    ).rejects.toThrow();
    expect(requests).toBe(1);
    const unsupported = await service(
      vi.fn(async (url) =>
        String(url).endsWith('/models')
          ? Response.json({
              models: [{ slug: 'account-model', display_name: 'Account', visibility: 'list' }],
            })
          : Response.json(
              { error: { code: 'subscription_sharing_unsupported_capability' } },
              { status: 400 },
            ),
      ),
    );
    try {
      await unsupported.streamWithTools(request, vi.fn(), new AbortController().signal, runtime);
      throw Error('should reject');
    } catch (e) {
      expect(publicFailure(e).message).toContain('手动改用 Local RAG');
    }
    expect(unsupported.functionCallingStatus.supported).toBe(false);
  });
});
