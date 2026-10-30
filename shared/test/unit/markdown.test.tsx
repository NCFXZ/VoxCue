import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MarkdownContent } from '../../../shared/src/components/MarkdownContent';
describe('Markdown 回答', () => {
  it('支持中文标点紧邻后文及模型在粗体末尾留下的空格，原正文不改写', () => {
    const html = renderToStaticMarkup(
      <MarkdownContent
        content={
          '我查到了。**已核实的 JD。**下面分别说明。\n\n- **岗位名称： **产品测试工程师。\n- **专业要求： **电子工程、自动化。'
        }
      />,
    );
    expect(html).toContain('<strong>已核实的 JD。</strong>下面');
    expect(html).toContain('<strong>岗位名称： </strong>产品测试工程师');
    expect(html).toContain('<strong>专业要求： </strong>电子工程');
    expect(html).not.toContain('**');
  });
  it('不把转义星号、代码或普通乘方表达式修补为粗体', () => {
    const html = renderToStaticMarkup(
      <MarkdownContent
        content={
          '\\*\\*中文标记。\\*\\*原样\n\n`**中文代码。**`\n\n```text\n**代码： **保持\n```\n\n2 ** 3 ** 4'
        }
      />,
    );
    expect(html).not.toContain('<strong>');
    expect(html).toContain('**中文标记。**原样');
    expect(html).toContain('<code>**中文代码。**</code>');
    expect(html).toContain('2 ** 3 ** 4');
  });
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
