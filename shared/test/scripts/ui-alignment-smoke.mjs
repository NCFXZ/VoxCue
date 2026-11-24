import { openModelMenu, openReasoningControl } from './install-ui-account.mjs';
import { connectUiAccount } from './install-ui-account.mjs';
import { offlineElectronEntry } from './offline-electron-entry.mjs';
import { testRoot, electron } from './test-workspace.mjs';
import { closeUiApp } from './install-ui-account.mjs';
import { installUiAccount } from './install-ui-account.mjs';
import { captureRequested } from './capture-requested.mjs';

import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

// Isolated visual fixture: no real account, audio or model inference requests.
const directory = path.resolve(path.join(testRoot, 'test/results'), `ui-alignment-${Date.now()}`);
await mkdir(directory, { recursive: true });
const app = await electron.launch({
  args: [await offlineElectronEntry()],
  env: {
    ...process.env,
    COPILOT_TEST_USER_DATA: path.join(directory, 'profile'),
    VITE_DEV_SERVER_URL: '',
  },
});
const checks = [];
const longName = 'A very long model name used to verify compact controls and constrained menus';
const check = (name, passed, detail) => checks.push({ name, passed, detail });
const settle = (page) =>
  page.waitForFunction(() =>
    document
      .getAnimations()
      .every(
        (animation) =>
          animation.effect?.getTiming().iterations === Infinity ||
          animation.playState !== 'running',
      ),
  );
const startNavigationStyles = (page, selector) =>
  page.evaluate((selector) => {
    const frames = [];
    let frame;
    const sample = () => {
      frames.push(
        [...document.querySelectorAll(selector)].map((button) => {
          const style = getComputedStyle(button);
          const normal = button.querySelector('.selection-label-normal');
          const bold = button.querySelector('.selection-label-bold');
          return {
            label:
              button.getAttribute('aria-label') ??
              button.querySelector('.conversation')?.textContent.trim() ??
              button.textContent.trim(),
            weight: Number(style.fontWeight),
            color: style.color,
            background: style.backgroundColor,
            normalOpacity: normal ? Number(getComputedStyle(normal).opacity) : null,
            boldOpacity: bold ? Number(getComputedStyle(bold).opacity) : null,
            normalWeight: normal ? getComputedStyle(normal).fontWeight : null,
            boldWeight: bold ? getComputedStyle(bold).fontWeight : null,
            singleText:
              !bold ||
              (!bold.textContent &&
                bold.getAttribute('aria-hidden') === 'true' &&
                bold.dataset.label === normal.textContent),
            running: button
              .getAnimations({ subtree: true })
              .some((animation) => animation.playState === 'running'),
          };
        }),
      );
    };
    const tick = () => {
      sample();
      frame = requestAnimationFrame(tick);
    };
    tick();
    window.navigationStyleFrames = {
      frames,
      stop: () => {
        sample();
        cancelAnimationFrame(frame);
      },
    };
  }, selector);
const finishNavigationStyles = (page) =>
  page.evaluate(() => {
    const probe = window.navigationStyleFrames;
    probe.stop();
    delete window.navigationStyleFrames;
    return probe.frames;
  });
const assertNavigationStyles = (frames, label, changingColor) => {
  const samples = frames.map((frame) => frame.find((button) => button.label === label));
  const first = samples[0],
    last = samples.at(-1);
  assert(
    samples.some((sample) => sample.weight > 400 && sample.weight < 600),
    `${label}: weight must interpolate between real computed values`,
  );
  assert(
    samples.every(
      (sample) => sample.normalWeight === '400' && sample.boldWeight === '600' && sample.singleText,
    ),
    `${label}: real text remains once, with two fixed glyph weights`,
  );
  assert(
    samples.some(
      (sample) =>
        sample.normalOpacity > 0.02 &&
        sample.normalOpacity < 0.98 &&
        sample.boldOpacity > 0.02 &&
        sample.boldOpacity < 0.98 &&
        Math.abs(sample.normalOpacity + sample.boldOpacity - 1) < 0.02,
    ),
    `${label}: CJK selection must crossfade through actual intermediate text-layer opacities`,
  );
  assert(
    samples.some(
      (sample) => sample.background !== first.background && sample.background !== last.background,
    ),
    `${label}: background must have actual intermediate colors`,
  );
  if (changingColor)
    assert(
      samples.some((sample) => sample.color !== first.color && sample.color !== last.color),
      `${label}: text color must have actual intermediate colors`,
    );
  else
    assert.equal(
      last.color,
      first.color,
      `${label}: retain the existing neutral Settings text color`,
    );
};
const summarizeFrames = (frames) => ({
  count: frames.length,
  first: frames[0],
  last: frames.at(-1),
});
const startSelectionFrames = (page, trackControls = false) =>
  page.evaluate((trackControls) => {
    const frames = [];
    const sidebar = document.querySelector('.sidebar');
    const controls = trackControls
      ? [...document.querySelectorAll('.sidebar-toggle-button, .sidebar .nav-item > [data-ui-icon], .sidebar .avatar')]
      : [];
    const labels = trackControls
      ? [...sidebar.querySelectorAll('.nav-item > span:not(.nav-create-symbol), .conversation-title, .user-info strong')]
      : [];
    const conversations = trackControls ? [...sidebar.querySelectorAll('.conversation-row')] : [];
    const motionElements = trackControls
      ? [sidebar, ...sidebar.querySelectorAll('.sidebar-heading, .sidebar-toggle-button, .nav-item, .section-caption, .conversation, .user-button, .user-button > svg'), ...conversations, ...labels]
      : [];
    let frame;
    let afterLayout;
    const sample = () => {
      const markers = sidebar.querySelectorAll('.sidebar-selection-indicator');
      const marker = markers[0];
      if (!marker) return;
      const rect = marker.getBoundingClientRect();
      const style = getComputedStyle(marker);
      const active = sidebar.querySelector('.nav-item.active, .conversation-row.active');
      const target = active?.getBoundingClientRect();
      const motion = marker
        .getAnimations()
        .find(
          (animation) =>
            animation.transitionProperty === 'transform' && animation.playState === 'running',
        );
      frames.push({
        count: markers.length,
        hidden: marker.getAttribute('aria-hidden'),
        visible: marker.dataset.visible,
        opacity: Number(style.opacity),
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        controls: controls.map((node) => {
          const box = node.getBoundingClientRect();
          return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
        }),
        chats: conversations.map((node) => {
          const row = node.getBoundingClientRect();
          const dot = node.querySelector('.conversation-dot').getBoundingClientRect();
          return {
            left: row.left,
            width: row.width,
            centerY: row.top + row.height / 2,
            dotX: dot.left + dot.width / 2,
            dotY: dot.top + dot.height / 2,
          };
        }),
        sidebarWidth: trackControls ? sidebar.getBoundingClientRect().width : undefined,
        labels: labels.map((node) => {
          const style = getComputedStyle(node);
          const bounds = node.getBoundingClientRect();
          const panel = sidebar.getBoundingClientRect();
          const clip = node.closest('.nav-item, .sidebar-conversations, .user-button').getBoundingClientRect();
          return {
            width: bounds.width,
            visible: style.visibility === 'visible',
            opacity: Number(style.opacity),
            fits: bounds.left >= Math.max(panel.left, clip.left) - 0.5 &&
              bounds.right <= Math.min(panel.right, clip.right) + 0.5,
          };
        }),
        easedTransitions: motionElements.flatMap((node) => node.getAnimations()
          .filter((animation) => animation.transitionProperty && animation.effect.getTiming().duration > 0)
          .map(({ effect }) => [effect.getTiming().easing, effect.getKeyframes()[0]?.easing]
            .some((easing) => easing && easing !== 'linear'))),
        linear: motion
          ? Number(motion.currentTime) / Number(motion.effect.getTiming().duration)
          : null,
        target: target
          ? {
              left: target.left + 3,
              top: target.top + (target.height - 18) / 2,
              label:
                active.getAttribute('aria-label') ??
                active.querySelector('.conversation')?.textContent.trim(),
            }
          : null,
      });
    };
    const tick = () => {
      // A layout frame includes the marker update delivered by ResizeObserver.
      if (trackControls) afterLayout = setTimeout(sample, 0);
      else sample();
      frame = requestAnimationFrame(tick);
    };
    sample();
    frame = requestAnimationFrame(tick);
    window.sidebarSelectionFrames = {
      frames,
      stop: () => {
        clearTimeout(afterLayout);
        sample();
        cancelAnimationFrame(frame);
      },
    };
  }, trackControls);
const finishSelectionFrames = async (page) => {
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  await settle(page);
  return page.evaluate(() => {
    const probe = window.sidebarSelectionFrames;
    probe.stop();
    delete window.sidebarSelectionFrames;
    return probe.frames;
  });
};
const assertSelectionGeometry = (frames, name) => {
  assert.ok(frames.length > 1, name + ': selection requires actual frame samples');
  for (const frame of frames) {
    assert.equal(frame.count, 1, name + ': exactly one shared indicator');
    assert.equal(
      frame.hidden,
      'true',
      name + ': decorative indicator is hidden from accessibility',
    );
    assert.equal(Math.round(frame.width * 64) / 64, 3);
    assert.equal(Math.round(frame.height * 64) / 64, 18);
  }
  const last = frames.at(-1);
  if (last.visible === 'true') {
    assert.ok(last.target, name + ': visible indicator has a real active row');
    assert.ok(Math.abs(last.left - last.target.left) < 0.5, name + ': left aligns with active row');
    assert.ok(
      Math.abs(last.top - last.target.top) < 0.5,
      name + ': vertically centers on active row',
    );
  }
};
const assertSelectionFade = (frames, from, to, name) => {
  assertSelectionGeometry(frames, name);
  assert.equal(frames[0].opacity, from, name + ': initial opacity');
  assert.equal(frames.at(-1).opacity, to, name + ': final opacity');
  assert.equal(frames.at(-1).visible, to ? 'true' : 'false', name + ': final visibility');
  assert.ok(
    frames.filter((frame) => frame.opacity > 0.02 && frame.opacity < 0.98).length > 1,
    name + ': real intermediate fade frames',
  );
  const painted = frames.filter((frame) => frame.opacity > 0.02);
  for (const frame of painted) {
    assert.ok(Math.abs(frame.left - painted[0].left) < 0.5, name + ': fade stays at its target x');
    assert.ok(Math.abs(frame.top - painted[0].top) < 0.5, name + ': fade stays at its target y');
  }
};
const assertSelectionSlide = (frames, name) => {
  assertSelectionGeometry(frames, name);
  assert.ok(
    frames.every((frame) => frame.opacity === 1),
    name + ': visible-to-visible movement stays opaque',
  );
  const first = frames[0],
    last = frames.at(-1);
  const dx = last.left - first.left,
    dy = last.top - first.top;
  const distance = dx * dx + dy * dy;
  assert.ok(distance > 1, name + ': distinct source and destination');
  const progress = frames.map(
    (frame) => ((frame.left - first.left) * dx + (frame.top - first.top) * dy) / distance,
  );
  assert.ok(
    progress.filter((value) => value > 0.02 && value < 0.98).length > 1,
    name + ': real intermediate sliding positions',
  );
  assert.ok(
    frames.some(
      (frame, index) =>
        frame.linear !== null &&
        progress[index] > 0.02 &&
        progress[index] < 0.98 &&
        Math.abs(progress[index] - frame.linear) > 0.05,
    ),
    name + ': measured path uses nonlinear easing',
  );
  for (let index = 1; index < progress.length; index++)
    assert.ok(
      progress[index] + 0.02 >= progress[index - 1] &&
        progress[index] >= -0.02 &&
        progress[index] <= 1.02,
      name + ': movement progresses smoothly toward its actual row',
    );
};
const assertSidebarMotion = (frames, name) => {
  assertSelectionGeometry(frames, name);
  assert.ok(frames.every((frame) => frame.visible === 'true' && frame.opacity === 1),
    name + ': the selected chat stays visible');
  const easing = frames.flatMap((frame) => frame.easedTransitions);
  assert.ok(easing.length > 0 && easing.every(Boolean), name + ': the recorded transitions use nonlinear easing');
  const first = frames[0].controls;
  const last = frames.at(-1).controls;
  assert.equal(first.length, 5);
  for (const [index, start] of first.entries()) {
    const dx = last[index].x - start.x;
    const dy = last[index].y - start.y;
    const distance = dx * dx + dy * dy;
    assert.ok(distance > 1, `${name}: control ${index} has distinct endpoints`);
    const progress = frames.map(({ controls }) =>
      ((controls[index].x - start.x) * dx + (controls[index].y - start.y) * dy) / distance,
    );
    assert.ok(progress.filter((value) => value > 0.02 && value < 0.98).length > 1,
      `${name}: control ${index} visits actual intermediate positions`);
    assert.ok(progress.every((value, frame) => frame === 0 ||
      (value + 0.02 >= progress[frame - 1] && value >= -0.02 && value <= 1.02)),
      `${name}: control ${index} moves smoothly toward its destination`);
  }
  const startFrame = frames[0];
  const endFrame = frames.at(-1);
  for (const [index, start] of startFrame.chats.entries()) {
    const end = endFrame.chats[index];
    const delta = end.centerY - start.centerY;
    const distance = Math.abs(delta);
    const progress = frames.map(({ chats }) =>
      (chats[index].centerY - start.centerY) * (delta < 0 ? -1 : 1),
    );
    assert.ok(
      progress.every((value, frame) => value >= -0.25 && value <= distance + 0.25 &&
        (frame === 0 || value + 0.25 >= progress[frame - 1])),
      `${name}: conversation ${index} moves vertically without overshooting or reversing (${progress.join(', ')})`,
    );
    assert.ok(distance < 1 || progress.some(value => value > 0.25 && value < distance - 0.25),
      `${name}: conversation ${index} visits an intermediate vertical position`);
    for (const frame of frames) {
      const progress = (frame.sidebarWidth - startFrame.sidebarWidth) /
        (endFrame.sidebarWidth - startFrame.sidebarWidth);
      for (const key of ['left', 'width', 'dotX']) {
        const expected = start[key] + (end[key] - start[key]) * progress;
        assert.ok(Math.abs(frame.chats[index][key] - expected) < 0.5,
          `${name}: conversation ${index} ${key} moves with the sidebar
  at width ${frame.sidebarWidth}: ${frame.chats[index][key]} (expected ${expected})`);
      }
      assert.ok(Math.abs(frame.chats[index].dotY - frame.chats[index].centerY) < 0.5,
        `${name}: conversation ${index} dot stays vertically centered`);
    }
  }
  for (const frame of frames) {
    assert.ok(
      Math.abs(frame.left - frame.target.left) < 0.5 && Math.abs(frame.top - frame.target.top) < 0.5,
      `${name}: selection bar (${frame.left}, ${frame.top}) tracks its row (${frame.target.left}, ${frame.target.top})`,
    );
  }
};
try {
  await installUiAccount(app, { speech: true, components: true });
  const login = await app.firstWindow();
  await login.getByRole('heading', { name: '登录 VoxCue', exact: true }).waitFor();
  await login.waitForFunction(() => document.visibilityState === 'visible');
  const page = await connectUiAccount(app, login);
  page.setDefaultTimeout(20000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('auth:session');
    ipcMain.handle('auth:session', (_event, service) =>
      service === undefined || service === 'chatgpt'
        ? {
            mode: 'chatgpt',
            user: { id: 'visual', name: 'Visual test', email: '' },
            expiresAt: Date.now() + 3600000,
          }
        : null,
    );
    ipcMain.removeHandler('chat:models');
    ipcMain.handle('chat:models', () => ({
      ok: true,
      models: [
        { id: 'short', label: 'GPT test', reasoningEfforts: ['low', 'high'] },
        {
          id: 'long',
          label: 'A very long model name used to verify compact controls and constrained menus',
          reasoningEfforts: ['low', 'high'],
        },
      ],
    }));
    ipcMain.removeHandler('chat:usage');
    ipcMain.handle('chat:usage', () => ({ ok: false, error: { message: 'Visual fixture' } }));
  });
  await page.reload();
  await connectUiAccount(app, page);
  await page
    .getByRole('button', { name: '聊天模型', exact: true })
    .getByText('GPT test', { exact: true })
    .waitFor();
  const navigation = page.getByRole('navigation', { name: '主导航', exact: true });
  const historyNavigation = navigation.getByRole('button', { name: '面试记录', exact: true });
  const knowledgeNavigation = navigation.getByRole('button', { name: '知识库', exact: true });
  const indicator = page.locator('.sidebar-selection-indicator');
  const markerGeometry = (button) =>
    button.evaluate((button) => {
      const marker = document.querySelector('.sidebar-selection-indicator');
      const style = getComputedStyle(marker);
      const box = button.getBoundingClientRect(),
        rect = marker.getBoundingClientRect();
      return {
        opacity: Number(style.opacity),
        visible: marker.dataset.visible,
        left: rect.left - box.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        centerOffset: rect.top + rect.height / 2 - box.top - box.height / 2,
        duration: style.transitionDuration.split(',')[0].trim(),
        easing: style.transitionTimingFunction.match(/cubic-bezier\([^)]*\)/)?.[0],
        sharedEasing: getComputedStyle(document.documentElement)
          .getPropertyValue('--panel-motion-easing')
          .trim(),
      };
    });
  assert.equal(await indicator.count(), 1);
  assert.equal(await indicator.getAttribute('aria-hidden'), 'true');
  assert.equal(await indicator.getAttribute('data-visible'), 'false');
  assert.equal(
    await indicator.evaluate((node) => Number(getComputedStyle(node).opacity)),
    0,
    'New conversation has no selected marker',
  );
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await startSelectionFrames(page);
  await historyNavigation.click();
  await page.locator('.history-page').waitFor();
  const historyEntry = await finishSelectionFrames(page);
  assertSelectionFade(historyEntry, 0, 1, 'None to history');
  const historyMarker = await markerGeometry(historyNavigation);
  await startNavigationStyles(page, '.sidebar > nav > .nav-item');
  await startSelectionFrames(page);
  await knowledgeNavigation.click();
  await page.locator('.knowledge-page').waitFor();
  const navigationMotionFrames = await finishSelectionFrames(page);
  const knowledgeMarker = await markerGeometry(knowledgeNavigation);
  const navigationStyleFrames = await finishNavigationStyles(page);
  assertNavigationStyles(navigationStyleFrames, '面试记录', true);
  assertNavigationStyles(navigationStyleFrames, '知识库', true);
  assertSelectionSlide(navigationMotionFrames, 'History to knowledge');
  const bezierPoints = (value) => value.match(/-?\d*\.?\d+/g).map(Number);
  assert.match(knowledgeMarker.easing, /^cubic-bezier\(/);
  assert.deepEqual(
    bezierPoints(knowledgeMarker.easing),
    bezierPoints(knowledgeMarker.sharedEasing),
  );
  assert.equal(knowledgeMarker.duration, '0.24s');
  for (const marker of [historyMarker, knowledgeMarker]) {
    assert.equal(Math.round(marker.width * 64) / 64, 3);
    assert.equal(Math.round(marker.height * 64) / 64, 18);
    assert(Math.abs(marker.left - 3) < 0.5);
    assert(Math.abs(marker.centerOffset) < 0.5);
  }
  await startSelectionFrames(page);
  await historyNavigation.click();
  const reversalProgress = await knowledgeNavigation.evaluate(
    (button, { from, to }) =>
      new Promise((resolve, reject) => {
        let frame;
        const timer = setTimeout(() => {
          cancelAnimationFrame(frame);
          reject(Error('The navigation reversal did not observe an intermediate position'));
        }, 20000);
        const sample = () => {
          const marker = button.closest('.sidebar')?.querySelector('.sidebar-selection-indicator');
          if (!button.isConnected || !marker) {
            clearTimeout(timer);
            reject(Error('The owned navigation target was removed before reversal'));
            return;
          }
          const progress = (marker.getBoundingClientRect().top - from) / (to - from);
          // CSS shortens near-endpoint reversals; sample the middle before reversing.
          if (progress > 0.3 && progress < 0.7) {
            clearTimeout(timer);
            try {
              button.click();
              resolve(progress);
            } catch (error) {
              reject(error);
            }
            return;
          }
          frame = requestAnimationFrame(sample);
        };
        frame = requestAnimationFrame(sample);
      }),
    { from: knowledgeMarker.top, to: historyMarker.top },
  );
  assert.ok(
    reversalProgress > 0.3 && reversalProgress < 0.7,
    'Reverse navigation fires at the measured intermediate position: ' + reversalProgress,
  );
  await page.locator('.knowledge-page').waitFor();
  const reversalFrames = await finishSelectionFrames(page);
  assertSelectionGeometry(reversalFrames, 'Rapid navigation reversal');
  assert.ok(
    reversalFrames.every((frame) => frame.opacity === 1),
    'Rapid reversal keeps the same opaque marker',
  );
  const leftKnowledge = reversalFrames.findIndex((frame) => frame.target?.label === '面试记录');
  const returned = reversalFrames.findIndex(
    (frame, index) => index > leftKnowledge && frame.target?.label === '知识库',
  );
  assert.ok(
    leftKnowledge >= 0 && returned > leftKnowledge,
    'Rapid reversal visits both actual targets',
  );
  const reversing = reversalFrames[returned],
    prior = reversalFrames[returned - 1];
  assert.ok(
    Math.abs(reversing.top - prior.top) < Math.abs(knowledgeMarker.top - historyMarker.top) * 0.45,
    'Rapid reversal continues from the current interpolated position without jumping to a row',
  );
  assert.ok(
    Math.abs(reversing.top - historyMarker.top) > 1 &&
      Math.abs(reversing.top - knowledgeMarker.top) > 1,
    'The reversed animation remains between its targets before settling: ' +
      JSON.stringify({
        reversalProgress,
        historyTop: historyMarker.top,
        knowledgeTop: knowledgeMarker.top,
        leftKnowledge,
        returned,
        reversing,
        prior,
        frames: reversalFrames.slice(Math.max(0, returned - 2), returned + 3),
      }),
  );
  await page.getByRole('button', { name: '收起侧栏', exact: true }).click();
  await settle(page);
  const collapsedMarker = await markerGeometry(knowledgeNavigation);
  assert.equal(
    await page
      .locator('.sidebar')
      .evaluate((node) => Math.round(node.getBoundingClientRect().width * 64) / 64),
    await page.locator('.app-shell').evaluate((node) =>
      node.classList.contains('native-window-controls') ? 84 : 68,
    ),
    'Collapsed sidebar keeps the platform window-control width',
  );
  assert.equal(collapsedMarker.opacity, 1);
  assert(Math.abs(collapsedMarker.left - 3) < 0.5);
  assert(Math.abs(collapsedMarker.centerOffset) < 0.5);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await historyNavigation.click();
  await page.locator('.history-page').waitFor();
  const reducedMarker = await markerGeometry(historyNavigation);
  assert.equal(reducedMarker.opacity, 1);
  assert.equal(reducedMarker.visible, 'true');
  assert(Math.abs(reducedMarker.left - 3) < 0.5);
  assert(Math.abs(reducedMarker.centerOffset) < 0.5);
  assert.equal(
    await historyNavigation.evaluate((button) => Number(getComputedStyle(button).fontWeight)),
    600,
  );
  assert.equal(
    await page.locator('.sidebar').evaluate((node) => node.getAnimations({ subtree: true }).length),
    0,
  );
  assert.deepEqual(
    await historyNavigation.evaluate((button) =>
      [...button.querySelectorAll('.selection-label > span')].map((label) =>
        Number(getComputedStyle(label).opacity),
      ),
    ),
    [0, 1],
  );
  assert.equal(await historyNavigation.textContent(), '面试记录');
  await page.getByRole('button', { name: '展开侧栏', exact: true }).click();
  await navigation.getByRole('button', { name: '新对话', exact: true }).click();
  await page.locator('.preparation-route:not([hidden])').waitFor();
  assert.equal(await indicator.getAttribute('data-visible'), 'false');
  assert.equal(await indicator.evaluate((node) => Number(getComputedStyle(node).opacity)), 0);
  assert.equal(await navigation.locator('.nav-item.active').count(), 0);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const appWindow = await app.browserWindow(page);
  const initialSize = await appWindow.evaluate((win) => ({
    content: win.getContentSize(),
    minimum: win.getMinimumSize(),
  }));
  const waitContentWidth = (size) =>
    page.waitForFunction(
      ({ content, zoom }) => Math.abs(innerWidth - content[0] / zoom) <= 1,
      size,
    );
  const viewportWidths = [];
  try {
    // Only this owned test window visits 800 CSS px, below the product's native
    // minimum. Restore its original content size and minimum in all outcomes.
    await appWindow.evaluate((win) => win.setMinimumSize(1, 1));
    for (const width of [1280, 1000, 800]) {
      const actual = await appWindow.evaluate(
        (win, { width, height }) => {
          win.setContentSize(Math.round(width * win.webContents.getZoomFactor()), height);
          return { content: win.getContentSize(), zoom: win.webContents.getZoomFactor() };
        },
        { width, height: initialSize.content[1] },
      );
      assert(
        Math.abs(actual.content[0] / actual.zoom - width) <= 1,
        'The native content viewport must reach the requested CSS width: ' +
          JSON.stringify({ width, actual }),
      );
      await waitContentWidth(actual);
      await settle(page);
      const viewport = await page.evaluate(() => innerWidth);
      assert.equal(
        viewport > 1100,
        width > 1100,
        'The fixed-width regression must cross the former 1100px breakpoint',
      );
      viewportWidths.push(viewport);
      const sidebarWidth = await page
        .locator('.sidebar')
        .evaluate((node) => node.getBoundingClientRect().width);
      assert.equal(
        Math.round(sidebarWidth * 64) / 64,
        230,
        'Expanded sidebar uses one fixed width across viewport breakpoints',
      );
    }
  } finally {
    const restored = await appWindow.evaluate((win, size) => {
      win.setContentSize(...size.content);
      win.setMinimumSize(...size.minimum);
      return { content: win.getContentSize(), zoom: win.webContents.getZoomFactor() };
    }, initialSize);
    await waitContentWidth(restored);
    await settle(page);
  }
  check('sidebar-selection-sliding-fading-and-fixed-width', true, {
    historyMarker,
    knowledgeMarker,
    collapsedMarker,
    reducedMarker,
    textStyles: summarizeFrames(navigationStyleFrames),
    entry: summarizeFrames(historyEntry),
    navigation: summarizeFrames(navigationMotionFrames),
    reversal: summarizeFrames(reversalFrames),
    viewportWidths,
  });
  const titles = ['侧栏合成对话甲', '侧栏合成对话乙 用于检查长标题淡入时的省略号'];
  const conversation = (title) => page.locator('.conversation-row').filter({ hasText: title });
  const mountedConversations = [];
  let newConversationFrames;
  for (const title of titles) {
    await startSelectionFrames(page);
    await page.getByRole('textbox', { name: '聊天消息', exact: true }).fill(title);
    await page.getByRole('button', { name: '发送消息', exact: true }).click();
    await page
      .locator('.chat-message.assistant')
      .getByText('Synthetic interview answer', { exact: true })
      .waitFor();
    await page.waitForFunction(() => !document.querySelector('.conversation-dot[data-state="streaming"]'));
    const frames = await finishSelectionFrames(page);
    mountedConversations.push(frames);
    assertSelectionFade(frames, 0, 1, title + ': new row appears');
    const marker = await markerGeometry(conversation(title));
    assert.equal(Math.round(marker.width * 64) / 64, 3);
    assert.equal(Math.round(marker.height * 64) / 64, 18);
    assert(Math.abs(marker.left - 3) < 0.5);
    assert(Math.abs(marker.centerOffset) < 0.5);
    if (title === titles[0]) {
      await startSelectionFrames(page);
      await navigation.getByRole('button', { name: '新对话', exact: true }).click();
      newConversationFrames = await finishSelectionFrames(page);
      assertSelectionFade(newConversationFrames, 1, 0, 'Conversation to new unsent draft');
    }
  }
  await startSelectionFrames(page);
  await historyNavigation.click();
  await page.locator('.history-page').waitFor();
  const conversationToNavigation = await finishSelectionFrames(page);
  assertSelectionSlide(conversationToNavigation, 'Conversation to history navigation');
  await startSelectionFrames(page);
  await conversation(titles[0]).locator('.conversation').click();
  await page.locator('.chat-message.user').getByText(titles[0], { exact: true }).waitFor();
  const activateConversation = await finishSelectionFrames(page);
  assertSelectionSlide(activateConversation, 'History navigation to conversation');
  await startSelectionFrames(page);
  await historyNavigation.click();
  await page.locator('.history-page').waitFor();
  const leaveConversation = await finishSelectionFrames(page);
  assertSelectionSlide(leaveConversation, 'Conversation back to history');
  await conversation(titles[0]).locator('.conversation').click();
  await page.locator('.chat-message.user').getByText(titles[0], { exact: true }).waitFor();
  await settle(page);
  await startSelectionFrames(page);
  await conversation(titles[1]).locator('.conversation').click();
  await page.locator('.chat-message.user').getByText(titles[1], { exact: true }).waitFor();
  const switchConversations = await finishSelectionFrames(page);
  assertSelectionSlide(switchConversations, 'Between two conversations');
  const selectedConversation = await markerGeometry(conversation(titles[1]));
  assert.equal(selectedConversation.opacity, 1);
  assert(Math.abs(selectedConversation.left - 3) < 0.5);
  assert(Math.abs(selectedConversation.centerOffset) < 0.5);
  await startSelectionFrames(page, true);
  await page.getByRole('button', { name: '收起侧栏', exact: true }).click();
  const collapseConversation = await finishSelectionFrames(page);
  assertSidebarMotion(collapseConversation, 'Collapsing the sidebar');
  const compactChats = page.locator('.sidebar.collapsed .sidebar-conversations');
  for (const title of titles) await compactChats.getByRole('button', { name: title, exact: true }).waitFor();
  assert.equal(await compactChats.locator('.section-caption').isVisible(), false);
  assert.equal(await compactChats.evaluate((node) => node.scrollWidth <= node.clientWidth), true);
  const compactLayout = await compactChats.evaluate((section) => {
    const nav = section.closest('.sidebar').querySelector('.nav-item');
    const { width, height, x } = nav.getBoundingClientRect();
    const radius = getComputedStyle(nav).borderRadius;
    const divider = getComputedStyle(section, '::before');
    return {
      divider: Math.abs(parseFloat(divider.width) - width) < 1 / 32 &&
        Math.abs(parseFloat(divider.height) - 1) < 1 / 32 && divider.opacity === '1',
      alignedDots: [...section.querySelectorAll('.conversation-row')].every((row) => {
        const { x: left, y: top, width: rowWidth, height: rowHeight } = row.getBoundingClientRect();
        const dots = row.querySelectorAll('.conversation-dot');
        const dot = dots[0].getBoundingClientRect();
        return dots.length === 1 && rowWidth === width && rowHeight === height &&
          Math.abs(left - x) < 0.5 && getComputedStyle(row).borderRadius === radius &&
          Math.abs(dot.x + dot.width / 2 - (left + width / 2)) < 0.5 &&
          Math.abs(dot.y + dot.height / 2 - (top + height / 2)) < 0.5 &&
          getComputedStyle(row.querySelector('.conversation-title')).visibility === 'hidden';
      }),
    };
  });
  assert.deepEqual(compactLayout, { divider: true, alignedDots: true });
  await compactChats.getByRole('button', { name: titles[0], exact: true }).press('Enter');
  await page.locator('.chat-message.user').getByText(titles[0], { exact: true }).waitFor();
  await settle(page);
  assert.equal(await compactChats.getByRole('button', { name: titles[0], exact: true }).getAttribute('aria-current'), 'page');
  await startSelectionFrames(page, true);
  await page.getByRole('button', { name: '展开侧栏', exact: true }).click();
  const expandConversation = await finishSelectionFrames(page);
  assertSidebarMotion(expandConversation, 'Expanding the sidebar');
  const expanded = expandConversation.at(-1);
  assert.equal(expanded.labels.length, 3 + titles.length + 1, 'Track navigation labels, chat titles and the email');
  const fadeStart = (index) => expandConversation.findIndex(({ labels }) =>
    labels[index].visible && labels[index].opacity > 0.1);
  const navigationStart = fadeStart(0);
  const chatStart = fadeStart(3);
  const accountStart = fadeStart(expanded.labels.length - 1);
  assert.ok(navigationStart >= 0 && navigationStart < chatStart && chatStart < accountStart,
    'Navigation, chat titles and the email start fading in at staggered times');
  for (const [index, label] of expanded.labels.entries()) {
    const painted = expandConversation.map((frame) => ({ ...frame.labels[index], sidebarWidth: frame.sidebarWidth }))
      .filter(({ visible, opacity }) => visible && opacity > 0);
    assert.ok(label.visible && label.opacity === 1);
    assert.ok(expandConversation.some((frame) => frame.sidebarWidth < expanded.sidebarWidth - 1 &&
      frame.labels[index].visible && frame.labels[index].opacity > 0.05 && frame.labels[index].opacity < 0.95),
      'The label fades in during expansion');
    assert.ok(painted.some(({ opacity }) => opacity < 0.25) &&
      painted.some(({ opacity }) => opacity >= 0.25 && opacity < 0.75) &&
      painted.some(({ opacity }) => opacity >= 0.75 && opacity < 0.98),
    `Label ${index} visibly fades through low, medium and high opacity`);
    const clipped = painted.filter(({ width, fits }) => !fits || Math.abs(width - label.width) >= 0.5);
    assert.deepEqual(clipped, [], `Label ${index} fits at its expanded width throughout the fade`);
  }
  assert.equal(await conversation(titles[0]).locator('.conversation-title').isVisible(), true);
  await startSelectionFrames(page);
  await navigation.getByRole('button', { name: '新对话', exact: true }).click();
  const deselectConversation = await finishSelectionFrames(page);
  assertSelectionFade(deselectConversation, 1, 0, 'Conversation to no selection');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await conversation(titles[0]).locator('.conversation').click();
  const reducedConversation = await markerGeometry(conversation(titles[0]));
  assert.equal(reducedConversation.opacity, 1);
  assert.equal(reducedConversation.visible, 'true');
  assert(Math.abs(reducedConversation.left - 3) < 0.5);
  assert(Math.abs(reducedConversation.centerOffset) < 0.5);
  assert.equal(
    await page.locator('.sidebar').evaluate((node) => node.getAnimations({ subtree: true }).length),
    0,
  );
  for (const title of titles) {
    const row = conversation(title);
    await row.hover();
    await row.getByRole('button', { name: '删除对话：' + title, exact: true }).click();
    await row.getByRole('button', { name: '确认删除：对话：' + title, exact: true }).click();
    await row.waitFor({ state: 'detached' });
  }
  assert.equal(await page.locator('.conversation-row').count(), 0);
  assert.equal(await page.locator('.chat-message').count(), 0);
  assert.equal(await indicator.getAttribute('data-visible'), 'false');
  assert.equal(await indicator.evaluate((node) => Number(getComputedStyle(node).opacity)), 0);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  check('shared-selection-conversations-and-reduced-motion', true, {
    entries: mountedConversations.map(summarizeFrames),
    newConversation: summarizeFrames(newConversationFrames),
    toNavigation: summarizeFrames(conversationToNavigation),
    activation: summarizeFrames(activateConversation),
    leaving: summarizeFrames(leaveConversation),
    switching: summarizeFrames(switchConversations),
    collapse: summarizeFrames(collapseConversation),
    expand: summarizeFrames(expandConversation),
    deselect: summarizeFrames(deselectConversation),
    reducedConversation,
  });
  for (const theme of ['light', 'dark']) {
    await page.evaluate(
      (theme) => document.documentElement.classList.toggle('dark', theme === 'dark'),
      theme,
    );
    const surfaces = [];
    for (const label of ['添加附件', '聊天模型']) {
      const trigger = page.getByRole('button', { name: label, exact: true });
      await trigger.hover();
      await settle(page);
      surfaces.push(
        await trigger.evaluate((element) => {
          const style = getComputedStyle(element);
          return {
            height: element.getBoundingClientRect().height,
            centerY: element.getBoundingClientRect().y + element.getBoundingClientRect().height / 2,
            radius: style.borderRadius,
            curve: style.getPropertyValue('corner-top-left-shape'),
            background: style.backgroundColor,
            label: element.getAttribute('aria-label'),
            hovered: element.matches(':hover'),
            disabled: element.matches(':disabled'),
            shadow: style.boxShadow,
          };
        }),
      );
    }
    assert.equal(surfaces[0].height, 32);
    assert.equal(surfaces[0].radius, '50%');
    assert.equal(surfaces[1].height, 32);
    assert.equal(surfaces.length, 2);
    assert.equal(await page.getByRole('button', { name: '思考强度', exact: true }).count(), 0);
    for (const surface of surfaces.slice(1)) {
      assert.ok(Math.abs(surface.centerY - surfaces[0].centerY) < 1);
      assert.equal(surface.curve, surfaces[0].curve);
      assert.equal(surface.background, surfaces[0].background, JSON.stringify(surfaces));
      assert.equal(surface.shadow, surfaces[0].shadow);
    }
    check(`composer-hover-family-${theme}`, true, surfaces);
    await page.mouse.move(0, 0);
  }
  await openModelMenu(page);
  await page.getByRole('menuitemradio', { name: longName, exact: true }).click();
  await page.keyboard.press('Escape');
  const composerGeometry = () =>
    page.locator('.composer').evaluate((element) => {
      const box = element.getBoundingClientRect();
      const rects = [...element.querySelectorAll('.composer-bottom button')].map((button) => {
        const r = button.getBoundingClientRect();
        return {
          label: button.getAttribute('aria-label') ?? button.textContent,
          left: r.left,
          right: r.right,
          y: r.top + r.height / 2,
          height: r.height,
        };
      });
      return {
        overflow: element.scrollWidth > element.clientWidth + 1,
        contained: rects.every((r) => r.left >= box.left && r.right <= box.right),
        rects,
      };
    });
  for (const [width, height] of [
    [1280, 800],
    [960, 680],
  ]) {
    await app.evaluate(
      ({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setSize(...size),
      [width, height],
    );
    await page.getByRole('button', { name: '个人信息', exact: true }).click();
    await page.locator('.personal-panel').waitFor();
    await settle(page);
    for (const theme of ['light', 'dark']) {
      await page.evaluate(
        (theme) => document.documentElement.classList.toggle('dark', theme === 'dark'),
        theme,
      );
      const overviewSpacing = await page.locator('.personal-panel').evaluate((panel) => {
        const header = panel.querySelector('header').getBoundingClientRect();
        const first = panel.querySelector('.profile-overview > span').getBoundingClientRect();
        return first.top - header.bottom;
      });
      check(
        `profile-overview-spacing-${width}-${theme}`,
        overviewSpacing >= 16 - 1 / 64,
        overviewSpacing,
      );
      for (const panelWidth of [300, 380, 520, 640]) {
        const separator = page.getByRole('separator', { name: '调整个人信息宽度' });
        await separator.focus();
        await page.keyboard.press('Home');
        for (let step = 380; step !== panelWidth; step += panelWidth > 380 ? 20 : -20)
          await page.keyboard.press(panelWidth > 380 ? 'ArrowLeft' : 'ArrowRight');
        await settle(page);
        const result = await composerGeometry();
        const lines = [];
        for (const { y } of result.rects)
          if (!lines.some((line) => Math.abs(line - y) < 1)) lines.push(y);
        check(
          `composer-flow-${width}-${panelWidth}-${theme}`,
          !result.overflow &&
            result.contained &&
            lines.length <= 2 &&
            result.rects.every(({ height }) => Math.abs(height - 32) < 0.5),
          result,
        );
        check(
          `composer-model-group-${width}-${panelWidth}-${theme}`,
          result.rects.filter((item) => item.label === '聊天模型').length === 1 &&
            !result.rects.some((item) => item.label === '思考强度') &&
            Math.abs(result.rects[1].y - result.rects[2].y) < 1,
          result,
        );
        if (panelWidth === 300 || panelWidth === 640)
          await captureRequested(page, `composer-${width}-${panelWidth}-${theme}`);
        if (
          process.argv.includes('--preview-composer') &&
          panelWidth === 640 &&
          ((width === 1280 && theme === 'light') || (width === 960 && theme === 'dark'))
        )
          console.log(
            JSON.stringify({
              preview: `composer-${width}-${theme}`,
              jpeg: (
                await page
                  .locator('.composer')
                  .screenshot({ type: 'jpeg', quality: 85, scale: 'css' })
              ).toString('base64'),
            }),
          );
      }
    }
    const reasoning = await openReasoningControl(page);
    const effort = reasoning.getByRole('slider', { name: '思考强度', exact: true });
    await effort.focus();
    await effort.press('End');
    assert.equal(await effort.getAttribute('aria-valuetext'), '高');
    await page.keyboard.press('Escape');
    assert.equal(await page.getByRole('button', { name: '网络搜索', exact: true }).count(), 0);
    await page.getByRole('button', { name: '添加附件', exact: true }).click();
    assert.equal(
      await page.getByRole('menuitemcheckbox', { name: '网络搜索', exact: true }).count(),
      0,
    );
    await page.getByRole('menuitem', { name: '添加文件', exact: true }).waitFor();
    await page.keyboard.press('Escape');
    const result = await composerGeometry();
    check(`composer-${width}`, !result.overflow && result.contained, result);
    check(
      `composer-actions-align-${width}`,
      Math.abs(result.rects[1].y - result.rects[2].y) < 1 &&
        Math.abs(result.rects.at(-1).y - result.rects.at(-2).y) < 1,
      result,
    );
    await page.screenshot({ animations: 'disabled' });
    await captureRequested(page, `composer-${width}`);
    await page.getByRole('button', { name: '个人信息', exact: true }).click();
    await settle(page);
  }
  await page.getByRole('button', { name: '用户菜单', exact: true }).click();
  await page.getByRole('menuitem', { name: '设置', exact: true }).click();
  await page
    .getByRole('navigation', { name: '设置分类' })
    .getByRole('button', { name: '通用', exact: true })
    .click();
  await page.getByRole('heading', { name: '通用', exact: true }).waitFor();
  await settle(page);
  await startNavigationStyles(page, '.settings-sidebar nav > button');
  await page.getByRole('button', { name: '面试设置', exact: true }).click();
  await page.getByRole('heading', { name: '面试设置', exact: true }).waitFor();
  await settle(page);
  const settingsStyleFrames = await finishNavigationStyles(page);
  assertNavigationStyles(settingsStyleFrames, '通用', false);
  assertNavigationStyles(settingsStyleFrames, '面试设置', false);
  const dialog = page.getByRole('dialog', { name: '设置', exact: true });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const settingsNavigation = dialog.getByRole('navigation', { name: '设置分类', exact: true });
  await settingsNavigation.getByRole('button', { name: '通用', exact: true }).click();
  const reducedSettings = await settingsNavigation
    .getByRole('button', { name: '通用', exact: true })
    .evaluate((button) => ({
      weight: Number(getComputedStyle(button).fontWeight),
      running: button.getAnimations({ subtree: true }).length,
      layers: [...button.querySelectorAll('.selection-label > span')].map((label) =>
        Number(getComputedStyle(label).opacity),
      ),
    }));
  assert.deepEqual(reducedSettings, { weight: 600, running: 0, layers: [0, 1] });
  await settingsNavigation.getByRole('button', { name: '面试设置', exact: true }).click();
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  check('settings-navigation-weight-and-background-motion', true, {
    textStyles: summarizeFrames(settingsStyleFrames),
    reducedSettings,
  });
  const alignment = await dialog.evaluate((element) => {
    const rect = (e) => {
      const r = e.getBoundingClientRect();
      return { left: r.left, top: r.top, width: r.width, height: r.height };
    };
    const rows = [...element.querySelectorAll('.speech-setting-row')].filter((row) =>
      row.querySelector(':scope > button[aria-haspopup="menu"],:scope > button[aria-haspopup="dialog"],:scope > .frosted-slider'),
    );
    return {
      devices: [...element.querySelectorAll('.speech-device')].map(rect),
      selects: rows.map((r) => rect(r.querySelector(
        ':scope > button[aria-haspopup="menu"],:scope > button[aria-haspopup="dialog"],:scope > .frosted-slider',
      ))),
      textLeft: rect(element.querySelector('.speech-answer-settings .speech-setting-label')).left,
      labelLeft: rows.map((row) => rect(row.querySelector('.speech-setting-label')).left),
      centerOffsets: rows.map((row) => {
        const label = row.querySelector('.speech-setting-label').getBoundingClientRect();
        const control = row.querySelector(':scope > button,:scope > .frosted-slider').getBoundingClientRect();
        return label.top + label.height / 2 - control.top - control.height / 2;
      }),
      overflow: element.scrollWidth > element.clientWidth + 1,
    };
  });
  check(
    'interview-device-and-select-alignment',
    alignment.devices[0].width === alignment.devices[1].width &&
      alignment.selects.every((r) => Math.abs(r.left - alignment.selects[0].left) < 1) &&
      alignment.selects.every((r) => Math.abs(r.width - alignment.selects[0].width) < 1) &&
      alignment.centerOffsets.every((offset) => Math.abs(offset) <= 1 / 64) &&
      alignment.selects.length === 7 &&
      !alignment.overflow,
    alignment,
  );
  check(
    'interview-label-alignment',
    alignment.labelLeft.every((left) => Math.abs(alignment.textLeft - left) <= 1),
    alignment,
  );
  await page.evaluate(() => document.documentElement.classList.remove('dark'));
  await dialog.screenshot({ animations: 'disabled' });
  await captureRequested(dialog, 'interview-settings-light');
  await page.evaluate(() => document.documentElement.classList.add('dark'));
  await dialog.screenshot({ animations: 'disabled' });
  await captureRequested(dialog, 'interview-settings-dark');
  await dialog.getByRole('button', { name: '关闭设置', exact: true }).click();
  await page.getByRole('button', { name: '知识库', exact: true }).click();
  await page
    .getByRole('button', { name: /创建知识库/ })
    .first()
    .click();
  const baseName = 'LongKnowledgeBaseName'.repeat(3).slice(0, 60);
  await page.getByLabel('知识库名称', { exact: true }).fill(baseName);
  await page.getByRole('button', { name: '保存', exact: true }).click();
  const base = page.getByRole('dialog', { name: baseName, exact: true });
  await base.waitFor();
  await settle(page);
  const header = await base
    .locator('.dialog-heading')
    .evaluate((element) => {
      // The decorative backdrop extends across the reserved scrollbar gutter.
      const bounds = element.getBoundingClientRect();
      const [title, actions] = Array.from(element.children, (child) => child.getBoundingClientRect());
      return {
        left: title.left - bounds.left,
        right: bounds.right - actions.right,
        gap: actions.left - title.right,
      };
    });
  check('long-dialog-title', header.left >= 0 && header.right >= 0 && header.gap >= 0, header);
  await base.screenshot({ animations: 'disabled' });
  await captureRequested(base, 'long-knowledge-title');
  await base.getByRole('button', { name: '关闭对话框', exact: true }).click();
  await page.getByRole('button', { name: '用户菜单', exact: true }).click();
  await page.getByRole('menuitem', { name: '设置', exact: true }).click();
  await page
    .getByRole('navigation', { name: '设置分类' })
    .getByRole('button', { name: '通用', exact: true })
    .click();
  await page.getByRole('button', { name: '面试设置', exact: true }).click();
  await page.getByRole('button', { name: '麦克风设备', exact: true }).waitFor();
  await page.getByRole('button', { name: '关闭设置', exact: true }).click();
  check('renderer-errors', errors.length === 0, errors);
  await console.log(JSON.stringify(checks, null, 2));
  console.log(
    JSON.stringify({ directory, checks: checks.map(({ name, passed }) => ({ name, passed })) }),
  );
  assert.ok(
    checks.every((r) => r.passed),
    'Visual geometry checks failed; see terminal output',
  );
} finally {
  await app
    .evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy()))
    .catch(() => {});
  await closeUiApp(app);
}
