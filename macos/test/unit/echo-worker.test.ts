import { afterEach, expect, it } from 'vitest';
import { Worker } from 'node:worker_threads';
import path from 'node:path';

const workers: Worker[] = [];
afterEach(async () => {
  await Promise.all(workers.splice(0).map((worker) => worker.terminate()));
});

it('recognizes both original capture packets before flush and resets only the interrupted ASR lane', async () => {
  const root = path.resolve('..');
  const worker = new Worker(
    `
    const {parentPort, workerData} = require('node:worker_threads');
    const ts = require('typescript'), fs = require('node:fs');
    require.extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true}
    }).outputText, file);
    // Observe the ASR input at the production worker's model boundary.
    require.cache[workerData.engine] = {exports: {Recognizer: class {
      static async load(_options, emit) {return new this(emit);}
      audioMs = 0; inferenceMs = 0;
      metadata = {}; healthy = true; progress = new Map();
      constructor(emit) {this.emit = emit;}
      feed(source, samples, rate, timestamp) {this.progress.set(source, timestamp); this.emit({test:'audio', source, samples, rate, timestamp});}
      processedThrough(source) {return this.progress.get(source);}
      canSwitch() {return true;}
      async close() {this.healthy = false;}
      discontinuity(source) {this.emit({test:'gap', source});}
      flush(reason) {this.emit({test:'flush', reason});}
    }}};
    require(workerData.entry);
  `,
    {
      eval: true,
      workerData: {
        engine: path.join(root, 'shared/electron/backend/speech/recognizer.ts'),
        entry: path.join(root, 'shared/electron/backend/speech/worker.ts'),
      },
    },
  );
  workers.push(worker);
  const messages: any[] = [];
  const pending: { match: (message: any) => boolean; resolve: () => void }[] = [];
  worker.on('message', (message) => {
    messages.push(message);
    for (const item of [...pending])
      if (item.match(message)) {
        pending.splice(pending.indexOf(item), 1);
        item.resolve();
      }
  });
  const wait = (match: (message: any) => boolean) =>
    new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(Error('Synthetic worker reply timed out')), 4000);
      pending.push({
        match,
        resolve: () => {
          clearTimeout(timeout);
          resolve();
        },
      });
    });
  const send = async (message: any, match: (message: any) => boolean) => {
    const reply = wait(match);
    worker.postMessage(message);
    await reply;
    expect(messages.filter((m) => m.error)).toEqual([]);
  };
  await send(
    {
      op: 'init',
      directory: 'synthetic-not-read',
    },
    (m) => m.ready,
  );
  await send({ op: 'prepare', id: 1, sources: ['system', 'microphone'] }, (m) => m.prepared === 1);
  const system = Float32Array.from({ length: 967 }, (_, i) => Math.sin(i / 9) * 0.1);
  const mic = Float32Array.from({ length: 883 }, (_, i) => Math.cos(i / 13) * 0.02);
  await send(
    {
      op: 'audio',
      source: 'system',
      samples: system,
      rate: 48000,
      timestamp: 1000,
      captureClock: 10,
      sequence: 2,
      ms: 20,
    },
    (m) => m.ack === 2,
  );
  await send(
    {
      op: 'audio',
      source: 'microphone',
      samples: mic,
      rate: 44100,
      timestamp: 1000,
      captureClock: 10,
      sequence: 3,
      ms: 20,
    },
    (m) => m.ack === 3,
  );
  const audio = messages.map(m => m.event).filter(e => e?.test === 'audio');
  expect(audio).toEqual([
    { test: 'audio', source: 'system', samples: system, rate: 48000, timestamp: 1000 },
    { test: 'audio', source: 'microphone', samples: mic, rate: 44100, timestamp: 1000 },
  ]);
  await send({ op: 'flush', id: 4, reason: 'pause' }, (m) => m.flushed === 4);
  expect(messages.at(-2)?.event).toEqual({ test: 'flush', reason: 'pause' });
  await send({ op: 'prepare', id: 5, sources: ['system', 'microphone'] }, (m) => m.prepared === 5);
  worker.postMessage({ op: 'gap', source: 'system' });
  await send({ op: 'flush', id: 6, reason: 'stop' }, (m) => m.flushed === 6);
  expect(messages.filter((m) => m.event?.test === 'gap').map((m) => m.event.source)).toEqual(['system']);
}, 10000);
