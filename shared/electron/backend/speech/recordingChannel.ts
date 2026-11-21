import type { AudioSource } from '../../contracts/speech';
import { RecordingVoiceFilter } from './recordingVoiceFilter';

const targetRms = 0.18; // About -15 dBFS during voiced speech.
const maxNoiseFloorRms = 0.004;
const minNoiseFloorRms = 0.0015;
const maxBoost = 40;
const peakLimit = 0.5; // Leave room for the other channel in the mono mix.
const windowSeconds = 0.02;
const rmsDecay = Math.exp(-windowSeconds / 0.18);
const noiseRisePerWindow = 0.002 * windowSeconds;
const micTailWindows = Math.round(0.16 / windowSeconds);
const systemLevelRise = 1 - Math.exp(-windowSeconds / 0.12);
const systemLevelFall = 1 - Math.exp(-windowSeconds / 8);

// One instance per recording input. Neither gain changes nor the microphone's
// noise filter may alter the buffer used by echo cancellation and recognition.
export class RecordingChannel {
  private readonly voiceFilter?: RecordingVoiceFilter;
  private readonly windowSamples: number;
  private readonly gainDown: number;
  private readonly gainUp: number;
  private count = 0;
  private energy = 0;
  private speechRms = 0;
  private quietRms = maxNoiseFloorRms;
  private tailWindows = 0;
  private gain = 1;
  private targetGain = 1;

  constructor(source: AudioSource, readonly rate: number) {
    if (source === 'microphone') this.voiceFilter = new RecordingVoiceFilter(rate);
    this.windowSamples = Math.max(1, Math.round(rate * windowSeconds));
    this.gainDown = 1 - Math.exp(-1 / (rate * 0.04));
    this.gainUp = 1 - Math.exp(-1 / (rate * 0.07));
  }

  private updateTarget(rms: number) {
    if (!this.voiceFilter) {
      // Digital loopback has no microphone noise floor. Quiet passages keep
      // their gain, even across long pauses. Meter louder material to set the
      // playback level, limiting the influence of an isolated peak.
      if (!this.speechRms && rms > 0) {
        this.speechRms = Math.max(rms, targetRms / maxBoost);
      } else if (rms >= targetRms / maxBoost) {
        const response = rms > this.speechRms ? systemLevelRise : systemLevelFall;
        this.speechRms += (Math.min(rms, 2 * this.speechRms) - this.speechRms) * response;
      } else return;
      this.targetGain = Math.min(maxBoost, targetRms / this.speechRms);
      return;
    }

    this.speechRms = Math.max(rms, this.speechRms * rmsDecay);
    this.quietRms = Math.min(rms, this.quietRms + noiseRisePerWindow, maxNoiseFloorRms);
    const floor = Math.max(minNoiseFloorRms, Math.min(maxNoiseFloorRms, 2 * this.quietRms));
    const activity = Math.max(0, Math.min(1, (rms - floor) / (2 * floor)));
    if (activity === 1) this.tailWindows = micTailWindows;
    else if (this.tailWindows > 0) {
      // Retain the preceding speech gain through short consonants and word endings.
      this.tailWindows--;
      return;
    }
    const allowedBoost = 1 + (maxBoost - 1) * activity * activity;
    this.targetGain = Math.min(allowedBoost, targetRms / Math.max(this.speechRms, floor));
  }

  process(input: Float32Array) {
    const output = this.voiceFilter ? this.voiceFilter.process(input) : input.slice();
    for (let i = 0; i < output.length; i++) {
      const sample = output[i];
      this.gain += (this.targetGain - this.gain) *
        (this.targetGain < this.gain ? this.gainDown : this.gainUp);
      if (Math.abs(sample) * this.gain > peakLimit) this.gain = peakLimit / Math.abs(sample);
      output[i] = sample * this.gain;

      this.energy += sample * sample;
      if (++this.count === this.windowSamples) {
        this.updateTarget(Math.sqrt(this.energy / this.count));
        this.count = 0;
        this.energy = 0;
      }
    }
    return output;
  }
}
