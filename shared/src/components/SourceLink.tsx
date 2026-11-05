import { openChatLink } from '../services/chat';
import { sourceHost } from '../services/markdown';
import { sourceFaviconURL } from '../services/sourceFavicon';
import { useState } from 'react';
import { Globe } from './icons';
import './sourceLink.css';

const failedIcons = new Map<string, number>();

function SourceIcon({ host }: { host: string }) {
  const src = sourceFaviconURL(host);
  const [status, setStatus] = useState<'pending' | 'ready' | 'failed'>(() =>
    src && (failedIcons.get(src) ?? 0) > Date.now() ? 'failed' : 'pending',
  );
  return (
    <span className="chat-source-icon" aria-hidden="true" data-ready={status === 'ready'}>
      <Globe size={11} />
      {src && status !== 'failed' && (
        <img
          src={src}
          alt=""
          width={11}
          height={11}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onLoad={() => setStatus('ready')}
          onError={() => {
            // Avoid retrying a failed host on every streamed Markdown remount.
            failedIcons.set(src, Date.now() + 60_000);
            if (failedIcons.size > 128) failedIcons.delete(failedIcons.keys().next().value!);
            setStatus('failed');
          }}
        />
      )}
    </span>
  );
}

export function SourceLink({
  url,
  title,
  inline = false,
  onOpen,
  onError,
}: {
  url: string;
  title: string;
  inline?: boolean;
  onOpen?(): void;
  onError(): void;
}) {
  const host = sourceHost(url);
  if (!host) return <span>{title || url}</span>;
  const content = (
    <>
      <SourceIcon key={host} host={host} />
      <span className="chat-source-label">{host.replace(/^www\./, '')}</span>
    </>
  );
  const name = title && title !== host ? `${title} · ${host}` : host;
  function open() {
    onOpen?.();
    void openChatLink(url).catch(onError);
  }
  return inline ? (
    <a
      className="chat-source-link"
      href={url}
      aria-label={name}
      onClick={(event) => {
        event.preventDefault();
        open();
      }}
    >
      {content}
    </a>
  ) : (
    <button type="button" className="chat-source-link" aria-label={name} onClick={open}>
      {content}
    </button>
  );
}
