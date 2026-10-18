import { it, expect, vi, afterEach, afterAll } from 'vitest';
import { generateKeyPairSync, sign, createHash } from 'node:crypto';
import { writeFile, access } from 'node:fs/promises';
import { MacUpdateDriver } from '../../electron/updates/driver';
import os from 'node:os';
import { testRoot } from '../../../shared/test/scripts/test-workspace.mjs';
import { macUpdatePayload } from '../../electron/updates/manifest';
const mocks = vi.hoisted(() => ({ fetch: vi.fn(), quit: vi.fn(), version: '0.2.1' }));
vi.mock('electron', () => ({
  app: { getVersion: () => mocks.version, quit: mocks.quit },
  net: { fetch: mocks.fetch },
}));
const drivers: MacUpdateDriver[] = [];
const temporary = vi.spyOn(os, 'tmpdir').mockReturnValue(testRoot);
const system = (process as any).getSystemVersion;
(process as any).getSystemVersion = () => '26.0';
afterEach(async () => {
  for (const driver of drivers.splice(0)) {
    const directory = (driver as any).directory;
    driver.dispose();
    if (directory)
      await vi.waitFor(async () => {
        await expect(access(directory)).rejects.toThrow();
      });
  }
  mocks.fetch.mockReset();
  mocks.quit.mockReset();
  mocks.version = '0.2.1';
});
afterAll(() => {
  temporary.mockRestore();
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
  mocks.fetch.mockImplementation(async (url: string) => {
    if (url.startsWith('https://api.github.com/repos/NCFXZ/VoxCue-releases/releases?'))
      return new Response(
        JSON.stringify([
          {
            draft: false,
            prerelease: false,
            published_at: new Date().toISOString(),
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
  });
  let callback: (event: { type: string }) => void;
  const native = {
    begin: vi.fn((_url: string, cb: typeof callback) => {
      callback = cb;
    }),
    commit: vi.fn(),
    cancel: vi.fn(),
  };
  const driver = new MacUpdateDriver(publicKey, native);
  drivers.push(driver);
  driver.on('error', () => {});
  return { driver, native, event: (type: string) => callback({ type }) };
}
it('authenticated download never starts native installation on an ordinary quit', async () => {
  const { driver, native } = setup();
  const ready = vi.fn();
  driver.on('update-downloaded', ready);
  await driver.checkForUpdates();
  await driver.downloadUpdate();
  expect(ready).toHaveBeenCalledOnce();
  expect(native.begin).not.toHaveBeenCalled();
  driver.dispose();
  expect(native.cancel).toHaveBeenCalledOnce();
  expect(native.commit).not.toHaveBeenCalled();
});
it('explicit install revalidates, commits only on native ready, and preserves committed installation during quit', async () => {
  const { driver, native, event } = setup();
  await driver.checkForUpdates();
  await driver.downloadUpdate();
  driver.quitAndInstall();
  await vi.waitFor(() => expect(native.begin).toHaveBeenCalledOnce());
  expect(native.commit).not.toHaveBeenCalled();
  event('ready');
  expect(native.commit).toHaveBeenCalledOnce();
  event('quit');
  expect(mocks.quit).toHaveBeenCalledOnce();
  driver.dispose();
  expect(native.cancel).not.toHaveBeenCalled();
});
it('tampered downloaded cache cannot reach the installer and retains the current app', async () => {
  const { driver, native } = setup();
  const error = vi.fn();
  driver.on('error', error);
  await driver.checkForUpdates();
  await driver.downloadUpdate();
  await writeFile((driver as any).archive, 'tampered');
  driver.quitAndInstall();
  await vi.waitFor(() => expect(error).toHaveBeenCalledOnce());
  expect(native.begin).not.toHaveBeenCalled();
  expect(mocks.quit).not.toHaveBeenCalled();
});
it('same-version/downgrade offers do not download or start native installation', async () => {
  const { driver, native } = setup();
  mocks.version = '0.2.3';
  const none = vi.fn();
  driver.on('update-not-available', none);
  await driver.checkForUpdates();
  expect(none).toHaveBeenCalledOnce();
  await expect(driver.downloadUpdate()).rejects.toThrow();
  expect(native.begin).not.toHaveBeenCalled();
});
it('native rejection keeps the app running and surfaces a failure', async () => {
  const { driver, native, event } = setup();
  const error = vi.fn();
  driver.on('error', error);
  await driver.checkForUpdates();
  await driver.downloadUpdate();
  driver.quitAndInstall();
  await vi.waitFor(() => expect(native.begin).toHaveBeenCalledOnce());
  event('error');
  expect(error).toHaveBeenCalledOnce();
  expect(mocks.quit).not.toHaveBeenCalled();
  expect(native.commit).not.toHaveBeenCalled();
});

it('a failed newer check cannot reuse a previously authenticated older offer', async () => {
  const { driver, native } = setup();
  await driver.checkForUpdates();
  mocks.fetch.mockRejectedValue(Error('new manifest unavailable'));
  await expect(driver.checkForUpdates()).rejects.toThrow();
  await expect(driver.downloadUpdate()).rejects.toThrow('No newer verified update');
  expect(native.begin).not.toHaveBeenCalled();
});

it('aborting a download removes its temporary archive and preserves the verified offer for retry', async () => {
  const { driver, native } = setup();
  await driver.checkForUpdates();
  const fetch = mocks.fetch.getMockImplementation()!;
  const cancelled = vi.fn();
  mocks.fetch.mockImplementationOnce(
    async () => new Response(new ReadableStream({ cancel: cancelled })),
  );
  const controller = new AbortController();
  const ready = vi.fn();
  driver.on('update-downloaded', ready);
  const pending = driver.downloadUpdate(controller.signal);
  // Attach the rejection handler before aborting the blocked stream.
  const rejected = expect(pending).rejects.toThrow();
  await vi.waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(3));
  const directory = (driver as any).directory;
  controller.abort();
  await rejected;
  await expect(access(directory)).rejects.toThrow();
  expect(cancelled).toHaveBeenCalledOnce();
  expect(ready).not.toHaveBeenCalled();
  expect(native.begin).not.toHaveBeenCalled();
  mocks.fetch.mockImplementation(fetch);
  await driver.downloadUpdate();
  expect(ready).toHaveBeenCalledOnce();
});
