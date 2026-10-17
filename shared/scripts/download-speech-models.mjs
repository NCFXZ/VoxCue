import workspace from './workspace.mjs';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
const root = path.join(workspace.sharedRoot, 'local-models/speech');
await mkdir(root, { recursive: true });
const revision = '8e40c43232a1c5c66c82111efc5820d3accca11b';
const base = `https://huggingface.co/csukuangfj/sherpa-onnx-streaming-paraformer-bilingual-zh-en/resolve/${revision}/`;
const tree = await (
  await fetch(
    `https://huggingface.co/api/models/csukuangfj/sherpa-onnx-streaming-paraformer-bilingual-zh-en/tree/${revision}?recursive=true`,
  )
).json();
const manifest = {
  asr: {
    name: 'streaming-paraformer-bilingual-zh-en INT8',
    revision,
    license: 'Apache-2.0',
    source: base,
  },
  vad: { name: 'Silero VAD release asset 271935959 (2025-07-11)', license: 'MIT' },
  files: {},
};
for (const name of [
  'encoder.int8.onnx',
  'decoder.int8.onnx',
  'tokens.txt',
  'README.md',
  'silero_vad.onnx',
]) {
  const url =
    name === 'silero_vad.onnx'
      ? 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad.onnx'
      : base + name;
  const expected =
    name === 'silero_vad.onnx'
      ? '9e2449e1087496d8d4caba907f23e0bd3f78d91fa552479bb9c23ac09cbb1fd6'
      : tree.find((x) => x.path === name)?.lfs?.oid;
  const file = path.join(root, name);
  let bytes;
  try {
    bytes = await readFile(file);
    if (expected && createHash('sha256').update(bytes).digest('hex') !== expected)
      bytes = undefined;
  } catch {}
  if (!bytes) {
    const r = await fetch(url);
    if (!r.ok) throw Error(`${name}: HTTP ${r.status}`);
    bytes = Buffer.from(await r.arrayBuffer());
  }
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (expected && sha256 !== expected) throw Error('Model checksum mismatch: ' + name);
  await writeFile(file + '.part', bytes);
  await rename(file + '.part', file);
  manifest.files[name] = { bytes: bytes.length, sha256, upstreamSha256: expected ?? null, url };
  console.log(name, bytes.length, sha256);
}
for (const [name, url] of Object.entries({
  'LICENSE-sherpa.txt': 'https://raw.githubusercontent.com/k2-fsa/sherpa-onnx/v1.13.8/LICENSE',
  'LICENSE-silero.txt': 'https://raw.githubusercontent.com/snakers4/silero-vad/master/LICENSE',
})) {
  const r = await fetch(url);
  if (!r.ok) throw Error('License unavailable');
  await writeFile(path.join(root, name), await r.text());
}
await writeFile(path.join(root, 'manifest.json'), JSON.stringify(manifest, null, 2));
