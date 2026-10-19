export const profileLimits = {
  name: 60,
  role: 100,
  jobDescription: 10000,
  background: 10000,
  language: 80,
  customInstructions: 16384,
} as const;
export interface ProfileEntry {
  id: string;
  title: string;
  content: string;
}
export interface ProfileSource {
  title: string;
  url: string;
}
export interface InterviewSkill extends ProfileEntry {
  sources: ProfileSource[];
}
export interface PersonalInfo {
  name: string;
  /** Legacy storage field, excluded from active editing and AI context. */
  role?: string;
  jobDescription: string;
  background: string;
  language?: string;
  customInstructions?: string;
  skills?: InterviewSkill[];
}
export const profileFields = [
  'name',
  'language',
  'background',
  'jobDescription',
  'customInstructions',
  'skills',
] as const;

/** Interpret only the current user's explicit request, never profile or attachment data. */
export function skillResearchScope(prompt: string): 'all' | 'topic' | undefined {
  if (typeof prompt !== 'string') return;
  let scope: 'all' | undefined;
  for (const clause of prompt.split(/[，,。；;！!？?\n]|但是|但|改为/)) {
    if (
      /(?:不要|不需要|无需|禁止|不)(?:再|立即|自动|主动)?(?:联网)?(?:生成|更新|重做|补充|添加|新增|整理|完善|修改|改写|重写|加)/.test(
        clause,
      ) ||
      /(?:供|用于|以便)(?:确认后|之后|后续)?(?:联网)?(?:更新|生成)/.test(clause) ||
      /^\s*(?:之后|后续|稍后|以后|确认后)/.test(clause)
    )
      continue;
    const action = /生成|更新|重做|补充|添加|新增|整理|完善|修改|改写|重写|做一套|加/.exec(clause);
    if (!action || /解释|如何|怎么|是否|示例|提示词/.test(clause.slice(0, action.index))) continue;
    const noun = /面试技能|技能|面试知识|知识点/.exec(clause);
    const single = /(?:新增|添加|补充|加)(?:一|1)(?:条|项)\s*(.+)/.exec(clause);
    if (!noun && !single) continue;
    if (!noun && /简历|JD|职位描述|自定义指令|草稿/i.test(clause)) continue;
    let topic =
      single?.[1] ??
      (noun && action.index < noun.index
        ? clause.slice(action.index + action[0].length, noun.index)
        : noun
          ? clause.slice(0, noun.index)
          : '');
    if (noun) {
      topic = topic.replace(/(?:面试技能|技能|面试知识|知识点).*$/, '');
      if (!topic.trim())
        topic =
          clause
            .slice(noun.index + noun[0].length)
            .match(/^(?:\s*[：:]\s*|\s*(?:关于|主题为|围绕)\s*|\s+)(.+)$/)?.[1] ?? '';
    }
    topic = topic
      .trim()
      .replace(/^(?:\d+|[一二三四五六七八九十几]+)(?:条|项|套|个)\s*/, '')
      .replace(
        /^(?:(?:请|帮我|为我|给我|把|将|作为|一条|1条|一项|1项|一整套|一套|关于|有关|针对|围绕|主题为|名为|完整的|完整|全部|所有|整套|一些|几条|若干|我的|已有|现有|这些|这条|该条|面试|的)\s*)+/,
        '',
      )
      .replace(/(?:相关的|相关|的|[「」“”"'])+$/g, '')
      .replace(/^[「“"']+/, '')
      .trim();
    if (
      topic &&
      /[a-z\u4e00-\u9fff]/i.test(topic) &&
      !/^(?:相关|岗位|面试|准备|资料|内容|知识|能力|列表|提案|个人|技术|专业|完整|全部|所有|整套|这|那)+$/.test(
        topic,
      ) &&
      !/简历|摘要|职位描述|\bJD\b|个人背景|我的背景|岗位要求|项目经历|工作经历|自定义指令|提示词|技能/.test(
        topic,
      )
    )
      return 'topic';
    if (noun) scope = 'all';
  }
  return scope;
}
export type ProfileField = (typeof profileFields)[number];
export type ProfileChanges = Partial<Pick<PersonalInfo, ProfileField>>;
/** Read-only streaming content; never accepted as a saved proposal. */
export type ProfilePreview = Partial<Record<Exclude<ProfileField, 'skills'>, string>> & {
  skills?: Array<{ title: string; content: string }>;
};
export const profileLabels: Record<ProfileField, string> = {
  name: '姓名',
  language: '面试语言',
  background: '简历摘要',
  jobDescription: '职位描述摘要',
  customInstructions: '自定义指令',
  skills: '技能',
};
export function profileValue(info: PersonalInfo, field: ProfileField) {
  return info[field] ?? (field === 'skills' ? [] : field === 'language' ? '简体中文' : '');
}
export function sameProfileField(a: PersonalInfo, b: PersonalInfo, field: ProfileField) {
  return JSON.stringify(profileValue(a, field)) === JSON.stringify(profileValue(b, field));
}
function validSkills(value: unknown): boolean {
  if (!Array.isArray(value) || value.length > 10) return false;
  const ids = new Set<string>();
  return Array.from(value).every((entry) => {
    if (
      !entry ||
      typeof entry !== 'object' ||
      Object.keys(entry).some((key) => !['id', 'title', 'content', 'sources'].includes(key)) ||
      typeof entry.id !== 'string' ||
      !/^[\w-]{1,64}$/.test(entry.id) ||
      ids.has(entry.id) ||
      typeof entry.title !== 'string' ||
      !entry.title.trim() ||
      entry.title.length > 80 ||
      typeof entry.content !== 'string' ||
      !entry.content.trim() ||
      entry.content.length > 6000
    )
      return false;
    ids.add(entry.id);
    return (
      Array.isArray(entry.sources) &&
      entry.sources.length <= 10 &&
      Array.from(entry.sources).every((source: any) => {
        if (
          !source ||
          Object.keys(source).some((key) => !['title', 'url'].includes(key)) ||
          typeof source.title !== 'string' ||
          !source.title.trim() ||
          source.title.length > 300 ||
          typeof source.url !== 'string' ||
          source.url.length > 4096
        )
          return false;
        try {
          const url = new URL(source.url);
          return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password;
        } catch {
          return false;
        }
      })
    );
  });
}
export function validProfile(value: unknown): value is PersonalInfo {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    Object.keys(record).every(
      (key) => key === 'role' || profileFields.includes(key as ProfileField),
    ) &&
    ['name', 'jobDescription', 'background'].every((key) => typeof record[key] === 'string') &&
    Object.entries(profileLimits).every(
      ([key, limit]) =>
        record[key] === undefined ||
        (typeof record[key] === 'string' && (record[key] as string).length <= limit),
    ) &&
    (record.skills === undefined || validSkills(record.skills)) &&
    JSON.stringify(record).length <= 40000
  );
}
export function validateChanges(value: unknown): ProfileChanges {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw Error('资料更新格式无效，请重新整理。');
  const result: ProfileChanges = {};
  for (const [key, item] of Object.entries(value)) {
    if (!profileFields.includes(key as ProfileField)) throw Error('资料更新包含未知字段。');
    if (item === null) continue;
    if (key === 'skills') {
      if (!validSkills(item)) throw Error('技能格式无效、重复或超过数量/长度限制。');
      Object.assign(result, { [key]: structuredClone(item) });
    } else {
      if (
        typeof item !== 'string' ||
        (item !== '' && !item.trim()) ||
        item.length > profileLimits[key as keyof typeof profileLimits]
      )
        throw Error('资料更新内容无效或过长，请重新整理。');
      Object.assign(result, { [key]: item.trim() });
    }
  }
  if (JSON.stringify(result).length > 40000) throw Error('资料更新内容过多，请分次整理。');
  return result;
}
export function skillContentChanged(base: PersonalInfo, next: InterviewSkill[]) {
  return next.some(
    (skill) => !(base.skills ?? []).some((old) => JSON.stringify(old) === JSON.stringify(skill)),
  );
}
export function profileProposalStale(
  info: PersonalInfo,
  base: PersonalInfo,
  changes: ProfileChanges,
) {
  return (
    profileFields.some(
      (field) => changes[field] !== undefined && !sameProfileField(info, base, field),
    ) ||
    (changes.skills !== undefined &&
      (!sameProfileField(info, base, 'background') ||
        !sameProfileField(info, base, 'jobDescription')))
  );
}
