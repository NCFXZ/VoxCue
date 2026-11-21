import { open, rename, unlink, type FileHandle } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AudioSource } from '../../contracts/speech';

export const recordingRate = 16000;
export const wavHeaderSize = 44;
export const pendingRecordingSuffix = '.pending';
export const recordingBacklog = '录音写入积压已达上限，录音已停止。';
const blockSize = recordingRate / 4;
const maxSamples = Math.floor((0xffffffff - 36) / 2); // RIFF's 32-bit chunk length.
// Device packet timestamps can jitter by several samples even on continuous PCM.
const clockTolerance = recordingRate * 0.002;
interface RecordingInput {
  rate: number;
  resampler?: RecordingResampler;
  packetEnd: number;
  expected: number;
  next: number;
}

// The native filter uses a different floating-point kernel across call boundaries.
// Feed it fixed 10 ms blocks so device packet sizes cannot change quantized WAV samples.
class RecordingResampler {
  private readonly converter: {
    resample(samples: Float32Array): Float32Array;
    flush(samples: Float32Array): Float32Array;
  };
  private readonly frame: Float32Array;
  private used = 0;
  constructor(rate: number) {
    this.converter = new (require('sherpa-onnx-node').LinearResampler)(rate, recordingRate);
    this.frame = new Float32Array(Math.max(1, Math.round(rate / 100)));
  }
  resample(samples: Float32Array) {
    if (!this.used && samples.length === this.frame.length) return this.converter.resample(samples);
    const frames: Float32Array[] = [];
    let total = 0;
    for (let at = 0; at < samples.length;) {
      const count = Math.min(this.frame.length - this.used, samples.length - at);
      this.frame.set(samples.subarray(at, at + count), this.used);
      this.used += count;
      at += count;
      if (this.used === this.frame.length) {
        const output = this.converter.resample(this.frame);
        frames.push(output);
        total += output.length;
        this.used = 0;
      }
    }
    if (frames.length === 1) return frames[0];
    const result = new Float32Array(total);
    let offset = 0;
    for (const output of frames) {
      result.set(output, offset);
      offset += output.length;
    }
    return result;
  }
  flush() {
    return this.converter.flush(this.frame.subarray(0, this.used));
  }
}

function header(samples: number) {
  const buf = Buffer.alloc(wavHeaderSize);
  buf.write('RIFF');
  buf.writeUInt32LE(36 + samples * 2, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(recordingRate, 24);
  buf.writeUInt32LE(recordingRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(samples * 2, 40);
  return buf;
}

// Packet positions and recording boundaries use the same capture clock.
// A short mixing window absorbs independent delivery of the two endpoints.
export class InterviewRecording {
  readonly startedAt: number;
  readonly captureStartedAt: number;
  private currentFile: string;
  get file() { return this.currentFile; }
  readonly ready: Promise<void>;
  private fd!: FileHandle;
  private pending: Promise<void>;
  private pendingBytes = 0;
  private pendingPackets = 0;
  private failure?: Error;
  private closing?: Promise<void>;
  private blocks = new Map<number, Float32Array>();
  private inputs = new Map<AudioSource, RecordingInput>();
  private sourceEnd = new Map<AudioSource, number>();
  private committed = 0;
  private through = 0;

  constructor(
    directory: string, now = Date.now(), private readonly onFailure?: () => void,
    private readonly captureClock?: () => number,
  ) {
    this.currentFile = path.join(directory, now + '-' + randomUUID() + '.wav' + pendingRecordingSuffix);
    this.startedAt = now;
    this.captureStartedAt = captureClock?.() ?? now;
    this.ready = this.initialize();
    this.pending = this.ready.catch(error => { this.failure = error; });
  }
  private async initialize() {
    this.fd = await open(this.file, 'wx+', 0o600);
    try {
      await this.write(header(0), 0);
    } catch (error) {
      await this.fd.close();
      await unlink(this.file);
      throw error;
    }
  }
  private async write(buffer: Buffer, at: number) {
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesWritten: count } = await this.fd.write(buffer, offset, buffer.length - offset, at + offset);
      if (!count) throw Error('录音写入失败。');
      offset += count;
    }
  }
  private queue(bytes: number, action: () => Promise<void>) {
    if (this.failure) throw this.failure;
    if (this.closing) throw Error('录音已结束。');
    if (this.pendingBytes + bytes > 8 * 1024 * 1024 || this.pendingPackets >= 2048)
      throw Error(recordingBacklog);
    this.pendingBytes += bytes;
    this.pendingPackets++;
    this.pending = this.pending.then(async () => {
      try {
        if (!this.failure) await action();
      } catch (error) {
        this.failure = error instanceof Error ? error : Error(String(error));
        this.onFailure?.();
      } finally {
        this.pendingBytes -= bytes;
        this.pendingPackets--;
      }
    });
  }
  async drain() {
    await this.pending;
    if (this.failure) throw this.failure;
  }
  // The recording channel hands off its own PCM, separate from the ASR transfer buffer.
  append(source: AudioSource, samples: Float32Array, rate: number, timestamp: number) {
    if (!samples.length) return;
    const packet = samples.byteLength === samples.buffer.byteLength ? samples : samples.slice();
    this.queue(packet.byteLength, () => this.appendPacket(source, packet, rate, timestamp));
  }
  private async appendPacket(source: AudioSource, samples: Float32Array, rate: number, timestamp: number) {
    const position = ((timestamp - this.captureStartedAt) * recordingRate) / 1000;
    let input = this.inputs.get(source);
    if (!input || input.rate !== rate || Math.abs(position - input.packetEnd) > clockTolerance) {
      await this.finishSource(source);
      input = {
        rate, packetEnd: position, expected: position, next: Math.round(position),
        // The same band-limited streaming converter used by local recognition.
        // Load only in the recording process and only when conversion is needed.
        resampler: rate === recordingRate ? undefined :
          new RecordingResampler(rate),
      };
      this.inputs.set(source, input);
    }
    const duration = (samples.length * recordingRate) / rate;
    let output = input.resampler ? input.resampler.resample(samples) : samples;
    // Contiguous packets share a sample cursor. Correct accumulated device
    // drift gradually across a packet, without inserting zeros or double mixing.
    const drift = position - input.expected;
    const correction = Math.abs(drift) > clockTolerance && output.length >= 32 ? Math.sign(drift) : 0;
    if (correction) {
      const original = output;
      output = new Float32Array(original.length + correction);
      const scale = (original.length - 1) / (output.length - 1);
      for (let i = 0; i < output.length - 1; i++) {
        const offset = i * scale, left = Math.floor(offset);
        output[i] = original[left] + (original[left + 1] - original[left]) * (offset - left);
      }
      output[output.length - 1] = original[original.length - 1];
    }
    await this.mix(source, output, input.next);
    input.next += output.length;
    input.packetEnd = position + duration;
    input.expected += duration + correction;
  }
  endSource(source: AudioSource) {
    this.queue(0, () => this.finishSource(source));
  }
  private async finishSource(source: AudioSource) {
    const input = this.inputs.get(source);
    this.inputs.delete(source);
    if (input?.resampler) await this.mix(source, input.resampler.flush(), input.next);
  }
  private async mix(source: AudioSource, samples: Float32Array, start: number) {
    const end = start + samples.length;
    if (!Number.isSafeInteger(end) || end > maxSamples) throw Error('录音时长超出限制。');
    const from = Math.max(start, this.sourceEnd.get(source) ?? 0);
    if (from >= end || !samples.length) return;
    // Loopback can deliver actual playback over an earlier inferred silent
    // interval. Silence advances the timeline but does not claim those samples.
    let audibleEnd = end;
    while (audibleEnd > from && samples[audibleEnd - start - 1] === 0) audibleEnd--;
    for (let at = from; at < audibleEnd;) {
      const index = Math.floor(at / blockSize);
      const blockStart = index * blockSize;
      const until = Math.min(audibleEnd, blockStart + blockSize);
      const committed = blockStart < this.committed;
      const mixStart = committed ? at : blockStart;
      let block = this.blocks.get(index);
      if (!block) {
        block = new Float32Array(committed ? until - at : blockSize);
        if (committed) {
          // Late packets only touch the overlapping part of checkpointed PCM.
          const data = Buffer.allocUnsafe(block.length * 2);
          if (
            (await this.fd.read(data, 0, data.length, wavHeaderSize + mixStart * 2)).bytesRead !==
            data.length
          )
            throw Error('录音文件不完整。');
          for (let i = 0; i < block.length; i++) block[i] = data.readInt16LE(i * 2) / 32767;
        } else this.blocks.set(index, block);
      }
      for (; at < until; at++) block[at - mixStart] += samples[at - start];
      if (committed) await this.writeSamples(mixStart, block, block.length);
    }
    if (audibleEnd > from) this.sourceEnd.set(source, audibleEnd);
    this.through = Math.max(this.through, end);
    await this.flush(Math.max(0, Math.floor((this.through - recordingRate) / blockSize) * blockSize));
  }
  private writeSamples(start: number, block: Float32Array, count: number) {
    const data = Buffer.allocUnsafe(count * 2);
    for (let i = 0; i < count; i++)
      data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, block[i])) * 32767), i * 2);
    return this.write(data, wavHeaderSize + start * 2);
  }
  private async flush(until: number) {
    if (until <= this.committed) return;
    for (const [index, block] of this.blocks) {
      const start = index * blockSize;
      if (start >= until) continue;
      await this.writeSamples(start, block, Math.min(blockSize, until - start));
      this.blocks.delete(index);
    }
    await this.fd.truncate(wavHeaderSize + until * 2);
    await this.write(header(until), 0);
    this.committed = until;
  }
  close(now = this.captureClock?.() ?? Date.now()) {
    return this.closing ??= this.finish(now);
  }
  private async finish(now: number) {
    await this.ready;
    let publish = false;
    try {
      await this.drain();
      for (const source of this.inputs.keys()) await this.finishSource(source);
      const elapsed = Math.max(0, Math.round(((now - this.captureStartedAt) * recordingRate) / 1000));
      await this.flush(Math.min(maxSamples, Math.max(this.through, elapsed)));
      publish = true;
    } catch (error) {
      // A failed checkpoint may have extended the body before updating the
      // header. Restore the last complete extent so the saved prefix can play.
      if (this.committed) {
        await this.fd.truncate(wavHeaderSize + this.committed * 2);
        await this.write(header(this.committed), 0);
        publish = true;
      }
      throw error;
    } finally {
      await this.fd.close();
      if (!this.committed) await unlink(this.file);
      else if (publish) {
        const final = this.file.slice(0, -pendingRecordingSuffix.length);
        await rename(this.file, final);
        this.currentFile = final;
      }
    }
  }
}
