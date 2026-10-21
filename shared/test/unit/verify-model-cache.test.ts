import { test, expect } from 'vitest';
import { mkdir, readFile, rename, stat, symlink, unlink, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { testRoot } from '../scripts/test-workspace.mjs';
import { verifyCachedComponent } from '../scripts/verify-model-cache.mjs';
import { stageModelFixtures } from '../scripts/model-fixtures.mjs';

async function fixture() {
  const directory = path.join(testRoot, randomUUID());
  await mkdir(path.join(directory, 'files/model'), { recursive: true });
  const file = path.join(directory, 'files/model/weights.bin');
  const content = Buffer.from('synthetic model');
  await writeFile(file, content);
  const pkg = {
    sha256: 'fixed-test-catalog',
    files: [
      {
        path: 'model/weights.bin',
        bytes: content.length,
        sha256: createHash('sha256').update(content).digest('hex'),
        mode: 0o644,
      },
    ],
  };
  await writeFile(
    path.join(directory, '.voxcue-component.json'),
    JSON.stringify({ sha256: pkg.sha256 }),
  );
  return { directory, file, content, pkg };
}

test('explicit cache reuse validates weights without changing files or markers', async () => {
  const { directory, file, content, pkg } = await fixture();
  const before = await stat(file);
  const marker = await readFile(path.join(directory, '.voxcue-component.json'));
  expect(await verifyCachedComponent(directory, pkg)).toBe(1);
  expect(await readFile(file)).toEqual(content);
  expect((await stat(file)).mtimeMs).toBe(before.mtimeMs);
  expect(await readFile(path.join(directory, '.voxcue-component.json'))).toEqual(marker);
});

test('same-size corrupt weights are rejected without repair or removal', async () => {
  const { directory, file, content, pkg } = await fixture();
  const corrupt = Buffer.alloc(content.length, 1);
  await writeFile(file, corrupt);
  await expect(verifyCachedComponent(directory, pkg)).rejects.toThrow('Model checksum mismatch');
  expect(await readFile(file)).toEqual(corrupt);
});

test('missing model files do not trigger a download', async () => {
  const { directory, file, pkg } = await fixture();
  await unlink(file);
  await expect(verifyCachedComponent(directory, pkg)).rejects.toThrow('Missing model files');
});

test('unlisted files are preserved and rejected', async () => {
  const { directory, pkg } = await fixture();
  const extra = path.join(directory, 'files/model/extra.bin');
  await writeFile(extra, 'preserve this file');
  await expect(verifyCachedComponent(directory, pkg)).rejects.toThrow('Unexpected model file');
  expect(await readFile(extra, 'utf8')).toBe('preserve this file');
});

test('a marker from another catalog is not accepted or overwritten', async () => {
  const { directory, pkg } = await fixture();
  const marker = path.join(directory, '.voxcue-component.json');
  await writeFile(marker, JSON.stringify({ sha256: 'another-catalog' }));
  await expect(verifyCachedComponent(directory, pkg)).rejects.toThrow('Model catalog mismatch');
  expect(JSON.parse(await readFile(marker, 'utf8')).sha256).toBe('another-catalog');
});

test('model junctions cannot redirect verification outside its component', async () => {
  const { directory, pkg } = await fixture();
  const target = path.join(testRoot, randomUUID());
  await mkdir(target);
  await symlink(
    target,
    path.join(directory, 'files/redirect'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  await expect(verifyCachedComponent(directory, pkg)).rejects.toThrow(
    'Model links are not accepted',
  );
});

test('test copies are independent from the authorized model source', async () => {
  const { directory, content, pkg } = await fixture();
  const source = path.join(testRoot, randomUUID());
  const staged = path.join(testRoot, randomUUID());
  const stagedPackage = { ...pkg, id: 'speech', version: 'test' };
  const name = `speech-test-${pkg.sha256}`;
  await mkdir(source);
  await rename(directory, path.join(source, name));
  await stageModelFixtures(source, staged, [stagedPackage], (root, item) =>
    path.join(root, `${item.id}-${item.version}-${item.sha256}`),
  );
  const copy = path.join(staged, name, 'files/model/weights.bin');
  await writeFile(copy, Buffer.alloc(content.length, 2));
  expect(await readFile(path.join(source, name, 'files/model/weights.bin'))).toEqual(content);
  expect(await verifyCachedComponent(path.join(source, name), pkg)).toBe(1);
});

test('test copying refuses destinations outside the owned temporary run', async () => {
  const { directory, pkg } = await fixture();
  await expect(stageModelFixtures(directory, path.dirname(testRoot), [pkg])).rejects.toThrow(
    'Model copy must belong to this temporary run',
  );
});
