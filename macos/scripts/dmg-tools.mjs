import workspace from '../../shared/scripts/workspace.mjs';
import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

// Pure Python wheels from PyPI, loaded directly as zip imports. No pip/global install.
// Both projects are MIT-licensed: https://github.com/dmgbuild/{ds_store,mac_alias}
const wheels = [
  {
    name: 'ds_store-1.3.1-py3-none-any.whl',
    url: 'https://files.pythonhosted.org/packages/47/bf/b1c10362a0d670ee8ae086d92c3ab795fca2a927e4ff25e7cd15224d3863/ds_store-1.3.1-py3-none-any.whl',
    sha256: 'fbacbb0bd5193ab3e66e5a47fff63619f15e374ffbec8ae29744251a6c8f05b5',
    size: 16268,
  },
  {
    name: 'mac_alias-2.2.2-py3-none-any.whl',
    url: 'https://files.pythonhosted.org/packages/39/a1/4136777ed6a56df83e7c748ad28892f0672cbbcdc3b3d15a57df6ba72443/mac_alias-2.2.2-py3-none-any.whl',
    sha256: '504ab8ac546f35bbd75ad014d6ad977c426660aa721f2cd3acf3dc2f664141bd',
    size: 21220,
  },
];
export function runDmgTool(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 120000, ...options });
  if (result.error || result.status)
    throw result.error ?? Error(`${path.basename(command)} failed: ${result.stderr}`);
  return result.stdout;
}
const digest = (data) => createHash('sha256').update(data).digest('hex');
export async function dmgTools() {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') throw Error('Mac arm64 required');
  const root = workspace.platformRoot;
  const directory = path.join(root, '.cache/dmg-tools');
  await mkdir(directory, { recursive: true });
  const paths = [];
  for (const wheel of wheels) {
    const file = path.join(directory, wheel.name);
    const info = await lstat(file).catch(() => null);
    if (info && !info.isFile()) throw Error('Unsafe DMG tool cache: ' + file);
    const valid = (data) => data.length === wheel.size && digest(data) === wheel.sha256;
    if (!info || !valid(await readFile(file))) {
      const response = await fetch(wheel.url, { signal: AbortSignal.timeout(30000) });
      if (!response.ok || new URL(response.url).hostname !== 'files.pythonhosted.org')
        throw Error('Unable to download pinned DMG tool: ' + wheel.name);
      const data = Buffer.from(await response.arrayBuffer());
      if (!valid(data)) throw Error('DMG tool integrity mismatch: ' + wheel.name);
      const pending = file + '.' + process.pid + '.partial';
      try {
        await writeFile(pending, data, { flag: 'wx' });
        await rename(pending, file);
      } finally {
        await rm(pending, { force: true });
      }
    }
    paths.push(file);
  }
  const source = path.join(root, 'native/DmgArtwork.mm');
  const binary = path.join(root, '.tools/dmg-artwork');
  const marker = path.join(directory, 'artwork-revision');
  const revision = digest(await readFile(source));
  if (
    (await readFile(marker, 'utf8').catch(() => '')) !== revision ||
    !(await lstat(binary).catch(() => null))
  ) {
    await mkdir(path.dirname(binary), { recursive: true });
    runDmgTool('/usr/bin/xcrun', [
      'clang++',
      '-fobjc-arc',
      '-O2',
      '-arch',
      'arm64',
      '-mmacosx-version-min=14.2',
      source,
      '-framework',
      'AppKit',
      '-o',
      binary,
    ]);
    await writeFile(marker, revision);
  }
  return {
    wheels: paths,
    artwork: binary,
    layout: path.join(root, 'scripts/dmg-layout.json'),
    logo: path.join(root, 'public/voxcue.png'),
  };
}
