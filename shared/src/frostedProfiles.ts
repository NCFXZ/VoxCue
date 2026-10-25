// Original material curve, shared by the main window and the independent
// interview background. Internal glass surfaces use the shared chat material.
const profiles = [
  {
    value: 0,
    light: 1,
    dark: 1,
    blur: 0,
    panelLight: 1,
    panelDark: 1,
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
    readingLight: 0.16,
    readingDark: 0.24,
  },
] as const;
type ProfileKey = Exclude<keyof (typeof profiles)[number], 'value'>;

// Windows-only settings from 0.5.9. Other glass retains the shared preset below.
export const windowsMaterialTransparency = {
  sidebar: 60,
  interviewBackground: 60,
  interviewBubbles: 60,
} as const;

// Shared preview preset, explicitly enabled for both desktop platforms.
export function readMaterialTransparency(): number {
  return 100;
}

export function frostedProfileAt(value: number) {
  const upperIndex = Math.max(
    1,
    profiles.findIndex((profile) => profile.value >= value),
  );
  const lower = profiles[upperIndex - 1];
  const upper = profiles[upperIndex];
  const fraction = (value - lower.value) / (upper.value - lower.value);
  return (key: ProfileKey) => lower[key] + (upper[key] - lower[key]) * fraction;
}
