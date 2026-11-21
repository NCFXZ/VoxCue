import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, it } from 'vitest';
import { testRoot } from '../../../shared/test/scripts/test-workspace.mjs';
import { sileroModel } from '../../../shared/scripts/silero-assets.mjs';

it('无缓存断网可开发启动，严格准备仍拒绝相同大小的损坏资源', async () => {
  const root = await mkdtemp(path.join(testRoot, 'qwen-offline-'));
  const windows = path.join(root, 'windows');
  const scripts = path.join(windows, 'scripts');
  const shared = path.join(root, 'shared/scripts');
  await Promise.all([mkdir(scripts, { recursive: true }), mkdir(shared, { recursive: true })]);
  const cli = path.join(scripts, 'prepare-silero.mjs');
  await copyFile(new URL('../../scripts/prepare-silero.mjs', import.meta.url), cli);
  await copyFile(new URL('../../../shared/scripts/silero-assets.mjs', import.meta.url), path.join(shared, 'silero-assets.mjs'));
  const run = (args: string[], stub: string) => spawnSync(process.execPath, [
    '--import', 'data:text/javascript,' + encodeURIComponent(stub), cli, ...args,
  ], { cwd: windows, encoding: 'utf8', windowsHide: true,
    env: { ...process.env, VOXCUE_SILERO_CACHE: '', npm_config_offline: 'true' } });

  const offline = 'globalThis.fetch = () => { process.exitCode = 99; throw Error("unexpected download"); }';
  for (const flag of ['--cache-only', '--optional-download'])
    expect(run([flag], offline).status).toBe(0);
  const bin = path.join(windows, 'native/bin');
  await expect(stat(bin)).rejects.toMatchObject({ code: 'ENOENT' });

  await mkdir(bin, { recursive: true });
  const file = path.join(bin, sileroModel.name);
  const original = Buffer.alloc(sileroModel.bytes, 1);
  await writeFile(file, original);
  const result = run([], 'globalThis.fetch = async url => new Response(Buffer.alloc(url.endsWith("LICENSE") ? 1075 : 643854, 2));');
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('SHA-256 mismatch');
  expect((await readFile(file)).equals(original)).toBe(true);
});
