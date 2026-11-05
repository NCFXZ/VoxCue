import type { ReactNode } from 'react';
import { t } from '../i18n';
import { formatMessageTime } from '../services/messageTime';
import type { ChatMessage } from '../services/preparation';
import { Check, Copy } from './icons';
import { Button } from './ui/button';

export function ChatMessageActions({
  message,
  timestamp,
  copied,
  onCopied,
  children,
}: {
  message: ChatMessage;
  timestamp?: number;
  copied: string | null;
  onCopied(id: string | null): void;
  children?: ReactNode;
}) {
  const value =
    message.role === 'assistant' && !message.content.trim() ? null : formatMessageTime(timestamp);
  const time = value && (
    <time className="chat-message-time" dateTime={value.dateTime}>
      {t(value.text)}
    </time>
  );
  if (!message.content && !children && !time) return null;
  return (
    <div className="chat-message-actions">
      {children}
      {message.role === 'user' && time}
      {message.content && (
        <Button
          variant="ghost"
          className="chat-copy"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(message.content);
              onCopied(message.id);
            } catch {
              onCopied(null);
            }
          }}
        >
          {copied === message.id ? <Check size={13} /> : <Copy size={13} />}
          {copied === message.id ? t('已复制') : t('复制')}
        </Button>
      )}
      {message.role === 'assistant' && time}
    </div>
  );
}
