import { constants } from 'node:fs';
import { mkdir, lstat, open, rename, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { ChatFile } from '../../contracts/chat';
import type { InterviewImage } from '../../contracts/interviewImages';
import { validImagePreview } from '../../contracts/interviewImages';

const maximumBytes = 8 * 1024 * 1024;
export const validImageId = (id: unknown): id is string =>
  typeof id === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(id);
const mediaType = (bytes: Uint8Array) => {
  if (Buffer.from(bytes.subarray(0, 8)).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
    return 'image/png';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  throw Error('截图文件无效。');
};

/** Sent images only; draft captures stay in memory. No renderer paths are accepted. */
export class InterviewImageStore {
  private pending: Promise<unknown> = Promise.resolve();
  private closed = false;
  constructor(private directory: string) {
    if (!path.isAbsolute(directory)) throw Error('无效的截图存储目录。');
  }
  private serial<T>(action: () => Promise<T>): Promise<T> {
    if (this.closed) return Promise.reject(Error('Image store is closed'));
    const result = this.pending.then(action);
    this.pending = result.catch(() => {});
    return result;
  }
  async dispose() {
    this.closed = true;
    await this.pending;
  }
  private file(id: string, preview = false) {
    if (!validImageId(id)) throw Error('无效的截图引用。');
    return path.join(this.directory, id + (preview ? '.preview' : '.image'));
  }
  private async root(create = false) {
    if (create) await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const info = await lstat(this.directory);
    if (!info.isDirectory() || info.isSymbolicLink()) throw Error('截图存储目录不可用。');
  }
  private async readBytes(file: string, maximum: number) {
    const source = await lstat(file);
    if (!source.isFile() || source.isSymbolicLink()) throw Error('截图文件无效。');
    const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const info = await handle.stat();
      if (!info.isFile() || !info.size || info.size > maximum) throw Error('截图文件无效。');
      const bytes = Buffer.alloc(info.size);
      let offset = 0;
      while (offset < bytes.length) {
        const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset);
        if (!bytesRead) throw Error('截图文件不完整。');
        offset += bytesRead;
      }
      return bytes;
    } finally {
      await handle.close();
    }
  }
  private async bytes(id: string) {
    const bytes = await this.readBytes(this.file(id), maximumBytes);
    mediaType(bytes);
    return bytes;
  }
  private async write(file: string, bytes: Uint8Array | string) {
    const temporary = path.join(this.directory, '.' + randomUUID() + '.tmp');
    try {
      const handle = await open(temporary, 'wx', 0o600);
      try {
        await handle.writeFile(bytes);
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(temporary, file);
    } finally {
      await unlink(temporary).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error;
      });
    }
  }
  save(images: { id: string; preview: string; file: ChatFile }[]): Promise<InterviewImage[]> {
    return this.serial(async () => {
      if (
        !images.length ||
        images.length > 5 ||
        new Set(images.map((i) => i.id)).size !== images.length
      )
        throw Error('无效的截图数量。');
      for (const image of images) {
        this.file(image.id);
        if (!image.file.bytes.byteLength || image.file.bytes.byteLength > maximumBytes)
          throw Error('截图文件过大或无效。');
        mediaType(image.file.bytes);
        if (!validImagePreview(image.preview)) throw Error('截图缩略图无效。');
      }
      await this.root(true);
      const created: string[] = [];
      try {
        for (const image of images) {
          const file = this.file(image.id);
          const existing = await lstat(file).catch((error: NodeJS.ErrnoException) => {
            if (error.code !== 'ENOENT') throw error;
            return null;
          });
          if (existing) {
            if (
              existing.isSymbolicLink() ||
              !(await this.bytes(image.id)).equals(Buffer.from(image.file.bytes))
            )
              throw Error('截图引用冲突，原始文件已保留。');
          } else {
            await this.write(file, image.file.bytes);
            created.push(file);
          }
          const previewFile = this.file(image.id, true);
          const preview = await lstat(previewFile).catch((error: NodeJS.ErrnoException) => {
            if (error.code !== 'ENOENT') throw error;
            return null;
          });
          if (preview) {
            if (
              preview.isSymbolicLink() ||
              (await this.readBytes(previewFile, 128 * 1024)).toString('utf8') !== image.preview
            )
              throw Error('截图引用冲突，原始文件已保留。');
          } else {
            await this.write(previewFile, image.preview);
            created.push(previewFile);
          }
        }
        return images.map(({ id, preview }) => ({ id, preview }));
      } catch (error) {
        await Promise.all(created.map((file) => unlink(file).catch(() => {})));
        throw error;
      }
    });
  }
  original(id: string): Promise<{ bytes: Buffer; extension: 'png' | 'jpg' }> {
    return this.serial(async () => {
      this.file(id);
      await this.root();
      const bytes = await this.bytes(id);
      return { bytes, extension: mediaType(bytes) === 'image/png' ? 'png' : 'jpg' };
    });
  }
  async read(id: string): Promise<string> {
    const { bytes } = await this.original(id);
    return `data:${mediaType(bytes)};base64,${bytes.toString('base64')}`;
  }
  preview(id: string): Promise<string> {
    return this.serial(async () => {
      await this.root();
      const preview = (await this.readBytes(this.file(id, true), 128 * 1024)).toString('utf8');
      if (!validImagePreview(preview)) throw Error('截图缩略图无效。');
      return preview;
    });
  }
  remove(ids: string[]): Promise<void> {
    return this.serial(async () => {
      if (ids.length > 100 || ids.some((id) => !validImageId(id))) throw Error('无效的截图引用。');
      try {
        await this.root();
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
        throw error;
      }
      for (const id of new Set(ids))
        for (const preview of [false, true])
          await unlink(this.file(id, preview)).catch((error: NodeJS.ErrnoException) => {
            if (error.code !== 'ENOENT') throw error;
          });
    });
  }
}
