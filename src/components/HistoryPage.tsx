import { useEffect, useState } from 'react';
import { History, ChevronDown, MessageSquare, Sparkles } from './icons';
import { Button } from './ui/button';
import { useHistory } from '../stores/history';
import { historyExamples } from '../services/historyExamples';
export function HistoryPage() {
  const { records, error, load, remove } = useHistory();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showExamples, setShowExamples] = useState(false);
  const displayRecords = showExamples ? historyExamples : records;
  const selected = displayRecords.find((record) => record.id === selectedId);
  useEffect(() => {
    load();
  }, [load]);
  const date = (timestamp: number) =>
    new Date(timestamp).toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  return (
    <main className="workspace management-page">
      <header className="page-toolbar">
        <div className="breadcrumb">
          工作空间<span>/</span>
          <strong>面试记录</strong>
        </div>
        <div className="toolbar-actions">
          <span className="count-label">
            {displayRecords.length} {showExamples ? '条示例' : '场练习'}
          </span>
          <Button
            variant="ghost"
            onClick={() => {
              setShowExamples(!showExamples);
              setSelectedId(null);
              setConfirmDelete(false);
            }}
          >
            {showExamples ? '返回我的记录' : '查看示例记录'}
          </Button>
          <span className="mock-badge">
            <span />
            本地 · Mock 记录
          </span>
        </div>
      </header>
      <div className="management-scroll">
        <div className="management-container">
          {error && (
            <p role="alert" className="inline-error">
              {error}
            </p>
          )}
          {selected ? (
            <section className="record-detail">
              <Button
                variant="ghost"
                onClick={() => {
                  setSelectedId(null);
                  setConfirmDelete(false);
                }}
              >
                ← 返回记录
              </Button>
              <div className="detail-heading">
                <div>
                  <h2>{selected.title}</h2>
                  <p>{date(selected.startedAt)} · 简体中文 · 模拟面试</p>
                </div>
                {!showExamples && (
                  <Button variant="outline" onClick={() => setConfirmDelete(true)}>
                    删除记录
                  </Button>
                )}
              </div>
              {confirmDelete && (
                <div className="delete-confirm" role="alert">
                  <span>确定删除这场练习？删除后无法恢复。</span>
                  <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
                    取消
                  </Button>
                  <Button
                    onClick={() => {
                      if (remove(selected.id)) {
                        setSelectedId(null);
                        setConfirmDelete(false);
                      }
                    }}
                  >
                    确认删除
                  </Button>
                </div>
              )}
              <div className="record-columns">
                <section>
                  <h3>
                    <MessageSquare size={16} />
                    面试转写
                  </h3>
                  {selected.transcripts.length === 0 && (
                    <p className="empty-inline">本场练习使用手动提问，没有语音转写。</p>
                  )}
                  {selected.transcripts.map((t) => (
                    <article key={t.id} className="saved-transcript">
                      <span>
                        模拟面试官 <time>{t.time}</time>
                        {!t.final && ' · 未完成'}
                      </span>
                      <p>{t.text}</p>
                    </article>
                  ))}
                </section>
                <section>
                  <h3>
                    <Sparkles size={16} />
                    AI 回答 · 模拟
                  </h3>
                  {selected.answers.length === 0 && (
                    <p className="empty-inline">本场练习尚未生成回答。</p>
                  )}
                  {selected.answers.map((a) => (
                    <article key={a.id} className="saved-answer">
                      <h4>{a.question}</h4>
                      <p>{a.content || '回答生成前练习已结束。'}</p>
                    </article>
                  ))}
                </section>
              </div>
            </section>
          ) : displayRecords.length === 0 ? (
            <div className="management-empty">
              <History size={36} />
              <h2>还没有面试记录</h2>
              <Button variant="outline" onClick={() => setShowExamples(true)}>
                查看示例
              </Button>
            </div>
          ) : (
            <div className="history-timeline">
              {displayRecords.map((record) => (
                <button
                  key={record.id}
                  className="history-row"
                  onClick={() => setSelectedId(record.id)}
                >
                  <div className="history-date">
                    <strong>{date(record.startedAt)}</strong>
                    <span>
                      {new Date(record.startedAt).toLocaleTimeString('zh-CN', {
                        hour: '2-digit',
                        minute: '2-digit',
                        hour12: false,
                      })}
                    </span>
                  </div>
                  <span className="timeline-dot" />
                  <div className="history-summary">
                    <h2>
                      {record.title}
                      <span className="neutral-badge">
                        {showExamples
                          ? '模拟示例'
                          : record.status === 'ended'
                            ? '已结束'
                            : '已保存'}
                      </span>
                    </h2>
                    <p>
                      {Math.floor(Math.max(0, record.endedAt - record.startedAt) / 60000)} 分{' '}
                      {Math.floor(Math.max(0, record.endedAt - record.startedAt) / 1000) % 60} 秒 ·{' '}
                      {record.answers.length} 个回答 · 中文（简体）
                    </p>
                  </div>
                  <ChevronDown size={15} />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
