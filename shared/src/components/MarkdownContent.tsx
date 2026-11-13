import { t } from '../i18n';
import { useState, useEffect, useMemo, type ReactNode, type ReactElement } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { normalizeMath, mathPresentation } from '../services/math';
import 'katex/dist/katex.min.css';
import {
  readableStrong,
  compactCitations,
  indexChatSources,
} from '../services/markdown';
import type { ChatSource } from '../../electron/contracts/chat';
import { SourceLink } from './SourceLink';
import { openChatLink } from '../services/chat';
import { Button } from './ui/button';
import { Copy, Check } from './icons';

const emptySources: readonly ChatSource[] = [];

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
export function MarkdownContent({
  content,
  sources = emptySources,
  streaming = false,
}: {
  content: string;
  sources?: readonly ChatSource[];
  streaming?: boolean;
}) {
  const [linkError, setLinkError] = useState(false);
  const sourceIndex = useMemo(() => indexChatSources(sources), [sources]);
  return (
    <div className="markdown-content">
      <Markdown
        remarkPlugins={[remarkGfm, remarkMath, readableStrong, [compactCitations, sourceIndex, streaming]]}
        rehypePlugins={[
          [rehypeKatex, { trust: false, strict: 'ignore', maxExpand: 1000, maxSize: 20 }],
          mathPresentation,
        ]}
        skipHtml
        components={{
          pre: CodeBlock,
          a: ({ href, children, node }) => {
            if (href?.startsWith('#')) return <a href={href}>{children}</a>;
            if (!href || !/^https?:\/\//i.test(href)) return <span>{children}</span>;
            const citation = node?.properties['data-citation'];
            if (citation === 'confirmed' || citation === 'pending')
              return (
                <SourceLink
                  url={href}
                  title={sourceIndex.get(new URL(href).href)?.title ?? ''}
                  showFavicon={citation === 'confirmed'}
                  inline
                  onError={() => setLinkError(true)}
                />
              );
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
