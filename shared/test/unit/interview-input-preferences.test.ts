import { afterEach, expect, it, vi } from 'vitest';
afterEach(() => vi.unstubAllGlobals());
it('persists the input mode independently and preserves remote sources and devices across reloads', async () => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
  const reload = async () => {
    vi.resetModules();
    return (await import('../../src/stores/interviewSettings')).useInterviewSettings;
  };
  let store = await reload();
  expect(store.getState().inputMode).toBe('remote');
  const configuration = {
    ...store.getState().configuration,
    options: {
      ...store.getState().configuration.options,
      sources: ['system'] as const,
      microphone: 'saved-mic',
      system: 'saved-output',
    },
  };
  store
    .getState()
    .update({ ...configuration, options: { ...configuration.options, sources: ['system'] } });
  const saved = values.get('copilot-interview-settings-v1');
  store.getState().setInputMode('transcription');
  expect(values.get('copilot-interview-settings-v1')).toBe(saved);
  store = await reload();
  expect(store.getState()).toMatchObject({
    inputMode: 'transcription',
    configuration: {
      options: { sources: ['system'], microphone: 'saved-mic', system: 'saved-output' },
    },
  });
  store.getState().setInputMode('remote');
  expect(values.get('copilot-interview-settings-v1')).toBe(saved);
  expect(store.getState().configuration.options.sources).toEqual(['system']);
});
it('falls back to remote for an invalid saved value and retains the current mode when saving fails', async () => {
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => (key === 'copilot-interview-input-mode-v1' ? 'invalid' : null),
    setItem: () => {
      throw Error('Synthetic storage failure');
    },
  });
  vi.resetModules();
  const { useInterviewSettings: store } = await import('../../src/stores/interviewSettings');
  expect(store.getState().inputMode).toBe('remote');
  store.getState().setInputMode('transcription');
  expect(store.getState()).toMatchObject({
    inputMode: 'remote',
    error: '面试设置保存失败，请检查本地存储空间。',
  });
});
