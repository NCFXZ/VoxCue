import { InterviewReveal } from './InterviewReveal';
import { memo } from 'react';
import type { Answer } from '../services/contracts';
import type { ChatActivity as Activity } from '../../electron/contracts/chat';
import { useGeneralSettings } from '../stores/generalSettings';
import { t } from '../i18n';
import { Check, Copy, Refresh, Screenshot } from './icons';
import { InterviewAnswerFailure, InterviewAnswerStatus } from './InterviewAnswerStatus';
import { InterviewImages } from './InterviewImages';
import { MarkdownContent } from './MarkdownContent';
import { ProviderIdentity } from './ProviderIdentity';
import { describeActivity } from './ChatActivity';
import { actionLabel, ResponseProgress } from './ResponseProgress';
import { Button } from './ui/button';

function interviewStatus(activity?: Activity) {
  const detail = activity?.detail?.trim();
  if (activity?.kind === 'knowledge') {
    if (detail && detail !== '检索本地资料') return t(detail);
    if (activity.status === 'failed') return t('本地资料检索失败');
    return t(activity.status === 'completed' ? '已检索本地资料' : '正在检索本地资料');
  }
  if (activity?.kind === 'open_page' || activity?.kind === 'find_in_page' || activity?.kind === 'web_search') {
    const label = actionLabel(activity, true);
    return detail ? `${label} ${detail}` : label;
  }
  if (detail) return activity?.kind === 'status' ? t(detail) : detail;
  return describeActivity(activity);
}

export const FloatingAnswer = memo(function FloatingAnswer({
  answer: a, copied, copyError, pending, retryDisabled, latestFailure, onCopy, onRetry,
}: {
  answer: Answer;
  copied: boolean;
  copyError: boolean;
  pending: boolean;
  retryDisabled: boolean;
  latestFailure: boolean;
  onCopy(answer: Answer): Promise<void>;
  onRetry(id: string): Promise<void>;
}) {
  useGeneralSettings((state) => state.language);
  const showCaret = pending && a.status === 'streaming';
  const activity = a.provider === 'mock' ? undefined : a.activity;
  const summary = a.reasoningSummary?.trim() || (activity?.kind === 'reasoning' ? activity.detail?.trim() : undefined);
  // During a retry the previous attempt's partial text can still be on screen.
  const showProgress = !!summary ||
    (a.status === 'streaming' && (!!a.retry || !a.content.trim()));
  return (
    <article
      className="floating-answer-item"
      aria-label={t(`回答：${a.question}`)}
    >
      <div
        className={`floating-question${a.images?.length ? ' has-images' : ''}`}
        data-question-id={a.id}
        aria-label={t('面试问题')}
      >
        {a.screenshot !== 'only' && <span>{a.question}</span>}
        <InterviewImages images={a.images} inInterview />
        {a.screenshot && (
          <span className="floating-screenshot-label">
            <Screenshot size={14} />
            {a.screenshot === 'only' ? t('截图提问') : t('附截图')}
          </span>
        )}
      </div>
      <div className="floating-answer-meta">
        <div className="interview-answer-identity">
          <span className="provider-identity">
            <ProviderIdentity provider={a.provider ?? 'unknown'} />
          </span>
          <InterviewAnswerStatus answer={a} />
        </div>
        {a.content && (
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('复制面试回答')}
            onClick={() => void onCopy(a)}
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
          </Button>
        )}
      </div>
      <InterviewReveal className="floating-progress-reveal">{showProgress && (
        <ResponseProgress
          message={{
            content: a.content,
            status: a.status ?? 'completed',
            mode: a.provider === 'mock' ? 'mock' : 'live',
            activity: a.activity,
            reasoningSummary: summary,
            startedAt: a.createdAt,
          }}
        >
          {activity?.kind === 'reasoning' && summary ? null : (
            <div className="chat-activity" role="status" aria-live="polite">
              {activity?.kind === 'commentary' && activity.detail?.trim() ? (
                <MarkdownContent content={activity.detail} />
              ) : (
                <span className="progress-state-label is-active">{interviewStatus(activity)}</span>
              )}
            </div>
          )}
        </ResponseProgress>
      )}</InterviewReveal>
      {(a.content || (!a.retry && a.status !== 'failed' && a.status !== 'stopped')) && (
        <div className="answer-text answer-bubble">
          {a.content ? (
            <MarkdownContent content={a.content} paceUpdates={a.status === 'streaming'} showCaret={showCaret} />
          ) : showCaret ? (
            <span className="answer-pending">{t('正在生成回答…')}<span className="typing-caret" aria-hidden="true" /></span>
          ) : (
            t('未收到回答。')
          )}
        </div>
      )}
      <InterviewReveal className="floating-failure-reveal" resizeKey={t(a.error)}>{a.status === 'failed' ? (
        <InterviewAnswerFailure
          answer={a}
          disabled={retryDisabled}
          live={latestFailure}
          onRetry={() => void onRetry(a.id)}
        />
      ) : null}</InterviewReveal>
      {a.status === 'stopped' && (
        <div className="floating-answer-actions">
          <Button
            variant="outline"
            className="interview-answer-retry"
            disabled={retryDisabled}
            onClick={() => void onRetry(a.id)}
          >
            <Refresh size={16} />
            {t('重试面试回答')}
          </Button>
        </div>
      )}
      <InterviewReveal resizeKey={copyError ? 'error' : 'copied'}>{copied || copyError ? (
        <small className="floating-answer-copy-feedback" role="status">
          {copyError ? t('复制失败，请选择文字后复制。') : t('已复制回答')}
        </small>
      ) : null}</InterviewReveal>
    </article>
  );
});
