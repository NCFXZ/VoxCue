import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MarkdownContent } from '../src/components/MarkdownContent';
describe('Markdown 回答', () => {
  it('渲染粗体、行内代码、代码块、列表和表格', () => {
    const html = renderToStaticMarkup(
      <MarkdownContent
        content={
          '**粗体**，`inline`\n\n```python\nprint("Hello")\n```\n\n1. 第一步\n2. 第二步\n\n|字段|内容|\n|---|---|\n|姓名|示例|'
        }
      />,
    );
    expect(html).toContain('<strong>粗体</strong>');
    expect(html).toContain('<code>inline</code>');
    expect(html).toContain('language-python');
    expect(html).toContain('复制代码');
    expect(html).toContain('<ol>');
    expect(html).toContain('<table>');
    expect(html).not.toContain('```');
  });
  it('支持未闭合的流式代码块，不执行 HTML 或危险链接', () => {
    const html = renderToStaticMarkup(<MarkdownContent content={'```python\nprint(1)'} />);
    expect(html).toContain('<pre>');
    const unsafe = renderToStaticMarkup(
      <MarkdownContent
        content={
          '<script>alert(1)</script>\n\n[链接](javascript:alert)\n\n![图片](https://example.org/tracker.png)'
        }
      />,
    );
    expect(unsafe).not.toContain('<script');
    expect(unsafe).not.toContain('javascript:');
    expect(unsafe).not.toContain('<img');
  });
});
