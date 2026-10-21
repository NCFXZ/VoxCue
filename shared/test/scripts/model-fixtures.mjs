import path from 'node:path';
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import workspace from '../../scripts/workspace.mjs';
import { testRoot } from './test-workspace.mjs';
import { verifyCachedComponent } from './verify-model-cache.mjs';

export async function stageModelFixtures(cache, staged, packages, componentLocation) {
  const relative = path.relative(testRoot, path.resolve(staged));
  assert.ok(
    relative && !relative.startsWith('..') && !path.isAbsolute(relative),
    'Model copy must belong to this temporary run',
  );
  assert.equal(typeof componentLocation, 'function');
  for (const pkg of packages) {
    const source = componentLocation(cache, pkg);
    const destination = componentLocation(staged, pkg);
    await verifyCachedComponent(source, pkg);
    for (const file of pkg.files) {
      const output = path.join(destination, 'files', file.path);
      await mkdir(path.dirname(output), { recursive: true });
      await copyFile(path.join(source, 'files', file.path), output);
    }
    await writeFile(
      path.join(destination, '.voxcue-component.json'),
      JSON.stringify({ sha256: pkg.sha256 }),
    );
    await verifyCachedComponent(destination, pkg);
  }
}

// Models come from fixed public downloads or an explicitly authorized read-only
// cache. Test processes still receive independent files in their owned run.
export async function prepareModelFixtures() {
  const { ComponentService, componentPaths, componentLocation } = workspace.platformRequire(
    path.join(
      workspace.platformRoot,
      'dist-electron/shared/electron/backend/components/service.js',
    ),
  );
  const { packagesFor } = workspace.platformRequire(
    path.join(
      workspace.platformRoot,
      'dist-electron/shared/electron/backend/components/catalog.js',
    ),
  );
  const packages = packagesFor(process.platform, process.arch).filter((pkg) => !pkg.optional);
  if (process.env.VOXCUE_TEST_COMPONENT_CACHE) {
    const cache = path.resolve(process.env.VOXCUE_TEST_COMPONENT_CACHE);
    const staged = path.join(testRoot, 'cached-models');
    await stageModelFixtures(cache, staged, packages, componentLocation);
    console.log(
      'Existing models: fixed catalog hashes verified; isolated copy, no download; source cache preserved',
    );
    return { ...componentPaths(staged, packages), speechFixtures: await prepareSpeechFixtures() };
  }
  const root = path.join(testRoot, 'models');
  let previous;
  const service = new ComponentService({
    root,
    packages,
    managed: true,
    fetch,
    emit(state) {
      const active = state.items.find((item) => item.phase === 'downloading');
      const progress = active
        ? `${active.id} ${Math.floor((active.received / active.bytes) * 10) * 10}%`
        : state.phase;
      if (progress !== previous) console.log('Temporary models: ' + (previous = progress));
    },
  });
  try {
    const state = await service.download();
    if (state.phase !== 'ready') throw Error(state.error ?? 'Temporary models are not ready');
    const speechFixtures = await prepareSpeechFixtures();
    return { ...componentPaths(root, packages), speechFixtures };
  } finally {
    service.dispose();
  }
}

export async function prepareSpeechFixtures() {
  const speechFixtures = path.join(testRoot, 'speech-audio');
  await mkdir(speechFixtures, { recursive: true });
  const revision = '8e40c43232a1c5c66c82111efc5820d3accca11b';
  // Legacy fixture names identify the two input channels; these are official
  // public examples, not a labelled accuracy corpus or recorded user audio.
  for (const [index, name, sha256] of [
    [0, 'chinese.wav', '7d93384ca14702cc584a7a33fe2fed92e89e708549161cb12ea38c916882103b'],
    [1, 'english.wav', '8bfb42c963e623ebab31b81ff4404867d07d3102507c87ac14577c4c61663b8c'],
  ]) {
    const response = await fetch(
      `https://huggingface.co/csukuangfj/sherpa-onnx-streaming-paraformer-bilingual-zh-en/resolve/${revision}/test_wavs/${index}.wav`,
      { signal: AbortSignal.timeout(30000) },
    );
    if (!response.ok) throw Error('Public audio fixture HTTP ' + response.status);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (createHash('sha256').update(bytes).digest('hex') !== sha256)
      throw Error('Public audio fixture checksum mismatch');
    await writeFile(path.join(speechFixtures, name), bytes);
  }
  console.log('Temporary public audio: fixed revisions and checksums verified');
  return speechFixtures;
}
