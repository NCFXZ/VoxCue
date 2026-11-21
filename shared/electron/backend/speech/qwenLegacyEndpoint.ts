import { createHash } from 'node:crypto';
import { open } from 'node:fs/promises';
import { speechSegmentationSilenceMs } from '../../contracts/speechSettings';

const frameSize = 512;
const sampleRate = 16000;
const sileroVadSha256 = '9e2449e1087496d8d4caba907f23e0bd3f78d91fa552479bb9c23ac09cbb1fd6';

export async function loadEndpointModel(files: string[] = []) {
  for (const file of files) {
    const fd = await open(file, 'r').catch(error => {
      if (error.code !== 'ENOENT') throw error;
    });
    if (!fd) continue;
    try {
      if ((await fd.stat()).size !== 643854 ||
        createHash('sha256').update(await fd.readFile()).digest('hex') !== sileroVadSha256)
        throw Error('多语言语音断句模型校验失败。');
      return file;
    } finally {
      await fd.close();
    }
  }
  throw Error('缺少多语言语音断句模型，请恢复本机语音组件。');
}

interface Vad {
  acceptWaveform(frame: Float32Array): void;
  isEmpty(): boolean;
  isDetected(): boolean;
  front(external: boolean): { start: number; samples: Float32Array };
  pop(): void;
  reset(): void;
}

// Older runtimes keep their own longer endpoint. Short Silero speech regions
// let the worker measure the requested quiet interval from actual PCM.
export class QwenLegacyEndpoint {
  private readonly frame = new Float32Array(frameSize);
  private used = 0;
  private through = 0;
  private quietStart?: number;

  constructor(private readonly vad: Vad) {}

  reset() {
    this.vad.reset();
    this.used = this.through = 0;
    this.quietStart = undefined;
  }

  static create(file: string) {
    const sherpa = require('sherpa-onnx-node');
    return new QwenLegacyEndpoint(new sherpa.Vad({
      sileroVad: { model: file, threshold: 0.5, minSpeechDuration: 0.032,
        minSilenceDuration: 0.032, windowSize: frameSize, maxSpeechDuration: 20 },
      sampleRate, numThreads: 1, debug: false,
    }, 30));
  }

  cut(samples: Float32Array) {
    for (let offset = 0; offset < samples.length;) {
      const count = Math.min(frameSize - this.used, samples.length - offset);
      this.frame.set(samples.subarray(offset, offset + count), this.used);
      this.used += count;
      offset += count;
      if (this.used !== frameSize) continue;
      this.used = 0;
      this.through += frameSize;
      this.vad.acceptWaveform(this.frame);
      while (!this.vad.isEmpty()) {
        const segment = this.vad.front(false);
        this.quietStart = segment.start + segment.samples.length;
        this.vad.pop();
      }
      if (this.vad.isDetected()) this.quietStart = undefined;
      if (this.quietStart === undefined) continue;
      const quietSamples = this.through - this.quietStart;
      if (quietSamples >= speechSegmentationSilenceMs * sampleRate / 1000) {
        this.quietStart = undefined;
        return { offset, quietSamples };
      }
    }
  }
}
