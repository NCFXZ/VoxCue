import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { sourceFaviconURL } from '../../src/services/sourceFavicon';
import { sourceHost } from '../../src/services/markdown';
import { SourceLink } from '../../src/components/SourceLink';
import { ResponseProgress } from '../../src/components/ResponseProgress';
import { MarkdownContent } from '../../src/components/MarkdownContent';
import { useGeneralSettings } from '../../src/stores/generalSettings';

afterEach(() => useGeneralSettings.setState({ language: 'zh-CN' }));

describe('引用图标的固定图片来源', () => {
  it('只向固定服务发送规范hostname，不携带页面、查询、片段或端口', () => {
    const value = sourceFaviconURL(sourceHost('https://DOCS.Example.org:8443/private/page?secret=x#part'));
    expect(value).toBe('https://a.favicon.im/docs.example.org?throw-error-on-404=true');
    expect(sourceFaviconURL('Docs.Example.org.')).toBe(value);
    expect(sourceFaviconURL(sourceHost('https://例子.中国/path'))).toBe(
      'https://a.favicon.im/xn--fsqu00a.xn--fiqs8s?throw-error-on-404=true',
    );
  });

  it.each([
    '', 'localhost', 'foo.localhost', 'host.local', 'host.internal', 'host.lan',
    'home.arpa', 'router.home.arpa', 'host.test', 'host.invalid', '127.0.0.1',
    '192.168.1.1', '[::1]', 'https://example.org', '//example.org',
    'example.org:443', 'user@example.org', 'example.org/path', 'example.org?secret=x',
    'example.org#part', 'example.org%2Fpath', '-bad.example.org', 'bad-.example.org',
    'a..example.org', `${'a'.repeat(64)}.org`,
  ])('拒绝非法、IP或本地主机输入 %j', (host) => {
    expect(sourceFaviconURL(host)).toBeNull();
  });

  it('复用已有URL校验，非法来源和IP不产生图标外请求', () => {
    for (const url of [
      'file:///private/document', 'javascript:alert(1)',
      'https://user:password@example.org/path', 'https://2130706433/', 'https://[::1]/',
    ]) {
      const html = renderToStaticMarkup(<SourceLink url={url} title="合成来源" onError={() => {}} />);
      expect(html).not.toContain('<img');
    }
  });

  it('图标为固定尺寸的惰性装饰图片，不附加跨域读取要求或悬停提示', () => {
    const html = renderToStaticMarkup(
      <SourceLink url="https://docs.example.org/page?secret=x" title="文档" onError={() => {}} />,
    );
    expect(html).toContain('src="https://a.favicon.im/docs.example.org?throw-error-on-404=true"');
    expect(html).toContain('width="11" height="11"');
    expect(html).toContain('loading="lazy"');
    expect(html).toContain('decoding="async"');
    expect(html).toContain('referrerPolicy="no-referrer"');
    expect(html).toContain('alt=""');
    expect(html).not.toMatch(/crossorigin|title=/i);
  });

  it('CSP只给图片增加精确服务origin，未放开任意远程图片或连接', () => {
    const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
    const policy = html.match(/content="(default-src[^"]+)"/)![1];
    expect(policy.match(/img-src ([^;]+)/)![1].split(' ')).toEqual([
      "'self'", 'data:', 'https://a.favicon.im',
    ]);
    expect(policy.match(/connect-src ([^;]+)/)![1]).toBe(
      "'self' ws://127.0.0.1:* http://127.0.0.1:*",
    );
  });
});

describe('网页活动复用来源胶囊', () => {
  it.each(
    (['zh-CN', 'en'] as const).flatMap((language) =>
      (['open_page', 'find_in_page'] as const).map((kind) => ({ language, kind })),
    ),
  )('仅把实际网页活动的URL显示为域名：$language / $kind', ({ language, kind }) => {
    useGeneralSettings.setState({ language });
    const url = 'https://www.docs.example.org/private/guide?keep=yes#target';
    const message = {
      status: 'completed' as const,
      content: '',
      activities: [
        {
          id: 'read-page',
          kind,
          phase: 'reading' as const,
          status: 'completed' as const,
          detail: 'www.docs.example.org/private/guide',
          url,
        },
      ],
    };
    const original = JSON.stringify(message);
    const html = renderToStaticMarkup(<ResponseProgress message={message} />);
    expect(html).toContain('class="progress-link"><a class="chat-source-link"');
    expect(html).toContain(`href="${url}"`);
    expect(html).toContain('class="chat-source-label">docs.example.org</span>');
    expect(html).toContain(
      'src="https://a.favicon.im/www.docs.example.org?throw-error-on-404=true"',
    );
    expect(html).toContain('referrerPolicy="no-referrer"');
    expect(html).not.toContain('title=');
    expect(html.replace(/<[^>]+>/g, '')).not.toContain('/private/guide');
    expect(JSON.stringify(message)).toBe(original);

    const content = `保留原文 [完整网址](${url})`;
    const body = renderToStaticMarkup(<MarkdownContent content={content} />);
    expect(body).toContain(`href="${url}"`);
    expect(body).toContain('完整网址</a>');
    expect(body).not.toContain('chat-source-link');
  });

  it.each(['javascript:alert(1)', 'file:///private/guide', 'https://user:password@example.org/'])(
    '活动中的无效来源不产生可点击胶囊或图标请求：%s',
    (url) => {
      const html = renderToStaticMarkup(
        <ResponseProgress
          message={{
            content: '',
            status: 'completed',
            activities: [
              { id: 'invalid', kind: 'open_page', phase: 'reading', detail: '原活动文字', url },
            ],
          }}
        />,
      );
      expect(html).toContain('原活动文字');
      expect(html).not.toMatch(/<a[ >]|<button[ >]|<img[ >]/);
    },
  );
});
