import { SyncBadge } from './SyncBadge';
import { useEffect, useRef, useState } from 'react';
import { History, ChevronDown, X } from './icons';
import { Button } from './ui/button';
import { HistoryDetail } from './HistoryDetail';
import { useHistory } from '../stores/history';
import { historyStorageKey } from '../services/history';
export function HistoryPage() {
  const { records: allRecords, error, load } = useHistory();
  const records = allRecords.filter((record) => !record.mock);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [changing, setChanging] = useState(false);
  const searchInput = useRef<HTMLInputElement>(null);
  const transition = useRef(0);
  useEffect(() => () => window.clearTimeout(transition.current), []);
  const select = (id: string | null) => {
    if (changing) return;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setSelectedId(id);
      return;
    }
    setChanging(true);
    transition.current = window.setTimeout(() => {
      setSelectedId(id);
      requestAnimationFrame(() => requestAnimationFrame(() => setChanging(false)));
    }, 150);
  };
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
  return (
    <div className={`history-view${changing ? ' is-changing' : ''}`}>
      {selected ? (
        <HistoryDetail key={selected.id} record={selected} onBack={() => select(null)} />
      ) : (
        <main className="workspace management-page history-page">
          <header className="page-toolbar">
            <div className="breadcrumb history-heading-transition">
              <strong>面试记录</strong>
            </div>
          </header>
          <div className="management-scroll">
            <div className="management-container">
              {records.length > 0 && (
                <div className="history-filters" role="search" aria-label="筛选面试记录">
                  <div className="history-search-label">
                    <input
                      ref={searchInput}
                      type="search"
                      aria-label="搜索标题"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="搜索面试记录"
                    />
                    {query && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="history-search-clear"
                        aria-label="清除搜索"
                        data-reveal-on-hover
                        onClick={() => {
                          setQuery('');
                          searchInput.current?.focus();
                        }}
                      >
                        <X size={14} />
                      </Button>
                    )}
                  </div>
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
                    <div className="history-row-wrap" key={record.id}>
                      <div className="history-row">
                        <button
                          className="history-row-open"
                          aria-label={`查看面试记录：${record.title}`}
                          onClick={() => select(record.id)}
                        />
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
                            <span className="history-title-text">{record.title}</span>
                            <span className="neutral-badge">
                              {record.status === 'ended' ? '已结束' : '已保存'}
                            </span>
                            <SyncBadge itemKey={'record:' + record.id} label={record.title} />
                          </h2>
                          <p>
                            {Math.floor(Math.max(0, record.endedAt - record.startedAt) / 60000)} 分{' '}
                            {Math.floor(Math.max(0, record.endedAt - record.startedAt) / 1000) % 60}{' '}
                            秒 ·{' '}
                            {record.answers.filter((answer) => answer.provider !== 'mock').length}{' '}
                            个回答
                          </p>
                        </div>
                        <ChevronDown size={15} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </main>
      )}
    </div>
  );
}
