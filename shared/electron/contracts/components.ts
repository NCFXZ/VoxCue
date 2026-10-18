export type ComponentId = 'speech' | 'rag';
export interface ComponentState {
  revision: number;
  phase:
    | 'checking'
    | 'needed'
    | 'downloading'
    | 'verifying'
    | 'removing'
    | 'ready'
    | 'cancelled'
    | 'error';
  error: string | null;
  removable?: boolean;
  items: {
    id: ComponentId;
    label: string;
    bytes: number;
    received: number;
    phase: 'pending' | 'checking' | 'downloading' | 'verifying' | 'removing' | 'ready';
  }[];
}
export type ComponentCall =
  | { op: 'status' | 'cancel' }
  | { op: 'download'; id?: ComponentId }
  | { op: 'remove'; id: ComponentId };
