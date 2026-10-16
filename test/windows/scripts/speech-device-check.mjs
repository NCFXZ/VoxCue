import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const sherpa = require('sherpa-onnx-node');
const wave = sherpa.readWave('test/results/speech-fixtures/english.wav', false);
sherpa.writeWave('test/results/speech-fixtures/playback-low.wav', {
  sampleRate: wave.sampleRate,
  samples: wave.samples.map((n) => n * 0.15),
});
const {
  SpeechController,
} = require('../../../dist-electron/windows/electron/speech/controller.js');
const {
  WasapiCapture,
  devices,
} = require('../../../dist-electron/windows/electron/speech/capture.js');
const helper = path.resolve('native/bin/VoxCue.Audio.exe'),
  model = path.resolve('local-models/speech');
await mkdir('test/results', { recursive: true });
const available = await devices(helper);
console.log(
  'Audio endpoints:',
  available.map((d) => ({ source: d.source, default: d.default, name: d.name })),
);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const packetCounts = {};
const failures = [];
let diagnostics = [];
for (const source of ['microphone', 'system']) {
  if (!available.some((d) => d.source === source)) continue;
  const result = { packets: 0, samples: 0, rates: [], flags: [], peak: 0 };
  const capture = new WasapiCapture(
    helper,
    source,
    undefined,
    (p) => {
      result.packets++;
      result.samples += p.samples.length;
      if (!result.rates.includes(p.rate)) result.rates.push(p.rate);
      if (p.flags && !result.flags.includes(p.flags)) result.flags.push(p.flags);
      for (const n of p.samples) result.peak = Math.max(result.peak, Math.abs(n));
    },
    (m) => failures.push(m),
  );
  await capture.start();
  await sleep(2000);
  await capture.stop();
  packetCounts[source] = result;
}
const events = [];
const controller = new SpeechController(model, helper, (e) =>
  events.push({ ...e, at: Date.now() }),
);
let player;
let playbackRequestedAt;
try {
  const start = await controller.call({
    op: 'start',
    options: { sources: available.map((d) => d.source).filter((s, i, a) => a.indexOf(s) === i) },
  });
  assert.equal(start.state, 'running');
  playbackRequestedAt = Date.now();
  player = spawn(
    'powershell.exe',
    [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      'test/windows/scripts/play-speech-fixture.ps1',
      '-AudioFile',
      path.resolve('test/results/speech-fixtures/playback-low.wav'),
      '-Seconds',
      '10',
    ],
    { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] },
  );
  let playError = '';
  player.stderr.on('data', (b) => (playError += b));
  await sleep(12000);
  await controller.call({ op: 'pause' });
  const first = events.filter((e) => e.type === 'segment' && e.segment.final);
  assert.ok(
    first.some((e) => e.segment.source === 'system' && e.segment.text.includes('explain')),
    'Actual loopback should decode the controlled playback',
  );
  await controller.call({ op: 'start', options: { sources: ['system'] } });
  await sleep(1500);
  await controller.call({ op: 'stop' });
  const finals = events.filter((e) => e.type === 'segment' && e.segment.final);
  assert.equal(new Set(finals.map((e) => e.segment.id)).size, finals.length);
  diagnostics = {
    dualCapture: true,
    systemFinal: first.filter((e) => e.segment.source === 'system').map((e) => e.segment.text),
    microphoneFinalCount: first.filter((e) => e.segment.source === 'microphone').length,
    playError,
    statusErrors: events.filter((e) => e.type === 'status' && e.status.state === 'error'),
    metrics: events.filter((e) => e.type === 'metrics').at(-1),
    pauseResumeStop: true,
    playbackRequestedAt,
    firstSystemInterimFromRequestMs:
      events.find((e) => e.type === 'segment' && e.segment.source === 'system' && !e.segment.final)
        ?.at - playbackRequestedAt,
    systemFinalFromRequestMs:
      first.find((e) => e.segment.source === 'system')?.at - playbackRequestedAt,
    finalAfterAudioFileDurationMs:
      first.find((e) => e.segment.source === 'system')?.at -
      playbackRequestedAt -
      (wave.samples.length / wave.sampleRate) * 1000,
  };
} finally {
  player?.kill();
  await controller.close();
  await writeFile(
    'test/results/speech-device-results.json',
    JSON.stringify(
      {
        packetCounts,
        failures,
        diagnostics,
        statuses: events.filter((e) => e.type === 'status'),
        lastMetrics: events.filter((e) => e.type === 'metrics').at(-1),
        systemText: events
          .filter((e) => e.type === 'segment' && e.segment.source === 'system')
          .map((e) => ({ text: e.segment.text, final: e.segment.final })),
        note: 'Only generated fixture system text is recorded; ambient microphone text is neither logged nor saved. Microphone speech quality still requires participant-controlled manual review.',
      },
      null,
      2,
    ),
  );
}
console.log(JSON.stringify({ packetCounts, failures, diagnostics }, null, 2));
