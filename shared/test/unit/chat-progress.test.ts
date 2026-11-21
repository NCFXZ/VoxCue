import { codexAccess } from '../fixtures/codex-access';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatGPTService } from '../../../shared/electron/backend/chat/service';
import { requestResponse } from '../../../shared/electron/backend/chat/responses';
import { publicFailure } from '../../../shared/electron/backend/chat/errors';
import { responseActivity } from '../../../shared/electron/backend/chat/activity';
import { mergeActivityLog } from '../../../shared/electron/contracts/activity';
import type { ChatEvent } from '../../../shared/electron/contracts/chat';
import type { PersonalInfo } from '../../../shared/electron/contracts/profile';
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
    access: async () => codexAccess('fixture', 'fixture-only'),
    ledger: { add: async () => {} } as unknown as UsageLedger,
    ...options,
    fetch: async (url) =>
      new URL(String(url)).pathname.endsWith('/models')
        ? Response.json({
            models: [{ slug: request.modelId, display_name: 'Test', visibility: 'list' }],
          })
        : response,
  });
}
const events = (items: unknown[]) =>
  items.map((item) => `data: ${JSON.stringify(item)}\n\n`).join('');

describe('长响应与公开活动', () => {
  const answer = (items: unknown[], output: unknown[], profile?: PersonalInfo) => {
    const received: ChatEvent[] = [];
    const body = events([...items, { type: 'response.completed', response: { output } }]);
    const result = service(new Response(body)).stream({ ...request, profile }, event => received.push(event), new AbortController().signal);
    return { result, received };
  };
  const message = (...parts: string[]) => ({
    type: 'message', content: parts.map(text => ({ type: 'output_text', text })),
  });
  it('按完成事件补发缺少的后缀和后续内容段，保留拒答', async () => {
    const { result, received } = answer([
      { type: 'response.output_text.delta', output_index: 0, content_index: 0, delta: '前' },
    ], [message('前半段', '后半段'), { type: 'message', content: [{ type: 'refusal', refusal: '拒答' }] }]);
    expect((await result).answerText).toBe('前半段后半段拒答');
    expect(received.filter(e => e.type === 'delta').map(e => e.text)).toEqual(['前', '半段', '后半段', '拒答']);
  });
  it('相邻内容段的增量均可核对时，按终态顺序补回中间缺失的正文', async () => {
    const { result } = answer([
      { type: 'response.output_text.delta', output_index: 1, content_index: 0, delta: '甲' },
      { type: 'response.output_text.delta', output_index: 1, content_index: 1, delta: '乙' },
    ], [message('开头'), message('甲一', '乙二')]);
    expect((await result).answerText).toBe('开头甲一乙二');
  });
  it('到终态才识别出的进度段从最终回答中排除', async () => {
    const items = [{ type: 'response.output_text.delta', output_index: 0, content_index: 0, delta: '分析中' }];
    const commentary = { ...message('分析中'), phase: 'commentary' };
    expect((await answer(items, [commentary, message('正式答复')]).result).answerText).toBe('正式答复');
    await expect(answer(items, [commentary]).result).rejects.toThrow('未收到有效回答');
  });
  it('省略位置索引的旧服务按文字前缀补齐，不复制已发正文', async () => {
    const { result, received } = answer([{ type: 'response.output_text.delta', delta: '零一' }], [message('零', '一二')]);
    expect((await result).answerText).toBe('零一二');
    expect(received.filter(e => e.type === 'delta').map(e => e.text)).toEqual(['零一', '二']);
  });
  it('终态省略工具项时，仅以同一消息 ID 或唯一的已知工具前缀对齐', async () => {
    const tool = { type: 'response.output_item.done', output_index: 0, item: { type: 'web_search_call', id: 'search' } };
    const delta = { type: 'response.output_text.delta', output_index: 1, delta: '正文' };
    const final = { ...message('正文补齐'), id: 'answer' };
    expect((await answer([tool, delta], [final]).result).answerText).toBe('正文补齐');
    const start = { type: 'response.output_item.added', output_index: 4, item: { type: 'message', id: 'answer' } };
    expect((await answer([start, { ...delta, output_index: 4 }], [
      { type: 'reasoning', id: 'summary' }, final,
    ]).result).answerText).toBe('正文补齐');
    await expect(answer([delta], [final]).result).rejects.toThrow('回答未完整返回');
    await expect(answer([tool, { ...start, output_index: 1 }, delta], [
      { ...final, id: 'different' },
    ]).result).rejects.toThrow('回答未完整返回');
  });
  it('多段交错、含重复文字时，按各段的位置及各自的增量匹配终态', async () => {
    const items = [[0, '重'], [1, '重'], [0, '甲'], [1, '乙']].map(([content_index, delta]) =>
      ({ type: 'response.output_text.delta', output_index: 0, content_index, delta }));
    expect((await answer(items, [message('重甲!', '重乙。')]).result).answerText).toBe('重甲!重乙。');
  });
  it('完整拒答仅在 item.done 出现，完成事件只有元数据时也能补齐', async () => {
    const items = [
      { type: 'response.refusal.delta', output_index: 1, content_index: 0, delta: '不能' },
      { type: 'response.output_item.done', output_index: 1, item: {
        type: 'message', id: 'm', content: [{ type: 'refusal', refusal: '不能回答' }],
      } },
      { type: 'response.output_item.added', output_index: 1, item: { type: 'message', id: 'm', content: [] } },
    ];
    const { result, received } = answer(items, []);
    expect((await result).answerText).toBe('不能回答');
    expect(received.filter(e => e.type === 'delta').map(e => e.text)).toEqual(['不能', '回答']);
  });
  it('缺少尾部的资料提案用完整 JSON 验证，保留原先支持的仅有字段变更的回复', async () => {
    const profile = { name: '旧姓名', jobDescription: '', background: '' };
    const raw = JSON.stringify({ answer: '', changes: { name: '新姓名' } });
    const { result } = answer([{ type: 'response.output_text.delta', delta: raw.slice(0, 18) }], [message(raw)], profile);
    expect(await result).toMatchObject({ answerText: '', profileChanges: { name: '新姓名' } });
  });
  it('完成事件与已发内容矛盾时返回错误并保留已有内容', async () => {
    const { result, received } = answer([{ type: 'response.output_text.delta', delta: '旧答' }], [message('新答')]);
    await expect(result).rejects.toThrow('回答未完整返回');
    expect(received.filter(e => e.type === 'delta').map(e => e.text)).toEqual(['旧答']);
  });
  it.each([
    [{ type: 'reasoning', summary: [{ type: 'summary_text', text: '摘要' }] }],
    [message(' \t')],
    [{ ...message('进度'), phase: 'commentary' }],
  ])('只有摘要、进度或空白不作为成功回答', async output => {
    await expect(answer([], [output]).result).rejects.toThrow('未收到有效回答');
  });
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
