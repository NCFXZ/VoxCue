import workspace from '../../shared/scripts/workspace.mjs';
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { release } from 'node:os';

if (workspace.platformName !== 'macos' || process.arch !== 'arm64')
  throw Error('SF Symbols generation requires Apple Silicon macOS.');
const root = workspace.platformRoot;
const map = path.join(root, 'src/symbols.json');
const code = path.join(root, 'native/SymbolBuilder.mm');
const output = path.join(root, 'public/sf-symbols');
const binary = path.join(root, '.tools/symbol-builder');
const marker = path.join(root, '.cache/symbol-revision.json');
const symbols = JSON.parse(await readFile(map, 'utf8'));
const expected = createHash('sha256')
  .update(await readFile(map))
  .update(await readFile(code))
  .update(release())
  .digest('hex');
const existing = await Promise.all(
  Object.keys(symbols).map((key) =>
    access(path.join(output, key + '.png')).then(
      () => true,
      () => false,
    ),
  ),
);
if ((await readFile(marker, 'utf8').catch(() => '')) !== expected || !existing.every(Boolean)) {
  for (const folder of [output, path.dirname(binary), path.dirname(marker)])
    await mkdir(folder, { recursive: true });
  const run = (command, args) => {
    const result = spawnSync(command, args, { stdio: 'inherit' });
    if (result.error) throw result.error;
    if (result.status) throw Error('Unable to generate Mac system symbols.');
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
    'AppKit',
    '-o',
    binary,
  ]);
  run(binary, [map, output]);
  await writeFile(marker, expected);
}
