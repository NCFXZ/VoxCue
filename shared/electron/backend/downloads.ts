export type DownloadSource = 'github' | 'cnb';
export const releaseRepository = 'NCFXZ/VoxCue';
export const cnbRepository = 'voxcue-release/voxcue-release';
export const cnbReleaseIndex = `https://cnb.cool/${cnbRepository}/-/git/raw/main/releases.json`;
export const regionLookup = 'https://www.cloudflare-cn.com/cdn-cgi/trace';

/** Fixed public destinations only; remote metadata never supplies a host or path. */
export function downloadUrl(source: DownloadSource, tag: string, name: string) {
  if (
    !['github', 'cnb'].includes(source) ||
    !/^[A-Za-z0-9][A-Za-z0-9._+-]{0,199}$/.test(tag) ||
    !/^[A-Za-z0-9][A-Za-z0-9._+-]{0,199}$/.test(name) ||
    name.includes('..')
  )
    throw Error('Invalid public download');
  const base =
    source === 'cnb'
      ? `https://cnb.cool/${cnbRepository}/-/releases/download/`
      : `https://github.com/${releaseRepository}/releases/download/`;
  return new URL(`${encodeURIComponent(tag)}/${encodeURIComponent(name)}`, base);
}

export async function readPublicText(
  fetcher: typeof fetch,
  url: URL,
  signal: AbortSignal,
  limit: number,
) {
  signal.throwIfAborted();
  const response = await fetcher(url, {
    signal,
    credentials: 'omit',
    redirect: 'follow',
    cache: 'no-store',
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
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/** Use the egress IP country, never language, timezone or the serving CDN location.
 * No IP/trace is stored or logged. An unavailable lookup keeps the original source. */
export async function resolveDownloadSource(
  fetcher: typeof fetch,
  lifetime: AbortSignal,
): Promise<DownloadSource> {
  try {
    const signal = AbortSignal.any([lifetime, AbortSignal.timeout(3000)]);
    const trace = await readPublicText(fetcher, new URL(regionLookup), signal, 4096);
    const countries = trace.split(/\r?\n/).filter((line) => line.startsWith('loc='));
    return countries.length === 1 && countries[0] === 'loc=CN' ? 'cnb' : 'github';
  } catch {
    lifetime.throwIfAborted();
    return 'github';
  }
}
