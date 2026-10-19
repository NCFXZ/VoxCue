import { useEffect } from 'react';
import { applyInterviewAppearance, subscribeInterviewTransparency } from './interviewAppearance';
import { frostedProfileAt } from './frostedProfiles';

const storageKey = 'voxcue-frosted-transparency-v2';
const legacyKey = 'voxcue-frosted-strength-v1';
const legacyValues: Record<string, number> = { off: 0, weak: 25, medium: 50, strong: 100 };
const changedEvent = 'voxcue-frosted-transparency-changed';
export function readFrostedTransparency(): number {
  try {
    const saved = localStorage.getItem(storageKey);
    if (saved !== null) {
      const value: unknown = JSON.parse(saved);
      return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100
        ? value
        : 50;
    }
    const legacy = localStorage.getItem(legacyKey);
    return legacy && Object.hasOwn(legacyValues, legacy) ? legacyValues[legacy] : 50;
  } catch {
    return 50;
  }
}

export function applyFrostedAppearance() {
  const value = readFrostedTransparency();
  const blend = frostedProfileAt(value);
  const active = value > 0 && value < 100;
  const properties = {
    '--frosted-opacity-light': blend('light'),
    '--frosted-opacity-dark': blend('dark'),
    '--frosted-main-filter': active ? `blur(${blend('blur')}px) saturate(130%)` : 'none',
  };
  const root = document.documentElement;
  root.style.removeProperty('--frosted-reading-opacity');
  for (const [name, setting] of Object.entries(properties))
    root.style.setProperty(name, String(setting));
  root.dataset.frostedTransparency = String(value);
  root.dataset.frostedLegible = String(value >= 70);
  applyInterviewAppearance();
}

export function saveFrostedTransparency(value: number) {
  if (!Number.isFinite(value) || value < 0 || value > 100) throw Error('无效的毛玻璃透明度。');
  localStorage.setItem(storageKey, JSON.stringify(value));
  applyFrostedAppearance();
  window.dispatchEvent(new Event(changedEvent));
}

export function subscribeFrostedTransparency(callback: (value: number) => void) {
  const update = () => callback(readFrostedTransparency());
  const stored = (event: StorageEvent) => {
    if (!event.key || event.key === storageKey || event.key === legacyKey) update();
  };
  window.addEventListener('storage', stored);
  window.addEventListener(changedEvent, update);
  return () => {
    window.removeEventListener('storage', stored);
    window.removeEventListener(changedEvent, update);
  };
}

export function useFrostedAppearance() {
  useEffect(() => {
    applyFrostedAppearance();
    const unsubscribeMain = subscribeFrostedTransparency(applyFrostedAppearance);
    const unsubscribeInterview = subscribeInterviewTransparency(applyInterviewAppearance);
    return () => {
      unsubscribeMain();
      unsubscribeInterview();
    };
  }, []);
}
