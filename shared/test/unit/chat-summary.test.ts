import { expect, it } from 'vitest';
import { ReasoningSummary } from '../../../shared/electron/backend/chat/summary';
import { ChatGPTService } from '../../../shared/electron/backend/chat/service';
import type { UsageLedger } from '../../../shared/electron/backend/chat/usage';
import type { ChatEvent } from '../../../shared/electron/contracts/chat';
it('只有 output_item/summary_part 事件时也接收公开摘要，后到 added 不清空已收到内容', () => {
  const summary = new ReasoningSummary();
  summary.receive({
    type: 'response.reasoning_summary_part.added',
    item_id: 'r',
    summary_index: 0,
    part: { type: 'summary_text', text: '部分' },
  });
  summary.receive({
    type: 'response.output_item.done',
    item: {
      id: 'r',
      type: 'reasoning',
      summary: [{ type: 'summary_text', text: '完整公开摘要' }],
      content: [{ type: 'reasoning_text', text: 'PRIVATE' }],
      encrypted_content: 'PRIVATE',
    },
  });
  summary.receive({
    type: 'response.output_item.added',
    item: { id: 'r', type: 'reasoning', summary: [{ type: 'summary_text', text: '' }] },
  });
  expect(summary.text).toBe('完整公开摘要');
});
it('仅接收公开摘要，完成事件校准增量，多段不会重复', () => {
  const summary = new ReasoningSummary();
  expect(summary.receive({ type: 'response.reasoning_text.delta', delta: 'PRIVATE' })).toBe(false);
  summary.receive({
    type: 'response.reasoning_summary_text.delta',
    item_id: 'r',
    summary_index: 0,
    delta: '公开',
  });
  summary.receive({
    type: 'response.reasoning_summary_text.done',
    item_id: 'r',
    summary_index: 0,
    text: '公开摘要',
  });
  summary.receive({
    type: 'response.reasoning_summary_part.done',
    item_id: 'r',
    summary_index: 0,
    part: { type: 'summary_text', text: '公开摘要' },
  });
  summary.receive({
    type: 'response.completed',
    response: {
      output: [
        {
          id: 'r',
          type: 'reasoning',
          encrypted_content: 'PRIVATE',
          summary: [
            { type: 'summary_text', text: '公开摘要' },
            { type: 'summary_text', text: '第二段' },
          ],
        },
      ],
    },
  });
  expect(summary.text).toBe('公开摘要\n\n第二段');
});
it('完整 JSON 的终态摘要可以直接补齐；拒绝无界文本和无效索引', () => {
  const summary = new ReasoningSummary();
  summary.receive({
    type: 'response.completed',
    response: {
      output: [
        { id: 'r', type: 'reasoning', summary: [{ type: 'summary_text', text: '最终摘要' }] },
      ],
    },
  });
  summary.receive({
    type: 'response.reasoning_summary_text.delta',
    item_id: 'r',
    summary_index: -1,
    delta: '错误',
  });
  summary.receive({
    type: 'response.reasoning_summary_text.delta',
    item_id: 'r',
    summary_index: 0,
    delta: 'x'.repeat(100001),
  });
  expect(summary.text).toBe('最终摘要');
});
it.each([undefined, 'xhigh'] as const)(
  'GPT-6.1-Sol 思考强度 %s 时显式请求公开摘要，空摘要不替换为私有推理',
  async (effort) => {
    const events: ChatEvent[] = [];
    const service = new ChatGPTService({
      access: async () => ({ account: 'fixture', token: 'test-only' }),
      ledger: {} as UsageLedger,
      fetch: async (url, options) => {
        if (String(url).endsWith('/models'))
          return Response.json({
            models: [{ slug: 'gpt-6.1-sol', display_name: 'GPT-6.1-Sol', visibility: 'list' }],
          });
        expect(JSON.parse(options!.body as string).reasoning).toEqual({
          ...(effort ? { effort } : {}),
          summary: 'auto',
        });
        return Response.json({
          object: 'response',
          id: 'empty-summary',
          status: 'completed',
          output: [
            {
              id: 'r',
              type: 'reasoning',
              summary: [null, { type: 'summary_text', text: '' }],
              content: [{ type: 'reasoning_text', text: 'PRIVATE' }],
              encrypted_content: 'PRIVATE',
            },
            { id: 'm', type: 'message', content: [{ type: 'output_text', text: '正常正文' }] },
          ],
        });
      },
    });
    const result = await service.stream(
      {
        id: 'summary-request',
        modelId: 'gpt-6.1-sol',
        effort,
        instructions: '',
        webSearch: false,
        turns: [{ role: 'user', content: 'fixture' }],
      },
      (event) => events.push(event),
      new AbortController().signal,
    );
    expect(result.answerText).toBe('正常正文');
    expect(result.reasoningSummary).toBeUndefined();
    expect(events.some((event) => event.type === 'reasoning-summary')).toBe(false);
    expect(JSON.stringify(events)).not.toContain('PRIVATE');
  },
);

it.each(['sse', 'json'])('原生服务通过 %s 转发摘要、校准最终结果且不混入正文', async (format) => {
  const terminal = {
    object: 'response',
    id: 'response-summary',
    status: 'completed',
    output: [
      {
        id: 'reasoning-1',
        type: 'reasoning',
        encrypted_content: 'PRIVATE',
        summary: [{ type: 'summary_text', text: '公开摘要' }],
      },
      { id: 'message-1', type: 'message', content: [{ type: 'output_text', text: '正式回答' }] },
    ],
  };
  const events: ChatEvent[] = [];
  const service = new ChatGPTService({
    access: async () => ({ account: 'fixture', token: 'test-only' }),
    ledger: {} as UsageLedger,
    fetch: async (url, options) => {
      if (String(url).endsWith('/models'))
        return Response.json({
          models: [
            {
              slug: 'summary-test',
              display_name: 'Summary Test',
              visibility: 'list',
              supported_reasoning_levels: ['low'],
            },
          ],
        });
      expect(JSON.parse(options!.body as string).reasoning).toEqual({
        effort: 'low',
        summary: 'auto',
      });
      if (format === 'json') return Response.json(terminal);
      return new Response(
        [
          { type: 'response.reasoning_text.delta', delta: 'PRIVATE' },
          {
            type: 'response.reasoning_summary_text.delta',
            item_id: 'reasoning-1',
            summary_index: 0,
            delta: '公开',
          },
          {
            type: 'response.reasoning_summary_text.done',
            item_id: 'reasoning-1',
            summary_index: 0,
            text: '公开摘要',
          },
          { type: 'response.output_text.delta', delta: '正式回答' },
          { type: 'response.completed', response: terminal },
        ]
          .map((event) => `data: ${JSON.stringify(event)}\n\n`)
          .join(''),
        { headers: { 'content-type': 'text/event-stream' } },
      );
    },
  });
  const result = await service.stream(
    {
      id: 'request-summary',
      modelId: 'summary-test',
      effort: 'low',
      instructions: '',
      webSearch: false,
      turns: [{ role: 'user', content: '你好' }],
    },
    (event) => events.push(event),
    new AbortController().signal,
  );
  expect(result).toMatchObject({ answerText: '正式回答', reasoningSummary: '公开摘要' });
  expect(JSON.stringify(events)).not.toContain('PRIVATE');
  expect(
    events.some((event) => event.type === 'reasoning-summary' && event.text === '公开摘要'),
  ).toBe(true);
});
