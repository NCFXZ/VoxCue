import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PreparationMessage } from '../../src/components/PreparationMessage';
import { ResponseProgress } from '../../src/components/ResponseProgress';
import type { ChatMessage } from '../../src/services/preparation';
import { useGeneralSettings } from '../../src/stores/generalSettings';
import type { ChatActivity } from '../../electron/contracts/chat';

const originalLanguage = useGeneralSettings.getState().language;
beforeEach(() => useGeneralSettings.setState({ language: 'zh-CN' }));
afterEach(() => useGeneralSettings.setState({ language: originalLanguage }));

const activities: ChatActivity[] = [
  { id: 'search', kind: 'web_search', phase: 'searching', status: 'completed' },
  { id: 'writing', kind: 'status', phase: 'writing', status: 'completed' },
];

it.each(['failed', 'stopped'] as const)('keeps completed activity without claiming an answer on %s', status => {
  const html = renderToStaticMarkup(<ResponseProgress message={{
    mode: 'live', status, content: ' \t', durationMs: 2000, activities,
  }} />);
  expect(html).toContain('已处理 2 秒');
  expect(html).toContain('已搜索网页');
  expect(html).not.toContain('已生成回答');
  expect(html).not.toContain('data-phase="writing"');
});

it('keeps the writing phase for active and completed answers', () => {
  const streaming = renderToStaticMarkup(<ResponseProgress message={{
    mode: 'live', status: 'streaming', content: '', startedAt: Date.now(),
    activities: [{ id: 'writing', kind: 'status', phase: 'writing', status: 'in_progress' }],
  }} />);
  expect(streaming).toContain('正在生成回答');

  const completed = renderToStaticMarkup(<ResponseProgress message={{
    mode: 'live', status: 'completed', content: '实际回答', durationMs: 2000, activities,
  }} />);
  expect(completed).toContain('已生成回答');
});

it('shows explicit proposal generation beside a streamed answer while no fields are available', () => {
  const reply: ChatMessage = {
    id: 'deepseek-proposal',
    role: 'assistant',
    provider: 'deepseek',
    mode: 'live',
    status: 'streaming',
    content: '已收到本轮回答。',
    profilePreview: {},
  };
  const markup = (message: ChatMessage) => renderToStaticMarkup(
    <PreparationMessage message={message} copied={null} onCopied={vi.fn()} onRetry={vi.fn()} />,
  );

  const generating = markup({ ...reply, profileGeneration: { fields: ['skills'], skillIndexes: [] } });
  expect(generating).toContain(reply.content);
  expect(generating).toContain('正在生成资料提案…');
  expect(generating).not.toContain('保存所选');
  expect(generating).not.toContain('共 0 项');
  expect(markup(reply)).not.toContain('正在生成资料提案…');
  expect(markup({ ...reply, profileGeneration: { fields: [], skillIndexes: [] } })).not.toContain('正在生成资料提案…');
});

it('shows local retrieval once and preserves a specific retrieval failure', () => {
  const message = { mode: 'live' as const, status: 'streaming' as const, content: '', activities: [{
    id: 'local-retrieval', kind: 'knowledge' as const, phase: 'thinking' as const,
    status: 'in_progress' as const, detail: '检索本地资料',
  }] };
  const html = renderToStaticMarkup(<ResponseProgress message={message} />);
  expect(html).toContain('正在查询本地资料');
  expect(html).not.toContain('检索本地资料');
  expect(html).not.toContain('正在思考');
  expect(html).not.toContain('progress-detail');
  const failed = renderToStaticMarkup(<ResponseProgress message={{ ...message, activities: [{
    ...message.activities[0], status: 'failed', detail: '本地资料未完整取得，继续回答',
  }] }} />);
  expect(failed).toContain('查询本地资料 · 失败');
  expect(failed).toContain('本地资料未完整取得，继续回答');
});

it.each(['searching', 'reading', 'organizing'] as const)('does not label %s as thinking', phase => {
  const html = renderToStaticMarkup(<ResponseProgress message={{ mode: 'live', status: 'streaming',
    content: '', startedAt: Date.now(), activities: [{ id: 'phase', kind: 'status', phase, status: 'in_progress' }],
  }} />);
  expect(html).toContain('用时 0 秒');
  expect(html).not.toContain('正在思考');
});

it('shows a real retry as answer recovery and removes unfinished phase labels after failure', () => {
  const activity: ChatActivity = { id: 'retry-waiting', kind: 'status', phase: 'waiting',
    status: 'in_progress', detail: '正在重新生成回答' };
  const message = { mode: 'live' as const, status: 'streaming' as const, content: '', activities: [activity] };
  expect(renderToStaticMarkup(<ResponseProgress message={message} />)).toContain('正在重新生成回答');
  const failed = renderToStaticMarkup(<ResponseProgress message={{ ...message, status: 'failed' }} />);
  expect(failed).not.toContain('正在重新生成回答');
  expect(failed).not.toContain('正在思考');
});

it('shows the actual page search phrase as visible text beside its source link', () => {
  const html = renderToStaticMarkup(<ResponseProgress message={{ mode: 'live', status: 'streaming', content: '',
    activities: [{ id: 'find', kind: 'find_in_page', phase: 'reading', status: 'in_progress',
      detail: 'server_tool_event', url: 'https://api-docs.deepseek.com/guides/web_tools/' }],
  }} />);
  expect(html).toContain('<span class="progress-detail">server_tool_event</span>');
  expect(html).toContain('正在查找网页内容');
  expect(html).toContain('href="https://api-docs.deepseek.com/guides/web_tools/"');
});
