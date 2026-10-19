import type { ReasoningEffort } from './chat';
import type { PersonalInfo } from './profile';
import type { ScreenCapturePermission } from './screenCapture';

export type AudioSource = 'microphone' | 'system';
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
}
// Audio/model are confirmed before opening. autoAnswer supplies only
// the initial value of the floating window's mutable automatic-answer toggle.
export interface InterviewConfiguration {
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
export type InterviewScreenshotCall = { op: 'capture' | 'clear' } | { op: 'remove'; id: string };
export type InterviewAnswerRequest = {
  id: string;
  modelId: string;
  effort?: ReasoningEffort;
  question?: string;
  screenshotIds?: string[];
};
export type SpeechCall =
  { op: 'devices' | 'status' | 'pause' | 'stop' } | { op: 'start'; options: SpeechOptions };
export interface SpeechStatus {
  state: 'idle' | 'loading' | 'running' | 'paused' | 'error';
  model: string;
  error?: string;
  failureSource?: 'model' | 'service' | AudioSource;
  devices?: AudioDevice[];
}
export interface SpeechSegment {
  id: string;
  source: AudioSource;
  text: string;
  final: boolean;
  startMs: number;
  endMs: number;
  reason?: 'silence' | 'limit' | 'pause' | 'stop' | 'discontinuity';
}
export type SpeechEvent =
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
