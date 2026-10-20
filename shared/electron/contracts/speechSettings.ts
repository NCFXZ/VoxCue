import type { SpeechOptions, SpeechHardware } from './speech';

export function cudaUnavailableMessage(hardware: SpeechHardware) {
  switch (hardware.reason) {
    case 'unsupported-gpu':
      return '当前显卡不满足 Qwen 的 CUDA 要求，请选择 CPU。';
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

export const speechModelLabels = {
  paraformer: 'Paraformer 中英 INT8',
  qwen: 'Qwen3-ASR 0.6B',
} as const;

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

export const speechSegmentationSilenceMs = 800;
export const automaticAnswerSilenceMs = 1800;

export function sameAudioCapture(a: SpeechOptions, b: SpeechOptions) {
  return (
    a.sources.length === b.sources.length &&
    a.sources.every((source) => b.sources.includes(source)) &&
    (a.microphone ?? '') === (b.microphone ?? '') &&
    (a.system ?? '') === (b.system ?? '')
  );
}
