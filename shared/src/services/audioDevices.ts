import type { AudioDevice } from '../../electron/contracts/speech';
export interface AudioDevicesState {
  devices: AudioDevice[];
  loading: boolean;
  loaded: boolean;
  error: string;
}
export const initialAudioDevices: AudioDevicesState = {
  devices: [],
  loading: true,
  loaded: false,
  error: '',
};

// Enumeration only: never requests permission, starts capture or changes a selection.
export function subscribeAudioDevices(receive: (state: AudioDevicesState) => void) {
  let active = true,
    inFlight = false,
    queued = false;
  let state = initialAudioDevices;
  const refresh = async () => {
    if (!active || document.visibilityState === 'hidden') return;
    if (inFlight) {
      queued = true;
      return;
    }
    if (!window.desktop?.speech) {
      receive({ ...state, loading: false });
      return;
    }
    inFlight = true;
    try {
      const result = await window.desktop.speech({ op: 'devices' });
      if (result.state === 'error') throw Error('Device enumeration failed');
      if (!active) return;
      state = { devices: result.devices ?? [], loading: false, loaded: true, error: '' };
      receive(state);
    } catch {
      if (!active) return;
      state = { ...state, loading: false, error: '无法读取音频设备。' };
      receive(state);
    } finally {
      inFlight = false;
      if (active && queued) {
        queued = false;
        void refresh();
      }
    }
  };
  const wake = () => {
    void refresh();
  };
  const media = window.navigator.mediaDevices;
  window.addEventListener('focus', wake);
  document.addEventListener('visibilitychange', wake);
  media?.addEventListener('devicechange', wake);
  const timer = setInterval(wake, 5000);
  wake();
  return () => {
    active = false;
    clearInterval(timer);
    window.removeEventListener('focus', wake);
    document.removeEventListener('visibilitychange', wake);
    media?.removeEventListener('devicechange', wake);
  };
}
