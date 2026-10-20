import { create } from 'zustand';
import { defaultInterviewConfiguration } from '../services/speech';
import type { InterviewConfiguration } from '../../electron/contracts/speech';
import { reasoningEfforts } from '../../electron/contracts/chat';
import type { ComponentState } from '../../electron/contracts/components';

const settingsKey = 'copilot-interview-settings-v1';
function readSettings(): InterviewConfiguration {
  const initial = defaultInterviewConfiguration();
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(settingsKey);
    if (!raw) return initial;
    const value = JSON.parse(raw);
    return {
      ...initial,
      options: {
        sources: value.microphoneEnabled === false ? ['system'] : ['microphone', 'system'],
        microphone: typeof value.microphone === 'string' ? value.microphone : undefined,
        system: typeof value.system === 'string' ? value.system : undefined,
        speechModel: value.speechModel === 'qwen' ? 'qwen' : 'paraformer',
        inferenceDevice: ['cpu', 'cuda', 'metal'].includes(value.inferenceDevice)
          ? value.inferenceDevice
          : typeof window !== 'undefined' && window.desktop?.platform === 'macos'
            ? 'metal'
            : 'cuda',
      },
      modelId: typeof value.modelId === 'string' ? value.modelId : '',
      effort: ['auto', ...reasoningEfforts].includes(value.effort) ? value.effort : 'auto',
    };
  } catch {
    return initial;
  }
}
export const useInterviewSettings = create<{
  configuration: InterviewConfiguration;
  error: string | null;
  update(configuration: InterviewConfiguration): void;
  reconcileSpeechModel(state: ComponentState): void;
}>((set, get) => ({
  configuration: readSettings(),
  error: null,
  update(configuration) {
    try {
      localStorage.setItem(
        settingsKey,
        JSON.stringify({
          microphoneEnabled: configuration.options.sources.includes('microphone'),
          microphone: configuration.options.microphone,
          system: configuration.options.system,
          speechModel: configuration.options.speechModel ?? 'paraformer',
          inferenceDevice:
            configuration.options.inferenceDevice ??
            (typeof window !== 'undefined' && window.desktop?.platform === 'macos'
              ? 'metal'
              : 'cuda'),
          modelId: configuration.modelId,
          effort: configuration.effort,
        }),
      );
      set({ configuration, error: null });
    } catch {
      set({ error: '面试设置保存失败，请检查本地存储空间。' });
    }
  },
  reconcileSpeechModel(state) {
    const configuration = get().configuration;
    const selected = configuration.options.speechModel ?? 'paraformer';
    const missing = selected === 'qwen' ? 'qwen' : 'speech';
    const alternative = selected === 'qwen' ? 'speech' : 'qwen';
    if (
      ['ready', 'needed', 'cancelled'].includes(state.phase) &&
      state.items.some((item) => item.id === missing && item.phase === 'pending') &&
      state.items.some((item) => item.id === alternative && item.phase === 'ready')
    )
      get().update({
        ...configuration,
        options: {
          ...configuration.options,
          speechModel: alternative === 'speech' ? 'paraformer' : 'qwen',
          inferenceDevice: 'cpu',
        },
      });
  },
}));
