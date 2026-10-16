import { useEffect, useState } from 'react';
import { History, ChevronDown } from './icons';
import { HistoryDetail } from './HistoryDetail';
import { useHistory } from '../stores/history';
import { historyStorageKey } from '../services/history';
export function HistoryPage() {
  const { records: allRecords, error, load } = useHistory();
  const records = allRecords.filter((record) => !record.mock);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const filtered = records.filter((record) =>
    record.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  );
  const selected = records.find((record) => record.id === selectedId);
  useEffect(() => {
    load();
    const changed = (event: StorageEvent) => {
      if (event.key === historyStorageKey) load();
    };
    window.addEventListener('storage', changed);
    window.addEventListener('focus', load);
    return () => {
      window.removeEventListener('storage', changed);
      window.removeEventListener('focus', load);
    };
  }, [load]);
  const date = (timestamp: number) =>
    new Date(timestamp).toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  if (selected)
    return <HistoryDetail key={selected.id} record={selected} onBack={() => setSelectedId(null)} />;
  return (
    <main className="workspace management-page">
      <header className="page-toolbar">
        <div className="breadcrumb">
          <strong>面试记录</strong>
        </div>
        <div className="toolbar-actions">
          <span className="count-label">{records.length} 场练习</span>
          <span className="mock-badge">
            <span />
            本地记录
          </span>
        </div>
      </header>
      <div className="management-scroll">
        <div className="management-container">
          {records.length > 0 && (
            <div className="history-filters" role="search" aria-label="筛选面试记录">
              <label>
                搜索标题
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="搜索面试记录"
                />
              </label>
              {query && (
                <button
                  onClick={() => {
                    setQuery('');
                  }}
                >
                  清除筛选
                </button>
              )}
              <span role="status">{filtered.length} 条结果</span>
            </div>
          )}
          {error && (
            <p role="alert" className="inline-error">
              {error}
            </p>
          )}
          {records.length === 0 ? (
            <div className="management-empty">
              <History size={36} />
              <h2>还没有面试记录</h2>
            </div>
          ) : (
            <div className="history-timeline">
              {!filtered.length && <p className="empty-inline">没有符合条件的面试记录。</p>}
              {filtered.map((record) => (
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
                        {record.status === 'ended' ? '已结束' : '已保存'}
                      </span>
                    </h2>
                    <p>
                      {Math.floor(Math.max(0, record.endedAt - record.startedAt) / 60000)} 分{' '}
                      {Math.floor(Math.max(0, record.endedAt - record.startedAt) / 1000) % 60} 秒 ·{' '}
                      {record.answers.filter((answer) => answer.provider !== 'mock').length} 个回答
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
