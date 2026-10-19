import workspace from './workspace.mjs';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { generatedFiles, lockOutput, replaceGeneratedOutput } from './electron-output.mjs';

const { platformRoot, platformName, platformRequire } = workspace;
const output = path.join(platformRoot, 'dist-electron');
const release = await lockOutput(output);
let temporary;
let preserve = false;
const allowed = new Set(['shared', platformName]);

try {
  temporary = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'voxcue-electron-build-'));
  const stage = path.join(temporary, 'stage');
  const previous = path.join(temporary, 'previous');
  await fs.mkdir(stage);
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
  await generatedFiles(stage);
  await replaceGeneratedOutput(stage, output, previous);
  console.log(`Electron output: shared + ${platformName} only.`);
} catch (error) {
  preserve = error.preserveBackup === true;
  throw error;
} finally {
  try {
    if (temporary && !preserve) await fs.rm(temporary, { recursive: true, force: true });
  } finally {
    await release();
  }
}
