import { reasoningEfforts, type ReasoningEffort } from '../../contracts/chat';
export function modelEfforts(model: any): ReasoningEffort[] {
  // Responses effort values are not Codex client effort modes (e.g. "ultra").
  // https://developers.openai.com/api/docs/models/gpt-6.1-sol
  let documented: ReasoningEffort[] | undefined;
  if (/^gpt-6-(luna|sol)(?:-\d{4}-\d{2}-\d{2})?$/.test(model.slug))
    documented = ['none', 'low', 'medium', 'high', 'xhigh', 'max'];
  if (/^gpt-(6-astra|6\.1-sol)(?:-\d{4}-\d{2}-\d{2})?$/.test(model.slug))
    documented = ['low', 'medium', 'high', 'xhigh', 'max'];
  const advertised = model.supported_reasoning_levels;
  if (Array.isArray(advertised)) {
    const values = new Set(
      advertised.map((item) => (typeof item === 'string' ? item : item?.effort)),
    );
    return (documented ?? reasoningEfforts).filter((effort) => values.has(effort));
  }
  // Conservative fallback for explicitly documented families; never infer unknown models.
  return documented ?? [];
}
