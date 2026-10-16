import { chatGPTProvider, copilotProvider, type ModelProvider } from '../../electron/contracts/chat';

const unknownProvider: ModelProvider = {
  id: 'unknown',
  name: '模型服务',
  dataRecipient: '模型服务提供商',
};

/** Use adapter metadata, never guess a provider from a model's name. */
export function providerInfo(value?: ModelProvider | string): ModelProvider {
  if (value === 'chatgpt') return chatGPTProvider;
  if (value === 'copilot') return copilotProvider;
  if (value === 'mock') return { id: 'mock', name: '未连接服务', dataRecipient: '模型服务提供商' };
  if (typeof value === 'string' && value !== 'unknown' && value.trim() && value.length <= 120)
    return { id: value, name: value, dataRecipient: value };
  if (
    value &&
    typeof value === 'object' &&
    [value.id, value.name, value.dataRecipient].every(
      (field) => typeof field === 'string' && field.trim() && field.length <= 120,
    )
  )
    return {
      id: value.id, name: value.name, dataRecipient: value.dataRecipient,
      ...(typeof value.modelName === 'string' && value.modelName.length <= 120 ? { modelName: value.modelName } : {}),
      ...(typeof value.modelVendor === 'string' && value.modelVendor.length <= 120 ? { modelVendor: value.modelVendor } : {}),
    };
  return unknownProvider;
}
