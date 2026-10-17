import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import workspace from '../../shared/scripts/workspace.mjs';

export const sparkleVersion = '2.10.0';
const digest = 'c2bf58aa8387266ac179357b1415d6f2635f044da8be41042af32425dae6da0c';
export async function sparkleTools() {
  if (process.platform !== 'darwin' || process.arch !== 'arm64')
    throw Error('Apple Silicon required');
  const cache = path.join(workspace.platformRoot, '.cache/sparkle');
  const tools = path.join(workspace.platformRoot, '.tools/sparkle', sparkleVersion);
  await mkdir(cache, { recursive: true });
  const archive = path.join(cache, `Sparkle-${sparkleVersion}.tar.xz`);
  let data = await readFile(archive).catch((error) => {
    if (error.code !== 'ENOENT') throw error;
  });
  if (!data) {
    const response = await fetch(
      `https://github.com/sparkle-project/Sparkle/releases/download/${sparkleVersion}/Sparkle-${sparkleVersion}.tar.xz`,
      { signal: AbortSignal.timeout(120000) },
    );
    if (!response.ok) throw Error('Sparkle download failed');
    data = Buffer.from(await response.arrayBuffer());
    if (createHash('sha256').update(data).digest('hex') !== digest)
      throw Error('Sparkle checksum mismatch');
    await writeFile(archive, data, { flag: 'wx' });
  }
  if (createHash('sha256').update(data).digest('hex') !== digest)
    throw Error('Sparkle checksum mismatch');
  if (!(await stat(path.join(tools, 'Sparkle.framework/Sparkle')).catch(() => false))) {
    await mkdir(tools, { recursive: true });
    const unpack = spawnSync('/usr/bin/tar', ['-xf', archive, '-C', tools], { stdio: 'inherit' });
    if (unpack.error || unpack.status) throw Error('Sparkle extraction failed');
  }
  return tools;
}
