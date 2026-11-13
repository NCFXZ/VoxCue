import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatGPTService } from '../../../shared/electron/backend/chat/service';
import { requestResponse } from '../../../shared/electron/backend/chat/responses';
import { publicFailure } from '../../../shared/electron/backend/chat/errors';
import { responseActivity } from '../../../shared/electron/backend/chat/activity';
import { mergeActivityLog } from '../../../shared/electron/contracts/activity';
import type { ChatEvent } from '../../../shared/electron/contracts/chat';
import type { UsageLedger } from '../../../shared/electron/backend/chat/usage';
import { reasoningSections } from '../../../shared/src/services/responseProgress';

it('无公开思考内容时替换空阶段，有内容才保留上一阶段，迟到完成不复活旧状态', () => {
  let history = mergeActivityLog([], {
    id: 'wait',
    kind: 'status',
    phase: 'waiting',
    status: 'in_progress',
  });
  history = mergeActivityLog(history, {
    id: 'process',
    kind: 'status',
    phase: 'processing',
    status: 'in_progress',
  });
  history = mergeActivityLog(history, {
    id: 'think',
    kind: 'status',
    phase: 'thinking',
    status: 'in_progress',
  });
  expect(history.map((entry) => entry.id)).toEqual(['think']);
  history = mergeActivityLog(history, {
    id: 'wait',
    kind: 'status',
    phase: 'waiting',
    status: 'completed',
  });
  expect(history.map((entry) => entry.id)).toEqual(['think']);
  history = mergeActivityLog(history, {
    id: 'summary',
    kind: 'reasoning',
    phase: 'thinking',
    detail: '**核对资料**\n\n公开内容。',
  });
  history = mergeActivityLog(history, {
    id: 'search',
    kind: 'status',
    phase: 'searching',
    status: 'in_progress',
  });
  expect(history.map((entry) => entry.id)).toEqual(['think', 'summary', 'search']);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
const request = {
  id: 'progress',
  modelId: 'gpt-6.1-sol',
  webSearch: true,
  instructions: '',
  turns: [{ role: 'user' as const, content: 'test' }],
};
function service(response: Response, options: { idleTimeoutMs?: number } = {}) {
  return new ChatGPTService({
    access: async () => ({ account: 'fixture', token: 'fixture-only' }),
    ledger: { add: async () => {} } as unknown as UsageLedger,
    ...options,
    fetch: async (url) =>
      String(url).endsWith('/models')
        ? Response.json({
            models: [{ slug: request.modelId, display_name: 'Test', visibility: 'list' }],
          })
        : response,
  });
}
const events = (items: unknown[]) =>
  items.map((item) => `data: ${JSON.stringify(item)}\n\n`).join('');

describe('长响应与公开活动', () => {
  it('在下段正文前发布已返回的来源，重复注释和最终快照不重发', async () => {
    const first = { url: 'https://docs.example.org/guide', title: '指南' };
    const second = { url: 'https://reference.example.org/', title: '手册' };
    const search = { type: 'web_search_call', status: 'completed', action: { type: 'search', sources: [first] } };
    const annotation = { type: 'url_citation', ...second };
    const stream = events([
      { type: 'response.output_item.done', item: search },
      { type: 'response.output_text.delta', delta: '引用' },
      { type: 'response.output_text.annotation.added', annotation },
      { type: 'response.output_text.annotation.added', annotation },
      { type: 'response.output_text.delta', delta: '。' },
      { type: 'response.completed', response: { output: [search, { content: [{ annotations: [annotation] }] }] } },
    ]);
    const received: ChatEvent[] = [];
    const result = await service(new Response(stream, { headers: { 'content-type': 'text/event-stream' } }))
      .stream(request, event => received.push(event), new AbortController().signal);
    const visible = received.filter(event => event.type === 'sources' || event.type === 'delta');
    expect(visible).toEqual([
      { id: request.id, type: 'sources', sources: [first] },
      { id: request.id, type: 'delta', text: '引用' },
      { id: request.id, type: 'sources', sources: [first, second] },
      { id: request.id, type: 'delta', text: '。' },
    ]);
    expect(result.sources).toEqual([first, second]);
  });
  it('持续有心跳的八分钟回答可以完成，HTTP头计时器也不会继续截断正文', async () => {
    vi.useFakeTimers();
    vi.spyOn(AbortSignal, 'timeout').mockImplementation((milliseconds) => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(new DOMException('Timeout', 'TimeoutError')), milliseconds);
      return controller.signal;
    });
    let stream!: ReadableStreamDefaultController<Uint8Array>;
    const encoder = new TextEncoder();
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          stream = controller;
        },
      }),
      { headers: { 'content-type': 'text/event-stream' } },
    );
    const running = service(response).stream(request, () => {}, new AbortController().signal);
    await vi.advanceTimersByTimeAsync(0);
    for (let index = 0; index < 4; index++) {
      await vi.advanceTimersByTimeAsync(120000);
      stream.enqueue(encoder.encode(': keep-alive\n\n'));
      await vi.advanceTimersByTimeAsync(0);
    }
    stream.enqueue(
      encoder.encode(
        events([
          {
            type: 'response.completed',
            response: {
              id: 'long-response',
              output: [{ type: 'message', content: [{ type: 'output_text', text: '长响应完成' }] }],
            },
          },
        ]),
      ),
    );
    expect((await running).answerText).toBe('长响应完成');
  });
  it('持续静默仍报明确错误并释放读取，取消不会被当成网络失败', async () => {
    vi.useFakeTimers();
    const body = () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(events([{ type: 'response.created' }])));
          },
          cancel() {
            return new Promise<void>(() => {});
          },
        }),
        { headers: { 'content-type': 'text/event-stream' } },
      );
    const failed = service(body(), { idleTimeoutMs: 30 })
      .stream(request, () => {}, new AbortController().signal)
      .catch(publicFailure);
    await vi.advanceTimersByTimeAsync(31);
    expect(await failed).toMatchObject({ code: 'response_idle_timeout' });
    const controller = new AbortController();
    const cancelled = service(body())
      .stream(request, () => {}, controller.signal)
      .catch(publicFailure);
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    expect(await cancelled).toMatchObject({ code: 'cancelled' });
  });
  it('等待HTTP头超时与已建立连接的静默超时分开', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn<typeof fetch>(
      async (_url, init) =>
        new Promise((_resolve, reject) => {
          init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason));
        }),
    );
    const pending = requestResponse(
      fetcher,
      'https://example.com',
      {},
      new AbortController().signal,
      25,
    ).catch(publicFailure);
    await vi.advanceTimersByTimeAsync(26);
    expect(await pending).toMatchObject({ code: 'response_headers_timeout' });
  });
  it.each(['sse', 'json'])(
    '保留%s公开进度、所有搜索词和网页操作，进度正文不混入最终回答',
    async (transport) => {
      const output = [
        {
          id: 'comment',
          type: 'message',
          phase: 'commentary',
          content: [{ type: 'output_text', text: '先查官方文档。' }],
        },
        {
          id: 'search',
          type: 'web_search_call',
          status: 'completed',
          action: { type: 'search', queries: ['official first', 'official second'] },
        },
        {
          id: 'read',
          type: 'web_search_call',
          status: 'completed',
          action: { type: 'open_page', url: 'https://example.com/docs?secret=hidden#part' },
        },
        {
          id: 'reason',
          type: 'reasoning',
          encrypted_content: 'PRIVATE',
          content: [{ type: 'reasoning_text', text: 'PRIVATE' }],
          summary: [{ type: 'summary_text', text: '公开摘要' }],
        },
        {
          id: 'final',
          type: 'message',
          phase: 'final_answer',
          content: [{ type: 'output_text', text: '最终回答' }],
        },
      ];
      const terminal = { object: 'response', id: 'result', status: 'completed', output };
      const response =
        transport === 'json'
          ? Response.json(terminal)
          : new Response(
              events([
                {
                  type: 'response.output_item.added',
                  output_index: 0,
                  item: { ...output[0], content: [] },
                },
                { type: 'response.output_text.delta', output_index: 0, delta: '先查官方文档。' },
                { type: 'response.output_item.done', output_index: 0, item: output[0] },
                { type: 'response.reasoning_text.delta', delta: 'PRIVATE' },
                { type: 'response.completed', response: terminal },
              ]),
              { headers: { 'content-type': 'text/event-stream' } },
            );
      const received: ChatEvent[] = [];
      const result = await service(response).stream(
        request,
        (event) => received.push(event),
        new AbortController().signal,
      );
      expect(result.answerText).toBe('最终回答');
      expect(result.reasoningSummary).toBe('公开摘要');
      expect(
        result.activities?.filter((entry) => entry.kind !== 'status').map((entry) => entry.kind),
      ).toEqual(['commentary', 'web_search', 'open_page', 'reasoning']);
      expect(result.activities?.filter((entry) => entry.kind === 'reasoning')).toEqual([
        expect.objectContaining({ detail: '公开摘要' }),
      ]);
      expect(result.activities).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: 'commentary',
            detail: '先查官方文档。',
            status: 'completed',
          }),
          expect.objectContaining({
            kind: 'web_search',
            detail: 'official first · official second',
          }),
          expect.objectContaining({ kind: 'open_page', url: 'https://example.com/docs' }),
        ]),
      );
      expect(JSON.stringify({ result, received })).not.toContain('PRIVATE');
      expect(JSON.stringify(result.activities)).not.toContain('secret');
    },
  );
  it('工具完成事件补齐状态，不重复工具行或抹掉已接收的网址', () => {
    const reading = responseActivity({
      type: 'response.output_item.added',
      item: {
        id: 'read',
        type: 'web_search_call',
        action: { type: 'open_page', url: 'https://example.com/docs' },
      },
    })!;
    let history = mergeActivityLog([], reading);
    history = mergeActivityLog(
      history,
      responseActivity({ type: 'response.web_search_call.completed', item_id: 'read' })!,
    );
    history = mergeActivityLog(history, reading);
    expect(history).toEqual([
      expect.objectContaining({
        kind: 'open_page',
        status: 'completed',
        url: 'https://example.com/docs',
      }),
    ]);
    expect(mergeActivityLog(history, { phase: 'thinking' })).toBe(history);
  });
});

it.each(['sse', 'json'])(
  '按%s实际顺序保留思考、搜索、再次思考，终态不重排旧标题',
  async (transport) => {
    const reasoning = (id: string, title: string) => ({
      id,
      type: 'reasoning',
      summary: [{ type: 'summary_text', text: `**${title}**\n\n公开说明。` }],
    });
    const output = [
      reasoning('first', '整理需求'),
      {
        id: 'search',
        type: 'web_search_call',
        status: 'completed',
        action: { type: 'search', queries: ['官方来源'] },
      },
      reasoning('second', '核对来源'),
      { id: 'final', type: 'message', content: [{ type: 'output_text', text: '回答' }] },
    ];
    const terminal = { id: 'ordered', object: 'response', status: 'completed', output };
    const response =
      transport === 'json'
        ? Response.json(terminal)
        : new Response(
            events([
              { type: 'response.created' },
              {
                type: 'response.reasoning_summary_text.delta',
                item_id: 'first',
                summary_index: 0,
                delta: '**整理需求**\n\n公开说明。',
              },
              { type: 'response.web_search_call.in_progress', item_id: 'search' },
              { type: 'response.output_item.done', output_index: 1, item: output[1] },
              {
                type: 'response.reasoning_summary_text.delta',
                item_id: 'second',
                summary_index: 0,
                delta: '**核对来源**\n\n公开说明。',
              },
              { type: 'response.output_text.delta', output_index: 3, delta: '回答' },
              { type: 'response.completed', response: terminal },
            ]),
            { headers: { 'content-type': 'text/event-stream' } },
          );
    const result = await service(response).stream(request, () => {}, new AbortController().signal);
    expect(
      result.activities
        ?.filter((entry) => entry.kind !== 'status')
        .map((entry) => [entry.kind, entry.detail]),
    ).toEqual([
      ['reasoning', '**整理需求**\n\n公开说明。'],
      ['web_search', '官方来源'],
      ['reasoning', '**核对来源**\n\n公开说明。'],
    ]);
    expect(
      result.activities
        ?.filter((entry) => entry.kind === 'status' && entry.phase !== 'waiting')
        .map((entry) => entry.phase),
    ).toEqual(['thinking', 'thinking', 'writing']);
  },
);

it('自动使用 Markdown/粗体主标题，代码块和没有标题的公开文本保持原样', () => {
  expect(reasoningSections('**整理需求**\n\n第一段。\n\n### 核对来源\n\n第二段。')).toEqual([
    { title: '整理需求', body: '第一段。' },
    { title: '核对来源', body: '第二段。' },
  ]);
  expect(reasoningSections('没有主标题的公开文字。')).toEqual([{ body: '没有主标题的公开文字。' }]);
  expect(reasoningSections('**真实标题**\n\n```md\n# 代码中的标题\n```')).toEqual([
    { title: '真实标题', body: '```md\n# 代码中的标题\n```' },
  ]);
});
