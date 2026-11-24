import { InterviewReveal } from './InterviewReveal';
import { t } from '../i18n';
import { useEffect, useId, useState, type ReactNode } from 'react';
import type { ChatMessage } from '../services/preparation';
import type { ChatActivity as Activity } from '../../electron/contracts/chat';
import { MarkdownContent } from './MarkdownContent';
import { ChatActivity, describeActivity } from './ChatActivity';
import { Globe, Database, MessageSquare, ChevronRight } from './icons';
import { SourceLink } from './SourceLink';
import { reasoningSections } from '../services/responseProgress';

export function formatDuration(milliseconds: number) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(seconds / 3600),
    minutes = Math.floor(seconds / 60) % 60;
  return [
    hours ? t('{0} 小时', [hours]) : '',
    minutes ? t('{0} 分钟', [minutes]) : '',
    t('{0} 秒', [seconds % 60]),
  ]
    .filter(Boolean)
    .join(' ');
}

export function actionLabel(activity: Activity, active: boolean) {
  const done = activity.status === 'completed';
  const stopped = activity.status === 'failed' ? '失败' : !done && !active ? '未完成' : '';
  const noun =
    activity.kind === 'web_search'
      ? '搜索网页'
      : activity.kind === 'open_page'
        ? '读取网页'
        : activity.kind === 'find_in_page'
          ? '查找网页内容'
          : '查询本地资料';
  return stopped ? `${t(noun)} · ${t(stopped)}` : t(`${done ? '已' : '正在'}${noun}`);
}

function pagePattern(activity: Activity) {
  if (activity.kind !== 'find_in_page' || !activity.url || !activity.detail) return;
  try {
    const url = new URL(activity.url);
    // Older activities used detail for the page address, which the source capsule already represents.
    if (activity.detail !== `${url.hostname}${url.pathname}`.slice(0, 512)) return activity.detail;
  } catch { /* Invalid metadata must not break the activity list. */ }
}

function ReasoningBlocks({ text, active }: { text: string; active: boolean }) {
  const sections = reasoningSections(text);
  return sections.map((section, index) =>
    section.title ? (
      <details className="reasoning-summary reasoning-section" key={index}>
        <summary>
          <span
            className={`reasoning-heading${active && index === sections.length - 1 ? ' is-active' : ''}`}
          >
            {section.title}
          </span>
          <span className="reasoning-chevron">
            <ChevronRight size={14} />
          </span>
        </summary>
        {section.body && <MarkdownContent content={section.body} />}
      </details>
    ) : (
      <MarkdownContent content={section.body} key={index} />
    ),
  );
}

type ProgressMessage = Pick<
  ChatMessage,
  | 'status'
  | 'content'
  | 'mode'
  | 'activity'
  | 'activities'
  | 'reasoningSummary'
  | 'startedAt'
  | 'durationMs'
>;
export function ResponseProgress({ message, children }: { message: ProgressMessage; children?: ReactNode }) {
  const active = message.status === 'streaming';
  const answering = !!message.content.trim();
  const [expanded, setExpanded] = useState(!answering);
  const [now, setNow] = useState(Date.now);
  const [linkError, setLinkError] = useState<string | null>(null);
  const contentId = useId();
  useEffect(() => {
    if (answering) setExpanded(false);
  }, [answering]);
  useEffect(() => {
    if (!active || message.startedAt === undefined) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active, message.startedAt]);
  const duration =
    active && message.startedAt !== undefined
      ? Math.max(0, now - message.startedAt)
      : message.durationMs;
  const activities = message.activities ?? [];
  const endedWithoutAnswer = !answering && (message.status === 'failed' || message.status === 'stopped');
  const entries = activities.filter(entry => entry.kind !== 'status' ||
    ((active || entry.status === 'completed') && !(endedWithoutAnswer && entry.phase === 'writing')));
  const lastState = entries.map((entry) => entry.kind).lastIndexOf('status');
  const lastReasoning = entries.map((entry) => entry.kind).lastIndexOf('reasoning');
  const currentActivity = entries[lastState] ?? message.activity;
  const phase = currentActivity?.phase;
  const thinking = phase === 'thinking' && currentActivity?.kind !== 'knowledge';
  const elapsedLabel = answering ? '用时' : active ? (thinking ? '正在思考' : '用时') : '已处理';
  const elapsed =
    duration !== undefined && Number.isFinite(duration)
      ? `${t(elapsedLabel)} ${formatDuration(duration)}`
      : message.reasoningSummary?.trim()
        ? '推理摘要'
        : null;
  const collapsible = answering && (!!entries.length || !!message.reasoningSummary?.trim());
  const visible = !collapsible || expanded;
  if (!elapsed && !active && !entries.length && !message.reasoningSummary?.trim()) return null;
  return (
    <div
      className={`response-progress${collapsible && !expanded ? ' is-collapsed' : ''}`}
      data-has-answer={answering}
    >
      {elapsed &&
        (collapsible ? (
          <button
            className="response-duration duration-toggle"
            type="button"
            aria-expanded={expanded}
            aria-controls={contentId}
            onClick={() => setExpanded(!expanded)}
          >
            <span>{t(elapsed)}</span>
            <span className={`duration-chevron${expanded ? ' expanded' : ''}`}>
              <ChevronRight size={14} />
            </span>
          </button>
        ) : (
          <div className="response-duration">{t(elapsed)}</div>
        ))}
      <div
        className="response-progress-content collapse-content"
        id={contentId}
        data-expanded={visible}
        aria-hidden={!visible}
        inert={!visible}
      >
        {!entries.length && active && (
          children === undefined ? (
            <ChatActivity activity={message.activity} mock={message.mode !== 'live'} />
          ) : children
        )}
        {!entries.some((entry) => entry.kind === 'reasoning') &&
          message.reasoningSummary?.trim() && (
            <ReasoningBlocks text={message.reasoningSummary} active={active && thinking} />
          )}
        {!!entries.length && (
          <ol className="response-steps" aria-label={t('实际活动记录')}>
            {entries.map((activity, index) => {
              if (activity.kind === 'status')
                return (
                  <li
                    className="progress-state"
                    key={activity.id}
                    data-kind="status"
                    data-phase={activity.phase}
                  >
                    <div
                      role={active && index === lastState ? 'status' : undefined}
                      aria-live={active && index === lastState ? 'polite' : undefined}
                    >
                      <span
                        className={`progress-state-label${active && index === lastState ? ' is-active' : ''}`}
                      >
                        {describeActivity(activity)}
                      </span>
                    </div>
                  </li>
                );
              if (activity.kind === 'reasoning')
                return (
                  <li className="progress-reasoning" key={activity.id} data-kind="reasoning">
                    <ReasoningBlocks
                      text={activity.detail ?? ''}
                      active={active && thinking && index === lastReasoning}
                    />
                  </li>
                );
              const Icon =
                activity.kind === 'knowledge'
                  ? Database
                  : activity.kind === 'commentary'
                    ? MessageSquare
                    : Globe;
              return (
                <li key={activity.id} data-kind={activity.kind}>
                  <Icon size={16} />
                  <div>
                    {activity.kind === 'commentary' ? (
                      <MarkdownContent content={activity.detail ?? ''} />
                    ) : (
                      <>
                        <span>{actionLabel(activity, active)}</span>
                        {pagePattern(activity) && (
                          <span className="progress-detail">{pagePattern(activity)}</span>
                        )}
                        {activity.detail && !(activity.kind === 'knowledge' && activity.detail === '检索本地资料') &&
                          (activity.url ? (
                            <span className="progress-link">
                              <SourceLink
                                url={activity.url}
                                title={activity.detail}
                                inline
                                onError={() => setLinkError('无法打开活动中的网页。')}
                              />
                            </span>
                          ) : (
                            <span className="progress-detail">
                              {activity.kind === 'knowledge' ? t(activity.detail) : activity.detail}
                            </span>
                          ))}
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
        <InterviewReveal>
          {linkError ? (
            <p className="inline-error" role="alert">
              {t(linkError)}
            </p>
          ) : null}
        </InterviewReveal>
      </div>
    </div>
  );
}
