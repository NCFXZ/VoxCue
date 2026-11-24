import { afterEach, expect, it, vi } from 'vitest';
import { AnnouncementService, announcementsUrl } from '../../electron/backend/announcements';
import { announcementApplies, announcementText, parseAnnouncementFeed } from '../../electron/contracts/announcements';

const notice = (patch: Record<string, unknown> = {}) => ({
  id: 'synthetic-notice', title: { 'zh-CN': '合成公告', en: 'Synthetic announcement' },
  subtitle: 'Synthetic content', expiresAt: '2030-01-01T00:00:00Z', ...patch,
});
const feed = (items = [notice()]) => ({ schemaVersion: 1, announcements: items });
const response = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json; charset=utf-8' } });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it.each([
  ['lt', '1.3.2', true], ['lt', '1.3.3', false], ['lt', '1.3.4', false],
  ['gt', '1.3.2', false], ['gt', '1.3.3', false], ['gt', '1.3.4', true],
  ['eq', '1.3.2', false], ['eq', '1.3.3', true], ['eq', '1.3.3+build.2', true],
  ['lt', '1.10.0', false], ['gt', '1.10.0', true],
])('filters %s around 1.3.3 using numeric versions: %s', (type, version, expected) => {
  const [item] = parseAnnouncementFeed(feed([notice({ versionFilter: { type, version: '1.3.3' } })]));
  expect(announcementApplies(item, version, false, Date.parse('2026-11-23T00:00:00Z'))).toBe(expected);
});

it('combines version, main-account audience and expiry; expiry is exclusive', () => {
  const [item] = parseAnnouncementFeed(feed([notice({ audience: 'signed-in', versionFilter: { type: 'lt', version: '1.3.3' } })]));
  expect(announcementApplies(item, '1.3.2', true, item.expiresAt - 1)).toBe(true);
  expect(announcementApplies(item, '1.3.2', false, item.expiresAt - 1)).toBe(false);
  expect(announcementApplies(item, '1.3.3', true, item.expiresAt - 1)).toBe(false);
  expect(announcementApplies(item, '1.3.2', true, item.expiresAt)).toBe(false);
  const [local] = parseAnnouncementFeed(feed([notice({ audience: 'signed-out' })]));
  expect(announcementApplies(local, '1.3.2', false, local.expiresAt - 1)).toBe(true);
  expect(announcementApplies(local, '1.3.2', true, local.expiresAt - 1)).toBe(false);
});

it('accepts plain or bilingual copy and only predefined navigation or HTTPS button actions', () => {
  const [item] = parseAnnouncementFeed(feed([notice({ button: {
    label: { 'zh-CN': '查看教程', en: 'Read guide' }, action: { type: 'url', url: { 'zh-CN': 'https://voxcue.com.cn/', en: 'https://voxcue.com.cn/en/' } },
  } })]));
  expect(announcementText(item.title, 'en')).toBe('Synthetic announcement');
  expect(announcementText(item.subtitle, 'en')).toBe('Synthetic content');
  const [navigate] = parseAnnouncementFeed(feed([notice({ button: { label: '设置', action: { type: 'navigate', target: 'speech-model' } } })]));
  expect(navigate.button?.action).toEqual({ type: 'navigate', target: 'speech-model' });
  expect(parseAnnouncementFeed(feed([]))).toEqual([]);
});

it.each(['external-link', 'settings', 'document', 'list', 'download', 'none'])('accepts the predefined button icon %s', icon => {
  const [item] = parseAnnouncementFeed(feed([notice({ button: { label: 'Open', icon, action: { type: 'navigate', target: 'ai' } } })]));
  expect(item.button?.icon).toBe(icon);
});

it.each([
  { id: '../private' }, { expiresAt: 'tomorrow' }, { expiresAt: '2030-01-01T00:00:00' },
  { title: { 'zh-CN': '仅中文' } }, { title: { 'zh-CN': { 'zh-CN': 'nested', en: 'nested' }, en: 'value' } },
  { subtitle: 'x'.repeat(601) }, { audience: 'chatgpt' }, { execute: 'forbidden' },
  { audience: null }, { versionFilter: null },
  { versionFilter: { type: 'lt', version: '1.3.3-beta' } }, { versionFilter: { type: 'all', version: '1.3.3' } },
  { button: { label: 'Open', action: { type: 'url', url: 'javascript:alert(1)' } } },
  { button: { label: 'Open', action: { type: 'url', url: 'https://name:password@example.test/' } } },
  { button: { label: 'Open', action: { type: 'navigate', target: 'execute' } } },
  { button: { label: 'Open', icon: '<svg/>', action: { type: 'navigate', target: 'ai' } } },
])('rejects malformed or unsupported configuration: %j', patch => {
  expect(() => parseAnnouncementFeed(feed([notice(patch)]))).toThrow();
});

it('rejects duplicates, unknown feed schemas and oversized lists', () => {
  expect(() => parseAnnouncementFeed(feed([notice(), notice()]))).toThrow();
  expect(() => parseAnnouncementFeed({ schemaVersion: 2, announcements: [] })).toThrow();
  expect(() => parseAnnouncementFeed(feed(Array.from({ length: 21 }, (_, index) => notice({ id: 'n' + index }))))).toThrow();
});

it('shares an anonymous bounded request and rechecks audience and expiry on cached reads', async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-23T00:00:00Z'));
  const fetcher = vi.fn<typeof fetch>(async () => response(feed([
    notice({ id: 'signed', audience: 'signed-in' }), notice({ id: 'local', audience: 'signed-out', expiresAt: '2026-11-23T00:00:02Z' }),
  ])));
  const service = new AnnouncementService('1.3.2', fetcher);
  const [signed, local] = await Promise.all([service.read(true), service.read(false)]);
  expect(signed).toMatchObject({ ok: true, announcements: [{ id: 'signed' }] });
  expect(local).toMatchObject({ ok: true, announcements: [{ id: 'local' }] });
  expect(fetcher).toHaveBeenCalledOnce();
  expect(fetcher).toHaveBeenCalledWith(announcementsUrl, expect.objectContaining({ credentials: 'omit', redirect: 'error' }));
  vi.setSystemTime(new Date('2026-11-23T00:00:03Z'));
  expect(await service.read(false)).toEqual({ ok: true, announcements: [] });
  expect(fetcher).toHaveBeenCalledOnce();
  service.dispose();
});

it('withdraws announcements after a newer empty feed and reports transport/configuration failures', async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-23T00:00:00Z'));
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(response(feed())).mockResolvedValueOnce(response(feed([])));
  const service = new AnnouncementService('1.3.2', fetcher);
  expect(await service.read(false)).toMatchObject({ ok: true, announcements: [{ id: 'synthetic-notice' }] });
  vi.advanceTimersByTime(10 * 60_000);
  expect(await service.read(false)).toEqual({ ok: true, announcements: [] });
  service.dispose();
  for (const value of [new Response('missing', { status: 404 }), new Response('<html>fallback</html>'), response({ schemaVersion: 2 }),
    new Response(' '.repeat(65 * 1024), { headers: { 'content-type': 'application/json' } })]) {
    const failed = new AnnouncementService('1.3.2', vi.fn<typeof fetch>(async () => value));
    expect(await failed.read(false)).toEqual({ ok: false, error: '无法读取公告，请稍后重试。' });
    failed.dispose();
  }
});

it('times out a stalled request and aborts pending work on application shutdown', async () => {
  vi.useFakeTimers();
  // Node's native AbortSignal.timeout uses internal timers outside the fake clock.
  vi.spyOn(AbortSignal, 'timeout').mockImplementation(delay => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(new DOMException('Timed out', 'TimeoutError')), delay);
    return controller.signal;
  });
  const fetcher = vi.fn<typeof fetch>(() => new Promise(() => {}));
  const service = new AnnouncementService('1.3.2', fetcher);
  const pending = service.read(false);
  await vi.advanceTimersByTimeAsync(8001);
  expect(await pending).toMatchObject({ ok: false });
  service.dispose();
  const shutdown = new AnnouncementService('1.3.2', fetcher);
  const stopped = shutdown.read(false);
  shutdown.dispose();
  expect(await stopped).toMatchObject({ ok: false });
  expect(await shutdown.read(false)).toMatchObject({ ok: false });
});
