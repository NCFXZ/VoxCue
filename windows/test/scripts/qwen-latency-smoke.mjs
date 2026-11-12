import assert from 'node:assert/strict';
import { access, copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import workspace from '../../../shared/scripts/workspace.mjs';
import { testRoot, spawnTestProcess } from '../../../shared/test/scripts/test-workspace.mjs';
import { verifyCachedComponent } from '../../../shared/test/scripts/verify-model-cache.mjs';
import { prepareQwenAudio } from './qwen-fixtures.mjs';
import { probe, holdDesktopAwake } from './window-probe.mjs';

assert.equal(process.platform, 'win32');
const options = Object.fromEntries(process.argv.slice(2).map((argument) => {
  const match = /^--(seconds|device)=(.+)$/.exec(argument);
  assert.ok(match, 'Use --seconds=60|120 --device=cpu|cuda');
  return match.slice(1);
}));
const seconds = options.seconds ?? '60';
const device = options.device ?? 'cpu';
assert.ok(['60', '120'].includes(seconds) && ['cpu', 'cuda'].includes(device));
assert.equal(probe('desktop').interactive, true, 'Native inference requires the unlocked owner console');
const releaseAwake = await holdDesktopAwake();
let child;
let deadline;
let desktopMonitor;
let desktopFailure;
try {
  const compiled = path.join(workspace.platformRoot, 'dist-electron/shared/electron/backend/components');
  const { packagesFor } = workspace.platformRequire(path.join(compiled, 'catalog.js'));
  const { componentLocation } = workspace.platformRequire(path.join(compiled, 'service.js'));
  const pkg = packagesFor('win32', 'x64').find((value) => value.id === 'qwen');
  const source = componentLocation(path.join(workspace.platformRoot, '.cache/test-components'), pkg);
  await verifyCachedComponent(source, pkg);
  // Do not make prepareQwenAudio enter its download branch in this measurement.
  const publicAudio = path.join(workspace.platformRoot, '.cache/test-public-audio/qwen-c5ef09646af6278d2ba8b8ceaf543ffb32d1a5dc');
  for (const name of ['sample1', 'sample4', 'sample5'])
    for (const suffix of ['.wav', '.txt']) await access(path.join(publicAudio, name + suffix));
  const directory = path.join(testRoot, 'qwen');
  for (const file of pkg.files) {
    assert.ok(file.path.startsWith('qwen/'));
    const destination = path.join(directory, file.path.slice('qwen/'.length));
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(path.join(source, 'files', file.path), destination);
  }
  const { corpus } = await prepareQwenAudio();
  const wave = corpus.find((item) => item.id === 'sample4').continuous;
  assert.equal(probe('desktop').interactive, true);
  child = spawnTestProcess(process.env.VOXCUE_PYTHON ?? 'python', [
    'test/scripts/qwen-native-smoke.py', directory, '--device', device,
    '--wave', wave, '--duration-seconds', seconds, '--latency',
  ], { stdio: 'inherit', windowsHide: true });
  deadline = setTimeout(() => child.kill(), 900000);
  desktopMonitor = setInterval(() => {
    try {
      assert.equal(probe('desktop').interactive, true, 'Owner console locked during native inference');
    } catch (error) {
      desktopFailure = error;
      child.kill();
    }
  }, 1000);
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', resolve);
  });
  if (desktopFailure) throw desktopFailure;
  assert.equal(code, 0, 'Fixed public-audio latency probe failed');
  await verifyCachedComponent(source, pkg);
  console.log('PASS fixed-cache latency measurement; a crop/reset bounds the observed window and does not establish the 120s uncropped worst case.');
} finally {
  clearTimeout(deadline);
  clearInterval(desktopMonitor);
  if (child && child.exitCode === null && child.signalCode === null) child.kill();
  await releaseAwake();
}
