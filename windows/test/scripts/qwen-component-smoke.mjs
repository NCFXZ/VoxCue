import assert from 'node:assert/strict';
import path from 'node:path';
import { access, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import workspace from '../../../shared/scripts/workspace.mjs';
import { testRoot, spawnTestProcess } from '../../../shared/test/scripts/test-workspace.mjs';
import { prepareQwenAudio } from './qwen-fixtures.mjs';
import { probe } from './window-probe.mjs';

// Only the active, compiled production catalog and public resources are used.
// Never discover or migrate installed userData/model caches.
assert.equal(process.platform, 'win32');
const compiled = path.join(
  workspace.platformRoot,
  'dist-electron/shared/electron/backend/components',
);
const { packagesFor } = workspace.platformRequire(path.join(compiled, 'catalog.js'));
const { qwenPackage: legacy } = workspace.platformRequire(path.join(compiled, 'qwen-catalog.js'));
const { ComponentService, componentLocation } = workspace.platformRequire(
  path.join(compiled, 'service.js'),
);
const pkg = packagesFor('win32', 'x64').find((pkg) => pkg.id === 'qwen');
assert.equal(pkg.version, '1.0.1');
assert.equal(pkg.parts.at(-1).asset, 'VoxCue-Qwen-Windows-x64-Runtime-1.0.1.zip');
const root = path.join(testRoot, 'components');
const legacyRoot = componentLocation(root, legacy);
await mkdir(legacyRoot, { recursive: true });
const sentinel = path.join(legacyRoot, 'synthetic-old-cache');
await writeFile(sentinel, 'preserve prior cache');
let cancelOnce = true,
  previous;
const service = new ComponentService({
  root,
  packages: [pkg],
  managed: true,
  fetch,
  emit(state) {
    const item = state.items[0];
    const progress = `${item.phase} ${Math.floor((item.received / item.bytes) * 10) * 10}%`;
    if (progress !== previous) console.log('Published Qwen: ' + (previous = progress));
    if (cancelOnce && item.phase === 'downloading' && item.received >= 8 * 1024 * 1024) {
      cancelOnce = false;
      void service.cancel();
    }
  },
});
const run = async (file, args) => {
  const child = spawnTestProcess(file, args, { stdio: 'inherit', windowsHide: true });
  const timer = setTimeout(() => child.kill(), 600000);
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', resolve);
  }).finally(() => clearTimeout(timer));
  assert.equal(code, 0, args[0]);
};
try {
  assert.equal((await service.download('qwen')).phase, 'cancelled');
  assert.equal(service.ready('qwen'), false);
  await assert.rejects(access(componentLocation(root, pkg)), { code: 'ENOENT' });
  assert.deepEqual(await readdir(root), [path.basename(legacyRoot)]);
  assert.equal(await readFile(sentinel, 'utf8'), 'preserve prior cache');
  console.log(
    'PASS cancelled public download: no half component or staging; prior cache preserved',
  );

  await service.download('qwen');
  assert.equal(service.ready('qwen'), true, service.state().error);
  const directory = path.join(componentLocation(root, pkg), 'files/qwen');
  await access(path.join(directory, 'aligner/model.gguf'));
  await assert.rejects(access(path.join(directory, 'aligner/model.safetensors')), {
    code: 'ENOENT',
  });
  const reused = new ComponentService({
    root,
    packages: [pkg],
    managed: true,
    fetch: async () => {
      throw Error('A verified cache must not download again');
    },
    emit() {},
  });
  try {
    await reused.status();
    assert.equal(reused.ready('qwen'), true);
  } finally {
    reused.dispose();
  }
  console.log(
    'PASS production catalog: three public archives authenticated; complete cache reused offline',
  );

  const { corpus } = await prepareQwenAudio();
  const wave = corpus.find((item) => item.id === 'sample1').audio;
  for (const device of ['cpu', 'cuda']) {
    await run(process.env.VOXCUE_PYTHON ?? 'python', [
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
  ].map((file) => path.join(directory, file));
  for (const file of heldFiles) await access(file);
  assert.equal(probe('exclusive', ...heldFiles).exclusiveFiles, heldFiles.length);
  await service.remove('qwen');
  assert.equal(service.ready('qwen'), false, service.state().error);
  await assert.rejects(access(componentLocation(root, pkg)), { code: 'ENOENT' });
  assert.equal(await readFile(sentinel, 'utf8'), 'preserve prior cache');
  console.log(
    'PASS published Windows Qwen 1.0.1: cancellation, atomic authentication, offline reuse, CPU/CUDA/native Worker, six switches, actual file release and removal; prior cache preserved',
  );
} finally {
  service.dispose();
}
