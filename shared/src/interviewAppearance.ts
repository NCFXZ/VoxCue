import { frostedProfileAt, readMaterialTransparency } from './frostedProfiles';
export function readInterviewTransparency(): number {
  return readMaterialTransparency();
}
export function applyInterviewAppearance() {
  const value = readInterviewTransparency();
  const amount = value / 100;
  const floating = frostedProfileAt(60 * amount);
  const root = document.documentElement;
  const properties = {
    '--frosted-panel-light': floating('panelLight'),
    '--frosted-panel-dark': floating('panelDark'),
  };
  for (const [name, opacity] of Object.entries(properties))
    root.style.setProperty(name, String(opacity));
  root.dataset.interviewTransparency = String(value);
}
