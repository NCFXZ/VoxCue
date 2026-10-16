export type UpdateCall = { op: 'status' | 'check' | 'download' | 'install' };

export interface UpdateState {
  revision: number;
  currentVersion: string;
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
