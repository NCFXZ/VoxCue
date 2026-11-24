import type { UpdateAction, UpdateCall } from '../../electron/contracts/updates';
import type { UILanguage } from '../../electron/contracts/uiLanguage';

const noticeKey = 'voxcue-update-notice-v1';
type NoticeStorage = Pick<Storage, 'getItem' | 'setItem'>;
const stableVersion = (value: unknown): value is string =>
  typeof value === 'string' && value.length <= 80 &&
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:\+[\w.-]+)?$/.test(value) &&
  value.split('+')[0].split('.').every(part => Number.isSafeInteger(Number(part)));

export const releaseNotesUrl = (language: UILanguage) =>
  `https://voxcue.com.cn/${language === 'en' ? 'en/' : ''}changelog/`;

export function saveUpdateNotice(storage: NoticeStorage, version: string, pending: boolean) {
  storage.setItem(noticeKey, JSON.stringify({ version, pending }));
}

/** Establish a baseline on first launch; only a newer running version is an update. */
export function recordUpdateLaunch(storage: NoticeStorage, currentVersion: string): string | null {
  if (!stableVersion(currentVersion)) return null;
  let saved: { version: string; pending: boolean } | undefined;
  try {
    const raw = storage.getItem(noticeKey);
    const value = raw && raw.length <= 256 ? JSON.parse(raw) : null;
    if (stableVersion(value?.version) && typeof value.pending === 'boolean') saved = value;
  } catch {
    // A damaged notice preference is treated as a first launch, never an update.
  }
  const order = saved
    ? currentVersion.split('+')[0].localeCompare(saved.version.split('+')[0], 'en', { numeric: true })
    : 0;
  if (!saved || order > 0) {
    saveUpdateNotice(storage, currentVersion, !!saved);
    return saved ? currentVersion : null;
  }
  // Retain the newer baseline during a downgrade to avoid a false update on return.
  return order === 0 && saved.pending ? currentVersion : null;
}

export async function updateCall(call: UpdateAction | UpdateCall) {
  if (!window.desktop) throw Error('自动更新需要在 VoxCue 桌面应用中使用。');
  return window.desktop.updates(typeof call === 'string' ? { op: call } : call);
}
