import { useLayoutEffect, useId, useRef, useState } from 'react';
import { t } from '../i18n';
import type { ChatMessage } from '../services/preparation';
import { ChevronDown, ChevronUp } from './icons';
import { Button } from './ui/button';

export function UserMessage({ message }: { message: ChatMessage }) {
  const text = useRef<HTMLParagraphElement>(null);
  const textId = useId();
  const [expanded, setExpanded] = useState(false);
  const [overflow, setOverflow] = useState(false);
  useLayoutEffect(() => {
    const node = text.current!;
    const measure = () => {
      if (!node.getClientRects().length) return;
      const fullHeight = node.scrollHeight;
      const collapsedHeight = parseFloat(getComputedStyle(node).lineHeight) * 20;
      node.style.setProperty('--user-message-full-height', `${fullHeight}px`);
      setOverflow(fullHeight > Math.ceil(collapsedHeight));
    };
    const resize = new ResizeObserver(measure);
    resize.observe(node);
    document.fonts.addEventListener('loadingdone', measure);
    measure();
    return () => {
      resize.disconnect();
      document.fonts.removeEventListener('loadingdone', measure);
    };
  }, [message.content]);
  return (
    <div className="user-bubble" data-expanded={expanded}>
      <p className="user-message-text" id={textId} ref={text}>
        {message.content}
      </p>
      {overflow && (
        <>
          {!expanded && (
            <span className="user-message-ellipsis" aria-hidden="true">
              ...
            </span>
          )}
          <Button
            variant="ghost"
            className="user-message-toggle"
            data-reveal-on-hover
            aria-expanded={expanded}
            aria-controls={textId}
            onClick={() => setExpanded((value) => !value)}
          >
            {t(expanded ? '收起' : '显示更多')}
            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </Button>
        </>
      )}
      {!!message.options?.attachments.length && (
        <div className="message-options">
          {message.options.attachments.map((item) => (
            <span key={item.id}>
              {t('附件：')}
              {item.name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
