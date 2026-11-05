import { t, uiLocale } from '../i18n';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { InterviewRecord } from '../services/history';
import {
  duration,
  exportRecord,
  relativeTime,
  sourceIds,
  visibleAnswers,
} from '../services/historyPresentation';
import { useHistory } from '../stores/history';
import { SyncBadge } from './SyncBadge';
import { useChatConnection } from '../stores/chatConnection';
import { Button } from './ui/button';
import { ConfirmDeleteButton } from './ui/confirm-delete-button';
import { Modal } from './ui/modal';
import { MarkdownContent } from './MarkdownContent';
import { InterviewImages } from './InterviewImages';
import { ProviderIdentity } from './ProviderIdentity';
import {
  ChevronLeft,
  ChevronRight,
  Download,
  PanelRight,
  Sparkles,
  ArrowUpRight,
  Loader,
  Edit,
  Refresh,
  X,
  Save,
} from './icons';

export function HistoryDetail({
  record,
  onBack,
  onDelete,
}: {
  record: InterviewRecord;
  onBack(): void;
  onDelete(): Promise<boolean>;
}) {
  const history = useHistory();
  const models = useChatConnection((s) => s.models);
  const [showAnswers, setShowAnswers] = useState(false);
  const [focusedAnswer, setFocusedAnswer] = useState<string | null>(null);
  const [focusedTranscript, setFocusedTranscript] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [titleDraft, setTitleDraft] = useState(record.title);
  const [renameError, setRenameError] = useState<string | null>(null);
  const toolbar = useRef<HTMLElement>(null);
  const rows = useRef(new Map<string, HTMLElement>());
  const answerRows = useRef(new Map<string, HTMLElement>());
  useLayoutEffect(() => {
    const header = toolbar.current;
    const workspace = header?.parentElement;
    if (!header || !workspace) return;
    const update = () =>
      workspace.style.setProperty(
        '--record-toolbar-height',
        `${header.getBoundingClientRect().height}px`,
      );
    update();
    const observer = new ResizeObserver(update);
    observer.observe(header);
    return () => observer.disconnect();
  }, []);
  const answers = useMemo(() => visibleAnswers(record), [record]);
  const associations = useMemo(() => {
    const byAnswer = new Map(answers.map((answer) => [answer.id, sourceIds(record, answer)]));
    const byTranscript = new Map<string, typeof answers>();
    for (const answer of answers)
      for (const id of byAnswer.get(answer.id) ?? [])
        byTranscript.set(id, [...(byTranscript.get(id) ?? []), answer]);
    return { byAnswer, byTranscript };
  }, [record, answers]);
  const date = (time: number) =>
    new Date(time).toLocaleString(uiLocale(), {
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  const time = (timestamp?: number) =>
    Number.isFinite(timestamp)
      ? new Date(timestamp!).toLocaleTimeString(uiLocale(), {
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        })
      : '';
  const scrollToAnswer = (id: string) => {
    const answer = answerRows.current.get(id);
    const scroll = answer?.closest<HTMLElement>('.record-answer-scroll');
    if (!answer || !scroll) return;
    // Scroll only this rail; scrollIntoView can shift its clipped ancestors
    // horizontally while the panel is still sliding into the window.
    const bounds = answer.getBoundingClientRect();
    const viewport = scroll.getBoundingClientRect();
    const header = scroll.parentElement?.querySelector(':scope > header');
    const visibleTop = Math.max(viewport.top, header?.getBoundingClientRect().bottom ?? 0) + 16;
    if (bounds.top < visibleTop) scroll.scrollTop += bounds.top - visibleTop;
    else if (bounds.bottom > viewport.bottom - 16)
      scroll.scrollTop += Math.min(bounds.top - visibleTop, bounds.bottom - viewport.bottom + 16);
  };
  useEffect(() => {
    if (models.length && record.titleStatus !== 'ready' && record.titleStatus !== 'failed')
      void history.generateTitle(record.id);
  }, [record.id, models]);
  useEffect(() => {
    if (!showAnswers || !focusedAnswer) return;
    const frame = requestAnimationFrame(() => scrollToAnswer(focusedAnswer));
    return () => cancelAnimationFrame(frame);
  }, [showAnswers, focusedAnswer]);
  const locate = (id: string) => {
    setFocusedTranscript(id);
    if (matchMedia('(max-width: 1100px)').matches) setShowAnswers(false);
    requestAnimationFrame(() => rows.current.get(id)?.focus({ preventScroll: true }));
    rows.current.get(id)?.scrollIntoView({
      block: 'center',
      behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
    });
  };
  const openAnswer = (id: string) => {
    setShowAnswers(true);
    setFocusedAnswer(id);
    requestAnimationFrame(() => answerRows.current.get(id)?.focus({ preventScroll: true }));
    // Repeated clicks must also locate an answer after the rail was manually scrolled.
    if (showAnswers) requestAnimationFrame(() => scrollToAnswer(id));
  };
  return (
    <main className="workspace history-detail">
      <header ref={toolbar} className="page-toolbar record-detail-toolbar">
        <div className="history-heading-transition">
          <Button
            variant="ghost"
            size="icon"
            className="record-back"

            onClick={onBack}
            aria-label={t('返回面试记录')}
          >
            <ChevronLeft size={16} />
          </Button>
        </div>
        <div className="record-toolbar-actions">
          <Button
            variant="outline"

            disabled={exporting}
            onClick={async () => {
              setExporting(true);
              setExportError('');
              try {
                await window.desktop!.exportHistory({
                  title: record.title,
                  text: exportRecord(record),
                });
              } catch {
                setExportError('导出失败，请重新选择保存位置。');
              } finally {
                setExporting(false);
              }
            }}
          >
            <Download size={16} />
            {exporting ? t('正在导出…') : t('导出 TXT')}
          </Button>
          <Button
            variant="outline"

            className={showAnswers ? 'record-panel-toggle is-active' : 'record-panel-toggle'}
            aria-label={t('AI 回答面板')}
            aria-expanded={showAnswers}
            aria-controls="record-answer-panel"
            onClick={() => setShowAnswers((open) => !open)}
          >
            <PanelRight size={16} />
            <span>
              {answers.length}
              {t(' 条 AI 回答')}
            </span>
          </Button>
          <ConfirmDeleteButton
            key={record.id}

            iconOnly
            target={t('面试记录：') + record.title}
            aria-label={t('删除记录')}
            revision={record.title}
            active={!renaming}
            onConfirm={onDelete}
          />
        </div>
      </header>
      {exportError && (
        <p className="record-export-error danger-text" role="alert">
          {t(exportError)}
        </p>
      )}
      {history.error && !(renaming && renameError === history.error) && (
        <p role="alert" className="record-export-error danger-text">
          {t(history.error)}
        </p>
      )}
      <div className={`record-detail-body ${showAnswers ? 'with-answers' : ''}`}>
        <div className="record-transcript-scroll">
          <div className="record-reading-column">
            <div className="record-session-heading">
              <div>
                <div className="record-heading-title">
                  <h1>{record.title}</h1>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="action-icon-button"
                    data-reveal-on-hover
                    aria-label={t('重命名标题')}
                    onClick={() => {
                      setTitleDraft(record.title);
                      setRenameError(null);
                      setRenaming(true);
                    }}
                  >
                    <Edit size={17} />
                  </Button>
                  <SyncBadge itemKey={'record:' + record.id} label={record.title} />
                </div>
                <p>
                  {date(record.startedAt)} — {time(record.endedAt)}
                </p>
              </div>
              <span className="neutral-badge">
                {record.status === 'ended' ? t('已结束') : t('已保存')}
              </span>
            </div>
            {record.titleStatus === 'pending' && (
              <p className="record-title-status" role="status">
                <Loader size={13} />
                <span>{t('正在生成标题…')}</span>
              </p>
            )}
            {record.titleStatus === 'failed' && (
              <p className="record-title-status">
                <span>{t(record.titleError || '标题生成失败。')}</span>
                <Button variant="ghost" onClick={() => void history.generateTitle(record.id)}>
                  <Refresh size={16} />
                  {t('重试生成标题')}
                </Button>
              </p>
            )}
            <p className="record-facts">
              {duration(record)}
              {t(' · 本地语音转录 · ')}
              {answers.length}
              {t(' 条 AI 回答')}
            </p>
            {answers.some((answer) => answer.images?.length) && (
              <section className="record-images-section" aria-label={t('面试截图')}>
                <h2 className="record-transcript-heading">{t('已发送截图')}</h2>
                {answers
                  .filter((answer) => answer.images?.length)
                  .map((answer) => (
                    <div className="record-image-question" key={answer.id}>
                      <p>{answer.question}</p>
                      <InterviewImages images={answer.images} />
                    </div>
                  ))}
              </section>
            )}
            <h2 className="record-transcript-heading">
              {t('面试转录 ')}
              <span>{record.transcripts.length}</span>
            </h2>
            {!record.transcripts.length && (
              <p className="empty-inline record-empty">{t('本场面试没有保存语音转录。')}</p>
            )}
            {record.transcripts.map((row) => {
              const linked = associations.byTranscript.get(row.id) ?? [];
              return (
                <article
                  key={row.id}
                  ref={(node) => {
                    if (node) rows.current.set(row.id, node);
                    else rows.current.delete(row.id);
                  }}
                  className={`record-transcript-row ${focusedTranscript === row.id ? 'is-located' : ''}`}
                  aria-label={t(`转录：${row.text}`)}
                  tabIndex={-1}
                >
                  <time>{relativeTime(record, row)}</time>
                  <div>
                    <span className="record-speaker">
                      {row.source === 'microphone' ? t('我') : t('面试官')}
                      {!row.final && t(' · 未完成')}
                    </span>
                    <p className="record-transcript-text">{row.text}</p>
                    {linked.map((answer) => (
                      <button
                        key={answer.id}
                        className="record-answer-link"
                        aria-label={t(`查看回答：${answer.question}`)}
                        onClick={() => {
                          openAnswer(answer.id);
                        }}
                      >
                        <Sparkles size={13} />
                        {t('AI 回答')}
                        {linked.length > 1 ? ` ${linked.indexOf(answer) + 1}` : ''}
                      </button>
                    ))}
                  </div>
                </article>
              );
            })}
          </div>
        </div>
        <aside
          id="record-answer-panel"
          className="record-answer-panel"
          aria-label={t('AI 回答')}
          data-open={showAnswers}
          inert={!showAnswers}
          aria-hidden={!showAnswers}
        >
          <header>
            <div>
              <h2>{t('AI 回答')}</h2>
              <p>{t('本场面试中提问并保存的 AI 回答。')}</p>
            </div>
          </header>
          <div className="record-answer-scroll">
            {!answers.length && (
              <p className="empty-inline record-empty">{t('本场面试尚未保存 AI 回答。')}</p>
            )}
            {answers.map((answer) => {
              const ids = associations.byAnswer.get(answer.id) ?? [];
              return (
                <article
                  className={`record-answer ${focusedAnswer === answer.id ? 'is-located' : ''}`}
                  key={answer.id}
                  ref={(node) => {
                    if (node) answerRows.current.set(answer.id, node);
                    else answerRows.current.delete(answer.id);
                  }}
                  aria-label={t(`回答：${answer.question}`)}
                  tabIndex={-1}
                >
                  <div className="record-answer-meta">
                    <span>{ids.length ? t('转录提问') : t('手动提问')}</span>
                    <time>{time(answer.createdAt)}</time>
                  </div>
                  <p className="record-answer-question">{answer.question}</p>
                  <InterviewImages images={answer.images} />
                  {ids.length > 0 && (
                    <button className="record-answer-link" onClick={() => locate(ids[0])}>
                      <ArrowUpRight size={13} />
                      {t('定位到原问题')}
                    </button>
                  )}
                  <div className="record-answer-content">
                    <h3>
                      <ProviderIdentity
                        provider={answer.provider ?? 'unknown'}
                        detail={
                          answer.status === 'stopped'
                            ? t('已停止')
                            : answer.status === 'failed'
                              ? t('回答未完成')
                              : undefined
                        }
                      />
                    </h3>
                    {answer.reasoningSummary && (
                      <details className="reasoning-summary">
                        <summary>
                          {t('推理摘要')}
                          <span className="disclosure-chevron">
                            <ChevronRight size={14} />
                          </span>
                        </summary>
                        <MarkdownContent content={answer.reasoningSummary} />
                      </details>
                    )}
                    {answer.content ? (
                      <MarkdownContent content={answer.content} />
                    ) : (
                      <p className="empty-inline">{t('这条回答没有保存内容。')}</p>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        </aside>
      </div>
      {renaming && (
        <Modal title={t('重命名标题')} onClose={() => setRenaming(false)}>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (history.rename(record.id, titleDraft)) setRenaming(false);
              else setRenameError(useHistory.getState().error);
            }}
          >
            <label className="field-label">
              {t('记录标题')}
              <input
                value={titleDraft}
                maxLength={80}
                data-autofocus
                onFocus={(event) => event.currentTarget.select()}
                onChange={(event) => {
                  setTitleDraft(event.target.value);
                  setRenameError(null);
                }}
              />
            </label>
            {renameError && (
              <p role="alert" className="danger-text">
                {t(renameError)}
              </p>
            )}
            <div className="interview-start-actions">
              <Button type="button" variant="outline" onClick={() => setRenaming(false)}>
                <X size={16} />
                {t('取消')}
              </Button>
              <Button
                type="submit"
                disabled={!titleDraft.trim() || titleDraft.trim() === record.title}
              >
                <Save size={16} />
                {t('保存标题')}
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </main>
  );
}
