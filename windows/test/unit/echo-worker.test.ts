import { afterEach, expect, it } from 'vitest';
import { Worker } from 'node:worker_threads';
import path from 'node:path';

const workers: Worker[] = [];
afterEach(async () => {
  await Promise.all(workers.splice(0).map((worker) => worker.terminate()));
});

it('loads the actual optional AEC in the shared worker, drains tails before flush, and resets both ASR lanes on a gap', async () => {
  const root = path.resolve('..');
  const worker = new Worker(
    `
    const {parentPort, workerData} = require('node:worker_threads');
    const ts = require('typescript'), fs = require('node:fs');
    require.extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true}
    }).outputText, file);
    // Replace inference alone: audio preprocessing, worker protocol and lifecycle
    // are production code. No model, account, audio device or transport is used.
    require.cache[workerData.engine] = {exports: {SpeechEngine: class {
      audioMs = 0; inferenceMs = 0;
      constructor(_directory, emit) {this.emit = emit;}
      feed(source, samples, rate, timestamp) {this.emit({test:'audio', source, samples, rate, timestamp});}
      discontinuity(source) {this.emit({test:'gap', source});}
      flush(reason) {this.emit({test:'flush', reason});}
    }}};
    require(workerData.entry);
  `,
    {
      eval: true,
      workerData: {
        engine: path.join(root, 'shared/electron/backend/speech/engine.ts'),
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
      preprocessorFile: path.join(root, 'windows/electron/speech/echoCancellation.ts'),
    },
    (m) => m.ready,
  );
  await send({ op: 'prepare', id: 1, sources: ['system', 'microphone'] }, (m) => m.prepared === 1);
  const input = Float32Array.from({ length: 967 }, (_, i) => Math.sin(i / 9) * 0.1);
  await send(
    {
      op: 'audio',
      source: 'system',
      samples: new Float32Array(967),
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
      samples: input,
      rate: 48000,
      timestamp: 1000,
      captureClock: 10,
      sequence: 3,
      ms: 20,
    },
    (m) => m.ack === 3,
  );
  await send({ op: 'flush', id: 4, reason: 'pause' }, (m) => m.flushed === 4);
  const audio = messages
    .filter((m) => m.event?.test === 'audio' && m.event.source === 'microphone')
    .flatMap((m) => Array.from(m.event.samples));
  expect(Float32Array.from(audio)).toEqual(input);
  expect(messages.at(-2)?.event).toEqual({ test: 'flush', reason: 'pause' });
  await send({ op: 'prepare', id: 5, sources: ['system', 'microphone'] }, (m) => m.prepared === 5);
  const gap = wait((m) => m.event?.test === 'gap' && m.event.source === 'microphone');
  worker.postMessage({ op: 'gap', source: 'system' });
  await gap;
  expect(messages.filter((m) => m.event?.test === 'gap').map((m) => m.event.source)).toEqual([
    'system',
    'microphone',
  ]);
  await send({ op: 'flush', id: 6, reason: 'stop' }, (m) => m.flushed === 6);
}, 10000);
