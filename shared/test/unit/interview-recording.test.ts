import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { RecordingLibrary, exportRecording } from '../../electron/backend/interview/recordings';
import { InterviewRecording, recordingBacklog, recordingRate } from '../../electron/backend/speech/recording';
import { RecordingChannel } from '../../electron/backend/speech/recordingChannel';
import { recordingResponse } from '../../electron/backend/interview/recordingStream';

let root: string;
let library: RecordingLibrary;
const id = randomUUID();
const start = 1800000000000;
it('原子暂存全部录音并按所有者恢复，重复收尾只清理暂存目录', async () => {
  const directory = library.prepare('first', id, false);
  const writer = new InterviewRecording(directory, start);
  await writer.close(start + 50);
  const clips = await library.list('first', id);
  await library.moveRemoval('first', id, false);
  expect(await library.pendingRemovals('first')).toEqual([id]);
  expect(await library.pendingRemovals('second')).toEqual([]);
  await library.moveRemoval('first', id, true);
  expect(await library.list('first', id)).toEqual(clips);
  await library.moveRemoval('first', id, false);
  const restored = new InterviewRecording(library.prepare('first', id, false), start + 5000);
  await restored.close(start + 5050);
  await expect(library.moveRemoval('first', id, true)).rejects.toThrow();
  await library.remove('first', id, true);
  await library.remove('first', id, true);
  expect(await library.pendingRemovals('first')).toEqual([]);
  expect((await library.list('first', id)).map(c => c.startedAt)).toEqual([start + 5000]);
});
function converted(samples: Float32Array, rate: number): Float32Array {
  if (rate === recordingRate) return samples;
  const { LinearResampler } = require('sherpa-onnx-node');
  return new LinearResampler(rate, recordingRate).flush(samples);
}
it('保留损坏片段的次序和身份，完好录音仍能播放，迁移拒绝不完整的原件', async () => {
  const directory = library.prepare('first', id, false);
  for (let i = 0; i < 3; i++) {
    const writer = new InterviewRecording(directory, start + i * 1000);
    await writer.close(writer.startedAt + 100);
  }
  const [first, middle, last] = await library.list('first', id);
  await fs.truncate(middle.file, 45);
  expect(await library.inspect('first', id)).toEqual([
    first, { id: middle.id, startedAt: middle.startedAt, unavailable: true }, last,
  ]);
  await expect(library.list('first', id)).rejects.toThrow();
  await fs.writeFile(middle.file, Buffer.alloc(first.size));
  expect((await library.inspect('first', id))[1]).toHaveProperty('unavailable', true);
  await expect(library.list('first', id)).rejects.toThrow();
});
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'voxcue-recording-test-'));
  library = new RecordingLibrary(path.join(root, 'recordings'));
});
it('中断写入只播放和导出已提交的完整前缀，已封存 WAV 仍严格检查实际长度', async () => {
  const directory = library.prepare('first', id, false);
  const writer = new InterviewRecording(directory, start);
  writer.append('system', new Float32Array(recordingRate * 2).fill(0.25), recordingRate, start);
  await writer.drain();
  const prefix = await fs.readFile(writer.file);
  const orphan = path.join(directory, (start + 1) + '-' + randomUUID() + '.wav.pending');
  await fs.writeFile(orphan, Buffer.concat([prefix, Buffer.alloc(4001)]));
  await writer.close(start + 2000);
  await fs.appendFile(writer.file, Buffer.alloc(2));
  const [corrupt, recovered] = await library.inspect('first', id);
  expect(corrupt).toHaveProperty('unavailable', true);
  if (!('file' in recovered)) throw Error('Expected recoverable prefix');
  expect(recovered.durationMs).toBe(1000);
  expect(Buffer.from(await recordingResponse(new Request('https://fixture.invalid'), recovered).arrayBuffer())).toEqual(prefix);
  const exported = path.join(root, 'exported.wav');
  await exportRecording(recovered, exported);
  expect(await fs.readFile(exported)).toEqual(prefix);
  expect((await fs.stat(orphan)).size).toBe(prefix.length + 4001);
  await fs.truncate(orphan, prefix.length - 2);
  expect((await library.inspect('first', id))[1]).toHaveProperty('unavailable', true);
});
it('播放授权和导出使用同一个检查点，录音继续写或已封存都不改变读取边界', async () => {
  const writer = new InterviewRecording(library.prepare('owner', id, false), start);
  writer.append('system', new Float32Array(recordingRate * 2).fill(0.25), recordingRate, start);
  await writer.drain();
  const [snapshot] = await library.list('owner', id);
  const expected = await fs.readFile(writer.file);
  writer.append('system', new Float32Array(recordingRate).fill(0.5), recordingRate, start + 2000);
  try {
    await writer.drain();
    const file = path.join(root, 'live.wav');
    await exportRecording(snapshot, file);
    expect(await fs.readFile(file)).toEqual(expected);
    await expect(exportRecording(snapshot, writer.file)).rejects.toThrow();
  } finally { await writer.close(start + 3000); }
  const request = new Request('https://fixture.invalid', { headers: { range: 'bytes=39-47' } });
  expect(Buffer.from(await recordingResponse(request, snapshot).arrayBuffer())).toEqual(expected.subarray(39, 48));
  const file = path.join(root, 'completed.wav');
  await exportRecording(snapshot, file);
  expect(await fs.readFile(file)).toEqual(expected);
  expect((await library.list('owner', id))[0].durationMs).toBe(3000);
});
afterEach(() => fs.rm(root, { recursive: true, force: true }));

it('录音队列达到容量时保留已接收的尾部，并在关闭前写完', async () => {
  const writer = new InterviewRecording(root, start);
  const audio = new Float32Array(recordingRate).fill(0.25);
  let seconds = 0;
  try {
    expect(() => {
      for (; seconds < 200; seconds++) writer.append('microphone', audio, recordingRate, start + seconds * 1000);
    }).toThrow(recordingBacklog);
    expect(seconds).toBeGreaterThan(0);
  } finally {
    await writer.close(start + seconds * 1000);
  }
  const wav = await fs.readFile(writer.file);
  expect(wav.readUInt32LE(40)).toBe(seconds * recordingRate * 2);
  expect(wav.readInt16LE(wav.length - 2)).toBe(8192);
});

it('跨块的迟到包只回读重叠的采样，与正常顺序生成相同的完整 WAV', async () => {
  const system = new Float32Array(recordingRate * 2).fill(8192 / 32767);
  const microphone = Float32Array.from({ length: 320 }, (_, i) =>
    i < 310 ? (i % 3 - 1) * 2048 / 32767 : 0);
  const at = start + 245; // 5 ms before a checkpoint block boundary.
  const first = new InterviewRecording(root, start);
  first.append('microphone', microphone, recordingRate, at);
  first.append('system', system, recordingRate, start);
  await first.close(start + 2000);
  const second = new InterviewRecording(root, start);
  second.append('system', system, recordingRate, start);
  await second.drain();
  const probe = await fs.open(second.file, 'r');
  const read = vi.spyOn(Object.getPrototypeOf(probe), 'read');
  await probe.close();
  try {
    second.append('microphone', microphone, recordingRate, at);
    await second.close(start + 2000);
    const bytesRead = read.mock.calls.reduce((n, args) => n + Number(args[2]), 0);
    expect(bytesRead).toBeGreaterThan(0);
    expect(bytesRead).toBeLessThanOrEqual(microphone.length * 2);
  } finally {
    read.mockRestore();
  }
  expect(await fs.readFile(second.file)).toEqual(await fs.readFile(first.file));
});

it('写盘中途出错时报告一次失败并仍可播放上一次保存的录音', async () => {
  const failure = vi.fn();
  const writer = new InterviewRecording(library.prepare('owner', id, false), start, failure);
  writer.append('system', new Float32Array(recordingRate * 2).fill(0.25), recordingRate, start);
  await writer.drain();
  const probe = await fs.open(writer.file, 'r');
  const handleType = Object.getPrototypeOf(probe);
  await probe.close();
  const truncate = vi.spyOn(handleType, 'truncate').mockRejectedValueOnce(Error('disk full'));
  try {
    writer.append('system', new Float32Array(recordingRate).fill(0.5), recordingRate, start + 2000);
    await expect(writer.close(start + 3000)).rejects.toThrow('disk full');
  } finally {
    truncate.mockRestore();
  }
  expect(failure).toHaveBeenCalledTimes(1);
  expect((await library.list('owner', id)).map(clip => clip.durationMs)).toEqual([1000]);
});

it('将不同采样率、重叠说话、静音与分段起止放在同一时间轴，列表只属于本机账户', async () => {
  const directory = library.prepare('first', id, false);
  const first = new InterviewRecording(directory, start);
  const mic = new Float32Array(800).fill(0.25), system = new Float32Array(4800).fill(0.5);
  first.append('microphone', mic, 8000, start + 100);
  first.append('system', system, 48000, start + 150);
  await first.close(start + 300);
  const second = new InterviewRecording(library.prepare('first', id, true), start + 1000);
  second.append('microphone', new Float32Array(16000).fill(-0.5), 16000, start + 1000);
  await second.close(start + 2000);
  const clips = await library.list('first', id);
  expect(clips.map((c) => [c.startedAt, c.durationMs])).toEqual([
    [start, 300],
    [start + 1000, 1000],
  ]);
  const wav = await fs.readFile(clips[0].file);
  const near = converted(mic, 8000), far = converted(system, 48000);
  const reference = Array.from({ length: 300 * 16 }, (_, i) => Math.round(32767 *
    Math.fround((near[i - 100 * 16] ?? 0) + (far[i - 150 * 16] ?? 0))));
  expect(reference.map((_, i) => wav.readInt16LE(44 + 2 * i))).toEqual(reference);
  expect(wav.readUInt32LE(40)).toBe(300 * 32);
  expect(await library.list('second', id)).toEqual([]);
  expect(() => library.prepare('first', id, false)).toThrow();
  expect(() => library.prepare('first', '../outside', false)).toThrow();
  await library.remove('second', id);
  expect(await library.list('first', id)).toHaveLength(2);
  await library.remove('first', id);
  expect(await library.list('first', id)).toEqual([]);
});

it.each([16000, 44100, 48000])('时间戳抖动及非整帧分包不会改变任何 PCM 样本（%i Hz）', async rate => {
  const writer = new InterviewRecording(root, start);
  const samples = Float32Array.from({ length: rate * 2 }, (_, i) =>
    0.08 + 0.10 * Math.sin(2 * Math.PI * 412 * i / rate));
  const packets = [Math.floor(rate / 100), 127, 379, 71];
  let pos = 0;
  try {
    for (let n = 0; pos < samples.length; n++) {
      const packet = samples.subarray(pos, pos + packets[n % packets.length]);
      const jitterMs = [0, 0.1, -0.09, 0.06][n % 4];
      writer.append('system', packet, rate, start + pos * 1000 / rate + jitterMs);
      pos += packet.length;
    }
  } finally { await writer.close(start + 2000); }
  const wav = await fs.readFile(writer.file);
  const reference = converted(samples, rate);
  expect(wav.length).toBe(44 + reference.length * 2);
  expect(reference.every((v, i) => wav.readInt16LE(44 + 2 * i) === Math.round(v * 32767))).toBe(true);
});

it('录音增益在不规则采集包边界保持连续', () => {
  const rate = 44100;
  const input = Float32Array.from({ length: rate }, (_, i) =>
    (i < rate / 2 ? 0.03 : 0.7) * Math.sin(2 * Math.PI * 720 * i / rate));
  const reference = new RecordingChannel('system', rate).process(input);
  const channel = new RecordingChannel('system', rate);
  const sizes = [71, 379, 1267];
  let offset = 0;
  for (let n = 0; offset < input.length; n++) {
    const packet = channel.process(input.subarray(offset, offset + sizes[n % sizes.length]));
    expect(packet.every((sample, i) => sample === reference[offset + i])).toBe(true);
    offset += packet.length;
  }
});

it.each(['microphone', 'system'] as const)('%s 的轻声、正常和较响语句写入 WAV 后达到日常回放电平', async source => {
  const activeDb: number[] = [];
  for (const inputDb of [-44, -40, -23, -8]) {
    const writer = new InterviewRecording(root, start);
    const channel = new RecordingChannel(source, recordingRate);
    const inputRms = 10 ** (inputDb / 20);
    const syllable = recordingRate / 2;
    const speechEnd = 3 * recordingRate;
    const duration = speechEnd + recordingRate;
    // Harmonics have a known combined RMS. Each syllable rises, fades and pauses.
    const carrierRms = Math.sqrt((1 + 0.35 ** 2 + 0.18 ** 2) / 2);
    let seed = 1;
    const speech = Float32Array.from({ length: duration }, (_, i) => {
      if (i >= speechEnd) {
        seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
        return 0.001 * (seed / 2147483648 - 1);
      }
      const t = (i % syllable) / recordingRate;
      const envelope = Math.max(0, Math.min(1, t / 0.02, (0.36 - t) / 0.035));
      const phase = 2 * Math.PI * 180 * i / recordingRate;
      const harmonics = Math.sin(phase) + 0.35 * Math.sin(3 * phase) + 0.18 * Math.sin(7 * phase);
      return envelope * inputRms * harmonics / carrierRms;
    });
    // A sudden loud plosive after the gain has settled must keep headroom.
    speech[speechEnd - syllable + 1000] = 0.99;
    try {
      for (let i = 0; i < duration; i += 320)
        writer.append(source, channel.process(speech.subarray(i, i + 320)), recordingRate, start + i * 1000 / recordingRate);
    } finally { await writer.close(start + duration * 1000 / recordingRate); }
    const wav = await fs.readFile(writer.file);
    let energy = 0, voiced = 0, noiseEnergy = 0, peak = 0;
    for (let i = 0; i < duration; i++) {
      const sample = wav.readInt16LE(44 + 2 * i) / 32768;
      peak = Math.max(peak, Math.abs(sample));
      const t = (i % syllable) / recordingRate;
      if (i >= recordingRate && i < speechEnd && t >= 0.08 && t < 0.29) {
        energy += sample * sample;
        voiced++;
      }
      if (i >= duration - recordingRate / 2) noiseEnergy += sample * sample;
    }
    const db = 10 * Math.log10(energy / voiced);
    expect(db, `input ${inputDb} dBFS`).toBeGreaterThanOrEqual(-19);
    expect(db, `input ${inputDb} dBFS`).toBeLessThanOrEqual(-12);
    expect(peak).toBeLessThan(0.99);
    const tail = speech.subarray(duration - recordingRate / 2);
    if (source === 'microphone') {
      expect(noiseEnergy / tail.length).toBeLessThan(1e-6);
    } else {
      // A quiet digital soundtrack retains the same relative level as the voice.
      const inputEnergy = tail.reduce((sum, value) => sum + value * value, 0);
      expect(Math.abs(10 * Math.log10(noiseEnergy / inputEnergy) - (db - inputDb))).toBeLessThan(1.5);
    }
    activeDb.push(db);
  }
  expect(Math.max(...activeDb) - Math.min(...activeDb)).toBeLessThan(5);
});

it('轻声辅音写入麦克风录音时保留前一元音的增益', async () => {
  const rate = recordingRate;
  const channel = new RecordingChannel('microphone', rate);
  const writer = new InterviewRecording(root, start);
  const voiceEnd = rate;
  const tailSamples = Math.round(0.14 * rate);
  const voiceLevel = 0.025, tailLevel = 0.0008;
  const input = Float32Array.from({ length: voiceEnd + tailSamples }, (_, i) =>
    i < voiceEnd ? voiceLevel * Math.sin(2 * Math.PI * 400 * i / rate)
      : tailLevel * Math.sin(2 * Math.PI * 2800 * i / rate));
  try {
    writer.append('microphone', channel.process(input), rate, start);
  } finally { await writer.close(start + input.length * 1000 / rate); }
  const wav = await fs.readFile(writer.file);
  const rms = (from: number, to: number) => {
    let energy = 0;
    for (let i = from; i < to; i++) energy += wav.readInt16LE(44 + 2 * i) ** 2;
    return Math.sqrt(energy / (to - from));
  };
  const voice = rms(voiceEnd - rate / 5, voiceEnd);
  const tail = rms(voiceEnd + rate / 10, input.length);
  expect(Math.abs(20 * Math.log10((tail / voice) / (tailLevel / voiceLevel)))).toBeLessThan(2);
});

it('降采样保留语音频带的 1 kHz 测试音，并抑制折返为 4 kHz 的 12 kHz 成分', async () => {
  const writer = new InterviewRecording(root, start);
  const rate = 48000;
  const tone = (hz: number, i: number, fs: number) => Math.sin(2 * Math.PI * hz * i / fs);
  const input = Float32Array.from({ length: rate }, (_, i) => 0.15 * (tone(1000, i, rate) + tone(12000, i, rate)));
  try {
    for (let i = 0; i < input.length; i += 480)
      writer.append('microphone', input.subarray(i, i + 480), rate, start + i / 48);
  } finally { await writer.close(start + 1000); }
  const wav = await fs.readFile(writer.file);
  const amplitude = (hz: number) => {
    let sine = 0, cosine = 0;
    for (let i = 1600; i < 14400; i++) {
      const sample = wav.readInt16LE(44 + 2 * i) / 32767;
      const phase = 2 * Math.PI * hz * i / recordingRate;
      sine += sample * Math.sin(phase);
      cosine += sample * Math.cos(phase);
    }
    return 2 * Math.hypot(sine, cosine) / 12800;
  };
  expect(amplitude(1000)).toBeCloseTo(0.15, 3);
  expect(amplitude(4000)).toBeLessThan(0.002);
});

it('真实断流、短静音及同源重叠各自归位，另一音源仍可同时发声', async () => {
  const writer = new InterviewRecording(root, start);
  const packet = new Float32Array(160).fill(0.1);
  try {
    writer.append('system', packet, 16000, start);
    writer.endSource('system');
    writer.append('system', packet, 16000, start + 11); // Explicit 1 ms mute.
    writer.append('system', new Float32Array(320), 16000, start + 21); // Estimated loopback silence.
    writer.append('system', packet, 16000, start + 30); // Unsignalled 9 ms gap.
    writer.append('system', packet, 16000, start + 35); // 5 ms duplicated by the same source.
    writer.append('microphone', packet, 16000, start + 35);
  } finally { await writer.close(start + 45); }
  const wav = await fs.readFile(writer.file);
  for (let i = 0; i < 45 * 16; i++) {
    const ms = i / 16;
    const system = ms < 10 || (ms >= 11 && ms < 21) || ms >= 30;
    expect(wav.readInt16LE(44 + 2 * i)).toBe(Math.round((Number(system) + Number(ms >= 35)) * 0.1 * 32767));
  }
});

it.each([-250, 250])('设备时钟缓慢漂移 %i ppm 时保持同步与连续电平', async ppm => {
  const writer = new InterviewRecording(root, start);
  const packet = new Float32Array(160).fill(0.25);
  const period = 10 * (1 + ppm / 1e6);
  try {
    for (let i = 0; i < 6000; i++) {
      writer.append('microphone', packet, recordingRate, start + i * period);
      if (i % 500 === 499) await writer.drain();
    }
  } finally { await writer.close(start + 6000 * period); }
  const wav = await fs.readFile(writer.file);
  let through = (wav.length - 44) / 2;
  while (through && wav.readInt16LE(44 + 2 * (through - 1)) === 0) through--;
  expect(Math.abs(through - Math.round(6000 * period * 16))).toBeLessThanOrEqual(33);
  const pcm = new Int16Array(wav.buffer, wav.byteOffset + 44, through);
  expect(pcm.every(v => v === 8192)).toBe(true);
});

it('已写入部分可恢复，播放器按范围读取及跳转，拒绝越界请求', async () => {
  const writer = new InterviewRecording(library.prepare('owner', id, false), start);
  try {
    writer.append('system', new Float32Array(32000).fill(0.25), 16000, start);
    await writer.drain();
    const [clip] = await library.list('owner', id);
    expect(clip.durationMs).toBe(1000);
    const request = (range: string) =>
      recordingResponse(new Request('https://fixture.invalid/', { headers: { range } }), clip);
    const response = request('bytes=44-47');
    expect(response.status).toBe(206);
    expect(response.headers.get('content-range')).toBe('bytes 44-47/' + clip.size);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(Buffer.from([0, 32, 0, 32]));
    writer.append('microphone', new Float32Array(160).fill(0.5), 16000, start);
    await writer.drain();
    const delayed = await request('bytes=44-45').arrayBuffer();
    expect(Buffer.from(delayed).readInt16LE(0)).toBe(Math.round(0.75 * 32767));
    expect((await request('bytes=-2').arrayBuffer()).byteLength).toBe(2);
    expect(request('bytes=900000-').status).toBe(416);
    const head = recordingResponse(
      new Request('https://fixture.invalid/', { method: 'HEAD' }),
      clip,
    );
    expect(head.headers.get('content-length')).toBe(String(clip.size));
    expect(head.body).toBeNull();
  } finally {
    await writer.close(start + 2000);
  }
});
