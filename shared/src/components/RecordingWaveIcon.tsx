import type { Ref } from 'react';

export const barStride = 3;
export const idleBars = [3, 7, 12, 6, 16, 10, 4, 8, 3, 2];

export function waveform(heights: number[], offset: number) {
  return heights.map((height, index) => {
    const x = 1 + index * barStride - offset;
    return `M${x.toFixed(2)} ${(10 - height / 2).toFixed(2)}v${height.toFixed(2)}`;
  }).join(' ');
}
export const idlePath = waveform(idleBars, 0);

export function RecordingWaveIcon({ pathRef, size = 20 }: { pathRef?: Ref<SVGPathElement>; size?: number }) {
  return (
    <svg className="recording-wave" width={size} height={size * 0.9} viewBox="0 0 24 20" aria-hidden="true">
      <path ref={pathRef} d={idlePath} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
