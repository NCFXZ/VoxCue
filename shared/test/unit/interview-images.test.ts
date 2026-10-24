import { afterEach, expect, it } from 'vitest';
import { mkdtemp, readFile, readdir, rm, symlink, mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { InterviewImageStore } from '../../electron/backend/interview/images';

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jgSAAAAAASUVORK5CYII=',
  'base64',
);
const preview = 'data:image/png;base64,' + png.toString('base64');
const roots: string[] = [];
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'voxcue-interview-images-'));
  roots.push(root);
  const directory = path.join(root, 'images');
  return { root, directory, store: new InterviewImageStore(directory) };
}
const image = (id = randomUUID()) => ({
  id,
  preview,
  file: { name: 'screenshot.png', bytes: png },
});
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it('保存与发送完全相同的原图字节和独立缩略图，重启实例后仍能读取和删除', async () => {
  const { directory, store } = await fixture();
  const shot = image();
  await expect(readdir(directory)).rejects.toThrow();
  expect(await store.save([shot])).toEqual([{ id: shot.id, preview }]);
  expect(await readFile(path.join(directory, shot.id + '.image'))).toEqual(png);
  const restarted = new InterviewImageStore(directory);
  expect(await restarted.original(shot.id)).toEqual({ bytes: png, extension: 'png' });
  expect(await restarted.read(shot.id)).toBe(preview);
  expect(await restarted.preview(shot.id)).toBe(preview);
  await restarted.remove([shot.id]);
  expect(await readdir(directory)).toEqual([]);
  await expect(restarted.read(shot.id)).rejects.toThrow();
});

it('重试幂等且串行读取等待保存，批量失败只清理本次新建文件', async () => {
  const { directory, store } = await fixture();
  const original = image();
  const saving = store.save([original]);
  const reading = store.read(original.id);
  await saving;
  expect(await reading).toBe(preview);
  await store.save([original]);
  expect((await readdir(directory)).length).toBe(2);
  const added = image();
  await expect(
    store.save([
      added,
      { ...original, file: { ...original.file, bytes: Buffer.concat([png, Buffer.from([1])]) } },
    ]),
  ).rejects.toThrow('冲突');
  expect((await readdir(directory)).sort()).toEqual([
    original.id + '.image',
    original.id + '.preview',
  ]);
  expect(await store.read(original.id)).toBe(preview);
});

it('拒绝路径、非法格式、过大图片和重复ID；一次失败不阻塞后续有效保存', async () => {
  const { store } = await fixture();
  const shot = image();
  for (const shots of [
    [{ ...shot, id: '../outside' }],
    [shot, shot],
    [{ ...shot, preview: 'https://example.test/image.png' }],
    [{ ...shot, file: { name: 'bad.png', bytes: Buffer.from('not an image') } }],
    [{ ...shot, file: { name: 'large.png', bytes: Buffer.alloc(8 * 1024 * 1024 + 1) } }],
  ])
    await expect(store.save(shots)).rejects.toThrow();
  await store.save([shot]);
  await expect(store.read('../../outside')).rejects.toThrow();
  await expect(store.remove(['../../outside'])).rejects.toThrow();
  expect(await store.read(shot.id)).toBe(preview);
});

it.skipIf(process.platform === 'win32')('不沿文件符号链接读取或覆盖其他文件', async () => {
  const { root, directory, store } = await fixture();
  const shot = image();
  const original = new InterviewImageStore(path.join(root, 'original'));
  await original.save([shot]);
  const outside = path.join(root, 'original', shot.id + '.image');
  await mkdir(directory);
  await symlink(outside, path.join(directory, shot.id + '.image'));
  await expect(store.read(shot.id)).rejects.toThrow();
  await expect(store.save([shot])).rejects.toThrow();
  expect(await readFile(outside)).toEqual(png);
});
