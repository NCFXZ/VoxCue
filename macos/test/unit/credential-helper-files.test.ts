import { afterEach, expect, it } from 'vitest';
import {
  mkdtemp,
  mkdir,
  realpath,
  readFile,
  writeFile,
  lstat,
  rm,
  symlink,
  link,
  chmod,
  readdir,
  unlink,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  copyCredentialHelper,
  readCredentialHelperCache,
  credentialFile,
} from '../../scripts/build-hardened-credentials.mjs';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function fixture() {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'voxcue-helper-files-')));
  roots.push(root);
  const cache = path.join(root, 'cache'),
    outputDirectory = path.join(root, 'bin');
  await mkdir(cache);
  await mkdir(outputDirectory);
  const source = path.join(cache, credentialFile),
    output = path.join(outputDirectory, credentialFile);
  await writeFile(source, 'synthetic helper bytes', { mode: 0o755 });
  await writeFile(path.join(cache, 'build.json'), JSON.stringify({ binaryHash: 'synthetic' }));
  await writeFile(output, 'previous helper bytes', { mode: 0o755 });
  return { root, cache, source, output, outputDirectory };
}
it('publishes by replacing the owned output entry and leaves an identical copy untouched', async () => {
  const f = await fixture();
  const before = await lstat(f.output);
  await copyCredentialHelper(f.source, f.output);
  expect(await readFile(f.output)).toEqual(await readFile(f.source));
  const published = await lstat(f.output);
  expect(published.ino).not.toBe(before.ino);
  expect(published.nlink).toBe(1);
  expect(published.mode & 0o777).toBe(0o755);
  await copyCredentialHelper(f.source, f.output);
  const same = await lstat(f.output);
  expect([same.ino, same.mtimeMs]).toEqual([published.ino, published.mtimeMs]);
  expect(await readdir(f.outputDirectory)).toEqual([credentialFile]);
});
it.each(['symlink', 'hardlink', 'directory'] as const)(
  'rejects an output %s without changing its target or contents',
  async (kind) => {
    const f = await fixture(),
      target = path.join(f.root, 'protected');
    await writeFile(target, 'preserve original');
    await unlink(f.output);
    if (kind === 'symlink') await symlink(target, f.output);
    else if (kind === 'hardlink') await link(target, f.output);
    else {
      await mkdir(f.output);
      await writeFile(path.join(f.output, 'original'), 'preserve original');
    }
    await expect(copyCredentialHelper(f.source, f.output)).rejects.toThrow(/owned|redirected/);
    expect(await readFile(target, 'utf8')).toBe('preserve original');
    if (kind === 'symlink') expect((await lstat(f.output)).isSymbolicLink()).toBe(true);
    if (kind === 'directory')
      expect(await readFile(path.join(f.output, 'original'), 'utf8')).toBe('preserve original');
  },
);
it('rejects an aliased output parent before writing or creating anything in its target', async () => {
  const f = await fixture();
  const alias = path.join(f.root, 'aliased-bin');
  await symlink(f.outputDirectory, alias);
  await expect(copyCredentialHelper(f.source, path.join(alias, credentialFile))).rejects.toThrow(
    /owned|redirected/,
  );
  expect(await readFile(f.output, 'utf8')).toBe('previous helper bytes');
  await expect(
    copyCredentialHelper(f.source, path.join(alias, 'nested', credentialFile)),
  ).rejects.toThrow(/owned|redirected/);
  expect(await readdir(f.outputDirectory)).toEqual([credentialFile]);
});
it('creates only a checked missing output directory', async () => {
  const f = await fixture(),
    output = path.join(f.root, 'new-bin', credentialFile);
  await expect(copyCredentialHelper(f.source, output)).resolves.toBe(output);
  expect(await readFile(output, 'utf8')).toBe('synthetic helper bytes');
});
it.each([
  'directory',
  'canonical-symlink',
  'record-symlink',
  'canonical-hardlink',
  'record-hardlink',
  'writable-directory',
  'writable-file',
] as const)('refuses a redirected or unsafe fixed cache: %s', async (kind) => {
  const f = await fixture();
  let cache = f.cache;
  const file = kind.startsWith('record-') ? path.join(f.cache, 'build.json') : f.source;
  if (kind === 'directory') {
    cache = path.join(f.root, 'alias');
    await symlink(f.cache, cache);
  } else if (kind.endsWith('symlink')) {
    const target = path.join(f.root, 'protected');
    await writeFile(target, await readFile(file));
    await unlink(file);
    await symlink(target, file);
  } else if (kind.endsWith('hardlink')) await link(file, path.join(f.root, 'alias'));
  else await chmod(kind === 'writable-directory' ? f.cache : f.source, 0o777);
  await expect(readCredentialHelperCache(cache)).rejects.toThrow(/owned|redirected/);
  expect(await readFile(f.output, 'utf8')).toBe('previous helper bytes');
});
it('preserves an unrecorded canonical and rejects a record with a missing binary', async () => {
  const f = await fixture(),
    record = path.join(f.cache, 'build.json');
  await unlink(record);
  await expect(readCredentialHelperCache(f.cache)).rejects.toThrow('Unrecorded');
  expect(await readFile(f.source, 'utf8')).toBe('synthetic helper bytes');
  await writeFile(record, '{}');
  await unlink(f.source);
  await expect(readCredentialHelperCache(f.cache)).rejects.toThrow('missing');
  expect(await readFile(record, 'utf8')).toBe('{}');
});
it('reads the fixed pair without modifying its identity or metadata', async () => {
  const f = await fixture(),
    recordFile = path.join(f.cache, 'build.json');
  const before = await Promise.all([lstat(f.source), lstat(recordFile)]);
  expect(await readCredentialHelperCache(f.cache)).toEqual({
    record: { binaryHash: 'synthetic' },
    bytes: Buffer.from('synthetic helper bytes'),
  });
  const after = await Promise.all([lstat(f.source), lstat(recordFile)]);
  expect(after.map(({ ino, mtimeMs }) => [ino, mtimeMs])).toEqual(
    before.map(({ ino, mtimeMs }) => [ino, mtimeMs]),
  );
});
it.each(['missing-directory', 'empty-directory'] as const)(
  'requires restoration instead of recreating a %s frozen identity',
  async (kind) => {
    const f = await fixture();
    await rm(f.cache, { recursive: true });
    if (kind === 'empty-directory') await mkdir(f.cache);
    await expect(readCredentialHelperCache(f.cache)).rejects.toThrow(/missing.*restore|directory is missing/);
    if (kind === 'empty-directory') expect(await readdir(f.cache)).toEqual([]);
    else await expect(lstat(f.cache)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(f.output, 'utf8')).toBe('previous helper bytes');
  },
);
it('refuses a source link before replacing an existing output', async () => {
  const f = await fixture(),
    target = path.join(f.root, 'protected');
  await writeFile(target, 'preserve original');
  await unlink(f.source);
  await symlink(target, f.source);
  await expect(copyCredentialHelper(f.source, f.output)).rejects.toThrow(/owned|redirected/);
  expect(await readFile(f.output, 'utf8')).toBe('previous helper bytes');
  expect(await readFile(target, 'utf8')).toBe('preserve original');
});
