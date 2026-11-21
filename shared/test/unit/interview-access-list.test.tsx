import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { InterviewAccessList } from '../../src/components/InterviewAccessList';
import { useGeneralSettings } from '../../src/stores/generalSettings';

beforeEach(() => {
  useGeneralSettings.setState({ language: 'zh-CN' });
  vi.stubGlobal('window', {
    desktop: { platform: 'windows', screenCapturePermissionSupported: true },
  });
});
afterEach(() => vi.unstubAllGlobals());

it('keeps all five checks when the access request fails before returning any results', () => {
  const html = renderToStaticMarkup(
    <InterviewAccessList checking={false} sources={['microphone', 'system']} report={null} />,
  );
  expect(html.match(/<li\b/g)).toHaveLength(5);
  expect(html.match(/待确认/g)).toHaveLength(3);
  for (const label of ['麦克风', '系统音频', '屏幕截图', '远程连接', '快捷键'])
    expect(html).toContain(label);
});

it('shows each result independently when a device is denied and another input is disabled', () => {
  const html = renderToStaticMarkup(
    <InterviewAccessList
      checking={false}
      sources={['system']}
      report={{
        ready: false,
        devices: [],
        checks: [{ source: 'system', status: 'denied', message: '音频访问被拒绝' }],
        screenCapture: { status: 'not-required', message: '' },
      }}
    />,
  );
  expect(html.match(/<li\b/g)).toHaveLength(5);
  expect(html).toContain('未启用');
  expect(html).toContain('未授权');
  expect(html).toContain('音频访问被拒绝');
  expect(html).toContain('无需单独授权');
});
