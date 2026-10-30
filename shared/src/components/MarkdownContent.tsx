import { useState, useEffect, type ReactNode, type ReactElement } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
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
          aria-label="复制代码"
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
          {error ? '复制失败' : copied ? '已复制' : '复制代码'}
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
        remarkPlugins={[remarkGfm, readableStrong]}
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
          img: ({ alt }) => <span>{alt ? `[图片：${alt}]` : '[图片]'}</span>,
          table: ({ children }) => (
            <div className="markdown-table">
              <table>{children}</table>
            </div>
          ),
        }}
      >
        {content}
      </Markdown>
      {linkError && <small role="status">无法打开链接。</small>}
    </div>
  );
}
