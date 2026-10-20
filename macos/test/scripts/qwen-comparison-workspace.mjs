// Owned temporary tools/models for the M3 Pro comparison. This holds no results.
import { testRoot, spawnTestProcess } from '../../../shared/test/scripts/test-workspace.mjs';
import workspace from '../../../shared/scripts/workspace.mjs';
import { mkdir, writeFile, readFile, cp } from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline';
import assert from 'node:assert/strict';

if (process.argv[2] !== '--prepare')
  throw Error('Use --prepare; enter quit to release all temporary fixtures');
const python = process.env.VOXCUE_PYTHON;
if (!python || !path.isAbsolute(python))
  throw Error('Set VOXCUE_PYTHON to an absolute developer Python 3.12+');
const paths = {
  root: testRoot,
  models: path.join(testRoot, 'models'),
  tools: path.join(testRoot, 'tools'),
  venv: path.join(testRoot, 'venv'),
  source: path.join(testRoot, 'mlx-source'),
  cargoHome: path.join(testRoot, 'cargo-home'),
  target: path.join(testRoot, 'target'),
  vadBuild: path.join(testRoot, 'vad-build'),
  corpus: path.join(testRoot, 'corpus'),
};
await mkdir(paths.tools);
await mkdir(paths.corpus);
const marker = JSON.parse(
  await readFile(path.join(workspace.platformRoot, 'native/bin/qwen/build.json'), 'utf8'),
);
for (const file of Object.keys(marker.files)) {
  const dest = path.join(testRoot, 'baseline', file);
  await mkdir(path.dirname(dest), { recursive: true });
  await cp(path.join(workspace.platformRoot, 'native/bin/qwen', file), dest);
}
await writeFile(path.join(testRoot, 'fixture.json'), JSON.stringify(paths));
console.log('FIXTURE:' + path.join(testRoot, 'fixture.json'));
const { ComponentService, componentPaths } = workspace.platformRequire(
  path.join(workspace.platformRoot, 'dist-electron/shared/electron/backend/components/service.js'),
);
const { packagesFor } = workspace.platformRequire(
  path.join(workspace.platformRoot, 'dist-electron/shared/electron/backend/components/catalog.js'),
);
const packages = packagesFor('darwin', 'arm64');
let last = '';
const service = new ComponentService({
  root: paths.models,
  packages,
  managed: true,
  fetch,
  emit(state) {
    const item = state.items.find((item) => ['downloading', 'verifying'].includes(item.phase));
    const progress = item
      ? `${item.id}: ${item.phase} ${Math.floor(item.received / 500000000) * 500} MB`
      : state.phase;
    if (progress !== last) {
      console.log(progress);
      last = progress;
    }
  },
});
const run = async (file, args, env = {}) => {
  const child = spawnTestProcess(file, args, {
    stdio: ['ignore', 'inherit', 'inherit'],
    env: { ...process.env, ...env },
  });
  assert.equal(
    await new Promise((resolve, reject) => {
      child.once('exit', resolve);
      child.once('error', reject);
    }),
    0,
    file,
  );
};
try {
  const prepared = await Promise.allSettled([
    (async () => {
      await service.download('qwen');
      assert.ok(service.ready('qwen'), service.state().error);
      paths.component = componentPaths(paths.models, packages).qwenModels;
      const state = JSON.parse(await readFile(path.join(testRoot, 'fixture.json'), 'utf8'));
      await writeFile(
        path.join(testRoot, 'fixture.json'),
        JSON.stringify({ ...state, component: paths.component }),
      );
      console.log('MODELS_READY');
    })(),
    (async () => {
      await run(python, ['-m', 'venv', paths.venv]);
      const wheels = await Promise.all(
        ['mlx', 'mlx-metal'].map(async (name) => {
          const data = await (await fetch(`https://pypi.org/pypi/${name}/0.30.6/json`)).json();
          const wheel = data.urls.find(
            (file) =>
              file.filename.includes('macosx_14_0_arm64') &&
              (file.filename.includes('cp312') || file.filename.includes('py3-none')),
          );
          assert.ok(wheel, 'Compatible MLX wheel missing');
          return wheel.url + '#sha256=' + wheel.digests.sha256;
        }),
      );
      await run(path.join(paths.venv, 'bin/python'), [
        '-m',
        'pip',
        '--isolated',
        'install',
        '--no-cache-dir',
        ...wheels,
        'numpy==2.4.2',
        'regex==2026.2.28',
        'huggingface-hub==1.5.0',
        'pyarrow==23.0.1',
        'soundfile==0.13.1',
        'cmake==3.31.6',
      ]);
      await run(python, [
        path.join(workspace.platformRoot, 'test/scripts/qwen-prepare-comparison.py'),
        path.join(testRoot, 'fixture.json'),
      ]);
      await run(path.join(paths.venv, 'bin/python'), [
        '-m',
        'pip',
        '--isolated',
        'install',
        '--no-cache-dir',
        '--no-deps',
        paths.source,
      ]);
      console.log('TOOLS_READY');
    })(),
  ]);
  for (const result of prepared)
    if (result.status === 'rejected') console.error('SETUP_ERROR:' + String(result.reason));
  console.log(
    (prepared.every((result) => result.status === 'fulfilled') ? 'READY:' : 'PARTIAL:') +
      path.join(testRoot, 'fixture.json'),
  );
  const input = createInterface({ input: process.stdin });
  for await (const line of input) {
    if (line.trim() === 'quit') break;
    console.log('Use quit to release fixtures.');
  }
} finally {
  service.dispose();
}
// The fixture owns its lifetime; imported component transports may keep Node's
// event loop referenced after readline closes. Run the registered exit cleanup.
process.exit(0);
