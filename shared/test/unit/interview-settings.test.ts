import { expect, it, vi } from 'vitest';
import {
  defaultInterviewConfiguration,
  resolveInterviewConfiguration,
} from '../../../shared/src/services/speech';
import {
  resolveReasoningEffort,
  supportedReasoningEfforts,
} from '../../../shared/src/services/chatOptions';
import type { ChatModel } from '../../../shared/electron/contracts/chat';

it('reasoning controls expose only supported explicit steps in strength order', () => {
  const model = {
    id: 'default',
    label: 'Default',
    description: '',
    reasoningEfforts: ['high', 'auto', 'none', 'low', 'unsupported', 'high'],
  } as unknown as ChatModel;
  expect(supportedReasoningEfforts(model)).toEqual(['none', 'low', 'high']);
  expect(resolveReasoningEffort(model, 'high')).toBe('high');
  expect(resolveReasoningEffort(model, 'auto')).toBe('low');
  expect(resolveReasoningEffort(model, 'max')).toBe('low');
  expect(resolveReasoningEffort(model, 'none')).toBe('none');
});
it('models without low use an advertised step while non-reasoning models keep no explicit effort', () => {
  const model: ChatModel = {
    id: 'sparse',
    label: 'Sparse',
    description: '',
    reasoningEfforts: ['xhigh', 'medium'],
  };
  expect(resolveReasoningEffort(model)).toBe('medium');
  expect(resolveReasoningEffort(model, 'xhigh')).toBe('xhigh');
  expect(resolveReasoningEffort({ ...model, reasoningEfforts: [] }, 'high')).toBe('auto');
  expect(resolveReasoningEffort({ id: 'plain', label: 'Plain', description: '' }, 'high')).toBe(
    'auto',
  );
  expect(resolveReasoningEffort(undefined, 'high')).toBe('auto');
});
it('开场将历史自动档位归一为模型支持的明确档位，未知能力保持内部自动', () => {
  const initial = defaultInterviewConfiguration();
  const models = [
    {
      id: 'known',
      label: 'Known',
      description: '',
      reasoningEfforts: ['low' as const, 'high' as const],
    },
  ];
  expect(resolveInterviewConfiguration(initial, models, true).effort).toBe('low');
  expect(
    resolveInterviewConfiguration({ ...initial, modelId: 'known', effort: 'auto' }, models, true)
      .effort,
  ).toBe('low');
  expect(
    resolveInterviewConfiguration({ ...initial, modelId: 'known', effort: 'high' }, models, true)
      .effort,
  ).toBe('high');
  expect(
    resolveInterviewConfiguration(
      initial,
      [{ id: 'unknown', label: 'Unknown', description: '' }],
      true,
    ).effort,
  ).toBe('auto');
  const offline = resolveInterviewConfiguration(initial, models, false);
  expect(offline).toMatchObject({
    mode: 'mock',
    aiEnabled: false,
  });
});
it('retired ASR settings are ignored without losing audio devices or answer preferences', async () => {
  let saved = JSON.stringify({
    asrModel: 'qwen3-asr-0.6b',
    computeDevice: 'nvidia',
    microphoneEnabled: false,
    system: 'speaker',
    modelId: 'known',
    effort: 'high',
  });
  vi.stubGlobal('localStorage', {
    getItem: () => saved,
    setItem: (_key: string, value: string) => {
      saved = value;
    },
  });
  try {
    vi.resetModules();
    const { useInterviewSettings } = await import('../../../shared/src/stores/interviewSettings');
    const configuration = useInterviewSettings.getState().configuration;
    expect(configuration.options).toEqual({
      speechModel: 'paraformer',
      inferenceDevice: 'cuda',
      sources: ['system'],
      microphone: undefined,
      system: 'speaker',
    });
    expect(configuration).toMatchObject({ modelId: 'known', effort: 'high' });
    useInterviewSettings.getState().update(configuration);
    expect(JSON.parse(saved)).toEqual({
      speechModel: 'paraformer',
      inferenceDevice: 'cuda',
      microphoneEnabled: false,
      system: 'speaker',
      modelId: 'known',
      effort: 'high',
    });
  } finally {
    vi.unstubAllGlobals();
  }
});
it('preserves explicit Metal and answer preferences when restoring Mac speech settings', async () => {
  vi.stubGlobal('localStorage', {
    getItem: () =>
      JSON.stringify({
        speechModel: 'qwen',
        inferenceDevice: 'metal',
        system: 'speaker',
        modelId: 'answer',
        effort: 'high',
      }),
  });
  try {
    vi.resetModules();
    const { useInterviewSettings } = await import('../../../shared/src/stores/interviewSettings');
    expect(useInterviewSettings.getState().configuration).toMatchObject({
      modelId: 'answer',
      effort: 'high',
      options: { speechModel: 'qwen', inferenceDevice: 'metal', system: 'speaker' },
    });
  } finally {
    vi.unstubAllGlobals();
  }
});
