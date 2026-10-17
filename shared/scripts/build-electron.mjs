import workspace from './workspace.mjs';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

const { platformRoot, platformName, platformRequire } = workspace;
const output = path.join(platformRoot, 'dist-electron');
const cache = path.join(platformRoot, '.cache');
await fs.mkdir(cache, { recursive: true });
const stage = await fs.mkdtemp(path.join(cache, 'electron-build-'));
const previous = stage + '-previous';
const allowed = new Set(['shared', platformName]);

async function inspect(directory, generated = false) {
  const files = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw Error(`Refusing redirected build path: ${file}`);
    if (entry.isDirectory()) files.push(...(await inspect(file, generated)));
    else if (entry.isFile()) {
      if (generated && !/\.(?:js|map|json)$/.test(entry.name) && entry.name !== '.DS_Store')
        throw Error(`Unexpected non-generated file in Electron output: ${file}`);
      files.push(file);
    } else throw Error(`Unexpected build entry: ${file}`);
  }
  return files;
}

try {
  const compile = spawnSync(
    process.execPath,
    [
      platformRequire.resolve('typescript/bin/tsc'),
      '-p',
      path.join(platformRoot, 'tsconfig.electron.json'),
      '--outDir',
      stage,
    ],
    { cwd: platformRoot, stdio: 'inherit' },
  );
  if (compile.error) throw compile.error;
  if (compile.status !== 0) throw Error(`Electron compilation failed (${compile.status}).`);
  for (const entry of await fs.readdir(stage))
    if (!allowed.has(entry)) throw Error(`Foreign platform emitted into ${platformName}: ${entry}`);
  await fs.access(path.join(stage, 'shared/electron/main.js'));
  await fs.access(path.join(stage, platformName, 'electron/speech/process.js'));
  await inspect(stage, true);
  const old = await fs.lstat(output).catch((error) => {
    if (error.code !== 'ENOENT') throw error;
  });
  if (old) {
    if (old.isSymbolicLink() || !old.isDirectory())
      throw Error('Electron output must be a local directory.');
    const files = await inspect(output, true);
    await fs.writeFile(
      path.join(stage, '..', 'electron-build-cleanup-plan.json'),
      JSON.stringify(
        {
          platform: platformName,
          output,
          replaceGeneratedFiles: files,
        },
        null,
        2,
      ) + '\n',
    );
    await fs.rename(output, previous);
  }
  try {
    await fs.rename(stage, output);
  } catch (error) {
    if (old) await fs.rename(previous, output);
    throw error;
  }
  if (old) await fs.rm(previous, { recursive: true });
  console.log(`Electron output: shared + ${platformName} only.`);
} finally {
  await fs.rm(stage, { recursive: true, force: true });
}
