import { afterEach, beforeEach, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { GoogleSearchSuggestions } from '../../src/components/GoogleSearchSuggestions';
import { ChatSources } from '../../src/components/ChatSources';
import { PreparationMessage } from '../../src/components/PreparationMessage';
import { useGeneralSettings } from '../../src/stores/generalSettings';

const originalLanguage = useGeneralSettings.getState().language;
beforeEach(() => useGeneralSettings.setState({ language: 'zh-CN' }));
afterEach(() => useGeneralSettings.setState({ language: originalLanguage }));

it.each([
  ['zh-CN', 'Google 搜索建议'],
  ['en', 'Google Search suggestions'],
] as const)('labels the isolated Google suggestions in %s', (language, title) => {
  useGeneralSettings.setState({ language });
  const html = renderToStaticMarkup(<GoogleSearchSuggestions html="<div>Google</div>" />);
  expect(html).toContain(`title="${title}"`);
  expect(html).toContain('sandbox="allow-same-origin"');
  expect(html).not.toContain('allow-scripts');
  expect(html).not.toContain('allow-top-navigation');
  expect(html).not.toContain('allow-popups');
});

it('keeps the original snippet inside the isolated document with network and script restrictions', () => {
  const snippet = '<style>.search{color:red}</style><div class="search"><a href="https://www.google.com/search?q=fixture">Google</a></div><script>window.parent.fixture=true</script>';
  const html = renderToStaticMarkup(<GoogleSearchSuggestions html={snippet} />);
  const escaped = snippet.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll("'", '&#x27;')
    .replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  expect(html).toContain(escaped);
  expect(html).not.toContain('<script>');
  expect(html).toContain('default-src &#x27;none&#x27;');
  expect(html).toContain('base-uri &#x27;none&#x27;');
  expect(html).toContain('form-action &#x27;none&#x27;');
  expect(html).toContain('referrerPolicy="no-referrer"');
});

it('shows required Google suggestions when no source links were returned', () => {
  const html = renderToStaticMarkup(
    <ChatSources sources={[]} googleSearchSuggestions="<style>.required{padding:8px}</style><div class='required'>Original Google suggestions</div>" />,
  );
  expect(html).toContain('class="chat-source-group"');
  expect(html).toContain('Original Google suggestions');
  expect(html).toContain('.required{padding:8px}');
  expect(html).toContain('title="Google 搜索建议"');
  expect(html).not.toContain('class="chat-sources"');
  expect(renderToStaticMarkup(<ChatSources sources={[]} />)).toBe('');
});

it('keeps Google suggestions visible while extra source links stay collapsed', () => {
  const sources = Array.from({ length: 4 }, (_, index) => ({
    title: 'Source ' + index, url: `https://example.org/source-${index}`,
  }));
  const html = renderToStaticMarkup(
    <ChatSources sources={sources} googleSearchSuggestions="<div>Original Google suggestions</div>" />,
  );
  const more = html.match(/<details\b[^>]*>[\s\S]*?<\/details>/)?.[0];
  expect(more).toBeTruthy();
  expect(more).not.toMatch(/<details[^>]*\bopen/);
  expect(more).toContain('Source 3');
  expect(more).not.toContain('<iframe');
  expect(html.indexOf('<iframe')).toBeLessThan(html.indexOf('<details'));
  expect(html.match(/<iframe\b/g)).toHaveLength(1);
  expect(html).toContain('Original Google suggestions');
});

it('places Google suggestions directly below response progress before source links and the answer', () => {
  const html = renderToStaticMarkup(
    <PreparationMessage
      message={{ id: 'gemini-preview', role: 'assistant', provider: 'gemini', status: 'completed', durationMs: 5000,
        content: 'Grounded answer text', sources: [{ title: 'Verified source', url: 'https://example.org/' }],
        googleSearchSuggestions: '<div>Original Google suggestions</div>' }}
      copied={null} onCopied={() => {}} onRetry={async () => {}}
    />,
  );
  const progress = html.indexOf('class="response-progress');
  const group = html.indexOf('class="chat-source-group"');
  const widget = html.indexOf('<iframe');
  const sourceLinks = html.indexOf('class="chat-sources"');
  const answer = html.indexOf('class="chat-answer"');
  expect(progress).toBeGreaterThan(-1);
  expect(html).toContain('data-has-answer="true"');
  expect(group).toBeGreaterThan(progress);
  expect(widget).toBeGreaterThan(group);
  expect(sourceLinks).toBeGreaterThan(widget);
  expect(answer).toBeGreaterThan(sourceLinks);
  expect(html.match(/<iframe\b/g)).toHaveLength(1);
  expect(html).toContain('Verified source');
  expect(html).toContain('Grounded answer text');
});
