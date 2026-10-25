import assert from 'node:assert/strict';
import path from 'node:path';
import { testRoot, electron } from './test-workspace.mjs';
import { offlineElectronEntry } from './offline-electron-entry.mjs';
import { installUiAccount, closeUiApp } from './install-ui-account.mjs';
import { captureRequested } from './capture-requested.mjs';
const app = await electron.launch({
  args: [await offlineElectronEntry()],
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
  await click(login.getByRole('button', { name: '使用 ChatGPT 继续', exact: true }));
  const main = await next;
  await main.getByRole('button', { name: '开始面试', exact: true }).waitFor();
  await click(main.getByRole('button', { name: '开始面试', exact: true }));
  const opened = app.waitForEvent('window');
  await click(main.getByRole('button', { name: '确认开始', exact: true }));
  const page = await opened;
  page.setDefaultTimeout(15000);
  page.on('pageerror', (e) => errors.push(e.message));
  await page.locator('.floating-brand').waitFor();
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await click(page.getByRole('button', { name: '静音后自动提交完整问题', exact: true }));
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
  const bounds = () =>
    app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((w) => w.webContents.getURL().endsWith('#interview'))
        .getBounds(),
    );
  const idle = () =>
    page.waitForFunction(() => !document.querySelector('.floating-shell').dataset.panelMotion);
  const nativeState = () => page.evaluate(() => window.desktop.interviewState());
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
  await finish();
  await idle();
  assert.equal((await nativeState()).transcriptVisible, false);
  assert.equal(await page.locator('.floating-transcript').isHidden(), true);
  const narrow = await bounds();
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
  await captureRequested(page, 'motion-restored');
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
    'PASS: continuous corner/shadow preservation, timed vertical and horizontal panel motion, native resize ordering, rapid-click serialization, draft/scroll persistence through hidden live updates, reduced-motion cancellation, repeated toggles and closing during motion.',
  );
} finally {
  await closeUiApp(app);
}
