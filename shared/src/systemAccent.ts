import { useEffect } from 'react';

export const accentOptions = [
  { value: 'system', label: '跟随系统' },
  { value: '#0078d4', label: '蓝色' },
  { value: '#008c95', label: '青色' },
  { value: '#16835d', label: '绿色' },
  { value: '#8764b8', label: '紫色' },
  { value: '#d96b27', label: '橙色' },
  { value: '#c74a85', label: '粉色' },
] as const;
export type AccentPreference = (typeof accentOptions)[number]['value'];
const accentKey = 'copilot-accent-color-v1';
const accentChanged = 'voxcue-accent-changed';
export function readAccentPreference(): AccentPreference {
  try {
    const value = localStorage.getItem(accentKey);
    return accentOptions.find((option) => option.value === value)?.value ?? 'system';
  } catch {
    return 'system';
  }
}
export function saveAccentPreference(value: AccentPreference) {
  if (!accentOptions.some((option) => option.value === value)) throw Error('无效的主题色。');
  localStorage.setItem(accentKey, value);
  window.dispatchEvent(new Event(accentChanged));
}

// Keep the system hue while maintaining readable text on both themed surfaces.
export function readableAccent(color: string, dark: boolean) {
  const rgb = color
    .slice(1)
    .match(/../g)!
    .map((value) => parseInt(value, 16));
  const luminance = (channels: number[]) =>
    channels
      .map((value) => {
        const c = value / 255;
        return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      })
      .reduce((sum, value, i) => sum + value * [0.2126, 0.7152, 0.0722][i], 0);
  const background = luminance(dark ? [50, 58, 62] : [204, 214, 216]);
  for (let step = 0; step <= 100; step++) {
    const adjusted = rgb.map((c) => Math.round(c + (((dark ? 255 : 0) - c) * step) / 100));
    const l = luminance(adjusted);
    if ((Math.max(l, background) + 0.05) / (Math.min(l, background) + 0.05) >= 4.5)
      return '#' + adjusted.map((c) => c.toString(16).padStart(2, '0')).join('');
  }
  return dark ? '#ffffff' : '#000000';
}

// Shared by login, main and floating interview renderers.
export function useSystemAccent() {
  useEffect(() => {
    const desktop = window.desktop;
    let active = true;
    let updated = false;
    let current: string | null = null;
    const apply = () => {
      if (!active) return;
      const preference = readAccentPreference();
      const color = preference === 'system' ? current : preference;
      const style = document.documentElement.style;
      if (!color || !/^#[a-f0-9]{6}$/i.test(color)) {
        style.removeProperty('--system-accent');
        style.removeProperty('--accent-readable');
        return;
      }
      style.setProperty('--system-accent', color);
      style.setProperty(
        '--accent-readable',
        readableAccent(color, document.documentElement.classList.contains('dark')),
      );
    };
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    const unsubscribe = desktop?.onSystemAccent((color) => {
      updated = true;
      current = color;
      apply();
    });
    const stored = (event: StorageEvent) => {
      if (!event.key || event.key === accentKey) apply();
    };
    window.addEventListener('storage', stored);
    window.addEventListener(accentChanged, apply);
    void desktop
      ?.systemAccent()
      .then((color) => {
        if (!updated) {
          current = color;
          apply();
        }
      })
      .catch(() => {});
    return () => {
      active = false;
      observer.disconnect();
      unsubscribe?.();
      window.removeEventListener('storage', stored);
      window.removeEventListener(accentChanged, apply);
    };
  }, []);
}
