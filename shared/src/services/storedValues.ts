import { validProfile, type PersonalInfo } from '../../electron/contracts/profile';

export const profileStorageKey = 'copilot-personal-info-v1';
export const legacyProfileModificationKey = 'voxcue-profile-modification-v1';

export function hasSavedProfile(info: PersonalInfo) {
  return [info.name, info.role, info.jobDescription, info.background, info.customInstructions].some(
    (value) => value?.trim(),
  ) || !!(info.language?.trim() && info.language.trim() !== '简体中文') || !!info.skills?.length;
}

/** Early profiles stored custom instructions as a list. Decode without rewriting the original. */
export function readStoredProfile(raw: string): PersonalInfo {
  const info = JSON.parse(raw);
  if (Array.isArray(info?.customInstructions)) {
    const entries: unknown[] = info.customInstructions;
    if (
      entries.length > 10 ||
      !entries.every(
        (entry): entry is { title: string; content: string } =>
          storedObject(entry) &&
          typeof entry.title === 'string' &&
          typeof entry.content === 'string',
      )
    )
      throw Error('本地个人信息格式无效，未上传。');
    info.customInstructions = entries
      .map((entry) => entry.title + '\n' + entry.content)
      .join('\n\n');
  }
  if (!validProfile(info)) throw Error('本地个人信息格式无效，未上传。');
  return info;
}

// Validate data read from local stores before it reaches React. Unknown metadata
// may be retained by callers, but never becomes application state or an action.
export const storedObject = (value: unknown): value is Record<string, any> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
export const optionalString = (value: unknown) => value === undefined || typeof value === 'string';
export const optionalNumber = (value: unknown) => value === undefined || Number.isFinite(value);
export const optionalBoolean = (value: unknown) =>
  value === undefined || typeof value === 'boolean';
export function storedProvider(value: unknown) {
  return (
    value === undefined ||
    typeof value === 'string' ||
    (storedObject(value) &&
      ['id', 'name', 'dataRecipient'].every((key) => typeof value[key] === 'string') &&
      optionalString(value.modelName) &&
      optionalString(value.modelVendor))
  );
}
export function storedActivity(value: unknown) {
  return (
    value === undefined ||
    (storedObject(value) &&
      [
        'waiting',
        'thinking',
        'searching',
        'reading',
        'writing',
        'processing',
        'organizing',
      ].includes(value.phase) &&
      ['detail', 'id', 'url'].every((key) => optionalString(value[key])) &&
      (value.kind === undefined ||
        [
          'web_search',
          'open_page',
          'find_in_page',
          'commentary',
          'knowledge',
          'reasoning',
          'status',
        ].includes(value.kind)) &&
      (value.status === undefined || ['in_progress', 'completed', 'failed'].includes(value.status)))
  );
}
export function storedSources(value: unknown) {
  return (
    value === undefined ||
    (Array.isArray(value) &&
      value.every(
        (source) =>
          storedObject(source) &&
          typeof source.title === 'string' &&
          typeof source.url === 'string',
      ))
  );
}
