import { it, expect, afterEach, vi } from 'vitest';
import { generateKeyPairSync, sign, createHash } from 'node:crypto';
import { mkdtemp, rm, readFile, writeFile, lstat } from 'node:fs/promises';
import path from 'node:path';
import { testRoot } from '../../../shared/test/scripts/test-workspace.mjs';
import { get } from 'node:http';
import { createReadStream } from 'node:fs';
vi.mock('node:fs', async (original) => {
  const fs = await original<typeof import('node:fs')>();
  return { ...fs, createReadStream: vi.fn(fs.createReadStream) };
});
import { signedMacUpdate, macUpdatePayload } from '../../electron/updates/manifest';
import { downloadArchive, verifyDownload } from '../../electron/updates/download';
import { installFeed } from '../../electron/updates/install-feed';
import type { ReleaseCandidate } from '../../../shared/electron/backend/updates/releases';
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function temp() {
  const root = await mkdtemp(path.join(testRoot, 'mac-update-'));
  roots.push(root);
  return root;
}
function fixture() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const key = Buffer.from(publicKey.export({ format: 'jwk' }).x!, 'base64url').toString('base64');
  const bytes = Buffer.from('authenticated archive fixture');
  const candidate: ReleaseCandidate = {
    version: '0.2.2',
    tag: 'v0.2.2',
    publishedAt: Date.now(),
    manifest: 'latest-mac.yml',
    binary: { name: 'VoxCue-0.2.2-arm64.zip', size: bytes.length },
  };
  const update = {
    version: candidate.version,
    minimumSystemVersion: '14.2',
    url: candidate.binary.name,
    size: bytes.length,
    sha512: createHash('sha512').update(bytes).digest('base64'),
    edSignature: sign(null, bytes, privateKey).toString('base64'),
  };
  const metadata = {
    version: update.version,
    minimumSystemVersion: update.minimumSystemVersion,
    files: [
      {
        ...update,
        voxcueSignature: sign(null, macUpdatePayload(update), privateKey).toString('base64'),
      },
    ],
  };
  return { key, bytes, candidate, update, metadata };
}
it('accepts the pinned Ed25519 manifest and authenticates every installation field', () => {
  const f = fixture();
  expect(signedMacUpdate(f.metadata, f.candidate, f.key)).toEqual(f.update);
  const mutations = [
    (m: any) => (m.files[0].sha512 = Buffer.alloc(64).toString('base64')),
    (m: any) => (m.files[0].edSignature = Buffer.alloc(64).toString('base64')),
    (m: any) => (m.minimumSystemVersion = '14.3'),
    (m: any) => (m.files[0].voxcueSignature = Buffer.alloc(64).toString('base64')),
    (m: any) => (m.files[0].url = 'https://attacker.invalid/update.zip'),
    (m: any) => m.files.push(m.files[0]),
    (m: any) => (m.version = '0.2.3'),
  ];
  for (const mutate of mutations) {
    const m = structuredClone(f.metadata);
    mutate(m);
    expect(() => signedMacUpdate(m, f.candidate, f.key)).toThrow();
  }
  expect(() => signedMacUpdate(f.metadata, f.candidate, fixture().key)).toThrow();
  expect(() =>
    signedMacUpdate(f.metadata, { ...f.candidate, manifest: 'latest.yml' }, f.key),
  ).toThrow();
});
it('streams a verified download, reports progress, keeps cache private and catches local tampering', async () => {
  const f = fixture(),
    file = path.join(await temp(), 'update.zip');
  const progress = vi.fn();
  await downloadArchive(
    new URL('https://github.com/fixture'),
    file,
    f.update,
    new AbortController().signal,
    async () => new Response(f.bytes),
    progress,
  );
  expect(await readFile(file)).toEqual(f.bytes);
  expect((await lstat(file)).mode & 0o077).toBe(0);
  expect(progress).toHaveBeenLastCalledWith(100);
  await writeFile(file, Buffer.alloc(f.bytes.length));
  await expect(verifyDownload(file, f.update)).rejects.toThrow('checksum');
});
it.each(['truncated', 'oversized', 'wrong-hash', 'length', 'http', 'cancelled'])(
  'rejects %s download without marking it ready',
  async (mode) => {
    const f = fixture(),
      file = path.join(await temp(), 'update.zip');
    const controller = new AbortController();
    if (mode === 'cancelled') controller.abort();
    const bytes =
      mode === 'truncated'
        ? f.bytes.subarray(1)
        : mode === 'oversized'
          ? Buffer.concat([f.bytes, f.bytes])
          : mode === 'wrong-hash'
            ? Buffer.alloc(f.bytes.length)
            : f.bytes;
    await expect(
      downloadArchive(
        new URL('https://github.com/fixture'),
        file,
        f.update,
        controller.signal,
        async () =>
          new Response(bytes, {
            status: mode === 'http' ? 500 : 200,
            headers: mode === 'length' ? { 'Content-Length': '1' } : {},
          }),
        () => {},
      ),
    ).rejects.toThrow();
  },
);
it('loopback installer serves only its token feed and verified archive; rejects host/path/method substitution', async () => {
  const f = fixture(),
    file = path.join(await temp(), 'update.zip');
  await writeFile(file, f.bytes);
  const feed = await installFeed(file, f.update);
  try {
    const response = await fetch(feed.url);
    const text = await response.text();
    expect(text).toContain(`sparkle:edSignature="${f.update.edSignature}"`);
    const archive = new URL('update.zip', feed.url);
    expect(Buffer.from(await (await fetch(archive)).arrayBuffer())).toEqual(f.bytes);
    expect((await fetch(new URL('/update.zip', feed.url))).status).toBe(404);
    expect((await fetch(feed.url, { method: 'POST' })).status).toBe(404);
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const request = get(feed.url, { headers: { Host: 'attacker.invalid' } }, (response) => {
        response.resume();
        resolve(response.statusCode);
      });
      request.on('error', reject);
    });
    expect(status).toBe(404);
  } finally {
    feed.close();
  }
});

it('cancels during final streamed checksum verification instead of publishing a downloaded archive', async () => {
  const f = fixture();
  const file = path.join(await temp(), 'update.zip');
  const bytes = Buffer.alloc(2 * 1024 * 1024, 0x5a);
  const update = {
    ...f.update,
    size: bytes.length,
    sha512: createHash('sha512').update(bytes).digest('base64'),
  };
  const controller = new AbortController();
  const fs = await vi.importActual<typeof import('node:fs')>('node:fs');
  vi.mocked(createReadStream).mockImplementationOnce((file, options) => {
    const stream = fs.createReadStream(file, options);
    stream.once('data', () => controller.abort());
    return stream;
  });
  await expect(
    downloadArchive(
      new URL('https://github.com/fixture'),
      file,
      update,
      controller.signal,
      async () => new Response(bytes),
      () => {},
    ),
  ).rejects.toMatchObject({ name: 'AbortError' });
});

it('cancels the response stream when exclusive archive creation fails and preserves the existing file', async () => {
  const f = fixture();
  const file = path.join(await temp(), 'update.zip');
  await writeFile(file, 'existing owner file');
  const cancel = vi.fn();
  await expect(
    downloadArchive(
      new URL('https://github.com/fixture'),
      file,
      f.update,
      new AbortController().signal,
      async () => new Response(new ReadableStream({ cancel })),
      () => {},
    ),
  ).rejects.toMatchObject({ code: 'EEXIST' });
  expect(cancel).toHaveBeenCalledOnce();
  expect(await readFile(file, 'utf8')).toBe('existing owner file');
});

it('allows authenticated progress beyond the old 30-minute total deadline', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  const f = fixture();
  const file = path.join(await temp(), 'slow.zip');
  let source!: ReadableStreamDefaultController<Uint8Array>;
  const progress = vi.fn();
  const abort = new AbortController();
  const work = downloadArchive(
    new URL('https://github.com/fixture'),
    file,
    f.update,
    abort.signal,
    async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            source = controller;
          },
        }),
      ),
    progress,
  );
  const result = work.then(
    () => undefined,
    (error: unknown) => error,
  );
  try {
    for (let index = 0; index < f.bytes.length; index++) {
      if (index) await vi.advanceTimersByTimeAsync(90_000);
      source.enqueue(f.bytes.subarray(index, index + 1));
      await vi.waitFor(() => expect(progress).toHaveBeenCalledTimes(index + 1));
    }
    source.close();
    expect(await result).toBeUndefined();
    expect(await readFile(file)).toEqual(f.bytes);
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    abort.abort();
    await result;
    vi.useRealTimers();
  }
});

it.each(['connection', 'body'] as const)(
  'bounds a stalled %s even when transport ignores abort or cancel never finishes',
  async (mode) => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const f = fixture();
    const file = path.join(await temp(), 'stalled.zip');
    const cancel = vi.fn(() => new Promise<void>(() => {}));
    const progress = vi.fn();
    const abort = new AbortController();
    const result = downloadArchive(
      new URL('https://github.com/fixture'),
      file,
      f.update,
      abort.signal,
      async () =>
        mode === 'connection'
          ? new Promise<Response>(() => {})
          : new Response(
              new ReadableStream({
                start(controller) {
                  controller.enqueue(f.bytes.subarray(0, 1));
                },
                cancel,
              }),
            ),
      progress,
    ).then(
      () => undefined,
      (error: unknown) => error,
    );
    try {
      if (mode === 'body') await vi.waitFor(() => expect(progress).toHaveBeenCalledOnce());
      await vi.advanceTimersByTimeAsync(mode === 'connection' ? 30_001 : 120_001);
      expect(await result).toMatchObject({ name: 'TimeoutError' });
      if (mode === 'body') expect(cancel).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      abort.abort();
      await result;
      vi.useRealTimers();
    }
  },
);
