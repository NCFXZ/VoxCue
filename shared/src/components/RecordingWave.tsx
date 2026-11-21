import { useLayoutEffect, useRef } from 'react';
import { inputSourceEnabled } from '../../electron/contracts/speechSettings';
import { inputHoldMs, microphoneLevel } from '../services/audioLevel';
import { useInterview } from '../stores/interview';
import { RecordingWaveIcon, barStride, idleBars, idlePath, waveform } from './RecordingWaveIcon';

const barPeriodMs = 100;
const settleMs = 240;

function inputHeight() {
  const state = useInterview.getState();
  const now = Date.now();
  let level = 0;
  for (const source of state.options.sources) {
    const sample = state.audioLevels[source];
    if (inputSourceEnabled(state, source) && sample && now - sample.at < inputHoldMs)
      level = Math.max(level, sample.level);
  }
  return 2 + microphoneLevel(level) * 0.14;
}

export function RecordingWave({ active = false }: { active?: boolean }) {
  const path = useRef<SVGPathElement>(null);
  const drawing = useRef({ heights: [...idleBars], phase: 0 });
  useLayoutEffect(() => {
    const line = path.current;
    if (!line || (!active && line.getAttribute('d') === idlePath)) return;
    const wave = drawing.current;
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    const samples = idleBars.map(() => 2);
    let last = performance.now();
    let frame = 0;
    const scroll = (now: number) => {
      const elapsed = Math.min(Math.max(0, now - last), barPeriodMs * samples.length);
      last = now;
      const blend = 1 - Math.exp(-elapsed / 85);
      const newest = inputHeight();
      wave.phase += elapsed / barPeriodMs;
      // Carry the fractional step across samples so spacing and speed survive a late frame.
      while (wave.phase >= 1) {
        wave.phase -= 1;
        samples.shift();
        samples.push(newest);
        wave.heights.shift();
        wave.heights.push(newest);
      }
      samples[samples.length - 1] = newest;
      for (let i = 0; i < wave.heights.length; i++) {
        // Keep the travelling peaks while letting each bar respond to the current level.
        const target = samples[i] + (newest - samples[i]) * 0.2;
        wave.heights[i] += (target - wave.heights[i]) * blend;
      }
      line.setAttribute('d', waveform(wave.heights, wave.phase * barStride));
      frame = requestAnimationFrame(scroll);
    };
    const started = last;
    const from = { heights: [...wave.heights], phase: wave.phase };
    const settle = (now: number) => {
      const progress = Math.min(1, Math.max(0, (now - started) / settleMs));
      const remaining = 1 - progress * progress * (3 - 2 * progress);
      wave.phase = from.phase * remaining;
      for (let i = 0; i < idleBars.length; i++) {
        wave.heights[i] = idleBars[i] + (from.heights[i] - idleBars[i]) * remaining;
      }
      line.setAttribute('d', waveform(wave.heights, wave.phase * barStride));
      if (progress < 1) frame = requestAnimationFrame(settle);
    };
    const reset = () => {
      cancelAnimationFrame(frame);
      if (motion.matches) {
        wave.heights = [...idleBars];
        wave.phase = 0;
        line.setAttribute('d', idlePath);
      } else if (!document.hidden && (active || line.getAttribute('d') !== idlePath)) {
        last = performance.now();
        frame = requestAnimationFrame(active ? scroll : settle);
      }
    };
    reset();
    motion.addEventListener('change', reset);
    document.addEventListener('visibilitychange', reset);
    return () => {
      cancelAnimationFrame(frame);
      motion.removeEventListener('change', reset);
      document.removeEventListener('visibilitychange', reset);
    };
  }, [active]);

  return <RecordingWaveIcon pathRef={path} />;
}
