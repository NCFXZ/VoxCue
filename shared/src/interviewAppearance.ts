import { frostedProfileAt } from './frostedProfiles';
export function readInterviewTransparency(): number {
  return 60;
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
