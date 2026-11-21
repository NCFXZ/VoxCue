import type { AudioSource } from '../../contracts/speech';
import { abortable } from '../cancellable';

export type ConsumeAudio = (
  source: AudioSource,
  samples: Float32Array,
  rate: number,
  timestamp: number,
  // Optional recognition lane, aligned to the recording PCM above.
  recognitionSamples?: Float32Array,
) => void;

// Trusted platform assembly only: no renderer-provided module paths or options.
export interface AudioPreprocessor {
  start(sources: AudioSource[]): void;
  feed(
    source: AudioSource,
    samples: Float32Array,
    rate: number,
    timestamp: number,
    captureClock?: number,
  ): void;
  discontinuity(source: AudioSource): AudioSource[];
  flush(): void;
  close(): void;
}

export async function loadAudioPreprocessor(
  file: string,
  consume: ConsumeAudio,
  failure: () => void,
  signal?: AbortSignal,
): Promise<AudioPreprocessor> {
  const timeout = AbortSignal.timeout(10000);
  const pending: Promise<AudioPreprocessor> = require(file).createAudioPreprocessor(consume, failure);
  try {
    return await abortable(pending, signal ? AbortSignal.any([signal, timeout]) : timeout);
  } catch (error) {
    void pending.then(dsp => dsp.close(), () => {});
    if (timeout.aborted) throw Error('本地回声消除初始化超时，请重新开始。');
    throw error;
  }
}
