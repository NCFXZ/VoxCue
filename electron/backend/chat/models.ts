import { reasoningEfforts, type ReasoningEffort } from '../../contracts/chat';
export function modelEfforts(model: any): ReasoningEffort[] {
  const advertised = model.supported_reasoning_levels;
  if (Array.isArray(advertised))
    return [
      ...new Set(
        advertised
          .map((item) => (typeof item === 'string' ? item : item?.effort))
          .filter((item): item is ReasoningEffort => reasoningEfforts.includes(item)),
      ),
    ];
  // Conservative fallback for explicitly documented families; never infer unknown models.
  if (/^gpt-6-(luna|sol)(?:-\d{4}-\d{2}-\d{2})?$/.test(model.slug))
    return ['none', 'low', 'medium', 'high', 'xhigh', 'max'];
  if (/^gpt-(6-astra|6\.1-sol)(?:-\d{4}-\d{2}-\d{2})?$/.test(model.slug))
    return ['low', 'medium', 'high', 'xhigh', 'max'];
  return [];
}
