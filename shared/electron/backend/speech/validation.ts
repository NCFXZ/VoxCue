import type { SpeechCall } from '../../contracts/speech';
export function validateSpeech(value: unknown): SpeechCall {
  if (!value || typeof value !== 'object') throw Error('Invalid speech request');
  const v = value as any;
  if (['devices', 'status', 'pause', 'stop'].includes(v.op)) return { op: v.op };
  if (
    v.op !== 'start' ||
    !v.options ||
    !Array.isArray(v.options.sources) ||
    v.options.sources.length < 1 ||
    v.options.sources.length > 2 ||
    new Set(v.options.sources).size !== v.options.sources.length ||
    v.options.sources.some((s: unknown) => s !== 'system' && s !== 'microphone')
  )
    throw Error('Invalid audio sources');
  for (const source of ['microphone', 'system'])
    if (
      v.options[source] !== undefined &&
      (typeof v.options[source] !== 'string' || v.options[source].length > 512)
    )
      throw Error('Invalid audio device');
  if (
    v.options.speechModel !== undefined &&
    !['paraformer', 'qwen'].includes(v.options.speechModel)
  )
    throw Error('Invalid speech model');
  if (
    v.options.inferenceDevice !== undefined &&
    !['cpu', 'cuda', 'metal'].includes(v.options.inferenceDevice)
  )
    throw Error('Invalid speech inference device');
  if (
    Object.keys(v.options).some(
      (key) => !['sources', 'microphone', 'system', 'speechModel', 'inferenceDevice'].includes(key),
    )
  )
    throw Error('Invalid speech option');
  return {
    op: 'start',
    options: {
      sources: v.options.sources,
      ...(v.options.microphone ? { microphone: v.options.microphone } : {}),
      ...(v.options.system ? { system: v.options.system } : {}),
      ...(v.options.speechModel ? { speechModel: v.options.speechModel } : {}),
      ...(v.options.inferenceDevice ? { inferenceDevice: v.options.inferenceDevice } : {}),
    },
  };
}
