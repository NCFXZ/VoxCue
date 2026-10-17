const { app } = require('electron');
const path = require('node:path');
const assert = require('node:assert/strict');
const config = require('./config.json');
app.setPath('userData', path.join(config.output, 'userData'));
const { SpeechHost } = require(
  path.join(config.root, 'dist-electron/shared/electron/backend/speech/host.js'),
);
let host;
let elapsedAudio = 0,
  maxQueue = 0,
  segments = 0;
const sources = new Set();
let progress;
function waitForAudio(target) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      progress = undefined;
      reject(Error('Utility/ASR audio deadline exceeded'));
    }, 20000);
    progress = () => {
      if (elapsedAudio >= target) {
        clearTimeout(timer);
        progress = undefined;
        resolve();
      }
    };
    progress();
  });
}
function exited(child) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('Utility process did not exit')), 10000);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}
app.whenReady().then(async () => {
  try {
    host = new SpeechHost(
      config.model,
      'synthetic',
      (event) => {
        if (event.type === 'metrics') {
          elapsedAudio = event.audioMs;
          maxQueue = Math.max(maxQueue, event.maxQueueMs);
          progress?.();
        }
        if (event.type === 'segment') {
          sources.add(event.segment.source);
          if (event.segment.final) segments++;
        }
      },
      config.processFile,
    );
    for (let cycle = 0; cycle < 3; cycle++) {
      assert.equal(
        (await host.call({ op: 'start', options: { sources: ['system', 'microphone'] } })).state,
        'running',
      );
      await waitForAudio(elapsedAudio + 6500);
      assert.equal((await host.call({ op: 'stop' })).state, 'idle');
    }
    assert.equal(sources.size, 2);
    assert.ok(segments > 0);
    assert.ok(maxQueue <= 2000);
    const first = host.child;
    const crashed = exited(first);
    assert.ok(first.pid > 0);
    process.kill(first.pid, 'SIGKILL');
    await crashed;
    elapsedAudio = 0;
    assert.equal(
      (await host.call({ op: 'start', options: { sources: ['system', 'microphone'] } })).state,
      'running',
    );
    assert.notEqual(host.child, first);
    await waitForAudio(6500);
    assert.equal((await host.call({ op: 'stop' })).state, 'idle');
    const final = exited(host.child);
    host.stop();
    await final;
    process.stdout.write(
      JSON.stringify({
        status: 'passed',
        cycles: 3,
        utilityCrashRecovery: true,
        finalSegments: segments,
        sources: [...sources],
        maxQueueMs: maxQueue,
        publicFixturesOnly: true,
      }) + '\n',
      () => app.exit(0),
    );
  } catch (error) {
    host?.stop();
    process.stderr.write(String(error.stack) + '\n', () => app.exit(1));
  }
});
