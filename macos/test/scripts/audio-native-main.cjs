const { app, BrowserWindow } = require('electron');
const fs = require('node:fs/promises'),
  path = require('node:path'),
  assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { root, output } = require('./config.json');
app.setPath('userData', path.join(output, 'userData'));
let host, activeCapture, tone;
const results = [];
app.whenReady().then(async () => {
  const window = new BrowserWindow({
    width: 460,
    height: 200,
    title: 'VoxCue · 原生音频验证',
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  await window.loadURL(
    'data:text/html;charset=utf-8,' +
      encodeURIComponent(
        '<body style="font:15px system-ui;padding:24px">正在验证 Mac 原生音频。<p>请在系统弹窗中选择系统音频与麦克风权限。</p><p>采集不保存、不上传。测试将播放两秒低音量合成提示音。</p>',
      ),
  );
  window.show();
  app.focus({ steal: true });
  const { devices, probeDevice, CoreAudioCapture } = require(
    path.join(root, 'dist-electron/macos/electron/speech/capture.js'),
  );
  const helper = path.join(root, 'native/bin/VoxCue.Audio');
  try {
    const available = await devices(helper);
    assert.ok(available.some((d) => d.source === 'system' && d.default));
    assert.ok(available.some((d) => d.source === 'microphone' && d.default));
    results.push({
      inventory: {
        system: available.filter((d) => d.source === 'system').length,
        microphone: available.filter((d) => d.source === 'microphone').length,
      },
    });
    for (const source of ['system', 'microphone']) {
      console.log(JSON.stringify({ phase: 'permission-check', source }));
      const check = await probeDevice(helper, source);
      results.push({ source, check });
      assert.equal(
        check.ok,
        true,
        source + ' native permission/initialization failed: ' + check.code,
      );
      let frames = 0,
        packets = 0,
        peak = 0,
        rate = 0,
        last = -Infinity,
        error;
      let done, fail;
      const audio = new Promise((resolve, reject) => {
        done = resolve;
        fail = reject;
      });
      const timeout = setTimeout(() => fail(Error(source + ' did not deliver valid PCM')), 15000);
      activeCapture = new CoreAudioCapture(
        helper,
        source,
        undefined,
        (packet) => {
          try {
            assert.ok(packet.timestamp >= last);
            last = packet.timestamp;
            assert.ok(packet.samples.every(Number.isFinite));
            frames += packet.samples.length;
            packets++;
            rate = packet.rate;
            for (const sample of packet.samples) peak = Math.max(peak, Math.abs(sample));
            if (frames >= rate && (source === 'microphone' || peak > 0.001)) done();
          } catch (e) {
            fail(e);
          }
        },
        (message) => {
          error = message;
          fail(Error(message));
        },
      );
      try {
        await activeCapture.start();
        if (source === 'system')
          tone = spawn('/usr/bin/afplay', ['-v', '0.15', path.join(output, 'synthetic-tone.wav')], {
            stdio: 'ignore',
          });
        await audio;
        await activeCapture.stop();
        activeCapture = null;
        assert.equal(error, undefined);
        results.push({ source, packets, frames, rate, peak, pcmStored: false });
      } finally {
        clearTimeout(timeout);
        tone?.kill();
        tone = null;
        await activeCapture?.stop();
        activeCapture = null;
      }
    }
    // A blocked PCM consumer must fail explicitly rather than drop audio or hang.
    const blocked = spawn(helper, ['microphone', ''], { stdio: ['pipe', 'pipe', 'pipe'] });
    let control = '';
    blocked.stderr.on('data', (data) => (control += data));
    const blockedCode = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        blocked.kill();
        reject(Error('Native backpressure did not stop'));
      }, 10000);
      blocked.once('exit', (code) => {
        clearTimeout(timer);
        resolve(code);
      });
      blocked.once('error', reject);
    });
    blocked.stdout.destroy();
    assert.equal(blockedCode, 1);
    assert.ok(control.includes('device-changed-or-backpressure'));
    results.push({ boundedNativeBackpressure: true, pcmStored: false });
    // Full Electron utilityProcess -> native capture -> existing ASR Worker.
    const { SpeechHost } = require(
      path.join(root, 'dist-electron/shared/electron/backend/speech/host.js'),
    );
    const sources = new Set();
    const diagnostics = { eventCounts: {}, sources: [], status: [] };
    results.push({ utilityDiagnostics: diagnostics });
    let done, fail;
    const activity = new Promise((resolve, reject) => {
      done = resolve;
      fail = reject;
    });
    activity.catch(() => {});
    host = new SpeechHost(
      path.resolve(root, '../shared/local-models/speech'),
      helper,
      (event) => {
        diagnostics.eventCounts[event.type] = (diagnostics.eventCounts[event.type] ?? 0) + 1;
        if (event.type === 'status') diagnostics.status.push(event.status);
        if (event.type === 'activity') {
          sources.add(event.source);
          diagnostics.sources = [...sources];
          if (sources.size === 2) done();
        }
        if (event.type === 'status' && event.status.state === 'error')
          fail(Error(event.status.error));
      },
      path.join(root, 'dist-electron/macos/electron/speech/process.js'),
    );
    const timeout = setTimeout(
      () => fail(Error('Both native ASR sources did not become active')),
      20000,
    );
    try {
      const started = await host.call({
        op: 'start',
        options: { sources: ['system', 'microphone'] },
      });
      assert.equal(started.state, 'running');
      tone = spawn('/usr/bin/afplay', ['-v', '0.15', path.join(output, 'synthetic-tone.wav')], {
        stdio: 'ignore',
      });
      await activity;
      assert.equal((await host.call({ op: 'stop' })).state, 'idle');
      results.push({
        utilityProcessAndAsrWorker: true,
        sources: [...sources],
        flushed: true,
        transcriptStored: false,
      });
    } finally {
      clearTimeout(timeout);
      tone?.kill();
      tone = null;
      host.stop();
      host = null;
    }
    console.log(
      JSON.stringify(
        { status: 'passed', arch: process.arch, electron: process.versions.electron, results },
        null,
        2,
      ),
    );
    app.exit(0);
  } catch (error) {
    tone?.kill();
    await activeCapture?.stop();
    host?.stop();
    console.log(JSON.stringify({ status: 'failed', error: String(error), results }, null, 2));
    app.exit(1);
  }
});
