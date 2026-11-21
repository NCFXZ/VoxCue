import type { AIService } from '../../electron/contracts/auth';
import { apiProviderIds } from '../../electron/contracts/apiConnections';
import { reasoningEfforts, type ChatModel, type ReasoningEffort } from '../../electron/contracts/chat';
import { resolveReasoningEffort } from './chatOptions';

type Scope = 'chat' | 'interview';
type Selection = { modelId: string; effort: ReasoningEffort | 'auto' };
type Preferences = Partial<Record<AIService, Selection>> & { active?: AIService };

export const serviceModelPreferenceKey = (scope: Scope) => 'voxcue-' + scope + '-service-models-v1';
const unsaved: Partial<Record<Scope, Preferences>> = {};
const entering: Partial<Record<Scope, AIService>> = {};

/** A successful service switch may precede its first usable catalog, including after a retry. */
export function startServiceModelSwitch(service: AIService) {
  entering.chat = service;
  entering.interview = service;
}

function read(scope: Scope): Preferences {
  if (unsaved[scope]) return unsaved[scope];
  const preferences: Preferences = {};
  try {
    const data = JSON.parse(localStorage.getItem(serviceModelPreferenceKey(scope)) ?? '{}');
    for (const service of ['chatgpt', 'copilot', ...apiProviderIds] as const) {
      const selection = data?.[service];
      if (typeof selection?.modelId !== 'string' || !selection.modelId) continue;
      preferences[service] = {
        modelId: selection.modelId,
        effort: reasoningEfforts.includes(selection.effort) ? selection.effort : 'auto',
      };
      if (data.active === service) preferences.active = service;
    }
  } catch {
    // An unreadable preference should not prevent use of the current catalog.
  }
  return preferences;
}

export function rememberServiceModel(scope: Scope, service: AIService, selection: Selection) {
  if (entering[scope] === service) delete entering[scope];
  const preferences = read(scope);
  const previous = preferences[service];
  if (
    preferences.active === service &&
    previous?.modelId === selection.modelId &&
    previous.effort === selection.effort &&
    !unsaved[scope]
  ) return;
  preferences.active = service;
  preferences[service] = { modelId: selection.modelId, effort: selection.effort };
  try {
    localStorage.setItem(serviceModelPreferenceKey(scope), JSON.stringify(preferences));
    delete unsaved[scope];
  } catch {
    unsaved[scope] = preferences;
  }
}

export function resolveServiceModel(
  scope: Scope,
  service: AIService,
  models: readonly ChatModel[],
  current: Selection,
): Selection | undefined {
  if (!models.length) return;
  const preferences = read(scope);
  // Only pre-upgrade selections have no recorded service. Try them once against the live catalog.
  const preferred = preferences[service] ?? (preferences.active ? undefined : current);
  const remembered = models.find((model) => model.id === preferred?.modelId);
  if (!remembered && preferences.active === service && entering[scope] !== service) return;
  const model = remembered ?? models[0];
  const selection = {
    modelId: model.id,
    effort: resolveReasoningEffort(model, remembered ? preferred?.effort : undefined),
  };
  rememberServiceModel(scope, service, selection);
  return selection;
}
