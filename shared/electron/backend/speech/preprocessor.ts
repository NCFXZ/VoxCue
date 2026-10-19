import type { AudioSource } from '../../contracts/speech';

export type ConsumeAudio = (
  source: AudioSource,
  samples: Float32Array,
  rate: number,
  timestamp: number,
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
