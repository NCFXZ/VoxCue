import workspace from '../../shared/scripts/workspace.mjs';
import { cp, lstat, mkdir, readFile, rm, symlink } from 'node:fs/promises';
import path from 'node:path';
import { dmgTools, runDmgTool as run } from './dmg-tools.mjs';

export async function detachDmg(mount) {
  let failure;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      run('/usr/bin/hdiutil', ['detach', mount]);
      return;
    } catch (error) {
      failure = error;
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }
  throw failure;
}
export function dmgLayout(tools, mode, mount) {
  return run('/usr/bin/python3', [
    '-I',
    '-B',
    path.join(workspace.platformRoot, 'scripts/dmg-layout.py'),
    mode,
    mount,
    tools.layout,
    ...tools.wheels,
  ]);
}
export async function withMountedDmg(image, mount, action, readonly = false) {
  let mounted = false;
  const emergencyDetach = () => {
    if (mounted) run('/usr/bin/hdiutil', ['detach', mount]);
    mounted = false;
  };
  // Detach before the package/test owner's signal handler removes its staging directory.
  for (const signal of ['SIGINT', 'SIGTERM', 'exit'])
    process.prependOnceListener(signal, emergencyDetach);
  try {
    run('/usr/bin/hdiutil', [
      'attach',
      '-nobrowse',
      '-noautoopen',
      '-owners',
      'off',
      ...(readonly ? ['-readonly'] : []),
      '-mountpoint',
      mount,
      image,
    ]);
    mounted = true;
    return await action(mount);
  } finally {
    if (mounted) await detachDmg(mount);
    mounted = false;
    for (const signal of ['SIGINT', 'SIGTERM', 'exit'])
      process.removeListener(signal, emergencyDetach);
  }
}
export async function createMacDmg(app, target, stage, version) {
  if (await lstat(target).catch(() => null)) throw Error('DMG target already exists');
  if (path.basename(app) !== 'VoxCue.app') throw Error('Expected VoxCue.app');
  const tools = await dmgTools();
  const source = path.join(stage, 'dmg-image');
  const mount = path.join(stage, 'dmg-mount');
  const writable = path.join(stage, 'writable.dmg');
  await mkdir(source);
  await mkdir(mount);
  await mkdir(path.join(source, '.background'));
  await cp(app, path.join(source, 'VoxCue.app'), { recursive: true, verbatimSymlinks: true });
  await symlink('/Applications', path.join(source, 'Applications'));
  run(tools.artwork, [tools.layout, tools.logo, source, '/Applications']);
  run('/usr/bin/tiffutil', [
    '-cathidpicheck',
    path.join(source, 'background.png'),
    path.join(source, 'background@2x.png'),
    '-out',
    path.join(source, '.background/background.tiff'),
  ]);
  // The PNGs are build inputs, not extra visible files on the installation disk.
  await rm(path.join(source, 'background.png'));
  await rm(path.join(source, 'background@2x.png'));
  run('/usr/bin/hdiutil', [
    'create',
    '-volname',
    `VoxCue ${version}`,
    '-fs',
    'HFS+',
    '-srcfolder',
    source,
    '-format',
    'UDRW',
    writable,
  ]);
  await withMountedDmg(writable, mount, () => {
    dmgLayout(tools, 'write', mount);
  });
  run('/usr/bin/hdiutil', ['convert', writable, '-format', 'UDZO', '-o', target]);
  run('/usr/bin/hdiutil', ['verify', target]);
  return { tools, layout: JSON.parse(await readFile(tools.layout, 'utf8')) };
}
