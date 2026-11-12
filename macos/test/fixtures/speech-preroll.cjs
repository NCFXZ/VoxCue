// File-only native inference. These short inputs are deliberately NOT positive
// filler-filter cases: VAD must reject them and their lexical state must never
// become a prefix of the next accepted question.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { createRequire } = require('node:module');
const { Worker } = require('node:worker_threads');

assert.equal(process.platform, 'darwin');
assert.equal(process.arch, 'arm64');
assert.equal(process.argv.length, 3);
const configuration = path.resolve(process.argv[2]);
const root = path.dirname(configuration);
assert.equal(fs.realpathSync(root), root);
assert.equal(path.dirname(root), fs.realpathSync(os.tmpdir()));
assert(path.basename(root).startsWith('voxcue-test-run-'));
const owner = JSON.parse(fs.readFileSync(path.join(root, '.voxcue-test-owner.json'), 'utf8'));
assert.equal(owner.kind, 'voxcue-test-run-');
assert.equal(owner.pid, process.ppid, 'Only the owning test parent may launch this fixture');
function ownedFile(file) {
  assert(path.resolve(file).startsWith(root + path.sep));
  assert.equal(fs.realpathSync(file), path.resolve(file));
  const stat = fs.lstatSync(file);
  assert(stat.isFile() && !stat.isSymbolicLink() && stat.uid === process.getuid() && stat.nlink === 1);
  return fs.readFileSync(file);
}
const config = JSON.parse(ownedFile(configuration).toString('utf8'));
assert.equal(config.root, root);
assert(fs.realpathSync(config.models).startsWith(root + path.sep));
assert.deepEqual(config.audio.map((item) => item.id), ['um-short', 'ah-short', 'question']);
const platformRoot = path.resolve(__dirname, '../..');
const load = createRequire(path.join(platformRoot, 'package.json'));
const sherpa = load('sherpa-onnx-node');
const waves = new Map(config.audio.map((item) => {
  assert.match(item.sha256, /^[a-f0-9]{64}$/);
  assert.equal(createHash('sha256').update(ownedFile(item.wave)).digest('hex'), item.sha256);
  const wave = sherpa.readWave(item.wave, false);
  assert.equal(wave.sampleRate, 16000);
  assert(wave.samples.length && wave.samples.length <= 60 * 16000);
  return [item.id, wave];
}));
const compact = (text) => text.normalize('NFKC').replace(/[\s\p{P}]/gu, '');
let activeWorker;
let interrupted = false;
async function retire() {
  if (!activeWorker) return;
  const worker = activeWorker;
  activeWorker = undefined;
  await worker.terminate();
  assert.equal(worker.threadId, -1);
}
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
  interrupted = true;
  void retire().finally(() => process.exit(signal === 'SIGINT' ? 130 : 143));
});

async function sequence(short) {
  assert(!interrupted);
  const worker = new Worker(path.join(platformRoot, 'dist-electron/shared/electron/backend/speech/worker.js'));
  activeWorker = worker;
  let events = [], failure, nextId = 0, packet = 0, sent = 0, through;
  const results = [];
  worker.on('message', (message) => {
    if (message.error) failure = Error(message.error);
    if (message.event) {
      if (events.length >= 20000) {
        failure = Error('Bounded speech event count exceeded');
        void worker.terminate();
      } else events.push(message.event);
    }
  });
  function send(request, predicate) {
    if (failure || interrupted) return Promise.reject(failure ?? Error('Owned ASR fixture interrupted'));
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        worker.off('message', reply);
        worker.off('error', failed);
        worker.off('exit', exited);
      };
      const failed = (error) => { cleanup(); reject(error); };
      const exited = (code) => failed(Error('Production Worker exited before its reply: ' + code));
      const reply = (message) => {
        if (failure || message.error) failed(failure ?? Error(message.error));
        else if (predicate(message)) { cleanup(); resolve(message); }
      };
      const timer = setTimeout(() => failed(Error('Production Worker reply timed out')), 60000);
      worker.on('message', reply);
      worker.once('error', failed);
      worker.once('exit', exited);
      worker.postMessage(request);
    });
  }
  async function play(id) {
    const wave = waves.get(id), first = events.length;
    const total = Math.ceil((5120 + wave.samples.length + 51200) / 512) * 512;
    for (let offset = 0; offset < total; offset += 512) {
      const samples = new Float32Array(512);
      const start = Math.max(0, offset - 5120), end = Math.min(wave.samples.length, offset + 512 - 5120);
      if (end > start) samples.set(wave.samples.subarray(start, end), Math.max(0, 5120 - offset));
      const sequence = ++packet;
      const acknowledged = await send({
        op: 'audio', source: 'system', samples, rate: 16000,
        timestamp: sent / 16, sequence, ms: 32,
      }, (message) => message.ack === sequence);
      sent += 512;
      through = acknowledged.progress.system;
      assert(Number.isFinite(through) && through <= sent / 16 && through >= sent / 16 - 32,
        'Only complete resampled 512-frame blocks advance the acknowledged clock');
    }
    return events.slice(first);
  }
  try {
    await send({
      op: 'init', directory: config.models, speechModel: 'paraformer', inferenceDevice: 'cpu',
      preprocessorFile: path.join(platformRoot, 'dist-electron/macos/electron/speech/echoCancellation.js'),
      sources: ['system'],
    }, (message) => message.ready);
    const prepared = ++nextId;
    await send({
      op: 'prepare', id: prepared, sources: ['system'],
      inputState: { inputMode: 'remote', microphoneMuted: true },
    }, (message) => message.prepared === prepared);
    if (short) {
      const rejected = await play(short);
      assert(!rejected.some((event) => event.type === 'speech-start'));
      assert(!rejected.some((event) => event.type === 'activity' && event.speaking));
      assert(!rejected.some((event) => event.type === 'segment'), 'The short input is unaccepted, never a filter pass');
    }
    const question = await play('question');
    const segments = question.filter((event) => event.type === 'segment').map((event) => event.segment);
    const finals = segments.filter((segment) => segment.final);
    results.push({ preceding: short ?? 'fresh', question: finals.map(({ text, reason, startMs, endMs }) => ({ text, reason, startMs, endMs })), acknowledgedPackets: packet });
    console.log(JSON.stringify(results[0]));
    assert(finals.length && finals.every((segment) => segment.reason === 'silence' && segment.text.trim()));
    assert(segments.every((segment) => !/^[嗯啊]/u.test(compact(segment.text))), 'Unaccepted lexical input must not prefix any question segment');
    const text = compact(finals.map((segment) => segment.text).join(' '));
    assert(text.startsWith('请介绍'), 'The first spoken question syllable must survive VAD activation');
    // The fixed model uses either homophone for 经历. Compare the complete
    // question against its own fresh baseline below, without stripping text.
    assert(/项目(?:经历|经理)$/u.test(text), 'The question tail must survive the unchanged silence endpoint');
    for (const segment of finals) {
      assert(Number.isFinite(segment.silenceStartMs));
      assert(through >= segment.silenceStartMs + 1800);
    }
    return text;
  } finally {
    if (!interrupted && worker.threadId !== -1) {
      const closed = ++nextId;
      try { await send({ op: 'close', id: closed }, (message) => message.closed === closed); }
      finally { await retire(); }
    } else await retire();
  }
}
(async () => {
  const baseline = await sequence();
  for (const short of ['um-short', 'ah-short'])
    assert.equal(await sequence(short), baseline, 'Unaccepted audio must not change the next question');
  console.log('PASS: original short TTS inputs remain unaccepted; real Worker question ownership, opening and tail preserved; no filler-filter claim or hardware capture.');
})().catch(async (error) => {
  console.error(error);
  await retire();
  process.exitCode = 1;
});
