import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { sourceFaviconURL } from '../../src/services/sourceFavicon';
import { sourceHost } from '../../src/services/markdown';
import { SourceLink } from '../../src/components/SourceLink';

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
