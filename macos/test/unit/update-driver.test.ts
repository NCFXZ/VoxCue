import { it, expect, vi, afterEach, afterAll } from 'vitest';
import { generateKeyPairSync, sign, createHash, randomUUID } from 'node:crypto';
import { writeFile, readFile, access, mkdir, symlink, lstat } from 'node:fs/promises';
import path from 'node:path';
import { MacUpdateDriver } from '../../electron/updates/driver';
import { testRoot } from '../../../shared/test/scripts/test-workspace.mjs';
import { macUpdatePayload } from '../../electron/updates/manifest';
import { updateInterval } from '../../../shared/electron/backend/updates/cache';
const mocks = vi.hoisted(() => ({ fetch: vi.fn(), quit: vi.fn(), version: '0.2.1' }));
vi.mock('electron', () => ({
  app: { getVersion: () => mocks.version, quit: mocks.quit },
  net: { fetch: mocks.fetch },
}));
const drivers: MacUpdateDriver[] = [];
const system = (process as any).getSystemVersion;
(process as any).getSystemVersion = () => '26.0';
afterEach(async () => {
  await Promise.allSettled(drivers.splice(0).map((driver) => driver.dispose()));
  vi.restoreAllMocks();
  mocks.fetch.mockReset();
  mocks.quit.mockReset();
  mocks.version = '0.2.1';
});
afterAll(() => {
  (process as any).getSystemVersion = system;
});
function setup() {
  const pair = generateKeyPairSync('ed25519');
  const publicKey = Buffer.from(pair.publicKey.export({ format: 'jwk' }).x!, 'base64url').toString(
    'base64',
  );
  const bytes = Buffer.from('archive fixture');
  const update = {
    version: '0.2.2',
    url: 'VoxCue-0.2.2-arm64.zip',
    size: bytes.length,
    sha512: createHash('sha512').update(bytes).digest('base64'),
    edSignature: sign(null, bytes, pair.privateKey).toString('base64'),
    minimumSystemVersion: '14.2',
  };
  const metadata = {
    version: update.version,
    minimumSystemVersion: update.minimumSystemVersion,
    files: [
      {
        ...update,
        voxcueSignature: sign(null, macUpdatePayload(update), pair.privateKey).toString('base64'),
      },
    ],
  };
  const cache = path.join(testRoot, 'mac-update-' + randomUUID());
  const archive = path.join(cache, 'archives', update.url);
  const stateFile = path.join(cache, 'release-cache.json');
  const fetcher = async (url: string) => {
    if (url.startsWith('https://api.github.com/repos/NCFXZ/VoxCue-releases/releases?'))
      return new Response(
        JSON.stringify([
          {
            draft: false,
            prerelease: false,
            published_at: new Date(1_700_000_000_000).toISOString(),
            tag_name: 'v0.2.2',
            assets: [
              { name: 'latest-mac.yml', size: 1000, state: 'uploaded' },
              { name: update.url, size: bytes.length, state: 'uploaded' },
            ],
          },
        ]),
      );
    if (url.endsWith('/latest-mac.yml')) return new Response(JSON.stringify(metadata));
    expect(url).toBe(
      'https://github.com/NCFXZ/VoxCue-releases/releases/download/v0.2.2/' + update.url,
    );
    return new Response(bytes);
  };
  mocks.fetch.mockImplementation(fetcher);
  const create = (key = publicKey, directory = cache) => {
    let callback: (event: { type: string }) => void;
    const native = {
      begin: vi.fn((_url: string, cb: typeof callback) => {
        callback = cb;
      }),
      commit: vi.fn(),
      cancel: vi.fn(),
    };
    const driver = new MacUpdateDriver(key, native, directory);
    drivers.push(driver);
    driver.on('error', () => {});
    return { driver, native, event: (type: string) => callback({ type }) };
  };
  return { ...create(), create, cache, archive, stateFile, update, metadata, bytes, fetcher };
}
it('preserves an authenticated complete archive on ordinary and repeated quit without starting native installation', async () => {
  const f = setup();
  const ready = vi.fn();
  f.driver.on('update-downloaded', ready);
  await f.driver.checkForUpdates();
  await f.driver.downloadUpdate();
  expect(ready).toHaveBeenCalledOnce();
  expect(f.native.begin).not.toHaveBeenCalled();
  const disposing = f.driver.dispose();
  expect(f.driver.dispose()).toBe(disposing);
  await disposing;
  expect(f.native.cancel).toHaveBeenCalledOnce();
  expect(f.native.commit).not.toHaveBeenCalled();
  expect(await readFile(f.archive)).toEqual(f.bytes);
  expect((await lstat(f.archive)).mode & 0o077).toBe(0);
});
it('explicit install revalidates, commits only on native ready, and preserves committed installation during quit', async () => {
  const f = setup();
  await f.driver.checkForUpdates();
  await f.driver.downloadUpdate();
  f.driver.quitAndInstall();
  await vi.waitFor(() => expect(f.native.begin).toHaveBeenCalledOnce());
  expect(f.native.commit).not.toHaveBeenCalled();
  f.event('ready');
  expect(f.native.commit).toHaveBeenCalledOnce();
  f.event('quit');
  expect(mocks.quit).toHaveBeenCalledOnce();
  await f.driver.dispose();
  expect(f.native.cancel).not.toHaveBeenCalled();
  expect(await readFile(f.archive)).toEqual(f.bytes);
});
it('tampered downloaded cache cannot reach the installer and retains the current app', async () => {
  const f = setup();
  const error = vi.fn();
  f.driver.on('error', error);
  await f.driver.checkForUpdates();
  await f.driver.downloadUpdate();
  await writeFile(f.archive, Buffer.alloc(f.bytes.length));
  f.driver.quitAndInstall();
  await vi.waitFor(() => expect(error).toHaveBeenCalledOnce());
  expect(f.native.begin).not.toHaveBeenCalled();
  expect(mocks.quit).not.toHaveBeenCalled();
});
it('same-version/downgrade offers do not download or start native installation', async () => {
  const f = setup();
  mocks.version = '0.2.3';
  const none = vi.fn();
  f.driver.on('update-not-available', none);
  await f.driver.checkForUpdates();
  expect(none).toHaveBeenCalledOnce();
  await expect(f.driver.downloadUpdate()).rejects.toThrow();
  expect(f.native.begin).not.toHaveBeenCalled();
});
it('native rejection keeps the app running and surfaces a failure', async () => {
  const f = setup();
  const error = vi.fn();
  f.driver.on('error', error);
  await f.driver.checkForUpdates();
  await f.driver.downloadUpdate();
  f.driver.quitAndInstall();
  await vi.waitFor(() => expect(f.native.begin).toHaveBeenCalledOnce());
  f.event('error');
  expect(error).toHaveBeenCalledOnce();
  expect(mocks.quit).not.toHaveBeenCalled();
  expect(f.native.commit).not.toHaveBeenCalled();
});
it('persists hourly checks and original success time across restart and clock rollback, while force performs one real check', async () => {
  const f = setup();
  let now = 1_800_000_000_000;
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  await Promise.all([f.driver.checkForUpdates(), f.driver.checkForUpdates()]);
  expect(mocks.fetch).toHaveBeenCalledTimes(2);
  await f.driver.dispose();
  now -= 1000;
  const restart = f.create();
  await restart.driver.checkForUpdates();
  expect(mocks.fetch).toHaveBeenCalledTimes(2);
  expect(restart.driver.lastCheckedAt()).toBe(1_800_000_000_000);
  await restart.driver.checkForUpdates(true);
  expect(mocks.fetch).toHaveBeenCalledTimes(4);
  now += updateInterval;
  await restart.driver.checkForUpdates();
  expect(mocks.fetch).toHaveBeenCalledTimes(6);
});
it('persists failed attempts and refuses to reuse a previous verified offer after a failed forced check', async () => {
  const f = setup();
  await f.driver.checkForUpdates();
  mocks.fetch.mockRejectedValue(Error('offline'));
  await expect(f.driver.checkForUpdates(true)).rejects.toThrow('offline');
  await expect(f.driver.downloadUpdate()).rejects.toThrow('No newer verified update');
  const restart = f.create();
  const calls = mocks.fetch.mock.calls.length;
  await expect(restart.driver.checkForUpdates()).rejects.toThrow('hourly');
  expect(mocks.fetch).toHaveBeenCalledTimes(calls);
  expect(f.native.begin).not.toHaveBeenCalled();
});
it('restores a complete newer archive after the TTL with auto-download disabled and no network; force still checks remotely', async () => {
  const f = setup();
  let now = 1_800_000_000_000;
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  await f.driver.checkForUpdates();
  await f.driver.downloadUpdate();
  await f.driver.dispose();
  now += updateInterval + 1;
  mocks.fetch.mockClear();
  mocks.fetch.mockRejectedValue(Error('offline'));
  const restart = f.create();
  restart.driver.autoDownload = false;
  await restart.driver.checkForUpdates();
  expect(await restart.driver.restoreDownloadedUpdate()).toBe(true);
  expect(mocks.fetch).not.toHaveBeenCalled();
  expect(restart.native.begin).not.toHaveBeenCalled();
  expect(restart.driver.lastCheckedAt()).toBe(1_800_000_000_000);
  await expect(restart.driver.checkForUpdates(true)).rejects.toThrow('offline');
  expect(mocks.fetch).toHaveBeenCalledOnce();
});
it('a complete installed version does not block a new hourly remote check', async () => {
  const f = setup();
  let now = 1_800_000_000_000;
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  await f.driver.checkForUpdates();
  await f.driver.downloadUpdate();
  await f.driver.dispose();
  now += updateInterval;
  mocks.version = '0.2.2';
  mocks.fetch.mockClear();
  const restart = f.create();
  await restart.driver.checkForUpdates();
  expect(mocks.fetch).toHaveBeenCalledTimes(2);
  expect(await restart.driver.restoreDownloadedUpdate()).toBe(false);
});
it.each(['signature', 'platform', 'key', 'json', 'size', 'hash', 'link'])(
  'rejects %s cache tampering before network or native installation',
  async (mode) => {
    const f = setup();
    await f.driver.checkForUpdates();
    await f.driver.downloadUpdate();
    await f.driver.dispose();
    const state = JSON.parse(await readFile(f.stateFile, 'utf8'));
    let key: string | undefined;
    if (mode === 'signature')
      state.completed.files[0].voxcueSignature = Buffer.alloc(64).toString('base64');
    if (mode === 'platform') state.target = 'windows-x64';
    if (mode === 'key') key = Buffer.alloc(32).toString('base64');
    if (mode === 'size') await writeFile(f.archive, 'short');
    if (mode === 'hash') await writeFile(f.archive, Buffer.alloc(f.bytes.length));
    if (mode === 'link') {
      const fs = await import('node:fs/promises');
      await fs.rename(f.archive, f.archive + '.original');
      await symlink(f.archive + '.original', f.archive);
    }
    await writeFile(f.stateFile, mode === 'json' ? '{broken' : JSON.stringify(state));
    mocks.fetch.mockClear();
    const restart = f.create(key);
    await expect(restart.driver.checkForUpdates()).rejects.toThrow();
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(restart.native.begin).not.toHaveBeenCalled();
  },
);
it('aborting a stream waits for cancellation, removes its owned partial, retains unrelated files, and persists automatic cooldown', async () => {
  const f = setup();
  await f.driver.checkForUpdates();
  const cancelled = vi.fn();
  mocks.fetch.mockImplementationOnce(
    async () =>
      new Response(
        new ReadableStream({
          start(c) {
            c.enqueue(new Uint8Array([1]));
          },
          cancel: cancelled,
        }),
      ),
  );
  const controller = new AbortController();
  const ready = vi.fn();
  f.driver.on('update-downloaded', ready);
  const outcome = f.driver.downloadUpdate(controller.signal).catch((error: Error) => error);
  await vi.waitFor(async () => expect((await readFile(f.archive + '.partial')).length).toBe(1));
  const keep = path.join(f.cache, 'archives', 'keep.txt');
  await writeFile(keep, 'unrelated');
  controller.abort();
  expect((await outcome).name).toBe('AbortError');
  await expect(access(f.archive + '.partial')).rejects.toThrow();
  expect(cancelled).toHaveBeenCalledOnce();
  expect(ready).not.toHaveBeenCalled();
  expect(await readFile(keep, 'utf8')).toBe('unrelated');
  const restart = f.create();
  expect(restart.driver.isAutomaticDownloadAllowed()).toBe(false);
  await restart.driver.checkForUpdates();
  mocks.fetch.mockImplementation(f.fetcher);
  await restart.driver.downloadUpdate();
  expect(await readFile(f.archive)).toEqual(f.bytes);
  await restart.driver.checkForUpdates(true);
  expect(restart.driver.isAutomaticDownloadAllowed()).toBe(true);
});
it('a crash journal cleans only its partial and imposes a fresh cooldown on restart', async () => {
  const f = setup();
  await f.driver.checkForUpdates();
  await f.driver.dispose();
  const state = JSON.parse(await readFile(f.stateFile, 'utf8'));
  state.download = state.info;
  await writeFile(f.stateFile, JSON.stringify(state));
  await writeFile(f.archive + '.partial', 'unfinished');
  const restart = f.create();
  await restart.driver.checkForUpdates();
  await expect(access(f.archive + '.partial')).rejects.toThrow();
  expect(restart.driver.isAutomaticDownloadAllowed()).toBe(false);
  expect(JSON.parse(await readFile(f.stateFile, 'utf8')).download).toBeUndefined();
});
it('dispose aborts and waits for an active read without late events, and repeated calls share one barrier', async () => {
  const f = setup();
  await f.driver.checkForUpdates();
  const cancelled = vi.fn();
  mocks.fetch.mockImplementationOnce(
    async () =>
      new Response(
        new ReadableStream({
          start(c) {
            c.enqueue(new Uint8Array([1]));
          },
          cancel: cancelled,
        }),
      ),
  );
  const ready = vi.fn();
  f.driver.on('update-downloaded', ready);
  const outcome = f.driver.downloadUpdate().catch((error: Error) => error);
  await vi.waitFor(async () => expect((await readFile(f.archive + '.partial')).length).toBe(1));
  const disposal = f.driver.dispose();
  expect(f.driver.dispose()).toBe(disposal);
  await disposal;
  expect((await outcome).name).toBe('AbortError');
  expect(cancelled).toHaveBeenCalledOnce();
  expect(ready).not.toHaveBeenCalled();
  await expect(access(f.archive + '.partial')).rejects.toThrow();
  expect(f.create().driver.isAutomaticDownloadAllowed()).toBe(false);
});
it('preserves an unknown cleanup directory and its journal when an interrupted transfer cannot be safely removed', async () => {
  const f = setup();
  await f.driver.checkForUpdates();
  await f.driver.dispose();
  const state = JSON.parse(await readFile(f.stateFile, 'utf8'));
  state.download = state.info;
  await writeFile(f.stateFile, JSON.stringify(state));
  await mkdir(f.archive + '.partial');
  await writeFile(path.join(f.archive + '.partial', 'keep.txt'), 'unknown');
  const restart = f.create();
  await expect(restart.driver.checkForUpdates()).rejects.toThrow('Unsafe partial');
  expect(JSON.parse(await readFile(f.stateFile, 'utf8')).download.version).toBe('0.2.2');
  expect(await readFile(path.join(f.archive + '.partial', 'keep.txt'), 'utf8')).toBe('unknown');
});

it('cleans ordinary checksum failures durably without imposing an interruption cooldown', async () => {
  const f = setup();
  await f.driver.checkForUpdates();
  mocks.fetch.mockImplementationOnce(async () => new Response(Buffer.alloc(f.bytes.length)));
  await expect(f.driver.downloadUpdate()).rejects.toThrow('checksum');
  await expect(access(f.archive + '.partial')).rejects.toThrow();
  await expect(access(f.archive)).rejects.toThrow();
  const state = JSON.parse(await readFile(f.stateFile, 'utf8'));
  expect(state.download).toBeUndefined();
  expect(state.notBefore).toBe(0);
  expect(f.create().driver.isAutomaticDownloadAllowed()).toBe(true);
});
it('cleans an interrupted journal even when its final ordinary file has an invalid size or digest', async () => {
  const f = setup();
  await f.driver.checkForUpdates();
  const controller = new AbortController();
  mocks.fetch.mockImplementationOnce(
    async () =>
      new Response(
        new ReadableStream({
          start(c) {
            c.enqueue(new Uint8Array([1]));
          },
        }),
      ),
  );
  const outcome = f.driver.downloadUpdate(controller.signal).catch((error: Error) => error);
  await vi.waitFor(async () => expect((await readFile(f.archive + '.partial')).length).toBe(1));
  await writeFile(f.archive, 'incomplete final');
  controller.abort();
  expect((await outcome).name).toBe('AbortError');
  await expect(access(f.archive + '.partial')).rejects.toThrow();
  await expect(access(f.archive)).rejects.toThrow();
  const state = JSON.parse(await readFile(f.stateFile, 'utf8'));
  expect(state.download).toBeUndefined();
  expect(state.notBefore).toBeGreaterThan(Date.now());
});

it('disposal aborts an active release read and persists its failed-attempt limit without late availability', async () => {
  const f = setup();
  const cancelled = vi.fn();
  mocks.fetch.mockImplementationOnce(
    async () => new Response(new ReadableStream({ cancel: cancelled })),
  );
  const available = vi.fn();
  f.driver.on('update-available', available);
  const outcome = f.driver.checkForUpdates().catch((error: Error) => error);
  await vi.waitFor(() => expect(mocks.fetch).toHaveBeenCalledOnce());
  await f.driver.dispose();
  expect((await outcome).name).toBe('AbortError');
  expect(cancelled).toHaveBeenCalledOnce();
  expect(available).not.toHaveBeenCalled();
  const restart = f.create();
  await expect(restart.driver.checkForUpdates()).rejects.toThrow('hourly');
  expect(mocks.fetch).toHaveBeenCalledOnce();
});
it('aborted local restoration does not start native installation or discard a complete archive', async () => {
  const f = setup();
  await f.driver.checkForUpdates();
  await f.driver.downloadUpdate();
  const controller = new AbortController();
  controller.abort();
  await expect(f.driver.restoreDownloadedUpdate(controller.signal)).rejects.toMatchObject({
    name: 'AbortError',
  });
  expect(f.native.begin).not.toHaveBeenCalled();
  expect(await readFile(f.archive)).toEqual(f.bytes);
});

it('recovers a crash after archive publication without deleting the complete signed download or imposing cooldown', async () => {
  const f = setup();
  await f.driver.checkForUpdates();
  await f.driver.dispose();
  const state = JSON.parse(await readFile(f.stateFile, 'utf8'));
  state.download = state.info;
  await writeFile(f.stateFile, JSON.stringify(state));
  await writeFile(f.archive, f.bytes);
  mocks.fetch.mockClear();
  const restart = f.create();
  await restart.driver.checkForUpdates();
  expect(await restart.driver.restoreDownloadedUpdate()).toBe(true);
  expect(mocks.fetch).not.toHaveBeenCalled();
  expect(await readFile(f.archive)).toEqual(f.bytes);
  const recovered = JSON.parse(await readFile(f.stateFile, 'utf8'));
  expect(recovered.download).toBeUndefined();
  expect(recovered.completed.version).toBe('0.2.2');
  expect(recovered.notBefore).toBe(0);
});
