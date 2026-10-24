import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { AudioSource, SpeechOptions } from '../../electron/contracts/speech';
import { AudioInputMeters, type AudioLevels } from './AudioInputMeters';
import { Button } from './ui/button';
import { AudioLines, Square } from './icons';

export function AudioCheck({
  options,
  disabled,
  onBusyChange,
  children,
}: {
  options: SpeechOptions;
  disabled: boolean;
  onBusyChange(busy: boolean): void;
  children(controls: {
    button(source: AudioSource, allowed: boolean): ReactNode;
    result(source: AudioSource): ReactNode;
  }): ReactNode;
}) {
  const [phase, setPhase] = useState<'idle' | 'loading' | 'running' | 'stopping'>('idle');
  const [source, setSource] = useState<AudioSource | null>(null);
  const [levels, setLevels] = useState<AudioLevels>({});
  const [error, setError] = useState('');
  const token = useRef<string | undefined>(undefined);
  const running = useRef(false);
  const generation = useRef(0);
  const notify = useRef(onBusyChange);
  notify.current = onBusyChange;
  const stop = async () => {
    const id = token.current;
    if (!id) return;
    token.current = undefined;
    running.current = false;
    const current = ++generation.current;
    setPhase('stopping');
    try {
      await window.desktop?.dictation({ op: 'test-stop', id });
    } catch {
      setError('停止音频测试失败，请重试。');
    } finally {
      if (current === generation.current) {
        setPhase('idle');
        notify.current(false);
      }
    }
  };
  useEffect(() => {
    setPhase('idle');
    setSource(null);
    setLevels({});
    setError('');
    running.current = false;
    const unsubscribe = window.desktop?.onDictationEvent((event) => {
      if (!token.current) return;
      if (event.type === 'activity') {
        setLevels((old) => ({ ...old, [event.source]: { level: event.level, at: Date.now() } }));
      }
      if (event.type === 'status') {
        if (event.status.state === 'error') {
          setError(event.status.error ?? '音频测试失败。');
          void stop();
        } else if (event.status.state === 'idle' && running.current) {
          token.current = undefined;
          running.current = false;
          setPhase('idle');
          notify.current(false);
        }
      }
    });
    return () => {
      unsubscribe?.();
      const id = token.current;
      token.current = undefined;
      ++generation.current;
      if (id) void window.desktop?.dictation({ op: 'test-stop', id }).catch(() => {});
      notify.current(false);
    };
  }, [JSON.stringify(options)]);
  useEffect(() => {
    if (phase !== 'running') return;
    const id = token.current;
    const timer = setTimeout(() => {
      if (token.current === id) void stop();
    }, 10000);
    return () => clearTimeout(timer);
  }, [phase]);
  const start = async (selected: AudioSource) => {
    if (token.current) {
      await stop();
      return;
    }
    const current = ++generation.current;
    const id = crypto.randomUUID();
    token.current = id;
    running.current = false;
    setSource(selected);
    setPhase('loading');
    setError('');
    setLevels({});
    notify.current(true);
    try {
      if (current !== generation.current) return;
      const result = await window.desktop!.dictation({
        op: 'test',
        id,
        options: { ...options, sources: [selected] },
      });
      if (current !== generation.current) return;
      if (result.state !== 'running') throw Error(result.error ?? '音频测试未能启动。');
      running.current = true;
      setPhase('running');
    } catch (e) {
      if (current === generation.current) {
        setError(e instanceof Error ? e.message : '音频测试失败。');
        await stop();
      }
    }
  };
  return children({
    button: (selected, allowed) => {
      const selectedActive = source === selected && phase !== 'idle';
      const label = selected === 'system' ? '系统声音' : '麦克风';
      return (
        <Button
          variant="outline"
          aria-label={selectedActive ? `停止${label}测试` : `测试${label}`}
          disabled={
            disabled ||
            !allowed ||
            phase === 'stopping' ||
            (phase !== 'idle' && source !== selected)
          }
          onClick={() => void start(selected)}
        >
          {selectedActive ? <Square size={14} /> : <AudioLines size={15} />}
          {selectedActive ? (phase === 'loading' ? '正在准备…' : '停止') : '测试'}
        </Button>
      );
    },
    result: (selected) =>
      source === selected && (phase === 'running' || phase === 'loading' || error) ? (
        <div className="audio-check-inline">
          {(phase === 'running' || phase === 'loading') && (
            <AudioInputMeters
              levels={levels}
              sources={[selected]}
              active={phase === 'running'}
              only={selected}
            />
          )}
          {error && (
            <p role="alert" className="danger-text">
              {error}
            </p>
          )}
        </div>
      ) : null,
  });
}
