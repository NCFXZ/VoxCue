import { afterEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseAnnouncementFeed, type Announcement } from '../../electron/contracts/announcements';
const fixture = vi.hoisted(() => ({ items: [] as Announcement[], error: null as string | null,
  noticeVersion: null as string | null, dismiss: () => {} }));
vi.mock('../../src/stores/announcements', () => ({ useAnnouncements: (select: (state: typeof fixture) => unknown) => select(fixture) }));
vi.mock('../../src/stores/updates', () => ({ useUpdates: (select: (state: typeof fixture) => unknown) => select(fixture) }));
import { AnnouncementNotice } from '../../src/components/AnnouncementNotice';
import { useGeneralSettings } from '../../src/stores/generalSettings';

afterEach(() => { fixture.items = []; fixture.error = null; fixture.noticeVersion = null; useGeneralSettings.setState({ language: 'zh-CN' }); });
function populate(icon?: string) {
  const items = parseAnnouncementFeed({ schemaVersion: 1, announcements: [{ id: 'synthetic',
    title: { 'zh-CN': '<标题>', en: '<Title>' }, subtitle: { 'zh-CN': '中文说明', en: 'English description' },
    expiresAt: '2030-01-01T00:00:00Z', ...(icon ? { button: { label: 'Action', icon, action: { type: 'navigate', target: 'ai' } } } : {}),
  }] });
  fixture.items = items;
  return () => renderToStaticMarkup(<AnnouncementNotice onNavigate={() => {}} />);
}

it.each(['zh-CN', 'en'] as const)('uses remote localized text and real dismiss buttons without interpreting HTML: %s', language => {
  useGeneralSettings.setState({ language });
  const html = populate()();
  expect(html).toContain(language === 'en' ? '&lt;Title&gt;' : '&lt;标题&gt;');
  expect(html).toContain(language === 'en' ? 'English description' : '中文说明');
  expect(html).not.toContain('<Title>');
  expect(html.match(/<button/g)).toHaveLength(2);
  expect(html).toContain(language === 'en' ? 'Dismiss announcement' : '关闭公告');
  expect(html).toContain(language === 'en' ? 'show again' : '不再显示');
});

it.each(['settings', 'document', 'list', 'download', 'external-link', 'none'])('positions the selected button icon: %s', icon => {
  const html = populate(icon)();
  const action = html.slice(html.indexOf('<button'), html.indexOf('</button>'));
  if (icon === 'none') expect(action).not.toContain('<svg');
  else if (icon === 'external-link') expect(action.indexOf('Action')).toBeLessThan(action.indexOf('<svg'));
  else expect(action.indexOf('<svg')).toBeLessThan(action.indexOf('Action'));
});

it('queues announcements while the update-complete notice is visible', () => {
  const render = populate();
  fixture.noticeVersion = '1.3.2';
  expect(render()).toBe('');
});
