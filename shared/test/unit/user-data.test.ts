import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { migrateUserData } from '../../electron/userData';
import { testRoot } from '../scripts/test-workspace.mjs';

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function fixture() {
  const root = await mkdtemp(path.join(testRoot, 'user-data-'));
  roots.push(root);
  return {
    root,
    legacy: path.join(root, 'ai-interview-copilot'),
    target: path.join(root, 'VoxCue'),
  };
}

describe('VoxCue 用户数据目录迁移', () => {
  it('完整原子移动资料、加密凭据、数据库、附件和模型缓存，保留内容、权限与文件身份，旧目录消失', async () => {
    const f = await fixture();
    const files = [
      'auth-data/credentials.bin',
      'auth-data/host-id',
      'IndexedDB/file__0.indexeddb.leveldb/000001.ldb',
      'IndexedDB/file__0.indexeddb.blob/1/attachment',
      'Local Storage/leveldb/000001.log',
      'knowledge-v1/index/data.lance',
      'chat-usage/usage.json',
      'component-cache/speech-v1/files/model.onnx',
      '旧扩展/未知资料.bin',
    ];
    const content = Buffer.from([0, 255, 67, 128, 10]);
    const identities = new Map<string, Awaited<ReturnType<typeof stat>>>();
    for (const file of files) {
      const location = path.join(f.legacy, file);
      await mkdir(path.dirname(location), { recursive: true });
      await writeFile(location, content, { mode: 0o600 });
      identities.set(file, await stat(location));
    }
    expect(migrateUserData(f.root)).toBe(f.target);
    await expect(stat(f.legacy)).rejects.toMatchObject({ code: 'ENOENT' });
    for (const file of files) {
      const location = path.join(f.target, file);
      expect(await readFile(location)).toEqual(content);
      const current = await stat(location),
        original = identities.get(file)!;
      expect([current.ino, current.dev, current.mode, current.mtimeMs]).toEqual([
        original.ino,
        original.dev,
        original.mode,
        original.mtimeMs,
      ]);
    }
    expect(migrateUserData(f.root)).toBe(f.target);
    expect(await readdir(f.root)).toEqual(['VoxCue']);
  });
  it('全新安装只创建 VoxCue；已有新目录可直接复用', async () => {
    const f = await fixture();
    expect(migrateUserData(f.root)).toBe(f.target);
    await writeFile(path.join(f.target, 'saved'), 'existing');
    expect(migrateUserData(f.root)).toBe(f.target);
    expect(await readFile(path.join(f.target, 'saved'), 'utf8')).toBe('existing');
    expect(await readdir(f.root)).toEqual(['VoxCue']);
  });
  it('可采用空目标目录，或移除空的旧目录，不覆盖有内容的新目录', async () => {
    const f = await fixture();
    await mkdir(f.legacy);
    await mkdir(f.target);
    await writeFile(path.join(f.legacy, 'saved'), 'legacy');
    migrateUserData(f.root);
    expect(await readFile(path.join(f.target, 'saved'), 'utf8')).toBe('legacy');
    await mkdir(f.legacy);
    migrateUserData(f.root);
    expect(await readdir(f.root)).toEqual(['VoxCue']);
  });
  it('新旧两处都有内容时停止，双方原件保持', async () => {
    const f = await fixture();
    await mkdir(f.legacy);
    await mkdir(f.target);
    await writeFile(path.join(f.legacy, 'same-name'), 'legacy');
    await writeFile(path.join(f.target, 'same-name'), 'current');
    expect(() => migrateUserData(f.root)).toThrow('都已有内容');
    expect(await readFile(path.join(f.legacy, 'same-name'), 'utf8')).toBe('legacy');
    expect(await readFile(path.join(f.target, 'same-name'), 'utf8')).toBe('current');
  });
  it('拒绝文件型目录和非绝对根路径', async () => {
    const f = await fixture();
    expect(() => migrateUserData('relative')).toThrow('根目录无效');
    await writeFile(f.legacy, 'protected');
    expect(() => migrateUserData(f.root)).toThrow('不是普通目录');
    expect(await readFile(f.legacy, 'utf8')).toBe('protected');
  });
  it('拒绝源或目标目录链接，不修改链接所指内容', async () => {
    for (const source of [true, false]) {
      const f = await fixture(),
        outside = path.join(f.root, 'protected');
      await mkdir(outside);
      await writeFile(path.join(outside, 'keep'), 'original');
      if (!source) await mkdir(f.legacy);
      await symlink(
        outside,
        source ? f.legacy : f.target,
        process.platform === 'win32' ? 'junction' : 'dir',
      );
      expect(() => migrateUserData(f.root)).toThrow('不是普通目录');
      expect(await readFile(path.join(outside, 'keep'), 'utf8')).toBe('original');
    }
  });
  it.skipIf(process.platform === 'win32')(
    '拒绝正在运行、无法确认或其他主机的 profile 锁，允许已退出进程的锁',
    async () => {
      const f = await fixture();
      await mkdir(f.legacy);
      const lock = path.join(f.legacy, 'SingletonLock');
      await symlink(`${os.hostname()}-${process.pid}`, lock);
      expect(() => migrateUserData(f.root)).toThrow('正常退出旧版');
      await rm(lock);
      await symlink('other-host-1234', lock);
      expect(() => migrateUserData(f.root)).toThrow('正常退出旧版');
      await rm(lock);
      await symlink(`${os.hostname()}-2147483647`, lock);
      vi.spyOn(process, 'kill').mockImplementation(() => {
        throw Object.assign(Error('gone'), { code: 'ESRCH' });
      });
      expect(migrateUserData(f.root)).toBe(f.target);
      await expect(stat(f.legacy)).rejects.toMatchObject({ code: 'ENOENT' });
    },
  );
});
