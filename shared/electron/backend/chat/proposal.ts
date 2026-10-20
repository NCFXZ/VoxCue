import {
  skillContentChanged,
  skillResearchScope,
  type ProfileChanges,
  type SkillSourceIssue,
} from '../../contracts/profile';
import type { ChatRequest, ChatSource } from '../../contracts/chat';
import { sourceKey } from './validation';

/** The same confirmation/source boundary applies to every AI service. */
export function verifySkillProposal(
  request: ChatRequest,
  changes: ProfileChanges | undefined,
  sources: Map<string, ChatSource>,
  completedSearch: boolean,
): SkillSourceIssue[] | undefined {
  if (!changes?.skills || !request.profile || !skillContentChanged(request.profile, changes.skills))
    return;
  if (
    ((!request.profile.background.trim() || !request.profile.jobDescription.trim()) &&
      skillResearchScope(request.turns.at(-1)?.content ?? '') !== 'topic') ||
    (changes.background !== undefined && changes.background !== request.profile.background) ||
    (changes.jobDescription !== undefined &&
      changes.jobDescription !== request.profile.jobDescription)
  )
    throw Error('请先确认简历和职位描述摘要，再联网生成技能。');
  const searchIssue = !request.webSearch
    ? 'search_disabled'
    : !completedSearch
      ? 'search_incomplete'
      : !sources.size
        ? 'search_sources_missing'
        : undefined;
  const issues: SkillSourceIssue[] = [];
  for (const skill of changes.skills) {
    if ((request.profile.skills ?? []).some((old) => JSON.stringify(old) === JSON.stringify(skill)))
      continue;
    const matched = new Map<string, ChatSource>();
    const unmatched: ChatSource[] = [];
    for (const source of skill.sources) {
      const key = sourceKey(source.url),
        verified = !searchIssue && key && sources.get(key);
      if (key && verified) matched.set(key, verified);
      else unmatched.push(source);
    }
    const reason =
      searchIssue ??
      (!skill.sources.length
        ? 'skill_sources_missing'
        : unmatched.length
          ? 'source_unmatched'
          : undefined);
    if (reason)
      issues.push({
        skillId: skill.id,
        reason,
        sources: unmatched,
      });
    skill.sources = [...matched.values()];
  }
  return issues.length ? issues : undefined;
}
