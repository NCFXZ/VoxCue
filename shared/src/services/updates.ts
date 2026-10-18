import type { UpdateAction, UpdateCall } from '../../electron/contracts/updates';

export async function updateCall(call: UpdateAction | UpdateCall) {
  if (!window.desktop) throw Error('自动更新需要在 VoxCue 桌面应用中使用。');
  return window.desktop.updates(typeof call === 'string' ? { op: call } : call);
}
