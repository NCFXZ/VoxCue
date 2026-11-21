import { afterEach, expect, it, vi } from 'vitest';

// Each profile window starts a fresh renderer with its own persistent localStorage.
async function openProfile(values: Map<string, string>) {
  vi.resetModules();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
  vi.stubGlobal('window', new EventTarget());
  return import('../../src/services/localImportNotice');
}
afterEach(() => vi.unstubAllGlobals());

it('keeps an explicit dismissal for this profile across local edits, imports and relaunches', async () => {
  const a = new Map<string, string>();
  const b = new Map<string, string>();
  let notice = await openProfile(a);
  expect(notice.shouldShowLocalImport()).toBe(false);
  expect(notice.shouldShowLocalImport('first')).toBe(true);
  const changed = vi.fn();
  const unsubscribe = notice.subscribeLocalImport(changed);
  notice.dismissLocalImportNotice();
  expect(changed).toHaveBeenCalledOnce();
  unsubscribe();
  expect(notice.shouldShowLocalImport('first')).toBe(false);
  notice.markLocalImportHandled('second');
  expect(notice.shouldShowLocalImport('third')).toBe(false);
  notice = await openProfile(b);
  expect(notice.shouldShowLocalImport('third')).toBe(true);
  notice = await openProfile(a);
  expect(notice.shouldShowLocalImport('third')).toBe(false);
});

it('keeps an existing handled revision and can notify for later local edits', async () => {
  const profile = new Map([['voxcue-handled-local-import-v1', 'migrated']]);
  let notice = await openProfile(profile);
  expect(notice.shouldShowLocalImport('migrated')).toBe(false);
  expect(notice.shouldShowLocalImport('updated')).toBe(true);
  notice.markLocalImportHandled('updated');
  notice = await openProfile(profile);
  expect(notice.shouldShowLocalImport('updated')).toBe(false);
  expect(notice.shouldShowLocalImport('new')).toBe(true);
});
