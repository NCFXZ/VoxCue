// Real WASAPI system loopback and real ASR Worker, controlled synthetic playback.
// Microphone is disabled. Only counters are saved; no captured audio or text.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const {
  SpeechController,
} = require('../../../dist-electron/windows/electron/speech/controller.js');
await mkdir('test/results', { recursive: true });
const profile = await mkdtemp(path.resolve('test/results/speech-restart-'));
const sherpa = require('sherpa-onnx-node');
const wave = sherpa.readWave(path.resolve('test/results/speech-fixtures/english.wav'), false);
const playbackFile = path.join(profile, 'synthetic-playback.wav');
sherpa.writeWave(playbackFile, {
  sampleRate: wave.sampleRate,
  samples: wave.samples.map((sample) => sample * 0.12),
});
const events = [];
const controller = new SpeechController(
  path.resolve('local-models/speech'),
  path.resolve('native/bin/VoxCue.Audio.exe'),
  (event) => events.push(event),
);
const wait = async (predicate, label, timeout = 12000) => {
  const deadline = Date.now() + timeout;
  while (!predicate()) {
    if (Date.now() >= deadline) throw Error(label + ' timeout');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
};
let player;
const play = () => {
  player = spawn(
    'powershell.exe',
    [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      path.resolve('test/windows/scripts/play-speech-fixture.ps1'),
      '-AudioFile',
      playbackFile,
    ],
    { windowsHide: true, stdio: 'ignore' },
  );
  return new Promise((resolve, reject) => {
    player.once('error', reject);
    player.once('exit', (code) =>
      code === 0 ? resolve() : reject(Error('Synthetic playback failed')),
    );
  });
};
const cycles = [];
try {
  for (let cycle = 0; cycle < 3; ++cycle) {
    const offset = events.length;
    assert.equal(
      (
        await controller.call({
          op: 'start',
          options: { sources: ['system'] },
        })
      ).state,
      'running',
    );
    const playback = play();
    void playback.catch(() => {});
    if (cycle === 0) {
      await wait(
        () => events.slice(offset).some((e) => e.type === 'segment' && !e.segment.final),
        'Actual ASR interim',
      );
      // Inject a gap at the controller's native packet boundary while retaining
      // the real Worker/engine. The live capture then supplies subsequent audio.
      const rate = controller.rates.get('system');
      assert.ok(rate, 'Native capture must have established the actual device rate');
      controller.audio('system', new Float32Array(Math.round(rate / 100)), rate, 1);
      await wait(
        () =>
          events
            .slice(offset)
            .some((e) => e.type === 'segment' && e.segment.reason === 'discontinuity'),
        'Interrupted segment',
      );
      const status = await controller.call({ op: 'status' });
      assert.equal(status.state, 'running', status.error);
    }
    await playback;
    await wait(
      () =>
        events
          .slice(offset)
          .some(
            (e) => e.type === 'segment' && e.segment.final && e.segment.reason !== 'discontinuity',
          ),
      'Resumed ASR final',
    );
    assert.equal((await controller.call({ op: 'pause' })).state, 'paused');
    const errors = events
      .slice(offset)
      .filter((e) => e.type === 'status' && e.status.state === 'error');
    assert.equal(errors.length, 0, errors.map((e) => e.status.error).join('; '));
    cycles.push({
      cycle: cycle + 1,
      finalSegments: events.slice(offset).filter((e) => e.type === 'segment' && e.segment.final)
        .length,
      gaps: events.slice(offset).filter((e) => e.type === 'gap').length,
      errorCount: errors.length,
    });
  }
  assert.equal((await controller.call({ op: 'stop' })).state, 'idle');
  const result = {
    status: 'passed',
    realWasapi: true,
    realWorker: true,
    microphone: false,
    liveAccount: false,
    capturedAudioSaved: false,
    capturedTextSaved: false,
    cycles,
  };
  await writeFile(path.join(profile, 'result.json'), JSON.stringify(result, null, 2));
  console.log({ ...result, profile });
} finally {
  player?.kill();
  await controller.close();
}
