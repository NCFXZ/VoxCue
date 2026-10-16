import { create } from 'zustand';
import { defaultInterviewConfiguration } from '../services/speech';
import type { InterviewConfiguration } from '../../electron/contracts/speech';
import { reasoningEfforts } from '../../electron/contracts/chat';

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
}>((set) => ({
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
          modelId: configuration.modelId,
          effort: configuration.effort,
        }),
      );
      set({ configuration, error: null });
    } catch {
      set({ error: '面试设置保存失败，请检查本地存储空间。' });
    }
  },
}));
