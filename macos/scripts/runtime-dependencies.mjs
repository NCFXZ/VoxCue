import workspace from '../../shared/scripts/workspace.mjs';
import { copyFile, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';

// Reconstruct the frozen production graph outside File Provider's installed
// tree. This copies authenticated store entries, never numbered Finder copies
// or undeclared stale files. Installed packages and their original files stay.
export async function stageRuntimeDependencies(output) {
  const directory = path.join(output, 'runtime-dependencies');
  await mkdir(output, { recursive: true });
  await mkdir(directory);
  try {
    const root = workspace.platformRoot;
    const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
    // Root development scripts do not belong to this temporary runtime install.
    manifest.scripts = {};
    await writeFile(path.join(directory, 'package.json'), JSON.stringify(manifest));
    await copyFile(path.join(root, 'pnpm-lock.yaml'), path.join(directory, 'pnpm-lock.yaml'));
    const yaml = workspace.platformRequire('js-yaml');
    const config = yaml.load(await readFile(path.join(root, 'pnpm-workspace.yaml'), 'utf8'));
    config.storeDir = path.join(root, '.pnpm-store');
    await writeFile(path.join(directory, 'pnpm-workspace.yaml'), yaml.dump(config));
    const child = spawn(
      'corepack',
      ['pnpm', 'install', '--prod', '--offline', '--frozen-lockfile', '--ignore-scripts'],
      { cwd: directory, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let diagnostic = '';
    for (const stream of [child.stdout, child.stderr])
      stream.on('data', (chunk) => (diagnostic = (diagnostic + chunk).slice(-6000)));
    const stopChild = () => child.kill('SIGTERM');
    process.once('exit', stopChild);
    const timer = setTimeout(() => child.kill('SIGTERM'), 180000);
    const code = await new Promise((resolve, reject) => {
      child.once('exit', resolve);
      child.once('error', reject);
    }).finally(() => {
      clearTimeout(timer);
      process.removeListener('exit', stopChild);
    });
    if (code !== 0) throw Error('Frozen offline runtime install failed: ' + diagnostic);
    // Node resolves package paths through /var's /private/var alias. Compare
    // against the same canonical root so the escape guard remains strict.
    return await realpath(directory);
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}
