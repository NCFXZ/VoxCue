import { useEffect } from 'react';
import { applyInterviewAppearance, subscribeInterviewTransparency } from './interviewAppearance';
import {
  frostedProfileAt,
  readMaterialTransparency,
  windowsMaterialTransparency,
} from './frostedProfiles';

// Shared preset only; do not read or rewrite old preferences.
export function readFrostedTransparency(): number {
  return readMaterialTransparency();
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
  if (window.desktop?.platform === 'windows') {
    const sidebar = frostedProfileAt(windowsMaterialTransparency.sidebar);
    root.style.setProperty('--windows-sidebar-opacity-light', String(sidebar('light')));
    root.style.setProperty('--windows-sidebar-opacity-dark', String(sidebar('dark')));
  } else {
    root.style.removeProperty('--windows-sidebar-opacity-light');
    root.style.removeProperty('--windows-sidebar-opacity-dark');
  }
  root.style.removeProperty('--frosted-reading-opacity');
  root.style.removeProperty('--web-material-min-opacity');
  for (const [name, setting] of Object.entries(properties))
    root.style.setProperty(name, String(setting));
  root.dataset.frostedTransparency = String(value);
  root.dataset.frostedLegible = String(value >= 70);
  applyInterviewAppearance();
}

export function useFrostedAppearance() {
  useEffect(() => {
    const unsubscribe = subscribeInterviewTransparency(applyInterviewAppearance);
    applyFrostedAppearance();
    return unsubscribe;
  }, []);
}
