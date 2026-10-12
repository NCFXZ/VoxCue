import { describe, expect, it } from 'vitest';
import { extractProfileChanges } from './preparation';
describe('聊天资料更新识别', () => {
  it('只识别明确标注的资料字段', () => {
    expect(
      extractProfileChanges('姓名：小林\n岗位：前端工程师\nJD：负责桌面应用\n熟悉 React'),
    ).toEqual({ name: '小林', role: '前端工程师', jobDescription: '负责桌面应用\n熟悉 React' });
    expect(extractProfileChanges('如何介绍我的姓名和岗位？')).toEqual({});
  });
});
