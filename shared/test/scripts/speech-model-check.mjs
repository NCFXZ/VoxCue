import workspace from '../../scripts/workspace.mjs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const require = workspace.platformRequire,
  sherpa = require('sherpa-onnx-node');
const { SpeechEngine } = require('./dist-electron/shared/electron/backend/speech/engine.js');
const root = process.env.VOXCUE_SPEECH_FIXTURE_DIR ?? '../shared/test/fixtures/speech-audio';
await mkdir(root, { recursive: true });
if (process.argv.includes('--download')) {
  const revision = '8e40c43232a1c5c66c82111efc5820d3accca11b';
  for (const n of [0, 1, 2, 3]) {
    const r = await fetch(
      `https://huggingface.co/csukuangfj/sherpa-onnx-streaming-paraformer-bilingual-zh-en/resolve/${revision}/test_wavs/${n}.wav`,
    );
    if (!r.ok) throw Error('Public fixture download failed');
    await writeFile(`${root}/official-${n}.wav`, Buffer.from(await r.arrayBuffer()));
  }
}
function distance(a, b) {
  const d = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 0; i < a.length; i++) {
    let prev = d[0];
    d[0] = i + 1;
    for (let j = 0; j < b.length; j++) {
      let old = d[j + 1];
      d[j + 1] = Math.min(d[j + 1] + 1, d[j] + 1, prev + (a[i] === b[j] ? 0 : 1));
      prev = old;
    }
  }
  return d[b.length];
}
const normalize = (t) =>
  t
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
let events = [];
const start = performance.now();
const engine = new SpeechEngine('../shared/local-models/speech', (e) =>
  events.push({ ...e, at: performance.now() }),
);
const loadMs = performance.now() - start;
const refs = JSON.parse((await readFile(root + '/references.json', 'utf8')).replace(/^\uFEFF/, ''));
const cases = [
  ...refs.map((r) => ({ ...r, file: r.id + '.wav' })),
  ...[0, 1, 2, 3].map((n) => ({ id: 'official-' + n, file: `official-${n}.wav`, text: null })),
];
for (const variant of [
  '44100',
  '48000',
  'low-volume',
  'noise',
  'short-pause',
  'long-pause',
  'silence',
  'noise-only',
])
  cases.push({
    id: 'variant-' + variant,
    file: 'english.wav',
    text: ['silence', 'noise-only'].includes(variant)
      ? null
      : refs.find((r) => r.id === 'english').text,
    variant,
    empty: ['silence', 'noise-only'].includes(variant),
  });
const results = [];
for (const c of cases) {
  let wave = sherpa.readWave(`${root}/${c.file}`, false);
  if (c.variant === '44100' || c.variant === '48000') {
    const rate = Number(c.variant),
      original = wave.samples,
      samples = new Float32Array(Math.round((original.length * rate) / wave.sampleRate));
    for (let i = 0; i < samples.length; i++) {
      const p = (i * wave.sampleRate) / rate,
        k = Math.floor(p);
      samples[i] = (original[k] ?? 0) * (1 - p + k) + (original[k + 1] ?? 0) * (p - k);
    }
    wave = { sampleRate: rate, samples };
  }
  if (c.variant === 'low-volume') wave = { ...wave, samples: wave.samples.map((n) => n * 0.03) };
  if (c.variant === 'noise' || c.variant === 'noise-only') {
    let seed = 123;
    wave = {
      ...wave,
      samples: wave.samples.map((n) => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return (c.empty ? 0 : n) + (seed / 4294967296 - 0.5) * 0.05;
      }),
    };
  }
  if (c.variant === 'silence') wave = { ...wave, samples: new Float32Array(wave.samples.length) };
  if (c.variant === 'short-pause' || c.variant === 'long-pause') {
    const original = wave.samples,
      at = Math.round(original.length / 2),
      gap = Math.round(wave.sampleRate * (c.variant === 'short-pause' ? 0.25 : 1.2)),
      samples = new Float32Array(original.length + gap);
    samples.set(original.subarray(0, at));
    samples.set(original.subarray(at), at + gap);
    wave = { ...wave, samples };
  }
  const t = performance.now();
  events = [];
  for (let offset = 0; offset < wave.samples.length; offset += Math.round(wave.sampleRate * 0.032))
    engine.feed(
      'system',
      wave.samples.slice(offset, offset + Math.round(wave.sampleRate * 0.032)),
      wave.sampleRate,
      0,
    );
  for (let i = 0; i < 40; i++)
    engine.feed(
      'system',
      new Float32Array(Math.round(wave.sampleRate * 0.032)),
      wave.sampleRate,
      0,
    );
  engine.flush('stop');
  const final = events.filter((e) => e.type === 'segment' && e.segment.final),
    text = final.map((e) => e.segment.text).join(' '),
    interim = events.filter((e) => e.type === 'segment' && !e.segment.final);
  const expected = c.text ? normalize(c.text).split(' ') : null;
  const chars = (t) => Array.from(normalize(t).replaceAll(' ', ''));
  const mixed = (t) => normalize(t).match(/[\p{Script=Han}]|[a-z]+|[0-9]+/gu) ?? [];
  results.push({
    id: c.id,
    reference: c.text,
    recognized: text,
    wer:
      expected && !/[\p{Script=Han}]/u.test(c.text)
        ? distance(expected, normalize(text).split(' ')) / expected.length
        : null,
    cer: c.text ? distance(chars(c.text), chars(text)) / chars(c.text).length : null,
    mixedErrorRate: c.text ? distance(mixed(c.text), mixed(text)) / mixed(c.text).length : null,
    audioSeconds: wave.samples.length / wave.sampleRate,
    decodeMs: performance.now() - t,
    interimUpdates: interim.length,
    finalSegments: final.length,
    expectedEmpty: !!c.empty,
    inputRate: wave.sampleRate,
    firstInterimComputeMs: interim[0] ? interim[0].at - t : null,
    sha256: createHash('sha256')
      .update(await readFile(`${root}/${c.file}`))
      .digest('hex'),
  });
}
const report = {
  version: sherpa.version,
  onnxruntime: sherpa.onnxruntimeVersion,
  loadMs,
  rss: process.memoryUsage().rss,
  results,
  note: 'Synthetic English references authored before recognition. Official bilingual examples are diagnostics only, no gold accuracy. Throughput timing is faster-than-realtime, not wall latency.',
};
console.log(JSON.stringify(report, null, 2));
if (results.some((r) => (r.expectedEmpty ? !!r.recognized : !r.recognized || !r.interimUpdates)))
  throw Error('No real streaming output');
