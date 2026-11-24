import { InterviewReveal } from './InterviewReveal';
import { t, uiLocale } from '../i18n';
import { SyncBadge } from './SyncBadge';
import { useCallback, useEffect, useRef, useState } from 'react';
import { History, ChevronDown, X } from './icons';
import { Button } from './ui/button';
import { HistoryDetail } from './HistoryDetail';
import { useHistory } from '../stores/history';
import { subscribeHistoryChanges, type InterviewRecord } from '../services/history';
import { recordFeature } from '../services/telemetry';
import { switchView } from './ui/switchView';
export function HistoryPage() {
  const { records: allRecords, error, load, remove, getRecord } = useHistory();
  const records = allRecords.filter((record) => !record.mock);
  const [selected, setSelected] = useState<InterviewRecord | null>(null);
  const selectedId = selected?.id;
  const loadedRevision = useRef<string | undefined>(undefined);
  const selectedRevision = allRecords.find(record => record.id === selectedId)?.revision;
  const requestedSelection = useRef<string | null>(null);
  const deletingRecord = useRef<InterviewRecord | null>(null);
  const view = useRef<HTMLDivElement>(null);
  // The detail replaces this scroll node; restore it before the new view is painted.
  const listScroll = useRef<HTMLDivElement | null>(null);
  const listScrollTop = useRef(0);
  const restoreListScroll = useCallback((node: HTMLDivElement | null) => {
    listScroll.current = node;
    if (node) node.scrollTop = listScrollTop.current;
  }, []);
  const searchInput = useRef<HTMLInputElement>(null);
  const select = async (id: string | null) => {
    if (requestedSelection.current === id) return;
    if (id && listScroll.current) listScrollTop.current = listScroll.current.scrollTop;
    requestedSelection.current = id;
    const record = id ? await getRecord(id) : null;
    if (!view.current || requestedSelection.current !== id) return;
    if (id && !record) { requestedSelection.current = null; return; }
    if (id) recordFeature('history_view');
    switchView(
      view.current,
      () => {
        deletingRecord.current = null;
        loadedRevision.current = allRecords.find(row => row.id === id)?.revision;
        setSelected(record ?? null);
      },
      id ? 'forward' : 'back',
    );
  };
  const [query, setQuery] = useState('');
  const filtered = records.filter((record) =>
    record.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  );
  useEffect(() => {
    if (!selectedId || deletingRecord.current || loadedRevision.current === selectedRevision) return;
    let active = true;
    if (selectedRevision === undefined) {
      requestedSelection.current = null;
      setSelected(null);
    } else {
      void getRecord(selectedId).then((record) => {
        if (active && record && requestedSelection.current === selectedId) {
          loadedRevision.current = selectedRevision;
          setSelected(record);
        }
      });
    }
    return () => { active = false; };
  }, [selectedRevision, selectedId, getRecord]);
  const removeSelected = async () => {
    if (!selected) return false;
    const record = selected;
    // Keep the outgoing detail stable while local deletion/screenshot cleanup
    // publishes its store changes; the view transition captures it only once.
    deletingRecord.current = record;
    const saved = await remove(record.id);
    if (saved && view.current && requestedSelection.current === record.id) select(null);
    else if (deletingRecord.current?.id === record.id) deletingRecord.current = null;
    return saved;
  };
  useEffect(() => {
    load();
    void useHistory.getState().recoverDrafts();
    void useHistory.getState().recoverRecordings();
    const unsubscribe = subscribeHistoryChanges(load);
    window.addEventListener('focus', load);
    return () => {
      unsubscribe();
      window.removeEventListener('focus', load);
    };
  }, [load]);
  const date = (timestamp: number) =>
    new Date(timestamp).toLocaleDateString(uiLocale(), {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  return (
    <div className="history-view" ref={view}>
      {selected ? (
        <HistoryDetail
          key={selected.id}
          record={selected}
          onBack={() => select(null)}
          onDelete={removeSelected}
        />
      ) : (
        <main className="workspace management-page history-page">
          <header className="page-toolbar">
            <div className="breadcrumb">
              <strong>{t('面试记录')}</strong>
            </div>
          </header>
          <div className="management-scroll" ref={restoreListScroll}>
            <div className="management-container">
              {records.length > 0 && (
                <div className="history-filters" role="search" aria-label={t('筛选面试记录')}>
                  <div className="history-search-label">
                    <input
                      ref={searchInput}
                      type="search"
                      aria-label={t('搜索标题')}
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder={t('搜索面试记录')}
                    />
                    {query && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="history-search-clear"
                        aria-label={t('清除搜索')}
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
                  <span role="status">
                    {filtered.length}
                    {t(' 条结果')}
                  </span>
                </div>
              )}
              <InterviewReveal resizeKey={error ?? ''}>
                {error ? (
                  <p role="alert" className="inline-error">
                    {t(error)}
                  </p>
                ) : null}
              </InterviewReveal>
              {records.length === 0 ? (
                <div className="management-empty">
                  <History size={36} />
                  <h2>{t('还没有面试记录')}</h2>
                </div>
              ) : (
                <div className="history-timeline">
                  {!filtered.length && (
                    <p className="empty-inline">{t('没有符合条件的面试记录。')}</p>
                  )}
                  {filtered.map((record) => (
                    <div className="history-row-wrap" key={record.id}>
                      <div className="history-row">
                        <button
                          className="history-row-open"
                          aria-label={t(`查看面试记录：${record.title}`)}
                          onClick={() => select(record.id)}
                        />
                        <div className="history-date">
                          <strong>{date(record.startedAt)}</strong>
                          <span>
                            {new Date(record.startedAt).toLocaleTimeString(uiLocale(), {
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
                              {record.status === 'ended' ? t('已结束') : t('已保存')}
                            </span>
                            <SyncBadge itemKey={'record:' + record.id} label={record.title} />
                          </h2>
                          <p>
                            {Math.floor(Math.max(0, record.endedAt - record.startedAt) / 60000)}
                            {t(' 分')}{' '}
                            {Math.floor(Math.max(0, record.endedAt - record.startedAt) / 1000) % 60}{' '}
                            {t('秒 ·')}{' '}
                            {record.answerCount === 1 ? t('1 个回答') : t('{0} 个回答', [record.answerCount])}
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
