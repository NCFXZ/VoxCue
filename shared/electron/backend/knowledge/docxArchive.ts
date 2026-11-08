import { crc32, inflateRawSync } from 'node:zlib';

const maxEntries = 4096;
const maxEntryBytes = 32 * 1024 * 1024;
const maxArchiveBytes = 64 * 1024 * 1024;
const invalid = () => new Error('Invalid DOCX archive');

// Validate the same private buffer later consumed by Mammoth. Its ZIP reader
// otherwise inflates complete entries before the text-size limit can run.
export function validateDocxArchive(bytes: Buffer, byteLimit = maxArchiveBytes): void {
  // Tests may lower the cumulative budget, never widen the production limit.
  if (
    !Number.isSafeInteger(byteLimit) ||
    byteLimit < 1 ||
    byteLimit > maxArchiveBytes ||
    bytes.length < 22 ||
    bytes.length > 20 * 1024 * 1024
  )
    throw invalid();
  let end = -1;
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65557); offset--)
    if (bytes.readUInt32LE(offset) === 0x06054b50) {
      end = offset;
      break;
    }
  if (
    end < 0 ||
    end + 22 + bytes.readUInt16LE(end + 20) !== bytes.length ||
    bytes.readUInt16LE(end + 4) ||
    bytes.readUInt16LE(end + 6)
  )
    throw invalid();
  const entries = bytes.readUInt16LE(end + 10);
  const directorySize = bytes.readUInt32LE(end + 12);
  const directory = bytes.readUInt32LE(end + 16);
  if (
    !entries ||
    entries > maxEntries ||
    bytes.readUInt16LE(end + 8) !== entries ||
    directory + directorySize !== end
  )
    throw invalid();
  let cursor = directory;
  let total = 0;
  for (let index = 0; index < entries; index++) {
    if (cursor + 46 > end || bytes.readUInt32LE(cursor) !== 0x02014b50) throw invalid();
    const flags = bytes.readUInt16LE(cursor + 8);
    const method = bytes.readUInt16LE(cursor + 10);
    const crc = bytes.readUInt32LE(cursor + 16);
    const compressed = bytes.readUInt32LE(cursor + 20);
    const expanded = bytes.readUInt32LE(cursor + 24);
    const nameSize = bytes.readUInt16LE(cursor + 28);
    const next =
      cursor + 46 + nameSize + bytes.readUInt16LE(cursor + 30) + bytes.readUInt16LE(cursor + 32);
    const local = bytes.readUInt32LE(cursor + 42);
    if (
      flags & 0x2041 ||
      ![0, 8].includes(method) ||
      !nameSize ||
      next > end ||
      bytes.readUInt16LE(cursor + 34) ||
      expanded > maxEntryBytes ||
      total + expanded > byteLimit ||
      local + 30 > directory ||
      bytes.readUInt32LE(local) !== 0x04034b50 ||
      bytes.readUInt16LE(local + 6) !== flags ||
      bytes.readUInt16LE(local + 8) !== method ||
      bytes.readUInt16LE(local + 26) !== nameSize
    )
      throw invalid();
    const data = local + 30 + nameSize + bytes.readUInt16LE(local + 28);
    if (
      data + compressed > directory ||
      !bytes
        .subarray(local + 30, local + 30 + nameSize)
        .equals(bytes.subarray(cursor + 46, cursor + 46 + nameSize))
    )
      throw invalid();
    for (const [offset, expected] of [
      [14, crc],
      [18, compressed],
      [22, expanded],
    ]) {
      const value = bytes.readUInt32LE(local + offset);
      if (value !== expected && (!(flags & 8) || value !== 0)) throw invalid();
    }
    const payload = bytes.subarray(data, data + compressed);
    let output: Buffer;
    if (method === 0) output = payload;
    else {
      // Even a forged small declaration cannot cause unbounded actual output.
      // Empty deflated entries need a positive cap, then the exact size check.
      const inflated = inflateRawSync(payload, {
        maxOutputLength: Math.max(1, expanded),
        info: true,
      }) as unknown as { buffer: Buffer; engine: { bytesWritten: number } };
      if (inflated.engine.bytesWritten !== compressed) throw invalid();
      output = inflated.buffer;
    }
    if (output.length !== expanded || crc32(output) !== crc) throw invalid();
    total += output.length;
    cursor = next;
  }
  if (cursor !== end) throw invalid();
}
