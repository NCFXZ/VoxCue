import type { UpdateCall } from '../../electron/contracts/updates';

export async function updateCall(op: UpdateCall['op']) {
  if (!window.desktop) throw Error('自动更新需要在 VoxCue 桌面应用中使用。');
  return window.desktop.updates({ op });
}
