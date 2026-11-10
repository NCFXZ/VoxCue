import { expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { InterviewShortcutHelp } from '../../src/components/InterviewShortcutHelp';
import { defaultShortcuts } from '../../electron/contracts/shortcuts';
vi.mock('../../src/i18n', () => ({ t: (value: string) => value }));

it('shows the interview controls in a named, non-modal help region', () => {
  const html = renderToStaticMarkup(<InterviewShortcutHelp onClose={() => {}} />);
  const keys = [...html.matchAll(/<kbd>(.*?)<\/kbd>/g)].map((match) => match[1]);
  expect(keys).toEqual([
    'Ctrl+Shift+H',
    'Ctrl+Shift+P',
    'Ctrl+Shift+T',
    'Ctrl+Shift+M',
    'Ctrl+Shift+A',
    'Ctrl+Shift+Enter',
    'Ctrl+Shift+S',
  ]);
  expect(html).toContain('发送当前输入内容');
  expect(html).toContain('aria-labelledby="interview-shortcut-heading"');
  expect(html).toContain('aria-label="关闭快捷键帮助"');
  expect(html).not.toContain('<dialog');
  expect(html).not.toContain('滚动设备内容');
});

it('shows device scrolling only while a device is connected', () => {
  const render = (deviceConnected: boolean) =>
    renderToStaticMarkup(
      <InterviewShortcutHelp deviceConnected={deviceConnected} onClose={() => {}} />,
    );
  expect(render(true)).toContain('向上滚动设备内容');
  expect(render(true)).toContain('向下滚动设备内容');
  expect(render(false)).not.toContain('滚动设备内容');
});

it('reflects configured bindings, disabled actions and registration conflicts', () => {
  const bindings = {
    ...defaultShortcuts(),
    'submit-input': 'Control+Shift+K',
    'toggle-transcript': null,
  };
  const html = renderToStaticMarkup(
    <InterviewShortcutHelp
      bindings={bindings}
      conflicts={[
        { action: 'toggle-window', accelerator: 'Control+Shift+H', reason: 'unavailable' },
      ]}
      onClose={() => {}}
    />,
  );
  expect(html).toContain('Ctrl+Shift+K');
  expect(html).not.toContain('Ctrl+Shift+Enter');
  expect(html).toContain('未设置');
  expect(html).toContain('不可用');
  expect(html).not.toContain('Ctrl+Shift+H');
});
