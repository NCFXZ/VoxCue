import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { InterviewUsageNotice } from '../../src/components/InterviewUsageNotice';

const view = (seconds: number, state: 'active' | 'expired' = 'active', saved = false) =>
  renderToStaticMarkup(
    createElement(InterviewUsageNotice, {
      usage: { state, permanent: false, remainingSeconds: seconds },
      saved,
    }),
  );
it('warns at five minutes, switches to seconds below one minute, and never displays negative time', () => {
  expect(view(301)).toBe('');
  expect(view(300)).toContain('5 分钟');
  expect(view(61)).toContain('2 分钟');
  expect(view(60)).toContain('1 分钟');
  expect(view(59)).toContain('59 秒');
  expect(view(1)).toContain('1 秒');
  expect(view(0, 'expired')).toContain('正在保存本次面试记录');
  expect(view(0, 'expired', true)).toContain('本次面试已停止');
});
it('does not show a finite time warning for permanent credit', () => {
  expect(
    renderToStaticMarkup(
      createElement(InterviewUsageNotice, {
        usage: { state: 'active', permanent: true, remainingSeconds: null },
        saved: false,
      }),
    ),
  ).toBe('');
});
