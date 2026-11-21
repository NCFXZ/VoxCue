import assert from 'node:assert/strict';
import path from 'node:path';
import { access, copyFile, mkdir } from 'node:fs/promises';
import workspace from '../../../shared/scripts/workspace.mjs';
import { testRoot, spawnTestProcess } from '../../../shared/test/scripts/test-workspace.mjs';
import { verifyCachedComponent } from '../../../shared/test/scripts/verify-model-cache.mjs';
import { prepareQwenAudio } from './qwen-fixtures.mjs';
import { probe } from './window-probe.mjs';

// Explicit authorization is required. Never discover installed user data or
// call a mutating component service against the source cache.
assert.equal(process.platform, 'win32');
const requireUnlocked = () => assert.equal(
  probe('desktop').interactive, true, 'Native inference requires the unlocked owner console',
);
requireUnlocked();
assert.ok(process.env.VOXCUE_TEST_COMPONENT_CACHE, 'Specify an authorized model cache');
assert.ok(process.env.VOXCUE_PYTHON, 'Specify the development Python executable');
const compiled = path.join(
  workspace.platformRoot,
  'dist-electron/shared/electron/backend/components',
);
const { packagesFor } = workspace.platformRequire(path.join(compiled, 'catalog.js'));
const { componentLocation } = workspace.platformRequire(path.join(compiled, 'service.js'));
const pkg = packagesFor(process.platform, process.arch).find((pkg) => pkg.id === 'qwen');
const source = componentLocation(path.resolve(process.env.VOXCUE_TEST_COMPONENT_CACHE), pkg);
await verifyCachedComponent(source, pkg);
const directory = path.join(testRoot, 'qwen');
for (const file of pkg.files) {
  assert.ok(file.path.startsWith('qwen/'));
  const destination = path.join(directory, file.path.slice('qwen/'.length));
  await mkdir(path.dirname(destination), { recursive: true });
  // Test workers only receive independent copies. The authenticated source is
  // never writable through them; CUDA caches also stay in testRoot.
  await copyFile(path.join(source, 'files', file.path), destination);
}
console.log('PASS installed Qwen: fixed catalog verified; isolated copy, no model download');
const { corpus } = await prepareQwenAudio();
const wave = corpus.find((item) => item.id === 'sample1').audio;
const run = async (file, args) => {
  requireUnlocked();
  const child = spawnTestProcess(file, args, { stdio: 'inherit', windowsHide: true });
  const timer = setTimeout(() => child.kill(), 600000);
  let desktopFailure;
  const monitor = setInterval(() => {
    try {
      requireUnlocked();
    } catch (error) {
      desktopFailure = error;
      child.kill();
    }
  }, 1000);
  try {
    const code = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', resolve);
    });
    if (desktopFailure) throw desktopFailure;
    assert.equal(code, 0, args[0]);
  } finally {
    clearInterval(monitor);
    clearTimeout(timer);
  }
};
for (const device of ['cpu', 'cuda']) {
  await run(process.env.VOXCUE_PYTHON, [
    'test/scripts/qwen-native-smoke.py',
    directory,
    '--device',
    device,
    '--wave',
    wave,
  ]);
  await run(process.execPath, [
    'test/scripts/qwen-worker-smoke.mjs',
    directory,
    wave,
    device,
    '--no-crop',
  ]);
}
await run(process.execPath, [
  'test/scripts/speech-switch-smoke.mjs',
  directory,
  wave,
  '--skip-dual',
]);
const heldFiles = [
  'asr/model.safetensors',
  'aligner/model.gguf',
  'runtime/speech.dll',
  'runtime/voxcue-qwen.exe',
  'runtime/voxcue-qwen-cpu.exe',
];
for (const file of heldFiles) await access(path.join(directory, file));
assert.equal(
  probe('exclusive', ...heldFiles.map((file) => path.join(directory, file))).exclusiveFiles,
  heldFiles.length,
);
await verifyCachedComponent(source, pkg);
console.log(
  'PASS installed Windows Qwen: CPU/CUDA, native/production Worker, six switches, exclusive handles and source hashes unchanged; installed models preserved',
);
