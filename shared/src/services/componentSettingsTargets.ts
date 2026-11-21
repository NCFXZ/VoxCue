import { hasReadySpeechModel, type ComponentId, type ComponentState } from '../../electron/contracts/components';

const isSpeech = (id: ComponentId) => id === 'speech' || id === 'qwen';

export interface ComponentSettingsRequest {
  required: readonly ComponentId[];
  anySpeech?: boolean;
}

export type OpenComponentSettings = (request: ComponentSettingsRequest) => void;

/** A general speech requirement is satisfied as soon as either ASR model is ready. */
export function componentSettingsTargets(
  state: ComponentState | null,
  { required, anySpeech }: ComponentSettingsRequest,
): ComponentId[] | undefined {
  // Cache checks broadcast intermediate rows before all installed packages are known.
  if (!state || state.phase === 'checking' || state.items.some((item) => item.phase === 'checking')) return undefined;
  const checkSpeech = anySpeech && required.some(isSpeech);
  const missingSpeech = checkSpeech && !hasReadySpeechModel(state);
  return state.items
    .filter((item) => item.phase !== 'ready' &&
      (checkSpeech && isSpeech(item.id) ? missingSpeech : required.includes(item.id)))
    .map((item) => item.id);
}
