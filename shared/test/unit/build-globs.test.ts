import { expect, it } from 'vitest';
import { Worker } from 'node:worker_threads';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import workspace from '../../scripts/workspace.mjs';
import { testRoot } from '../scripts/test-workspace.mjs';

it('构建匹配器处理对抗路径时有界，中文和花括号匹配保持', async () => {
  const worker = new Worker(
    `
    const {parentPort,workerData}=require('node:worker_threads');
    const {Minimatch,minimatch}=require(workerData);
    new Minimatch('**/../'.repeat(24)+'file',{optimizationLevel:2});
    parentPort.postMessage([
      minimatch('资料/题目.md','**/*.{md,svg}',{optimizationLevel:2}),
      minimatch('assets/icon.svg','**/*.{md,svg}'),
      minimatch('assets/icon.jpg','**/*.{md,svg}'),
    ]);
  `,
    {
      eval: true,
      workerData: workspace.platformRequire.resolve('minimatch'),
      resourceLimits: { maxOldGenerationSizeMb: 64 },
    },
  );
  let timer: ReturnType<typeof setTimeout>;
  try {
    const result = await new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(Error('Build matcher exceeded its resource budget')), 2000);
      worker.once('message', resolve);
      worker.once('error', reject);
      worker.once('exit', (code) => {
        if (code) reject(Error('Build matcher exited ' + code));
      });
    });
    expect(result).toEqual([true, true, false]);
  } finally {
    clearTimeout(timer!);
    await worker.terminate();
  }
});

it('构建glob取消后不继续遍历，正常资源枚举仍完整', async () => {
  const root = path.join(testRoot, 'glob-abort');
  for (let i = 0; i < 12; i++) {
    const directory = path.join(root, '目录' + i, 'child');
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, '说明.md'), 'synthetic build input');
  }
  const { glob } = workspace.platformRequire('glob');
  const fs = workspace.platformRequire('node:fs');
  const controller = new AbortController();
  let reads = 0;
  const customFs = {
    readdir(
      directory: string,
      options: unknown,
      callback: (error: unknown, entries: unknown) => void,
    ) {
      reads++;
      fs.readdir(directory, options, (error: unknown, entries: unknown) => {
        controller.abort(Error('synthetic build cancellation'));
        callback(error, entries);
      });
    },
  };
  await expect(
    glob('**/*.md', { cwd: root, signal: controller.signal, fs: customFs }),
  ).rejects.toThrow('synthetic build cancellation');
  const atRejection = reads;
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(reads).toBe(1);
  expect(reads).toBe(atRejection);
  const files = await glob('**/*.md', { cwd: root, nodir: true });
  expect(files).toHaveLength(12);
  expect(new Set(files.map((file: string) => file.replaceAll('\\', '/'))).size).toBe(12);
});
