import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface TextNode {
  type: string;
  value?: string;
  alt?: string;
  ordered?: boolean;
  start?: number | null;
  children?: TextNode[];
}

// Presentation only: original profile text and verified source metadata stay intact.
function nodeText(node: TextNode): string {
  const children = node.children ?? [];
  switch (node.type) {
    case 'html':
    case 'definition':
    case 'thematicBreak':
      return '';
    case 'break':
      return '\n';
    case 'image':
    case 'imageReference':
      return node.alt ?? '';
    case 'root':
    case 'blockquote':
    case 'listItem':
      return children.map(nodeText).join('\n\n');
    case 'list':
      return children
        .map(
          (child, index) =>
            `${node.ordered ? `${(node.start ?? 1) + index}.` : '•'} ${nodeText(child)}`,
        )
        .join('\n');
    case 'table':
      return children.map(nodeText).join('\n');
    case 'tableRow':
      return children.map(nodeText).join(' | ');
    case 'link':
    case 'linkReference': {
      const label = children.map(nodeText).join('');
      return /^(?:\d+|KB\d+|来源\s*\d*)$/i.test(label) ? '' : label;
    }
    default:
      return node.value ?? children.map(nodeText).join('');
  }
}

function plainText() {
  return (tree: TextNode) => {
    const value = nodeText(tree)
      .replace(/cite[^]*|【[^】]*†[^】]*】|\[(?:KB\d+|来源\s*\d+)\]/g, '')
      .replace(/\b(?:https?:\/\/|www\.)[^\s<>"'`\u3000-\u303f\uff00-\uffef\u4e00-\u9fff)]+/gi, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    tree.children = [{ type: 'paragraph', children: [{ type: 'text', value }] }];
  };
}

export function PlainTextContent({
  content,
  inline = false,
}: {
  content: string;
  inline?: boolean;
}) {
  const Tag = inline ? 'span' : 'div';
  return (
    <Tag className="plain-text-content">
      <Markdown
        remarkPlugins={[remarkGfm, plainText]}
        skipHtml
        components={{ p: ({ children }) => <>{children}</> }}
      >
        {content}
      </Markdown>
    </Tag>
  );
}
