import { InterviewReveal } from './InterviewReveal';
import { memo } from 'react';
import { t } from '../i18n';
import type { ChatMessage } from '../services/preparation';
import { useGeneralSettings } from '../stores/generalSettings';
import { Refresh } from './icons';
import { Button } from './ui/button';
import { ProfileProposal } from './ProfileProposal';
import { MarkdownContent } from './MarkdownContent';
import { ProviderIdentity } from './ProviderIdentity';
import { ResponseProgress } from './ResponseProgress';
import { ChatSources } from './ChatSources';
import { UserMessage } from './UserMessage';
import { ChatMessageActions } from './ChatMessageActions';

export const PreparationMessage = memo(function PreparationMessage({
  message, timestamp, copied, onCopied, retryDisabled, onRetry,
}: {
  message: ChatMessage;
  timestamp?: number;
  copied: string | null;
  onCopied(id: string | null): void;
  retryDisabled?: boolean;
  onRetry(id: string): Promise<void>;
}) {
  useGeneralSettings((state) => state.language);
  const emptyAnswer = message.role !== 'assistant' || message.content
    ? null
    : message.status === 'failed'
      ? t('请求失败，未收到回答。')
      : message.status === 'stopped'
        ? t('已停止回复。')
        : message.status === 'completed' ? t('服务未返回文本内容。') : null;
  return (
    <article className={`chat-message ${message.role}`} data-message-id={message.id}>
      {message.role === 'user' ? (
        <>
          <UserMessage message={message} />
          <ChatMessageActions
            message={message}
            timestamp={timestamp}
            copied={copied}
            onCopied={onCopied}
          />
        </>
      ) : (
        <>
          <div className="answer-label">
            <ProviderIdentity
              provider={message.provider ?? (message.mode === 'live' ? 'unknown' : 'mock')}
              detail={
                message.status === 'failed'
                  ? message.errorCode?.startsWith('skill_')
                    ? t('提案校验失败')
                    : t('回答未完成')
                  : message.status === 'stopped'
                    ? t('已停止')
                    : undefined
              }
            />
          </div>
          <ResponseProgress message={message} />
          <ChatSources sources={message.sources ?? []} />
          <div className="chat-answer">
            {message.content && (
              <MarkdownContent
                content={message.content}
                sources={message.sources}
                streaming={message.status === 'streaming'}
              />
            )}
            <InterviewReveal resizeKey={emptyAnswer ?? ''}>
              {emptyAnswer ? <span>{emptyAnswer}</span> : null}
            </InterviewReveal>
          </div>
          <ProfileProposal message={message} />
          <InterviewReveal resizeKey={message.error ?? ''}>
            {message.error ? (
              <p className="message-error" role="alert">
                {t(message.error)}
              </p>
            ) : null}
          </InterviewReveal>
          <ChatMessageActions
            message={message}
            timestamp={timestamp}
            copied={copied}
            onCopied={onCopied}
          >
            {retryDisabled !== undefined && (
              <Button
                variant="outline"
                className="chat-retry"
                disabled={retryDisabled}
                onClick={() => void onRetry(message.id)}
              >
                <Refresh size={16} />
                {t('重试回答')}
              </Button>
            )}
          </ChatMessageActions>
        </>
      )}
    </article>
  );
});
