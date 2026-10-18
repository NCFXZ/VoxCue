import { useState } from 'react';
import type { ChatSource } from '../../electron/contracts/chat';
import { openChatLink } from '../services/chat';
import { ChevronRight, Link } from './icons';

export function ChatSources({ sources }: { sources: ChatSource[] }) {
  const [error, setError] = useState(false);
  if (!sources.length) return null;
  const links = (items: ChatSource[], offset = 0) =>
    items.map((source, index) => (
      <button
        key={source.url}
        onClick={() => {
          setError(false);
          void openChatLink(source.url).catch(() => setError(true));
        }}
      >
        <Link size={13} />
        <span>
          {offset + index + 1}. {source.title}
        </span>
      </button>
    ));
  return (
    <div className="chat-source-group" aria-label="搜索来源">
      <div className="chat-sources">
        <span>来源</span>
        {links(sources.slice(0, 3))}
      </div>
      {sources.length > 3 && (
        <details className="chat-source-more">
          <summary>
            更多来源（{sources.length - 3}）
            <span className="disclosure-chevron">
              <ChevronRight size={14} />
            </span>
          </summary>
          <div className="chat-sources">{links(sources.slice(3), 3)}</div>
        </details>
      )}
      {error && (
        <small className="inline-error" role="alert">
          无法打开来源链接。
        </small>
      )}
    </div>
  );
}
