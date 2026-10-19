import { describe, expect, it } from 'vitest';
import { skillResearchScope } from '../../../../shared/electron/contracts/profile';
import {
  extractProfileChanges,
  isSkillReply,
  needsSkillResearch,
  type ChatMessage,
} from '../../../../shared/src/services/preparation';
describe('聊天资料更新识别', () => {
  it.each([
    ['请生成技能', 'all'],
    ['请生成一套完整的面试技能', 'all'],
    ['帮我生成3条技能', 'all'],
    ['帮我生成一整套技能', 'all'],
    ['帮我生成一套岗位技能', 'all'],
    ['帮我加一条Kafka', 'topic'],
    ['请新增一条关于数据库事务的技能', 'topic'],
    ['请生成Kafka消息可靠性技能', 'topic'],
    ['新增技能：Kafka消费顺序', 'topic'],
    ['请把Kafka技能改写得简洁一些', 'topic'],
    ['不要生成Kafka技能', undefined],
    ['不加一条Kafka', undefined],
    ['请只整理简历，供后续生成Kafka技能', undefined],
    ['先整理简历，之后生成Kafka技能', undefined],
    ['Kafka是什么', undefined],
    ['解释“生成Kafka技能”是什么意思', undefined],
    ['怎么生成Kafka技能', undefined],
    ['给简历加一条Kafka项目经历', undefined],
    ['给自定义指令加一条英文回答', undefined],
    ['删除Kafka技能', undefined],
    ['请生成技能，但不要修改简历', 'all'],
    ['不生成技能。改为更新面试技能', 'all'],
  ] as const)('仅明确指定主题的技能操作使用例外：%s', (prompt, scope) => {
    expect(skillResearchScope(prompt)).toBe(scope);
    expect(needsSkillResearch(prompt)).toBe(scope !== undefined);
  });
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
