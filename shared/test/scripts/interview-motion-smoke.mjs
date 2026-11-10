import { connectUiAccount } from './install-ui-account.mjs';
import assert from 'node:assert/strict';
import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import { testRoot, electron } from './test-workspace.mjs';
import { offlineElectronEntry } from './offline-electron-entry.mjs';
import { installUiAccount, closeUiApp } from './install-ui-account.mjs';
import { captureRequested } from './capture-requested.mjs';
const fixture = path.join(testRoot, 'motion-entry.cjs');
await writeFile(
  fixture,
  `
const {ipcMain,globalShortcut}=require('electron');
// Keep the owner's running application shortcuts untouched in this isolated fixture.
const shortcutKey=key=>({'Control+H':'Control+Alt+Shift+F8','Control+F':'Control+Alt+Shift+F9','Control+T':'Control+Alt+Shift+F10','Control+M':'Control+Alt+Shift+F11'}[key]??key);
const registerShortcut=globalShortcut.register.bind(globalShortcut);
const unregisterShortcut=globalShortcut.unregister.bind(globalShortcut);
globalShortcut.register=(key,callback)=>registerShortcut(shortcutKey(key),callback);
globalShortcut.unregister=key=>unregisterShortcut(shortcutKey(key));
const handle=ipcMain.handle.bind(ipcMain);
globalThis.motionIpcCalls=0;
globalThis.motionIpcTrace=[];
ipcMain.handle=(channel,handler)=>handle(channel,async(...args)=>{
  if(channel!=='interview:transcript') return handler(...args);
  globalThis.motionIpcCalls++;
  const failure=globalThis.motionIpcFailure;
  globalThis.motionIpcTrace.push({failure,visible:args[1]});
  globalThis.motionIpcFailure=null;
  if(failure==='before') throw Error('Synthetic motion IPC rejection');
  const result=await handler(...args);
  if(failure==='late') {
    await new Promise(resolve=>{globalThis.motionIpcRelease=resolve;});
    globalThis.motionIpcRelease=null;
    throw Error('Synthetic late motion IPC rejection');
  }
  return result;
});
require(${JSON.stringify(path.resolve('dist-electron/shared/electron/main.js'))});
`,
);
const app = await electron.launch({
  args: [await offlineElectronEntry(fixture)],
  env: {
    ...process.env,
    COPILOT_TEST_USER_DATA: path.join(testRoot, 'interview-motion'),
    VITE_DEV_SERVER_URL: '',
  },
});
const click = (locator) => locator.evaluate((e) => e.click());
const errors = [];
try {
  await installUiAccount(app, { speech: true, components: true });
  await app.evaluate(({ app }) => {
    const require = process
      .getBuiltinModule('module')
      .createRequire(app.getAppPath() + '/package.json');
    const { SpeechHost } = require(
      app.getAppPath() + '/dist-electron/shared/electron/backend/speech/host.js',
    );
    const original = SpeechHost.prototype.call;
    SpeechHost.prototype.call = function (call) {
      globalThis.motionSpeech = (event) => this.emit(event);
      return original.call(this, call);
    };
  });
  const login = await app.firstWindow();
  const next = app.waitForEvent('window');
  await connectUiAccount(app, login);
  const main = await next;
  await main.locator('.interview-start-trigger').waitFor();
  await click(main.locator('.interview-start-trigger'));
  const opened = app.waitForEvent('window');
  await click(main.getByRole('button', { name: '确认开始', exact: true }));
  const page = await opened;
  page.setDefaultTimeout(15000);
  page.on('pageerror', (e) => errors.push(e.message));
  await page.locator('.floating-brand').waitFor();
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await click(page.getByRole('button', { name: '静音后自动提交完整问题', exact: true }));
  // Drain the port fixture's delayed opening segment before Playwright's
  // select-all/insert-text sequence establishes the manual draft.
  await page
    .locator('.transcript-item p')
    .filter({ hasText: /^Synthetic interviewer question$/ })
    .waitFor();
  await page.getByRole('textbox', { name: '面试提问', exact: true }).fill('动画期间保留的草稿');
  const seed = async (start, count) =>
    app.evaluate(
      (_, { start, count }) => {
        for (let i = start; i < start + count; i++)
          globalThis.motionSpeech({
            type: 'segment',
            segment: {
              id: 'motion-' + i,
              source: 'system',
              text: `第${i}条合成转写，仅用于动画和滚动验证。`,
              final: true,
              startMs: i * 2000,
              endMs: i * 2000 + 1000,
              reason: 'silence',
            },
          });
      },
      { start, count },
    );
  await seed(1, 18);
  await page.locator('.transcript-item').nth(17).waitFor();
  const scroller = page.locator('.floating-transcript > .floating-scroll');
  await scroller.evaluate((e) => {
    e.scrollTop = 140;
  });
  await page.waitForFunction(
    () => document.querySelector('.floating-transcript .floating-scroll').scrollTop === 140,
  );
  await page.evaluate(() => {
    window.motionPlayers = [];
    window.pausePanelMotion = true;
    const original = Element.prototype.animate;
    Element.prototype.animate = function (frames, options) {
      const animation = original.call(this, frames, options);
      if (
        this.matches('.floating-panels,.floating-transcript,.floating-answer,.floating-notices')
      ) {
        window.motionPlayers.push(animation);
        if (window.pausePanelMotion) animation.pause();
      }
      return animation;
    };
  });
  const nativeBounds = () =>
    app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((w) => w.webContents.getURL().endsWith('#interview'))
        .getBounds(),
    );
  const bounds = async () => {
    const native = await nativeBounds();
    const { layout } = await page.evaluate(() => window.desktop.interviewState());
    return layout
      ? {
          x: native.x + (native.width - layout.width) / 2,
          y: native.y,
          width: layout.width,
          height: layout.height,
        }
      : native;
  };
  const originalNativeBounds = await nativeBounds();
  const idle = () =>
    page.waitForFunction(() => !document.querySelector('.floating-shell').dataset.panelMotion);
  const nativeState = () => page.evaluate(() => window.desktop.interviewState());
  const minimumSettingsBounds = (anchor, visible) =>
    app.evaluate(
      ({ app, screen }, { anchor, visible }) => {
        const require = process
          .getBuiltinModule('module')
          .createRequire(app.getAppPath() + '/package.json');
        const { fitInterviewBounds, interviewLayout } = require(
          app.getAppPath() + '/dist-electron/shared/electron/contracts/interviewLayout.js',
        );
        return fitInterviewBounds(
          anchor,
          screen.getDisplayMatching(anchor).workArea,
          interviewLayout.minimumScale,
          visible,
        );
      },
      { anchor, visible },
    );
  const finish = () =>
    page.evaluate(() => {
      for (const a of window.motionPlayers) if (a.playState !== 'idle') a.finish();
      window.motionPlayers = [];
    });
  const contours = () =>
    page.locator('.floating-panels,.floating-panel').evaluateAll((nodes) =>
      nodes.map((node) => {
        const style = getComputedStyle(node);
        return {
          radius: style.borderRadius,
          corner: style.cornerShape,
          clip: style.clipPath,
          shadow: style.boxShadow,
        };
      }),
    );
  const originalContours = await contours();
  for (const contour of originalContours) assert.equal(contour.clip, 'none');
  const panelBounds = await bounds();
  await assert.rejects(main.evaluate(() => window.desktop.setInterviewSettingsOpen(true)));
  await assert.rejects(
    page.evaluate(() => window.desktop.setInterviewSettingsOpen({ width: 900 })),
  );
  assert.deepEqual(await bounds(), panelBounds, 'Invalid settings calls cannot resize the canvas');
  // Two rapid requests must produce one transition and one final native toggle.
  await page.locator('.floating-brand').evaluate((e) => {
    e.click();
    e.click();
  });
  await page.waitForFunction(
    () => document.querySelector('.floating-shell').dataset.panelMotion === 'collapse',
  );
  assert.equal((await nativeState()).collapsed, false);
  assert.deepEqual(await bounds(), panelBounds, 'Native shrink must wait for the exit animation');
  await page.evaluate(() => window.motionPlayers.forEach((a) => (a.currentTime = 80)));
  const folded = await page.locator('.floating-panels').evaluate((e) => ({
    opacity: +getComputedStyle(e).opacity,
    clip: getComputedStyle(e).clipPath,
  }));
  assert.ok(folded.opacity > 0 && folded.opacity < 1);
  assert.equal(folded.clip, 'none', 'Motion must not add a circular clip over continuous corners');
  assert.deepEqual(await contours(), originalContours);
  await captureRequested(page, 'whole-panels-folding', { animations: 'allow' });
  await finish();
  await idle();
  assert.equal((await nativeState()).collapsed, true);
  assert.ok((await bounds()).height < panelBounds.height);
  const collapsedBounds = await bounds();
  const minimumBounds = await minimumSettingsBounds(collapsedBounds, false);
  const settings = page.getByRole('dialog', { name: '面试设置', exact: true });
  await click(page.getByRole('button', { name: '面试设置', exact: true }));
  await settings.waitFor();
  const settingsBounds = await bounds();
  assert.equal((await nativeState()).collapsed, true, 'Settings preserve the collapsed state');
  assert.ok(settingsBounds.height > collapsedBounds.height);
  assert.ok(Math.abs(settingsBounds.height - minimumBounds.height) <= 1);
  assert.ok(Math.abs(settingsBounds.width - minimumBounds.width) <= 1);
  assert.equal(settingsBounds.y, collapsedBounds.y);
  assert.ok(
    Math.abs(
      settingsBounds.x + settingsBounds.width / 2 - collapsedBounds.x - collapsedBounds.width / 2,
    ) <= 1,
  );
  const dialogLayout = await settings.evaluate((dialog) => {
    const rect = dialog.getBoundingClientRect();
    const scroll = dialog.querySelector('.dialog-scroll');
    return {
      top: rect.top,
      bottom: rect.bottom,
      viewport: document.querySelector('.floating-viewport').clientHeight,
      contentHeight: scroll.clientHeight,
    };
  });
  assert.ok(dialogLayout.top >= 0 && dialogLayout.bottom <= dialogLayout.viewport);
  assert.ok(dialogLayout.contentHeight > 100, 'Collapsed settings expose their editable content');
  await captureRequested(page, 'collapsed-interview-settings');
  await settings.getByRole('button', { name: '选择播放设备', exact: true }).click();
  await page.getByRole('menuitemradio', { name: '默认播放设备', exact: true }).waitFor();
  await page.keyboard.press('Escape');
  await settings.getByRole('button', { name: '关闭对话框', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('[data-modal-exit]'));
  await page.waitForFunction(() => document.querySelector('.floating-viewport').clientHeight < 100);
  assert.deepEqual(await bounds(), collapsedBounds, 'Closing settings restores the folded canvas');
  await click(page.locator('.floating-brand'));
  await page.waitForFunction(() =>
    window.motionPlayers.some((a) => a.effect?.target?.matches('.floating-panels')),
  );
  assert.equal((await nativeState()).collapsed, false);
  assert.deepEqual(await bounds(), panelBounds, 'Native expansion must precede entry');
  await finish();
  await idle();
  assert.equal(await scroller.evaluate((e) => e.scrollTop), 140);
  assert.equal(
    await page.getByRole('textbox', { name: '面试提问', exact: true }).inputValue(),
    '动画期间保留的草稿',
  );
  const toggle = page.getByRole('button', { name: '转写面板', exact: true });
  const nativeBeforeTranscript = await nativeBounds();
  await click(toggle);
  await page.waitForFunction(
    () => document.querySelector('.floating-shell').dataset.panelMotion === 'hide-transcript',
  );
  assert.equal((await nativeState()).transcriptVisible, true);
  assert.deepEqual(await bounds(), panelBounds);
  await page.evaluate(() => window.motionPlayers.forEach((a) => (a.currentTime = 90)));
  assert.ok(
    await page
      .locator('.floating-answer')
      .evaluate((e) => new DOMMatrix(getComputedStyle(e).transform).m41 < 0),
  );
  assert.deepEqual(await contours(), originalContours);
  await captureRequested(page, 'transcript-closing', { animations: 'allow' });
  if (process.platform === 'darwin')
    await app.evaluate(async ({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find((w) =>
        w.webContents.getURL().endsWith('#interview'),
      );
      globalThis.transcriptResizeFrames = [];
      globalThis.transcriptFramePhase = 'baseline';
      win.webContents.beginFrameSubscription((image) => {
        if (globalThis.transcriptResizeFrames.length >= 60) return;
        const size = image.getSize(),
          bytes = image.toBitmap({ scaleFactor: 1 });
        const scale = Math.sqrt(bytes.length / (size.width * size.height * 4));
        const width = Math.round(size.width * scale);
        const nativeScale = width / win.getContentBounds().width;
        const offset = (Math.round(30 * nativeScale) * width + Math.floor(width / 2)) * 4;
        globalThis.transcriptResizeFrames.push({
          phase: globalThis.transcriptFramePhase,
          image: size,
          native: win.getBounds(),
          toolbarAlpha: bytes[offset + 3],
        });
      });
      win.webContents.invalidate();
      const deadline = Date.now() + 2000;
      while (!globalThis.transcriptResizeFrames.length && Date.now() < deadline)
        await new Promise((resolve) => setTimeout(resolve, 10));
      if (!globalThis.transcriptResizeFrames.length)
        throw Error('The compositor subscription did not become ready');
      globalThis.transcriptFramePhase = 'transition';
    });
  await finish();
  await idle();
  assert.equal((await nativeState()).transcriptVisible, false);
  assert.equal(await page.locator('.floating-transcript').isHidden(), true);
  const narrow = await bounds();
  if (process.platform === 'darwin')
    assert.deepEqual(
      await nativeBounds(),
      nativeBeforeTranscript,
      'Mac transcript hiding must retain the native surface',
    );
  if (process.platform === 'darwin') {
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
    const frames = await app.evaluate(async ({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find((w) =>
        w.webContents.getURL().endsWith('#interview'),
      );
      globalThis.transcriptFramePhase = 'settled';
      win.webContents.invalidate();
      const deadline = Date.now() + 2000;
      while (
        !globalThis.transcriptResizeFrames.some((frame) => frame.phase === 'settled') &&
        Date.now() < deadline
      )
        await new Promise((resolve) => setTimeout(resolve, 10));
      win.webContents.endFrameSubscription();
      return globalThis.transcriptResizeFrames;
    });
    assert.ok(frames.length > 0, 'The native transcript resize must present a compositor frame');
    assert.ok(
      frames.some((frame) => frame.phase === 'settled'),
      'The logical transcript toggle must present a final compositor frame',
    );
    assert.ok(
      frames.every((frame) => frame.toolbarAlpha > 0),
      'The toolbar must remain painted: ' + JSON.stringify(frames),
    );
  }
  assert.ok(narrow.width < panelBounds.width);
  assert.ok(Math.abs(narrow.x + narrow.width / 2 - panelBounds.x - panelBounds.width / 2) <= 1);
  await seed(19, 2);
  await page.locator('.transcript-item').nth(19).waitFor({ state: 'attached' });
  await click(toggle);
  await page.waitForFunction(() =>
    window.motionPlayers.some((a) => a.effect?.target?.matches('.floating-transcript')),
  );
  assert.equal((await nativeState()).transcriptVisible, true);
  assert.deepEqual(await bounds(), panelBounds);
  if (process.platform === 'darwin')
    assert.deepEqual(
      await nativeBounds(),
      nativeBeforeTranscript,
      'Mac transcript restoration must retain the native surface',
    );
  await finish();
  await idle();
  assert.equal(
    await scroller.evaluate((e) => e.scrollTop),
    140,
    'Hidden live updates must not lose an earlier reading position',
  );
  // Finish a transition immediately when reduced motion is enabled mid-flight.
  await click(toggle);
  await page.waitForFunction(() => window.motionPlayers.length > 0);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await idle();
  assert.equal((await nativeState()).transcriptVisible, false);
  await click(page.locator('.floating-brand'));
  await idle();
  const answerOnlyCollapsed = await bounds();
  const answerOnlyMinimum = await minimumSettingsBounds(answerOnlyCollapsed, false);
  await click(page.getByRole('button', { name: '面试设置', exact: true }));
  await settings.waitFor();
  const answerOnlySettings = await bounds();
  assert.equal(
    answerOnlySettings.width,
    settingsBounds.width,
    'Collapsed settings use one width regardless of transcript visibility',
  );
  assert.equal(
    answerOnlySettings.height,
    settingsBounds.height,
    'Collapsed settings use one height regardless of transcript visibility',
  );
  assert.ok(Math.abs(answerOnlySettings.width - answerOnlyMinimum.width) <= 1);
  assert.ok(Math.abs(answerOnlySettings.height - answerOnlyMinimum.height) <= 1);
  assert.equal((await nativeState()).transcriptVisible, false);
  await captureRequested(page, 'collapsed-answer-only-settings');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.querySelector('.floating-viewport').clientHeight < 100);
  assert.deepEqual(await bounds(), answerOnlyCollapsed);
  await click(page.locator('.floating-brand'));
  await idle();
  assert.deepEqual(await bounds(), narrow, 'Settings preserve the prior answer-only panel size');
  await page.evaluate(() => {
    window.motionPlayers = [];
    window.pausePanelMotion = false;
  });
  await click(toggle);
  await idle();
  assert.equal(await page.evaluate(() => window.motionPlayers.length), 0);
  await click(page.locator('.floating-brand'));
  await idle();
  await click(page.locator('.floating-brand'));
  await idle();
  assert.equal(await page.evaluate(() => window.motionPlayers.length), 0);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  // Exercise real uninterrupted timing and confirm animations release their fill.
  for (let i = 0; i < 4; i++) {
    await click(toggle);
    await idle();
  }
  assert.equal((await nativeState()).transcriptVisible, true);
  assert.deepEqual(await bounds(), panelBounds);
  assert.equal(
    await page.locator('.floating-answer').evaluate((e) => getComputedStyle(e).transform),
    'none',
  );
  assert.equal(
    await page.getByRole('textbox', { name: '面试提问', exact: true }).inputValue(),
    '动画期间保留的草稿',
  );
  assert.equal(await scroller.evaluate((e) => e.scrollTop), 140);
  assert.deepEqual(await contours(), originalContours);
  await app.evaluate(() => {
    globalThis.motionIpcFailure = 'before';
  });
  await click(toggle);
  await page.getByText('窗口切换失败，请重试。', { exact: true }).waitFor();
  await idle();
  assert.equal((await nativeState()).transcriptVisible, true);
  assert.equal(await page.locator('.floating-transcript').isVisible(), true);
  assert.deepEqual(await bounds(), panelBounds, 'Rejected IPC preserves the confirmed canvas');
  await app.evaluate(() => {
    globalThis.motionIpcFailure = 'late';
  });
  await click(toggle);
  await page.waitForFunction(
    async () => !(await window.desktop.interviewState()).transcriptVisible,
  );
  await app.evaluate(async () => {
    const deadline = Date.now() + 5000;
    while (typeof globalThis.motionIpcRelease !== 'function' && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 10));
    if (typeof globalThis.motionIpcRelease !== 'function')
      throw Error(
        'Late IPC fixture did not become pending: ' + JSON.stringify(globalThis.motionIpcTrace),
      );
  });
  const calls = await app.evaluate(() => globalThis.motionIpcCalls);
  await click(toggle);
  assert.equal(
    await app.evaluate(() => globalThis.motionIpcCalls),
    calls,
    'Pending IPC retains the motion lock',
  );
  await app.evaluate(() => {
    if (typeof globalThis.motionIpcRelease !== 'function') throw Error('Late IPC was not pending');
    globalThis.motionIpcRelease();
  });
  await idle();
  assert.equal(await page.locator('.floating-transcript').isHidden(), true);
  await click(toggle);
  await idle();
  assert.equal((await nativeState()).transcriptVisible, true);
  assert.deepEqual(await bounds(), panelBounds, 'Retry restores the canvas after a late failure');
  assert.equal(await scroller.evaluate((e) => e.scrollTop), 140);
  await scroller.evaluate((node) => {
    node.scrollTop = node.scrollHeight;
  });
  await page.waitForFunction(
    () => !document.querySelector('.floating-transcript > .follow-latest'),
  );
  await click(toggle);
  await idle();
  await seed(21, 2);
  await page.locator('.transcript-item').nth(21).waitFor({ state: 'attached' });
  await click(toggle);
  await idle();
  assert.ok(
    await scroller.evaluate((node) => node.scrollHeight - node.scrollTop - node.clientHeight <= 1),
    'A bottom-following transcript resumes at the bottom after hidden live updates',
  );
  await captureRequested(page, 'motion-restored');
  if ((await nativeState()).layout)
    assert.deepEqual(
      await nativeBounds(),
      originalNativeBounds,
      'Panel changes never move or resize the native canvas',
    );
  assert.deepEqual(errors, []);
  // Closing our isolated window while its animation is pending must release it.
  await page.evaluate(() => {
    window.pausePanelMotion = true;
  });
  await click(page.locator('.floating-brand'));
  await page.waitForFunction(
    () => document.querySelector('.floating-shell').dataset.panelMotion === 'collapse',
  );
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((w) => w.webContents.getURL().endsWith('#interview'))
      .destroy(),
  );
  console.log(
    'PASS: collapsed settings canvas/content/restore, continuous corner/shadow preservation, timed panel motion, native resize ordering, rapid-click serialization, draft/scroll persistence, reduced-motion cancellation, IPC rejection/late-result reconciliation and retry, repeated toggles and closing during motion.',
  );
} finally {
  await closeUiApp(app);
}
