import { InterviewReveal } from './InterviewReveal';
import { t } from '../i18n';
import { cloneElement, createContext, memo, useContext, useState, useEffect, useMemo, type ReactNode, type ReactElement } from 'react';
import { useGeneralSettings } from '../stores/generalSettings';
import { useStreamingMarkdown } from '../lib/useStreamingMarkdown';
import Markdown, { type Components, type ExtraProps } from 'react-markdown';
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

interface CaretNode {
  type: string;
  tagName?: string;
  value?: string;
  children?: CaretNode[];
  properties?: Record<string, unknown>;
}

// Insert into the final inline formatting context, keeping table/list markup
// intact. The empty decoration never becomes part of the source or copied text.
function streamingCaret() {
  return (root: CaretNode) => {
    const caret: CaretNode = { type: 'element', tagName: 'span', properties: { className: ['typing-caret'], ariaHidden: true }, children: [] };
    const place = (node: CaretNode): boolean => {
      if (node.tagName === 'pre') {
        node.properties = { ...node.properties, 'data-streaming-caret': true };
        return true;
      }
      const children = node.children ?? [];
      if (Array.isArray(node.properties?.className) && node.properties.className.includes('katex-html')) {
        children.push(caret);
        return true;
      }
      for (let index = children.length - 1; index >= 0; index--) {
        const child = children[index];
        if (child.type === 'text' && child.value?.trim()) {
          const text = child.value.trimEnd();
          const suffix = child.value.slice(text.length);
          child.value = text;
          children.splice(index + 1, 0, caret, ...(suffix ? [{ type: 'text', value: suffix }] : []));
          return true;
        }
        // These are rendered as one inline item, sometimes by a custom component.
        if (child.tagName && ['a', 'code', 'img', 'input'].includes(child.tagName)) {
          children.splice(index + 1, 0, caret);
          return true;
        }
        if (child.type === 'element' && place(child)) return true;
      }
      return false;
    };
    if (!place(root)) root.children?.push(caret);
  };
}

function CodeBlock({ children, node }: { children?: ReactNode } & ExtraProps) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(false);
  const code = children as ReactElement<{ children?: ReactNode; className?: string }>;
  const source = typeof code?.props?.children === 'string' ? code.props.children : '';
  const text = source.replace(/\n$/, '');
  const showCaret = node?.properties['data-streaming-caret'] === true;
  const end = showCaret ? source.trimEnd().length : 0;
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
      <pre>{showCaret ? cloneElement(code, undefined, source.slice(0, end),
        <span className="typing-caret" aria-hidden="true" />, source.slice(end)) : children}</pre>
    </div>
  );
}

const MarkdownLinks = createContext<{
  sourceIndex: ReadonlyMap<string, ChatSource>;
  reportLinkError(): void;
} | null>(null);

// Keep renderer component identities stable as more Markdown and citations arrive.
const markdownComponents: Components = {
  pre: CodeBlock,
  a: function MarkdownLink({ href, children, node }) {
    const { sourceIndex, reportLinkError } = useContext(MarkdownLinks)!;
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
          onError={reportLinkError}
        />
      );
    return (
      <a href={href} onClick={(event) => {
        event.preventDefault();
        void openChatLink(href).catch(reportLinkError);
      }}>
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
};

type MarkdownProps = {
  content: string;
  sources?: readonly ChatSource[];
  streaming?: boolean;
  showCaret?: boolean;
};
export function MarkdownContent({ content, sources, streaming = false, paceUpdates = streaming, showCaret }: MarkdownProps & { paceUpdates?: boolean }) {
  const visible = useStreamingMarkdown(content, paceUpdates);
  return <MarkdownBody content={visible} sources={sources} streaming={streaming} showCaret={showCaret} />;
}

const MarkdownBody = memo(function MarkdownBody({ content, sources = emptySources, streaming = false, showCaret }: MarkdownProps) {
  useGeneralSettings(state => state.language);
  const [linkError, setLinkError] = useState(false);
  const links = useMemo(() => ({
    sourceIndex: indexChatSources(sources),
    reportLinkError: () => setLinkError(true),
  }), [sources]);
  return (
    <div className="markdown-content">
      <MarkdownLinks.Provider value={links}>
        <Markdown
          remarkPlugins={[remarkGfm, remarkMath, readableStrong, [compactCitations, links.sourceIndex, streaming]]}
          rehypePlugins={[
            [rehypeKatex, { trust: false, strict: 'ignore', maxExpand: 1000, maxSize: 20 }],
            mathPresentation,
            ...(showCaret ? [streamingCaret] : []),
          ]}
          skipHtml
          components={markdownComponents}
        >
          {normalizeMath(content)}
        </Markdown>
      </MarkdownLinks.Provider>
      <InterviewReveal>
        {linkError ? <small role="status">{t('无法打开链接。')}</small> : null}
      </InterviewReveal>
    </div>
  );
});
