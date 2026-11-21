import { createHash, timingSafeEqual } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { open, lstat } from 'node:fs/promises';
import type { SignedMacUpdate } from './manifest';
import type { ReleaseFetch } from '../../../shared/electron/backend/updates/provider';
import { abortable } from '../../../shared/electron/backend/cancellable';
import type { Stats } from 'node:fs';

export class CorruptArchive extends Error {
  constructor(message: string, readonly observed: Stats) {
    super(message);
  }
}

export function sameArchiveVersion(observed: Stats, current: Stats) {
  return current.isFile() && current.nlink === 1 && current.uid === observed.uid &&
    current.dev === observed.dev && current.ino === observed.ino && current.size === observed.size &&
    current.ctimeMs === observed.ctimeMs && current.mtimeMs === observed.mtimeMs;
}

export async function verifyDownload(file: string, update: SignedMacUpdate, signal?: AbortSignal) {
  signal?.throwIfAborted();
  if (update.size > 2 * 1024 ** 3) throw Error('Update archive too large');
  const stat = await lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== process.getuid!() || stat.nlink !== 1)
    throw Error('Invalid update archive');
  if (stat.size !== update.size) throw new CorruptArchive('Invalid update archive size', stat);
  const hash = createHash('sha512');
  for await (const chunk of createReadStream(file, { signal })) hash.update(chunk);
  signal?.throwIfAborted();
  const after = await lstat(file);
  if (!sameArchiveVersion(stat, after))
    throw Error('Update archive changed during verification');
  if (!timingSafeEqual(hash.digest(), Buffer.from(update.sha512, 'base64')))
    throw new CorruptArchive('Update archive checksum mismatch', stat);
  return stat;
}

export async function downloadArchive(
  url: URL,
  file: string,
  update: SignedMacUpdate,
  signal: AbortSignal,
  fetcher: ReleaseFetch,
  progress: (percent: number) => void,
) {
  if (update.size > 2 * 1024 ** 3) throw Error('Update archive too large');
  signal.throwIfAborted();
  const idle = new AbortController();
  signal = AbortSignal.any([signal, idle.signal]);
  let timer: ReturnType<typeof setTimeout>;
  const progressDeadline = (milliseconds: number) => {
    clearTimeout(timer);
    timer = setTimeout(
      () => idle.abort(new DOMException('Update download stalled', 'TimeoutError')),
      milliseconds,
    );
  };
  // Bound connection/first byte, then only periods without useful progress.
  // A continuously advancing download has no total-duration throughput floor.
  progressDeadline(30_000);
  try {
    const pending = fetcher(url, { signal, credentials: 'omit', redirect: 'follow' });
    void pending.then(
      (response) => {
        if (signal.aborted) void response.body?.cancel().catch(() => {});
      },
      () => {},
    );
    const response = await abortable(pending, signal);
    const length = response.headers.get('content-length');
    if (!response.ok || !response.body || (length !== null && Number(length) !== update.size)) {
      void response.body?.cancel().catch(() => {});
      throw Error('Update download failed');
    }
    const output = await open(file, 'wx', 0o600).catch(async (error) => {
      void response.body?.cancel().catch(() => {});
      throw error;
    });
    let reader: ReadableStreamDefaultReader<Uint8Array>;
    try {
      reader = response.body.getReader();
    } catch (error) {
      await output.close();
      throw error;
    }
    const abort = () => {
      void reader.cancel().catch(() => {});
    };
    signal.addEventListener('abort', abort, { once: true });
    let bytes = 0;
    try {
      for (;;) {
        signal.throwIfAborted();
        const chunk = await abortable(reader.read(), signal);
        if (chunk.done) break;
        signal.throwIfAborted();
        bytes += chunk.value.length;
        if (bytes > update.size) throw Error('Update archive exceeded expected length');
        // FileHandle.write can return a short write.
        let offset = 0;
        while (offset < chunk.value.length) {
          signal.throwIfAborted();
          const { bytesWritten } = await output.write(chunk.value, offset);
          if (!bytesWritten) throw Error('Update archive write failed');
          offset += bytesWritten;
          progressDeadline(120_000);
        }
        progress((bytes / update.size) * 100);
      }
      signal.throwIfAborted();
      if (bytes !== update.size) throw Error('Truncated update archive');
      await output.sync();
    } finally {
      signal.removeEventListener('abort', abort);
      void reader.cancel().catch(() => {});
      reader.releaseLock();
      await output.close();
    }
    return await verifyDownload(file, update, signal);
  } finally {
    clearTimeout(timer!);
  }
}
