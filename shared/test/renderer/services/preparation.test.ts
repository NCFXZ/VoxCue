import { describe, expect, it } from 'vitest';
import {
  extractProfileChanges,
  isSkillReply,
  needsSkillResearch,
  type ChatMessage,
} from '../../../../shared/src/services/preparation';
describe('聊天资料更新识别', () => {
  it.each([
    ['不生成技能', false],
    ['请只补充JD，不生成技能', false],
    ['不要自动联网更新面试技能，只整理简历', false],
    ['无需生成技能，只补充职位描述', false],
    ['请生成技能，但不要修改简历', true],
    ['不生成技能。改为更新面试技能', true],
  ] as const)('明确否定的技能操作不触发研究，独立肯定请求仍生效：%s', (prompt, expected) => {
    expect(needsSkillResearch(prompt)).toBe(expected);
  });
  it('只识别明确标注的资料字段', () => {
    expect(
      extractProfileChanges('姓名：小林\n岗位：前端工程师\nJD：负责桌面应用\n熟悉 React'),
    ).toEqual({ name: '小林', jobDescription: '负责桌面应用\n熟悉 React' });
    expect(extractProfileChanges('如何介绍我的姓名和岗位？')).toEqual({});
  });
  it('技能从请求开始即按纯文字显示，旧提案与失败预览兼容，不影响普通聊天', () => {
    const answer: ChatMessage = { id: 'a', role: 'assistant', content: '', status: 'streaming' };
    const user: ChatMessage = {
      id: 'q',
      role: 'user',
      content: '生成技能',
      options: {
        modelId: 'synthetic',
        modelLabel: 'Synthetic',
        live: true,
        webSearch: true,
        attachments: [],
        profileTask: 'skills',
      },
    };
    expect(isSkillReply(answer, user)).toBe(true);
    expect(isSkillReply(answer)).toBe(false);
    expect(isSkillReply({ ...answer, changes: { skills: [] } })).toBe(true);
    expect(isSkillReply({ ...answer, profilePreview: { skills: [] } })).toBe(true);
    expect(isSkillReply({ ...answer, errorCode: 'skill_sources_unverified' })).toBe(true);
    expect(isSkillReply(user)).toBe(false);
    expect(isSkillReply(answer, { ...user, options: undefined })).toBe(false);
  });
});
