import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const disk = vi.hoisted(() => ({
  target: '',
  entered: undefined as (() => void) | undefined,
  release: undefined as (() => void) | undefined,
}));
vi.mock('node:fs/promises', async (original) => {
  const actual = await original<typeof import('node:fs/promises')>();
  return {
    ...actual,
    mkdir: async (...args: Parameters<typeof actual.mkdir>) => {
      if (args[0] === disk.target) {
        await new Promise<void>((resolve) => {
          disk.release = resolve;
          disk.entered?.();
        });
      }
      return actual.mkdir(...args);
    },
  };
});
import { InterviewImageStore } from '../../electron/backend/interview/images';
import { UsageLedger } from '../../electron/backend/chat/usage';
import { eraseLocalAccount } from '../../electron/backend/accountErasure';

const roots: string[] = [];
const work: Promise<unknown>[] = [];
afterEach(async () => {
  disk.target = '';
  disk.release?.();
  disk.entered = disk.release = undefined;
  await Promise.allSettled(work.splice(0));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it.each(['image', 'usage'])('账号清理等待 %s 的在途写入退休，并拒绝后续写入', async (kind) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'voxcue-erasure-writers-'));
  roots.push(root);
  const directory = path.join(root, kind === 'image' ? 'interview-images-v1' : 'chat-usage');
  disk.target = directory;
  const blocked = new Promise<void>((resolve) => {
    disk.entered = resolve;
  });
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jgSAAAAAASUVORK5CYII=',
    'base64',
  );
  const id = randomUUID();
  const image = new InterviewImageStore(directory);
  const usage = new UsageLedger(directory);
  const saving =
    kind === 'image'
      ? image.save([
          {
            id,
            preview: 'data:image/png;base64,' + png.toString('base64'),
            file: { name: 'synthetic.png', bytes: png },
          },
        ])
      : usage.add('synthetic', 'response', { inputTokens: 1, outputTokens: 2, totalTokens: 3 });
    work.push(saving);
  await blocked;
  const store = kind === 'image' ? image : usage;
  const retired = store.dispose();
  const again = store.dispose();
  const lateWrite = () =>
    kind === 'image'
      ? image.save([
          {
            id: randomUUID(),
            preview: 'data:image/png;base64,' + png.toString('base64'),
            file: { name: 'late.png', bytes: png },
          },
        ])
      : usage.add('synthetic', 'late-response', {
          inputTokens: 1,
          outputTokens: 2,
          totalTokens: 3,
        });
  await expect(lateWrite()).rejects.toThrow('closed');
  let cleared = false;
  const erasing = retired.then(() =>
    eraseLocalAccount(root, async () => {
      // Erasure can begin only after the original write has really settled.
      if (kind === 'image')
        expect(await readFile(path.join(directory, id + '.image'))).toEqual(png);
      else {
        const files = await readdir(directory);
        expect(
          JSON.parse(await readFile(path.join(directory, files[0]), 'utf8')).usage.totalTokens,
        ).toBe(3);
      }
      cleared = true;
    }),
  );
    work.push(erasing, again);
  await Promise.resolve();
  expect(cleared).toBe(false);
  disk.target = '';
  disk.release!();
  await Promise.all([saving, erasing, again]);
  expect(cleared).toBe(true);
  await expect(stat(directory)).rejects.toMatchObject({ code: 'ENOENT' });
  await expect(lateWrite()).rejects.toThrow('closed');
  if (kind === 'usage') await expect(usage.reset('synthetic')).rejects.toThrow('closed');
  await expect(stat(directory)).rejects.toMatchObject({ code: 'ENOENT' });
});
