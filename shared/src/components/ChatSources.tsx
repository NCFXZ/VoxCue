import { t } from '../i18n';
import { useState } from 'react';
import type { ChatSource } from '../../electron/contracts/chat';
import { ChevronRight } from './icons';
import { SourceLink } from './SourceLink';

export function ChatSources({ sources }: { sources: ChatSource[] }) {
  const [error, setError] = useState(false);
  if (!sources.length) return null;
  const links = (items: ChatSource[]) =>
    items.map((source) => (
      <SourceLink
        key={source.url}
        url={source.url}
        title={source.title}
        onOpen={() => setError(false)}
        onError={() => setError(true)}
      />
    ));
  return (
    <div className="chat-source-group" aria-label={t('搜索来源')}>
      <div className="chat-sources">
        <span>{t('来源')}</span>
        {links(sources.slice(0, 3))}
      </div>
      {sources.length > 3 && (
        <details className="chat-source-more">
          <summary>
            {t('更多来源（{0}）', [sources.length - 3])}
            <span className="disclosure-chevron">
              <ChevronRight size={14} />
            </span>
          </summary>
          <div className="chat-sources">{links(sources.slice(3))}</div>
        </details>
      )}
      {error && (
        <small className="inline-error" role="alert">
          {t('无法打开来源链接。')}
        </small>
      )}
    </div>
  );
}
