import { afterEach, expect, it } from 'vitest';
import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { readAutoDownload, saveAutoDownload } from '../../electron/backend/updates/preferences';
import { testRoot } from '../scripts/test-workspace.mjs';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function fixture() {
  const root = await mkdtemp(path.join(testRoot, 'update-preferences-'));
  roots.push(root);
  return { root, file: path.join(root, 'update-settings.json') };
}
it('新安装保留默认自动下载，本机保存关闭后重启读取仍为关闭', async () => {
  const { root, file } = await fixture();
  expect(readAutoDownload(file)).toBe(true);
  saveAutoDownload(file, false);
  expect(readAutoDownload(file)).toBe(false);
  saveAutoDownload(file, true);
  expect(readAutoDownload(file)).toBe(true);
  expect(await readdir(root)).toEqual(['update-settings.json']);
  if (process.platform !== 'win32') expect((await stat(file)).mode & 0o777).toBe(0o600);
});
it('损坏、超限或类型不符的偏好不会重新开启自动下载', async () => {
  const { file } = await fixture();
  for (const value of [
    '{',
    '{}',
    'null',
    JSON.stringify({ schemaVersion: 1, autoDownload: 'true' }),
    JSON.stringify({ schemaVersion: 2, autoDownload: true }),
    ' '.repeat(1025),
  ]) {
    await writeFile(file, value);
    expect(readAutoDownload(file)).toBe(false);
  }
});
it('写入失败清理暂存，不替换现有目录或误报成功', async () => {
  const { root, file } = await fixture();
  await mkdir(file);
  await writeFile(path.join(file, 'keep'), 'original');
  expect(() => saveAutoDownload(file, false)).toThrow();
  expect(await readdir(root)).toEqual(['update-settings.json']);
  expect(await readdir(file)).toEqual(['keep']);
});
