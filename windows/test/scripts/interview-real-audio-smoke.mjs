import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import workspace from '../../../shared/scripts/workspace.mjs';
import { testRoot, spawnTestProcess } from '../../../shared/test/scripts/test-workspace.mjs';
import { watchTestDesktop } from '../../../shared/test/scripts/desktop-guard.mjs';
import { probe } from './window-probe.mjs';
import { stageModelFixtures, prepareSpeechFixtures } from '../../../shared/test/scripts/model-fixtures.mjs';
import { prepareFillerAudio } from './filler-audio-fixtures.mjs';

assert.equal(process.platform, 'win32', 'This native end-to-end fixture runs only on Windows');
const args = process.argv.slice(2);
assert.ok(
  args.every((arg) => arg === '--all' || /^--(?:model|cache|voice|cases)=/.test(arg)),
  'Unknown fixture argument',
);
const option = (name, fallback) =>
  args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const model = option('model', 'paraformer');
assert.ok(['paraformer', 'qwen'].includes(model));
const cache = option('cache', process.env.VOXCUE_TEST_COMPONENT_CACHE);
assert.ok(cache, 'Pass the explicitly authorized public model cache with --cache=');
const compiled = path.join(workspace.platformRoot, 'dist-electron/shared/electron');
const { packagesFor } = workspace.platformRequire(
  path.join(compiled, 'backend/components/catalog.js'),
);
const { componentLocation } = workspace.platformRequire(
  path.join(compiled, 'backend/components/service.js'),
);
const packages = packagesFor(process.platform, process.arch).filter(
  (pkg) => pkg.id === 'speech' || (model === 'qwen' && pkg.id === 'qwen'),
);
const staged = path.join(testRoot, 'verified-models');
console.log(`Verifying and staging public ${model} model inputs; cache remains read-only.`);
await stageModelFixtures(path.resolve(cache), staged, packages, componentLocation);
const location = (id) => {
  const pkg = packages.find((pkg) => pkg.id === id);
  return pkg ? path.join(componentLocation(staged, pkg), 'files', pkg.directory) : undefined;
};
const generated = await prepareFillerAudio({ voice: option('voice', 'Huihui') });
const requestedCases = option('cases')?.split(',');
if (requestedCases)
  assert.ok(requestedCases.every((id) => generated.some((item) => item.id === id)));
const selected = generated.filter((item) =>
  requestedCases
    ? requestedCases.includes(item.id)
    : args.includes('--all') || ['ack', 'question'].includes(item.id),
);
assert.ok(selected.length);
const groups = selected.map((item) => [item]);
const questionGroup = groups.find(([item]) => item.id === 'question');
if (model === 'paraformer' && questionGroup) {
  const [question] = questionGroup;
  const wave = path.join(await prepareSpeechFixtures(), 'chinese.wav');
  const sha256 = createHash('sha256').update(await readFile(wave)).digest('hex');
  questionGroup.unshift(
    { ...question, id: 'fresh-question' },
    { id: 'short-public-speech', kind: 'unaccepted', wave, sha256 },
  );
}
for (const item of groups.flat()) {
  const bytes = await readFile(item.wave);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), item.sha256);
  assert.ok(
    path.resolve(item.wave).startsWith(testRoot + path.sep),
    'WAV must belong to this test run',
  );
}
const common = {
  root: workspace.platformRoot,
  speechModels: location('speech'),
  qwenModels: location('qwen'),
  qwenRuntime: location('qwen')
    ? path.join(location('qwen'), 'runtime/voxcue-qwen-cpu.exe')
    : undefined,
  processFile: path.join(workspace.sharedRoot, 'test/fixtures/interview-real-audio-process.cjs'),
};
const outcomes = [];
const requireDesktop = () =>
  assert.equal(probe('desktop').interactive, true, 'Real-audio fixtures require the unlocked owner desktop');
for (const audio of groups) {
  requireDesktop();
  const id = audio.at(-1).id;
  const configFile = path.join(testRoot, 'real-audio-' + id + '.json');
  await writeFile(configFile, JSON.stringify({ ...common, audio, model }), { flag: 'wx' });
  const child = spawnTestProcess(process.execPath, [
    fileURLToPath(new URL('interview-real-audio-session.mjs', import.meta.url)), configFile,
  ], { stdio: 'inherit', windowsHide: true });
  const desktop = watchTestDesktop(child, requireDesktop);
  try {
    const [code, signal] = await once(child, 'close');
    if (desktop.failure) throw desktop.failure;
    outcomes.push({
      cases: audio.map((item) => ({
        id: item.id,
        expectation: item.kind === 'unaccepted' ? 'VAD rejection'
          : item.kind === 'filler' ? 'natural filler final and manual submission'
          : 'natural question final and automatic submission',
      })),
      passed: code === 0, code, signal,
    });
  } finally { desktop.release(); }
}
console.log(JSON.stringify({ model, outcomes }));
if (outcomes.some((outcome) => !outcome.passed)) process.exitCode = 1;
