import { readFile, writeFile, access, realpath } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import os from 'node:os';
import workspace from '../../../shared/scripts/workspace.mjs';
const input = process.argv[2];
if (!input || !path.isAbsolute(input))
  throw Error('Pass the state JSON of an owned temporary Qwen component fixture');
const state = JSON.parse(await readFile(input, 'utf8'));
assert.equal(path.dirname(await realpath(state.testRoot)), await realpath(os.tmpdir()));
const owner = JSON.parse(
  await readFile(path.join(state.testRoot, '.voxcue-test-owner.json'), 'utf8'),
);
assert.equal(owner.kind, 'voxcue-test-run-');
assert.equal(path.basename(state.testRoot).startsWith('voxcue-test-run-'), true);
assert.equal(await realpath(state.root), path.join(state.testRoot, 'models'));
process.kill(owner.pid, 0);
const { ComponentService, componentPaths, componentLocation } = workspace.platformRequire(
  path.join(workspace.platformRoot, 'dist-electron/shared/electron/backend/components/service.js'),
);
const { packagesFor } = workspace.platformRequire(
  path.join(workspace.platformRoot, 'dist-electron/shared/electron/backend/components/catalog.js'),
);
const packages = packagesFor('darwin', 'arm64');
assert.equal(componentPaths(state.root, packages).qwenModels, state.component);
const preserved = path.join(state.testRoot, 'synthetic-profile-preserved.txt');
await writeFile(preserved, 'Synthetic profile unrelated to models', { flag: 'wx' });
let released = false;
const service = new ComponentService({
  root: state.root,
  packages,
  managed: true,
  fetch,
  emit() {},
  async prepareRemove(id) {
    assert.equal(id, 'qwen');
    const native = path.join(workspace.platformRoot, 'native/bin/qwen/voxcue-qwen');
    const inventory = spawnSync('ps', ['-axo', 'comm'], { encoding: 'utf8' });
    assert.equal(inventory.status, 0);
    assert.ok(
      !inventory.stdout
        .split('\n')
        .some(
          (line) =>
            line.trim() === native ||
            (line.includes('/voxcue-test-run-') && line.endsWith('/native/qwen/voxcue-qwen')),
        ),
      'Qwen process remains',
    );
    const modelFiles = [
      path.join(state.component, 'asr/model.safetensors'),
      path.join(state.component, 'aligner/model.gguf'),
    ];
    for (const file of modelFiles) await access(file);
    const occupied = spawnSync('/usr/sbin/lsof', ['-t', '--', native, ...modelFiles], {
      encoding: 'utf8',
      timeout: 10000,
    });
    assert.equal(occupied.error, undefined);
    assert.equal(occupied.status, 1);
    assert.equal(occupied.stdout.trim(), '');
    assert.equal(occupied.stderr.trim(), '');
    released = true;
    return true;
  },
});
try {
  await service.status();
  assert.equal(service.ready('qwen'), true);
  await service.remove('qwen');
  assert.equal(service.ready('qwen'), false);
  assert.equal(released, true);
  await assert.rejects(
    access(
      componentLocation(
        state.root,
        packages.find((p) => p.id === 'qwen'),
      ),
    ),
    { code: 'ENOENT' },
  );
  await access(preserved);
  console.log(
    'PASS: actual Qwen native processes and model file mappings released; production ComponentService deletes only the temporary managed Qwen model and preserves unrelated synthetic profile data.',
  );
} finally {
  service.dispose();
}
