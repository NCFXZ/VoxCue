import { afterEach, beforeEach, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { lockOutput, replaceGeneratedOutput } from '../../scripts/electron-output.mjs';

let temporary: string, output: string, stage: string, backup: string;
beforeEach(async () => {
  temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'voxcue-output-test-'));
  output = path.join(temporary, 'dist-electron');
  stage = path.join(temporary, 'stage');
  backup = path.join(temporary, 'backup');
  await fs.mkdir(path.join(output, 'shared'), { recursive: true });
  await fs.mkdir(path.join(stage, 'shared'), { recursive: true });
  await fs.writeFile(path.join(output, 'shared/main.js'), 'previous');
  await fs.writeFile(path.join(output, 'shared/stale.js'), 'stale');
  await fs.writeFile(path.join(stage, 'shared/main.js'), 'current');
  await fs.writeFile(path.join(stage, 'shared/new.js'), 'new');
});
afterEach(async () => {
  await fs.rm(temporary, { recursive: true, force: true });
});

it('连续更新保留输出及子目录身份，更新代码并删除过期生成文件，不轮换目录', async () => {
  const root = (await fs.stat(output)).ino,
    shared = (await fs.stat(path.join(output, 'shared'))).ino;
  for (let iteration = 0; iteration < 3; iteration++) {
    await replaceGeneratedOutput(stage, output, backup);
    expect((await fs.stat(output)).ino).toBe(root);
    expect((await fs.stat(path.join(output, 'shared'))).ino).toBe(shared);
  }
  expect(await fs.readFile(path.join(output, 'shared/main.js'), 'utf8')).toBe('current');
  expect(await fs.readdir(path.join(output, 'shared'))).toEqual(['main.js', 'new.js']);
  expect((await fs.readdir(temporary)).some((name) => /^dist-electron \d+$/.test(name))).toBe(
    false,
  );
});
it('更新中途写入失败时恢复原代码和过期文件，清掉本轮新增文件', async () => {
  const copy = async (from: string, to: string) => {
    if (path.basename(from) === 'new.js') {
      await fs.writeFile(to, 'partial');
      throw Error('synthetic write failure');
    }
    await fs.copyFile(from, to);
  };
  await expect(replaceGeneratedOutput(stage, output, backup, copy)).rejects.toThrow(
    'synthetic write failure',
  );
  expect(await fs.readFile(path.join(output, 'shared/main.js'), 'utf8')).toBe('previous');
  expect(await fs.readFile(path.join(output, 'shared/stale.js'), 'utf8')).toBe('stale');
  expect(await fs.readdir(path.join(output, 'shared'))).toEqual(['main.js', 'stale.js']);
});
it('陌生原件、重定向和空编译结果均在写入前拒绝', async () => {
  const original = path.join(output, 'original.txt');
  await fs.writeFile(original, 'preserve');
  await expect(replaceGeneratedOutput(stage, output, backup)).rejects.toThrow('non-generated');
  expect(await fs.readFile(original, 'utf8')).toBe('preserve');
  await fs.unlink(original);
  await fs.rm(stage, { recursive: true });
  await fs.mkdir(stage);
  await expect(replaceGeneratedOutput(stage, output, backup)).rejects.toThrow(
    'Empty Electron build',
  );
  await fs.rm(stage, { recursive: true });
  await fs.symlink(output, stage, process.platform === 'win32' ? 'junction' : 'dir');
  await expect(replaceGeneratedOutput(stage, output, backup)).rejects.toThrow('Invalid output');
  expect(await fs.readFile(path.join(output, 'shared/main.js'), 'utf8')).toBe('previous');
});
it('同一输出的并发构建被拒绝，释放后可重新获取', async () => {
  const release = await lockOutput(output);
  try {
    await expect(lockOutput(output)).rejects.toThrow('Another Electron build');
  } finally {
    await release();
  }
  const again = await lockOutput(output);
  await again();
});
