import { expect, it } from 'vitest';
import {
  mergeSelectedSkills,
  skillProposalEntries,
  profileProposalStale,
} from '../../../shared/electron/contracts/profile';
const a = { id: 'a', title: 'C++', content: '旧C++', sources: [] };
const b = {
  id: 'b',
  title: 'Qt',
  content: '旧Qt',
  sources: [{ title: '原始来源', url: 'https://example.com/qt' }],
};
const edited = { ...a, content: '新C++' };
const added = { id: 'c', title: 'Rust', content: '新Rust', sources: [] };
const other = { id: 'd', title: 'Python', content: '新Python', sources: [] };
const next = [edited, added, other];
it('提案包含新增、修改、不变和显式删除条目', () => {
  expect(
    skillProposalEntries([a, b], [edited, b, added]).map(({ skill, kind }) => [skill.id, kind]),
  ).toEqual([
    ['a', 'update'],
    ['b', 'keep'],
    ['c', 'add'],
  ]);
  expect(skillProposalEntries([a, b], next).at(-1)).toEqual({ skill: b, kind: 'remove' });
});
it.each([
  [
    ['a', 'c'],
    [edited, b, added],
  ],
  [['c'], [a, b, added]],
  [['b'], [a]],
  [[], [a, b]],
])('仅应用所选ID，未选中的已有技能逐字保留：%j', (ids, expected) => {
  expect(mergeSelectedSkills([a, b], next, ids as string[])).toEqual(expected);
  expect(a.content).toBe('旧C++');
});
it('空列表提案也只删除勾选条目，不能连带清空', () => {
  expect(mergeSelectedSkills([a, b], [], ['a'])).toEqual([b]);
});
it('所选技能冲突阻止覆盖，未选技能和并发新增保留', () => {
  const base = { name: '', background: '简历', jobDescription: 'JD', skills: [a, b] };
  const current = { ...base, skills: [a, { ...b, content: '较新Qt' }, other] };
  expect(profileProposalStale(current, base, { skills: next }, ['a', 'c'])).toBe(false);
  expect(mergeSelectedSkills(current.skills, next, ['a', 'c'])).toEqual([
    edited,
    current.skills[1],
    other,
    added,
  ]);
  expect(profileProposalStale(current, base, { skills: next }, ['b'])).toBe(true);
  expect(
    profileProposalStale({ ...base, skills: [a, b, added] }, base, { skills: next }, ['c']),
  ).toBe(true);
  expect(
    profileProposalStale({ ...base, background: '新摘要' }, base, { skills: next }, ['c']),
  ).toBe(true);
});
