import { useEffect, useState } from 'react';
import { frostedProfileAt } from './frostedProfiles';

const storageKey = 'voxcue-interview-background-transparency-v1';
const changedEvent = 'voxcue-interview-background-transparency-changed';
export const interviewTransparency = { minimum: 0, maximum: 100, default: 100 } as const;
const valid = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 100;

export function readInterviewTransparency(): number {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(storageKey) ?? 'null');
    return valid(saved) ? saved : interviewTransparency.default;
  } catch {
    return interviewTransparency.default;
  }
}

export function saveInterviewTransparency(value: number) {
  if (!valid(value)) throw Error('无效的面试背景透明度。');
  localStorage.setItem(storageKey, JSON.stringify(value));
  window.dispatchEvent(new Event(changedEvent));
}

export function subscribeInterviewTransparency(callback: (value: number) => void) {
  const update = () => callback(readInterviewTransparency());
  const stored = (event: StorageEvent) => {
    if (!event.key || event.key === storageKey) update();
  };
  window.addEventListener('storage', stored);
  window.addEventListener(changedEvent, update);
  return () => {
    window.removeEventListener('storage', stored);
    window.removeEventListener(changedEvent, update);
  };
}

export function useInterviewTransparency() {
  const [value, setValue] = useState(readInterviewTransparency);
  useEffect(() => {
    const unsubscribe = subscribeInterviewTransparency(setValue);
    setValue(readInterviewTransparency());
    return unsubscribe;
  }, []);
  return value;
}

export function applyInterviewAppearance() {
  const value = readInterviewTransparency();
  const windows = window.desktop?.platform === 'windows';
  const amount = value / 100;
  const floating = frostedProfileAt(70 * amount);
  const reading = frostedProfileAt(35 * amount);
  // Standalone notices retain each platform's original material.
  const chrome = frostedProfileAt(windows ? 36 : 60);
  const root = document.documentElement;
  root.dataset.materialPlatform = window.desktop?.platform ?? 'unknown';
  const properties = {
    '--frosted-panel-light': floating('panelLight'),
    '--frosted-panel-dark': floating('panelDark'),
    '--interview-bubble-light': reading('readingLight'),
    '--interview-bubble-dark': reading('readingDark'),
    '--interview-chrome-panel-light': chrome('panelLight'),
    '--interview-chrome-panel-dark': chrome('panelDark'),
  };
  for (const [name, opacity] of Object.entries(properties))
    root.style.setProperty(name, String(opacity));
  root.dataset.interviewTransparency = String(value);
}
