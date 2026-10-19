// Original material curve, shared by the main window and the independent
// interview control. Reading surfaces deliberately use a lower curve position.
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
