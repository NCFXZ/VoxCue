import { createHash, randomUUID } from 'node:crypto';
import { constants, createReadStream, mkdirSync, realpathSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { recordingRecordId, type UnavailableRecording } from '../../contracts/recordings';
import { pendingRecordingSuffix, recordingRate, wavHeaderSize } from '../speech/recording';

const filename = /^(\d{13})-([a-f0-9-]{36})\.wav$/;
function recordingName(name: string) {
  return filename.exec(name.endsWith(pendingRecordingSuffix) ? name.slice(0, -pendingRecordingSuffix.length) : name);
}
export interface LocalRecording {
  id: string;
  startedAt: number;
  durationMs: number;
  file: string;
  size: number;
}
export function streamRecording(clip: LocalRecording, start: number, end: number, signal?: AbortSignal) {
  if (!clip.file.endsWith(pendingRecordingSuffix)) return createReadStream(clip.file, { start, end, signal });
  // A live checkpoint can grow or be renamed on close between listing and playback.
  // The grant's header and body must continue to describe the same bounded snapshot.
  async function* checkpoint() {
    const flags = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0);
    let finalized = false;
    const handle = await fs.open(clip.file, flags).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
      finalized = true;
      return fs.open(clip.file.slice(0, -pendingRecordingSuffix.length), flags);
    });
    try {
      const header = Buffer.alloc(wavHeaderSize);
      const { bytesRead } = await handle.read(header, 0, header.length, 0);
      const stat = await handle.stat();
      const extent = wavHeaderSize + header.readUInt32LE(40);
      if (!stat.isFile() || bytesRead !== header.length || extent < clip.size || extent > stat.size ||
          (finalized && extent !== stat.size) ||
          !validRecordingHeader(header, extent)) throw Error('录音文件不完整。');
      if (start < wavHeaderSize) {
        header.writeUInt32LE(clip.size - 8, 4);
        header.writeUInt32LE(clip.size - wavHeaderSize, 40);
        yield header.subarray(start, Math.min(header.length, end + 1));
      }
      for (let at = Math.max(start, wavHeaderSize); at <= end;) {
        signal?.throwIfAborted();
        const bytes = Buffer.allocUnsafe(Math.min(end - at + 1, 64 * 1024));
        const read = await handle.read(bytes, 0, bytes.length, at);
        if (!read.bytesRead) throw Error('录音文件不完整。');
        yield bytes.subarray(0, read.bytesRead);
        at += read.bytesRead;
      }
    } finally { await handle.close(); }
  }
  return Readable.from(checkpoint(), { objectMode: false, signal });
}
export async function exportRecording(clip: LocalRecording, destination: string) {
  if (!clip.file.endsWith(pendingRecordingSuffix)) return fs.copyFile(clip.file, destination);
  if (!path.relative(clip.file, destination) ||
      !path.relative(clip.file.slice(0, -pendingRecordingSuffix.length), destination))
    throw Error('无法覆盖原录音。');
  // The file may grow past its last committed header. Publish exactly the playable prefix.
  const temporary = path.join(path.dirname(destination), '.' + randomUUID() + '.tmp');
  const handle = await fs.open(temporary, 'wx', 0o600);
  try {
    await pipeline(streamRecording(clip, 0, clip.size - 1), handle.createWriteStream());
    await fs.rename(temporary, destination);
  } finally {
    await handle.close();
    await fs.unlink(temporary).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
    });
  }
}
export function validRecordingHeader(bytes: Buffer, size: number) {
  return !(
    bytes.length < wavHeaderSize ||
    size <= wavHeaderSize ||
    size % 2 ||
    bytes.toString('ascii', 0, 4) !== 'RIFF' ||
    bytes.readUInt32LE(4) !== size - 8 ||
    bytes.toString('ascii', 8, 16) !== 'WAVEfmt ' ||
    bytes.readUInt32LE(16) !== 16 ||
    bytes.readUInt16LE(20) !== 1 ||
    bytes.readUInt16LE(22) !== 1 ||
    bytes.readUInt32LE(24) !== recordingRate ||
    bytes.readUInt32LE(28) !== recordingRate * 2 ||
    bytes.readUInt16LE(32) !== 2 ||
    bytes.readUInt16LE(34) !== 16 ||
    bytes.toString('ascii', 36, 40) !== 'data' ||
    bytes.readUInt32LE(40) !== size - wavHeaderSize
  );
}
export class RecordingLibrary {
  constructor(private root: string) {}
  private ownerDirectory(owner: string) {
    if (!owner) throw Error('无效的录音操作。');
    return path.join(this.root, createHash('sha256').update(owner).digest('hex'));
  }
  private directory(owner: string, recordId: string) {
    if (!recordingRecordId(recordId)) throw Error('无效的录音操作。');
    return path.join(this.ownerDirectory(owner), recordId);
  }
  private async checkedDirectory(directory: string) {
    const parent = path.dirname(this.root);
    const actual = await fs.realpath(directory);
    if (actual !== path.join(await fs.realpath(parent), path.relative(parent, directory)))
      throw Error('无效的录音位置。');
    return actual;
  }
  async pendingRemovals(owner: string) {
    try {
      const entries = await fs.readdir(await this.checkedDirectory(this.ownerDirectory(owner)), { withFileTypes: true });
      return entries.filter(e => e.isDirectory() && e.name.startsWith('.deleting-'))
        .map(e => e.name.slice('.deleting-'.length)).filter(recordingRecordId);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw Error('无法读取本地录音。');
    }
  }
  private staged(owner: string, recordId: string) {
    return path.join(path.dirname(this.directory(owner, recordId)), '.deleting-' + recordId);
  }
  async moveRemoval(owner: string, recordId: string, restore: boolean) {
    const live = this.directory(owner, recordId), staged = this.staged(owner, recordId);
    const from = restore ? staged : live, to = restore ? live : staged;
    let source: string;
    try { source = await this.checkedDirectory(from); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
    // A recovered or reimported directory belongs to its own record. Never replace it.
    const exists = await fs.lstat(to).then(() => true, (error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
      return false;
    });
    if (exists) throw Error('录音目录已存在。');
    await fs.rename(source, to);
  }
  prepare(owner: string, recordId: string, resume: boolean) {
    const target = this.directory(owner, recordId);
    // Check each parent before creating children. Reject links and Windows junctions.
    const root = realpathSync(path.dirname(this.root));
    const relative = path.relative(path.dirname(this.root), target);
    const destination = path.join(root, relative);
    let current = root;
    for (const part of relative.split(path.sep)) {
      current = path.join(current, part);
      try {
        mkdirSync(current, { mode: 0o700 });
      } catch (error) {
        if (
          (error as NodeJS.ErrnoException).code !== 'EEXIST' ||
          (current === destination && !resume)
        )
          throw Error('无法创建本地录音。');
      }
      if (realpathSync(current) !== current) throw Error('无效的录音位置。');
    }
    return current;
  }
  async inspect(owner: string, recordId: string): Promise<(LocalRecording | UnavailableRecording)[]> {
    const directory = this.directory(owner, recordId);
    let actual: string;
    try { actual = await this.checkedDirectory(directory); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw Error('无法读取本地录音。');
      // A staged deletion is still recoverable and must not be migrated as an empty interview.
      try { await fs.lstat(this.staged(owner, recordId)); }
      catch (stagedError) { if ((stagedError as NodeJS.ErrnoException).code === 'ENOENT') return []; }
      throw Error('无法读取本地录音。');
    }
    const clips: (LocalRecording | UnavailableRecording)[] = [];
    const entries = await fs.readdir(actual, { withFileTypes: true }).catch(() => {
      throw Error('无法读取本地录音。');
    });
    for (const entry of entries) {
      const match = recordingName(entry.name);
      if (!match || !recordingRecordId(match[2])) continue;
      const identity = { id: match[2], startedAt: Number(match[1]) };
      const file = path.join(actual, entry.name);
      try {
        if (!entry.isFile()) throw Error();
        const handle = await fs.open(file, 'r');
        try {
          const header = Buffer.alloc(wavHeaderSize);
          const { bytesRead } = await handle.read(header, 0, header.length, 0);
          const physicalSize = (await handle.stat()).size;
          const size = entry.name.endsWith(pendingRecordingSuffix)
            ? wavHeaderSize + header.readUInt32LE(40) : physicalSize;
          if (bytesRead !== header.length || size > physicalSize || !validRecordingHeader(header, size)) throw Error();
          clips.push({ ...identity, file, size, durationMs: ((size - wavHeaderSize) / 2 / recordingRate) * 1000 });
        } finally { await handle.close(); }
      } catch { clips.push({ ...identity, unavailable: true }); }
    }
    return clips.sort((a, b) => a.startedAt - b.startedAt || a.id.localeCompare(b.id));
  }
  async list(owner: string, recordId: string): Promise<LocalRecording[]> {
    return (await this.inspect(owner, recordId)).map(clip => {
      if ('unavailable' in clip) throw Error('录音文件不完整。');
      return clip;
    });
  }
  async remove(owner: string, recordId: string, staged = false) {
    const directory = staged ? this.staged(owner, recordId) : this.directory(owner, recordId);
    try {
      await this.checkedDirectory(directory);
      for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
        if (entry.isFile() && recordingName(entry.name))
          await fs.unlink(path.join(directory, entry.name));
      }
      await fs.rmdir(directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw Error('无法清理本地录音。');
    }
  }
}
