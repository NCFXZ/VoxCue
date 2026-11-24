import { describe, expect, it } from 'vitest';
import { responseActivity } from '../../../shared/electron/backend/chat/activity';
describe('真实响应进度元数据', () => {
  it('区分思考、搜索、网页和输出，不将推理正文暴露给界面', () => {
    expect(responseActivity({ type: 'response.created' })).toEqual({ phase: 'waiting' });
    expect(
      responseActivity({ type: 'response.reasoning_summary_text.delta', delta: 'private text' }),
    ).toEqual({ phase: 'thinking' });
    expect(responseActivity({ type: 'response.web_search_call.searching' })).toEqual({
      phase: 'searching',
    });
    expect(responseActivity({ type: 'response.output_text.delta', delta: 'answer' })).toEqual({
      phase: 'writing',
    });
    expect(
      responseActivity({
        type: 'response.output_item.added',
        item: {
          type: 'web_search_call',
          action: { type: 'open_page', url: 'https://example.com/docs?secret=value#part' },
        },
      }),
    ).toEqual({ phase: 'reading', detail: 'example.com/docs' });
  });
  it('忽略未知工具，不显示命令参数、无效网址或网址凭据', () => {
    expect(
      responseActivity({ type: 'response.function_call_arguments.delta', delta: 'secret command' }),
    ).toBeUndefined();
    for (const url of ['javascript:alert(1)', 'https://user:password@example.com', 'invalid']) {
      expect(
        responseActivity({
          type: 'response.output_item.done',
          item: { type: 'web_search_call', action: { type: 'open_page', url } },
        }),
      ).toEqual({ phase: 'reading' });
    }
  });
});
