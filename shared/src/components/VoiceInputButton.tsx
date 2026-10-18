import { useEffect, useRef } from 'react';
import { AudioLines, Square, Loader } from './icons';
import { Button } from './ui/button';
import { useDictation } from '../stores/dictation';
import { useComponentReady } from '../stores/components';

export function VoiceInputButton({
  value,
  onChange,
  disabled = false,
  contextKey,
}: {
  value: string;
  onChange(value: string): void;
  disabled?: boolean;
  contextKey?: string | null;
}) {
  const state = useDictation();
  const speechReady = useComponentReady('speech');
  const active = state.phase !== 'idle';
  const loading = state.phase === 'loading' || state.phase === 'stopping';
  const mounted = useRef(true);
  const context = useRef(contextKey);
  useEffect(() => {
    if (context.current !== contextKey) void useDictation.getState().stop();
    context.current = contextKey;
  }, [contextKey]);
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
      disabled={
        state.phase === 'stopping' || (!active && (disabled || !window.desktop || !speechReady))
      }
      onClick={() => {
        if (active) {
          void state.stop();
          return;
        }
        const prefix = value + (value && !/\s$/.test(value) ? ' ' : '');
        const owner = contextKey;
        void state.start((text) => {
          if (mounted.current && context.current === owner) onChange(prefix + text);
        });
      }}
    >
      {loading ? (
        <span className="voice-input-spinner">
          <Loader size={20} />
        </span>
      ) : active ? (
        <Square size={14} />
      ) : (
        <AudioLines size={20} />
      )}
    </Button>
  );
}
