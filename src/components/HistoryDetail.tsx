import { useEffect, useMemo, useRef, useState } from 'react';
import type { InterviewRecord } from '../services/history';
import {
  duration,
  exportRecord,
  relativeTime,
  sourceIds,
  visibleAnswers,
} from '../services/historyPresentation';
import { useHistory } from '../stores/history';
import { useChatConnection } from '../stores/chatConnection';
import { Button } from './ui/button';
import { Modal } from './ui/modal';
import { MarkdownContent } from './MarkdownContent';
import { ChevronLeft, Download, PanelRight, Trash, Sparkles, ArrowUpRight, Loader } from './icons';

export function HistoryDetail({ record, onBack }: { record: InterviewRecord; onBack(): void }) {
  const history = useHistory();
  const models = useChatConnection((s) => s.models);
  const [showAnswers, setShowAnswers] = useState(false);
  const [focusedAnswer, setFocusedAnswer] = useState<string | null>(null);
  const [focusedTranscript, setFocusedTranscript] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const rows = useRef(new Map<string, HTMLElement>());
  const answerRows = useRef(new Map<string, HTMLElement>());
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
    new Date(time).toLocaleString('zh-CN', {
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  const time = (timestamp?: number) =>
    Number.isFinite(timestamp)
      ? new Date(timestamp!).toLocaleTimeString('zh-CN', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        })
      : '';
  useEffect(() => {
    if (models.length && record.titleStatus !== 'ready' && record.titleStatus !== 'failed')
      void history.generateTitle(record.id);
  }, [record.id, models]);
  useEffect(() => {
    if (!showAnswers || !focusedAnswer) return;
    const frame = requestAnimationFrame(() =>
      answerRows.current.get(focusedAnswer)?.scrollIntoView({ block: 'nearest' }),
    );
    return () => cancelAnimationFrame(frame);
  }, [showAnswers, focusedAnswer]);
  const locate = (id: string) => {
    setFocusedTranscript(id);
    rows.current.get(id)?.scrollIntoView({
      block: 'center',
      behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
    });
  };
  const openAnswer = (id: string) => {
    setShowAnswers(true);
    setFocusedAnswer(id);
    // Repeated clicks must also locate an answer after the rail was manually scrolled.
    if (showAnswers)
      requestAnimationFrame(() => answerRows.current.get(id)?.scrollIntoView({ block: 'nearest' }));
  };
  return (
    <main className="workspace history-detail">
      <header className="page-toolbar record-detail-toolbar">
        <button
          className="record-back"
          onClick={onBack}
          aria-label="返回面试记录"
          title={record.title}
        >
          <ChevronLeft size={16} />
          <span>{record.title}</span>
        </button>
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
            {exporting ? '正在导出…' : '导出 TXT'}
          </Button>
          <Button
            variant="outline"
            className={showAnswers ? 'record-panel-toggle is-active' : 'record-panel-toggle'}
            aria-label="AI 回答面板"
            aria-expanded={showAnswers}
            onClick={() => setShowAnswers(!showAnswers)}
          >
            <span>{answers.length} 条 AI 回答</span>
            <PanelRight size={16} />
          </Button>
          <Button
            variant="dangerGhost"
            size="icon"
            aria-label="删除记录"
            title="删除记录"
            onClick={() => setDeleting(true)}
          >
            <Trash size={16} />
          </Button>
        </div>
      </header>
      {exportError && (
        <p className="record-export-error danger-text" role="alert">
          {exportError}
        </p>
      )}
      {history.error && (
        <p role="alert" className="record-export-error danger-text">
          {history.error}
        </p>
      )}
      <div className={`record-detail-body ${showAnswers ? 'with-answers' : ''}`}>
        <div className="record-transcript-scroll">
          <div className="record-reading-column">
            <div className="record-session-heading">
              <div>
                <h1>{record.title}</h1>
                <p>
                  {date(record.startedAt)} — {time(record.endedAt)}
                </p>
              </div>
              <span className="neutral-badge">
                {record.status === 'ended' ? '已结束' : '已保存'}
              </span>
            </div>
            {record.titleStatus === 'pending' && (
              <p className="record-title-status" role="status">
                <Loader size={13} />
                <span>正在生成标题…</span>
              </p>
            )}
            {record.titleStatus === 'failed' && (
              <p className="record-title-status">
                <span>{record.titleError || '标题生成失败。'}</span>
                <Button variant="ghost" onClick={() => void history.generateTitle(record.id)}>
                  重试生成标题
                </Button>
              </p>
            )}
            <p className="record-facts">
              {duration(record)} · 本地语音转录 · {answers.length} 条 AI 回答
            </p>
            <h2 className="record-transcript-heading">
              面试转录 <span>{record.transcripts.length}</span>
            </h2>
            {!record.transcripts.length && (
              <p className="empty-inline record-empty">本场面试没有保存语音转录。</p>
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
                  aria-label={`转录：${row.text}`}
                >
                  <time>{relativeTime(record, row)}</time>
                  <div>
                    <span className="record-speaker">
                      {row.source === 'microphone' ? '我' : '面试官'}
                      {!row.final && ' · 未完成'}
                    </span>
                    <p className="record-transcript-text">{row.text}</p>
                    {linked.map((answer) => (
                      <button
                        key={answer.id}
                        className="record-answer-link"
                        aria-label={`查看回答：${answer.question}`}
                        onClick={() => {
                          openAnswer(answer.id);
                        }}
                      >
                        <Sparkles size={13} />
                        AI 回答{linked.length > 1 ? ` ${linked.indexOf(answer) + 1}` : ''}
                      </button>
                    ))}
                  </div>
                </article>
              );
            })}
          </div>
        </div>
        {showAnswers && (
          <aside className="record-answer-panel" aria-label="AI 回答">
            <header>
              <div>
                <h2>AI 回答</h2>
                <p>本场面试中提问并保存的 AI 回答。</p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                aria-label="收起 AI 回答"
                onClick={() => setShowAnswers(false)}
              >
                <PanelRight size={17} />
              </Button>
            </header>
            <div className="record-answer-scroll">
              {!answers.length && (
                <p className="empty-inline record-empty">本场面试尚未保存 AI 回答。</p>
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
                    aria-label={`回答：${answer.question}`}
                  >
                    <div className="record-answer-meta">
                      <span>{ids.length ? '转录提问' : '手动提问'}</span>
                      <time>{time(answer.createdAt)}</time>
                    </div>
                    <p className="record-answer-question">{answer.question}</p>
                    {ids.length > 0 && (
                      <button className="record-answer-link" onClick={() => locate(ids[0])}>
                        <ArrowUpRight size={13} />
                        定位到原问题
                      </button>
                    )}
                    <div className="record-answer-content">
                      <h3>
                        <Sparkles size={14} />
                        AI 回答
                      </h3>
                      {answer.reasoningSummary && (
                        <details className="reasoning-summary">
                          <summary>推理摘要</summary>
                          <MarkdownContent content={answer.reasoningSummary} />
                        </details>
                      )}
                      {answer.content ? (
                        <MarkdownContent content={answer.content} />
                      ) : (
                        <p className="empty-inline">这条回答没有保存内容。</p>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          </aside>
        )}
      </div>
      {deleting && (
        <Modal
          destructive
          title="删除面试记录"
          onClose={() => setDeleting(false)}
          className="destructive-dialog"
        >
          <p>确定删除“{record.title}”？删除后无法恢复。</p>
          <div className="interview-start-actions">
            <Button variant="outline" data-autofocus onClick={() => setDeleting(false)}>
              取消
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (history.remove(record.id)) onBack();
              }}
            >
              确认删除
            </Button>
          </div>
        </Modal>
      )}
    </main>
  );
}
