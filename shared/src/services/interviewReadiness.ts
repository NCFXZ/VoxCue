import type {
  AudioSource,
  SpeechOptions,
  SpeechStatus,
  InterviewInputMode,
} from '../../electron/contracts/speech';
import { inputHoldMs, microphoneLevel, type AudioLevels } from './audioLevel';

export type ReadinessKind = 'normal' | 'input' | 'error' | 'off' | 'loading' | 'paused';
export const readinessLabels = { model: '语音模型', microphone: '麦克风', system: '系统音频' };
export const readinessStates: Record<ReadinessKind, string> = {
  normal: '正常',
  input: '有输入',
  error: '异常',
  off: '未启用',
  loading: '加载中',
  paused: '已暂停',
};
export function interviewReadiness(
  item: 'model' | AudioSource,
  state: {
    speech: SpeechStatus;
    speechError: string | null;
    speechWarnings: Partial<Record<AudioSource, string>>;
    options: SpeechOptions;
    audioLevels: AudioLevels;
    reconnecting: boolean;
    inputMode?: InterviewInputMode;
    microphoneMuted?: boolean;
    systemAudioMuted?: boolean;
  },
  now: number,
): { kind: ReadinessKind; reason: string; detail?: string; level: number } {
  const result = (kind: ReadinessKind, reason: string, level = 0) => ({ kind, reason, level });
  if (item === 'system' && state.systemAudioMuted)
    return result('off', '系统音频未启用，不采集声音。');
  if (item === 'microphone' && state.inputMode === 'transcription' && state.microphoneMuted)
    return result('off', '麦克风已关闭，不采集声音。');
  if (item !== 'model' && !state.options.sources.includes(item))
    return result('off', `${readinessLabels[item]}未启用，不采集声音。`);
  if (state.reconnecting || state.speech.state === 'loading')
    return result(
      'loading',
      state.reconnecting
        ? '正在重新连接音频，请稍候。'
        : item === 'model'
          ? '正在加载本地语音模型。'
          : '正在准备音频采集。',
    );
  if (item !== 'model' && state.speechWarnings[item])
    return result('error', state.speechWarnings[item]!);
  if (state.speech.state === 'error' || state.speechError) {
    const reason = state.speechError || state.speech.error || '语音服务异常，请重新连接音频。';
    const failure = state.speech.failureSource;
    const affected =
      item === 'model'
        ? !failure || failure === 'model' || failure === 'service'
        : failure === item;
    return affected
      ? result('error', reason)
      : { ...result('paused', '音频链路已停止，等待恢复：{0}'), detail: reason };
  }
  if (state.speech.state !== 'running') return result('paused', '转写已暂停，当前不接收音频。');
  if (item === 'model') return result('normal', '本地语音模型正常，可进行转写。');
  const sample = state.audioLevels[item];
  const age = sample?.inputAt === undefined ? Infinity : now - sample.inputAt;
  if (age >= 0 && age < inputHoldMs) {
    const level = microphoneLevel(sample!.inputLevel ?? 0) * (1 - age / inputHoldMs);
    return result('input', '设备正常，正在接收音频输入。', level);
  }
  return result('normal', '设备正常，等待声音输入。');
}
