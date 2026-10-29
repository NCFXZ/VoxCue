import { useEffect, useRef, useState } from 'react';
import { exportAccountData } from '../services/accountExport';
import { Button } from './ui/button';
import { Export } from './icons';

export function AccountExportPanel() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const alive = useRef(true),
    locked = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  async function exportData() {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setMessage('');
    setError('');
    try {
      const saved = await exportAccountData();
      if (alive.current) setMessage(saved ? '资料已导出。' : '');
    } catch (error) {
      if (alive.current)
        setError(error instanceof Error ? error.message : '资料导出失败，请重试。');
    } finally {
      locked.current = false;
      if (alive.current) setBusy(false);
    }
  }
  return (
    <section className="account-export-panel" aria-label="导出资料">
      <div className="settings-entry">
        <div>
          <strong>导出资料</strong>
          <p className="settings-hint">导出个人信息、面试记录和知识库。</p>
        </div>
        <Button variant="outline" disabled={busy} onClick={() => void exportData()}>
          <Export size={16} />
          {busy ? '正在导出…' : '导出资料'}
        </Button>
      </div>
      {message && (
        <p role="status" className="settings-hint">
          {message}
        </p>
      )}
      {error && (
        <p role="alert" className="danger-text">
          {error}
        </p>
      )}
    </section>
  );
}
