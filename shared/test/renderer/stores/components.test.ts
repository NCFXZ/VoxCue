import { afterEach, expect, it, vi } from 'vitest';
import type { ComponentState } from '../../../../shared/electron/contracts/components';

afterEach(() => vi.unstubAllGlobals());
const snapshot = (
  revision: number,
  qwen: ComponentState['items'][number]['phase'],
  phase: ComponentState['phase'] = 'ready',
  speech: ComponentState['items'][number]['phase'] = 'ready',
): ComponentState => ({
  revision,
  phase,
  error: null,
  items: [
    { id: 'speech', label: 'Paraformer', bytes: 1, received: 1, phase: speech },
    { id: 'qwen', label: 'Qwen', bytes: 2, received: qwen === 'ready' ? 2 : 0, phase: qwen },
  ],
});
async function setup(initial = snapshot(1, 'ready')) {
  const values = new Map([
    [
      'copilot-interview-settings-v1',
      JSON.stringify({
        microphoneEnabled: false,
        microphone: 'microphone-id',
        system: 'speaker-id',
        speechModel: 'qwen',
        inferenceDevice: 'metal',
        modelId: 'answer-model',
        effort: 'high',
      }),
    ],
  ]);
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
  let event!: (state: ComponentState) => void;
  const api = {
    platform: 'macos',
    components: vi.fn(async () => initial),
    onComponentEvent: (receive: typeof event) => {
      event = receive;
      return () => {};
    },
  };
  vi.stubGlobal('window', { desktop: api });
  vi.resetModules();
  const { useComponents } = await import('../../../../shared/src/stores/components');
  const { useInterviewSettings } = await import('../../../../shared/src/stores/interviewSettings');
  const disconnect = useComponents.getState().connect();
  await Promise.resolve();
  const saved = () => JSON.parse(values.get('copilot-interview-settings-v1')!);
  return { api, event, useComponents, useInterviewSettings, saved, disconnect };
}

it('删除Qwen后立即持久化回退Paraformer/CPU，保留音源、设备和回答设置', async () => {
  const s = await setup();
  s.event(snapshot(2, 'removing', 'removing'));
  expect(s.saved().speechModel).toBe('qwen');
  s.api.components.mockResolvedValueOnce(snapshot(3, 'pending'));
  expect(await s.useComponents.getState().run({ op: 'remove', id: 'qwen' })).toBe(true);
  expect(s.useInterviewSettings.getState().configuration).toMatchObject({
    modelId: 'answer-model',
    effort: 'high',
    options: {
      sources: ['system'],
      microphone: 'microphone-id',
      system: 'speaker-id',
      speechModel: 'paraformer',
      inferenceDevice: 'cpu',
    },
  });
  expect(s.saved()).toMatchObject({ speechModel: 'paraformer', inferenceDevice: 'cpu' });
  s.disconnect();
  vi.resetModules();
  const reopened = await import('../../../../shared/src/stores/interviewSettings');
  expect(reopened.useInterviewSettings.getState().configuration.options).toMatchObject({
    speechModel: 'paraformer',
    inferenceDevice: 'cpu',
  });
});

it('启动检查完成前不把初始pending误认成模型已删除，确认缺失后再回退', async () => {
  const s = await setup(snapshot(1, 'pending', 'checking'));
  expect(s.saved().speechModel).toBe('qwen');
  s.event(snapshot(2, 'checking', 'checking'));
  s.event(snapshot(3, 'ready'));
  expect(s.saved().speechModel).toBe('qwen');
  s.event(snapshot(4, 'pending', 'needed'));
  expect(s.saved().speechModel).toBe('paraformer');
});

it('仅Qwen可用时回退到Qwen/CPU，恢复Paraformer不会抢回选择', async () => {
  const s = await setup();
  const configuration = s.useInterviewSettings.getState().configuration;
  s.useInterviewSettings.getState().update({
    ...configuration,
    options: { ...configuration.options, speechModel: 'paraformer', inferenceDevice: 'cpu' },
  });
  s.event(snapshot(2, 'ready', 'ready', 'pending'));
  expect(s.saved()).toMatchObject({
    speechModel: 'qwen',
    inferenceDevice: 'cpu',
    modelId: 'answer-model',
  });
  s.event(snapshot(3, 'ready'));
  expect(s.saved().speechModel).toBe('qwen');
  s.disconnect();
});

it.each(['checking', 'downloading', 'verifying', 'removing'] as const)(
  'Qwen处于%s时保留用户选择',
  async (phase) => {
    const s = await setup(snapshot(1, phase, phase));
    expect(s.saved().speechModel).toBe('qwen');
    s.disconnect();
  },
);

it('没有可用替代模型、删除失败或过期状态不改写选择，重新下载不抢回选择', async () => {
  const s = await setup(snapshot(5, 'ready'));
  s.event(snapshot(4, 'pending'));
  s.event({ ...snapshot(6, 'ready', 'error'), error: '删除被拒绝' });
  s.event(snapshot(7, 'pending', 'needed', 'pending'));
  expect(s.saved().speechModel).toBe('qwen');
  s.event(snapshot(8, 'pending', 'ready'));
  expect(s.saved().speechModel).toBe('paraformer');
  s.event(snapshot(9, 'ready'));
  expect(s.saved().speechModel).toBe('paraformer');
  s.disconnect();
});
