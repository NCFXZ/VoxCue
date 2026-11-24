import { afterEach, expect, it, vi } from 'vitest';
import type { UpdateState } from '../../electron/contracts/updates';
import { recordUpdateLaunch, releaseNotesUrl, saveUpdateNotice } from '../../src/services/updates';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

function storage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: vi.fn((key: string, value: string) => { values.set(key, value); }),
  };
}

it('first launch establishes a baseline; upgrades remain pending until dismissed, including after restart', () => {
  const saved = storage();
  expect(recordUpdateLaunch(saved, '1.3.2')).toBeNull();
  expect(recordUpdateLaunch(saved, '1.3.2')).toBeNull();
  expect(recordUpdateLaunch(saved, '1.3.3')).toBe('1.3.3');
  expect(recordUpdateLaunch(saved, '1.3.3')).toBe('1.3.3');
  saveUpdateNotice(saved, '1.3.3', false);
  expect(recordUpdateLaunch(saved, '1.3.3')).toBeNull();
  expect(recordUpdateLaunch(saved, '1.4.0')).toBe('1.4.0');
});

it('compares numeric release versions and keeps the newer baseline across downgrades and build metadata', () => {
  const saved = storage();
  recordUpdateLaunch(saved, '1.9.9');
  expect(recordUpdateLaunch(saved, '1.10.0')).toBe('1.10.0');
  saveUpdateNotice(saved, '1.10.0', false);
  expect(recordUpdateLaunch(saved, '1.9.9')).toBeNull();
  expect(recordUpdateLaunch(saved, '1.10.0+rebuild')).toBeNull();
  expect(recordUpdateLaunch(saved, '2.0.0')).toBe('2.0.0');
});

it('does not announce damaged preferences or invalid running versions as successful updates', () => {
  for (const raw of ['{', 'null', '{}', ' '.repeat(257), '{"version":"1.2.0","pending":"yes"}']) {
    const saved = { getItem: () => raw, setItem: vi.fn() };
    expect(recordUpdateLaunch(saved, '1.3.2')).toBeNull();
    expect(saved.setItem).toHaveBeenCalledOnce();
  }
  const saved = storage();
  for (const version of ['invalid', '1.3', '1.4.0-beta', '9007199254740992.0.0']) {
    expect(recordUpdateLaunch(saved, version)).toBeNull();
  }
  expect(saved.setItem).not.toHaveBeenCalled();
});

it('opens the language-specific changelog page without a version anchor', () => {
  expect(releaseNotesUrl('zh-CN')).toBe('https://voxcue.com.cn/changelog/');
  expect(releaseNotesUrl('en')).toBe('https://voxcue.com.cn/en/changelog/');
});

async function connect(saved: ReturnType<typeof storage>, currentVersion: string) {
  vi.resetModules();
  const state: UpdateState = {
    revision: 0, currentVersion, autoDownload: true, phase: 'idle', availableVersion: null,
    progress: null, lastCheckedAt: null, message: null, error: null, interviewActive: false,
  };
  let receive!: (event: UpdateState) => void;
  const unsubscribe = vi.fn();
  vi.stubGlobal('localStorage', saved);
  vi.stubGlobal('window', { desktop: {
    updates: vi.fn(async () => state),
    onUpdateEvent: (listener: typeof receive) => { receive = listener; return unsubscribe; },
  } });
  const { useUpdates } = await import('../../src/stores/updates');
  const disconnect = useUpdates.getState().connect();
  await vi.waitFor(() => expect(useUpdates.getState().state).not.toBeNull());
  return { useUpdates, disconnect, unsubscribe, send: (patch: Partial<UpdateState>) => receive({ ...state, ...patch }) };
}

it('download and install phases do not announce an update until the newer version actually starts', async () => {
  const saved = storage();
  const before = await connect(saved, '1.3.2');
  before.send({ revision: 1, phase: 'downloaded', availableVersion: '1.3.3', progress: 100 });
  before.send({ revision: 2, phase: 'installing', availableVersion: '1.3.3' });
  expect(before.useUpdates.getState().noticeVersion).toBeNull();
  before.disconnect();
  expect(before.unsubscribe).toHaveBeenCalledOnce();
  before.send({ revision: 3, currentVersion: '1.3.3' });
  expect(recordUpdateLaunch(saved, '1.3.2')).toBeNull();
  const after = await connect(saved, '1.3.3');
  expect(after.useUpdates.getState().noticeVersion).toBe('1.3.3');
  after.send({ revision: -1, currentVersion: '9.0.0' });
  expect(after.useUpdates.getState().state?.currentVersion).toBe('1.3.3');
  after.useUpdates.getState().dismissNotice();
  expect(after.useUpdates.getState().noticeVersion).toBeNull();
  after.disconnect();
  const restarted = await connect(saved, '1.3.3');
  expect(restarted.useUpdates.getState().noticeVersion).toBeNull();
  restarted.disconnect();
});

it('a failed dismissal save keeps the notice actionable and permits a successful retry', async () => {
  const saved = storage();
  recordUpdateLaunch(saved, '1.3.1');
  const { useUpdates, disconnect } = await connect(saved, '1.3.2');
  saved.setItem.mockImplementationOnce(() => { throw Error('storage unavailable'); });
  useUpdates.getState().dismissNotice();
  expect(useUpdates.getState()).toMatchObject({ noticeVersion: '1.3.2', noticeError: '无法保存提示设置，请重试。' });
  useUpdates.getState().dismissNotice();
  expect(useUpdates.getState()).toMatchObject({ noticeVersion: null, noticeError: null });
  expect(recordUpdateLaunch(saved, '1.3.2')).toBeNull();
  disconnect();
});
