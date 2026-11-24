import { describe, expect, it, vi } from 'vitest';
import { DeepSeekWebResults } from '../../electron/backend/api/deepseekWeb';

const search = {
  id: 'srvtoolu_s_00_fixture', type: 'deepseek_web_search',
  action: { type: 'search', queries: ['DeepSeek API public documentation'] },
};

describe('DeepSeek web tool responses', () => {
  it('tracks a completed search and publishes only validated results and public activity', () => {
    const web = new DeepSeekWebResults();
    const publish = vi.fn();
    expect(web.ingest({ server_tool_event: { type: 'call_started', call: search } }, publish)).toBe(false);
    expect(web.completedSearch).toBe(false);
    expect(web.ingest({ server_tool_event: {
      type: 'call_completed', call: { id: search.id, status: 'completed', sources: [
        { type: 'url', url: 'https://example.com/news?utm_source=fixture', title: '新闻', snippet: 'private snippet' },
        { type: 'url', url: 'https://example.com/news#headline', title: '重复结果' },
        { type: 'url', url: 'javascript:alert(1)' },
        { type: 'url', url: 'https://login:password@example.com/private' },
      ] },
    } }, publish)).toBe(true);
    expect(web.completedSearch).toBe(true);
    expect([...web.sources.entries()]).toEqual([
      ['https://example.com/news', { url: 'https://example.com/news?utm_source=fixture', title: '新闻' }],
    ]);
    expect(publish.mock.calls.flat()).toEqual(['in_progress', 'completed'].map(status => ({
      id: 'deepseek-' + search.id, kind: 'web_search', phase: 'searching', status,
      detail: search.action.queries[0],
    })));
  });

  it('recovers completed provider metadata from the terminal choice and deduplicates displayed citations', () => {
    const web = new DeepSeekWebResults();
    const publish = vi.fn();
    const final = { finish_reason: 'stop', delta: {
      reasoning_content: 'private reasoning',
      server_tool_calls: [{ reasoning_content: 'private reasoning step', calls: [
        { ...search, status: 'completed', sources: [{ type: 'url', url: 'https://example.com/news', title: '新闻' }] },
        { id: 'srvtoolu_open_00_fixture', type: 'deepseek_web_search', status: 'completed',
          action: { type: 'open_page', url: 'https://example.com/page?private=one' },
          page: { url: 'https://example.com/page', title: '页面' }, signature: 'private signature' },
      ] }],
      annotations: [
        { type: 'url_citation', url_citation: { url: 'https://example.com/page#section', title: '重复引用' } },
        { type: 'url_citation', url_citation: { url: 'https://example.com/cited', title: '引用' } },
        { type: 'url_citation', url_citation: { url: 'file:///private.txt', title: '不安全链接' } },
        { type: 'unknown', url_citation: { url: 'https://example.com/unknown', title: '未知类型' } },
      ],
    } };
    expect(web.ingest(final, publish)).toBe(true);
    expect(web.ingest(final, publish)).toBe(false);
    expect(web.completedSearch).toBe(true);
    expect([...web.sources.values()]).toEqual([
      { url: 'https://example.com/news', title: '新闻' },
      { url: 'https://example.com/page', title: '页面' },
      { url: 'https://example.com/cited', title: '引用' },
    ]);
    expect(publish.mock.calls.flat()).toEqual([
      { id: 'deepseek-' + search.id, kind: 'web_search', phase: 'searching', status: 'completed', detail: search.action.queries[0] },
      { id: 'deepseek-srvtoolu_open_00_fixture', kind: 'open_page', phase: 'reading', status: 'completed',
        detail: 'example.com/page', url: 'https://example.com/page' },
    ]);
  });

  it('does not verify failed searches, reasoning text or links read directly', () => {
    const web = new DeepSeekWebResults();
    const publish = vi.fn();
    const read = { id: 'srvtoolu_rl_00_fixture', type: 'deepseek_read_url', status: 'completed',
      action: { type: 'read_link' }, page: { url: 'https://example.com/read' } };
    const failed = { ...search, status: 'failed', sources: [{ type: 'url', url: 'https://example.com/failed' }] };
    expect(web.ingest({ delta: { reasoning_content: '已联网并成功搜索 https://example.com/guessed' } }, publish)).toBe(false);
    expect(web.ingest({ delta: { server_tool_calls: [{ calls: [failed, read] }] } }, publish)).toBe(false);
    expect(web.ingest({ server_tool_event: { type: 'call_started', call: search } }, publish)).toBe(false);
    expect(web.completedSearch).toBe(false);
    expect([...web.sources.keys()]).toEqual([]);
    expect(publish.mock.calls.flat()).toEqual([
      { id: 'deepseek-' + search.id, kind: 'web_search', phase: 'searching', status: 'failed', detail: search.action.queries[0] },
    ]);
  });

  it('updates the same action with actual page metadata, keeping patterns and rejecting unsafe links', () => {
    const web = new DeepSeekWebResults();
    const publish = vi.fn();
    const call = { id: 'find-pattern', type: 'deepseek_web_search',
      action: { type: 'find_in_page', pattern: 'context window', url: 'https://example.com/docs?tracking=private#limits' } };
    web.ingest({ server_tool_event: { type: 'call_started', call } }, publish);
    web.ingest({ server_tool_event: { type: 'call_completed', call: { id: call.id, status: 'completed' } } }, publish);
    const expected = { id: 'deepseek-find-pattern', kind: 'find_in_page', phase: 'reading',
      detail: 'context window', url: 'https://example.com/docs' };
    expect(publish.mock.calls.flat()).toEqual(['in_progress', 'completed'].map(status => ({ ...expected, status })));
    expect(JSON.stringify(publish.mock.calls)).not.toContain('tracking');

    web.ingest({ server_tool_event: { type: 'call_started', call: {
      id: 'read-later', type: 'deepseek_web_search', action: { type: 'open_page' },
    } } }, publish);
    web.ingest({ server_tool_event: { type: 'call_completed', call: {
      id: 'read-later', status: 'completed', page: { url: 'https://example.com/manual', title: 'Manual' },
    } } }, publish);
    expect(publish.mock.calls.at(-1)?.[0]).toMatchObject({ detail: 'example.com/manual', url: 'https://example.com/manual' });
    web.ingest({ server_tool_event: { type: 'call_started', call: {
      id: 'unsafe', type: 'deepseek_web_search', action: { type: 'open_page', url: 'https://secret:password@example.com/' },
    } } }, publish);
    expect(publish.mock.calls.at(-1)?.[0]).not.toHaveProperty('url');
    expect(JSON.stringify(publish.mock.calls)).not.toMatch(/secret|password/);
  });
});
