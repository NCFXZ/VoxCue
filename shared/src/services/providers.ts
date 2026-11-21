import { t } from '../i18n';
import { apiProviders, isApiProvider } from '../../electron/contracts/apiConnections';
import {
  chatGPTProvider,
  copilotProvider,
  type ModelProvider,
} from '../../electron/contracts/chat';

const unknownProvider: ModelProvider = {
  id: 'unknown',
  name: '模型服务',
  dataRecipient: '模型服务提供商',
};

/** Use adapter metadata, never guess a provider from a model's name. */
export function providerInfo(value?: ModelProvider | string): ModelProvider {
  if (value === 'chatgpt') return chatGPTProvider;
  if (value === 'copilot') return copilotProvider;
  if (isApiProvider(value)) {
    const provider = apiProviders[value];
    return { id: value, name: t(provider.name), dataRecipient: t(provider.recipient) };
  }
  if (value === 'mock')
    return { id: 'mock', name: t('未连接服务'), dataRecipient: t('模型服务提供商') };
  if (typeof value === 'string' && value !== 'unknown' && value.trim() && value.length <= 120)
    return { id: value, name: value, dataRecipient: value };
  if (
    value &&
    typeof value === 'object' &&
    [value.id, value.name, value.dataRecipient].every(
      (field) => typeof field === 'string' && field.trim() && field.length <= 120,
    )
  ) {
    const api = isApiProvider(value.id) ? apiProviders[value.id] : undefined;
    return {
      id: value.id,
      name: api ? t(api.name) : value.name,
      dataRecipient: api ? t(api.recipient) : value.dataRecipient,
      ...(typeof value.modelName === 'string' && value.modelName.length <= 120
        ? { modelName: value.modelName }
        : {}),
      ...(typeof value.modelVendor === 'string' && value.modelVendor.length <= 120
        ? { modelVendor: value.modelVendor }
        : {}),
    };
  }
  return {
    ...unknownProvider,
    name: t(unknownProvider.name),
    dataRecipient: t(unknownProvider.dataRecipient),
  };
}
