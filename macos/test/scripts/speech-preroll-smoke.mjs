import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import workspace from '../../../shared/scripts/workspace.mjs';
import { testRoot, spawnTestProcess } from '../../../shared/test/scripts/test-workspace.mjs';
import { stageModelFixtures } from '../../../shared/test/scripts/model-fixtures.mjs';
import { watchTestDesktop } from '../../../shared/test/scripts/desktop-guard.mjs';
import { prepareSpeechBoundaryAudio } from './filler-audio-fixtures.mjs';
import { holdDesktopAwake, requireUnlockedDesktop } from './desktop-session.mjs';

assert.equal(process.platform, 'darwin');
assert.equal(process.arch, 'arm64');
const args = process.argv.slice(2);
assert.ok(args.every((argument) => /^--(?:cache|voice)=.+/.test(argument)));
const option = (name, fallback) =>
  args.find((argument) => argument.startsWith('--' + name + '='))?.slice(name.length + 3) ?? fallback;
const cache = option('cache', process.env.VOXCUE_TEST_COMPONENT_CACHE);
assert.ok(cache, 'Pass the explicitly authorized public model cache with --cache=');
const releaseAwake = holdDesktopAwake();
try {
  const backend = path.join(workspace.platformRoot, 'dist-electron/shared/electron/backend');
  const { packagesFor } = workspace.platformRequire(path.join(backend, 'components/catalog.js'));
  const { componentLocation } = workspace.platformRequire(path.join(backend, 'components/service.js'));
  const packages = packagesFor(process.platform, process.arch).filter((item) => item.id === 'speech');
  assert.equal(packages.length, 1);
  const staged = path.join(testRoot, 'verified-models');
  await stageModelFixtures(path.resolve(cache), staged, packages, componentLocation);
  const audio = await prepareSpeechBoundaryAudio({ voice: option('voice', 'Tingting') });
  const config = path.join(testRoot, 'speech-preroll.json');
  await writeFile(config, JSON.stringify({
    root: testRoot,
    models: path.join(componentLocation(staged, packages[0]), 'files', packages[0].directory),
    audio,
  }), { flag: 'wx', mode: 0o600 });
  requireUnlockedDesktop();
  const child = spawnTestProcess(process.execPath, [
    fileURLToPath(new URL('../fixtures/speech-preroll.cjs', import.meta.url)), config,
  ], { stdio: 'inherit' });
  const desktop = watchTestDesktop(child, requireUnlockedDesktop);
  let force;
  const timeout = setTimeout(() => {
    child.kill('SIGTERM');
    force = setTimeout(() => child.kill('SIGKILL'), 5000);
  }, 240000);
  try {
    const [code, signal] = await once(child, 'close');
    if (desktop.failure) throw desktop.failure;
    assert.equal(signal, null, 'The owned ASR fixture must retire normally');
    assert.equal(code, 0, 'The real Worker must preserve question ownership and its first/last words');
  } finally {
    clearTimeout(timeout);
    clearTimeout(force);
    desktop.release();
  }
} finally {
  releaseAwake();
}
