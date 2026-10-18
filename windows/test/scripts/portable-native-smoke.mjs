import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { testRoot, spawnTestProcess } from '../../../shared/test/scripts/test-workspace.mjs';

assert.equal(process.platform, 'win32');
const installerStage = process.argv.includes('--installer-stage');
const output = path.join(testRoot, 'platform-layout-portable'),
  fixtures = path.join(testRoot, 'public-audio');
await mkdir(fixtures);
const response = await fetch(
  'https://huggingface.co/csukuangfj/sherpa-onnx-streaming-paraformer-bilingual-zh-en/resolve/8e40c43232a1c5c66c82111efc5820d3accca11b/test_wavs/0.wav',
);
if (!response.ok) throw Error('Public audio HTTP ' + response.status);
await writeFile(path.join(fixtures, 'english.wav'), Buffer.from(await response.arrayBuffer()));
async function run(file, args, timeout) {
  const child = spawnTestProcess(process.execPath, [file, ...args], {
    env: { ...process.env, VOXCUE_SPEECH_FIXTURE_DIR: fixtures },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  child.stdout.on('data', (data) => process.stdout.write(data));
  child.stderr.on('data', (data) => process.stderr.write(data));
  const timer = setTimeout(() => child.kill(), timeout);
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', resolve);
  }).finally(() => clearTimeout(timer));
  assert.equal(code, 0, file + ' failed');
}
if (!installerStage) await run('scripts/package-portable.mjs', ['--test-output=' + output], 600000);
const packageArgs = installerStage
  ? ['--installer-stage']
  : ['--test-package=' + path.join(output, 'VoxCue-win32-x64')];
await run('test/scripts/packaged-smoke.mjs', packageArgs, 180000);
await run('test/scripts/presentation-native-smoke.mjs', packageArgs, 180000);
console.log(
  JSON.stringify({
    status: 'passed',
    package: installerStage ? 'installer-stage' : 'isolated-portable',
    installed: false,
    published: false,
  }),
);
