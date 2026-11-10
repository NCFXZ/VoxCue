import { useEffect, useMemo, useState } from 'react';
import qrcode from 'qrcode-generator';
import { t } from '../i18n';
import { useRemoteConnection } from '../stores/remoteConnection';
import { Button } from './ui/button';
import { ConfirmDisconnectButton } from './ui/confirm-delete-button';
import { Modal } from './ui/modal';
import { Check, Copy, Link, Loader, Refresh, Settings } from './icons';

function openPairing() {
  const remote = useRemoteConnection.getState();
  remote.setDialogOpen(true);
  if (!remote.state || remote.state.status === 'off' || remote.state.status === 'error')
    void remote.start();
  else void remote.refreshPairing();
}

export async function failRemoteDialogPreparation(context: {
  owner: 'main' | 'interview';
  pairingUrl?: string;
  pendingId?: string;
  dialogOpen: boolean;
}) {
  const remote = useRemoteConnection.getState();
  if ((remote.state?.presentationOwner ?? 'main') !== context.owner || remote.state?.status === 'connected')
    return;
  const ownsPending = !!context.pendingId && remote.state?.pending?.id === context.pendingId;
  const ownsPairing = context.dialogOpen && remote.dialogOpen && remote.pairing?.url === context.pairingUrl;
  if (!ownsPending && !ownsPairing) return;
  if (ownsPairing) remote.setDialogOpen(false);
  if (ownsPending) await remote.reject(context.pendingId!).catch(() => {});
  const latest = useRemoteConnection.getState();
  if (
    (latest.state?.presentationOwner ?? 'main') !== context.owner ||
    latest.state?.status === 'connected' ||
    (latest.state?.pending && latest.state.pending.id !== context.pendingId) ||
    latest.pairing?.url !== context.pairingUrl
  ) return;
  useRemoteConnection.setState({ error: '窗口切换失败，请重试。' });
}

export function RemoteConnectionStatus() {
  const connected = useRemoteConnection((remote) => remote.state?.status === 'connected');
  return (
    <span className="remote-connection-status" role="status">
      {connected && <Check size={14} />}
      {t(connected ? '已连接' : '未连接')}
    </span>
  );
}

export function RemoteConnectionIndicator() {
  const connected = useRemoteConnection((remote) => remote.state?.status === 'connected');
  if (!connected) return null;
  return (
    <span
      className="interview-ready-badge"
      data-state="normal"
      role="status"
      aria-live="off"
      aria-label={t('设备已连接')}
    >
      <span className="interview-ready-badge-label">{t('设备')}</span>
      <span className="interview-readiness-symbol" aria-hidden="true">
        <span data-active={true}><Check size={14} /></span>
      </span>
    </span>
  );
}

export function RemoteConnectionRecovery({ onSettings }: { onSettings(): void }) {
  const { state, interrupted, loading } = useRemoteConnection();
  if (!interrupted || !state || state.status === 'connected' || state.status === 'off') return null;
  return (
    <div className="audio-recovery" role="alert">
      <div>
        <strong>{t('设备连接已中断')}</strong>
        <p>{t('电脑继续转录和回答。设备恢复网络后可重新连接。')}</p>
      </div>
      <Button variant="outline" disabled={loading} onClick={openPairing}>
        <Refresh size={15} />
        {t(loading ? '连接中…' : '重新连接设备')}
      </Button>
      <Button variant="ghost" disabled={loading} onClick={onSettings}>
        <Settings size={15} />
        {t('设置')}
      </Button>
    </div>
  );
}

export function RemoteConnectionSettings({ disabled = false }: { disabled?: boolean }) {
  const { state, loading, error, disconnect } = useRemoteConnection();
  const connected = state?.status === 'connected';
  return (
    <section className="speech-settings-section remote-connection-settings">
      <div className="speech-setting-row">
        <div className="remote-connection-summary">
          <h3 className="speech-setting-label">{t('远程连接')}</h3>
          <p className="remote-connection-description">
            {t('另一台设备查看实时转录和问答，并控制麦克风与自动回答。')}
          </p>
        </div>
        <div className="remote-connection-actions">
          {connected ? (
            <ConfirmDisconnectButton
              iconOnly={false}
              target={state.clientName || t('已连接的设备')}
              revision={state.revision}
              disabled={disabled || loading}
              warning="设备将停止接收本场内容和控制电脑"
              onConfirm={async () => {
                await disconnect();
                return !useRemoteConnection.getState().error;
              }}
            />
          ) : (
            <Button variant="outline" disabled={disabled || loading} onClick={openPairing}>
              {loading ? <Loader size={16} /> : <Link size={16} />}
              {t(loading ? '连接中…' : '连接设备')}
            </Button>
          )}
        </div>
      </div>
      {error && <p className="danger-text" role="alert">{t(error)}</p>}
    </section>
  );
}

export function RemotePairingCode({ url }: { url: string }) {
  const matrix = useMemo(() => {
    const code = qrcode(0, 'M');
    code.addData(url);
    code.make();
    const size = code.getModuleCount();
    let path = '';
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++)
        if (code.isDark(y, x)) path += `M${x + 4} ${y + 4}h1v1h-1z`;
    return { size: size + 8, path };
  }, [url]);
  return (
    <svg
      className="remote-pairing-code"
      viewBox={`0 0 ${matrix.size} ${matrix.size}`}
      role="img"
      aria-label={t('设备连接二维码')}
      shapeRendering="crispEdges"
    >
      <rect width={matrix.size} height={matrix.size} fill="#fff" />
      <path d={matrix.path} fill="#000" />
    </svg>
  );
}

function PairingContent() {
  const { state, pairing, loading, error } = useRemoteConnection();
  const [now, setNow] = useState(Date.now);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  useEffect(() => {
    setNow(Date.now());
    setCopied(false);
    setCopyError(false);
    if (!pairing) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [pairing?.url, pairing?.expiresAt]);
  const expired = !!pairing && pairing.expiresAt <= now;
  return (
    <>
      <div className="remote-pairing-visual" aria-busy={loading}>
        {pairing && !expired ? (
          <RemotePairingCode url={pairing.url} />
        ) : (
          <div className="remote-pairing-placeholder" role="status">
            {loading ? <Loader size={24} /> : <Link size={24} />}
            <span>{t(loading ? '正在准备连接…' : expired ? '二维码已过期' : '尚未生成二维码')}</span>
          </div>
        )}
        {pairing && !expired && (
          <p className="remote-pairing-expiry" role="status" aria-live="off">
            {t('二维码将在 {0} 秒后过期', [Math.max(0, Math.ceil((pairing.expiresAt - now) / 1000))])}
          </p>
        )}
      </div>
      {pairing && !expired && (
        <label className="remote-pairing-address">
          <span>{t('连接网址')}</span>
          <div>
            <input readOnly value={pairing.url} aria-label={t('连接网址')} />
            <Button
              variant="ghost"
              size="icon"
              aria-label={t(copied ? '已复制连接网址' : '复制连接网址')}
              onClick={() => {
                void navigator.clipboard.writeText(pairing.url).then(
                  () => {
                    setCopied(true);
                    setCopyError(false);
                  },
                  () => setCopyError(true),
                );
              }}
            >
              {copied ? <Check size={16} /> : <Copy size={16} />}
            </Button>
          </div>
        </label>
      )}
      {(error || state?.error || copyError) && (
        <p className="danger-text" role="alert">
          {t(error || state?.error || '复制失败，请手动选择连接网址。')}
        </p>
      )}
      <div className="remote-pairing-refresh">
        <Button variant="outline" disabled={loading} onClick={openPairing}>
          <Refresh size={16} />
          {t('刷新二维码')}
        </Button>
      </div>
      <section className="remote-pairing-guide" aria-label={t('连接教程')}>
        <h3>{t('连接教程')}:</h3>
        <ul>
          <li>{t('让另一台设备与此电脑连接同一Wi-Fi。')}</li>
          <li>{t('扫描二维码，或在浏览器中打开连接网址。')}</li>
          <li>{t('核对两端显示的配对码，再在电脑上允许连接。')}</li>
        </ul>
        <p className="remote-pairing-network-hint">{t('无法访问？请检查设备互访及专用网络防火墙。')}</p>
      </section>
    </>
  );
}

export function RemoteConnectionDialogs({
  onVisibilityChange,
}: {
  onVisibilityChange?(open: boolean): Promise<void>;
}) {
  const { state, pairing, dialogOpen, setDialogOpen, loading, error, approve, reject } = useRemoteConnection();
  const owner = typeof window !== 'undefined' && window.location?.hash === '#interview'
    ? 'interview'
    : 'main';
  const active = (state?.presentationOwner ?? 'main') === owner;
  const visible = active && state?.status !== 'connected' && (!!state?.pending || dialogOpen);
  const [prepared, setPrepared] = useState(!onVisibilityChange);
  useEffect(() => {
    if (!onVisibilityChange) return;
    let current = true;
    if (!visible) setPrepared(false);
    void onVisibilityChange(visible).then(
      () => { if (current && visible) setPrepared(true); },
      () => {
        if (!current || !visible) return;
        setPrepared(false);
        void failRemoteDialogPreparation({
          owner, pairingUrl: pairing?.url, pendingId: state?.pending?.id, dialogOpen,
        });
      },
    );
    return () => { current = false; };
  }, [visible, onVisibilityChange, owner, pairing?.url, state?.pending?.id, dialogOpen]);
  useEffect(() => {
    if ((state?.status === 'connected' || !active) && dialogOpen) setDialogOpen(false);
  }, [state?.status, dialogOpen, setDialogOpen, active]);
  if (!visible || !prepared) return null;
  const dialogClass = owner === 'interview'
    ? 'remote-connection-dialog interview-settings-dialog'
    : 'remote-connection-dialog';
  const backdrop = owner === 'interview' ? 'transparent' : 'viewport';
  if (state?.pending) {
    const pending = state.pending;
    return (
      <Modal
        title={t('允许设备连接？')}
        className={dialogClass}
        backdrop={backdrop}
        onClose={() => void reject(pending.id)}
        footer={
          <div className="remote-approval-actions">
            <Button variant="ghost" disabled={loading} onClick={() => void reject(pending.id)}>
              {t('拒绝')}
            </Button>
            <Button disabled={loading} onClick={() => void approve(pending.id)}>
              {loading && <Loader size={16} />}
              {t('允许连接')}
            </Button>
          </div>
        }
      >
        <p>{t('请确认设备上的配对码与下方一致。')}</p>
        <strong className="remote-approval-code">{pending.code}</strong>
        <p>{t('允许后，设备可查看本场转录和回答，并发送问题、控制麦克风与自动回答。')}</p>
        {error && <p className="danger-text" role="alert">{t(error)}</p>}
      </Modal>
    );
  }
  if (dialogOpen)
    return (
      <Modal
        title={t('连接设备')}
        className={dialogClass}
        backdrop={backdrop}
        onClose={() => setDialogOpen(false)}
      >
        <PairingContent />
      </Modal>
    );
  return null;
}
