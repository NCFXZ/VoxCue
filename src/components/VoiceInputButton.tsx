import { useEffect, useRef } from 'react';
import { AudioLines, Square, Loader } from './icons';
import { Button } from './ui/button';
import { useDictation } from '../stores/dictation';

export function VoiceInputButton({
  value,
  onChange,
  disabled = false,
}: {
  value: string;
  onChange(value: string): void;
  disabled?: boolean;
}) {
  const state = useDictation();
  const active = state.phase !== 'idle';
  const loading = state.phase === 'loading' || state.phase === 'stopping';
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      void useDictation.getState().stop();
    };
  }, []);
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={`voice-input-button ${active ? 'is-recording' : ''}`}
      aria-label={active ? '停止语音输入' : '语音输入'}
      aria-pressed={active}
      aria-busy={loading}
      disabled={state.phase === 'stopping' || (!active && (disabled || !window.desktop))}
      title={active ? '停止语音输入' : '本地语音输入 · 音频不保存'}
      onClick={() => {
        if (active) {
          void state.stop();
          return;
        }
        const prefix = value + (value && !/\s$/.test(value) ? ' ' : '');
        void state.start((text) => {
          if (mounted.current) onChange(prefix + text);
        });
      }}
    >
      {loading ? (
        <span className="voice-input-spinner">
          <Loader size={18} />
        </span>
      ) : active ? (
        <Square size={14} />
      ) : (
        <AudioLines size={18} />
      )}
    </Button>
  );
}
