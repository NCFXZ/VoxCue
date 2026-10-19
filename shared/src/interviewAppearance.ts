import { useEffect, useState } from 'react';
import { frostedProfileAt } from './frostedProfiles';
const storageKey = 'voxcue-interview-background-transparency-v1';
const changedEvent = 'voxcue-interview-background-transparency-changed';
export function readInterviewTransparency(): number {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(storageKey) ?? 'null');
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100
      ? value
      : 20;
  } catch {
    return 20;
  }
}
export function applyInterviewAppearance() {
  const value = readInterviewTransparency();
  const amount = value / 100;
  const floating = frostedProfileAt(60 * amount);
  const reading = frostedProfileAt(30 * amount);
  const root = document.documentElement;
  const properties = {
    '--frosted-panel-light': floating('panelLight'),
    '--frosted-panel-dark': floating('panelDark'),
    '--frosted-chrome-light': floating('chromeLight'),
    '--frosted-chrome-dark': floating('chromeDark'),
    '--frosted-reading-light': reading('readingLight'),
    '--frosted-reading-dark': reading('readingDark'),
  };
  for (const [name, opacity] of Object.entries(properties))
    root.style.setProperty(name, String(opacity));
  root.style.setProperty(
    '--frosted-panel-filter',
    value > 0 ? `blur(${floating('panelBlur')}px)` : 'none',
  );
  root.dataset.interviewTransparency = String(value);
}
export function saveInterviewTransparency(value: number) {
  if (!Number.isFinite(value) || value < 0 || value > 100) throw Error('无效的面试背景透明度。');
  localStorage.setItem(storageKey, JSON.stringify(value));
  applyInterviewAppearance();
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
  useEffect(() => subscribeInterviewTransparency(setValue), []);
  return value;
}
