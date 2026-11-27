import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import workspace from '../../scripts/workspace.mjs';
import { focusUiWindow } from './install-ui-account.mjs';

const windowsProbe = () => import(
  pathToFileURL(path.join(workspace.platformRoot, 'test/scripts/window-probe.mjs')).href
);

export async function pointAtControl(app, button, hover = true, freshEntry = false) {
  if (process.platform === 'win32') {
    const { pointAtOwnedControl } = await windowsProbe();
    return pointAtOwnedControl(app, button, hover, workspace.platformRequire('electron'), freshEntry);
  }
  const page = button.page();
  const until = performance.now() + 3000;
  let state;
  do {
    if (app && !(await page.evaluate(() => document.hasFocus()))) await focusUiWindow(app, page);
    if (!hover || freshEntry) await page.mouse.move(1, 1);
    if (hover) await button.hover();
    state = await button.evaluate(element => ({
      hovered: element.matches(':hover'), focused: document.hasFocus(),
    }));
    if (state.hovered === hover && (!app || state.focused)) return;
    freshEntry = true;
  } while (performance.now() < until);
  throw Error('The owned download control did not receive the expected pointer state: ' +
    JSON.stringify({ hover, ...state }));
}

export async function holdControl(app, button) {
  const target = await pointAtControl(app, button);
  if (process.platform !== 'win32') {
    const mouse = button.page().mouse;
    await mouse.down();
    return { check() {}, release: () => mouse.up() };
  }
  const { probe } = await windowsProbe();
  const args = [target.x, target.y, target.handle, target.pid];
  probe('down-owned', ...args);
  return { check: () => probe('check-owned', ...args), release: () => probe('up') };
}

async function settle(button) {
  await button.evaluate(async (element) => {
    while (element.isConnected) {
      const active = element
        .getAnimations({ subtree: true })
        .filter(
          (animation) =>
            animation.effect?.getTiming().iterations !== Infinity &&
            animation.playState === 'running',
        );
      if (!active.length) return;
      await Promise.all(active.map((animation) => animation.finished.catch(() => {})));
      await new Promise(requestAnimationFrame);
    }
    throw Error('Download completed before progress interaction could be inspected');
  });
}

const clockPages = new WeakSet();
export async function installInteractionClock(page) {
  if (!clockPages.has(page)) {
    await page.clock.install();
    clockPages.add(page);
  }
}
export async function assertInitialDownloadProgress(button, start, { delayMs = 1000, app } = {}) {
  const page = button.page();
  await page.bringToFront();
  await installInteractionClock(page);
  // Freeze before mounting the control. Locator/animation work must not consume
  // its cancellation guard; inspect 0, 400, the last guarded ms and its boundary.
  await page.clock.pauseAt(new Date((await page.evaluate(() => Date.now())) + 1000));
  try {
    const started = Promise.resolve().then(start);
    started.catch(() => {});
    await button.waitFor({ state: 'visible' });
    // React replaced the clicked action under the pointer. Give the new
    // control a fresh client-area entrance while its guard clock is paused.
    await pointAtControl(app, button, true, true);
    const initialBounds = await button.boundingBox();
    const read = () =>
      button.evaluate((element) => ({
        hovered: element.matches(':hover'),
        progress: getComputedStyle(element.querySelector('.download-button-progress')).visibility,
        cancel: getComputedStyle(element.querySelector('.download-button-cancel')).visibility,
        disabled: element.getAttribute('aria-disabled'),
      }));
    const guarded = {
      hovered: true,
      progress: 'visible',
      cancel: 'hidden',
      disabled: 'true',
    };
    assert.deepEqual(await read(), guarded);
    await page.clock.runFor(400);
    const result = await started;
    await pointAtControl(app, button);
    assert.deepEqual(await read(), guarded);
    await page.clock.runFor(delayMs - 401);
    await page.bringToFront();
    await pointAtControl(app, button);
    assert.deepEqual(await read(), guarded);
    await button.evaluate((element) => element.click());
    await pointAtControl(app, button);
    assert.deepEqual(await read(), guarded, 'Clicks during the guard cannot cancel');
    await page.clock.runFor(1);
    await button.locator('.download-button-cancel').waitFor({ state: 'visible' });
    assert.equal(await button.getAttribute('aria-disabled'), 'false');
    const hoverLabel = await button.getAttribute('data-hover-label');
    {
      // The fake clock verifies the cancellation guard, while CSS transitions
      // use Chromium's compositor timeline. Inspect their settled endpoint.
      await button.evaluate((element) => {
        element.getBoundingClientRect();
        for (const animation of element.getAnimations({ subtree: true }))
          if (animation.effect?.getTiming().iterations !== Infinity) animation.finish();
      });
    }
    const finalBounds = await button.boundingBox();
    if (hoverLabel)
      assert.ok(
        finalBounds.width > initialBounds.width,
        JSON.stringify({ initialBounds, finalBounds }),
      );
    else {
      const cancelWidth = await button.evaluate((element) =>
        parseFloat(element.style.getPropertyValue('--download-cancel-width')),
      );
      assert.ok(
        Math.abs(
          finalBounds.width - (Number.isFinite(cancelWidth) ? cancelWidth : initialBounds.width),
        ) < 1,
      );
    }
    assert.equal(finalBounds.height, initialBounds.height);
    return result;
  } finally {
    await page.clock.resume();
  }
}

export async function assertDownloadButton(page, button, { iconOnly = false, hoverLabel, app } = {}) {
  await page.bringToFront();
  const dark = await page.evaluate(() => document.documentElement.classList.contains('dark'));
  const probe = await button.evaluateHandle(element => {
    const events = [], start = performance.now();
    const types = ['pointermove', 'pointerover', 'pointerout', 'focus', 'blur'];
    const record = event => {
      events.push({ type: event.type, at: performance.now() - start,
        x: event.clientX, y: event.clientY,
        ownTarget: event.target === element || (event.target instanceof Node && element.contains(event.target)),
        hovered: element.matches(':hover'), focused: document.hasFocus(),
        focusVisible: element.matches(':focus-visible') });
      if (events.length > 40) events.shift();
    };
    for (const type of types) window.addEventListener(type, record, true);
    return {
      read() {
        const style = node => {
          if (!node) return null;
          const value = getComputedStyle(node);
          return { visibility: value.visibility, opacity: value.opacity,
            transition: value.transition, transform: value.transform };
        };
        return { events, connected: element.isConnected, rect: element.getBoundingClientRect().toJSON(),
          hovered: element.matches(':hover'), focused: document.hasFocus(),
          focusVisible: element.matches(':focus-visible'), active: document.activeElement === element,
          cancellable: element.classList.contains('is-cancellable'),
          progress: style(element.querySelector('.download-button-progress')),
          cancel: style(element.querySelector('.download-button-cancel')),
          animations: element.getAnimations({ subtree: true }).map(animation => ({
            state: animation.playState, currentTime: animation.currentTime, startTime: animation.startTime,
            duration: animation.effect?.getTiming().duration,
            property: animation.transitionProperty,
          })) };
      },
      dispose() { for (const type of types) window.removeEventListener(type, record, true); },
    };
  });
  try {
    for (const theme of ['light', 'dark']) {
      await page.evaluate(
        (theme) => document.documentElement.classList.toggle('dark', theme === 'dark'),
        theme,
      );
      await pointAtControl(app, button, false);
      await button.locator('.download-button-progress').waitFor({ state: 'visible' });
      await settle(button);
      const ring = button.locator('[role="progressbar"]');
      const state = await ring.evaluate((element) => {
        const probe = document.createElement('span');
        probe.style.color = 'var(--accent)';
        document.body.append(probe);
        const accent = getComputedStyle(probe).color;
        probe.remove();
        return {
          stroke: getComputedStyle(element.querySelector('.download-ring-value')).stroke,
          accent,
          circles: element.querySelectorAll('circle').length,
          value: Number(element.getAttribute('aria-valuenow')),
        };
      });
      assert.equal(state.stroke, state.accent);
      assert.equal(state.circles, 2);
      assert.ok(state.value >= 0 && state.value <= 100);
      if (iconOnly) assert.equal(await button.innerText(), '');
      else assert.match(await button.locator('.download-button-progress').innerText(), /\d+%/);
      assert.equal(await page.locator('progress').count(), 0);
      await button.scrollIntoViewIfNeeded();
      await settle(button);
      const before = await button.boundingBox();
      await pointAtControl(app, button);
      await settle(button);
      await pointAtControl(app, button);
      await button.locator('.download-button-cancel').waitFor({ state: 'visible' });
      // Cancel fades in immediately; progress remains visible until the outgoing
      // transition's delayed visibility change, including on fractional DPI.
      const progress = button.locator('.download-button-progress');
      await progress.waitFor({ state: 'hidden' });
      assert.equal(await progress.isVisible(), false);
      await settle(button);
      assert.equal(
        await button.locator('.download-button-cancel').innerText(),
        hoverLabel ?? (iconOnly ? '' : '取消'),
      );
      assert.equal(await button.locator('.download-button-cancel svg').count(), 1);
      await pointAtControl(app, button);
      await settle(button);
      const cancel = await button.evaluate((element) => {
        const probe = document.createElement('span');
        probe.style.color = 'var(--danger)';
        document.body.append(probe);
        const danger = getComputedStyle(probe).color;
        probe.remove();
        const style = getComputedStyle(element);
        return {
          hovered: element.matches(':hover'),
          focused: document.hasFocus(),
          background: style.backgroundColor,
          border: style.borderColor,
          color: style.color,
          danger,
        };
      });
      assert.equal(cancel.hovered, true, JSON.stringify(cancel));
      assert.notEqual(cancel.background, cancel.danger, JSON.stringify(cancel));
      assert.notEqual(cancel.border, cancel.danger);
      assert.equal(cancel.color, cancel.danger);
      const after = await button.boundingBox();
      if (hoverLabel) assert.ok(after.width > before.width);
      else if (!iconOnly) {
        const cancelWidth = await button.evaluate((element) =>
          parseFloat(element.style.getPropertyValue('--download-cancel-width')),
        );
        assert.ok(
          Math.abs(after.width - cancelWidth) < 1,
          'Cancel uses its measured content width',
        );
      } else assert.equal(after.width, before.width);
      assert.equal(after.height, before.height);
      if (iconOnly) {
        const size = await button.evaluate((element) => {
          const style = getComputedStyle(element);
          return { width: parseFloat(style.width), height: parseFloat(style.height) };
        });
        if (hoverLabel) assert.ok(size.width > 36);
        else assert.equal(size.width, 36);
        assert.equal(size.height, 36);
      }
      await pointAtControl(app, button, false);
      await page.keyboard.press('Tab');
      await button.focus();
      assert.equal(await button.locator('.download-button-cancel').isVisible(), true);
      await button.evaluate((element) => element.blur());
    }
  } catch (error) {
    try {
      const native = process.platform === 'darwin' && app
        ? await app.evaluate(({ app, BrowserWindow, screen }) => ({
          active: app.isActive(), focusedId: BrowserWindow.getFocusedWindow()?.id,
          cursor: screen.getCursorScreenPoint(),
          windows: BrowserWindow.getAllWindows().map(window => ({
            id: window.id, visible: window.isVisible(), focused: window.isFocused(),
            minimized: window.isMinimized(), content: window.getContentBounds(),
          })),
        })) : undefined;
      console.error(JSON.stringify({ downloadControlFailure: {
        scale: process.env.VOXCUE_TEST_SCALE_FACTOR ?? '1', native,
        renderer: await probe.evaluate(probe => probe.read()),
      } }));
    } catch (diagnostic) { console.error('Download control diagnostic unavailable:', diagnostic.message); }
    throw error;
  } finally {
    await probe.evaluate(probe => probe.dispose());
    await probe.dispose();
    await page.evaluate((dark) => document.documentElement.classList.toggle('dark', dark), dark);
    await pointAtControl(app, button, false);
  }
}
