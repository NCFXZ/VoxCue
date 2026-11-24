import { Provider, type AppUpdater, type ResolvedUpdateFileInfo } from 'electron-updater';
import {
  parseUpdateInfo,
  type ProviderRuntimeOptions,
} from 'electron-updater/out/providers/Provider';
import {
  latestPlatformRelease,
  manifestFile,
  manifestByteLimit,
  releaseAssetUrl,
  releasePageSize,
  releasePageLimit,
  releaseRepository,
  type ReleaseTarget,
} from './releases';
import { platformUpdateInfo, type PlatformUpdateInfo } from './cache';
import { cnbReleaseIndex, readPublicText, resolveDownloadSource } from '../downloads';

export type ReleaseFetch = typeof fetch;

/** Fixed public feed lookup shared by the independent platform installers. */
export async function fetchPlatformUpdate(
  target: ReleaseTarget,
  lifetime: AbortSignal,
  fetcher: ReleaseFetch,
) {
  const signal = AbortSignal.any([lifetime, AbortSignal.timeout(45000)]);
  const source = await resolveDownloadSource(fetcher, signal);
  let releases: unknown[] | undefined;
  if (source === 'cnb') {
    const index = JSON.parse(
      await readPublicText(fetcher, new URL(cnbReleaseIndex), signal, 2 * 1024 * 1024),
    );
    if (
      index?.schemaVersion !== 1 ||
      !Array.isArray(index.releases) ||
      index.releases.length >= releasePageSize * releasePageLimit
    )
      throw Error('Invalid CNB release index');
    releases = index.releases;
  }
  const selectedRelease = await latestPlatformRelease(target, async (page) => {
    if (releases) return releases.slice((page - 1) * releasePageSize, page * releasePageSize);
    const url = new URL(`https://api.github.com/repos/${releaseRepository}/releases`);
    url.searchParams.set('per_page', String(releasePageSize));
    url.searchParams.set('page', String(page));
    return JSON.parse(await readPublicText(fetcher, url, signal, 8 * 1024 * 1024));
  });
  const candidate = source === 'cnb' ? { ...selectedRelease, source } : selectedRelease;
  const url = releaseAssetUrl(candidate, candidate.manifest);
  const raw = await readPublicText(fetcher, url, signal, manifestByteLimit);
  const metadata = parseUpdateInfo(raw, candidate.manifest, url);
  const selected = manifestFile(metadata, candidate);
  signal.throwIfAborted();
  return { candidate, selected, metadata };
}

/** Fixed public repository, native transport, stock downloader/hash/install behavior. */
export function platformReleaseProvider(
  target: ReleaseTarget,
  lifetime: AbortSignal,
  fetcher: ReleaseFetch,
  lookup?: () => Promise<PlatformUpdateInfo>,
) {
  return class PlatformReleaseProvider extends Provider<PlatformUpdateInfo> {
    constructor(_options: unknown, _updater: AppUpdater, runtime: ProviderRuntimeOptions) {
      super({ ...runtime, isUseMultipleRangeRequest: false });
    }
    async getLatestVersion(): Promise<PlatformUpdateInfo> {
      if (lookup) return lookup();
      const { candidate, metadata } = await fetchPlatformUpdate(target, lifetime, fetcher);
      return platformUpdateInfo(candidate, metadata);
    }
    resolveFiles(info: PlatformUpdateInfo): ResolvedUpdateFileInfo[] {
      const file = manifestFile(info, info.selectedRelease);
      return [
        {
          url: releaseAssetUrl(info.selectedRelease, file.url),
          info: { url: file.url, sha512: file.sha512, size: file.size },
        },
      ];
    }
  };
}
