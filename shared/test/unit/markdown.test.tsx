import { beforeEach, describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MarkdownContent } from '../../../shared/src/components/MarkdownContent';
import { normalizeMath } from '../../../shared/src/services/math';
import { useGeneralSettings } from '../../src/stores/generalSettings';
beforeEach(() => useGeneralSettings.setState({ language: 'zh-CN' }));
describe('Markdown 回答', () => {
  it('不接受原型继承的信任或宏，恶意公式不创建链接或远程资源', () => {
    const keys = ['trust', 'voxcueInjected'];
    const originals = keys.map((key) => Object.getOwnPropertyDescriptor(Object.prototype, key));
    try {
      Object.defineProperty(Object.prototype, 'trust', { value: true, configurable: true });
      Object.defineProperty(Object.prototype, 'voxcueInjected', {
        value: '\\href{https://example.org/tracker}{inherited}',
        configurable: true,
      });
      const html = renderToStaticMarkup(
        <MarkdownContent
          content={String.raw`$\voxcueInjected$ $\href{javascript:alert(1)}{click}$ $\includegraphics{https://example.org/tracker.png}$`}
        />,
      );
      expect(html).not.toMatch(/<(?:a|img|iframe|script)[ >]/);
      expect(html).not.toContain('href=');
      expect(html).not.toContain('src=');
    } finally {
      keys.forEach((key, index) => {
        if (originals[index]) Object.defineProperty(Object.prototype, key, originals[index]!);
        else Reflect.deleteProperty(Object.prototype, key);
      });
    }
  });
  it('大段未闭合公式保持原文并在有界时间内处理', () => {
    const content = String.raw`\(\[`.repeat(15000);
    const started = performance.now();
    expect(normalizeMath(content)).toBe(content);
    expect(performance.now() - started).toBeLessThan(1000);
  });
  it('渲染两种行内公式及包含矩阵的独立公式，不把等号变成标题', () => {
    const html = renderToStaticMarkup(
      <MarkdownContent
        content={String.raw`结果：\(m\times n\)，以及 $x^2$。

\[
\begin{bmatrix}1&2\\3&4\end{bmatrix}
=
\begin{bmatrix}19&22\\43&50\end{bmatrix}
\]

$$\frac{a}{b}$$`}
      />,
    );
    expect(html.match(/class="katex"/g)).toHaveLength(4);
    expect(html.match(/class="katex-display"/g)).toHaveLength(2);
    expect(html).toContain('<mtable');
    expect(html).toContain('<mfrac>');
    expect(html).not.toContain('<h2');
    expect(html).not.toContain('katex-error');
  });
  it('代码和转义分隔符保持原样，公式不启用 HTML、外链或远程图片', () => {
    const html = renderToStaticMarkup(
      <MarkdownContent
        content={[
          '`\\(x\\)`',
          '```tex\n\\[x^2\\]\n$$a$$\n```',
          '    \\(y\\)',
          String.raw`\\(z\\)`,
          String.raw`$\href{javascript:alert(1)}{click}$`,
          String.raw`$\includegraphics{https://example.org/tracker.png}$`,
          String.raw`$\htmlClass{injected}{x}$`,
        ].join('\n\n')}
      />,
    );
    expect(html).toContain('<code>\\(x\\)</code>');
    expect(html).toContain('\\[x^2\\]\n$$a$$');
    expect(html).toContain('\\(y\\)');
    expect(html).not.toMatch(/<a[ >]/);
    expect(html).not.toContain('<img');
    expect(html).not.toContain('class="injected"');
  });
  it('流式残缺或无效公式不崩溃、不出现错误悬浮提示，完成后正常渲染', () => {
    for (const content of [
      String.raw`\[\frac{1}{`,
      '$$\n\\badcommand{',
      String.raw`\(x`,
      '```tex\n\\(x\\)',
    ]) {
      const html = renderToStaticMarkup(<MarkdownContent content={content} />);
      expect(html).not.toContain('title=');
      expect(html).toContain('markdown-content');
    }
    const html = renderToStaticMarkup(<MarkdownContent content={String.raw`\[\frac{1}{2}\]`} />);
    expect(html).toContain('<mfrac>');
    expect(html).not.toContain('katex-error');
  });
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
