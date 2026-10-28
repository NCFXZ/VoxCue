import { useEffect, useRef, useState } from 'react';
import { useCloudAccount } from '../stores/cloudAccount';
import { saveAccountData } from '../services/accountExport';
import { Button } from './ui/button';
import { Modal } from './ui/modal';
import { Download, Trash, X } from './icons';
export function AccountDeletionPanel() {
  const { state } = useCloudAccount();
  const [busy, setBusy] = useState(false);
  const alive = useRef(true),
    locked = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const [deleting, setDeleting] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [exportMessage, setExportMessage] = useState('');
  async function exportData() {
    if (locked.current) return;
    locked.current = true;
    setExportBusy(true);
    setDeleteError('');
    setExportMessage('');
    try {
      const saved = await saveAccountData();
      if (alive.current)
        setExportMessage(
          saved ? '资料已保存。您仍需单独确认是否删除账号。' : '已取消保存，账号和资料未删除。',
        );
    } catch (error) {
      if (alive.current)
        setDeleteError(error instanceof Error ? error.message : '资料保存失败，账号未删除。');
    } finally {
      locked.current = false;
      if (alive.current) setExportBusy(false);
    }
  }
  async function deleteAccount() {
    if (locked.current || !acknowledged || !deletePassword) return;
    locked.current = true;
    setBusy(true);
    setDeleteError('');
    try {
      const result = await useCloudAccount
        .getState()
        .call({ action: 'delete', password: deletePassword, confirm: 'DELETE' });
      if (alive.current && !result.ok) setDeleteError(result.error);
    } catch {
      if (alive.current) setDeleteError('删除未能完成，请重试。');
    } finally {
      locked.current = false;
      if (alive.current) setBusy(false);
    }
  }

  const blocked = busy || exportBusy || !state.configured;
  if (!state.user) return null;
  return (
    <section className="account-deletion-panel" aria-label="删除账号">
      <div className="settings-entry">
        <div>
          <strong>删除账号</strong>
          <p className="settings-hint">永久删除账号、云端及本机资料。</p>
        </div>
        <Button
          variant="dangerGhost"
          disabled={blocked}
          onClick={() => {
            setDeleting(true);
            setDeletePassword('');
            setAcknowledged(false);
            setDeleteError('');
            setExportMessage('');
          }}
        >
          <Trash size={16} />
          删除账号
        </Button>
      </div>
      {deleting && (
        <Modal
          title="删除 VoxCue 账号"
          className="account-delete-dialog"
          destructive
          initialFocus="close"
          onClose={() => {
            if (!busy && !exportBusy) {
              setDeleting(false);
              setDeletePassword('');
            }
          }}
          footer={
            <>
              <Button
                variant="ghost"
                disabled={busy || exportBusy}
                onClick={() => {
                  setDeleting(false);
                  setDeletePassword('');
                }}
              >
                <X size={16} />
                取消
              </Button>
              <Button
                variant="destructive"
                disabled={busy || exportBusy || !acknowledged || !deletePassword}
                onClick={() => void deleteAccount()}
              >
                <Trash size={16} />
                {busy ? '正在删除…' : '永久删除账号'}
              </Button>
            </>
          }
        >
          <p className="account-delete-warning">云端及本机资料将永久删除，无法恢复。</p>
          <p className="settings-hint">后台仅保留邮箱、用户 ID 和注册/注销时间，标记“已注销”。</p>
          <p className="settings-hint">
            其他设备副本、另存文件和外部 AI 账号不变；离线灾备按保留周期清除。
          </p>
          <div className="settings-entry account-delete-export">
            <div>
              <strong>保存资料</strong>
              <p className="settings-hint">保存个人信息、面试记录和知识库。</p>
            </div>
            <Button
              variant="outline"
              disabled={busy || exportBusy}
              onClick={() => void exportData()}
            >
              <Download size={16} />
              {exportBusy ? '正在保存…' : '保存资料'}
            </Button>
          </div>
          {exportMessage && (
            <p role="status" className="settings-hint">
              {exportMessage}
            </p>
          )}
          <label className="cloud-account-form">
            当前密码
            <input
              aria-label="删除账号密码"
              type="password"
              autoComplete="current-password"
              maxLength={1024}
              value={deletePassword}
              disabled={busy || exportBusy}
              onChange={(e) => setDeletePassword(e.target.value)}
            />
          </label>
          <label className="account-delete-ack">
            <input
              type="checkbox"
              checked={acknowledged}
              disabled={busy || exportBusy}
              onChange={(e) => setAcknowledged(e.target.checked)}
            />
            <span>我已了解，确认删除账号和资料</span>
          </label>
          {deleteError && (
            <p role="alert" className="danger-text">
              {deleteError}
            </p>
          )}
        </Modal>
      )}
    </section>
  );
}
