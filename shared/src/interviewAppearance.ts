import {
  frostedProfileAt,
  readMaterialTransparency,
  windowsMaterialTransparency,
} from './frostedProfiles';
export function readInterviewTransparency(): number {
  return readMaterialTransparency();
}
export function applyInterviewAppearance() {
  const value = readInterviewTransparency();
  const windows = window.desktop?.platform === 'windows';
  const amount = (windows ? windowsMaterialTransparency.interviewBackground : value) / 100;
  const floating = frostedProfileAt(60 * amount);
  const root = document.documentElement;
  root.dataset.materialPlatform = window.desktop?.platform ?? 'unknown';
  if (windows) {
    const reading = frostedProfileAt((30 * windowsMaterialTransparency.interviewBubbles) / 100);
    root.style.setProperty('--windows-interview-bubble-light', String(reading('readingLight')));
    root.style.setProperty('--windows-interview-bubble-dark', String(reading('readingDark')));
  } else {
    root.style.removeProperty('--windows-interview-bubble-light');
    root.style.removeProperty('--windows-interview-bubble-dark');
  }
  const properties = {
    '--frosted-panel-light': floating('panelLight'),
    '--frosted-panel-dark': floating('panelDark'),
  };
  for (const [name, opacity] of Object.entries(properties))
    root.style.setProperty(name, String(opacity));
  root.dataset.interviewTransparency = String(value);
}
