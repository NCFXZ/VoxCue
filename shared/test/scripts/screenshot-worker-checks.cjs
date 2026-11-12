const assert = require('node:assert/strict');
const path = require('node:path');
const { createRequire } = require('node:module');
const threads = require('node:worker_threads');

// Test-host instrumentation only. The production host and ordinary Worker bytes
// are loaded unchanged, including from a signed app.asar/unpacked closure.
module.exports = async function screenshotWorkerChecks({ runtimeRoot, hostPath, sharpPath }) {
  hostPath ??= path.join(runtimeRoot, 'dist-electron/shared/electron/backend/screenshot/host.js');
  const load = createRequire(hostPath);
  // CommonJS resolves /var temporary paths to /private/var before assigning
  // __dirname. Match the path actually used by the unchanged loaded host.
  hostPath = load.resolve(hostPath);
  const sharp = load(sharpPath ?? 'sharp');
  if (runtimeRoot)
    assert.equal(load(path.join(runtimeRoot, 'node_modules/sharp/package.json')).version, '0.35.5');
  const workerPath = path.join(path.dirname(hostPath), 'worker.js')
    .replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');
  const originalWorker = threads.Worker;
  const active = new Set();
  let fault, created = 0, exited = 0;
  threads.Worker = class extends originalWorker {
    constructor(filename, options) {
      const screenshot = typeof filename === 'string' && path.resolve(filename) === path.resolve(workerPath);
      const current = screenshot ? fault : undefined;
      if (screenshot) fault = undefined;
      if (current === 'load')
        filename = path.join(path.dirname(workerPath), 'missing-synthetic-worker-' + process.pid + '.js');
      if (current === 'stall') {
        filename = 'setInterval(() => {}, 1000)';
        options = { ...options, eval: true };
      }
      super(filename, options);
      if (!screenshot) return;
      created++;
      active.add(this);
      this.once('exit', () => { active.delete(this); exited++; });
    }
  };
  const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
  const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
  const mib = 1024 * 1024;
  const frame = (width = 1920, height = 1080) => {
    const bitmap = new ArrayBuffer(width * height * 4);
    const pixels = new Uint8Array(bitmap);
    for (let i = 0; i < pixels.length; i += 4) pixels.set([20, 40, 80, 255], i);
    return { width, height, bitmap };
  };
  const retired = label => {
    assert.equal(active.size, 0, label + ': no screenshot Worker remains active');
    assert.equal(exited, created, label + ': every constructed Worker emitted actual exit');
  };
  const settledRss = async () => {
    const values = [];
    for (let i = 0; i < 5; i++) { await delay(100); values.push(process.memoryUsage().rss); }
    return median(values);
  };
  try {
    const { encodeScreenshotBitmap: encode } = load(hostPath);
    const encodeOne = async () => {
      const input = frame();
      const result = await encode(input, new AbortController().signal);
      assert.equal(input.bitmap.byteLength, 0, 'Actual Worker must receive the transferred bitmap');
      assert.equal(result.file.name, 'screenshot.png');
      const image = await sharp(result.file.bytes).metadata();
      assert.equal(image.width, input.width);
      assert.equal(image.height, input.height);
      assert.match(result.preview, /^data:image\/jpeg;base64,/);
      // Decode only one output row, avoiding retained main-process image buffers.
      const pixel = await sharp(result.file.bytes).extract({ left: 0, top: 0, width: 1, height: 1 }).raw().toBuffer();
      assert.deepEqual([...pixel], [80, 40, 20, 255]);
      retired('successful encoding');
    };
    for (let i = 0; i < 4; i++) await encodeOne();
    const rss = [await settledRss()];
    for (let batch = 0; batch < 3; batch++) {
      for (let i = 0; i < 6; i++) await encodeOne();
      rss.push(await settledRss());
    }
    // Native allocators need not return to their cold RSS. After warm-up, the
    // repeated 8 MiB inputs must plateau rather than retain one bitmap per task.
    assert.ok(rss.at(-1) <= rss[0] + 48 * mib, 'Screenshot RSS failed to converge: ' + JSON.stringify(rss));
    assert.ok(rss.at(-1) <= rss[1] + 24 * mib, 'Screenshot RSS kept growing after the first batch: ' + JSON.stringify(rss));

    await assert.rejects(
      encode({ width: 2, height: 2, bitmap: new ArrayBuffer(1) }, new AbortController().signal),
      /过大或无效/,
    );
    retired('invalid bitmap');
    const cancellation = new AbortController();
    const cancelled = encode(frame(), cancellation.signal);
    cancellation.abort(new Error('Synthetic screenshot cancellation'));
    await assert.rejects(cancelled, error => error === cancellation.signal.reason);
    retired('cancellation');

    fault = 'load';
    // Other application Workers may start while this host is instrumented.
    // They must neither consume the fault nor enter screenshot retirement/RSS.
    const unrelated = new threads.Worker("require('node:worker_threads').parentPort.postMessage('unrelated')", { eval: true });
    try {
      await new Promise((resolve, reject) => {
        let received = false;
        const timer = setTimeout(() => reject(Error('Unrelated Worker was affected by screenshot fault injection')), 5000);
        unrelated.once('message', value => { received = value === 'unrelated'; });
        unrelated.once('error', error => { clearTimeout(timer); reject(error); });
        unrelated.once('exit', code => {
          clearTimeout(timer);
          if (code === 0 && received) resolve();
          else reject(Error('Unrelated Worker did not complete normally'));
        });
      });
    } finally { await unrelated.terminate(); }
    assert.equal(fault, 'load', 'An unrelated Worker must not consume the pending screenshot fault');
    await assert.rejects(encode(frame(64, 32), new AbortController().signal), /无法处理截图/);
    retired('synthetic Worker entry load failure');
    fault = 'stall';
    const start = performance.now();
    await assert.rejects(encode(frame(64, 32), new AbortController().signal), /截图处理超时/);
    assert.ok(performance.now() - start >= 14000, 'Exercise the actual production 15-second deadline');
    retired('synthetic bootstrap stall and actual timeout');
    assert.equal(fault, undefined, 'Fault injection must finish before returning to the real screenshot Worker');
    await encodeOne();
    assert.equal(created, 27, 'Track only the actual screenshot tasks, including their fault cases');
    return { encodings: 23, created, exited, rssBytes: rss, faults: ['invalid-bitmap', 'cancel', 'load', '15s-bootstrap-stall'] };
  } finally {
    threads.Worker = originalWorker;
    await Promise.allSettled([...active].map(worker => worker.terminate()));
  }
};
