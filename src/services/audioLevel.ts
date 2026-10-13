// RMS is linear amplitude, not loudness. Display -60..-6 dBFS across the meter;
// this affects only the visual indicator and never the captured samples.
export function microphoneLevel(rms: number): number {
  if (!Number.isFinite(rms) || rms <= 0) return 0;
  return Math.max(0, Math.min(100, ((20 * Math.log10(rms) + 60) / 54) * 100));
}
