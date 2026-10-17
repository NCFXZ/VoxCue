import workspace from '../../shared/scripts/workspace.mjs';
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export async function buildMacIcons() {
  if (process.platform !== 'darwin' || process.arch !== 'arm64')
    throw Error('Apple Silicon required.');
  const root = workspace.platformRoot;
  const source = path.join(workspace.sharedRoot, 'public/voxcue-source.png');
  const code = path.join(root, 'native/IconBuilder.mm');
  const png = path.join(root, 'public/voxcue.png');
  const icns = path.join(root, 'public/voxcue.icns');
  const iconset = path.join(root, '.cache/launcher.iconset');
  const binary = path.join(root, '.tools/icon-builder');
  const marker = path.join(root, '.cache/icon-revision.json');
  const expected = createHash('sha256')
    .update(await readFile(source))
    .update(await readFile(code))
    .digest('hex');
  if (
    (await readFile(marker, 'utf8').catch(() => '')) === expected &&
    (await Promise.all(
      [png, icns].map((file) =>
        access(file).then(
          () => true,
          () => false,
        ),
      ),
    ).then((values) => values.every(Boolean)))
  )
    return { png, icns };
  for (const directory of [path.dirname(png), iconset, path.dirname(binary)])
    await mkdir(directory, { recursive: true });
  const run = (command, args) => {
    const result = spawnSync(command, args, { stdio: 'inherit' });
    if (result.error) throw result.error;
    if (result.status) throw Error(`${command} failed (${result.status}).`);
  };
  run('/usr/bin/xcrun', [
    'clang++',
    '-std=c++17',
    '-fobjc-arc',
    '-O2',
    '-arch',
    'arm64',
    '-mmacosx-version-min=14.2',
    code,
    '-framework',
    'Foundation',
    '-framework',
    'CoreGraphics',
    '-framework',
    'ImageIO',
    '-o',
    binary,
  ]);
  run(binary, [source, png, iconset]);
  run('/usr/bin/iconutil', ['-c', 'icns', iconset, '-o', icns]);
  await writeFile(marker, expected);
  return { png, icns };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await buildMacIcons();
