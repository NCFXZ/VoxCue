import { testRoot, spawnTestProcess } from '../../../shared/test/scripts/test-workspace.mjs';
import { mkdir, mkdtemp, writeFile, copyFile } from 'node:fs/promises';
import path from 'node:path';

import { prepareRuntime } from '../../scripts/prepare-runtime.mjs';
await mkdir(path.join(testRoot, 'test/results'), { recursive: true });
const output = await mkdtemp(path.resolve(path.join(testRoot, 'test/results/audio-native-')));
const runtime = await prepareRuntime();
// Public synthetic input only. Captured microphone/system PCM is never written.
const rate = 44100,
  frames = rate * 2;
const tone = Buffer.alloc(44 + frames * 2);
tone.write('RIFF');
tone.writeUInt32LE(tone.length - 8, 4);
tone.write('WAVEfmt ', 8);
tone.writeUInt32LE(16, 16);
tone.writeUInt16LE(1, 20);
tone.writeUInt16LE(1, 22);
tone.writeUInt32LE(rate, 24);
tone.writeUInt32LE(rate * 2, 28);
tone.writeUInt16LE(2, 32);
tone.writeUInt16LE(16, 34);
tone.write('data', 36);
tone.writeUInt32LE(frames * 2, 40);
for (let i = 0; i < frames; i++)
  tone.writeInt16LE(Math.round(5000 * Math.sin((i * 2 * Math.PI * 997) / rate)), 44 + i * 2);
await writeFile(path.join(output, 'synthetic-tone.wav'), tone);
await writeFile(
  path.join(output, 'package.json'),
  JSON.stringify({ name: 'voxcue-native-audio-test', version: '1.0.0', main: 'main.cjs' }),
);
await writeFile(path.join(output, 'config.json'), JSON.stringify({ root: process.cwd(), output }));
await copyFile(path.resolve('test/scripts/audio-native-main.cjs'), path.join(output, 'main.cjs'));
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawnTestProcess(runtime.executable, [output], {
  env,
  stdio: ['ignore', 'pipe', 'pipe'],
});
let log = '';
child.stdout.on('data', (data) => {
  log += data;
  process.stdout.write(data);
});
child.stderr.on('data', (data) => {
  log += data;
});
const timer = setTimeout(() => child.kill(), 240000);
const code = await new Promise((resolve, reject) => {
  child.on('exit', resolve);
  child.on('error', reject);
});
clearTimeout(timer);
await console.log(log);
console.log(output);
if (code) process.exitCode = 1;
