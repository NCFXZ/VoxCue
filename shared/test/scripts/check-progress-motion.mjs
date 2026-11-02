import assert from 'node:assert/strict';

export async function checkProgressMotion(page, root) {
  const content = root.locator('.response-progress-content');
  const toggle = root.locator('.duration-toggle');
  const settle = (node) =>
    node.evaluate(async (element) => {
      await Promise.all(
        element
          .getAnimations({ subtree: true })
          .filter((animation) => animation.effect.getTiming().iterations !== Infinity)
          .map((animation) => animation.finished.catch(() => {})),
      );
    });
  const sample = (node, fraction = 0.5) =>
    node.evaluate((element, fraction) => {
      const animations = element.getAnimations();
      for (const animation of animations) {
        if (!animation.transitionProperty) continue;
        animation.pause();
        animation.currentTime = Number(animation.effect.getTiming().duration) * fraction;
      }
      return {
        height: element.getBoundingClientRect().height,
        opacity: Number(getComputedStyle(element).opacity),
        heightTransition: animations.some((animation) =>
          ['height', 'block-size'].includes(animation.transitionProperty),
        ),
      };
    }, fraction);
  const finish = (node) =>
    node.evaluate((element) => {
      for (const animation of element.getAnimations({ subtree: true }))
        if (animation.transitionProperty) animation.finish();
    });
  await settle(root);
  assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
  assert.equal((await content.boundingBox()).height, 0);
  const transitions = async (button, body) => {
    const closed = (await body.boundingBox()).height;
    await button.focus();
    await button.press('Space');
    const opening = await sample(body);
    assert(
      opening.heightTransition,
      'opening has an interpolated height: ' + JSON.stringify(opening),
    );
    assert(opening.height > closed && opening.opacity > 0 && opening.opacity < 1);
    // Reverse while partially open. The first frame must continue from that position.
    await button.press('Space');
    const reversed = await sample(body, 0);
    assert(
      Math.abs(reversed.height - opening.height) < 1,
      'reversal does not jump: ' + JSON.stringify({ opening, reversed }),
    );
    const closing = await sample(body);
    assert(closing.heightTransition && closing.height > closed && closing.height < opening.height);
    assert(closing.opacity > 0 && closing.opacity < opening.opacity);
    await finish(body);
    assert.equal((await body.boundingBox()).height, closed);
    await button.press('Space');
    await settle(body);
    assert((await body.boundingBox()).height > opening.height);
  };
  await transitions(toggle, content);
  assert.equal(await content.evaluate((node) => node.inert), false);
  const section = root.locator('.reasoning-section').first();
  assert.equal(await section.getAttribute('open'), null);
  // This Chromium build does not expose ::details-content through getAnimations.
  // Observe rendered frames so native opening and closing are both verified.
  const frames = await section.evaluate(async (node) => {
    const read = () => ({
      height: node.getBoundingClientRect().height,
      opacity: Number(getComputedStyle(node, '::details-content').opacity),
    });
    const collect = async (reverse = false) => {
      const frames = [];
      let reversal;
      const began = performance.now();
      while (performance.now() - began < 320) {
        await new Promise(requestAnimationFrame);
        const frame = read();
        frames.push(frame);
        if (reverse && !reversal && frame.opacity > 0.3 && frame.opacity < 0.95) {
          node.querySelector('summary').click();
          reversal = { before: frame, after: read() };
        }
      }
      return { frames, reversal };
    };
    const closed = read();
    node.querySelector('summary').click();
    const opening = await collect();
    node.querySelector('summary').click();
    const closing = await collect();
    node.querySelector('summary').click();
    const reversed = await collect(true);
    return { closed, opening, closing, reversed };
  });
  const full = frames.opening.frames.at(-1);
  assert(full.height > frames.closed.height && full.opacity === 1);
  for (const { frames: samples } of [frames.opening, frames.closing]) {
    assert(
      samples.some(
        (frame) =>
          frame.height > frames.closed.height &&
          frame.height < full.height &&
          frame.opacity > 0 &&
          frame.opacity < 1,
      ),
      'native summary renders intermediate height and opacity',
    );
  }
  assert.deepEqual(frames.closing.frames.at(-1), frames.closed);
  assert(frames.reversed.reversal, 'summary reverses before finishing');
  assert(
    Math.abs(frames.reversed.reversal.before.height - frames.reversed.reversal.after.height) < 1,
  );
  assert.deepEqual(frames.reversed.frames.at(-1), frames.closed);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await section.locator('summary').press('Space');
  assert.equal(
    await section.evaluate(
      (node) => getComputedStyle(node, '::details-content').transitionDuration,
    ),
    '0s',
  );
  await section.locator('summary').press('Space');
  await section.evaluate(() => new Promise(requestAnimationFrame));
  assert.equal((await section.boundingBox()).height, frames.closed.height);
  await toggle.press('Space');
  assert.equal((await content.boundingBox()).height, 0);
  assert.equal(await content.evaluate((node) => node.inert), true);
  assert.equal(await content.getAttribute('aria-hidden'), 'true');
  assert.equal(await content.evaluate((node) => node.getAnimations().length), 0);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
}
