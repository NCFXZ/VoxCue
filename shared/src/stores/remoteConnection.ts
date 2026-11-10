import { create } from 'zustand';
import type {
  RemoteConnectionCall,
  RemoteConnectionResult,
  RemoteConnectionState,
  RemotePairing,
} from '../../electron/contracts/remoteConnection';

interface RemoteConnectionStore {
  state: RemoteConnectionState | null;
  pairing: RemotePairing | null;
  loading: boolean;
  error: string | null;
  dialogOpen: boolean;
  interrupted: boolean;
  setDialogOpen(open: boolean): void;
  start(): Promise<void>;
  refreshPairing(): Promise<void>;
  disconnect(): Promise<void>;
  approve(id: string): Promise<void>;
  reject(id: string): Promise<void>;
  connectEvents(): () => void;
}

export const useRemoteConnection = create<RemoteConnectionStore>((set, get) => {
  const receive = (state: RemoteConnectionState) => {
    if (get().state && state.revision < get().state!.revision) return false;
    set({
      state,
      error: state.error,
      interrupted: ['off', 'connected'].includes(state.status)
        ? false
        : state.status === 'reconnecting' ||
          (state.status === 'error' && get().state?.status === 'connected') ||
          get().interrupted,
      ...(['off', 'connected'].includes(state.status) ? { pairing: null } : {}),
    });
    return true;
  };
  const receiveResult = (result: RemoteConnectionResult) => {
    if (receive(result.state) && result.pairing) set({ pairing: result.pairing });
  };
  const run = async (call: RemoteConnectionCall) => {
    if (get().loading) return;
    set({ loading: true, error: null });
    try {
      if (!window.desktop?.remoteConnection) throw Error('设备连接需要在 VoxCue 桌面应用中使用。');
      receiveResult(await window.desktop.remoteConnection(call));
    } catch (error) {
      set({
        error:
          error instanceof Error
            ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
            : '设备连接操作失败，请重试。',
      });
    } finally {
      set({ loading: false });
    }
  };
  return {
    state: null,
    pairing: null,
    loading: false,
    error: null,
    dialogOpen: false,
    interrupted: false,
    setDialogOpen: (dialogOpen) => set({ dialogOpen }),
    start: () => run({ op: 'start' }),
    refreshPairing: () => run({ op: 'pair' }),
    disconnect: () => run({ op: 'disconnect' }),
    approve: (id) => run({ op: 'approve', id }),
    reject: (id) => run({ op: 'reject', id }),
    connectEvents() {
      const desktop = window.desktop;
      if (!desktop?.remoteConnection || !desktop.onRemoteConnection) return () => {};
      let active = true;
      const unsubscribe = desktop.onRemoteConnection((state) => {
        if (active) receive(state);
      });
      void desktop.remoteConnection({ op: 'status' }).then(
        (result) => {
          if (active) receiveResult(result);
        },
        () => {
          if (active) set({ error: '无法读取设备连接状态，请重试。' });
        },
      );
      return () => {
        active = false;
        unsubscribe();
      };
    },
  };
});
