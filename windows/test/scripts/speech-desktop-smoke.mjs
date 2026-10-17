import { closeUiApp } from '../../../shared/test/scripts/install-ui-account.mjs';
import { installUiAccount } from '../../../shared/test/scripts/install-ui-account.mjs';
import { _electron as electron } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const packaged = process.argv.includes('--packaged');
const profile = path.resolve(
  'test/results',
  `speech-${packaged ? 'packaged' : 'desktop'}-${Date.now()}`,
);
await mkdir(profile, { recursive: true });
const env = { ...process.env, COPILOT_TEST_USER_DATA: profile, VITE_DEV_SERVER_URL: '' };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  ...(packaged
    ? { executablePath: path.resolve('release-smoke/VoxCue-win32-x64/VoxCue.exe'), args: [] }
    : { args: ['.'] }),
  env,
});
let player;
try {
  await installUiAccount(app, {});
  const login = await app.firstWindow();
  const [main] = await Promise.all([
    app.waitForEvent('window'),
    login.getByRole('button', { name: '使用 ChatGPT 继续', exact: true }).click(),
  ]);
  const unauthorized = await main.evaluate(async () => {
    try {
      await window.desktop.speech({ op: 'start', options: { sources: ['system'] } });
      return false;
    } catch {
      return true;
    }
  });
  assert.equal(unauthorized, true);
  main.setDefaultTimeout(30000);
  const composer = main.getByRole('textbox', { name: '聊天消息', exact: true });
  await composer.fill('已有问题');
  await main.getByRole('button', { name: '语音输入', exact: true }).click();
  await main.getByRole('button', { name: '停止语音输入', exact: true }).waitFor();
  await main.waitForFunction(
    async () => (await window.desktop.dictation({ op: 'status' })).state === 'running',
  );
  // The native microphone lifecycle is real. Controlled recognizer events below
  // verify composer editing without depending on someone speaking at the device.
  const dictationEvent = (text, final, source = 'microphone') =>
    app.evaluate(
      ({ BrowserWindow }, payload) => {
        BrowserWindow.getAllWindows()
          .find((w) => !w.webContents.getURL().includes('#'))
          .webContents.send('dictation:event', { type: 'segment', segment: payload });
      },
      { id: 'composer-test', source, text, final, startMs: Date.now(), endMs: Date.now() + 1000 },
    );
  await dictationEvent('语音', false);
  await dictationEvent('语音输入问题', true);
  await dictationEvent('迟到临时文字', false);
  await dictationEvent('系统音频不能写进草稿', true, 'system');
  await main.waitForFunction(() =>
    document
      .querySelector('textarea[aria-label="聊天消息"]')
      .value.includes('已有问题 语音输入问题'),
  );
  assert.equal(
    await main.locator('.chat-message').count(),
    0,
    'Dictation must not send a chat request',
  );
  assert.equal(
    await composer.getAttribute('readonly'),
    '',
    'Prevent edits from being overwritten during live dictation',
  );
  await main.getByRole('button', { name: '停止语音输入', exact: true }).click();
  await main.getByRole('button', { name: '语音输入', exact: true }).waitFor();
  assert.equal(
    (await main.evaluate(() => window.desktop.dictation({ op: 'status' }))).state,
    'idle',
  );
  assert.ok((await composer.inputValue()).includes('语音输入问题'));
  await composer.fill('');
  // A second click during loading must safely stop and allow another session.
  await main.getByRole('button', { name: '语音输入', exact: true }).click();
  await main.getByRole('button', { name: '停止语音输入', exact: true }).click();
  await main.getByRole('button', { name: '语音输入', exact: true }).waitFor();
  assert.equal(
    (await main.evaluate(() => window.desktop.dictation({ op: 'status' }))).state,
    'idle',
  );
  await main.getByRole('button', { name: '开始面试', exact: true }).click();
  assert.equal(await main.getByRole('button', { name: '问题来源', exact: true }).count(), 0);
  await main
    .getByRole('dialog', { name: '开始面试', exact: true })
    .getByRole('button', { name: '取消', exact: true })
    .click();
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1);
  await main.getByRole('button', { name: '开始面试', exact: true }).click();
  await main.screenshot({ path: path.join(profile, 'start-dialog.png') });
  const [page] = await Promise.all([
    app.waitForEvent('window'),
    main.getByRole('button', { name: '确认开始', exact: true }).click(),
  ]);
  page.setDefaultTimeout(30000);
  await page.getByRole('button', { name: '结束面试', exact: true }).waitFor();
  await page.getByRole('button', { name: '静音后自动提交完整问题', exact: true }).click();
  assert.equal(await page.locator('.floating-panel > footer').count(), 0);
  assert.equal(
    await page
      .getByRole('button', {
        name: /转写模式|麦克风设备|播放设备|问题来源|开始采集|暂停采集|继续采集|停止采集/,
      })
      .count(),
    0,
  );
  await page.evaluate(() => {
    window.speechTest = { events: [], metrics: [] };
    window.desktop.onSpeechEvent((e) => {
      if (e.type === 'segment' && e.segment.source === 'system')
        window.speechTest.events.push(e.segment);
      if (e.type === 'metrics') window.speechTest.metrics.push(e);
    });
  });
  await page.waitForFunction(
    async () => (await window.desktop.speech({ op: 'status' })).state === 'running',
  );
  assert.equal(
    await page.evaluate(async () => {
      try {
        await window.desktop.dictation({ op: 'start' });
        return false;
      } catch {
        return true;
      }
    }),
    true,
    'Interview renderer cannot use main-window dictation',
  );
  assert.equal(
    await main.evaluate(async () => {
      try {
        await window.desktop.dictation({ op: 'start' });
        return false;
      } catch {
        return true;
      }
    }),
    true,
    'Main-window dictation cannot replace interview capture',
  );
  assert.equal(
    await page.evaluate(async () => {
      try {
        await window.desktop.speech({ op: 'start', options: { sources: ['system'] } });
        return false;
      } catch {
        return true;
      }
    }),
    true,
    'Confirmed interview sources cannot be changed',
  );
  player = spawn(
    'powershell.exe',
    [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      'test/scripts/play-speech-fixture.ps1',
      '-AudioFile',
      path.resolve('../shared/test/fixtures/speech-audio/playback-low.wav'),
    ],
    { windowsHide: true, stdio: 'ignore' },
  );
  await page.waitForFunction(() =>
    window.speechTest.events.some((e) => e.final && e.text.includes('explain')),
  );
  await page.evaluate(() => window.desktop.speech({ op: 'pause' }));
  await page.waitForFunction(
    async () => (await window.desktop.speech({ op: 'status' })).state === 'paused',
  );
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()
      .find((w) => w.webContents.getURL().endsWith('#interview'))
      .webContents.send('speech:event', {
        type: 'segment',
        segment: {
          id: 'mic-layout',
          source: 'microphone',
          text: '面试者的回答',
          final: true,
          startMs: Date.now(),
          endMs: Date.now() + 1000,
        },
      });
  });
  await page.getByText('面试者的回答', { exact: true }).waitFor();
  const layout = await page.evaluate(() => {
    const left = document.querySelector('.transcript-item.interviewer').getBoundingClientRect();
    const right = document.querySelector('.transcript-item.interviewee').getBoundingClientRect();
    const pane = document.querySelector('.floating-scroll').getBoundingClientRect();
    const placeholder = document.querySelector('textarea[aria-label="面试提问"]').placeholder;
    return {
      left: left.x,
      right: right.right,
      paneLeft: pane.left,
      paneRight: pane.right,
      placeholder,
    };
  });
  assert.ok(Math.abs(layout.left - layout.paneLeft - 20) < 3, 'System audio aligns left');
  assert.ok(Math.abs(layout.paneRight - layout.right - 20) < 3, 'Microphone aligns right');
  assert.ok(
    !layout.placeholder.includes('面试者的回答'),
    'Microphone text never enters the question',
  );
  assert.equal(
    await page.locator('.answer-text').count(),
    0,
    'Default manual mode must not call AI per VAD segment',
  );
  await page.getByRole('button', { name: '发送面试问题', exact: true }).click();
  await page.locator('.answer-text').first().waitFor();
  assert.ok(await page.getByText('Synthetic interview answer', { exact: true }).count());
  await page.screenshot({ path: path.join(profile, 'speech.png') });
  await page.evaluate(async () =>
    window.desktop.speech({
      op: 'start',
      options: (await window.desktop.interviewState()).configuration.options,
    }),
  );
  await page.waitForFunction(
    async () => (await window.desktop.speech({ op: 'status' })).state === 'running',
  );
  await page.reload();
  assert.ok(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem('copilot-interview-history-v1') ?? '[]').some(
        (r) => r.mock === false && r.status === 'interrupted',
      ),
    ),
    'Reload should synchronously preserve received real transcripts',
  );
  await page.waitForFunction(
    async () => (await window.desktop.speech({ op: 'status' })).state === 'running',
  );
  assert.equal(await page.getByRole('button', { name: '转写模式', exact: true }).count(), 0);
  await page.getByRole('button', { name: '结束面试', exact: true }).click();
  await page.getByRole('button', { name: '确认结束面试', exact: true }).click();
  await writeFile(
    path.join(profile, 'result.json'),
    JSON.stringify(
      {
        packaged,
        unauthorized,
        localModelAndDll: true,
        actualLoopbackToUi: true,
        nativeMicrophoneDictation: true,
        controlledComposerEvents: true,
        automaticallyStarted: true,
        lockedConfiguration: true,
        fixedSpeakerAlignment: true,
        manualSubmission: true,
        syntheticAnswerPort: true,
        reloadRetainedConfigurationAndRestarted: true,
        close: true,
      },
      null,
      2,
    ),
  );
  console.log('Speech desktop passed', profile);
} finally {
  player?.kill();
  await closeUiApp(app);
}
