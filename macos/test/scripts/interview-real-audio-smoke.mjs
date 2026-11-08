import assert from 'node:assert/strict';
import { access, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import workspace from '../../../shared/scripts/workspace.mjs';
import { testRoot, electron } from '../../../shared/test/scripts/test-workspace.mjs';
import { stageModelFixtures } from '../../../shared/test/scripts/model-fixtures.mjs';
import { offlineElectronEntry } from '../../../shared/test/scripts/offline-electron-entry.mjs';
import {
  installUiAccount,
  connectUiAccount,
  closeUiApp,
} from '../../../shared/test/scripts/install-ui-account.mjs';
import { prepareFillerAudio } from './filler-audio-fixtures.mjs';
import { requireUnlockedDesktop, holdDesktopAwake } from './desktop-session.mjs';

assert.equal(process.platform, 'darwin', 'This end-to-end fixture runs only on Mac');
assert.equal(process.arch, 'arm64', 'Use the supported Mac arm64 model/runtime catalog');
const args = process.argv.slice(2);
assert.ok(
  args.every((arg) => arg === '--all' || /^--(?:model|device|cache|voice|cases)=/.test(arg)),
  'Unknown fixture argument',
);
const option = (name, fallback) =>
  args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const model = option('model', 'paraformer');
assert.ok(['paraformer', 'qwen'].includes(model));
const device = option('device', 'cpu');
assert.ok(['cpu', 'metal'].includes(device) && (model === 'qwen' || device === 'cpu'));
requireUnlockedDesktop();
const releaseDesktop = holdDesktopAwake();
let app;
try {
  const cache = option('cache', process.env.VOXCUE_TEST_COMPONENT_CACHE);
  assert.ok(cache, 'Pass the explicitly authorized public model cache with --cache=');
  const compiled = path.join(workspace.platformRoot, 'dist-electron/shared/electron');
  const { packagesFor } = workspace.platformRequire(
    path.join(compiled, 'backend/components/catalog.js'),
  );
  const { componentLocation } = workspace.platformRequire(
    path.join(compiled, 'backend/components/service.js'),
  );
  const packages = packagesFor(process.platform, process.arch).filter(
    (pkg) => pkg.id === 'speech' || (model === 'qwen' && pkg.id === 'qwen'),
  );
  const staged = path.join(testRoot, 'verified-models');
  console.log(`Verifying and staging public ${model} model inputs; cache remains read-only.`);
  await stageModelFixtures(path.resolve(cache), staged, packages, componentLocation);
  const location = (id) => {
    const pkg = packages.find((pkg) => pkg.id === id);
    return pkg ? path.join(componentLocation(staged, pkg), 'files', pkg.directory) : undefined;
  };
  const generated = await prepareFillerAudio({ voice: option('voice', 'Tingting') });
  const requestedCases = option('cases')?.split(',');
  if (requestedCases)
    assert.ok(requestedCases.every((id) => generated.some((item) => item.id === id)));
  const audio = generated.filter((item) =>
    requestedCases
      ? requestedCases.includes(item.id)
      : args.includes('--all') || ['ack', 'question'].includes(item.id),
  );
  assert.ok(
    audio.some((item) => item.id === 'ack') && audio.some((item) => item.id === 'question'),
  );
  for (const item of audio) {
    const bytes = await readFile(item.wave);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), item.sha256);
    assert.ok(
      path.resolve(item.wave).startsWith(testRoot + path.sep),
      'WAV must belong to this test run',
    );
  }
  const preprocessorFile = await realpath(
    path.join(workspace.platformRoot, 'dist-electron/macos/electron/speech/echoCancellation.js'),
  );
  assert.ok(preprocessorFile.startsWith(workspace.platformRoot + path.sep));
  const qwenRuntime =
    model === 'qwen' ? path.join(workspace.platformRoot, 'native/bin/qwen/voxcue-qwen') : undefined;
  if (qwenRuntime) await access(qwenRuntime);
  const config = {
    root: workspace.platformRoot,
    device,
    preprocessorFile,
    speechModels: location('speech'),
    qwenModels: location('qwen'),
    qwenRuntime,
    processFile: path.join(workspace.sharedRoot, 'test/fixtures/interview-real-audio-process.cjs'),
    audio,
  };
  const configFile = path.join(testRoot, 'real-audio-config.json');
  await writeFile(configFile, JSON.stringify(config));
  const profile = path.join(testRoot, 'real-audio-profile');
  await mkdir(profile);
  app = await electron.launch({
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
        async () => ({ cuda: false, metal: config.device === 'metal' });
      const { InterviewAccess } = load(
        path.join(app.getAppPath(), 'dist-electron/macos/electron/speech/access.js'),
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
      ({ model, device }) =>
        localStorage.setItem(
          'copilot-interview-settings-v1',
          JSON.stringify({
            microphoneEnabled: false,
            system: 'fixture-system',
            speechModel: model,
            inferenceDevice: device,
          }),
        ),
      { model, device },
    );
    await page.reload();
    await page.getByRole('button', { name: '用户菜单', exact: true }).waitFor();
    console.log(`Loading the real ${model}/${device} pipeline in the isolated application.`);
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
    assert.equal(status.inferenceDevice, device);
    let count = 0;
    const completed = async (expected) => {
      await floating.waitForFunction(
        (expected) =>
          document.querySelectorAll('.answer-text .markdown-content').length === expected,
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
        }[item.id];
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
        await completed(++count);
        const request = await app.evaluate(() => globalThis.realAudio.requests.at(-1));
        const beforeRequest = await app.evaluate(
          (_electron, { from, end }) => globalThis.realAudio.events.slice(from, end),
          { from, end: request.eventIndex },
        );
        assert.ok(
          beforeRequest.some(
            (event) =>
              event.type === 'audio-progress' &&
              event.source === 'system' &&
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
        device,
        results,
        interviewProviderRequests: count,
        realAsr: true,
        physicalAudio: false,
      }),
    );
  } finally {
    await closeUiApp(app);
  }
} finally {
  releaseDesktop();
}
