import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, link, copyFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import workspace from '../../../shared/scripts/workspace.mjs';
import { testRoot } from '../../../shared/test/scripts/test-workspace.mjs';
import { continuousWave } from './qwen-audio.mjs';

// Explicit public staging input only, authenticated before linking any file.
// No installed userData/model cache is discovered or read by this helper.
export async function prepareQwenFixtures(source, build) {
  assert.equal(process.platform, 'win32');
  const compiled = path.join(
    workspace.platformRoot,
    'dist-electron/shared/electron/backend/components',
  );
  const { qwenPackage } = workspace.platformRequire(path.join(compiled, 'qwen-catalog.js'));
  const { qwenInt8Aligner } = workspace.platformRequire(
    path.join(compiled, 'qwen-int8-catalog.js'),
  );
  const { ComponentService, componentLocation } = workspace.platformRequire(
    path.join(compiled, 'service.js'),
  );
  const baseline = path.join(testRoot, 'baseline');
  const quantized = path.join(testRoot, 'quantized');
  async function trustedLink(file, destination) {
    const input = path.join(source, file.path.replace(/^qwen\//, ''));
    const hash = createHash('sha256');
    let bytes = 0;
    for await (const block of createReadStream(input)) {
      hash.update(block);
      bytes += block.length;
    }
    assert.equal(bytes, file.bytes, file.path);
    assert.equal(hash.digest('hex'), file.sha256, file.path);
    await mkdir(path.dirname(destination), { recursive: true });
    await link(input, destination);
  }
  for (const file of qwenPackage.files) {
    if (/\/voxcue-qwen(?:-cpu)?\.exe$/.test(file.path)) continue;
    await trustedLink(file, path.join(baseline, file.path.replace(/^qwen\//, '')));
    if (!file.path.startsWith('qwen/aligner/')) {
      const destination = path.join(quantized, file.path.replace(/^qwen\//, ''));
      await mkdir(path.dirname(destination), { recursive: true });
      await link(path.join(baseline, file.path.replace(/^qwen\//, '')), destination);
    }
  }
  for (const [target, name] of [
    ['cargo-target-cpu', 'voxcue-qwen-cpu.exe'],
    ['cargo-target', 'voxcue-qwen.exe'],
  ]) {
    for (const component of [baseline, quantized])
      await copyFile(
        path.join(build, target, 'release/voxcue-qwen.exe'),
        path.join(component, 'runtime', name),
      );
  }
  const pkg = {
    ...qwenPackage,
    ...qwenInt8Aligner,
    version: 'int8-evaluation',
    directory: 'qwen',
    parts: undefined,
  };
  const models = path.join(testRoot, 'gguf-download');
  let previous;
  const service = new ComponentService({
    root: models,
    packages: [pkg],
    managed: true,
    fetch,
    emit(state) {
      const item = state.items[0];
      const progress = `${item.phase} ${Math.floor((item.received / item.bytes) * 10) * 10}%`;
      if (progress !== previous) console.log('Q8_0 fixture: ' + (previous = progress));
    },
  });
  try {
    await service.download('qwen');
    assert.equal(service.ready('qwen'), true, service.state().error);
    for (const file of qwenInt8Aligner.files) {
      const destination = path.join(quantized, file.path.replace(/^qwen\//, ''));
      await mkdir(path.dirname(destination), { recursive: true });
      await link(path.join(componentLocation(models, pkg), 'files', file.path), destination);
    }
  } finally {
    service.dispose();
  }
  const { corpus, manifest } = await prepareQwenAudio();
  console.log(
    'Verified original ASR/BF16, rebuilt runtimes, fixed Q8_0 and public English/Chinese corpus.',
  );
  return { baseline, quantized, corpus, manifest };
}

export async function prepareQwenAudio() {
  const corpus = [];
  const revision = 'c5ef09646af6278d2ba8b8ceaf543ffb32d1a5dc';
  for (const [name, language, sha256] of [
    ['sample1', 'English', '6208727ac0b9de7aa1b2df8214f39bccb1e511298c55f4ca8d5f3c4abf8df257'],
    ['sample4', 'English', '0ba306b88d12d32939b49fe202d1072c9744055c18286a31a6f7c48228fa30a7'],
    ['sample5', 'Chinese', '61f484701eaf04b50b304fc56f51d2873f75f2e1b52e51eae0e4981d0c586216'],
  ]) {
    const base = `https://raw.githubusercontent.com/alan890104/qwen3-asr-rs/${revision}/tests/fixtures/audio/${name}`;
    const response = await fetch(base + '.wav');
    assert.equal(response.ok, true);
    const audio = Buffer.from(await response.arrayBuffer());
    assert.equal(createHash('sha256').update(audio).digest('hex'), sha256);
    const file = path.join(testRoot, name + '.wav');
    await writeFile(file, audio);
    const text = await fetch(base + '.txt');
    assert.equal(text.ok, true);
    const item = { id: name, language, audio: file, reference: (await text.text()).trim() };
    if (name !== 'sample1') {
      item.continuous = path.join(testRoot, name + '-continuous.wav');
      await writeFile(item.continuous, continuousWave(audio));
    }
    corpus.push(item);
  }
  await writeFile(path.join(testRoot, 'corpus.json'), JSON.stringify(corpus));
  return { corpus, manifest: path.join(testRoot, 'corpus.json') };
}
