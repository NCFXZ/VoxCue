import { testRoot, spawnTestProcess } from '../../../shared/test/scripts/test-workspace.mjs';
import workspace from '../../../shared/scripts/workspace.mjs';
import { stageModelFixtures } from '../../../shared/test/scripts/model-fixtures.mjs';
import { verifyCachedComponent } from '../../../shared/test/scripts/verify-model-cache.mjs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

// One authenticated temporary model set, serial native/Worker/switch checks,
// then actual release of handles and managed deletion. No user model cache.
const { ComponentService, componentPaths, componentLocation } = workspace.platformRequire(
  path.join(workspace.platformRoot, 'dist-electron/shared/electron/backend/components/service.js'),
);
const { packagesFor } = workspace.platformRequire(
  path.join(workspace.platformRoot, 'dist-electron/shared/electron/backend/components/catalog.js'),
);
const models = path.join(testRoot, 'models');
const packages = packagesFor('darwin', 'arm64');
const cacheSource = process.env.VOXCUE_TEST_COMPONENT_CACHE;
const cachedPackages = packages.filter((pkg) => ['speech', 'qwen'].includes(pkg.id));
let previous;
const service = new ComponentService({
  root: models,
  packages,
  managed: true,
  fetch,
  emit(state) {
    const item = state.items.find((item) => ['downloading', 'verifying'].includes(item.phase));
    const status = item
      ? `${item.id} ${item.phase} ${Math.floor(item.received / 500000000) * 500} MB`
      : state.phase;
    if (status !== previous) console.log('Temporary Mac models: ' + (previous = status));
  },
});
async function run(name, args, env = process.env) {
  console.log('START ' + name);
  const child = spawnTestProcess(
    process.execPath,
    [path.join(workspace.platformRoot, 'test/scripts', name + '.mjs'), ...args],
    { cwd: workspace.platformRoot, env, stdio: 'inherit' },
  );
  const timer = setTimeout(() => child.kill('SIGTERM'), 12 * 60 * 1000);
  const code = await new Promise((resolve, reject) => {
    child.once('exit', resolve);
    child.once('error', reject);
  }).finally(() => clearTimeout(timer));
  assert.equal(code, 0, name + ' failed');
  console.log('PASS ' + name);
}
try {
  if (cacheSource)
    await stageModelFixtures(path.resolve(cacheSource), models, cachedPackages, componentLocation);
  for (const id of ['speech', 'qwen']) {
    await service.download(id);
    assert.equal(service.ready(id), true, service.state().error);
  }
  const paths = componentPaths(models, packages);
  const fixture = path.join(testRoot, 'switch-fixture.json');
  await writeFile(fixture, JSON.stringify({ root: testRoot, models }));
  await run('qwen-native-smoke', [paths.qwenModels]);
  await run('qwen-worker-smoke', [paths.qwenModels]);
  await run('speech-switch-smoke', ['--fixture=' + fixture]);
  await run('components-smoke', [], {
    ...process.env,
    VOXCUE_TEST_QWEN_MODELS: paths.qwenModels,
  });
  const removal = path.join(testRoot, 'removal-fixture.json');
  await writeFile(removal, JSON.stringify({ testRoot, root: models, component: paths.qwenModels }));
  await run('qwen-removal-smoke', [removal]);
} finally {
  service.dispose();
  if (cacheSource)
    for (const pkg of cachedPackages)
      await verifyCachedComponent(componentLocation(path.resolve(cacheSource), pkg), pkg);
}
