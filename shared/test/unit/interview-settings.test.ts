import { expect, it, vi } from 'vitest';
import {
  defaultInterviewConfiguration,
  resolveInterviewConfiguration,
} from '../../../shared/src/services/speech';
it('开场保留明确自动档位，未选择模型默认轻度，未知能力保持自动', () => {
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
  ).toBe('auto');
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
