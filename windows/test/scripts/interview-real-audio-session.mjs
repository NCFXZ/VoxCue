import assert from 'node:assert/strict';
import { lstat, mkdir, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { testRoot, electron } from '../../../shared/test/scripts/test-workspace.mjs';
import { offlineElectronEntry } from '../../../shared/test/scripts/offline-electron-entry.mjs';
import { installUiAccount, connectUiAccount, closeUiApp } from '../../../shared/test/scripts/install-ui-account.mjs';
import workspace from '../../../shared/scripts/workspace.mjs';

assert.equal(process.platform, 'win32');
assert.equal(process.argv.length, 3);
const configFile = path.resolve(process.argv[2]);
const parentRoot = path.dirname(configFile);
assert.equal(path.dirname(parentRoot), await realpath(tmpdir()));
assert.match(path.basename(parentRoot), /^voxcue-test-run-[\w-]+$/);
assert.match(path.basename(configFile), /^real-audio-[a-z-]+\.json$/);
assert.equal(await realpath(configFile), configFile);
const owner = JSON.parse(await readFile(path.join(parentRoot, '.voxcue-test-owner.json'), 'utf8'));
assert.equal(owner.kind, 'voxcue-test-run-');
assert.equal(owner.pid, process.ppid);
assert.ok((await lstat(configFile)).size <= 16384);
const config = JSON.parse(await readFile(configFile, 'utf8'));
const { audio, model } = config;
assert.ok(['paraformer', 'qwen'].includes(model));
assert.equal(config.root, workspace.platformRoot);
assert.equal(config.processFile, path.join(workspace.sharedRoot, 'test/fixtures/interview-real-audio-process.cjs'));
for (const file of [config.speechModels, config.qwenModels, config.qwenRuntime, ...audio.map((item) => item.wave)].filter(Boolean)) {
  assert.ok((await realpath(file)).startsWith(parentRoot + path.sep), 'Only owner-staged models and WAVs may be used');
}
const profile = path.join(testRoot, 'real-audio-profile');
await mkdir(profile);
const app = await electron.launch({
  args: [await offlineElectronEntry()],
  env: {
    ...process.env,
    COPILOT_TEST_USER_DATA: profile,
    VITE_DEV_SERVER_URL: '',
    VOXCUE_REAL_AUDIO_CONFIG: configFile,
    ELECTRON_RUN_AS_NODE: undefined,
  },
});
const compact = (text) => text.normalize('NFKC').replace(/[\s\p{P}]/gu, '');
const results = [];
try {
  // Only account/provider and device availability are synthetic. ASR events are never replaced.
  await installUiAccount(app, { components: true });
  await app.evaluate(({ app }, config) => {
    const load = process
      .getBuiltinModule('module')
      .createRequire(app.getAppPath() + '/package.json');
    const path = process.getBuiltinModule('path');
    const base = app.getAppPath() + '/dist-electron/shared/electron';
    load(path.join(base, 'backend/speech/models.js')).speechModelInstalled = () => true;
    load(path.join(base, 'backend/speech/hardware.js')).SpeechHardwareProbe.prototype.read =
      async () => ({ cuda: false, metal: false });
    const { InterviewAccess } = load(
      path.join(app.getAppPath(), 'dist-electron/windows/electron/speech/access.js'),
    );
    InterviewAccess.prototype.check = async (options) => ({
      ready: true,
      devices: [],
      checks: options.sources.map((source) => ({
        source,
        status: 'granted',
        message: 'Owned WAV capture adapter',
      })),
    });
    const { SpeechHost } = load(path.join(base, 'backend/speech/host.js'));
    const original = SpeechHost.prototype.call;
    globalThis.realAudio = { events: [], requests: [], failures: [] };
    SpeechHost.prototype.call = async function (call) {
      if (!this.realAudioConfigured) {
        if (this.child) throw Error('A real capture process was started before the WAV fixture');
        this.realAudioConfigured = true;
        this.model = config.speechModels;
        this.helper = 'unused-file-capture';
        this.processFile = config.processFile;
        this.qwenDirectory = config.qwenModels;
        this.qwenRuntime = config.qwenRuntime;
        const emit = this.emit;
        this.emit = (event) => {
          if (globalThis.realAudio.events.length >= 20000)
            throw Error('Speech event bound exceeded');
          globalThis.realAudio.events.push(structuredClone(event));
          if (event.type === 'gap' || (event.type === 'status' && event.status.state === 'error'))
            globalThis.realAudio.failures.push(event);
          emit(event);
        };
      }
      globalThis.realAudio.host = this;
      const result = await original.call(this, call);
      this.child?.stdout?.resume();
      this.child?.stderr?.resume();
      return result;
    };
    const { ChatGPTService } = load(path.join(base, 'backend/chat/service.js'));
    ChatGPTService.prototype.stream = async (request, emit) => {
      globalThis.realAudio.requests.push({
        request: structuredClone(request),
        eventIndex: globalThis.realAudio.events.length,
      });
      const answerText =
        'Owned synthetic provider response; real WAV recognition and renderer gate.';
      emit({ id: request.id, type: 'delta', text: answerText });
      return { answerText, usage: null, sources: [] };
    };
  }, config);
  const login = await app.firstWindow();
  const page = await connectUiAccount(app, login);
  await page.evaluate(
    (model) =>
      localStorage.setItem(
        'copilot-interview-settings-v1',
        JSON.stringify({
          microphoneEnabled: false,
          system: 'fixture-system',
          speechModel: model,
          inferenceDevice: 'cpu',
        }),
      ),
    model,
  );
  await page.reload();
  await page.getByRole('button', { name: '用户菜单', exact: true }).waitFor();
  console.log(`Loading the real ${model} CPU pipeline in the isolated application.`);
  await page.locator('.interview-start-trigger').click();
  const [floating] = await Promise.all([
    app.waitForEvent('window', { timeout: 240000 }),
    page
      .getByRole('dialog', { name: '开始面试', exact: true })
      .getByRole('button', { name: '确认开始', exact: true })
      .click(),
  ]);
  floating.setDefaultTimeout(240000);
  const question = floating.getByRole('textbox', { name: '面试提问', exact: true });
  await question.waitFor();
  await floating.evaluate(() => {
    window.realAudioEvents = [];
    window.desktop.onSpeechEvent((event) => window.realAudioEvents.push(event));
  });
  const readyDeadline = Date.now() + 240000;
  while (
    !(await app.evaluate(() =>
      globalThis.realAudio.events.some(
        (event) => event.type === 'status' && event.status.state === 'running',
      ),
    ))
  ) {
    assert.deepEqual(await app.evaluate(() => globalThis.realAudio.failures), []);
    assert.ok(Date.now() < readyDeadline, 'The real ASR pipeline must finish loading');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const status = await app.evaluate(
    () =>
      globalThis.realAudio.events.findLast(
        (event) => event.type === 'status' && event.status.state === 'running',
      )?.status,
  );
  assert.equal(status?.speechModel, model);
  if (model === 'qwen') assert.equal(status.inferenceDevice, 'cpu');
  let count = 0;
  let freshQuestion;
  const completed = async (expected) => {
    await floating.waitForFunction(
      (expected) => document.querySelectorAll('.answer-text .markdown-content').length === expected,
      expected,
    );
    await floating.getByRole('button', { name: '发送面试问题', exact: true }).waitFor();
    assert.equal(await app.evaluate(() => globalThis.realAudio.requests.length), expected);
  };
  for (const item of audio) {
    await floating.evaluate(() => {
      window.realAudioEvents = [];
    });
    const from = await app.evaluate(() => globalThis.realAudio.events.length);
    console.log(`Replaying ${model} WAV case ${item.id}; real ASR, VAD and ACKs.`);
    const played = await app.evaluate(
      async (_electron, id) => globalThis.realAudio.host.send({ play: id }),
      item.id,
    );
    const audit = await app.evaluate(
      (_electron, from) => ({
        events: globalThis.realAudio.events.slice(from),
        requests: globalThis.realAudio.requests,
        failures: globalThis.realAudio.failures,
      }),
      from,
    );
    assert.deepEqual(audit.failures, []);
    assert.equal(played.droppedSamples, 0);
    assert.equal(played.discontinuities, 0);
    assert.ok(
      played.maxQueueMs <= 512,
      'Fixture must apply backpressure before production queue limits',
    );
    const finals = audit.events
      .filter(
        (event) =>
          event.type === 'segment' && event.segment.source === 'system' && event.segment.final,
      )
      .map((event) => event.segment);
    console.log(
      JSON.stringify({
        model,
        id: item.id,
        recognizedFinals: finals.map(({ text, reason }) => ({ text, reason })),
      }),
    );
    if (item.kind === 'unaccepted') {
      assert.ok(!audit.events.some((event) =>
        event.type === 'segment' || event.type === 'speech-start' ||
        (event.type === 'activity' && event.speaking)),
      'The real VAD must reject the fixed short fragment before ASR starts');
      const previous = await app.evaluate((_electron, from) =>
        globalThis.realAudio.events.slice(0, from).findLast((event) =>
          event.type === 'audio-progress' && event.source === 'system' && !event.pending)?.processedThroughMs,
      from);
      assert.ok(Number.isFinite(previous) && played.progress?.processedThroughMs >= previous + 3000,
        'The Worker must acknowledge silence beyond the pre-roll after the short fragment');
      await floating.waitForFunction((through) => window.realAudioEvents.some((event) =>
        event.type === 'audio-progress' && event.source === 'system' && !event.pending &&
        event.processedThroughMs >= through), played.progress.processedThroughMs);
      assert.equal(await question.inputValue(), '');
      assert.equal(await app.evaluate(() => globalThis.realAudio.requests.length), count);
      console.log(JSON.stringify({ model, id: item.id, expectation: 'VAD rejection',
        passed: true, naturalFinals: 0, providerRequests: 0 }));
      continue;
    }
    assert.ok(
      finals.length &&
        finals.some((segment) => segment.reason === 'silence' && segment.text.trim()),
      'Empty ASR output or a forced stop final is not a filtering pass',
    );
    const text = finals.map((segment) => segment.text).join(' ');
    const last = finals.findLast((segment) => segment.reason === 'silence');
    const deadline = last.silenceStartMs + 1800;
    assert.ok(Number.isFinite(deadline));
    assert.ok(
      audit.events.some(
        (event) =>
          event.type === 'audio-progress' &&
          event.source === 'system' &&
          !event.pending &&
          event.processedThroughMs >= deadline,
      ),
      'Real processed audio must cross the 1800 ms gate',
    );
    await floating.waitForFunction(
      (deadline) =>
        window.realAudioEvents.some(
          (event) =>
            event.type === 'audio-progress' &&
            event.source === 'system' &&
            !event.pending &&
            event.processedThroughMs >= deadline,
        ),
      deadline,
    );
    if (item.kind === 'filler') {
      const recognizedFiller = {
        ack: /^(?:好|好的)+$/u,
        um: /^嗯+$/u,
        ah: /^啊+$/u,
        uh: /^(?:呃|额)+$/u,
      }[item.id.split('-')[0]];
      assert.ok(
        recognizedFiller?.test(compact(text)),
        'The actual transcript must contain only the fixture filler, allowing ASR punctuation and repetitions',
      );
      await floating.waitForFunction(
        (text) => document.querySelector('[aria-label="面试提问"]').value === text,
        text,
      );
      await new Promise((resolve) => setTimeout(resolve, 250));
      assert.equal(
        await app.evaluate(() => globalThis.realAudio.requests.length),
        count,
        'Pure recognized filler must not trigger an automatic provider request',
      );
      await floating.getByRole('button', { name: '发送面试问题', exact: true }).click();
      await completed(++count);
    } else {
      assert.ok(
        item.id === 'followup'
          ? compact(text).includes('然后呢')
          : compact(text).includes('项目') && /介绍|经历/u.test(text),
        'The actual transcript must preserve the spoken question meaning',
      );
      if (model === 'paraformer' && ['fresh-question', 'question'].includes(item.id)) {
        assert.ok(compact(text).startsWith('请介绍'), 'The opening syllable must survive VAD activation');
        assert.match(compact(text), /项目(?:经历|经理)$/u, 'Natural silence must preserve the question tail');
        if (item.id === 'fresh-question') freshQuestion = text;
        else assert.equal(text, freshQuestion, 'Rejected audio must not change the next transcript');
      }
      await completed(++count);
      const request = await app.evaluate(() => globalThis.realAudio.requests.at(-1));
      const beforeRequest = audit.events.slice(0, request.eventIndex - from);
      assert.ok(
        beforeRequest.some(
          (event) =>
            event.type === 'audio-progress' &&
            !event.pending &&
            event.processedThroughMs >= deadline,
        ),
        'Automatic provider call must follow real processed silence',
      );
    }
    const request = await app.evaluate(() => globalThis.realAudio.requests.at(-1).request);
    assert.equal(request.turns.at(-1).content, text.trim());
    assert.equal(await question.inputValue(), '');
    results.push({
      id: item.id,
      kind: item.kind,
      text,
      sourceTranscriptIds: [...new Set(finals.map((segment) => segment.id))],
      automaticRequests: item.kind === 'filler' ? 0 : 1,
      manualRequests: item.kind === 'filler' ? 1 : 0,
      maxQueueMs: played.maxQueueMs,
    });
  }
  await floating.getByRole('button', { name: '结束面试', exact: true }).click();
  await Promise.all([
    floating.waitForEvent('close'),
    floating.getByRole('button', { name: '确认结束面试', exact: true }).click(),
  ]);
  const record = await page.evaluate(
    () => JSON.parse(localStorage.getItem('copilot-interview-history-v1'))[0],
  );
  assert.equal(record.answers.length, count);
  assert.equal(record.mock, false);
  for (const [index, result] of results.entries()) {
    assert.equal(record.answers[index].question, result.text);
    assert.deepEqual(record.answers[index].sourceTranscriptIds, result.sourceTranscriptIds);
    assert.ok(
      result.sourceTranscriptIds.every((id) =>
        record.transcripts.some((row) => row.id === id && row.final),
      ),
    );
  }
  console.log(
    JSON.stringify({
      model,
      device: 'cpu',
      results,
      interviewProviderRequests: count,
      realAsr: true,
      physicalAudio: false,
    }),
  );
} finally {
  await closeUiApp(app);
}
