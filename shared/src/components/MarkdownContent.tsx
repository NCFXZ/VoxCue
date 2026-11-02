import { t } from '../i18n';
import { useState, useEffect, type ReactNode, type ReactElement } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { normalizeMath, mathPresentation } from '../services/math';
import 'katex/dist/katex.min.css';
import { readableStrong } from '../services/markdown';
import { openChatLink } from '../services/chat';
import { Button } from './ui/button';
import { Copy, Check } from './icons';

function CodeBlock({ children }: { children?: ReactNode }) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(false);
  const code = children as ReactElement<{ children?: ReactNode; className?: string }>;
  const text =
    typeof code?.props?.children === 'string' ? code.props.children.replace(/\n$/, '') : '';
  const language = code?.props?.className?.match(/language-([\w+-]+)/)?.[1] ?? 'text';
  useEffect(() => {
    setCopied(false);
    setError(false);
  }, [text]);
  return (
    <div className="markdown-code-block">
      <header>
        <span>{language}</span>
        <Button
          type="button"
          variant="ghost"
          aria-label={t('复制代码')}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(text);
              setCopied(true);
              setError(false);
            } catch {
              setError(true);
            }
          }}
        >
          {copied ? <Check size={13} /> : <Copy size={13} />}
          {error ? t('复制失败') : copied ? t('已复制') : t('复制代码')}
        </Button>
      </header>
      <pre>{children}</pre>
    </div>
  );
}
export function MarkdownContent({ content }: { content: string }) {
  const [linkError, setLinkError] = useState(false);
  return (
    <div className="markdown-content">
      <Markdown
        remarkPlugins={[remarkGfm, remarkMath, readableStrong]}
        rehypePlugins={[
          [rehypeKatex, { trust: false, strict: 'ignore', maxExpand: 1000, maxSize: 20 }],
          mathPresentation,
        ]}
        skipHtml
        components={{
          pre: CodeBlock,
          a: ({ href, children }) => {
            if (href?.startsWith('#')) return <a href={href}>{children}</a>;
            if (!href || !/^https?:\/\//i.test(href)) return <span>{children}</span>;
            return (
              <a
                href={href}
                onClick={(event) => {
                  event.preventDefault();
                  void openChatLink(href).catch(() => setLinkError(true));
                }}
              >
                {children}
              </a>
            );
          },
          img: ({ alt }) => <span>{alt ? t('[图片：{0}]', [alt]) : t('[图片]')}</span>,
          table: ({ children }) => (
            <div className="markdown-table">
              <table>{children}</table>
            </div>
          ),
        }}
      >
        {normalizeMath(content)}
      </Markdown>
      {linkError && <small role="status">{t('无法打开链接。')}</small>}
    </div>
  );
}
