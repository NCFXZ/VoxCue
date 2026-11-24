import { createHash } from 'node:crypto';
import { open } from 'node:fs/promises';
import path from 'node:path';
import type { ReleaseFetch } from '../../../shared/electron/backend/updates/provider';
import {
  macArchiveByteLimit,
  macDeltaCopyLimit,
  releaseAssetUrl,
  type MacDeltaFile,
  type ReleaseCandidate,
} from '../../../shared/electron/backend/updates/releases';
import {
  openArchive,
  sameArchiveVersion,
  transferUpdateBytes,
  verifyDownload,
  writeUpdateBytes,
} from './download';
import type { SignedMacUpdate } from './manifest';

type CopyRange = [targetOffset: number, baseOffset: number, size: number];

function copyRanges(value: unknown, targetSize: number, delta: MacDeltaFile): CopyRange[] {
  if (!Array.isArray(value) || !value.length || value.length > macDeltaCopyLimit)
    throw Error('Invalid Mac differential ranges');
  let previousEnd = 0;
  let reusableBytes = 0;
  for (const range of value) {
    if (!Array.isArray(range) || range.length !== 3 || !range.every(Number.isSafeInteger))
      throw Error('Invalid Mac differential range');
    const [target, base, size] = range;
    if (target < previousEnd || base < 0 || size <= 0 ||
        target + size > targetSize || base + size > delta.base.size)
      throw Error('Mac differential range exceeds its archive');
    previousEnd = target + size;
    reusableBytes += size;
  }
  if (reusableBytes <= delta.size) throw Error('Mac differential would not save any transfer');
  return value;
}

export async function downloadDifferential(
  candidate: ReleaseCandidate,
  update: SignedMacUpdate,
  delta: MacDeltaFile,
  partial: string,
  signal: AbortSignal,
  fetcher: ReleaseFetch,
  progress: (percent: number) => void,
) {
  if (update.size > macArchiveByteLimit) throw Error('Update archive too large');
  const baseline = path.join(path.dirname(partial), `VoxCue-${delta.base.version}-arm64.zip`);
  const verified = await verifyDownload(baseline, delta.base, signal);
  const plan = Buffer.alloc(delta.size);
  let planOffset = 0;
  await transferUpdateBytes(releaseAssetUrl(candidate, delta.url), plan.length, signal, fetcher, chunk => {
    plan.set(chunk, planOffset);
    planOffset += chunk.length;
  });
  if (createHash('sha512').update(plan).digest('base64') !== delta.sha512)
    throw Error('Mac differential plan checksum mismatch');
  const copies = copyRanges(JSON.parse(plan.toString('utf8')), update.size, delta);
  const input = await openArchive(baseline);
  try {
    if (!sameArchiveVersion(verified, await input.stat())) throw Error('Mac differential baseline changed');
    signal.throwIfAborted();
    const output = await open(partial, 'wx', 0o600);
    try {
      const buffer = Buffer.allocUnsafe(1024 * 1024);
      const target = releaseAssetUrl(candidate, update.url);
      let written = 0;
      const write = async (chunk: Uint8Array, active: AbortSignal) => {
        await writeUpdateBytes(output, chunk, active);
        written += chunk.length;
        progress(100 * written / update.size);
      };
      const downloadTo = async (offset: number) => {
        if (offset > written)
          await transferUpdateBytes(target, offset - written, signal, fetcher, write, {
            range: { offset: written, archiveSize: update.size },
          });
      };
      for (const [offset, start, size] of copies) {
        await downloadTo(offset);
        for (let remaining = size; remaining > 0;) {
          signal.throwIfAborted();
          const { bytesRead } = await input.read(buffer, 0, Math.min(remaining, buffer.length), start + size - remaining);
          if (!bytesRead) throw Error('Truncated Mac differential baseline');
          await write(buffer.subarray(0, bytesRead), signal);
          remaining -= bytesRead;
        }
      }
      await downloadTo(update.size);
      if (!sameArchiveVersion(verified, await input.stat())) throw Error('Mac differential baseline changed');
      await output.sync();
    } finally {
      await output.close();
    }
  } finally {
    await input.close();
  }
  // The native installer still receives the original signed ZIP, byte for byte.
  return verifyDownload(partial, update, signal);
}
