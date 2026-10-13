import { useEffect, useRef, useState } from 'react';
import { Button } from './ui/button';
import { AudioLines, Square } from './icons';
import { microphoneLevel } from '../services/audioLevel';
export function MicrophoneTest({
  device,
  disabled,
  onError,
}: {
  device?: string;
  disabled: boolean;
  onError(message: string): void;
}) {
  const [phase, setPhase] = useState<'idle' | 'loading' | 'running'>('idle');
  const [level, setLevel] = useState(0);
  const reportError = useRef(onError);
  reportError.current = onError;
  const active = useRef(false);
  const generation = useRef(0);
  const stop = () => {
    ++generation.current;
    if (active.current) void window.desktop?.dictation({ op: 'stop' }).catch(() => {});
    active.current = false;
    setPhase('idle');
    setLevel(0);
  };
  useEffect(() => {
    const unsubscribe = window.desktop?.onDictationEvent((event) => {
      if (!active.current) return;
      if (event.type === 'activity' && event.source === 'microphone')
        setLevel(microphoneLevel(event.level));
      if (event.type === 'status' && event.status.state === 'error') {
        reportError.current(event.status.error ?? '麦克风测试失败。');
        stop();
      }
    });
    return () => {
      unsubscribe?.();
      stop();
    };
  }, []);
  useEffect(() => {
    stop();
  }, [device, disabled]);
  return (
    <div className="microphone-test">
      <Button
        type="button"
        variant="outline"
        disabled={disabled || !window.desktop}
        aria-pressed={phase !== 'idle'}
        onClick={async () => {
          if (active.current) {
            stop();
            return;
          }
          active.current = true;
          const current = ++generation.current;
          reportError.current('');
          setPhase('loading');
          try {
            const result = await window.desktop!.dictation({ op: 'start', microphone: device });
            if (current !== generation.current) return;
            if (result.state === 'error') throw Error(result.error ?? '麦克风测试失败。');
            setPhase('running');
          } catch (e) {
            if (current === generation.current) {
              reportError.current(e instanceof Error ? e.message : '麦克风测试失败。');
              stop();
            }
          }
        }}
      >
        {phase === 'idle' ? <AudioLines size={16} /> : <Square size={14} />}{' '}
        {phase === 'idle' ? '测试麦克风' : phase === 'loading' ? '正在加载…' : '停止测试'}
      </Button>
      <div
        className="microphone-level"
        role="meter"
        aria-label="麦克风音量"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(level)}
        aria-valuetext={phase === 'idle' ? '未测试' : `${Math.round(level)}%`}
      >
        {Array.from({ length: 40 }, (_, index) => (
          <span key={index} className={level > index * 2.5 ? 'is-active' : ''} aria-hidden="true" />
        ))}
      </div>
    </div>
  );
}
