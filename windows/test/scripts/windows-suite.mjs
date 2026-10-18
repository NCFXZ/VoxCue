import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { testRoot, spawnTestProcess } from '../../../shared/test/scripts/test-workspace.mjs';

assert.equal(process.platform, 'win32');
const fixtures = path.join(testRoot, 'public-audio');
await mkdir(fixtures);
// Fixed public inputs, never microphone/loopback recordings. Names are fixture
// roles only; these checks do not claim English/Chinese recognition accuracy.
for (const [name, index] of [
  ['chinese.wav', 0],
  ['english.wav', 1],
]) {
  const response = await fetch(
    'https://huggingface.co/csukuangfj/sherpa-onnx-streaming-paraformer-bilingual-zh-en/resolve/8e40c43232a1c5c66c82111efc5820d3accca11b/test_wavs/' +
      index +
      '.wav',
  );
  if (!response.ok) throw Error('Public audio HTTP ' + response.status);
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
  await writeFile(path.join(fixtures, name), bytes);
}
const suites = process.argv.slice(2),
  windowsOnly = suites[0] === '--windows';
const commands = windowsOnly
  ? [
      'platform-native',
      'interview-access',
      'interview-effort',
      'interview-layout',
      'interview-workflow',
      'interview-context',
      'copilot',
      'updates-native',
    ].map((name) => ['test/scripts/' + name + '-smoke.mjs'])
  : [['../shared/test/scripts/functional-suite.mjs', ...suites]];
let failed = false;
for (const args of commands) {
  const child = spawnTestProcess(process.execPath, args, {
    env: { ...process.env, VOXCUE_SPEECH_FIXTURE_DIR: fixtures },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let output = '';
  child.stdout.on('data', (data) => (output += data));
  child.stderr.on('data', (data) => (output += data));
  const timer = setTimeout(() => child.kill(), windowsOnly ? 180000 : 900000);
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', resolve);
  }).finally(() => clearTimeout(timer));
  if (windowsOnly) {
    console.log((code === 0 ? 'PASS ' : 'FAIL ') + args[0]);
    if (code !== 0) console.error(output);
  } else process.stdout.write(output);
  if (code !== 0) failed = true;
}
if (failed) process.exitCode = 1;
