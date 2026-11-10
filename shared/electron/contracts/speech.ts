import type { ReasoningEffort } from './chat';
import type { PersonalInfo } from './profile';
import type { ScreenCapturePermission } from './screenCapture';

export type AudioSource = 'microphone' | 'system';
export type InterviewInputMode = 'remote' | 'transcription';
export interface InterviewInputState {
  inputMode: InterviewInputMode;
  microphoneMuted: boolean;
  systemAudioMuted?: boolean;
}
export type SpeechModelId = 'paraformer' | 'qwen';
export type SpeechInferenceDevice = 'cpu' | 'cuda' | 'metal';
export interface SpeechHardware {
  cuda: boolean;
  metal?: boolean;
  reason?:
    'unsupported-gpu' | 'driver-unavailable' | 'driver-outdated' | 'unavailable' | 'platform';
}
export interface AudioDevice {
  id: string;
  name: string;
  source: AudioSource;
  default: boolean;
}
export interface InterviewAccessCheck {
  source: AudioSource;
  status: 'granted' | 'denied' | 'unavailable' | 'error';
  message: string;
}
export interface InterviewAccessReport {
  ready: boolean;
  devices: AudioDevice[];
  checks: InterviewAccessCheck[];
  screenCapture?: ScreenCapturePermission;
}
export interface SpeechOptions {
  sources: AudioSource[];
  microphone?: string;
  system?: string;
  speechModel?: SpeechModelId;
  inferenceDevice?: SpeechInferenceDevice;
}
// Devices/model are confirmed before opening. Input state and autoAnswer can
// change during the session through their controlled runtime operations.
export interface InterviewConfiguration {
  inputMode?: InterviewInputMode;
  mode: 'local' | 'mock';
  options: SpeechOptions;
  aiEnabled: boolean;
  modelId: string;
  effort: ReasoningEffort | 'auto';
  autoAnswer: boolean;
  profile?: PersonalInfo;
  knowledgeBaseId?: string | null;
  knowledgeBaseName?: string;
}
export type DictationCall =
  | { op: 'start'; microphone?: string }
  | { op: 'stop' | 'status' }
  | { op: 'test'; id: string; options: SpeechOptions }
  | { op: 'test-stop'; id: string };
export type InterviewScreenshotMode = 'attach' | 'only';
export interface InterviewScreenshot {
  id: string;
  preview: string;
}
export type InterviewScreenshotCall =
  { op: 'capture' | 'clear' } | { op: 'remove'; id: string } | { op: 'archive'; ids: string[] };
export type InterviewAnswerRequest = {
  id: string;
  modelId: string;
  effort?: ReasoningEffort;
  question?: string;
  screenshotIds?: string[];
};
export type SpeechCall =
  { op: 'devices' | 'status' | 'pause' | 'stop' } | { op: 'start'; options: SpeechOptions };
// Only the authenticated main-process interview coordinator can create these.
export type SpeechServiceCall =
  | Exclude<SpeechCall, { op: 'start' }>
  | { op: 'start'; options: SpeechOptions; inputState?: InterviewInputState }
  | { op: 'set-input-state'; state: InterviewInputState }
  | { op: 'cancel-input-state' }
  | { op: 'switch-recognizer'; options: SpeechOptions }
  | { op: 'cancel-switch' };
export interface SpeechStatus {
  state: 'idle' | 'loading' | 'running' | 'paused' | 'error';
  model: string;
  error?: string;
  failureSource?: 'model' | 'service' | AudioSource;
  devices?: AudioDevice[];
  speechModel?: SpeechModelId;
  inferenceDevice?: SpeechInferenceDevice;
  chunkMs?: number;
  switching?: 'loading' | 'waiting';
  inputState?: InterviewInputState;
}
export interface SpeechSegment {
  id: string;
  source: AudioSource;
  text: string;
  final: boolean;
  startMs: number;
  endMs: number;
  reason?: 'silence' | 'sentence' | 'limit' | 'pause' | 'stop' | 'discontinuity';
  speechModel?: SpeechModelId;
  continuationOf?: string;
  // Beginning of the VAD-confirmed trailing silence on the capture timeline.
  // It is independent of when final decoding / IPC finishes.
  silenceStartMs?: number;
}
export type SpeechEvent =
  | { type: 'speech-start'; source: AudioSource }
  | {
      type: 'audio-progress';
      source: AudioSource;
      pending: boolean;
      processedThroughMs?: number;
    }
  | { type: 'gap'; source: AudioSource; message: string }
  | { type: 'status'; status: SpeechStatus }
  | { type: 'segment'; segment: SpeechSegment }
  | { type: 'activity'; source: AudioSource; speaking: boolean; level: number }
  | {
      type: 'metrics';
      queueMs: number;
      maxQueueMs: number;
      droppedSamples: number;
      discontinuities: number;
      rss: number;
      audioMs: number;
      inferenceMs: number;
    };
