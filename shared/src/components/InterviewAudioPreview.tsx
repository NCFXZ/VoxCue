import { useEffect, useRef, useState } from 'react';
import type { AudioSource, SpeechOptions } from '../../electron/contracts/speech';
import { inputHoldMs, microphoneLevel, recordAudioLevel } from '../services/audioLevel';
import { InputWave } from './InterviewReadiness';
import { Check } from './icons';

export function useInterviewAudioPreview(mic: boolean, system: boolean, options: SpeechOptions) {
  const stop = useRef<() => Promise<void>>(async () => {});
  const [error, setError] = useState('');
  const { microphone, system: output } = options;
  useEffect(() => {
    const desktop = window.desktop;
    setError('');
    if (!desktop || (!mic && !system)) return;
    let id: string | undefined;
    let stopping = Promise.resolve();
    function release() {
      const owner = id;
      id = undefined;
      if (owner) stopping = desktop!.dictation({ op: 'test-stop', id: owner }).then(() => {});
      return stopping;
    }
    stop.current = release;
    const update = () => {
      if (document.hidden) {
        void release().catch(() => {});
        return;
      }
      if (id) return;
      const owner = crypto.randomUUID();
      id = owner;
      const sources: AudioSource[] = [];
      if (mic) sources.push('microphone');
      if (system) sources.push('system');
      setError('');
      void desktop.dictation({ op: 'preview', id: owner, options: { sources, microphone, system: output } })
        .then(status => {
          if (owner === id && status.state !== 'running') setError(status.error || '音频预览不可用，请重新检查。');
        }).catch(() => {
          if (owner === id) setError('音频预览不可用，请重新检查。');
        });
    };
    const unsubscribe = desktop.onDictationEvent(event => {
      if (id && event.type === 'status' && event.status.state === 'error')
        setError(event.status.error || '音频预览不可用，请重新检查。');
    });
    document.addEventListener('visibilitychange', update);
    update();
    return () => {
      document.removeEventListener('visibilitychange', update);
      unsubscribe();
      void release().catch(() => {});
    };
  }, [mic, system, microphone, output]);
  return { error, stop };
}

export function AudioPreviewIcon({ source }: { source: AudioSource }) {
  const [level, setLevel] = useState(0);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const unsubscribe = window.desktop?.onDictationEvent(event => {
      if (event.type === 'status' && event.status.state !== 'running') setLevel(0);
      if (event.type !== 'activity' || event.source !== source) return;
      const input = recordAudioLevel(undefined, event.level, event.speaking, Date.now());
      if (input.inputLevel === undefined) return;
      setLevel(microphoneLevel(input.inputLevel));
      clearTimeout(timer);
      timer = setTimeout(() => setLevel(0), inputHoldMs);
    });
    return () => { clearTimeout(timer); unsubscribe?.(); };
  }, [source]);
  return level > 0 ? <InputWave level={level} /> : <Check size={14} />;
}
