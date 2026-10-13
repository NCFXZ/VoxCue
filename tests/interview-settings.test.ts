import { expect, it } from 'vitest';
import {
  defaultInterviewConfiguration,
  resolveInterviewConfiguration,
} from '../src/services/speech';
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
