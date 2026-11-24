import { compareVersions, stableVersionPattern, versionParts } from '../../contracts/versions';
import { downloadUrl, type DownloadSource } from '../downloads';
export { compareVersions } from '../../contracts/versions';
export { releaseRepository } from '../downloads';

export type ReleaseTarget = 'windows-x64' | 'macos-arm64';
export const releasePageSize = 100;
export const releasePageLimit = 10;
export const manifestByteLimit = 128 * 1024;

export function releaseTarget(platform: string, arch: string): ReleaseTarget | undefined {
  if (platform === 'win32' && arch === 'x64') return 'windows-x64';
  if (platform === 'darwin' && arch === 'arm64') return 'macos-arm64';
  return undefined;
}

interface ReleaseAsset {
  name: string;
  size: number;
}
export interface ReleaseCandidate {
  source?: DownloadSource;
  version: string;
  tag: string;
  publishedAt: number;
  manifest: string;
  binary: ReleaseAsset;
}
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

/** Explicit artifact names distinguish platform/architecture; titles and Latest are irrelevant. */
export function releaseCandidates(value: unknown, target: ReleaseTarget): ReleaseCandidate[] {
  if (!Array.isArray(value) || value.length > releasePageSize) throw Error('Invalid release page');
  const manifest = target === 'windows-x64' ? 'latest.yml' : 'latest-mac.yml';
  const binaryPattern = new RegExp(
    target === 'windows-x64'
      ? '^VoxCue-Setup-(' + stableVersionPattern + ')-x64\\.exe$'
      : '^VoxCue-(' + stableVersionPattern + ')-arm64\\.zip$',
  );
  const candidates: ReleaseCandidate[] = [];
  for (const release of value) {
    if (
      !record(release) ||
      release.draft !== false ||
      release.prerelease !== false ||
      typeof release.tag_name !== 'string' ||
      !/^[A-Za-z0-9][A-Za-z0-9._+-]{0,199}$/.test(release.tag_name) ||
      typeof release.published_at !== 'string' ||
      !Number.isFinite(Date.parse(release.published_at)) ||
      !Array.isArray(release.assets) ||
      release.assets.length > 1000
    )
      continue;
    const assets = new Map<string, ReleaseAsset>();
    let duplicate = false;
    for (const asset of release.assets) {
      if (
        !record(asset) ||
        asset.state !== 'uploaded' ||
        typeof asset.name !== 'string' ||
        asset.name.length > 200 ||
        typeof asset.size !== 'number' ||
        !Number.isSafeInteger(asset.size) ||
        asset.size <= 0
      )
        continue;
      if (assets.has(asset.name)) duplicate = true;
      assets.set(asset.name, { name: asset.name, size: asset.size });
    }
    const metadata = assets.get(manifest);
    if (duplicate || !metadata || metadata.size > manifestByteLimit) continue;
    for (const binary of assets.values()) {
      const match = binaryPattern.exec(binary.name);
      if (!match || (target === 'windows-x64' && !assets.has(binary.name + '.blockmap'))) continue;
      try {
        versionParts(match[1]);
      } catch {
        continue;
      }
      candidates.push({
        version: match[1],
        tag: release.tag_name,
        publishedAt: Date.parse(release.published_at),
        manifest,
        binary,
      });
    }
  }
  return candidates;
}

export function releaseAssetUrl(candidate: ReleaseCandidate, name: string) {
  return downloadUrl(candidate.source ?? 'github', candidate.tag, name);
}

/** Never claim an older page is latest if pagination cannot finish. */
export async function latestPlatformRelease(
  target: ReleaseTarget,
  readPage: (page: number) => Promise<unknown>,
): Promise<ReleaseCandidate> {
  const candidates: ReleaseCandidate[] = [];
  for (let page = 1; page <= releasePageLimit; page++) {
    const value = await readPage(page);
    candidates.push(...releaseCandidates(value, target));
    if ((value as unknown[]).length < releasePageSize) {
      candidates.sort(
        (a, b) =>
          compareVersions(b.version, a.version) ||
          b.publishedAt - a.publishedAt ||
          a.tag.localeCompare(b.tag),
      );
      if (!candidates.length) throw Error('No complete stable release for this platform');
      return candidates[0];
    }
  }
  throw Error('Release pagination limit exceeded');
}

/** Project only the selected native file; remote manifests cannot supply other URLs/packages. */
export function manifestFile(value: unknown, candidate: ReleaseCandidate) {
  if (
    !record(value) ||
    value.version !== candidate.version ||
    !Array.isArray(value.files) ||
    value.files.length < 1 ||
    value.files.length > 20
  )
    throw Error('Invalid platform update manifest');
  versionParts(value.version as string);
  const matches = value.files.filter((file) => record(file) && file.url === candidate.binary.name);
  if (matches.length !== 1) throw Error('Platform update artifact is missing or ambiguous');
  const file = matches[0] as Record<string, unknown>;
  if (
    typeof file.sha512 !== 'string' ||
    !/^[A-Za-z0-9+/]{86}==$/.test(file.sha512) ||
    Buffer.from(file.sha512, 'base64').length !== 64 ||
    file.size !== candidate.binary.size
  )
    throw Error('Invalid platform update checksum or size');
  if (
    value.minimumSystemVersion !== undefined &&
    (typeof value.minimumSystemVersion !== 'string' ||
      value.minimumSystemVersion.length > 40 ||
      !/^\d+(?:\.\d+){0,3}$/.test(value.minimumSystemVersion))
  )
    throw Error('Invalid minimum system version');
  return {
    url: candidate.binary.name,
    sha512: file.sha512,
    size: candidate.binary.size,
    minimumSystemVersion: value.minimumSystemVersion as string | undefined,
  };
}
