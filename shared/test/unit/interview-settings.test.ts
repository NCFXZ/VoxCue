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
  expect(resolveReasoningEffort(model, 'auto')).toBe('auto');
  expect(resolveReasoningEffort(model, 'max')).toBe('auto');
  expect(resolveReasoningEffort(model, 'none')).toBe('none');
});
it('unspecified and unsupported effort leave the server default in effect', () => {
  const model: ChatModel = {
    id: 'sparse',
    label: 'Sparse',
    description: '',
    reasoningEfforts: ['xhigh', 'medium'],
  };
  expect(resolveReasoningEffort(model)).toBe('auto');
  expect(resolveReasoningEffort(model, 'xhigh')).toBe('xhigh');
  expect(resolveReasoningEffort({ ...model, reasoningEfforts: [] }, 'high')).toBe('auto');
  expect(resolveReasoningEffort({ id: 'plain', label: 'Plain', description: '' }, 'high')).toBe(
    'auto',
  );
  expect(resolveReasoningEffort(undefined, 'high')).toBe('auto');
});
it('开场保留自动档位和明确选择', () => {
  const initial = defaultInterviewConfiguration();
  const models = [
    {
      id: 'known',
      label: 'Known',
      description: '',
      reasoningEfforts: ['low' as const, 'high' as const],
    },
  ];
  expect(resolveInterviewConfiguration(initial, models, true).effort).toBe('auto');
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
it('preserves a removed interview model until the user chooses another model', () => {
  const saved = { ...defaultInterviewConfiguration(), modelId: 'retired', effort: 'high' as const };
  expect(
    resolveInterviewConfiguration(saved, [{ id: 'future', label: 'Future', description: '' }], true),
  ).toMatchObject({ modelId: 'retired', effort: 'auto' });
});
it('updates interview defaults before settings open, restores each service, and follows confirmed changes from the floating window', async () => {
  const values = new Map([['copilot-interview-settings-v1', JSON.stringify({
    modelId: 'chosen', effort: 'high', microphone: 'saved-microphone',
  })]]);
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
  vi.stubGlobal('window', new EventTarget());
  vi.resetModules();
  const { useInterviewSettings, watchInterviewModel } = await import('../../src/stores/interviewSettings');
  const { useChatConnection } = await import('../../src/stores/chatConnection');
  const { rememberServiceModel, serviceModelPreferenceKey } = await import('../../src/services/serviceModelPreferences');
  const initial: ChatModel = { id: 'first', label: 'First', description: '' };
  const chosen: ChatModel = { id: 'chosen', label: 'Chosen', description: '', reasoningEfforts: ['low', 'high'] };
  const settings = () => useInterviewSettings.getState().configuration;
  const stop = watchInterviewModel();
  try {
    useChatConnection.setState({ live: true, service: 'chatgpt', models: [initial, chosen] });
    expect(settings()).toMatchObject({ aiEnabled: true, modelId: 'chosen', effort: 'high' });
    useChatConnection.setState({ service: 'copilot', loading: true, models: [] });
    expect(settings().modelId).toBe('chosen');
    useChatConnection.setState({ loading: false, models: [initial, chosen] });
    expect(settings()).toMatchObject({ modelId: 'first', effort: 'auto' });
    useInterviewSettings.getState().update({ ...settings(), modelId: 'chosen', effort: 'low' });
    useChatConnection.setState({ service: 'chatgpt', models: [initial, chosen] });
    expect(settings()).toMatchObject({ modelId: 'chosen', effort: 'high' });
    useChatConnection.setState({ models: [initial] });
    expect(settings().modelId).toBe('chosen');
    useChatConnection.setState({ service: 'copilot', models: [initial, chosen] });
    expect(settings()).toMatchObject({ modelId: 'chosen', effort: 'low' });

    rememberServiceModel('interview', 'copilot', { modelId: 'first', effort: 'auto' });
    window.dispatchEvent(Object.assign(new Event('storage'), { key: serviceModelPreferenceKey('interview') }));
    expect(settings()).toMatchObject({ modelId: 'first', effort: 'auto', options: { microphone: 'saved-microphone' } });
    useChatConnection.setState({ service: 'chatgpt', models: [initial] });
    expect(settings()).toMatchObject({ modelId: 'first', effort: 'auto' });
    expect(JSON.parse(values.get(serviceModelPreferenceKey('interview'))!)).toMatchObject({
      active: 'chatgpt', chatgpt: { modelId: 'first', effort: 'auto' },
    });
  } finally {
    stop();
    vi.unstubAllGlobals();
  }
});
it('falls back on a return switch even when the intermediate service had an empty catalog', async () => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
  const model = (id: string) => ({ id, label: id, description: '' });
  const chatModels = vi.fn()
    .mockResolvedValueOnce({ ok: true, models: [model('old')] })
    .mockResolvedValueOnce({ ok: true, models: [] })
    .mockResolvedValueOnce({ ok: true, models: [model('new')] });
  vi.stubGlobal('window', Object.assign(new EventTarget(), { desktop: {
    authSession: async (mode: string) => ({ mode, user: { id: 'synthetic' } }),
    chatModels,
    chatAccountUsage: async () => ({ ok: true, usage: null }),
  } }));
  vi.resetModules();
  const { useAuth } = await import('../../src/stores/auth');
  const { watchInterviewModel, useInterviewSettings } = await import('../../src/stores/interviewSettings');
  const stop = watchInterviewModel();
  try {
    await useAuth.getState().connect('chatgpt');
    expect(useInterviewSettings.getState().configuration.modelId).toBe('old');
    await useAuth.getState().connect('copilot');
    await useAuth.getState().connect('chatgpt');
    expect(useInterviewSettings.getState().configuration).toMatchObject({ modelId: 'new', effort: 'auto' });
  } finally {
    stop();
    vi.unstubAllGlobals();
  }
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
