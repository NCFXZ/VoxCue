import { testRoot, electron } from './test-workspace.mjs';
import { installUiAccount, closeUiApp } from './install-ui-account.mjs';
import { offlineElectronEntry } from './offline-electron-entry.mjs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const profile = path.join(testRoot, 'interview-usage-profile');
await mkdir(profile);
const env = { ...process.env, COPILOT_TEST_USER_DATA: profile, VITE_DEV_SERVER_URL: '' };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: [await offlineElectronEntry()], env });
try {
  await installUiAccount(app, { speech: true, components: true });
  await app.evaluate(({ app }) => {
    const require = process
      .getBuiltinModule('module')
      .createRequire(app.getAppPath() + '/package.json');
    const { SpeechHost } = require(
      app.getAppPath() + '/dist-electron/shared/electron/backend/speech/host.js',
    );
    const { ChatGPTService } = require(
      app.getAppPath() + '/dist-electron/shared/electron/backend/chat/service.js',
    );
    const { InterviewContext } = require(
      app.getAppPath() + '/dist-electron/shared/electron/application/interviewContext.js',
    );
    const prepare = InterviewContext.prototype.prepare;
    InterviewContext.prototype.prepare = function (...args) {
      // Compare the JSON wire representation: optional undefined properties
      // are absent on the wire, while every defined identity/link must remain.
      globalThis.usageOriginalRows = JSON.parse(JSON.stringify(this.entries));
      return prepare.apply(this, args);
    };
    globalThis.usageRequests = [];
    globalThis.usageAnswer = '合成项目使用 PostgreSQL，延迟为37毫秒。\n'.repeat(15);
    SpeechHost.prototype.call = async function (call) {
      globalThis.usageTranscript = (id, text, source = 'system') => {
        const at = Date.now();
        this.emit({
          type: 'segment',
          segment: {
            id,
            text,
            source,
            final: true,
            startMs: at,
            endMs: at + 10,
            reason: 'silence',
          },
        });
        return at;
      };
      return { state: call.op === 'start' ? 'running' : 'idle', model: 'Synthetic speech' };
    };
    ChatGPTService.prototype.stream = async (request, emit) => {
      globalThis.usageRequests.push({ ...structuredClone(request), receivedAt: Date.now() });
      const answerText = globalThis.usageAnswer;
      emit({ id: request.id, type: 'delta', text: answerText });
      return { answerText, usage: null, sources: [] };
    };
  });
  const login = await app.firstWindow();
  const [page] = await Promise.all([
    app.waitForEvent('window'),
    login.getByRole('button', { name: '使用 ChatGPT 继续', exact: true }).click(),
  ]);
  await page.getByRole('button', { name: '开始面试', exact: true }).click();
  const [floating] = await Promise.all([
    app.waitForEvent('window'),
    page
      .getByRole('dialog', { name: '开始面试', exact: true })
      .getByRole('button', { name: '确认开始', exact: true })
      .click(),
  ]);
  floating.setDefaultTimeout(15000);
  const errors = [];
  floating.on('pageerror', (error) => errors.push(error.message));
  const question = floating.getByRole('textbox', { name: '面试提问', exact: true });
  const requests = () => app.evaluate(() => globalThis.usageRequests);
  const transcript = (id, text, source = 'system') =>
    app.evaluate(
      (_electron, { id, text, source }) => globalThis.usageTranscript(id, text, source),
      { id, text, source },
    );
  const completed = async (count) => {
    await floating.waitForFunction(
      (count) => document.querySelectorAll('.answer-text .markdown-content').length === count,
      count,
    );
    await floating.getByRole('button', { name: '发送面试问题', exact: true }).waitFor();
    assert.equal((await requests()).length, count);
  };
  await question.waitFor();
  await transcript('ack', '嗯嗯嗯好的谢谢');
  await floating.waitForFunction(
    () => document.querySelector('[aria-label="面试提问"]').value === '嗯嗯嗯好的谢谢',
  );
  await new Promise((resolve) => setTimeout(resolve, 2400));
  assert.equal((await requests()).length, 0);
  await floating.getByRole('button', { name: '发送面试问题', exact: true }).click();
  await completed(1);
  const first = (await requests())[0];
  assert.equal(first.turns.at(-1).content, '嗯嗯嗯好的谢谢');
  const longQuestion = '请介绍 PostgreSQL 项目的目标、技术选择，以及延迟指标。\n'.repeat(12);
  const sentAt = await transcript('project', longQuestion);
  await completed(2);
  const second = (await requests())[1];
  assert.equal(second.turns.at(-1).content, longQuestion.trim());
  assert.ok(second.receivedAt - sentAt >= 2100 && second.receivedAt - sentAt < 5000);
  const actual = await app.evaluate(() => globalThis.usageAnswer);
  await transcript('actual', actual, 'microphone');
  const followUp = '呃就是刚刚那个项目为啥没选Redis';
  await transcript('follow-up', followUp);
  await completed(3);
  const third = (await requests())[2];
  const data = JSON.parse(third.turns[0].content.split('\n').slice(1).join('\n'));
  assert.ok(data.textReferenceRule);
  const literal = new Map();
  const timeline = data.timeline.map((entry) => {
    if (entry.textRef) {
      assert.ok(literal.has(entry.textRef));
      return { ...entry, text: literal.get(entry.textRef) };
    }
    literal.set(entry.id, entry.text);
    return entry;
  });
  assert.ok(timeline.some((entry) => entry.kind === 'interviewee' && entry.text === actual));
  assert.ok(timeline.some((entry) => entry.kind === 'ai_suggestion' && entry.text === actual));
  assert.ok(timeline.some((entry) => entry.kind === 'interviewer' && entry.text === longQuestion));
  assert.equal(third.turns.at(-1).content, followUp);
  await transcript(
    'correction',
    '嗯我刚说岔了哈，延迟是42毫秒，数据库还是PostgreSQL。',
    'microphone',
  );
  await transcript('correction-follow-up', '嗯那延迟为啥从37变42了');
  await completed(4);
  const fourth = (await requests())[3];
  assert.ok(fourth.turns[0].content.includes('我刚说岔了哈，延迟是42毫秒'));
  // Build a longer actual IPC conversation without waiting for synthetic
  // speech at every turn. Manual submission still uses the production store,
  // main context and provider boundary; all data remains in this temp profile.
  const hiddenCorrection = '呃咱换一套走SQLite这边吧，归档库独立部署';
  for (let index = 0; index < 14; index++) {
    const topic = index < 2 ? '项目A' : '项目B';
    const label = String.fromCharCode(0x4e10 + index);
    await app.evaluate(
      (_electron, { topic, label }) => {
        globalThis.usageAnswer =
          `${topic}的${label}部分候选表达。` +
          '先明确接口边界，再分析异步调用、故障定位、恢复顺序与设计取舍。'.repeat(20);
      },
      { topic, label },
    );
    await transcript('long-question-' + index, `嗯介绍${topic}的${label}部分咋设计的`);
    await question.fill(`嗯介绍${topic}的${label}部分咋设计的`);
    await floating.getByRole('button', { name: '发送面试问题', exact: true }).click();
    await completed(index + 5);
    await transcript(
      'long-actual-' + index,
      index === 3 ? hiddenCorrection : `${topic}这部分我负责接口设计和落地。`,
      'microphone',
    );
  }
  const restore = (request) => {
    const data = JSON.parse(request.turns[0].content.split('\n').slice(1).join('\n'));
    const literals = new Map();
    const rows = data.timeline.map((row) => {
      if (row.textRef) {
        assert.ok(
          literals.has(row.textRef),
          'every reference must resolve within the sent timeline',
        );
        const { textRef, ...metadata } = row;
        return { ...metadata, text: literals.get(textRef) };
      }
      literals.set(row.id, row.text);
      return row;
    });
    return { data, rows };
  };
  await transcript('explicit-return', '项目A的接口为啥采用异步');
  await completed(19);
  const selected = restore((await requests())[18]);
  assert.equal(selected.data.historySelection?.mode, 'related_originals');
  const originalRows = await app.evaluate(() => globalThis.usageOriginalRows);
  for (const row of originalRows.filter((row) => row.kind !== 'ai_suggestion'))
    assert.deepEqual(
      selected.rows.find((entry) => entry.id === row.id),
      row,
    );
  assert.ok(
    selected.rows.some((row) => row.kind === 'interviewee' && row.text === hiddenCorrection),
  );
  const omitted = originalRows.filter((row) => !selected.rows.some((entry) => entry.id === row.id));
  assert.ok(omitted.length > 0);
  assert.ok(omitted.every((row) => row.kind === 'ai_suggestion'));
  await transcript('oral-reference', '嗯项目A这块你再讲讲');
  await completed(20);
  const fallback = restore((await requests())[19]);
  assert.equal(fallback.data.historySelection, undefined);
  assert.deepEqual(fallback.rows, await app.evaluate(() => globalThis.usageOriginalRows));
  for (const request of await requests()) {
    assert.equal(request.modelId, first.modelId);
    assert.equal(request.effort, first.effort);
    assert.ok(request.instructions.includes('60–90秒'));
    assert.equal(request.webSearch, false);
  }
  await floating.getByRole('button', { name: '结束面试', exact: true }).click();
  await Promise.all([
    floating.waitForEvent('close'),
    floating.getByRole('button', { name: '确认结束面试', exact: true }).click(),
  ]);
  assert.deepEqual(errors, []);
  console.log(
    'PASS: offline desktop IPC, repeated/concatenated acknowledgements and manual bypass, original auto-submit interval, lossless references, actual/AI identities, oral corrections, cross-topic long-history selection preserving all real speech/questions, and colloquial-reference full fallback; model, effort and answer length preserved. Synthetic account/audio/provider only.',
  );
} finally {
  await closeUiApp(app);
}
