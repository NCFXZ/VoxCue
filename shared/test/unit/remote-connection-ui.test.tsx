import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { RemoteConnectionState } from '../../electron/contracts/remoteConnection';
const current = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
vi.mock('../../src/stores/remoteConnection', () => ({
  useRemoteConnection: Object.assign(
    (selector?: (value: Record<string, unknown>) => unknown) =>
      selector ? selector(current.value) : current.value,
    {
      getState: () => current.value,
      setState: (patch: Record<string, unknown>) => Object.assign(current.value, patch),
    },
  ),
}));
import { useRemoteConnection } from '../../src/stores/remoteConnection';
import { useGeneralSettings } from '../../src/stores/generalSettings';
import {
  RemoteConnectionDialogs,
  RemoteConnectionIndicator,
  RemoteConnectionSettings,
  RemoteConnectionStatus,
  RemoteConnectionRecovery,
  failRemoteDialogPreparation,
} from '../../src/components/RemoteConnection';

const state = (patch: Partial<RemoteConnectionState> = {}): RemoteConnectionState => ({
  presentationOwner: 'main',
  status: 'off',
  revision: 1,
  addresses: [],
  clientName: null,
  pending: null,
  error: null,
  ...patch,
});

beforeEach(() => {
  vi.stubGlobal('window', { location: { hash: '' } });
  useGeneralSettings.setState({ language: 'zh-CN' });
  useRemoteConnection.setState({
    state: state(),
    pairing: null,
    loading: false,
    error: null,
    dialogOpen: false,
    interrupted: false,
    setDialogOpen: vi.fn((open: boolean) => { current.value.dialogOpen = open; }),
    reject: vi.fn(async () => {}),
  });
});
afterEach(() => vi.unstubAllGlobals());

it('shows a device capsule only for an established connection and keeps the start status read only', () => {
  expect(renderToStaticMarkup(<RemoteConnectionIndicator />)).toBe('');
  const disconnected = renderToStaticMarkup(<RemoteConnectionStatus />);
  expect(disconnected).toContain('未连接');
  expect(disconnected).toContain('<svg');
  expect(disconnected.indexOf('</svg>')).toBeLessThan(disconnected.indexOf('未连接'));
  expect(disconnected).not.toContain('<button');
  useRemoteConnection.setState({ state: state({ status: 'connected', clientName: 'My phone' }) });
  const badge = renderToStaticMarkup(<RemoteConnectionIndicator />);
  expect(badge).toContain('class="interview-ready-badge" data-state="normal"');
  expect(badge).toContain('aria-label="设备已连接"');
  expect(badge).toContain('class="interview-ready-badge-label">设备</span>');
  useGeneralSettings.setState({ language: 'en' });
  expect(renderToStaticMarkup(<RemoteConnectionStatus />)).toContain('Connected');
});

it('uses the existing two step confirmation control for disconnecting', () => {
  expect(renderToStaticMarkup(<RemoteConnectionSettings />)).toContain('连接设备');
  useRemoteConnection.setState({ state: state({ status: 'connected', clientName: 'My phone' }) });
  const html = renderToStaticMarkup(<RemoteConnectionSettings />);
  expect(html).toContain('confirm-delete-control');
  expect(html).toContain('断开连接：My phone');
  expect(html).toContain('确认断开连接');
  expect(html).not.toContain('删除');
});

it('renders pairing locally with a selectable URL and a guide, without external image requests', () => {
  const url = 'http://192.168.1.2:41000/#pair=synthetic-pairing';
  useRemoteConnection.setState({
    state: state({ status: 'waiting' }),
    pairing: { url, expiresAt: Date.now() + 60_000 },
    dialogOpen: true,
  });
  const html = renderToStaticMarkup(<RemoteConnectionDialogs />);
  expect(html).toContain('aria-label="设备连接二维码"');
  expect(html).toContain('让另一台设备与此电脑连接同一Wi-Fi。');
  expect(html).not.toContain('热点');
  expect(html).not.toContain('手机');
  expect(html.match(/<input[^>]*aria-label="连接网址"[^>]*>/)?.[0]).toContain(`value="${url}"`);
  expect(html).toContain('连接教程');
  expect(html).toContain('class="remote-pairing-network-hint"');
  expect(html).toContain('无法访问？请检查设备互访及专用网络防火墙。');
  expect(html).not.toMatch(/<(img|iframe)\b/);
  useRemoteConnection.setState({ pairing: { url, expiresAt: Date.now() - 1 } });
  const expired = renderToStaticMarkup(<RemoteConnectionDialogs />);
  expect(expired).toContain('二维码已过期');
  expect(expired).toContain('刷新二维码');
  expect(expired).not.toContain(url);
  useRemoteConnection.setState({ state: state({ status: 'connected', clientName: 'Synthetic phone' }) });
  expect(renderToStaticMarkup(<RemoteConnectionDialogs />)).toBe('');
});

it('requires approval without displaying the device name and shows it only in the owning window', () => {
  useRemoteConnection.setState({
    state: state({
      status: 'waiting',
      pending: { id: 'synthetic-device', name: '<script>untrusted</script>', code: '123456' },
    }),
  });
  const html = renderToStaticMarkup(<RemoteConnectionDialogs />);
  expect(html).toContain('123456');
  expect(html).not.toContain('untrusted');
  expect(html).not.toContain('<script>');
  expect(html).toContain('允许连接');
  expect(html).toContain('拒绝');
  vi.stubGlobal('window', { location: { hash: '#interview' } });
  expect(renderToStaticMarkup(<RemoteConnectionDialogs />)).toBe('');
});

it('keeps interruption silent outside the interview while preserving explicitly opened pairing', () => {
  useRemoteConnection.setState({ state: state({ status: 'reconnecting' }), interrupted: true });
  expect(renderToStaticMarkup(<RemoteConnectionDialogs />)).toBe('');
  useRemoteConnection.setState({ state: state({ status: 'waiting' }) });
  expect(renderToStaticMarkup(<RemoteConnectionDialogs />)).toBe('');
  useRemoteConnection.setState({ dialogOpen: true });
  expect(renderToStaticMarkup(<RemoteConnectionDialogs />)).toContain('连接设备');
  useRemoteConnection.setState({ dialogOpen: false });
  useRemoteConnection.setState({ state: state({ status: 'off' }) });
  expect(renderToStaticMarkup(<RemoteConnectionDialogs />)).toBe('');
});

it('renders interview device interruption inline without activating a recovery modal and retains expired resume access', () => {
  vi.stubGlobal('window', { location: { hash: '#interview' } });
  useRemoteConnection.setState({
    state: state({ presentationOwner: 'interview', status: 'reconnecting' }), interrupted: true,
  });
  expect(renderToStaticMarkup(<RemoteConnectionDialogs />)).toBe('');
  const render = () => renderToStaticMarkup(<RemoteConnectionRecovery onSettings={() => {}} />);
  const html = render();
  expect(html).toContain('class="audio-recovery" role="alert"');
  expect(html).toContain('aria-label="关闭提示"');
  expect(html).toContain('设备连接已中断');
  expect(html).toContain('电脑继续转录和回答。设备恢复网络后可重新连接。');
  expect(html).toContain('重新连接设备');
  expect(html).toContain('设置');
  expect(html).not.toContain('<dialog');
  useRemoteConnection.setState({ state: state({ status: 'waiting' }) });
  expect(render()).toContain('重新连接设备');
  useRemoteConnection.setState({ interrupted: false });
  expect(render()).toBe('');
  useRemoteConnection.setState({ state: state({ status: 'error' }) });
  expect(render()).toBe('');
  useRemoteConnection.setState({ state: state({ status: 'off' }), interrupted: true });
  expect(render()).toBe('');
});

it('closes only the failed QR request and reports the native window error without touching connection actions', async () => {
  const url = 'http://192.168.1.2:41000/#pair=synthetic-current';
  useRemoteConnection.setState({
    state: state({ status: 'waiting' }),
    pairing: { url, expiresAt: Date.now() + 60_000 },
    dialogOpen: true,
  });
  await failRemoteDialogPreparation({ owner: 'main', pairingUrl: url, dialogOpen: true });
  expect(useRemoteConnection.getState().dialogOpen).toBe(false);
  expect(useRemoteConnection.getState().error).toBe('窗口切换失败，请重试。');
  expect(useRemoteConnection.getState().reject).not.toHaveBeenCalled();
  useRemoteConnection.setState({ dialogOpen: true, error: null });
  await failRemoteDialogPreparation({ owner: 'main', pairingUrl: 'expired-url', dialogOpen: true });
  expect(useRemoteConnection.getState().dialogOpen).toBe(true);
  expect(useRemoteConnection.getState().error).toBeNull();
});

it('rejects only its failed pending request and ignores a newer request, another window, or an established phone', async () => {
  const reject = vi.fn(async () => {
    useRemoteConnection.setState({ state: state({ status: 'waiting' }) });
  });
  useRemoteConnection.setState({
    state: state({ status: 'waiting', pending: { id: 'current', name: 'Synthetic phone', code: '123456' } }),
    reject,
  });
  const context = { owner: 'main' as const, pendingId: 'current', dialogOpen: false };
  await failRemoteDialogPreparation({ ...context, pendingId: 'old' });
  await failRemoteDialogPreparation({ ...context, owner: 'interview' });
  expect(reject).not.toHaveBeenCalled();
  await failRemoteDialogPreparation(context);
  expect(reject).toHaveBeenCalledExactlyOnceWith('current');
  expect(useRemoteConnection.getState().error).toBe('窗口切换失败，请重试。');
  useRemoteConnection.setState({ state: state({ status: 'connected', clientName: 'Synthetic phone' }), error: null });
  await failRemoteDialogPreparation(context);
  expect(reject).toHaveBeenCalledTimes(1);
  expect(useRemoteConnection.getState().state?.status).toBe('connected');
  expect(useRemoteConnection.getState().error).toBeNull();
});
