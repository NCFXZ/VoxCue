import { afterEach, expect, it, vi } from 'vitest';
import { parseAnnouncementFeed, type AnnouncementsResult } from '../../electron/contracts/announcements';

const disconnects: Array<() => void> = [];
afterEach(() => { disconnects.splice(0).forEach(stop => stop()); vi.useRealTimers(); vi.unstubAllGlobals(); vi.resetModules(); });
const items = (id = 'synthetic-notice', expiresAt = '2030-01-01T00:00:00Z') => parseAnnouncementFeed({ schemaVersion: 1,
  announcements: [{ id, title: 'Synthetic', subtitle: 'Owned local data', expiresAt }] });
function storage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null,
    setItem: vi.fn((key: string, value: string) => { values.set(key, value); }) };
}
async function connect(saved: ReturnType<typeof storage>, read = vi.fn(async (): Promise<AnnouncementsResult> => ({ ok: true, announcements: items() }))) {
  vi.resetModules();
  vi.stubGlobal('localStorage', saved);
  vi.stubGlobal('window', { desktop: { announcements: read }, addEventListener: vi.fn(), removeEventListener: vi.fn() });
  const { useAnnouncements } = await import('../../src/stores/announcements');
  const stop = useAnnouncements.getState().connect();
  disconnects.push(stop);
  return { store: useAnnouncements, stop, read };
}

it('counts one X per launch; the third X permanently hides only the same announcement ID', async () => {
  const saved = storage();
  for (let count = 1; count <= 3; count++) {
    const current = await connect(saved);
    await current.store.getState().refresh();
    expect(current.store.getState().items).toHaveLength(1);
    current.store.getState().dismiss('synthetic-notice');
    current.store.getState().dismiss('synthetic-notice');
    expect(current.store.getState().items).toEqual([]);
    await current.store.getState().refresh();
    expect(current.store.getState().items).toEqual([]);
    expect(JSON.parse(saved.setItem.mock.lastCall![1])).toEqual({ 'synthetic-notice': count });
    current.stop();
  }
  const restarted = await connect(saved);
  await restarted.store.getState().refresh();
  expect(restarted.store.getState().items).toEqual([]);
  restarted.read.mockResolvedValue({ ok: true, announcements: items('new-announcement') });
  await restarted.store.getState().refresh();
  expect(restarted.store.getState().items[0]?.id).toBe('new-announcement');
});

it('Don\'t show again immediately persists three dismissals, with an explicit retry if storage fails', async () => {
  const saved = storage();
  const current = await connect(saved);
  await current.store.getState().refresh();
  saved.setItem.mockImplementationOnce(() => { throw Error('quota'); });
  current.store.getState().dismiss('synthetic-notice', true);
  expect(current.store.getState().items).toHaveLength(1);
  expect(current.store.getState().error).toBe('无法保存公告设置，请重试。');
  current.store.getState().dismiss('synthetic-notice', true);
  current.stop();
  const restarted = await connect(saved);
  await restarted.store.getState().refresh();
  expect(restarted.store.getState().items).toEqual([]);
});

it('removes an expired notice without another network request while the page remains open', async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-23T00:00:00Z'));
  const read = vi.fn(async (): Promise<AnnouncementsResult> => ({ ok: true, announcements: items('expiring', '2026-11-23T00:00:02Z') }));
  const { store } = await connect(storage(), read);
  await store.getState().refresh();
  expect(store.getState().items).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(2001);
  expect(store.getState().items).toEqual([]);
  expect(read).toHaveBeenCalledOnce();
});

it('drops a late result after profile cleanup and isolates the next owner\'s preferences', async () => {
  let release!: (value: AnnouncementsResult) => void;
  const read = vi.fn(() => new Promise<AnnouncementsResult>(resolve => { release = resolve; }));
  const old = await connect(storage(), read);
  old.stop();
  release({ ok: true, announcements: items() });
  await Promise.resolve(); await Promise.resolve();
  expect(old.store.getState().items).toEqual([]);
  const next = await connect(storage());
  await next.store.getState().refresh();
  expect(next.store.getState().items).toHaveLength(1);
  next.store.getState().dismiss('synthetic-notice', true);
  const separateOwner = await connect(storage());
  await separateOwner.store.getState().refresh();
  expect(separateOwner.store.getState().items).toHaveLength(1);
});
