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
      globalThis.usageRequests.push({
        ...structuredClone(request),
        originalRows: structuredClone(globalThis.usageOriginalRows),
        receivedAt: Date.now(),
      });
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
  let count = 0;
  for (const phrase of ['嗯', '好的', '谢谢', '嗯嗯嗯好的谢谢']) {
    const sentAt = await transcript('ack-' + count, phrase);
    await completed(++count);
    const request = (await requests()).at(-1);
    assert.equal(request.turns.at(-1).content, phrase);
    assert.ok(request.receivedAt - sentAt >= 2100 && request.receivedAt - sentAt < 5000);
    assert.equal(await question.inputValue(), '');
  }
  await floating.getByRole('button', { name: '静音后自动提交完整问题', exact: true }).click();
  await transcript('manual-ack', '谢谢您');
  await floating.waitForFunction(
    () => document.querySelector('[aria-label="面试提问"]').value === '谢谢您',
  );
  await new Promise((resolve) => setTimeout(resolve, 2400));
  assert.equal((await requests()).length, count);
  await floating.getByRole('button', { name: '发送面试问题', exact: true }).click();
  await completed(++count);
  assert.equal((await requests()).at(-1).turns.at(-1).content, '谢谢您');
  await floating.getByRole('button', { name: '静音后自动提交完整问题', exact: true }).click();
  const first = (await requests())[0];
  const longQuestion = '请介绍 PostgreSQL 项目的目标、技术选择，以及延迟指标。\n'.repeat(12);
  const sentAt = await transcript('project', longQuestion);
  await completed(++count);
  const second = (await requests()).at(-1);
  assert.equal(second.turns.at(-1).content, longQuestion.trim());
  assert.ok(second.receivedAt - sentAt >= 2100 && second.receivedAt - sentAt < 5000);
  const actual = await app.evaluate(() => globalThis.usageAnswer);
  await transcript('actual', actual, 'microphone');
  const followUp = '呃就是刚刚那个项目为啥没选Redis';
  await transcript('follow-up', followUp);
  await completed(++count);
  const third = (await requests()).at(-1);
  const data = JSON.parse(third.turns[0].content.split('\n').slice(1).join('\n'));
  assert.equal(data.textReferenceRule, undefined);
  const timeline = data.timeline;
  assert.deepEqual(timeline, third.originalRows);
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
  await completed(++count);
  const fourth = (await requests()).at(-1);
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
    await completed(++count);
    await transcript(
      'long-actual-' + index,
      index === 3 ? hiddenCorrection : `${topic}这部分我负责接口设计和落地。`,
      'microphone',
    );
  }
  const completeHistory = (request) => {
    const data = JSON.parse(request.turns[0].content.split('\n').slice(1).join('\n'));
    assert.deepEqual(Object.keys(data).sort(), ['omittedOlderEntries', 'timeline']);
    const rows = data.timeline;
    for (const row of rows) {
      assert.equal(Object.hasOwn(row, 'textRef'), false);
      assert.equal(typeof row.text, 'string');
    }
    assert.deepEqual(
      rows,
      request.originalRows,
      'send every retained entry, including older AI suggestions',
    );
    return { data, rows };
  };
  await transcript('explicit-return', '项目A的接口为啥采用异步');
  await completed(++count);
  const returned = completeHistory((await requests()).at(-1));
  assert.ok(Buffer.byteLength(JSON.stringify(returned.data)) >= 24000);
  const originalRows = await app.evaluate(() => globalThis.usageOriginalRows);
  assert.deepEqual(returned.rows, originalRows);
  assert.ok(
    returned.rows.some((row) => row.kind === 'interviewee' && row.text === hiddenCorrection),
  );
  assert.ok(
    returned.rows.some((row) => row.kind === 'ai_suggestion' && row.text.startsWith('项目B')),
  );
  await transcript('oral-reference', '嗯项目A这块你再讲讲');
  await completed(++count);
  completeHistory((await requests()).at(-1));
  for (const request of await requests()) {
    completeHistory(request);
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
    'PASS: offline desktop IPC, normal automatic acknowledgement submission and manual send, original auto-submit interval, repeated literal text, actual/AI identities, oral corrections and complete retained history across topics and follow-ups; no textRef or historySelection; model, effort and answer length preserved. Synthetic account/audio/provider only.',
  );
} finally {
  await closeUiApp(app);
}
