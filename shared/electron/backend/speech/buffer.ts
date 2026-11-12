// Small bounded float buffer; overflow is a surfaced failure, never silent loss.
export class SampleBuffer {
  private data: Float32Array;
  private head = 0;
  length = 0;
  constructor(readonly capacity: number) {
    this.data = new Float32Array(capacity);
  }
  push(samples: Float32Array) {
    if (this.length + samples.length > this.capacity)
      throw Error('音频缓存已满；请停止并降低识别负载。');
    for (let i = 0; i < samples.length; i++)
      this.data[(this.head + this.length + i) % this.capacity] = samples[i];
    this.length += samples.length;
  }
  take(count: number) {
    if (count > this.length) throw Error('Insufficient samples');
    const result = new Float32Array(count);
    for (let i = 0; i < count; i++) result[i] = this.data[(this.head + i) % this.capacity];
    this.head = (this.head + count) % this.capacity;
    this.length -= count;
    return result;
  }
}
export interface AudioPacket {
  rate: number;
  timestamp: number;
  flags: number;
  samples: Float32Array;
}
export class PacketDecoder {
  private pending = Buffer.alloc(0);
  push(chunk: Buffer): AudioPacket[] {
    if (this.pending.length + chunk.length > 4 * 1024 * 1024)
      throw Error('Invalid audio pipe backlog');
    this.pending = Buffer.concat([this.pending, chunk]);
    const packets: AudioPacket[] = [];
    while (this.pending.length >= 4) {
      const length = this.pending.readUInt32LE(0);
      if (length < 17 || length > 800000 || (length - 17) % 4) throw Error('Invalid audio packet');
      if (this.pending.length < length + 4) break;
      const p = this.pending.subarray(4, 4 + length);
      if (p[0] !== 1) throw Error('Invalid audio packet type');
      const rate = p.readUInt32LE(1);
      if (rate < 8000 || rate > 192000) throw Error('Invalid audio rate');
      const samples = new Float32Array((length - 17) / 4);
      for (let i = 0; i < samples.length; i++) {
        const sample = p.readFloatLE(17 + i * 4);
        if (!Number.isFinite(sample)) throw Error('Invalid audio sample');
        samples[i] = sample;
      }
      packets.push({ rate, timestamp: p.readDoubleLE(5), flags: p.readUInt32LE(13), samples });
      this.pending = this.pending.subarray(4 + length);
    }
    return packets;
  }
}

// Bound protocol lines before decoding UTF-8 or retaining an incomplete line.
export class BoundedLineDecoder {
  private readonly pending: Buffer;
  private bytes = 0;
  constructor(private readonly limit: number) {
    this.pending = Buffer.allocUnsafe(limit);
  }
  push(chunk: Buffer): string[] {
    const lines: string[] = [];
    let offset = 0;
    while (offset < chunk.length) {
      const newline = chunk.indexOf(10, offset);
      const end = newline < 0 ? chunk.length : newline;
      const length = end - offset;
      if (this.bytes + length > this.limit) {
        this.bytes = 0;
        throw Error('Native protocol line exceeds limit');
      }
      if (length) {
        chunk.copy(this.pending, this.bytes, offset, end);
        this.bytes += length;
      }
      if (newline < 0) break;
      lines.push(this.finish());
      offset = newline + 1;
    }
    return lines;
  }
  finish() {
    const line = this.pending.toString('utf8', 0, this.bytes).replace(/\r$/, '');
    this.bytes = 0;
    return line;
  }
}
