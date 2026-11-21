import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { link, lstat, open, rmdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { RecordingLibrary, validRecordingHeader, type LocalRecording } from './interview/recordings';
import { pendingRecordingSuffix, wavHeaderSize } from './speech/recording';
import { maxRestoreItems } from '../contracts/restoreData';
import { recordingRecordId } from '../contracts/recordings';
import type { MovedClip } from './profileMoveReceipt';

const partSize = 4 * 1024 ** 2;
const invalid = () => Error('来源账号的面试录音无效或不完整。');
const conflict = () => Error('录音片段与已有文件冲突，已保留原件。');
async function readOriginal(
  clip: LocalRecording,
  signal: AbortSignal,
  write?: (bytes: Buffer) => Promise<void>,
) {
  if (!(await lstat(clip.file)).isFile()) throw invalid();
  const fd = await open(clip.file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const stat = await fd.stat();
    if (!stat.isFile() || stat.size < clip.size || stat.size > 0xffffffff + 8 || clip.size <= wavHeaderSize ||
        (stat.size !== clip.size && !clip.file.endsWith(pendingRecordingSuffix))) throw invalid();
    const hash = createHash('sha256');
    // Hash any uncommitted tail for source identity only. Only the validated WAV prefix is published.
    let original: ReturnType<typeof createHash> | undefined;
    const buffer = Buffer.allocUnsafe(Math.min(partSize, stat.size));
    for (let offset = 0; offset < stat.size;) {
      signal.throwIfAborted();
      const committed = offset < clip.size;
      const length = Math.min(buffer.length, (committed ? clip.size : stat.size) - offset);
      let received = 0;
      while (received < length) {
        const { bytesRead } = await fd.read(buffer, received, length - received, offset + received);
        if (!bytesRead) throw invalid();
        received += bytesRead;
      }
      const bytes = buffer.subarray(0, length);
      if (!offset && !validRecordingHeader(bytes, clip.size)) throw invalid();
      if (committed) {
        hash.update(bytes);
        await write?.(bytes);
      } else (original ??= hash.copy()).update(bytes);
      offset += length;
    }
    const final = await fd.stat();
    if (final.size !== stat.size || final.mtimeMs !== stat.mtimeMs) throw invalid();
    return { hash: hash.digest('hex'), ...(original ? { sourceHash: original.digest('hex') } : {}) };
  } finally {
    await fd.close();
  }
}
/** The active transfer owns only the new files it published in the destination library. */
export async function copyProfileRecordings(
  library: RecordingLibrary,
  source: string,
  target: string,
  recordIds: string[],
  signal: AbortSignal,
) {
  if (source === target) throw invalid();
  const added: { file: string; dev: bigint; ino: bigint }[] = [];
  const createdDirs = new Set<string>();
  const copied: MovedClip[] = [];
  const rollback = async () => {
    for (const item of added) {
      try {
        const current = await lstat(item.file, { bigint: true });
        if (current.isFile() && current.dev === item.dev && current.ino === item.ino)
          await unlink(item.file);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
    for (const directory of createdDirs)
      await rmdir(directory).catch((error: NodeJS.ErrnoException) => {
        if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error.code ?? '')) throw error;
      });
  };
  try {
    for (const recordId of new Set(recordIds)) {
      signal.throwIfAborted();
      const clips = await library.list(source, recordId);
      if (!clips.length) continue;
      if (new Set(clips.map((clip) => clip.id)).size !== clips.length) throw conflict();
      const existing = await library.list(target, recordId);
      const byId = new Map(existing.map((clip) => [clip.id, clip]));
      if (byId.size !== existing.length) throw conflict();
      let directory: string;
      try {
        directory = library.prepare(target, recordId, false);
        createdDirs.add(directory);
      } catch {
        directory = library.prepare(target, recordId, true);
      }
      for (const clip of clips) {
        signal.throwIfAborted();
        if (copied.length >= maxRestoreItems) throw invalid();
        const previous = byId.get(clip.id);
        if (previous) {
          const digest = await readOriginal(clip, signal);
          if (
            previous.size !== clip.size ||
            previous.startedAt !== clip.startedAt ||
            (await readOriginal(previous, signal)).hash !== digest.hash
          )
            throw conflict();
          copied.push({ recordId, id: clip.id, startedAt: clip.startedAt, ...digest });
          continue;
        }
        const temporary = path.join(path.dirname(directory), '.' + randomUUID() + '.tmp');
        const handle = await open(temporary, 'wx', 0o600);
        try {
          try {
            const digest = await readOriginal(clip, signal, (bytes) => handle.writeFile(bytes));
            await handle.sync();
            copied.push({ recordId, id: clip.id, startedAt: clip.startedAt, ...digest });
          } finally {
            await handle.close();
          }
          signal.throwIfAborted();
          const { dev, ino } = await lstat(temporary, { bigint: true });
          const file = path.join(directory, clip.startedAt + '-' + clip.id + '.wav');
          await link(temporary, file).catch((error: NodeJS.ErrnoException) => {
            if (error.code === 'EEXIST') throw conflict();
            throw Error('本机无法恢复面试录音。');
          });
          added.push({ file, dev, ino });
        } finally {
          await unlink(temporary);
        }
      }
    }
    return Object.assign(rollback, { copied });
  } catch (error) {
    await rollback();
    throw error;
  }
}

/** Delete only individual source WAVs that were actually copied and still match their digest. */
export async function removeMovedRecordings(
  library: RecordingLibrary,
  source: string,
  copied: MovedClip[],
  signal: AbortSignal,
) {
  const byRecord = new Map<string, Map<string, MovedClip>>();
  for (const clip of copied) {
    const group = byRecord.get(clip.recordId) ?? new Map<string, MovedClip>();
    group.set(clip.id, clip);
    byRecord.set(clip.recordId, group);
  }
  for (const [recordId, group] of byRecord) {
    signal.throwIfAborted();
    for (const current of await library.list(source, recordId)) {
      const moved = group.get(current.id);
      if (!moved || current.startedAt !== moved.startedAt) continue;
      const digest = await readOriginal(current, signal);
      if (digest.hash !== moved.hash || digest.sourceHash !== moved.sourceHash) continue;
      signal.throwIfAborted();
      await unlink(current.file);
    }
  }
}

/** A new segment still belongs to the source interview, even when the interview row itself is unchanged. */
export async function checkMovedRecordings(
  library: RecordingLibrary,
  source: string,
  recordIds: string[],
  copied: MovedClip[],
  signal: AbortSignal,
) {
  const expected = new Map(copied.map((c) => [c.recordId + ':' + c.id, c]));
  for (const recordId of recordIds.filter(recordingRecordId)) {
    signal.throwIfAborted();
    for (const clip of await library.list(source, recordId)) {
      const saved = expected.get(recordId + ':' + clip.id);
      const digest = saved && await readOriginal(clip, signal);
      if (!saved || saved.startedAt !== clip.startedAt ||
          digest?.hash !== saved.hash || digest?.sourceHash !== saved.sourceHash)
        throw Error('来源资料已改变，请重新选择。');
    }
  }
}
