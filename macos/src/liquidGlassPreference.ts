import { readFrostedTransparency } from '../../shared/src/frostedAppearance';

const key = 'voxcue-liquid-glass-enabled-v1';
export function readLiquidGlass(): boolean {
  try {
    const saved = localStorage.getItem(key);
    if (saved !== null) {
      const enabled: unknown = JSON.parse(saved);
      if (typeof enabled === 'boolean') return enabled;
    }
  } catch {
    /* An invalid preference falls back to the existing appearance. */
  }
  return readFrostedTransparency() > 0;
}
export function subscribeLiquidGlass(callback: () => void) {
  const stored = (event: StorageEvent) => {
    if (!event.key || event.key === key) callback();
  };
  window.addEventListener('storage', stored);
  return () => {
    window.removeEventListener('storage', stored);
  };
}
