import { EventEmitter } from 'node:events';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import { SpeechController, type CaptureAdapter } from '../../../shared/electron/backend/speech/controller';
import type { AudioPacket } from '../../../shared/electron/backend/speech/buffer';
import type { AudioSource, InterviewInputState } from '../../../shared/electron/contracts/speech';
import * as loader from '../../../shared/electron/backend/speech/preprocessor';
import { createAudioPreprocessor } from '../../electron/speech/echoCancellation';

const recognitionPackets: { source: AudioSource; samples: Float32Array; rate: number; timestamp: number }[] = [];
vi.mock('node:worker_threads', () => ({
  Worker: class extends EventEmitter {
    postMessage(m: any) {
      if (m.op === 'audio') recognitionPackets.push({
        source: m.source, samples: m.samples.slice(), rate: m.rate, timestamp: m.timestamp,
      });
      const reply = { init: { ready: true }, prepare: { prepared: m.id }, audio: { ack: m.sequence },
        'set-input-state': { inputSet: m.id }, flush: { flushed: m.id }, close: { closed: m.id } };
      this.emit('message', reply[m.op as keyof typeof reply]);
    }
    async terminate() {}
  },
}));

it.each([
  { inputMode: 'remote', recording: true },
  { inputMode: 'transcription', recording: true },
  { inputMode: 'remote', recording: false },
] as const)(
  'keeps playback out of microphone recognition and any saved mic ($inputMode, recording=$recording)',
  async ({ inputMode, recording }) => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'voxcue-synthetic-echo-'));
    const send = new Map<AudioSource, (packet: AudioPacket) => void>();
    const adapter: CaptureAdapter = {
      preprocessorFile: 'synthetic-platform-module',
      devices: async () => (['microphone', 'system'] as const).map(source =>
        ({ source, id: source, name: source, default: true })),
      create: (_helper, source, _device, audio) => {
        send.set(source, audio);
        return { start: async () => {}, stop: async () => {} };
      },
    };
    vi.spyOn(loader, 'loadAudioPreprocessor').mockImplementation((_file, consume, failure) =>
      createAudioPreprocessor(consume, failure));
    let now = 100000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const controller = new SpeechController('synthetic', 'synthetic', () => {}, adapter);
    const inputState: InterviewInputState = { inputMode, microphoneMuted: false };
    const rate = 48000, duration = 11;
    const playback = new Float32Array(rate * duration);
    let seed = 7, low = 0, phase = 0;
    for (let i = 0; i < playback.length; i++) {
      seed = (1664525 * seed + 1013904223) >>> 0;
      low = 0.85 * low + 0.15 * (seed / 2147483648 - 1);
      if (recording) playback[i] = low * 0.5;
      else {
        // A voice-like video soundtrack with syllables, changing pitch and fricatives.
        const t = i / rate;
        phase += 2 * Math.PI * (172 + 28 * Math.sin(t * 4.2)) / rate;
        const syllable = Math.max(0, Math.sin(t * 16));
        playback[i] = syllable * (0.18 * Math.sin(phase) + 0.07 * Math.sin(3 * phase) + 0.15 * low);
      }
    }
    recognitionPackets.length = 0;
    try {
      const sources: AudioSource[] = inputMode === 'remote' ? ['microphone', 'system'] : ['microphone'];
      expect((await controller.call({ op: 'start', inputState, options: { sources } })).state).toBe('running');
      if (recording) await controller.call({ op: 'recording', directory });
      const startAt = now;
      const voiceEnd = Math.round((recording ? 10 : 9.3) * rate);
      const voice = (i: number) => i < voiceEnd
        ? (recording ? 0.15 : 0.035) * Math.sin(2 * Math.PI * 850 * i / rate)
        : 0;
      const speakerEcho = (i: number) => 0.6 * (playback[i - 2400] ?? 0) + 0.2 * (playback[i - 2700] ?? 0);
      let rawEchoEnergy = 0;
      for (let offset = 0; offset < playback.length; offset += 480) {
        now = startAt + offset / 48;
        if (recording && inputMode === 'remote' && offset === 4 * rate)
          await controller.call({ op: 'set-input-state', state: { ...inputState, systemAudioMuted: true } });
        if (offset === 10 * rate)
          await controller.call({ op: 'set-input-state', state: { ...inputState, systemAudioMuted: true, microphoneMuted: true } });
        const microphone = Float32Array.from({ length: 480 }, (_, j) => {
          const i = offset + j;
          const echo = speakerEcho(i);
          if (i >= 5 * rate && i < 7 * rate && i % 3 === 0) rawEchoEnergy += echo * echo;
          return echo + (i >= 8 * rate ? voice(i) : 0);
        });
        const packet = { rate, timestamp: now, flags: 0 };
        send.get('system')!({ ...packet, samples: playback.subarray(offset, offset + 480) });
        send.get('microphone')!({ ...packet, samples: microphone });
      }
      now = startAt + duration * 1000;
      await controller.call({ op: 'pause' });
      const systemPackets = recognitionPackets.filter(p => p.source === 'system');
      expect(systemPackets.length).toBe(inputMode === 'transcription' ? 0 : recording ? 400 : 1000);
      for (const [index, packet] of systemPackets.entries()) {
        expect(packet.timestamp).toBe(startAt + index * 10);
        expect(packet.rate).toBe(rate);
        expect(packet.samples).toHaveLength(480);
        expect(packet.samples.every((v, i) => v === playback[index * 480 + i])).toBe(true);
      }
      const mic = new Float32Array(rate * duration);
      let micEnd = 0;
      for (const packet of recognitionPackets.filter(p => p.source === 'microphone')) {
        expect(packet.rate).toBe(rate);
        const offset = Math.round((packet.timestamp - startAt) * rate / 1000);
        if (offset !== micEnd) throw Error(`Microphone PCM discontinuity at ${offset}, expected ${micEnd}`);
        mic.set(packet.samples, offset);
        micEnd += packet.samples.length;
      }
      expect(micEnd).toBeGreaterThanOrEqual(9.8 * rate);
      // Check the signal the recognizer actually sees, including while loopback
      // is only an AEC reference and when the user never starts recording.
      for (const second of [2, 5]) {
        let activeFrames = 0, silentFrames = 0, rawPower = 0, outputPower = 0;
        for (let offset = second * rate; offset < (second + 1) * rate; offset += 480) {
          let echoEnergy = 0, micEnergy = 0;
          for (let i = offset; i < offset + 480; i++) {
            echoEnergy += speakerEcho(i) ** 2;
            micEnergy += mic[i] ** 2;
          }
          rawPower += echoEnergy;
          outputPower += micEnergy;
          if (echoEnergy / 480 > 0.015 ** 2) {
            activeFrames++;
            if (micEnergy === 0) silentFrames++;
          }
        }
        expect(activeFrames).toBeGreaterThan(25);
        expect(silentFrames / activeFrames).toBeGreaterThanOrEqual(0.95);
        expect(10 * Math.log10(rawPower / outputPower)).toBeGreaterThan(12);
      }
      let localPower = 0, localCross = 0, exact = 0, talkingSamples = 0;
      for (let i = Math.round(8.3 * rate); i < Math.min(Math.round(9.8 * rate), voiceEnd); i++) {
        const local = voice(i);
        localPower += local * local;
        localCross += local * mic[i];
        if (mic[i] === Math.fround(local + speakerEcho(i))) exact++;
        talkingSamples++;
      }
      expect(exact / talkingSamples).toBeGreaterThan(0.99);
      expect(localCross / localPower).toBeGreaterThan(0.7);
      if (!recording) {
        // Playback continues after the local speaker finishes.
        const end = 10 * rate;
        const from = end - rate / 5;
        const remaining = mic.subarray(from, end).reduce((sum, v) => sum + v * v, 0);
        let echoEnergy = 0;
        for (let i = from; i < end; i++) echoEnergy += speakerEcho(i) ** 2;
        expect(10 * Math.log10(echoEnergy / remaining)).toBeGreaterThan(12);
        expect(await readdir(directory)).toEqual([]);
        return;
      }
      const [file] = await readdir(directory);
      const wav = await readFile(path.join(directory, file));
      expect(wav.readUInt32LE(40)).toBe(16000 * duration * 2);
      const sample = (i: number) => wav.readInt16LE(44 + 2 * i) / 32767;
      let residual = 0, cross = 0, near = 0;
      for (let i = 5 * 16000; i < 7 * 16000; i++) residual += sample(i) ** 2;
      for (let i = 8.3 * 16000; i < 9.8 * 16000; i++) {
        const local = voice(i * 3);
        cross += local * sample(i);
        near += local ** 2;
      }
      const reductionDb = 10 * Math.log10(rawEchoEnergy / residual);
      console.log(inputMode, 'saved WAV echo reduction (dB)', reductionDb, 'voice gain', cross / near);
      expect(reductionDb).toBeGreaterThan(12);
      expect(cross / near).toBeGreaterThan(0.7);
      expect(wav.subarray(44 + 10 * 16000 * 2).every(byte => byte === 0)).toBe(true);
    } finally {
      await controller.close();
      vi.restoreAllMocks();
      await rm(directory, { recursive: true, force: true });
    }
  },
);
