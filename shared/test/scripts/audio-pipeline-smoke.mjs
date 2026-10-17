import { writeFile, copyFile } from 'node:fs/promises';
import path from 'node:path';
import workspace from '../../scripts/workspace.mjs';
import { testRoot, spawnTestProcess } from './test-workspace.mjs';
const root = workspace.platformRoot;
await writeFile(
  path.join(testRoot, 'package.json'),
  JSON.stringify({ name: 'voxcue-audio-pipeline-test', version: '1.0.0', main: 'main.cjs' }),
);
const config = path.join(testRoot, 'config.json');
await writeFile(
  config,
  JSON.stringify({
    root,
    output: testRoot,
    model: path.join(workspace.sharedRoot, 'local-models/speech'),
    processFile: path.join(workspace.sharedRoot, 'test/fixtures/audio-pipeline-process.cjs'),
  }),
);
await copyFile(
  path.join(workspace.sharedRoot, 'test/fixtures/audio-pipeline-main.cjs'),
  path.join(testRoot, 'main.cjs'),
);
const env = { ...process.env, VOXCUE_PIPELINE_CONFIG: config };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawnTestProcess(workspace.platformRequire('electron'), [testRoot], {
  cwd: root,
  env,
  stdio: ['ignore', 'pipe', 'pipe'],
});
child.stdout.on('data', (data) => process.stdout.write(data));
child.stderr.on('data', (data) => process.stderr.write(data));
const timer = setTimeout(() => child.kill(), 120000);
const code = await new Promise((resolve, reject) => {
  child.once('exit', resolve);
  child.once('error', reject);
}).finally(() => clearTimeout(timer));
if (code !== 0) throw Error('Real utilityProcess/ASR pipeline failed');
