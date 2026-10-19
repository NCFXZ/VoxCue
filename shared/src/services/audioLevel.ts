// RMS is linear amplitude, not loudness. Display -60..-6 dBFS across the meter;
// this affects only the visual indicator and never the captured samples.
import type { AudioSource } from '../../electron/contracts/speech';
export interface AudioLevel {
  level: number;
  at: number;
  inputAt?: number;
  inputLevel?: number;
}
export type AudioLevels = Partial<Record<AudioSource, AudioLevel>>;
export const inputHoldMs = 800;
export function recordAudioLevel(
  previous: AudioLevel | undefined,
  level: number,
  speaking: boolean,
  now: number,
): AudioLevel {
  const rms = Number.isFinite(level) ? Math.max(0, Math.min(1, level)) : 0;
  // VAD detects speech; the amplitude threshold also covers music and other
  // system audio while keeping the idle noise floor out of the activity state.
  const input = rms > 0 && (speaking || rms >= 0.008);
  return {
    level: rms,
    at: now,
    ...(input
      ? { inputAt: now, inputLevel: rms }
      : previous?.inputAt !== undefined
        ? { inputAt: previous.inputAt, inputLevel: previous.inputLevel }
        : {}),
  };
}
export function microphoneLevel(rms: number): number {
  if (!Number.isFinite(rms) || rms <= 0) return 0;
  return Math.max(0, Math.min(100, ((20 * Math.log10(rms) + 60) / 54) * 100));
}
