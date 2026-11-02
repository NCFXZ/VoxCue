import { t } from '../i18n';
import { useEffect, useRef, useState } from 'react';
import { useCloudAccount } from '../stores/cloudAccount';
import { Button } from './ui/button';
import { Modal } from './ui/modal';
import { Trash, X } from './icons';
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
  const [deleteError, setDeleteError] = useState('');
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

  const blocked = busy || !state.configured;
  if (!state.user) return null;
  return (
    <section className="account-deletion-panel" aria-label={t('删除账号')}>
      <div className="settings-entry">
        <div>
          <strong>{t('删除账号')}</strong>
          <p className="settings-hint">{t('永久删除账号、云端及本机资料。')}</p>
        </div>
        <Button
          variant="dangerGhost"
          disabled={blocked}
          onClick={() => {
            setDeleting(true);
            setDeletePassword('');
            setAcknowledged(false);
            setDeleteError('');
          }}
        >
          <Trash size={16} />
          {t('删除账号')}
        </Button>
      </div>
      {deleting && (
        <Modal
          title={t('删除 VoxCue 账号')}
          className="account-delete-dialog"
          destructive
          initialFocus="close"
          onClose={() => {
            if (!busy) {
              setDeleting(false);
              setDeletePassword('');
            }
          }}
          footer={
            <>
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  setDeleting(false);
                  setDeletePassword('');
                }}
              >
                <X size={16} />
                {t('取消')}
              </Button>
              <Button
                variant="destructive"
                disabled={busy || !acknowledged || !deletePassword}
                onClick={() => void deleteAccount()}
              >
                <Trash size={16} />
                {busy ? t('正在删除…') : t('永久删除账号')}
              </Button>
            </>
          }
        >
          <p className="account-delete-warning">{t('云端及本机资料将永久删除，无法恢复。')}</p>
          <label className="cloud-account-form">
            {t('当前密码')}
            <input
              aria-label={t('删除账号密码')}
              type="password"
              autoComplete="current-password"
              maxLength={1024}
              value={deletePassword}
              disabled={busy}
              onChange={(e) => setDeletePassword(e.target.value)}
            />
          </label>
          <label className="account-delete-ack">
            <input
              type="checkbox"
              checked={acknowledged}
              disabled={busy}
              onChange={(e) => setAcknowledged(e.target.checked)}
            />
            <span>{t('我已了解，确认删除账号和资料')}</span>
          </label>
          {deleteError && (
            <p role="alert" className="danger-text">
              {t(deleteError)}
            </p>
          )}
        </Modal>
      )}
    </section>
  );
}
