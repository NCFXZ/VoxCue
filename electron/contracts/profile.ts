export const profileLimits = {
  name: 60,
  role: 100,
  jobDescription: 10000,
  background: 10000,
} as const;
export type ProfileField = keyof typeof profileLimits;
export type PersonalInfo = Record<ProfileField, string>;
export type ProfileChanges = Partial<PersonalInfo>;
export const profileFields = Object.keys(profileLimits) as ProfileField[];
export function validProfile(value: unknown): value is PersonalInfo {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    Object.keys(record).length === profileFields.length &&
    profileFields.every(
      (key) => typeof record[key] === 'string' && record[key].length <= profileLimits[key],
    )
  );
}
export function validateChanges(value: unknown): ProfileChanges {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('资料更新格式无效，请重新整理。');
  const result: ProfileChanges = {};
  for (const [key, item] of Object.entries(value)) {
    if (!profileFields.includes(key as ProfileField)) throw new Error('资料更新包含未知字段。');
    if (item === null) continue;
    if (
      typeof item !== 'string' ||
      !item.trim() ||
      item.length > profileLimits[key as ProfileField]
    )
      throw new Error('资料更新内容无效或过长，请重新整理。');
    result[key as ProfileField] = item.trim();
  }
  return result;
}
