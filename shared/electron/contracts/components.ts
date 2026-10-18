export type ComponentId = 'speech' | 'rag';
export interface ComponentState {
  revision: number;
  phase: 'checking' | 'needed' | 'downloading' | 'verifying' | 'ready' | 'cancelled' | 'error';
  error: string | null;
  items: {
    id: ComponentId;
    label: string;
    bytes: number;
    received: number;
    phase: 'pending' | 'checking' | 'downloading' | 'verifying' | 'ready';
  }[];
}
export type ComponentCall = { op: 'status' | 'cancel' } | { op: 'download'; id?: ComponentId };
