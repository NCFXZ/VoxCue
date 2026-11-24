export const stableVersionPattern =
  '(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?';
const stableVersion = new RegExp('^' + stableVersionPattern + '$');

export function versionParts(version: string) {
  if (version.length > 80 || !stableVersion.test(version)) throw Error('Invalid stable version');
  const parts = version.split('+')[0].split('.').map(Number);
  if (!parts.every(Number.isSafeInteger)) throw Error('Invalid stable version');
  return parts;
}

export function compareVersions(left: string, right: string) {
  const a = versionParts(left), b = versionParts(right);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1;
  return 0;
}
