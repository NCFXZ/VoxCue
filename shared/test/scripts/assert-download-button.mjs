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

export async function assertInitialDownloadProgress(button) {
  // The progress label can change the control's geometry. Hover its actual
  // bounds while the initial guard is active, then keep the pointer there.
  await button.hover();
  await settle(button);
  const initialBounds = await button.boundingBox();
  const feedback = await button.evaluate(async (element) => {
    const read = () => ({
      hovered: element.matches(':hover'),
      progress: getComputedStyle(element.querySelector('.download-button-progress')).visibility,
      cancel: getComputedStyle(element.querySelector('.download-button-cancel')).visibility,
      disabled: element.getAttribute('aria-disabled'),
    });
    const initial = read();
    await new Promise((resolve) => setTimeout(resolve, 400));
    return [initial, read()];
  });
  for (const state of feedback)
    assert.deepEqual(state, {
      hovered: true,
      progress: 'visible',
      cancel: 'hidden',
      disabled: 'true',
    });
  await button.locator('.download-button-cancel').waitFor({ state: 'visible' });
  assert.equal(await button.getAttribute('aria-disabled'), 'false');
  const finalBounds = await button.boundingBox();
  assert.equal(finalBounds.width, initialBounds.width);
  assert.equal(finalBounds.height, initialBounds.height);
}

export async function assertDownloadButton(page, button, { iconOnly = false } = {}) {
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
      const cancel = await button.evaluate((element) => {
        const probe = document.createElement('span');
        probe.style.color = 'var(--danger-fill)';
        document.body.append(probe);
        const danger = getComputedStyle(probe).color;
        probe.remove();
        const style = getComputedStyle(element);
        return {
          background: style.backgroundColor,
          border: style.borderColor,
          color: style.color,
          danger,
        };
      });
      assert.equal(cancel.background, cancel.danger);
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
