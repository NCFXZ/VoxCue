import { createHash, timingSafeEqual } from 'node:crypto';
import { constants, createReadStream, type Stats } from 'node:fs';
import { open, lstat, type FileHandle } from 'node:fs/promises';
import type { ReleaseFetch } from '../../../shared/electron/backend/updates/provider';
import { macArchiveByteLimit } from '../../../shared/electron/backend/updates/releases';
import { abortable } from '../../../shared/electron/backend/cancellable';

interface ArchiveIntegrity {
  size: number;
  sha512: string;
}

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

export const openArchive = (file: string) =>
  open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);

export async function verifyDownload(file: string, update: ArchiveIntegrity, signal?: AbortSignal) {
  signal?.throwIfAborted();
  if (update.size > macArchiveByteLimit) throw Error('Update archive too large');
  const input = await openArchive(file);
  try {
    const stat = await input.stat();
    if (!stat.isFile() || stat.uid !== process.getuid!() || stat.nlink !== 1)
      throw Error('Invalid update archive');
    if (stat.size !== update.size) throw new CorruptArchive('Invalid update archive size', stat);
    const hash = createHash('sha512');
    for await (const chunk of createReadStream(file, { fd: input, signal, autoClose: false })) hash.update(chunk);
    signal?.throwIfAborted();
    if (!sameArchiveVersion(stat, await lstat(file)))
      throw Error('Update archive changed during verification');
    if (!timingSafeEqual(hash.digest(), Buffer.from(update.sha512, 'base64')))
      throw new CorruptArchive('Update archive checksum mismatch', stat);
    return stat;
  } finally {
    await input.close();
  }
}

/** Stream an exact-length public response. Range bodies must identify their exact ZIP span. */
export async function transferUpdateBytes(
  url: URL,
  size: number,
  signal: AbortSignal,
  fetcher: ReleaseFetch,
  consume: (chunk: Uint8Array, signal: AbortSignal) => void | Promise<void>,
  { range, beforeRead }: {
    range?: { offset: number; archiveSize: number };
    beforeRead?: () => Promise<void>;
  } = {},
) {
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
    const bytes = range ? `${range.offset}-${range.offset + size - 1}` : undefined;
    const pending = fetcher(url, {
      signal, credentials: 'omit', redirect: 'follow',
      ...(bytes ? { headers: { Range: `bytes=${bytes}`, 'Accept-Encoding': 'identity' } } : {}),
    });
    void pending.then(
      (response) => {
        if (signal.aborted) void response.body?.cancel().catch(() => {});
      },
      () => {},
    );
    const response = await abortable(pending, signal);
    const length = response.headers.get('content-length');
    const encoding = response.headers.get('content-encoding');
    if (response.status !== (range ? 206 : 200) || !response.body ||
        (length !== null && Number(length) !== size) ||
        (range && (response.headers.get('content-range') !== `bytes ${bytes}/${range.archiveSize}` ||
          (encoding !== null && encoding !== 'identity')))) {
      void response.body?.cancel().catch(() => {});
      throw Error('Update download failed');
    }
    try {
      await beforeRead?.();
    } catch (error) {
      void response.body.cancel().catch(() => {});
      throw error;
    }
    const reader = response.body.getReader();
    const abort = () => {
      void reader.cancel().catch(() => {});
    };
    signal.addEventListener('abort', abort, { once: true });
    let received = 0;
    try {
      for (;;) {
        signal.throwIfAborted();
        const chunk = await abortable(reader.read(), signal);
        if (chunk.done) break;
        signal.throwIfAborted();
        received += chunk.value.length;
        if (received > size) throw Error('Update archive exceeded expected length');
        await consume(chunk.value, signal);
        if (chunk.value.length) progressDeadline(120_000);
      }
      signal.throwIfAborted();
      if (received !== size) throw Error('Truncated update archive');
    } finally {
      signal.removeEventListener('abort', abort);
      void reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  } finally {
    clearTimeout(timer!);
  }
}

export async function writeUpdateBytes(output: FileHandle, chunk: Uint8Array, signal: AbortSignal) {
  let offset = 0;
  while (offset < chunk.length) {
    signal.throwIfAborted();
    const { bytesWritten } = await output.write(chunk, offset);
    if (!bytesWritten) throw Error('Update archive write failed');
    offset += bytesWritten;
  }
}

export async function downloadArchive(
  url: URL,
  file: string,
  update: ArchiveIntegrity,
  signal: AbortSignal,
  fetcher: ReleaseFetch,
  progress: (percent: number) => void,
) {
  if (update.size > macArchiveByteLimit) throw Error('Update archive too large');
  signal.throwIfAborted();
  let output: FileHandle | undefined;
  let bytes = 0;
  try {
    await transferUpdateBytes(url, update.size, signal, fetcher, async (chunk, active) => {
      await writeUpdateBytes(output!, chunk, active);
      bytes += chunk.length;
      progress((bytes / update.size) * 100);
    }, {
      beforeRead: async () => { output = await open(file, 'wx', 0o600); },
    });
    await output!.sync();
  } finally {
    await output?.close();
  }
  return verifyDownload(file, update, signal);
}
