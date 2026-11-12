import { requireGuestIsolation } from './guest-isolation.mjs';
import { holdDesktopAwake, requireUnlockedDesktop } from './desktop-session.mjs';
import { testRoot, spawnTestProcess } from '../../../shared/test/scripts/test-workspace.mjs';
import workspace from '../../../shared/scripts/workspace.mjs';
import { execFileSync } from 'node:child_process';
import { lstat, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { audioControlReader } from './audio-virtual-control.mjs';

const guest = await requireGuestIsolation();
requireUnlockedDesktop();
const options = new Map();
for (const argument of process.argv.slice(2)) {
  const match = argument.match(/^--(phase|capture-helper|aggregate-helper)=(.+)$/);
  if (!match || options.has(match[1]))
    throw Error(
      'Use --phase=granted|denied|reauthorized --capture-helper=/absolute/VoxCue.Audio [--aggregate-helper=/absolute/VoxCue.VirtualAudioStreams]',
    );
  options.set(match[1], match[2]);
}
const phase = options.get('phase');
const helper = options.get('capture-helper');
const aggregateHelper = options.get('aggregate-helper');
assert.ok(['granted', 'denied', 'reauthorized'].includes(phase));
assert.ok(helper && path.isAbsolute(helper) && path.basename(helper) === 'VoxCue.Audio');
const pin = JSON.parse(
  await readFile(path.join(workspace.platformRoot, 'local-signing-public.json'), 'utf8'),
);
assert.match(pin.sha1, /^[a-f0-9]{40}$/i);
await verifyHelper(helper, 'com.voxcue.audio');
if (aggregateHelper) {
  assert.equal(path.basename(aggregateHelper), 'VoxCue.VirtualAudioStreams');
  await verifyHelper(aggregateHelper, 'com.voxcue.test.virtual-audio-streams');
}
const releaseAwake = holdDesktopAwake();
const output = path.join(testRoot, 'virtual-audio-output');
const allowed = new Map([
  ['BlackHole2ch_UID', 2],
  ['BlackHole16ch_UID', 16],
]);
const { PacketDecoder, BoundedLineDecoder } = workspace.platformRequire(
  path.join(workspace.platformRoot, 'dist-electron/shared/electron/backend/speech/buffer.js'),
);
let pending = false;
try {
  execFileSync(
    '/usr/bin/xcrun',
    [
      'clang++',
      '-std=c++17',
      '-fobjc-arc',
      '-O2',
      '-arch',
      'arm64',
      '-mmacosx-version-min=14.2',
      path.join(workspace.platformRoot, 'test/fixtures/virtual-audio-output.mm'),
      '-framework',
      'Foundation',
      '-framework',
      'CoreAudio',
      '-o',
      output,
    ],
    { stdio: 'inherit', timeout: 120000 },
  );
  const devices = JSON.parse(
    execFileSync(output, ['--list'], { encoding: 'utf8', timeout: 10000 }),
  );
  assert.ok(Array.isArray(devices) && devices.length <= 2);
  for (const device of devices) {
    assert.ok(allowed.has(device.uid));
    assert.ok(Array.isArray(device.streams) && device.streams.length > 0);
    assert.deepEqual(
      device.preferences?.stereoChannels,
      [1, 2],
      'Pinned BlackHole stereo preference changed.',
    );
    console.log(
      JSON.stringify({
        virtualDevice: device.uid,
        streams: device.streams,
        preferences: device.preferences,
      }),
    );
  }
  if (devices.length !== 2 || new Set(devices.map((device) => device.uid)).size !== 2) {
    console.log(
      'PENDING: both whitelisted BlackHole 2ch and 16ch devices are required; nothing was captured.',
    );
    process.exitCode = 2;
  } else {
    console.log(
      `Permission phase ${phase} must already have been established through normal guest UI. This argument neither grants permission nor proves its state.`,
    );
    for (const device of devices) {
      const channels = allowed.get(device.uid);
      // BlackHole's fixed public UID identifies its channel count. No physical
      // or default UID, microphone source, level/route change or input IOProc.
      const modes =
        phase === 'denied'
          ? ['all']
          : ['silence', 'all', ...(channels === 16 ? ['0', '6', '14'] : ['0'])];
      for (const mode of modes) {
        await requireGuestIsolation();
        requireUnlockedDesktop();
        const measured = await measure(device.uid, mode);
        console.log(JSON.stringify({ phase, uid: device.uid, mode, ...measured }));
        if (phase === 'denied') {
          if (measured.startupTimedOut) {
            pending = true;
            console.log(
              'PENDING: no completed native permission observation; a startup timeout is not permission denial.',
            );
            break;
          }
          if (measured.errorCode) assert.equal(measured.errorCode, 'permission-denied');
          else {
            assert.ok(
              measured.started,
              'Permission observation requires actual native startup or explicit denial.',
            );
            assert.ok(
              measured.rms < 1e-6,
              'Operator-declared denial still exposes the controlled tone; verify normal-UI permission attribution before accepting this phase.',
            );
          }
          // Zero is an observation under the independently established state,
          // not a signal from which this test infers a permission denial.
          continue;
        }
        if (measured.errorCode === 'permission-denied' || measured.startupTimedOut) {
          pending = true;
          console.log(
            'PENDING: establish this helper responsibility chain’s audio permission in normal guest UI, then invoke the phase again.',
          );
          break;
        }
        assert.equal(measured.errorCode, undefined);
        assert.ok(
          measured.frames >= measured.rate / 2,
          'Granted phase must collect advancing PCM; zero frames are not interpreted as denial.',
        );
        if (mode === 'silence') assert.ok(measured.peak < 1e-5 && measured.rms < 1e-6);
        else {
          const expected = (0.2 / Math.sqrt(2)) * (mode === 'all' ? 1 : 2 / channels);
          console.log(
            JSON.stringify({
              amplitudeObservation: true,
              uid: device.uid,
              mode,
              measuredRms: measured.rms,
              allChannelMeanReferenceRms: expected,
              stereoReferenceRms: 0.2 / Math.sqrt(2),
            }),
          );
          if (mode === 'all' || mode === '0') {
            assert.ok(
              Math.abs(measured.rms - 0.2 / Math.sqrt(2)) < 0.01,
              'The preferred stereo pair must retain its source amplitude.',
            );
            assert.ok(Math.abs(measured.toneAmplitude - 0.2) < 0.01);
          } else
            assert.ok(
              measured.rms < 1e-6,
              'Nonpreferred channels must not be mixed into the selected pair.',
            );
        }
      }
      if (pending) break;
    }
    if (!pending && phase !== 'denied' && aggregateHelper) {
      console.log(
        'The fixture has a separate code identity but may share its normal-UI responsibility chain. It consumes real Capture source, not the formal helper binary.',
      );
      for (const mode of [
        'silence',
        'first',
        'second',
        'both',
        'preferred-second',
        'change-preferred',
        'direct16',
      ]) {
        await requireGuestIsolation();
        requireUnlockedDesktop();
        const measured = await collect(child(aggregateHelper, [mode]));
        console.log(
          JSON.stringify({
            phase,
            aggregate: mode !== 'direct16',
            sourceIntegration: true,
            mode,
            ...measured,
          }),
        );
        if (
          measured.pending ||
          measured.startupTimedOut ||
          measured.errorCode === 'permission-denied'
        ) {
          pending = true;
          break;
        }
        assert.equal(measured.errorCode, undefined);
        if (mode === 'direct16') assert.equal(measured.fixture?.uid, 'BlackHole16ch_UID');
        else
          assert.ok(
            measured.fixture?.uid.startsWith(
              `com.voxcue.test.virtual-audio.${process.getuid()}.${guest.nonce}.`,
            ),
          );
        assert.equal(measured.fixture.private, mode !== 'direct16');
        assert.equal(measured.fixture.selectedStream, mode === 'preferred-second' ? 1 : 0);
        assert.ok(
          measured.fixture.captureFormats?.length > 0,
          'The actual private tap input format must be observed.',
        );
        assert.ok(
          mode === 'direct16'
            ? measured.fixture.streams.length === 1
            : measured.fixture.streams.length >= 2,
        );
        assert.equal(
          measured.fixture.streams.reduce((sum, stream) => sum + stream.channels, 0),
          mode === 'direct16' ? 16 : 18,
        );
        assert.ok(measured.frames >= measured.rate / 2);
        if (mode === 'silence') assert.ok(measured.rms < 1e-6);
        else if (mode === 'second') assert.ok(measured.rms < 1e-6);
        else if (mode === 'preferred-second' || mode === 'direct16') {
          assert.ok(Math.abs(measured.secondToneAmplitude - 0.2) < 0.01);
          assert.ok(measured.toneAmplitude < 0.001, 'Unselected stream must not be mixed in.');
          assert.equal(measured.fixture.captureFormats[0].channels, 16);
        } else assert.ok(Math.abs(measured.toneAmplitude - 0.2) < 0.01);
        if (mode === 'preferred-second') assert.deepEqual(measured.fixture.preferred, [3, 4]);
        if (mode === 'change-preferred') {
          assert.equal(measured.fixture.routeChange?.applied, true);
          assert.equal(measured.fixture.stopped?.retiredByChange, true);
        }
      }
    }
    if (pending) process.exitCode = 2;
    else {
      console.log(
        `PASS: ${phase} phase for explicitly selected virtual 2/16ch outputs; PCM only in memory.`,
      );
      console.log(
        aggregateHelper && phase !== 'denied'
          ? 'PASS: bounded preferred-channel/stream routing, direct tap format and runtime metadata-change retirement. Other permission phases remain separate.'
          : 'NOT COVERED: private multi-stream aggregate (supply its fixed signed fixture) and permission phases not invoked.',
      );
    }
  }
} finally {
  releaseAwake();
}

async function verifyHelper(file, identifier) {
  assert.ok(path.isAbsolute(file));
  const info = await lstat(file);
  assert.ok(
    info.isFile() &&
      !info.isSymbolicLink() &&
      info.nlink === 1 &&
      [0, process.getuid()].includes(info.uid) &&
      !(info.mode & 0o022),
  );
  assert.equal(await realpath(file), file);
  execFileSync(
    '/usr/bin/codesign',
    [
      '--verify',
      '--strict',
      '-R',
      `=identifier "${identifier}" and certificate leaf = H"${pin.sha1}"`,
      file,
    ],
    { stdio: 'pipe', timeout: 10000 },
  );
}

function child(command, arguments_) {
  const process_ = spawnTestProcess(command, arguments_, { stdio: ['pipe', 'pipe', 'pipe'] });
  const closed = new Promise((resolve, reject) => {
    process_.once('error', reject);
    process_.once('close', (code, signal) => resolve({ code, signal }));
  });
  // Observation handlers may wait for started while the child fails to spawn.
  void closed.catch(() => {});
  return { process: process_, closed };
}
async function stop(value) {
  let timer, force, deadline;
  try {
    value.process.stdin.on('error', () => {});
    value.process.stdin.end();
    timer = setTimeout(() => value.process.kill('SIGTERM'), 1500);
    force = setTimeout(() => value.process.kill('SIGKILL'), 2500);
    return await Promise.race([
      value.closed,
      new Promise((_, reject) => {
        deadline = setTimeout(
          () => reject(Error('Owned audio child exit is unconfirmed; retain its run directory.')),
          5000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
    clearTimeout(force);
    clearTimeout(deadline);
  }
}
async function measure(uid, mode) {
  assert.ok(allowed.has(uid));
  const tone = child(output, ['--output', uid, mode]);
  tone.uid = uid;
  tone.records = [];
  let deadline;
  const ready = new Promise((resolve, reject) => {
    const failed = (error) => {
      tone.failure ??= error;
      reject(error);
    };
    const outputControl = audioControlReader(
      BoundedLineDecoder,
      (event) => {
        tone.records.push(event);
        if (event.error || event.pending) throw Error('Synthetic output could not start.');
        if (event.started) {
          assert.equal(event.uid, uid);
          resolve();
        }
      },
      failed,
    );
    const diagnostics = audioControlReader(
      BoundedLineDecoder,
      (event) => {
        if (event.error || event.type === 'error') throw Error('Synthetic output failed.');
      },
      failed,
      true,
    );
    tone.process.stdout.on('data', (bytes) => {
      if (!tone.failure) outputControl(bytes);
    });
    tone.process.stderr.on('data', (bytes) => {
      if (!tone.failure) diagnostics(bytes);
    });
    void tone.closed.then(({ code }) => {
      if (code || !tone.records.some((record) => record.started))
        failed(Error('Synthetic output exited before measurement completed.'));
    }, failed);
  });
  let collecting = false;
  try {
    await Promise.race([
      ready,
      new Promise((_, reject) => {
        deadline = setTimeout(() => reject(Error('Synthetic output did not become ready.')), 5000);
      }),
    ]);
    clearTimeout(deadline);
    await new Promise((resolve) => setTimeout(resolve, 200));
    const capture = child(helper, ['system', Buffer.from(uid).toString('base64')]);
    collecting = true;
    return await collect(capture, tone);
  } finally {
    clearTimeout(deadline);
    if (!collecting) await stop(tone);
  }
}
async function collect(capture, tone) {
  const decoder = new PacketDecoder();
  let frames = 0,
    sum = 0,
    peak = 0,
    real = 0,
    imaginary = 0,
    secondReal = 0,
    secondImaginary = 0,
    rate = 0;
  let started = false,
    startedAt = 0,
    errorCode,
    startupTimedOut = false,
    failure,
    fixture,
    pendingObservation;
  const ready = new Promise((resolve, reject) => {
    const control = audioControlReader(
      BoundedLineDecoder,
      (event) => {
        if (event.type === 'fixture-started') fixture = event;
        if (event.type === 'fixture-format')
          fixture = {
            ...fixture,
            captureFormats: event.formats,
            selectedStream: event.selectedStream,
            captureDeviceUID: event.captureDeviceUID,
          };
        if (event.type === 'fixture-route-change') fixture = { ...fixture, routeChange: event };
        if (event.type === 'fixture-stopped') {
          fixture = { ...fixture, stopped: event };
          if (
            event.malformed ||
            (!event.healthy &&
              !(
                fixture.mode === 'change-preferred' &&
                fixture.routeChange?.applied &&
                event.retiredByChange
              ))
          )
            failure = Error('Synthetic multi-stream output failed.');
        }
        if (event.pending) {
          pendingObservation = event.pending;
          resolve();
        }
        if (event.type === 'started') {
          started = true;
          startedAt = performance.now();
          resolve();
        }
        if (event.type === 'error') {
          errorCode = event.code;
          resolve();
        }
      },
      (error) => {
        failure ??= error;
        reject(error);
      },
      true,
    );
    capture.process.stderr.on('data', (bytes) => {
      if (!failure) control(bytes);
    });
    capture.process.stdout.on('data', (bytes) => {
      try {
        for (const packet of decoder.push(bytes)) {
          if (!started || performance.now() - startedAt < 300) continue;
          if (rate && rate !== packet.rate) throw Error('Capture sample rate changed.');
          rate = packet.rate;
          for (const sample of packet.samples) {
            sum += sample * sample;
            peak = Math.max(peak, Math.abs(sample));
            const angle = (2 * Math.PI * 997 * frames) / rate;
            const secondAngle = (2 * Math.PI * 1499 * frames++) / rate;
            real += sample * Math.cos(angle);
            imaginary += sample * Math.sin(angle);
            secondReal += sample * Math.cos(secondAngle);
            secondImaginary += sample * Math.sin(secondAngle);
          }
        }
      } catch (error) {
        failure = error;
        reject(error);
      }
    });
    if (tone)
      void tone.closed.then(({ code }) => {
        if (code && !started) reject(Error('Synthetic output failed before capture started.'));
      }, reject);
    void capture.closed.then(() => {
      if (!started) resolve();
    }, reject);
  });
  let startupDeadline;
  try {
    await Promise.race([
      ready,
      new Promise((resolve) => {
        startupDeadline = setTimeout(() => {
          startupTimedOut = true;
          resolve();
        }, 100000);
      }),
    ]);
    clearTimeout(startupDeadline);
    if (started && !errorCode) await new Promise((resolve) => setTimeout(resolve, 2000));
    if (failure || tone?.failure) throw failure ?? tone.failure;
  } finally {
    clearTimeout(startupDeadline);
    const closed = await Promise.allSettled([stop(capture), ...(tone ? [stop(tone)] : [])]);
    for (const result of closed) if (result.status === 'rejected') throw result.reason;
    const [captureClose, toneClose] = closed.map((result) => result.value);
    if (tone) assert.equal(toneClose.code, 0, 'Synthetic output must shut down normally.');
    assert.ok(
      startupTimedOut || errorCode || pendingObservation || captureClose.code === 0,
      'Capture must drain and close normally.',
    );
  }
  if (failure || tone?.failure) throw failure ?? tone.failure;
  if (tone) {
    assert.ok(tone.records.some((record) => record.started && record.uid === tone.uid));
    assert.ok(
      tone.records.some(
        (record) => record.stopped && record.framesWritten > 0 && !record.malformed,
      ),
    );
  }
  return {
    started,
    frames,
    rate,
    rms: frames ? Math.sqrt(sum / frames) : 0,
    peak,
    toneAmplitude: frames ? (2 * Math.hypot(real, imaginary)) / frames : 0,
    secondToneAmplitude: frames ? (2 * Math.hypot(secondReal, secondImaginary)) / frames : 0,
    errorCode,
    startupTimedOut,
    fixture,
    pending: pendingObservation,
  };
}
