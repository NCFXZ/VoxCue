import { create } from 'zustand';
import type { SpeechSegment } from '../../electron/contracts/speech';

interface DictationState {
  phase: 'idle' | 'loading' | 'recording' | 'stopping';
  error: string | null;
  start(onText: (text: string) => void): Promise<void>;
  stop(): Promise<void>;
}
let unsubscribe: (() => void) | undefined;
let generation = 0;
export const useDictation = create<DictationState>((set, get) => ({
  phase: 'idle',
  error: null,
  async start(onText) {
    if (get().phase !== 'idle') return;
    const desktop = window.desktop;
    if (!desktop) {
      set({ error: '语音输入需要 Windows 桌面应用。' });
      return;
    }
    const current = ++generation;
    const segments = new Map<string, SpeechSegment>();
    unsubscribe?.();
    set({ phase: 'loading', error: null });
    unsubscribe = desktop.onDictationEvent((event) => {
      if (current !== generation) return;
      if (event.type === 'segment') {
        if (get().phase === 'idle') return;
        const segment = event.segment;
        if (segment.source !== 'microphone' || segments.get(segment.id)?.final) return;
        segments.set(segment.id, segment);
        onText(
          [...segments.values()]
            .map((s) => s.text)
            .filter(Boolean)
            .join(' '),
        );
      }
      if (event.type === 'status') {
        if (event.status.state === 'error' || event.status.state === 'idle') {
          set({ phase: 'idle', ...(event.status.error ? { error: event.status.error } : {}) });
          unsubscribe?.();
          unsubscribe = undefined;
        } else if (get().phase !== 'stopping' && event.status.state === 'running')
          set({ phase: 'recording' });
      }
    });
    try {
      const status = await desktop.dictation({ op: 'start' });
      if (current !== generation || get().phase !== 'loading') return;
      if (status.state === 'error') throw Error(status.error ?? '语音输入启动失败。');
      set({ phase: status.state === 'running' ? 'recording' : 'idle' });
      if (status.state !== 'running') {
        unsubscribe?.();
        unsubscribe = undefined;
      }
    } catch (error) {
      if (current !== generation) return;
      if (get().phase !== 'stopping') {
        set({
          phase: 'idle',
          error: error instanceof Error ? error.message : '语音输入启动失败。',
        });
        unsubscribe?.();
        unsubscribe = undefined;
      }
    }
  },
  async stop() {
    if (get().phase === 'idle' || get().phase === 'stopping') return;
    const current = generation;
    set({ phase: 'stopping' });
    try {
      // Keep listening until the native stop flush has delivered its final words.
      await window.desktop?.dictation({ op: 'stop' });
    } catch (error) {
      if (current === generation)
        set({ error: error instanceof Error ? error.message : '停止语音输入失败。' });
    } finally {
      if (current === generation) {
        ++generation;
        unsubscribe?.();
        unsubscribe = undefined;
        set({ phase: 'idle' });
      }
    }
  },
}));
