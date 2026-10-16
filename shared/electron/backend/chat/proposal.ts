import { skillContentChanged, type ProfileChanges } from '../../contracts/profile';
import type { ChatRequest, ChatSource } from '../../contracts/chat';
import { sourceKey } from './validation';
import { ChatServiceError } from './errors';

/** The same confirmation/source boundary applies to every AI service. */
export function verifySkillProposal(
  request: ChatRequest,
  changes: ProfileChanges | undefined,
  sources: Map<string, ChatSource>,
  completedSearch: boolean,
): string | undefined {
  if (!changes?.skills || !request.profile || !skillContentChanged(request.profile, changes.skills))
    return;
  if (
    (changes.background !== undefined && changes.background !== request.profile.background) ||
    (changes.jobDescription !== undefined &&
      changes.jobDescription !== request.profile.jobDescription)
  )
    throw Error('请先确认简历和职位描述摘要，再联网生成技能。');
  if (!request.webSearch || !completedSearch || !sources.size)
    throw new ChatServiceError({
      code: 'skill_search_unverified',
      message: '未取得真实联网查询及来源，技能未更新，请重新联网生成。',
    });
  let removed = 0;
  for (const skill of changes.skills) {
    if ((request.profile.skills ?? []).some((old) => JSON.stringify(old) === JSON.stringify(skill)))
      continue;
    const matched = new Map<string, ChatSource>();
    for (const source of skill.sources) {
      const key = sourceKey(source.url),
        verified = key && sources.get(key);
      if (key && verified) matched.set(key, verified);
      else removed++;
    }
    if (!matched.size)
      throw new ChatServiceError({
        code: 'skill_sources_unverified',
        message:
          '技能引用未能对应本次真实检索来源，提案未通过校验，尚未保存。已保留收到的内容，请重试。',
      });
    skill.sources = [...matched.values()];
  }
  if (removed) return `已移除${removed}个未匹配的引用；每项技能仍保留本次真实来源，请确认内容。`;
}
