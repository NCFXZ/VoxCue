import assert from 'node:assert/strict';

async function settle(button) {
  await button.evaluate(async (element) => {
    while (element.isConnected) {
      const active = element
        .getAnimations()
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
export async function assertInitialDownloadProgress(button, start) {
  const page = button.page();
  await page.bringToFront();
  if (!clockPages.has(page)) {
    await page.clock.install();
    clockPages.add(page);
  }
  // Freeze before mounting the control. Locator/animation work must not consume
  // its one-second guard; inspect actual UI at 0, 400, 999 and 1000 ms instead.
  await page.clock.pauseAt(new Date((await page.evaluate(() => Date.now())) + 1000));
  try {
    const started = Promise.resolve().then(start);
    started.catch(() => {});
    await button.waitFor({ state: 'visible' });
    await button.hover();
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
    await button.hover();
    assert.deepEqual(await read(), guarded);
    await page.clock.runFor(599);
    assert.deepEqual(await read(), guarded);
    await button.evaluate((element) => element.click());
    assert.deepEqual(await read(), guarded, 'First-second clicks cannot cancel');
    await page.clock.runFor(1);
    await button.locator('.download-button-cancel').waitFor({ state: 'visible' });
    assert.equal(await button.getAttribute('aria-disabled'), 'false');
    const finalBounds = await button.boundingBox();
    assert.equal(finalBounds.width, initialBounds.width);
    assert.equal(finalBounds.height, initialBounds.height);
    return result;
  } finally {
    await page.clock.resume();
  }
}

export async function assertDownloadButton(page, button, { iconOnly = false } = {}) {
  await page.bringToFront();
  const dark = await page.evaluate(() => document.documentElement.classList.contains('dark'));
  try {
    for (const theme of ['light', 'dark']) {
      await page.evaluate(
        (theme) => document.documentElement.classList.toggle('dark', theme === 'dark'),
        theme,
      );
      await page.mouse.move(1, 1);
      await button.locator('.download-button-progress').waitFor({ state: 'visible' });
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
      await settle(button);
      const before = await button.boundingBox();
      await button.hover();
      await button.locator('.download-button-cancel').waitFor({ state: 'visible' });
      assert.equal(await button.locator('.download-button-progress').isVisible(), false);
      await settle(button);
      assert.equal(
        await button.locator('.download-button-cancel').innerText(),
        iconOnly ? '' : '取消',
      );
      assert.equal(await button.locator('.download-button-cancel svg').count(), 1);
      await button.hover();
      await settle(button);
      const cancel = await button.evaluate((element) => {
        const probe = document.createElement('span');
        probe.style.color = 'var(--danger-fill)';
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
      assert.equal(cancel.background, cancel.danger, JSON.stringify(cancel));
      assert.equal(cancel.border, cancel.danger);
      assert.equal(cancel.color, 'rgb(255, 255, 255)');
      const after = await button.boundingBox();
      assert.equal(after.width, before.width);
      assert.equal(after.height, before.height);
      if (iconOnly) {
        const size = await button.evaluate((element) => {
          const style = getComputedStyle(element);
          return { width: parseFloat(style.width), height: parseFloat(style.height) };
        });
        assert.equal(size.width, 32);
        assert.equal(size.height, 32);
      }
      await page.mouse.move(1, 1);
      await page.keyboard.press('Tab');
      await button.focus();
      assert.equal(await button.locator('.download-button-cancel').isVisible(), true);
      await button.evaluate((element) => element.blur());
    }
  } finally {
    await page.evaluate((dark) => document.documentElement.classList.toggle('dark', dark), dark);
    await page.mouse.move(1, 1);
  }
}
