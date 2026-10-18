import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { PlainTextContent } from '../../../shared/src/components/PlainTextContent';

describe('技能纯文字展示', () => {
  it('将已有Markdown、链接和代码显示为文字，保留事实与段落，不改变原文', () => {
    const content =
      '# 控制边界\n\n**延迟37毫秒**，数组[1]不变。\n\n' +
      '- [静态类型](https://example.test/types)与运行时校验\n' +
      '- https://example.test/source\n\n' +
      '```ts\nconst limit = 128;\n```\n\n[KB1] citeturn1search0';
    const original = content;
    const html = renderToStaticMarkup(<PlainTextContent content={content} />);
    expect(html).toContain('延迟37毫秒');
    expect(html).toContain('数组[1]不变');
    expect(html).toContain('静态类型与运行时校验');
    expect(html).toContain('const limit = 128;');
    expect(html).toContain('\n');
    expect(html).not.toMatch(/<a\b|<strong\b|<h1\b|<code\b|https?:|\*\*|KB1|cite/);
    expect(content).toBe(original);
  });
  it('标题仅呈现行内文字，图片与HTML不加载，普通数字引用不误删', () => {
    const html = renderToStaticMarkup(
      <h4>
        <PlainTextContent
          inline
          content={
            '[类型边界](https://example.test) [1](https://example.test/ref)\n\n![图](https://example.test/image)\n\n<script>bad()</script>'
          }
        />
      </h4>,
    );
    expect(html).toContain('类型边界');
    expect(html).toContain('图');
    expect(html).not.toMatch(/<p\b|<img\b|<script\b|<a\b|https?:|bad\(\)/);
  });
});
