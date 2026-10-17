import { useEffect } from 'react';

const storageKey = 'voxcue-frosted-transparency-v2';
const legacyKey = 'voxcue-frosted-strength-v1';
const legacyValues: Record<string, number> = { off: 0, weak: 25, medium: 50, strong: 100 };
const changedEvent = 'voxcue-frosted-transparency-changed';
const profiles = [
  {
    value: 0,
    light: 1,
    dark: 1,
    blur: 0,
    panelLight: 1,
    panelDark: 1,
    chromeLight: 1,
    chromeDark: 1,
    panelBlur: 0,
    readingLight: 1,
    readingDark: 1,
  },
  {
    value: 25,
    light: 0.76,
    dark: 0.84,
    blur: 20,
    panelLight: 0.92,
    panelDark: 0.94,
    chromeLight: 0.96,
    chromeDark: 0.96,
    panelBlur: 16,
    readingLight: 0.86,
    readingDark: 0.9,
  },
  {
    value: 50,
    light: 0.5,
    dark: 0.64,
    blur: 36,
    panelLight: 0.76,
    panelDark: 0.82,
    chromeLight: 0.86,
    chromeDark: 0.88,
    panelBlur: 24,
    readingLight: 0.62,
    readingDark: 0.68,
  },
  {
    value: 100,
    light: 0,
    dark: 0,
    blur: 0,
    panelLight: 0.12,
    panelDark: 0.18,
    chromeLight: 0.4,
    chromeDark: 0.5,
    panelBlur: 0,
    readingLight: 0.16,
    readingDark: 0.24,
  },
] as const;
type ProfileKey = Exclude<keyof (typeof profiles)[number], 'value'>;
const floatingMaximum = 60;
const readingMaximum = 30;

function profileAt(value: number) {
  const upperIndex = Math.max(
    1,
    profiles.findIndex((profile) => profile.value >= value),
  );
  const lower = profiles[upperIndex - 1];
  const upper = profiles[upperIndex];
  const fraction = (value - lower.value) / (upper.value - lower.value);
  return (key: ProfileKey) => lower[key] + (upper[key] - lower[key]) * fraction;
}

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
  const blend = profileAt(value);
  const scale = value / 100;
  const floatingValue = floatingMaximum * scale;
  const floating = profileAt(floatingValue);
  const reading = profileAt(readingMaximum * scale);
  const active = value > 0 && value < 100;
  const properties = {
    '--frosted-opacity-light': blend('light'),
    '--frosted-opacity-dark': blend('dark'),
    '--frosted-panel-light': floating('panelLight'),
    '--frosted-panel-dark': floating('panelDark'),
    '--frosted-chrome-light': floating('chromeLight'),
    '--frosted-chrome-dark': floating('chromeDark'),
    '--frosted-reading-light': reading('readingLight'),
    '--frosted-reading-dark': reading('readingDark'),
    '--frosted-main-filter': active ? `blur(${blend('blur')}px) saturate(130%)` : 'none',
    '--frosted-panel-filter': floatingValue > 0 ? `blur(${floating('panelBlur')}px)` : 'none',
  };
  const root = document.documentElement;
  root.style.removeProperty('--frosted-reading-opacity');
  for (const [name, setting] of Object.entries(properties))
    root.style.setProperty(name, String(setting));
  root.dataset.frostedTransparency = String(value);
  root.dataset.frostedLegible = String(value >= 70);
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
    return subscribeFrostedTransparency(applyFrostedAppearance);
  }, []);
}
