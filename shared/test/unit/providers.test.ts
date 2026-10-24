import { expect, it } from 'vitest';
import { providerInfo } from '../../../shared/src/services/providers';

it('未知来源与损坏的旧数据不会被标成 ChatGPT，旧已记录来源仍可读取', () => {
  expect(providerInfo().id).toBe('unknown');
  expect(providerInfo({ id: 'bad', name: null, dataRecipient: '' } as any).id).toBe('unknown');
  expect(providerInfo('chatgpt').name).toBe('ChatGPT');
  expect(providerInfo('copilot').name).toBe('GitHub Copilot');
  expect(providerInfo('Other Service').name).toBe('Other Service');
  expect(
    providerInfo({ id: 'other', name: 'Other', dataRecipient: 'Other Company' }).dataRecipient,
  ).toBe('Other Company');
});
