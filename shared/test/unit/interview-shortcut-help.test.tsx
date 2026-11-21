import { afterEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { InterviewShortcutHelp } from '../../src/components/InterviewShortcutHelp';
import { defaultShortcuts } from '../../electron/contracts/shortcuts';
vi.mock('../../src/i18n', () => ({ t: (value: string) => value }));
afterEach(() => vi.unstubAllGlobals());

it('uses native Mac key symbols while retaining the shared bindings', () => {
  vi.stubGlobal('window', { desktop: { platform: 'macos' } });
  const html = renderToStaticMarkup(<InterviewShortcutHelp deviceConnected onClose={() => {}} />);
  expect([...html.matchAll(/<kbd>(.*?)<\/kbd>/g)].map((match) => match[1])).toEqual([
    '⌃⇧H',
    '⌃⇧/',
    '⌃⇧P',
    '⌃⇧T',
    '⌃⇧M',
    '⌃⇧A',
    '⌃⇧↩',
    '⌃⇧S',
    '⌃⇧↑',
    '⌃⇧↓',
  ]);
});

it('shows the interview controls in a named, non-modal help region', () => {
  const html = renderToStaticMarkup(<InterviewShortcutHelp onClose={() => {}} />);
  const common = html.split('class="floating-shortcut-remote"')[0];
  const keys = [...common.matchAll(/<kbd>(.*?)<\/kbd>/g)].map((match) => match[1]);
  expect(keys).toEqual([
    'Ctrl+Shift+H',
    'Ctrl+Shift+/',
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
  expect(html).toContain('data-connected="false" aria-hidden="true"');
});

it('shows device scrolling only while a device is connected', () => {
  const render = (deviceConnected: boolean) =>
    renderToStaticMarkup(
      <InterviewShortcutHelp deviceConnected={deviceConnected} onClose={() => {}} />,
    );
  expect(render(true)).toContain('向上滚动设备内容');
  expect(render(true)).toContain('向下滚动设备内容');
  expect(render(false)).toContain('data-connected="false" aria-hidden="true"');
  expect(render(true)).toContain('data-connected="true" aria-hidden="false"');
});

it('shows only the action that the current window, panel and audio state can perform', () => {
  for (const enabled of [true, false]) {
    const html = renderToStaticMarkup(
      <InterviewShortcutHelp
        onClose={() => {}}
        status={{
          visible: enabled,
          collapsed: !enabled,
          transcriptVisible: enabled,
          microphoneMuted: !enabled,
          systemAudioMuted: !enabled,
        }}
      />,
    );
    expect(
      [...html.matchAll(/<span class="floating-shortcut-action-label">(.*?)<\/span>/g)]
        .slice(0, 6)
        .map((match) => match[1]),
    ).toEqual(
      enabled
        ? ['隐藏面试窗口', '隐藏快捷键说明', '收起面试面板', '收起转写面板', '关闭麦克风', '关闭系统音频']
        : ['显示面试窗口', '隐藏快捷键说明', '展开面试面板', '展开转写面板', '打开麦克风', '打开系统音频'],
    );
    expect(html).not.toContain('或');
  }
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
