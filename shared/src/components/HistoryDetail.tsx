import { InterviewReveal } from './InterviewReveal';
import { t, uiLocale } from '../i18n';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { InterviewRecord } from '../services/history';
import {
  duration,
  answerCountLabel,
  exportRecord,
  relativeTime,
  answerSourceLookup,
  visibleAnswers,
} from '../services/historyPresentation';
import { useHistory } from '../stores/history';
import { useGeneralSettings } from '../stores/generalSettings';
import { readHistoryRecordings } from '../services/historyRecordingRemoval';
import { createTranscriptTimeline } from '../services/transcriptTimeline';
import { RecordingPlayer, RecordingExport, type RecordingPlayerHandle, type RecordingScrubPhase } from './RecordingPlayer';
import { createTranscriptScrubScroll, transcriptScrollTop } from './transcriptScrubScroll';
import { playableRecording, recordingRecordId, type PlayableRecording, type RecordingSegment } from '../../electron/contracts/recordings';
import { SyncBadge } from './SyncBadge';
import { useChatConnection } from '../stores/chatConnection';
import { useAuth } from '../stores/auth';
import { Button } from './ui/button';
import { ConfirmDeleteButton } from './ui/confirm-delete-button';
import { Modal } from './ui/modal';
import { PanelResizeHandle } from './ui/PanelResizeHandle';
import { highlightLocation } from './ui/locationHighlight';
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

/** Wait for the reading pane to reach the destination before spending its highlight time. */
function revealHistoryLocation(
  row: HTMLElement,
  pane: HTMLElement,
  header: HTMLElement | null,
  rail: HTMLElement | null,
  alignment: 'start' | 'center' | 'playback',
) {
  const waiting = new AbortController();
  const { signal } = waiting;
  let clearHighlight: (() => void) | undefined;
  let destination: number | undefined;
  const visibleTop = () => Math.max(pane.getBoundingClientRect().top, header?.getBoundingClientRect().bottom ?? 0, 0);
  const visibleBottom = () => Math.min(pane.getBoundingClientRect().bottom, window.innerHeight);
  const finish = () => {
    if (signal.aborted || destination === undefined) return;
    const bounds = row.getBoundingClientRect();
    const top = visibleTop(), bottom = visibleBottom();
    const visible = Math.min(bounds.bottom, bottom) - Math.max(bounds.top, top);
    if (Math.abs(pane.scrollTop - destination) > 1 || visible <= 0 ||
      visible + 1 < Math.min(bounds.height, bottom - top)) {
      // A resize or reflow can clamp the final scroll offset. Release playback follow.
      if (alignment === 'playback') waiting.abort();
      return;
    }
    waiting.abort();
    clearHighlight = highlightLocation(row);
  };
  const frame = requestAnimationFrame(async () => {
    // Opening or closing the rail changes the transcript width and wraps its text.
    const transitions = rail?.getAnimations().filter(animation => animation instanceof CSSTransition) ?? [];
    await Promise.allSettled(transitions.map(animation => animation.finished));
    if (signal.aborted || !row.isConnected) {
      waiting.abort();
      return;
    }
    row.focus({ preventScroll: true });
    const bounds = row.getBoundingClientRect();
    const top = visibleTop(), bottom = visibleBottom();
    let delta = 0;
    if (alignment === 'start' || bounds.height >= bottom - top) delta = bounds.top - top;
    else if (alignment === 'playback') {
      const viewport = pane.getBoundingClientRect();
      delta = bounds.top - Math.max(top, (viewport.top + viewport.bottom - bounds.height) / 2);
    } else if (bounds.top < top || bounds.bottom > bottom)
      delta = (bounds.top + bounds.bottom - top - bottom) / 2;
    destination = Math.max(0, Math.min(pane.scrollHeight - pane.clientHeight, pane.scrollTop + delta));
    pane.addEventListener('scrollend', finish, { signal });
    const alreadyAtDestination = Math.abs(pane.scrollTop - destination) <= 1;
    const smooth = !alreadyAtDestination && !matchMedia('(prefers-reduced-motion: reduce)').matches;
    pane.scrollTo({
      top: destination,
      behavior: smooth ? 'smooth' : 'instant',
    });
    if (!smooth) finish(); // An unchanged or instant scroll need not emit scrollend.
  });
  pane.addEventListener('wheel', () => waiting.abort(), { signal, passive: true });
  pane.addEventListener('touchmove', () => waiting.abort(), { signal, passive: true });
  pane.addEventListener('keydown', event => {
    if (['PageUp', 'PageDown', 'Home', 'End', 'ArrowUp', 'ArrowDown'].includes(event.key)) waiting.abort();
  }, { signal });
  signal.addEventListener('abort', () => cancelAnimationFrame(frame), { once: true });
  return {
    get pending() { return !signal.aborted; },
    cancel() {
      if (!signal.aborted && destination !== undefined)
        pane.scrollTo({ top: pane.scrollTop, behavior: 'instant' });
      waiting.abort();
      clearHighlight?.();
    },
  };
}

function shortTime(timestamp: number | undefined, language: string) {
  return timestamp !== undefined && Number.isFinite(timestamp)
    ? new Date(timestamp).toLocaleTimeString(language, { hour: '2-digit', minute: '2-digit', hour12: false })
    : '';
}

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
  const [answersOpen, setShowAnswers] = useState<boolean>();
  const showAnswers = answersOpen === true;
  const answersMounted = answersOpen !== undefined;
  const language = useGeneralSettings(state => state.language);
  const [location, setLocation] = useState<{ panel: 'answers' | 'transcript' | 'playback'; id: string } | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState(record.recordingError ?? '');
  const [renaming, setRenaming] = useState(false);
  const [titleDraft, setTitleDraft] = useState(record.title);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const toolbar = useRef<HTMLElement>(null);
  const detailLayout = useRef<HTMLDivElement>(null);
  const rows = useRef(new Map<string, HTMLElement>());
  const [segments, setSegments] = useState<RecordingSegment[]>([]);
  const clips = useMemo(() => segments.filter(playableRecording), [segments]);
  const playingRows = useRef<readonly string[]>([]);
  const [following, setFollowing] = useState(true);
  const follow = useRef(true);
  const player = useRef<RecordingPlayerHandle>(null);
  const transcriptScroll = useRef<HTMLDivElement>(null);
  const position = useRef<number | null>(null);
  const lastLocated = useRef<string | null>(null);
  const locationReveal = useRef<{ playback: boolean; action: ReturnType<typeof revealHistoryLocation> } | null>(null);
  const scrubScroll = useMemo(createTranscriptScrubScroll, []);
  useLayoutEffect(() => scrubScroll.cancel, [scrubScroll]);
  useEffect(() => {
    let active = true;
    if (recordingRecordId(record.id) && window.desktop?.recordings)
      void readHistoryRecordings(record.id).then(result => {
        if (active) {
          setSegments(result);
          if (result.length && !result.some(playableRecording)) setExportError('无法读取本地录音。');
        }
      }).catch(() => { if (active) setExportError('无法读取本地录音。'); });
    return () => { active = false; };
  }, [record.id]);
  const timeline = useMemo(() => createTranscriptTimeline(record.transcripts), [record.transcripts]);
  const playable = useMemo(() => {
    const targets = new Map<string, { clip: PlayableRecording; time: number }>();
    for (const row of timeline.rows) {
      const clip = clips.find(item =>
        row.startMs < item.startedAt + item.durationMs && row.endMs > item.startedAt);
      if (clip) targets.set(row.id, { clip, time: Math.max(row.startMs, clip.startedAt) });
    }
    return targets;
  }, [timeline, clips]);
  const pauseFollowing = useCallback(() => {
    scrubScroll.cancel();
    if (!follow.current || !clips.length) return;
    follow.current = false;
    setFollowing(false);
    if (locationReveal.current?.playback) locationReveal.current.action.cancel();
    const scroll = transcriptScroll.current;
    scroll?.scrollTo({ top: scroll.scrollTop, behavior: 'instant' });
  }, [clips.length, scrubScroll]);
  const onPosition = useCallback((time: number | null, restore = false,
    target?: { clip: PlayableRecording; action: 'locate' | RecordingScrubPhase }) => {
    const scrubbing = target !== undefined && target.action !== 'locate';
    if (target?.action === 'press') {
      locationReveal.current?.action.cancel();
      setLocation(null);
      const pane = transcriptScroll.current;
      if (pane) scrubScroll.interrupt(pane);
      return;
    }
    position.current = time;
    const clip = target?.clip;
    // The final position belongs to this clip, even if the next clip starts at the same instant.
    const pastClip = clip && time !== null && time >= clip.startedAt + clip.durationMs;
    const active = timeline.at(pastClip ? null : time);
    if (active.ids !== playingRows.current) {
      // Updating the playback tint must not rebuild the entire transcript on each slider input.
      for (const id of playingRows.current)
        if (!active.ids.includes(id)) rows.current.get(id)?.classList.remove('is-playing');
      for (const id of active.ids)
        if (!playingRows.current.includes(id)) rows.current.get(id)?.classList.add('is-playing');
      playingRows.current = active.ids;
    }
    const previouslyFollowing = follow.current;
    const playbackReveal = locationReveal.current?.playback ? locationReveal.current.action : null;
    if (restore) {
      if (!scrubbing) scrubScroll.cancel();
      if (scrubbing && locationReveal.current) {
        locationReveal.current.action.cancel();
        setLocation(null);
      } else if (playbackReveal) {
        if (playbackReveal.pending) lastLocated.current = null;
        playbackReveal.cancel();
      }
      follow.current = true;
      if (!previouslyFollowing) setFollowing(true);
    }
    if (time === null) {
      lastLocated.current = null;
      return;
    }
    let current = active.current;
    if (!current && restore) {
      // In a silent gap, locate the closest caption covered by this recording.
      const segment = clip ?? clips.find(item => item.startedAt <= time && time <= item.startedAt + item.durationMs);
      if (segment) current = timeline.nearestInGap(time, segment.startedAt, segment.startedAt + segment.durationMs);
    }
    if (target?.action === 'locate') {
      lastLocated.current = current?.id ?? null;
      setLocation(current ? { panel: 'playback', id: current.id } : null);
      return;
    }
    const scroll = transcriptScroll.current;
    if (!scroll || !follow.current) return;
    if (!current) {
      if (scrubbing) scrubScroll.cancel();
      return;
    }
    if (!scrubbing && (scrubScroll.active || playbackReveal?.pending ||
      (current.id === lastLocated.current && previouslyFollowing))) return;
    const row = rows.current.get(current.id);
    if (!row) return;
    if (scrubbing) {
      scrubScroll.move(scroll, row, toolbar.current, target.action === 'seek' ? 'seek' : 'track');
    } else {
      scroll.scrollTo({
        top: transcriptScrollTop(scroll, row, toolbar.current),
        behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
      });
    }
    lastLocated.current = current.id;
  }, [timeline, clips, scrubScroll]);
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
    const sourceIds = answerSourceLookup(record);
    const byAnswer = new Map(answers.map((answer) => [answer.id, sourceIds(answer)]));
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
  useEffect(() => {
    if (models.length && record.titleStatus !== 'ready' && record.titleStatus !== 'failed')
      void history.generateTitle(record.id);
  }, [record.id, models]);
  useLayoutEffect(() => {
    if (!location) return;
    const answer = location.panel === 'answers';
    const row = (answer ? answerRows : rows).current.get(location.id);
    const pane = answer ? row?.closest<HTMLElement>('.record-answer-scroll') : transcriptScroll.current;
    if (!row || !pane) return;
    const rail = pane.closest('.record-detail-body')?.querySelector<HTMLElement>('.record-answer-panel') ?? null;
    const header = answer ? rail?.querySelector('header') ?? null : toolbar.current;
    const playback = location.panel === 'playback';
    scrubScroll.cancel();
    const reveal = revealHistoryLocation(row, pane, header, rail, playback ? 'playback' : answer ? 'start' : 'center');
    locationReveal.current = { playback, action: reveal };
    return () => {
      reveal.cancel();
      locationReveal.current = null;
    };
  }, [location, scrubScroll]);
  const locate = useCallback((id: string) => {
    if (position.current !== null) pauseFollowing();
    if (matchMedia('(max-width: 1100px)').matches) setShowAnswers(false);
    setLocation({ panel: 'transcript', id });
  }, [pauseFollowing]);
  const openAnswer = (id: string) => {
    setShowAnswers(true);
    setLocation({ panel: 'answers', id });
  };
  const answerRowsContent = useMemo(() => {
    if (!answersMounted) return null;
    return answers.map((answer) => {
      const ids = associations.byAnswer.get(answer.id) ?? [];
      return (
        <article
          className="record-answer"
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
            <time>{shortTime(answer.createdAt, language)}</time>
          </div>
          <p className="record-answer-question">{answer.question}</p>
          <InterviewImages images={answer.images} lazyPreviews />
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
    });
  }, [answersMounted, answers, associations, locate, language]);
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
          {clips.length > 0 && <RecordingExport clips={segments} recordId={record.id} title={record.title}
            origin={record.startedAt} onError={setExportError} />}
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
            {exporting ? t('正在导出…') : t('导出转写')}
          </Button>
          <Button
            variant="outline"

            className={showAnswers ? 'record-panel-toggle is-active' : 'record-panel-toggle'}
            aria-label={t('AI 回答面板')}
            aria-expanded={showAnswers}
            aria-controls="record-answer-panel"
            onClick={() => {
              setLocation(null);
              setShowAnswers((open) => !open);
            }}
          >
            <PanelRight size={16} />
            <span>{answerCountLabel(answers.length)}</span>
          </Button>
          <ConfirmDeleteButton
            key={record.id}

            iconOnly
            target={t('面试记录：') + record.title}
            aria-label={t('删除记录')}
            revision={record.title}
            active={!renaming}
            onConfirm={async () => {
              const deleted = await onDelete();
              const detail = deleted ? null : useHistory.getState().error;
              setDeleteError(detail);
              if (!deleted && !detail) return false;
            }}
          />
        </div>
      </header>
      <InterviewReveal resizeKey={exportError ?? ''}>
        {exportError ? (
          <p className="record-export-error danger-text" role="alert">
            {t(exportError)}
          </p>
        ) : null}
      </InterviewReveal>
      <InterviewReveal resizeKey={history.error ?? ''}>
        {history.error && history.error !== deleteError && !(renaming && renameError === history.error) ? (
          <p role="alert" className="record-export-error danger-text">{t(history.error)}</p>
        ) : null}
      </InterviewReveal>
      <div ref={detailLayout} className={`record-detail-body ${showAnswers ? 'with-answers' : ''}`}>
        <div className="record-transcript-pane">
        <div className="record-transcript-scroll" ref={transcriptScroll}
          onWheel={pauseFollowing} onTouchMove={pauseFollowing}
          onPointerDown={event => {
            if (event.button === 1 || event.clientX >= event.currentTarget.getBoundingClientRect().left + event.currentTarget.clientWidth)
              pauseFollowing();
          }}
          onKeyDown={event => {
            if (['PageUp','PageDown','ArrowUp','ArrowDown','Home','End'].includes(event.key) ||
              (event.key === ' ' && !(event.target instanceof Element && event.target.closest('button')))) pauseFollowing();
          }}>
          <div className="record-reading-column">
            <InterviewReveal resizeKey={deleteError ?? ''}>
              {deleteError && deleteError === history.error ? (
                <p role="alert" className="record-history-error danger-text">{t(deleteError)}</p>
              ) : null}
            </InterviewReveal>
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
                  {date(record.startedAt)} — {shortTime(record.endedAt, language)}
                </p>
              </div>
              <span className="neutral-badge">
                {record.transcriptTailIncomplete ? t('转写可能不完整') : record.status === 'ended' ? t('已结束') : t('已保存')}
              </span>
            </div>
            <InterviewReveal resizeKey={record.titleError || record.titleStatus || ''}>
              {record.titleStatus === 'pending' ? (
                <p className="record-title-status" role="status">
                  <Loader size={13} />
                  <span>{t('正在生成标题…')}</span>
                </p>
              ) : record.titleStatus === 'failed' ? (
                <p className="record-title-status">
                  <span>{t(record.titleError || '标题生成失败。')}</span>
                  <Button
                    variant="ghost"
                    onClick={async (event) => {
                      const button = event.currentTarget;
                      await useAuth.getState().ensure();
                      if (button.isConnected) await history.generateTitle(record.id);
                    }}
                  >
                    <Refresh size={16} />
                    {t('重试生成标题')}
                  </Button>
                </p>
              ) : null}
            </InterviewReveal>
            <p className="record-facts">
              {duration(record)}
              {t(' · 本地语音转录 · ')}
              {answerCountLabel(answers.length)}
            </p>
            {answers.some((answer) => answer.images?.length) && (
              <section className="record-images-section" aria-label={t('面试截图')}>
                <h2 className="record-transcript-heading">{t('已发送截图')}</h2>
                {answers
                  .filter((answer) => answer.images?.length)
                  .map((answer) => (
                    <div className="record-image-question" key={answer.id}>
                      <p>{answer.question}</p>
                      <InterviewImages images={answer.images} lazyPreviews />
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
              const target = playable.get(row.id);
              const jump = () => { if (target) player.current?.playFrom(target.clip, target.time); };
              return (
                <article
                  key={row.id}
                  ref={(node) => {
                    if (node) {
                      rows.current.set(row.id, node);
                      node.classList.toggle('is-playing', playingRows.current.includes(row.id));
                    } else rows.current.delete(row.id);
                  }}
                  className="record-transcript-row"
                  data-playable={target ? true : undefined}
                  onClick={target ? event => {
                    if (event.target instanceof Element && !event.target.closest('button') && !window.getSelection()?.toString()) jump();
                  } : undefined}
                  aria-label={t(`转录：${row.text}`)}
                  tabIndex={-1}
                >
                  <time>{target ? (
                    <button type="button" className="record-paragraph-time"
                      aria-label={`${t('从此段播放')} · ${relativeTime(record, row)}`} onClick={jump}>
                      {relativeTime(record, row)}
                    </button>
                  ) : relativeTime(record, row)}</time>
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
          {clips.length > 0 && <RecordingPlayer ref={player} clips={segments} origin={record.startedAt}
            following={following} onPosition={onPosition}
            onScrub={(clip, time, phase) => onPosition(time, true, { clip, action: phase })}
            onLocate={(clip, time) => onPosition(time, true, { clip, action: 'locate' })} onError={setExportError} />}
        </div>
        <aside
          id="record-answer-panel"
          className="record-answer-panel"
          aria-label={t('AI 回答')}
          data-open={showAnswers}
          inert={!showAnswers}
          aria-hidden={!showAnswers}
        >
          {showAnswers && (
            <PanelResizeHandle
              layoutRef={detailLayout}
              label={t('调整 AI 回答宽度')}
              controls="record-answer-panel"
              draggingClassName="is-resizing-answers"
              onResize={width => detailLayout.current!.style.setProperty('--record-answer-preferred-width', width + 'px')}
              onReset={() => detailLayout.current!.style.removeProperty('--record-answer-preferred-width')}
            />
          )}
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
            {answerRowsContent}
          </div>
        </aside>
      </div>
      {renaming && (
        <Modal title={t('重命名标题')} onClose={() => setRenaming(false)}>
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              if (await history.rename(record.id, titleDraft)) setRenaming(false);
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
            <InterviewReveal resizeKey={renameError ?? ''}>
              {renameError ? (
                <p role="alert" className="danger-text">
                  {t(renameError)}
                </p>
              ) : null}
            </InterviewReveal>
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
