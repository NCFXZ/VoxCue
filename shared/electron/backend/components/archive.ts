import path from 'node:path';
import { createHash } from 'node:crypto';
import { mkdir, open } from 'node:fs/promises';
import type { ComponentArchive } from './catalog';
import { createReadStream, createWriteStream } from 'node:fs';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createInflateRaw } from 'node:zlib';

export function safePath(value: string) {
  return (
    value.length > 0 &&
    !value.includes('\\') &&
    !value.includes(':') &&
    !value.includes('\0') &&
    value.split('/').every((part) => !!part && part !== '.' && part !== '..')
  );
}

/** Large model archives are authenticated and expanded with bounded memory. */
export async function unpackComponentFile(
  file: string,
  pkg: ComponentArchive,
  destination: string,
  signal: AbortSignal,
) {
  const handle = await open(file, 'r');
  try {
    if ((await handle.stat()).size !== pkg.bytes) throw Error('Invalid archive size');
    const digest = createHash('sha256');
    for await (const block of handle.createReadStream({ autoClose: false, start: 0 })) {
      signal.throwIfAborted();
      digest.update(block);
    }
    if (digest.digest('hex') !== pkg.sha256) throw Error('Invalid archive hash');
    const read = async (position: number, length: number) => {
      if (!Number.isSafeInteger(position) || position < 0 || position + length > pkg.bytes)
        throw Error('Invalid ZIP offset');
      const data = Buffer.alloc(length);
      let offset = 0;
      while (offset < length) {
        const result = await handle.read(data, offset, length - offset, position + offset);
        if (!result.bytesRead) throw Error('Short ZIP read');
        offset += result.bytesRead;
      }
      return data;
    };
    const tail = await read(Math.max(0, pkg.bytes - 65557), Math.min(pkg.bytes, 65557));
    let end = -1;
    for (let i = tail.length - 22; i >= 0; i--)
      if (
        tail.readUInt32LE(i) === 0x06054b50 &&
        i + 22 + tail.readUInt16LE(i + 20) === tail.length
      ) {
        end = i;
        break;
      }
    if (end < 0 || tail.readUInt16LE(end + 4) || tail.readUInt16LE(end + 6))
      throw Error('Invalid ZIP footer');
    const count = tail.readUInt16LE(end + 10),
      size = tail.readUInt32LE(end + 12),
      offset = tail.readUInt32LE(end + 16);
    if (
      count !== pkg.files.length ||
      count !== tail.readUInt16LE(end + 8) ||
      size > 4 * 1024 * 1024 ||
      offset + size !== pkg.bytes - tail.length + end
    )
      throw Error('Invalid ZIP directory');
    const central = await read(offset, size),
      expected = new Map(pkg.files.map((entry) => [entry.path, entry]));
    const seen = new Set<string>();
    let cursor = 0;
    for (let i = 0; i < count; i++) {
      signal.throwIfAborted();
      if (cursor + 46 > size || central.readUInt32LE(cursor) !== 0x02014b50)
        throw Error('Invalid ZIP entry');
      const flags = central.readUInt16LE(cursor + 8),
        method = central.readUInt16LE(cursor + 10),
        compressed = central.readUInt32LE(cursor + 20),
        bytes = central.readUInt32LE(cursor + 24);
      const length = central.readUInt16LE(cursor + 28),
        extra = central.readUInt16LE(cursor + 30),
        comment = central.readUInt16LE(cursor + 32),
        localOffset = central.readUInt32LE(cursor + 42);
      const name = central.subarray(cursor + 46, cursor + 46 + length).toString('utf8'),
        descriptor = expected.get(name),
        type = (central.readUInt32LE(cursor + 38) >>> 16) & 0o170000;
      if (
        !descriptor ||
        !safePath(name) ||
        seen.has(name) ||
        flags & 1 ||
        ![0, 8].includes(method) ||
        bytes !== descriptor.bytes ||
        (type !== 0 && type !== 0o100000) ||
        central.readUInt16LE(cursor + 34)
      )
        throw Error('Invalid ZIP file');
      seen.add(name);
      cursor += 46 + length + extra + comment;
      if (cursor > size) throw Error('Invalid ZIP metadata');
      const local = await read(localOffset, 30);
      if (
        local.readUInt32LE(0) !== 0x04034b50 ||
        local.readUInt16LE(6) !== flags ||
        local.readUInt16LE(8) !== method
      )
        throw Error('Invalid ZIP header');
      const localName = await read(localOffset + 30, local.readUInt16LE(26));
      if (localName.toString('utf8') !== name) throw Error('Invalid ZIP filename');
      const start = localOffset + 30 + local.readUInt16LE(26) + local.readUInt16LE(28);
      if (start + compressed > offset) throw Error('Invalid ZIP data range');
      const target = path.join(destination, ...name.split('/'));
      await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
      const hash = createHash('sha256');
      let written = 0;
      const check = new Transform({
        transform(block, _encoding, callback) {
          written += block.length;
          if (written > descriptor.bytes) {
            callback(Error('Oversized ZIP file'));
            return;
          }
          hash.update(block);
          callback(null, block);
        },
      });
      const input = compressed
        ? createReadStream(file, { start, end: start + compressed - 1 })
        : undefined;
      if (!input) {
        const empty = await open(target, 'wx', descriptor.mode);
        await empty.close();
      } else {
        const output = createWriteStream(target, { flags: 'wx', mode: descriptor.mode });
        if (method === 8) await pipeline(input, createInflateRaw(), check, output, { signal });
        else await pipeline(input, check, output, { signal });
      }
      if (written !== bytes || hash.digest('hex') !== descriptor.sha256)
        throw Error('Invalid extracted file hash');
    }
    if (cursor !== size) throw Error('Unexpected ZIP directory data');
  } finally {
    await handle.close();
  }
}
