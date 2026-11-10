import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { AudioSource, SpeechEvent, SpeechSegment } from '../../contracts/speech';
import { SampleBuffer } from './buffer';
import { verifyModel, paraformerFiles } from './models';
import { speechSegmentationSilenceMs } from '../../contracts/speechSettings';
// Official JS package has JSDoc, but no TypeScript declarations. Keep it inside this adapter.
const sherpa = require('sherpa-onnx-node');
export class SpeechEngine {
  private recognizer: any;
  private sources = new Map<AudioSource, any>();
  inferenceMs = 0;
  audioMs = 0;
  constructor(
    private directory: string,
    private emit: (event: SpeechEvent) => void,
  ) {
    verifyModel(directory, paraformerFiles, 'Paraformer');
    this.recognizer = new sherpa.OnlineRecognizer({
      featConfig: { sampleRate: 16000, featureDim: 80 },
      modelConfig: {
        paraformer: {
          encoder: path.join(directory, 'encoder.int8.onnx'),
          decoder: path.join(directory, 'decoder.int8.onnx'),
        },
        tokens: path.join(directory, 'tokens.txt'),
        numThreads: 2,
        provider: 'cpu',
        debug: 0,
      },
    });
  }
  private source(source: AudioSource, rate: number, timestamp: number) {
    let s = this.sources.get(source);
    if (s && s.rate !== rate) throw Error('音频采样率已变化，请重新开始采集。');
    if (!s) {
      s = {
        rate,
        resampler: new sherpa.LinearResampler(rate, 16000),
        buffer: new SampleBuffer(32000),
        vad: new sherpa.Vad(
          {
            sileroVad: {
              model: path.join(this.directory, 'silero_vad.onnx'),
              threshold: 0.5,
              minSpeechDuration: 0.25,
              minSilenceDuration: speechSegmentationSilenceMs / 1000,
              windowSize: 512,
              maxSpeechDuration: 20,
            },
            sampleRate: 16000,
            numThreads: 1,
            debug: false,
          },
          30,
        ),
        stream: this.recognizer.createStream(),
        id: randomUUID(),
        samples: 0,
        origin: timestamp,
        start: timestamp,
        active: false,
        text: '',
        lastEmit: 0,
      };
      this.sources.set(source, s);
    }
    return s;
  }
  feed(source: AudioSource, samples: Float32Array, rate: number, timestamp: number) {
    const started = performance.now();
    const s = this.source(source, rate, timestamp);
    const converted = s.resampler.resample(samples);
    s.buffer.push(converted);
    while (s.buffer.length >= 512) {
      const frame = s.buffer.take(512);
      s.samples += 512;
      const end = s.origin + s.samples / 16;
      s.vad.acceptWaveform(frame);
      // ASR receives ALL samples, including 250ms before VAD onset and its tail.
      s.stream.acceptWaveform({ sampleRate: 16000, samples: frame });
      while (this.recognizer.isReady(s.stream)) this.recognizer.decode(s.stream);
      const detected = s.vad.isDetected();
      if (detected && !s.active) {
        s.active = true;
        this.emit({ type: 'speech-start', source });
        s.start = Math.max(s.origin, end - 250);
      }
      const text = String(this.recognizer.getResult(s.stream).text ?? '').trim();
      if (s.active && text && text !== s.text && end - s.lastEmit >= 150) {
        s.text = text;
        s.lastEmit = end;
        this.emit({
          type: 'segment',
          segment: { id: s.id, source, text, final: false, startMs: s.start, endMs: end },
        });
      }
      if (s.active && (!detected || end - s.start >= 20000))
        this.finalize(source, s, detected ? 'limit' : 'silence');
      // Drain the VAD segment queue; ASR has already seen the identical audio.
      while (!s.vad.isEmpty()) s.vad.pop();
      if (end - s.lastActivity >= 200 || s.lastActivity === undefined) {
        let power = 0;
        for (const n of frame) power += n * n;
        this.emit({
          type: 'activity',
          source,
          speaking: detected,
          level: Math.sqrt(power / frame.length),
        });
        s.lastActivity = end;
      }
      // Bound silent-stream feature state and discard silence hallucinations.
      if (!s.active && end - s.silentReset > 10000) {
        s.stream = this.recognizer.createStream();
        s.silentReset = end;
      }
      if (s.silentReset === undefined) s.silentReset = end;
    }
    this.audioMs += (samples.length / rate) * 1000;
    this.inferenceMs += performance.now() - started;
  }
  processedThrough(source: AudioSource): number | undefined {
    const state = this.sources.get(source);
    return state ? state.origin + state.samples / 16 : undefined;
  }
  canSwitch(source: AudioSource) {
    const state = this.sources.get(source);
    return !state || (!state.active && !state.vad.isDetected());
  }
  private finalize(source: AudioSource, s: any, reason: SpeechSegment['reason']) {
    s.stream.acceptWaveform({ sampleRate: 16000, samples: new Float32Array(6400) });
    s.stream.inputFinished();
    while (this.recognizer.isReady(s.stream)) this.recognizer.decode(s.stream);
    const text = String(this.recognizer.getResult(s.stream).text ?? '').trim();
    if (s.active && text)
      this.emit({
        type: 'segment',
        segment: {
          id: s.id,
          source,
          text,
          final: true,
          startMs: s.start,
          endMs: s.origin + s.samples / 16,
          reason,
          ...(reason === 'silence'
            ? { silenceStartMs: s.origin + s.samples / 16 - speechSegmentationSilenceMs }
            : {}),
        },
      });
    s.stream = this.recognizer.createStream();
    s.id = randomUUID();
    s.active = false;
    s.text = '';
    s.lastEmit = 0;
    s.silentReset = s.origin + s.samples / 16;
  }
  flush(reason: 'stop' | 'pause') {
    for (const [source, s] of this.sources) {
      const tail = s.resampler.flush(new Float32Array());
      s.buffer.push(tail);
      if (s.buffer.length) {
        s.stream.acceptWaveform({ sampleRate: 16000, samples: s.buffer.take(s.buffer.length) });
      }
      this.finalize(source, s, reason);
    }
    this.sources.clear();
  }
  discontinuity(source: AudioSource) {
    const state = this.sources.get(source);
    if (state) this.finalize(source, state, 'discontinuity');
    // A fresh resampler/VAD/ASR stream prevents joining across missing audio.
    this.sources.delete(source);
  }
  discard(source: AudioSource) {
    // Soft mute is a privacy boundary, not a request to decode the old tail.
    this.sources.delete(source);
  }
}
