import type {
  SpeechOptions,
  SpeechHardware,
  InterviewInputMode,
  InterviewInputState,
  AudioSource,
} from './speech';
import { componentPresentation } from './components';

export function cudaUnavailableMessage(hardware: SpeechHardware) {
  switch (hardware.reason) {
    case 'unsupported-gpu':
      return '当前显卡不满足多语言语音识别的 CUDA 要求，请选择 CPU。';
    case 'driver-unavailable':
      return '未检测到可用的 NVIDIA 驱动，请选择 CPU。';
    case 'driver-outdated':
      return 'NVIDIA 驱动版本过旧，请更新驱动或选择 CPU。';
    case 'platform':
      return '当前平台不支持 CUDA，请使用 CPU。';
    default:
      return '未检测到可用的 CUDA 设备，请选择 CPU。';
  }
}

export const speechSwitchCancelled = '语音切换已取消，仍使用原配置。';
export const speechModelLabels = {
  paraformer: componentPresentation.speech.label,
  qwen: componentPresentation.qwen.label,
} as const;
export const unsupportedSpeechCpu = `${speechModelLabels.qwen}需要支持 AVX2 和 FMA 的处理器，请改用${speechModelLabels.paraformer}。`;
export const speechCpuWarning = `${componentPresentation.qwen.label}使用 CPU 时，转写可能出现明显延迟。`;

export function speechSelection(options: SpeechOptions) {
  const speechModel = options.speechModel ?? 'paraformer';
  return {
    speechModel,
    inferenceDevice:
      speechModel === 'qwen' ? (options.inferenceDevice ?? 'cuda') : ('cpu' as const),
  };
}

export function speechComponent(options: SpeechOptions) {
  return speechSelection(options).speechModel === 'qwen' ? ('qwen' as const) : ('speech' as const);
}

export const speechSegmentationSilenceMs = 500;
export const automaticAnswerSilenceMs = speechSegmentationSilenceMs + 500;

export function questionSource(inputMode: InterviewInputMode = 'remote'): AudioSource {
  return inputMode === 'transcription' ? 'microphone' : 'system';
}
export function inputSources(state: InterviewInputState): AudioSource[] {
  return state.inputMode === 'transcription'
    ? ['microphone']
    : state.microphoneMuted
      ? ['system']
      : ['microphone', 'system'];
}
export function inputSourceEnabled(state: InterviewInputState, source: AudioSource) {
  return source === 'microphone'
    ? !state.microphoneMuted
    : state.inputMode === 'remote' && !state.systemAudioMuted;
}

export function sameAudioCapture(a: SpeechOptions, b: SpeechOptions) {
  return (
    a.sources.length === b.sources.length &&
    a.sources.every((source) => b.sources.includes(source)) &&
    (a.microphone ?? '') === (b.microphone ?? '') &&
    (a.system ?? '') === (b.system ?? '')
  );
}
