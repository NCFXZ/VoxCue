import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, readdir, rm, rmdir, symlink, mkdir, writeFile, rename } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { InterviewImageStore } from '../../electron/backend/interview/images';
import { packCloudItem } from '../../electron/contracts/restoreData';
import { applyCloudItem, digestCloudBlob, localCloudItem } from '../../src/services/cloudData';
import { createHistoryService, recoverLocalHistoryImages } from '../../src/services/history';

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

it('云覆盖和后续整场删除最终仅保留其他面试的原图和预览文件', async () => {
  const { directory, store } = await fixture();
  const [old, shared] = await store.save([image(), image()]);
  const rows = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => rows.get(key) ?? null,
    setItem: (key: string, value: string) => rows.set(key, value),
    removeItem: (key: string) => rows.delete(key),
  });
  vi.stubGlobal('window', { dispatchEvent: vi.fn(), desktop: {
    interviewImage: async ({ ids }: { op: 'remove'; ids: string[] }) => {
      await store.remove(ids);
      return { ok: true };
    },
  } });
  try {
    const history = createHistoryService(localStorage);
    const previous = { id: 'demo', title: '合成记录', startedAt: 1, endedAt: 2,
      status: 'ended' as const, transcripts: [], mock: false,
      answers: [{ id: 'a', question: 'Q', content: 'A', images: [old, shared] }] };
    history.save(previous);
    history.save({ ...previous, id: 'other', answers: [{ ...previous.answers[0], images: [shared] }] });
    const key = 'record:demo';
    const expected = await digestCloudBlob(await (await localCloudItem('history', key))!.blob());
    await applyCloudItem(key, packCloudItem(key, JSON.stringify({ ...previous, answers: [] })), expected);
    history.remove('demo');
    await recoverLocalHistoryImages();
    expect((await readdir(directory)).sort()).toEqual([shared.id + '.image', shared.id + '.preview']);
    expect((await store.original(shared.id)).bytes).toEqual(png);
    expect(await store.preview(shared.id)).toBe(preview);
  } finally {
    vi.unstubAllGlobals();
    await store.dispose();
  }
});

it('恢复记录时只有旧预览留在磁盘，仍先补齐原图，热摘要也不能掩盖缺失', async () => {
  const { directory, store } = await fixture();
  const [ref] = await store.save([image()]);
  const item = packCloudItem('image:' + ref.id, png, { id: ref.id, preview });
  await store.syncImage(ref.id, undefined, false);
  await rm(path.join(directory, ref.id + '.image'));
  expect(await store.preview(ref.id)).toBe(preview);
  const rows = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => rows.get(key) ?? null,
    setItem: (key: string, value: string) => rows.set(key, value),
  });
  vi.stubGlobal('window', { dispatchEvent: vi.fn(), desktop: {
    interviewImage: async ({ op, id }: { op: string; id: string }) => {
      try {
        if (op === 'preview') return { ok: true, dataUrl: await store.preview(id) };
        return { ok: true, ...await store.syncImage(id, undefined, false) };
      } catch { return { ok: false }; }
    },
    cloudSync: async ({ bytes }: { bytes: Uint8Array }) => {
      await store.save([{ id: ref.id, preview, file: { name: 'image.png', bytes } }]);
      return { ok: true };
    },
  } });
  try {
    const record = { id: 'to', title: '目标', startedAt: 1, endedAt: 2,
      status: 'ended', transcripts: [], mock: false,
      answers: [{ id: 'a', question: '', content: '', images: [ref] }] };
    const download = vi.fn(async () => item);
    await applyCloudItem('record:to', packCloudItem('record:to', JSON.stringify(record)),
      undefined, 'synthetic-user', () => {}, download);
    expect(download).toHaveBeenCalledExactlyOnceWith(ref.id);
    expect((await store.original(ref.id)).bytes).toEqual(png);
    expect(await store.preview(ref.id)).toBe(preview);
    expect(createHistoryService(localStorage).list()).toEqual([record]);
  } finally {
    vi.unstubAllGlobals();
    await store.dispose();
  }
});

it('returns the existing sync envelope hash and checks original and preview identity on each poll', async () => {
  const { store, directory } = await fixture();
  const shot = image();
  await store.save([shot]);
  const expected = Buffer.from(await packCloudItem('image:' + shot.id, new Uint8Array(png), {
    id: shot.id, preview, type: 'image/png',
  }).arrayBuffer());
  const hash = createHash('sha256').update(expected).digest('hex');
  expect(await store.syncImage(shot.id, undefined, true)).toEqual({ hash, bytes: expected });
  expect(await store.syncImage(shot.id, undefined, false)).toEqual({ hash });
  const changedPreview = 'data:image/png;base64,AAAA';
  await writeFile(path.join(directory, shot.id + '.preview'), changedPreview);
  expect((await store.syncImage(shot.id, undefined, false)).hash).not.toBe(hash);
  expect((await store.syncImage(shot.id, preview, false)).hash).toBe(hash);
  const original = path.join(directory, shot.id + '.image');
  const changed = Buffer.from(png);
  changed[changed.length - 1] ^= 1;
  await writeFile(original + '.replacement', changed);
  await rename(original + '.replacement', original);
  expect((await store.syncImage(shot.id, preview, false)).hash).not.toBe(hash);
  await rm(original);
  await expect(store.syncImage(shot.id, preview, false)).rejects.toThrow();
  await store.dispose();
  await expect(store.syncImage(shot.id, preview, false)).rejects.toThrow('closed');
});

it('只清理仍和迁移快照一致的截图和缩略图，重试不影响其他图片', async () => {
  const { directory, store } = await fixture();
  const selected = image(), other = image();
  await store.save([selected, other]);
  const hash = createHash('sha256').update(png).digest('hex');
  const previewHash = createHash('sha256').update(preview).digest('hex');
  await expect(store.checkOrRemoveMoved(selected.id, hash, '0'.repeat(64), true)).rejects.toThrow('已改变');
  expect(await store.read(selected.id)).toBe(preview);
  await store.checkOrRemoveMoved(selected.id, hash, previewHash, false);
  expect(await store.read(selected.id)).toBe(preview);
  await store.checkOrRemoveMoved(selected.id, hash, previewHash, true);
  await store.checkOrRemoveMoved(selected.id, hash, previewHash, true);
  expect((await readdir(directory)).sort()).toEqual([other.id + '.image', other.id + '.preview']);
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

it('一张原图无法移除时同一批其他图片仍可清理，重新执行也能完成', async () => {
  const { directory, store } = await fixture();
  const busy = image(), other = image();
  await store.save([busy, other]);
  const file = path.join(directory, busy.id + '.image');
  await rm(file);
  await mkdir(file);
  await expect(store.remove([busy.id, other.id])).rejects.toThrow();
  expect(await readdir(directory)).toEqual([busy.id + '.image']);
  await rmdir(file);
  await store.remove([busy.id, other.id]);
  expect(await readdir(directory)).toEqual([]);
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
