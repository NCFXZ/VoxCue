export type UpdateAction = 'status' | 'check' | 'download' | 'cancel' | 'install';
export const storeUpdateMessage = '此版本由 Microsoft Store 提供更新。';
export type UpdateCall =
  | { op: Exclude<UpdateAction, 'check'> }
  | { op: 'check'; force?: boolean }
  | { op: 'set-auto-download'; enabled: boolean };

export interface UpdateState {
  revision: number;
  currentVersion: string;
  autoDownload: boolean;
  phase:
    | 'unavailable'
    | 'idle'
    | 'checking'
    | 'available'
    | 'downloading'
    | 'downloaded'
    | 'installing'
    | 'error';
  availableVersion: string | null;
  progress: number | null;
  lastCheckedAt: number | null;
  message: string | null;
  error: string | null;
  interviewActive: boolean;
}
