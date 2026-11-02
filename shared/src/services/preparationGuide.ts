import type { PersonalInfo } from './preparation';

export type PreparationStep = 'resume' | 'job' | 'skills' | 'ready';
export type PreparationAction = 'upload' | 'resume' | 'job' | 'skills' | 'profile' | 'interview';

export function preparationActions(
  info: PersonalInfo,
  needsUpdate: boolean,
): { id: PreparationAction; label: string }[] {
  const skills = { id: 'skills' as const, label: info.skills?.length ? '更新技能' : '生成技能' };
  switch (preparationStep(info, needsUpdate)) {
    case 'resume':
      return [
        { id: 'upload', label: '上传简历' },
        { id: 'resume', label: '粘贴简历内容' },
        info.jobDescription.trim()
          ? { id: 'profile', label: '查看个人资料' }
          : { id: 'job', label: '添加职位描述' },
      ];
    case 'job':
      return [
        { id: 'job', label: '添加职位描述' },
        { id: 'upload', label: '更新简历' },
        { id: 'interview', label: '开始面试' },
      ];
    case 'skills':
      return [
        skills,
        { id: 'profile', label: '查看个人资料' },
        { id: 'interview', label: '开始面试' },
      ];
    case 'ready':
      return [
        { id: 'interview', label: '开始面试' },
        skills,
        { id: 'profile', label: '查看个人资料' },
      ];
  }
}

export function preparationStep(info: PersonalInfo, skillsNeedUpdate: boolean): PreparationStep {
  if (!info.background.trim()) return 'resume';
  if (!info.jobDescription.trim()) return 'job';
  if (skillsNeedUpdate || !info.skills?.length) return 'skills';
  return 'ready';
}
