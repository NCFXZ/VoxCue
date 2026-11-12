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
  releaseRepository,
  type ReleaseTarget,
} from './releases';
import { platformUpdateInfo, type PlatformUpdateInfo } from './cache';

export type ReleaseFetch = typeof fetch;

async function readText(fetcher: ReleaseFetch, url: URL, signal: AbortSignal, limit: number) {
  signal.throwIfAborted();
  const response = await fetcher(url, {
    signal,
    credentials: 'omit',
    redirect: 'follow',
    headers: {
      Accept:
        url.hostname === 'api.github.com'
          ? 'application/vnd.github+json'
          : 'application/octet-stream',
    },
  });
  if (!response.ok || Number(response.headers.get('content-length')) > limit) {
    void response.body?.cancel().catch(() => {});
    throw Error('Release request failed or exceeded size limit');
  }
  if (!response.body) throw Error('Empty release response');
  const reader = response.body.getReader();
  const abort = () => {
    void reader.cancel(signal.reason).catch(() => {});
  };
  signal.addEventListener('abort', abort, { once: true });
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let text = '',
    bytes = 0;
  try {
    for (;;) {
      signal.throwIfAborted();
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > limit) throw Error('Release response exceeded size limit');
      text += decoder.decode(chunk.value, { stream: true });
    }
    signal.throwIfAborted();
    return text + decoder.decode();
  } finally {
    signal.removeEventListener('abort', abort);
    // A stalled transport cleanup must not outlive the response limit/deadline.
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/** Fixed public feed lookup shared by the independent platform installers. */
export async function fetchPlatformUpdate(
  target: ReleaseTarget,
  lifetime: AbortSignal,
  fetcher: ReleaseFetch,
) {
  const signal = AbortSignal.any([lifetime, AbortSignal.timeout(45000)]);
  const candidate = await latestPlatformRelease(target, async (page) => {
    const url = new URL(`https://api.github.com/repos/${releaseRepository}/releases`);
    url.searchParams.set('per_page', String(releasePageSize));
    url.searchParams.set('page', String(page));
    return JSON.parse(await readText(fetcher, url, signal, 8 * 1024 * 1024));
  });
  const url = releaseAssetUrl(candidate, candidate.manifest);
  const raw = await readText(fetcher, url, signal, manifestByteLimit);
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
