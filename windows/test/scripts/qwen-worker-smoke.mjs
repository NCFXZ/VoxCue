import workspace from '../../../shared/scripts/workspace.mjs';
import { spawnTestProcess } from '../../../shared/test/scripts/test-workspace.mjs';
import { Worker } from 'node:worker_threads';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

if (!process.argv.includes('--node')) {
  const child = spawnTestProcess(
    workspace.platformRequire('electron'),
    [import.meta.filename, ...process.argv.slice(2), '--node'],
    {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      stdio: 'inherit',
      windowsHide: true,
    },
  );
  child.once('exit', (code) => {
    process.exitCode = code ?? 1;
  });
} else {
  const [component, wave] = process.argv.slice(2);
  assert(component && wave);
  const worker = new Worker(
    path.join(workspace.platformRoot, 'dist-electron/shared/electron/backend/speech/worker.js'),
  );
  const events = [],
    pending = new Set();
  let sequence = 0;
  worker.on('message', (message) => {
    if (message.event) events.push(message.event);
    for (const request of pending) {
      if (message.error) {
        request.reject(Error(message.error));
        pending.delete(request);
      } else if (request.match(message)) {
        request.resolve(message);
        pending.delete(request);
      }
    }
  });
  const send = (message, match) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('Qwen worker timeout')), 180000);
      pending.add({
        match,
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      worker.postMessage(message);
    });
  try {
    const ready = await send(
      {
        op: 'init',
        directory: component,
        speechModel: 'qwen',
        inferenceDevice: 'cuda',
        preprocessorFile: path.join(
          workspace.platformRoot,
          'dist-electron/windows/electron/speech/echoCancellation.js',
        ),
      },
      (message) => message.ready,
    );
    assert.equal(ready.chunkMs, 500);
    const prepared = ++sequence;
    await send(
      { op: 'prepare', id: prepared, sources: ['system', 'microphone'] },
      (message) => message.prepared === prepared,
    );
    const bytes = await fs.readFile(wave);
    assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
    let cursor = 12,
      pcm;
    while (cursor + 8 <= bytes.length) {
      const size = bytes.readUInt32LE(cursor + 4);
      if (bytes.toString('ascii', cursor, cursor + 4) === 'data') {
        pcm = bytes.subarray(cursor + 8, cursor + 8 + size);
        break;
      }
      cursor += 8 + size + (size % 2);
    }
    assert(pcm);
    const samples = new Float32Array(pcm.length / 2 + 16000);
    for (let i = 0; i < pcm.length / 2; i++) samples[i] = pcm.readInt16LE(i * 2) / 32768;
    for (let offset = 0; offset < samples.length; offset += 1600) {
      const block = samples.slice(offset, offset + 1600),
        seq = ++sequence;
      await send(
        {
          op: 'audio',
          source: 'system',
          samples: block,
          rate: 16000,
          timestamp: 1000 + offset / 16,
          captureClock: offset / 16,
          sequence: seq,
          ms: block.length / 16,
        },
        (message) => message.ack === seq,
      );
    }
    const flush = ++sequence;
    await send({ op: 'flush', id: flush, reason: 'stop' }, (message) => message.flushed === flush);
    const segments = events
      .filter((event) => event.type === 'segment')
      .map((event) => event.segment);
    assert(segments.some((segment) => !segment.final && segment.text));
    assert(segments.some((segment) => segment.reason === 'sentence'));
    assert(segments.some((segment) => segment.reason === 'silence'));
    assert(
      segments.every((segment) => segment.source === 'system' && segment.speechModel === 'qwen'),
    );
    const close = ++sequence;
    await send({ op: 'close', id: close }, (message) => message.closed === close);
    console.log(
      'Qwen production worker: resampling/AEC, partials, sentence crop, silence final and native exit passed.',
    );
  } finally {
    await worker.terminate();
  }
}
