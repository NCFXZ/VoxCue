import { testRoot, spawnTestProcess } from '../../../shared/test/scripts/test-workspace.mjs';
import workspace from '../../../shared/scripts/workspace.mjs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createInterface } from 'node:readline';
import { requireGuestIsolation } from './guest-isolation.mjs';
import { verifyLocalApp } from '../../scripts/development-signing.mjs';

const component = process.argv[2];
if (!component || !path.isAbsolute(component))
  throw Error('Pass an isolated, verified Qwen component directory');
const guestBundle = process.argv[3];
let runtime = path.join(workspace.platformRoot, 'native/bin/qwen/voxcue-qwen');
if (guestBundle) {
  await requireGuestIsolation();
  assert.ok(path.isAbsolute(guestBundle) && path.basename(guestBundle) === 'VoxCue.app');
  verifyLocalApp(guestBundle, workspace.platformRequire(path.join(workspace.platformRoot, 'local-signing-public.json')), 'com.voxcue.app');
  runtime = path.join(guestBundle, 'Contents/Resources/native/qwen/voxcue-qwen');
}
async function run(file, args) {
  const child = spawnTestProcess(file, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', (data) => (output += data));
  child.stderr.resume();
  assert.equal(
    await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', resolve);
    }),
    0,
  );
  return output;
}
const { metal } = JSON.parse(await run(runtime, ['metal-check']));
assert.equal(typeof metal, 'boolean');
if (!guestBundle) assert.equal(metal, true);
if (!metal) console.log('PENDING: the guest exposes no Metal device; checking packaged CPU inference.');
const sentence =
  'The first project improved our customer service. We tested the new system with synthetic examples. Our team reviewed the results carefully. The next release will include better search. We also improved the user interface. Finally we checked that every process stopped correctly. ';
await run('/usr/bin/say', [
  '-r',
  '165',
  '-o',
  path.join(testRoot, 'voice.aiff'),
  sentence.repeat(3),
]);
await run('/usr/bin/afconvert', [
  '-f',
  'WAVE',
  '-d',
  'LEI16@16000',
  '-c',
  '1',
  path.join(testRoot, 'voice.aiff'),
  path.join(testRoot, 'voice.wav'),
]);
const wave = await readFile(path.join(testRoot, 'voice.wav'));
let offset = 12,
  pcm;
while (offset + 8 <= wave.length) {
  const size = wave.readUInt32LE(offset + 4);
  if (wave.toString('ascii', offset, offset + 4) === 'data') {
    pcm = wave.subarray(offset + 8, offset + 8 + size);
    break;
  }
  offset += 8 + size + (size % 2);
}
assert.ok(pcm?.length);
for (const device of metal ? ['metal', 'cpu'] : ['cpu']) {
  const child = spawnTestProcess(runtime, [component, device], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, RAYON_NUM_THREADS: '4' },
  });
  let stderr = '';
  child.stderr.on('data', (data) => {
    stderr = (stderr + data).slice(-8000);
  });
  const events = [],
    waiting = new Set();
  let exited = false;
  const exit = new Promise((resolve) =>
    child.once('exit', (code) => {
      exited = true;
      for (const wake of waiting) wake();
      resolve(code);
    }),
  );
  createInterface({ input: child.stdout }).on('line', (line) => {
    events.push(JSON.parse(line));
    for (const wake of waiting) wake();
  });
  async function wait(predicate) {
    const deadline = Date.now() + 180000;
    while (Date.now() < deadline) {
      const error = events.find((e) => e.type === 'error');
      if (error || exited) throw Error('Qwen failed: ' + JSON.stringify(error) + ' ' + stderr);
      const found = events.find(predicate);
      if (found) return found;
      await new Promise((resolve) => {
        const wake = () => {
          clearTimeout(timer);
          waiting.delete(wake);
          resolve();
        };
        const timer = setTimeout(wake, 500);
        waiting.add(wake);
      });
    }
    throw Error('Qwen event timeout');
  }
  let seq = 0;
  async function send(op, source = 'system', extra = {}) {
    const id = ++seq;
    child.stdin.write(JSON.stringify({ op, source, seq: id, ...extra }) + '\n');
    await wait((event) => event.type === 'ack' && event.seq === id);
  }
  try {
    const ready = await wait((event) => event.type === 'ready');
    const started = performance.now();
    assert.equal(ready.device, device);
    assert.equal(ready.alignment_device, 'cpu');
    assert.equal(ready.chunk_ms, device === 'metal' ? 500 : 1000);
    assert.equal(ready.async_alignment, true);
    assert.equal(ready.vad_silence_ms, 500);
    assert.equal(ready.asr_backend, device === 'metal' ? 'mlx' : 'rust');
    await send('start');
    await send('start', 'microphone');
    for (let i = 0; i < 5; i++)
      await send('audio', 'microphone', { audio: Buffer.alloc(6400).toString('base64') });
    const samples = device === 'metal' ? pcm : pcm.subarray(0, 16000 * 2 * 5);
    const combined = Buffer.concat([samples, Buffer.alloc(32000)]);
    for (let i = 0; i < combined.length; i += 6400)
      await send('audio', 'system', { audio: combined.subarray(i, i + 6400).toString('base64') });
    await send('finish');
    await send('finish', 'microphone');
    assert.ok(events.some((event) => event.type === 'partial' && event.text));
    assert.ok(events.some((event) => event.type === 'tail_final' && event.reason === 'pause'));
    assert.ok(
      !events.some(
        (event) =>
          event.session === 'microphone' &&
          ['partial', 'committed', 'tail_final'].includes(event.type),
      ),
    );
    const crops = events.filter((event) => event.type === 'committed');
    if (device === 'metal')
      assert.ok(crops.length > 0, 'Stable four-sentence audio must actually be cropped');
    for (const crop of crops) {
      assert.ok(crop.removed_chunk_ms > 0);
      assert.ok(crop.cut_ms > crop.window_start_ms);
      assert.ok(crop.aligned_next_start_ms >= crop.aligned_sentence_end_ms);
      assert.ok(crop.buffer_ms < crop.audio_ms - crop.window_start_ms);
      assert.ok(crop.audio_ms >= crop.alignment_snapshot_ms);
      assert.equal(crop.buffer_ms, crop.audio_ms - crop.window_start_ms - crop.removed_chunk_ms);
    }
    if (device === 'metal') {
      assert.ok(
        crops.some((crop) => crop.audio_ms > crop.alignment_snapshot_ms),
        'Preserve audio received while alignment was running',
      );
      const start = events.findIndex((event) => event.type === 'aligning');
      const done = events.findIndex(
        (event, index) => index > start && ['committed', 'alignment_deferred'].includes(event.type),
      );
      assert.ok(
        events.slice(start + 1, done).some((event) => event.type === 'partial'),
        'ASR continues while alignment is busy',
      );
    }
    child.stdin.end();
    assert.equal(await exit, 0);
    console.log(
      JSON.stringify({
        device,
        chunkMs: ready.chunk_ms,
        alignment: ready.alignment_device,
        crops: crops.length,
        partials: events.filter((e) => e.type === 'partial').length,
        audioMs: combined.length / 32,
        elapsedMs: Math.round(performance.now() - started),
        inferenceMs: events.reduce((sum, event) => sum + (event.inference_ms ?? 0), 0),
        alignmentMs: events.reduce((sum, event) => sum + (event.alignment_ms ?? 0), 0),
        maxActiveMs: Math.max(...events.map((e) => e.buffer_ms ?? 0)),
        exited: true,
      }),
    );
  } finally {
    if (!exited) {
      child.kill();
      await exit;
    }
  }
}
