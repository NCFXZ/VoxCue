import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url),
  { SpeechController } = require('../../../dist-electron/windows/electron/speech/controller.js');
const helper = path.resolve('native/bin/VoxCue.Audio.exe'),
  model = path.resolve('local-models/speech');
const root = path.resolve('test/results', `speech-failure-${Date.now()}`);
await mkdir(root, { recursive: true });
await writeFile(
  path.join(root, 'manifest.json'),
  JSON.stringify({ files: { 'encoder.int8.onnx': { sha256: 'invalid' } } }),
);
await writeFile(path.join(root, 'encoder.int8.onnx'), 'bad');
let controller = new SpeechController(root, helper, () => {});
assert.equal(
  (await controller.call({ op: 'start', options: { sources: ['system'] } })).state,
  'error',
);
await controller.close();
const wait = async (predicate) => {
  const deadline = Date.now() + 7000;
  while (!predicate()) {
    if (Date.now() > deadline) throw Error('Recovery timeout');
    await new Promise((r) => setTimeout(r, 50));
  }
};
for (const failure of ['worker', 'capture']) {
  const statuses = [];
  controller = new SpeechController(model, helper, (e) => {
    if (e.type === 'status') statuses.push(e.status);
  });
  assert.equal(
    (await controller.call({ op: 'start', options: { sources: ['system'] } })).state,
    'running',
  );
  if (failure === 'worker') await controller.worker.terminate();
  else controller.captures.get('system').child.kill();
  await wait(() => statuses.some((s) => s.state === 'error') && controller.captures.size === 0);
  await controller.close();
}
await writeFile(
  path.join(root, 'results.json'),
  JSON.stringify({
    corruptModelRejected: true,
    noMockFallback: true,
    workerCrashReleasesCapture: true,
    captureCrashStopsAndReports: true,
  }),
);
console.log('Speech failure cleanup passed', root);
