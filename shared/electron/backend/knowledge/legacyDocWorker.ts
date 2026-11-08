import { parentPort, workerData } from 'node:worker_threads';

interface LegacyDocument {
  getBody(options: { filterUnicode: false }): string;
  getTextboxes(options: { filterUnicode: false; includeHeadersAndFooters: false }): string;
  getFootnotes(options: { filterUnicode: false }): string;
  getEndnotes(options: { filterUnicode: false }): string;
}

// These narrow internal adapters are tied to word-extractor 1.0.4. Its OOXML
// entry point is deliberately unused; DOCX continues to use Mammoth.
const BufferReader = require('word-extractor/lib/buffer-reader') as new (bytes: Buffer) => {
  open(): Promise<void>;
  close(): Promise<void>;
  read(target: Buffer, offset: number, length: number, position: number): Promise<Buffer>;
};
const WordOleExtractor = require('word-extractor/lib/word-ole-extractor') as new () => {
  extract(reader: InstanceType<typeof BufferReader>): Promise<LegacyDocument>;
  extractWordDocument(document: unknown, bytes: Buffer): Promise<LegacyDocument>;
  writePieces(word: Buffer, table: Buffer): void;
  writeBookmarks(word: Buffer, table: Buffer): void;
  normalizeHeaders(word: Buffer, table: Buffer): void;
};

const maxRecords = 20_000;
// The pinned parser has no mapping for these compressed-code-page bytes.
// Reject them rather than allowing it to insert the string "undefined".
const unsupportedCompressedBytes = new Set([0x80, 0x81, 0x8d, 0x8f, 0x90, 0x9d]);
function checkRange(bytes: Buffer, offset: number, length: number) {
  if (!length) return;
  if (offset < 0 || length < 0 || offset + length > bytes.length)
    throw new Error('Invalid legacy Word table range');
}

class BoundedReader extends BufferReader {
  constructor(private readonly bytes: Buffer) {
    super(bytes);
  }
  override read(target: Buffer, offset: number, length: number, position: number) {
    if (
      ![offset, length, position].every((value) => Number.isSafeInteger(value) && value >= 0) ||
      offset + length > target.length ||
      position + length > this.bytes.length
    )
      throw new Error('Invalid OLE read');
    return super.read(target, offset, length, position);
  }
}

class CheckedExtractor extends WordOleExtractor {
  override extractWordDocument(document: unknown, bytes: Buffer) {
    if (
      bytes.length < 0x01aa ||
      bytes.readUInt16LE(0) !== 0xa5ec ||
      ![0x00c1, 0x00d9, 0x0101, 0x010c, 0x0112].includes(bytes.readUInt16LE(2)) ||
      // FibBase.fEncrypted also covers XOR-obfuscated documents.
      (bytes.readUInt16LE(0x0a) & 0x0100) !== 0
    )
      throw new Error('Unsupported legacy Word document');
    const characters = [0x4c, 0x50, 0x54, 0x5c, 0x60, 0x64, 0x68].reduce(
      (sum, offset) => sum + bytes.readUInt32LE(offset),
      0,
    );
    if (characters > 8_000_000) throw new Error('Legacy Word text limit exceeded');
    for (const offset of [0xfe, 0x106]) {
      const size = bytes.readUInt32LE(offset);
      if (size && (size < 4 || (size - 4) % 8 || (size - 4) / 8 > maxRecords))
        throw new Error('Legacy Word formatting limit exceeded');
    }
    return super.extractWordDocument(document, bytes);
  }
  override writePieces(word: Buffer, table: Buffer) {
    let offset = word.readUInt32LE(0x1a2);
    const size = word.readUInt32LE(0x1a6),
      end = offset + size;
    checkRange(table, offset, size);
    let records = 0;
    while (offset < end && table[offset] === 1) {
      if (++records > maxRecords || offset + 3 > end)
        throw new Error('Invalid legacy Word modifier');
      offset += 3 + table.readUInt16LE(offset + 1);
    }
    if (offset + 5 > end || table[offset] !== 2) throw new Error('Invalid legacy Word piece table');
    const pieceBytes = table.readUInt32LE(offset + 1),
      count = (pieceBytes - 4) / 12;
    offset += 5;
    if (
      !Number.isInteger(count) ||
      count < 1 ||
      count > maxRecords ||
      offset + pieceBytes > end ||
      table.readUInt32LE(offset) !== 0
    )
      throw new Error('Invalid legacy Word piece count');
    let previous = 0;
    for (let index = 0; index < count; index++) {
      const next = table.readUInt32LE(offset + (index + 1) * 4),
        raw = table.readUInt32LE(offset + (count + 1) * 4 + index * 8 + 2),
        compressed = (raw & 0x40000000) !== 0,
        position = (raw & 0x3fffffff) / (compressed ? 2 : 1);
      if (
        next <= previous ||
        next > 8_000_000 ||
        (raw & 0x80000000) !== 0 ||
        !Number.isInteger(position)
      )
        throw new Error('Invalid legacy Word text piece');
      checkRange(word, position, (next - previous) * (compressed ? 1 : 2));
      if (compressed)
        for (let cursor = position; cursor < position + next - previous; cursor++)
          if (unsupportedCompressedBytes.has(word[cursor]))
            throw new Error('Unsupported legacy Word compressed character');
      previous = next;
    }
    super.writePieces(word, table);
  }
  override writeBookmarks(word: Buffer, table: Buffer) {
    for (const offset of [0x142, 0x14a, 0x152])
      checkRange(table, word.readUInt32LE(offset), word.readUInt32LE(offset + 4));
    const size = word.readUInt32LE(0x146);
    if (size) {
      let offset = word.readUInt32LE(0x142);
      const end = offset + size;
      if (size < 6) throw new Error('Invalid legacy Word bookmarks');
      offset += 6;
      let count = 0;
      while (offset < end) {
        if (++count > maxRecords || offset + 2 > end)
          throw new Error('Legacy Word bookmark limit exceeded');
        offset += 2 + table.readUInt16LE(offset) * 2;
        if (offset > end) throw new Error('Invalid legacy Word bookmark');
      }
    }
    super.writeBookmarks(word, table);
  }
  override normalizeHeaders(word: Buffer, table: Buffer) {
    const offset = word.readUInt32LE(0xf2),
      size = word.readUInt32LE(0xf6);
    checkRange(table, offset, size);
    if (size && (size % 4 || size / 4 > maxRecords))
      throw new Error('Legacy Word header limit exceeded');
    let previous = 0;
    for (let index = 0; index < size / 4; index++) {
      const current = table.readUInt32LE(offset + index * 4);
      if (current < previous || current > word.readUInt32LE(0x54))
        throw new Error('Invalid legacy Word header positions');
      previous = current;
    }
    super.normalizeHeaders(word, table);
  }
}

function validateContainer(bytes: Buffer) {
  if (
    bytes.length < 512 ||
    bytes.length > 20 * 1024 * 1024 ||
    !bytes.subarray(0, 8).equals(Buffer.from('d0cf11e0a1b11ae1', 'hex')) ||
    bytes.readUInt16LE(28) !== 0xfffe ||
    ![3, 4].includes(bytes.readUInt16LE(26)) ||
    bytes.readUInt16LE(30) !== (bytes.readUInt16LE(26) === 3 ? 9 : 12) ||
    bytes.readUInt16LE(32) !== 6 ||
    bytes.readUInt32LE(56) !== 4096
  )
    throw new Error('Invalid OLE header');
  const sectorSize = 2 ** bytes.readUInt16LE(30),
    sectors = bytes.length / sectorSize - 1,
    entriesPerSector = sectorSize / 4;
  if (!Number.isInteger(sectors) || sectors < 1) throw new Error('Invalid OLE length');
  for (const offset of [40, 44, 64, 72])
    if (bytes.readUInt32LE(offset) > sectors) throw new Error('Invalid OLE sector count');
  if (!bytes.readUInt32LE(44) || (bytes.readUInt16LE(26) === 3 && bytes.readUInt32LE(40)))
    throw new Error('Invalid OLE allocation table');
  const sectorOffset = (sector: number) => {
    if (sector < 0 || sector >= sectors) throw new Error('Invalid OLE sector');
    return (sector + 1) * sectorSize;
  };
  const fatCount = bytes.readUInt32LE(44),
    fatSectors: number[] = [],
    difatSectors = new Set<number>(),
    usedFatSectors = new Set<number>();
  const addFatSector = (sector: number) => {
    if (fatSectors.length === fatCount) {
      if (sector !== -1) throw new Error('Invalid OLE spare FAT entry');
      return;
    }
    sectorOffset(sector);
    if (usedFatSectors.has(sector)) throw new Error('Repeated OLE FAT sector');
    usedFatSectors.add(sector);
    fatSectors.push(sector);
  };
  for (let index = 0; index < 109; index++) addFatSector(bytes.readInt32LE(76 + index * 4));
  let nextDifat = bytes.readInt32LE(68);
  for (let index = 0; index < bytes.readUInt32LE(72); index++) {
    const offset = sectorOffset(nextDifat);
    if (difatSectors.has(nextDifat)) throw new Error('Cyclic OLE DIFAT');
    difatSectors.add(nextDifat);
    for (let entry = 0; entry < entriesPerSector - 1; entry++)
      addFatSector(bytes.readInt32LE(offset + entry * 4));
    nextDifat = bytes.readInt32LE(offset + sectorSize - 4);
  }
  if (nextDifat !== -2 || fatSectors.length !== fatCount)
    throw new Error('Invalid OLE DIFAT length');

  // Validate every pointer before the dependency can allocate from a chain length.
  // Worker heap limits alone do not constrain the dependency's external Buffers.
  const allocation = (tableSectors: number[], length: number, minimum: number) => {
    if (tableSectors.length * entriesPerSector < length)
      throw new Error('Truncated OLE allocation table');
    const table = new Int32Array(length);
    let index = 0;
    for (const sector of tableSectors) {
      const offset = sectorOffset(sector);
      for (let entry = 0; entry < entriesPerSector; entry++, index++) {
        const target = bytes.readInt32LE(offset + entry * 4);
        if (target < minimum || target >= length) throw new Error('Invalid OLE chain pointer');
        if (index < length) table[index] = target;
      }
    }
    const state = new Uint8Array(length);
    for (let start = 0; start < length; start++) {
      if (state[start]) continue;
      let current = start;
      while (current >= 0 && !state[current]) {
        state[current] = 1;
        current = table[current];
      }
      if (current >= 0 && state[current] === 1) throw new Error('Cyclic OLE allocation chain');
      current = start;
      while (current >= 0 && state[current] === 1) {
        state[current] = 2;
        current = table[current];
      }
    }
    return table;
  };
  const fat = allocation(fatSectors, sectors, -4);
  for (const sector of fatSectors)
    if (fat[sector] !== -3 || difatSectors.has(sector)) throw new Error('Invalid OLE FAT marker');
  for (const sector of difatSectors)
    if (fat[sector] !== -4) throw new Error('Invalid OLE DIFAT marker');
  const chain = (first: number) => {
    const result: number[] = [];
    let current = first;
    while (current >= 0) {
      sectorOffset(current);
      result.push(current);
      current = fat[current];
    }
    if (current !== -2) throw new Error('Invalid OLE chain terminator');
    return result;
  };
  const directory = chain(bytes.readInt32LE(48));
  if (
    !directory.length ||
    (bytes.readUInt16LE(26) === 4 && directory.length !== bytes.readUInt32LE(40))
  )
    throw new Error('Invalid OLE directory length');
  let root: { first: number; size: number } | undefined;
  const streams: { first: number; size: number }[] = [];
  const entryCount = (directory.length * sectorSize) / 128;
  const types = new Uint8Array(entryCount);
  const links = new Int32Array(entryCount * 3);
  let rootIndex = -1;
  let entryIndex = 0;
  for (const sector of directory)
    for (let entry = 0; entry < sectorSize; entry += 128, entryIndex++) {
      const offset = sectorOffset(sector) + entry,
        type = bytes[offset + 66],
        nameLength = bytes.readUInt16LE(offset + 64);
      // The dependency decodes every entry name, including unused slots.
      if (
        nameLength > 64 ||
        nameLength % 2 ||
        (nameLength && bytes.readUInt16LE(offset + nameLength - 2) !== 0) ||
        ![0, 1, 2, 5].includes(type) ||
        (type && nameLength < 2)
      )
        throw new Error('Invalid OLE directory entry');
      types[entryIndex] = type;
      if (!type) continue;
      for (let link = 0; link < 3; link++) {
        const target = bytes.readInt32LE(offset + 68 + link * 4);
        if (target < -1 || target >= entryCount || (type === 2 && link === 2 && target !== -1))
          throw new Error('Invalid OLE directory pointer');
        links[entryIndex * 3 + link] = target;
      }
      if (type !== 2 && type !== 5) continue;
      const size = bytes.readBigUInt64LE(offset + 120);
      if (size > BigInt(bytes.length)) throw new Error('Invalid OLE stream size');
      const stream = { first: bytes.readInt32LE(offset + 116), size: Number(size) };
      if (type === 5) {
        if (root) throw new Error('Repeated OLE root');
        root = stream;
        rootIndex = entryIndex;
      } else streams.push(stream);
    }
  if (rootIndex < 0 || links[rootIndex * 3] !== -1 || links[rootIndex * 3 + 1] !== -1)
    throw new Error('Invalid OLE directory root');
  // A valid hierarchy owns each reachable entry once. Even an acyclic DAG can
  // otherwise expand exponentially in the dependency's recursive child list.
  const visited = new Uint8Array(entryCount);
  const pending = [{ index: rootIndex, depth: 0 }];
  visited[rootIndex] = 1;
  while (pending.length) {
    const { index, depth } = pending.pop()!;
    for (let link = 0; link < 3; link++) {
      const target = links[index * 3 + link];
      if (target === -1) continue;
      if (depth >= 128 || visited[target] || ![1, 2].includes(types[target]))
        throw new Error('Invalid OLE directory hierarchy');
      visited[target] = 1;
      pending.push({ index: target, depth: depth + 1 });
    }
  }
  if (!root || root.size % 64 || root.size > chain(root.first).length * sectorSize)
    throw new Error('Invalid OLE mini stream');
  const miniSectors = chain(bytes.readInt32LE(60));
  if (miniSectors.length !== bytes.readUInt32LE(64)) throw new Error('Invalid OLE mini FAT length');
  const miniCapacity = root.size / 64;
  allocation(miniSectors, miniCapacity, -2);
  for (const stream of streams) {
    const capacity = stream.size < 4096 ? miniCapacity : sectors;
    if (stream.size ? stream.first < 0 || stream.first >= capacity : stream.first !== -2)
      throw new Error('Invalid OLE stream first sector');
  }
}

void (async () => {
  try {
    if (!(workerData instanceof Uint8Array)) throw new Error('Invalid legacy Word input');
    const bytes = Buffer.from(workerData);
    // Bound allocations before the dependency reads any attacker-controlled counts.
    validateContainer(bytes);
    const document = await new CheckedExtractor().extract(new BoundedReader(bytes));
    const options = { filterUnicode: false } as const;
    const text = [
      document.getBody(options),
      document.getTextboxes({ ...options, includeHeadersAndFooters: false }),
      document.getFootnotes(options),
      document.getEndnotes(options),
    ]
      .filter((part) => part.trim())
      .join('\n\n');
    if (text.length > 8_000_000 || !/[\p{L}\p{N}]/u.test(text))
      throw new Error('No usable legacy Word text');
    parentPort!.postMessage(text);
  } catch {
    parentPort!.postMessage(null);
  }
})();
