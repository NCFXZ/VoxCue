import { useChatConnection } from '../stores/chatConnection';
import { usePreparation } from '../stores/preparation';
import { providerInfo } from '../services/providers';
import { useAuth } from '../stores/auth';

export function useModelProvider(modelId?: string) {
  const selected = usePreparation((state) => state.modelId);
  const models = useChatConnection((state) => state.models);
  const service = useAuth((state) => state.session?.mode);
  const model = models.find((item) => item.id === (modelId ?? selected)) ?? models[0];
  return providerInfo(model?.provider ?? (service === 'demo' ? undefined : service));
}
