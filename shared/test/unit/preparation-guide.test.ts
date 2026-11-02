import { describe, it, expect } from 'vitest';
import { preparationStep, preparationActions } from '../../src/services/preparationGuide';

describe('preparation guide', () => {
  it('offers exactly three relevant choices without forcing a preparation sequence', () => {
    const info = { name: '', background: '', jobDescription: '' };
    const actions = (profile = info, update = false) =>
      preparationActions(profile, update).map((action) => action.id);
    expect(actions()).toEqual(['upload', 'resume', 'job']);
    expect(actions({ ...info, jobDescription: 'Job' })).toEqual(['upload', 'resume', 'profile']);
    expect(actions({ ...info, background: 'Resume' })).toEqual(['job', 'upload', 'interview']);
    expect(actions({ ...info, background: 'Resume', jobDescription: 'Job' })).toEqual([
      'skills',
      'profile',
      'interview',
    ]);
    const ready = {
      ...info,
      background: 'Resume',
      jobDescription: 'Job',
      skills: [{ id: 'one', title: 'Topic', content: 'Notes', sources: [] }],
    };
    expect(actions(ready)).toEqual(['interview', 'skills', 'profile']);
    expect(actions(ready, true)).toEqual(['skills', 'profile', 'interview']);
    expect(preparationActions({ ...ready, skills: [] }, false)[0].label).toBe('生成技能');
    expect(preparationActions(ready, false)[1].label).toBe('更新技能');
    expect(preparationActions(ready, true)[0].label).toBe('更新技能');
  });
  it('advances from confirmed summaries, with resume before job and skills', () => {
    expect(preparationStep({ name: '', background: '', jobDescription: '' }, false)).toBe('resume');
    expect(preparationStep({ name: '', background: ' ', jobDescription: 'Job only' }, true)).toBe(
      'resume',
    );
    expect(
      preparationStep({ name: '', background: 'Saved resume', jobDescription: '' }, true),
    ).toBe('job');
    expect(
      preparationStep({ name: '', background: 'Saved resume', jobDescription: 'Saved job' }, false),
    ).toBe('skills');
  });
  it('offers interview setup after saved skills, and updates after profile edits', () => {
    const info = {
      name: '',
      background: 'Saved resume',
      jobDescription: 'Saved job',
      skills: [{ id: 'one', title: 'Topic', content: 'Notes', sources: [] }],
    };
    expect(preparationStep(info, false)).toBe('ready');
    expect(preparationStep(info, true)).toBe('skills');
  });
});
