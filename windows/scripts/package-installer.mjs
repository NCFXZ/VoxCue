import { build, Platform, Arch } from 'electron-builder';
import { spawn } from 'node:child_process';
import { writeFile, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import config from '../electron-builder.config.cjs';

const root = process.cwd();
// Builder's Windows default ignores XDG_CACHE_HOME. Keep NSIS/7-Zip downloads
// in this platform's dependency cache even without a shell activation script.
process.env.ELECTRON_BUILDER_CACHE = path.join(root, '.cache/electron-builder');
await new Promise((resolve, reject) => {
  const child = spawn(process.execPath, ['scripts/package-portable.mjs', '--installer'], {
    cwd: root,
    stdio: 'inherit',
    windowsHide: true,
  });
  child.once('error', reject);
  child.once('exit', (code) =>
    code === 0 ? resolve() : reject(Error(`Installer staging failed (${code})`)),
  );
});
const stage = path.resolve('release/installer-stage/VoxCue-win32-x64');
const actual = await realpath(stage);
if (path.relative(root, actual).startsWith('..') || path.isAbsolute(path.relative(root, actual)))
  throw Error('Installer staging escapes workspace');
const [source] = config.publish;
if (
  source.provider !== 'github' ||
  source.owner !== 'NCFXZ' ||
  source.repo !== 'VoxCue-releases' ||
  source.private !== false
)
  throw Error('Unexpected release source');
// prepackaged builds skip electron-builder's application packaging hook.
// JSON is valid YAML; electron-updater reads this fixed public feed without credentials.
await writeFile(
  path.join(stage, 'resources/app-update.yml'),
  JSON.stringify(
    {
      provider: source.provider,
      owner: source.owner,
      repo: source.repo,
      private: false,
      updaterCacheDirName: 'voxcue-updater',
      ...(config.win.publisherName ? { publisherName: config.win.publisherName } : {}),
    },
    null,
    2,
  ),
);
const artifacts = await build({
  targets: Platform.WINDOWS.createTarget('nsis', Arch.x64),
  prepackaged: stage,
  config,
  publish: 'never',
});
const metadata = await readFile(path.resolve(config.directories.output, 'latest.yml'), 'utf8');
if (!metadata.includes('sha512:') || !artifacts.some((file) => file.endsWith('.exe')))
  throw Error('Installer or update metadata missing');
console.log(
  JSON.stringify({ artifacts, feed: `${source.owner}/${source.repo}`, published: false }),
);
