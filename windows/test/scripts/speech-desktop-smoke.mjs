import { connectUiAccount } from '../../../shared/test/scripts/install-ui-account.mjs';
import { waitForAsync } from '../../../shared/test/scripts/wait-for-async.mjs';
import { closeUiApp } from '../../../shared/test/scripts/install-ui-account.mjs';
import { installUiAccount } from '../../../shared/test/scripts/install-ui-account.mjs';
import {
  testRoot,
  electron,
  spawnTestProcess as spawn,
} from '../../../shared/test/scripts/test-workspace.mjs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
if (process.argv.includes('--packaged'))
  throw Error(
    'Production package tests require Windows Sandbox; this script uses development hardware audio only.',
  );
if (!process.argv.includes('--hardware-audio'))
  throw Error('Physical audio is opt-in: confirm the current scope, then pass --hardware-audio.');
const profile = path.resolve(testRoot, 'test/results', `speech-desktop-${Date.now()}`);
await mkdir(profile, { recursive: true });
const env = { ...process.env, COPILOT_TEST_USER_DATA: profile, VITE_DEV_SERVER_URL: '' };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  args: ['.'],
  env,
});
let player;
try {
  await installUiAccount(app, {});
  const login = await app.firstWindow();
  const main = await connectUiAccount(app, login);
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
  assert.equal(await main.getByRole('button', { name: '语音输入', exact: true }).count(), 0);
  assert.equal(await composer.getAttribute('readonly'), null);
  await main.locator('.interview-start-trigger').click();
  assert.equal(await main.getByRole('button', { name: '问题来源', exact: true }).count(), 0);
  await main
    .getByRole('dialog', { name: '开始面试', exact: true })
    .getByRole('button', { name: '取消', exact: true })
    .click();
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1);
  await main.locator('.interview-start-trigger').click();
  await main.screenshot();
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
  await waitForAsync(
    page,
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
  await waitForAsync(
    page,
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
  await page.screenshot();
  await page.evaluate(async () =>
    window.desktop.speech({
      op: 'start',
      options: (await window.desktop.interviewState()).configuration.options,
    }),
  );
  await waitForAsync(
    page,
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
  await waitForAsync(
    page,
    async () => (await window.desktop.speech({ op: 'status' })).state === 'running',
  );
  assert.equal(await page.getByRole('button', { name: '转写模式', exact: true }).count(), 0);
  await page.getByRole('button', { name: '结束面试', exact: true }).click();
  await page.getByRole('button', { name: '确认结束面试', exact: true }).click();
  console.log(
    JSON.stringify(
      {
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
