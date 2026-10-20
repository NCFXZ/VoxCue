import assert from 'node:assert/strict';
import path from 'node:path';
import { access } from 'node:fs/promises';
import { prepareQwenFixtures } from './qwen-fixtures.mjs';
import { testRoot, spawnTestProcess } from '../../../shared/test/scripts/test-workspace.mjs';
import { probe } from './window-probe.mjs';

const options = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const match = /^--(source|build|device|checks)=(.+)$/.exec(arg);
    assert.ok(
      match,
      'Use --source=<fixed public staging qwen> --build=<current temporary build> [--device=cpu|cuda]',
    );
    return match.slice(1);
  }),
);
assert.ok(options.source && options.build);
assert.ok(!options.device || ['cpu', 'cuda'].includes(options.device));
assert.ok(!options.checks || options.checks === 'switch');
const fixtures = await prepareQwenFixtures(options.source, options.build);
const python = process.env.VOXCUE_PYTHON ?? 'python';
const run = async (file, args, capture = false) => {
  const child = spawnTestProcess(file, args, {
    stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
    windowsHide: true,
  });
  let output = '';
  if (capture)
    child.stdout.on('data', (data) => {
      output += data;
    });
  const timer = setTimeout(() => child.kill(), 900000);
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', resolve);
  }).finally(() => clearTimeout(timer));
  assert.equal(code, 0, args[0] + (capture ? ': ' + output : ''));
  return output;
};
for (const device of options.checks ? [] : options.device ? [options.device] : ['cpu', 'cuda']) {
  await run(python, [
    'test/scripts/qwen-aligner-compare.py',
    fixtures.baseline,
    fixtures.quantized,
    path.join(
      options.build,
      device === 'cpu' ? 'cargo-target-cpu' : 'cargo-target',
      'release/examples/aligner-bench.exe',
    ),
    fixtures.manifest,
    '--device',
    device,
  ]);
  const short = fixtures.corpus.find((item) => item.id === 'sample1');
  const transcripts = [];
  for (const format of ['baseline', 'quantized']) {
    const result = JSON.parse(
      (
        await run(
          python,
          [
            'test/scripts/qwen-native-smoke.py',
            fixtures[format],
            '--device',
            device,
            '--wave',
            short.audio,
          ],
          true,
        )
      ).trim(),
    );
    assert.ok(result.characters > 10);
    transcripts.push(result.transcript_sha256);
    console.log(`PASS native ${device} ${format}: short public transcript, device/chunk and exit`);
  }
  assert.equal(
    transcripts[0],
    transcripts[1],
    'BF16/Q8_0 must retain identical normalized short transcription',
  );
  // The same ASR weights run in both formats. Exercise the expensive live
  // asynchronous crop on CPU English, plus CUDA English and Chinese; the direct
  // aligner comparison above covers both formats/languages on both devices.
  for (const item of fixtures.corpus.filter(
    (item) => item.continuous && (device === 'cuda' || item.language === 'English'),
  )) {
    console.log(`Native continuous ASR/crop: ${device} Q8_0 ${item.language}`);
    await run(python, [
      'test/scripts/qwen-native-smoke.py',
      fixtures.quantized,
      '--device',
      device,
      '--wave',
      item.continuous,
      ...(item.language === 'English' ? ['--require-crop'] : []),
      '--repeat',
      '2',
    ]);
  }
  await run(process.execPath, [
    'test/scripts/qwen-worker-smoke.mjs',
    fixtures.quantized,
    device === 'cpu'
      ? short.audio
      : fixtures.corpus.find((item) => item.id === 'sample4').continuous,
    device,
    ...(device === 'cpu' ? ['--no-crop'] : []),
  ]);
}
if (!options.checks)
  await run(python, [
    'test/scripts/qwen-lifecycle-smoke.py',
    fixtures.quantized,
    fixtures.corpus.find((item) => item.id === 'sample1').audio,
  ]);
await run(process.execPath, [
  'test/scripts/speech-switch-smoke.mjs',
  fixtures.quantized,
  fixtures.corpus.find((item) => item.id === 'sample1').audio,
  ...(options.checks ? ['--skip-dual'] : []),
]);
const files = [
  'asr/model.safetensors',
  'aligner/model.gguf',
  'runtime/speech.dll',
  'runtime/voxcue-qwen.exe',
  'runtime/voxcue-qwen-cpu.exe',
].map((file) => path.join(fixtures.quantized, file));
for (const file of files) await access(file);
assert.equal(probe('exclusive', ...files).exclusiveFiles, files.length);
console.log(
  `PASS: Windows Qwen ${options.checks ? 'switching and exclusive handles' : `${options.device ?? 'CPU/CUDA'}, BF16/Q8_0, bilingual timestamps/transcription, four-sentence crop, production Worker, switching and exclusive handles`}; temporary root ` +
    testRoot,
);
