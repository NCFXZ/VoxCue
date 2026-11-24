import assert from 'node:assert/strict';

// Exercise the real reveal/queue lifecycle, including removal of the retained
// row and restoration of natural height after its animation finishes.
export async function assertNoticeQueueTransition(page, action, resize = false) {
  const result = await page.evaluate(async ({ action, resize }) => {
    const host = document.querySelector('.chat-settings-notices');
    const slot = document.createElement('div');
    slot.className = 'chat-notice-slot';
    slot.inert = true;
    slot.setAttribute('aria-hidden', 'true');
    slot.innerHTML = '<div class="chat-notice-positioner"><aside class="components-notice">Owned queue follower</aside></div>';
    host.append(slot);
    const follower = slot.firstElementChild;
    const frames = [];
    try {
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      await Promise.allSettled(host.getAnimations({ subtree: true })
        .filter(animation => Number.isFinite(animation.effect.getComputedTiming().endTime))
        .map(animation => animation.finished));
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const start = performance.now();
      const read = () => {
        const card = host.querySelector('.announcement-notice');
        return { time: performance.now() - start, y: follower.getBoundingClientRect().top,
          height: card?.getBoundingClientRect().height,
          frameHeight: card?.closest('.interview-reveal').getBoundingClientRect().height,
          moving: follower.getAnimations().some(animation => animation.playState === 'running') };
      };
      frames.push(read());
      const button = [...host.querySelectorAll('button')].find(node =>
        node.getAttribute('aria-label') === action || node.textContent.trim() === action);
      if (!button) throw Error('Missing queue action: ' + action);
      button.click();
      while (performance.now() - start < 550) {
        await new Promise(requestAnimationFrame);
        frames.push(read());
      }
      return { frames, resize };
    } finally { slot.remove(); }
  }, { action, resize });
  const { frames } = result;
  const distance = frames.at(-1).y - frames[0].y;
  assert.ok(Math.abs(distance) > 2, 'The real queue transition must change its occupied height');
  for (let index = 1; index < frames.length; index++) {
    assert.ok((frames[index].y - frames[index - 1].y) * Math.sign(distance) >= -0.5,
      'Queue motion must not reverse after reaching its target: ' + JSON.stringify({ action, frames }));
    if (resize && frames[index].time < 260)
      assert.ok(Math.abs(frames[index].height - frames[index].frameHeight) < 0.5,
        'The visible card border must resize with its frame, not appear at the end');
  }
  const tail = frames.filter(frame => frame.time >= 320);
  assert.ok(tail.every(frame => Math.abs(frame.y - frames.at(-1).y) < 0.5 && !frame.moving),
    'A completed reveal must not start a second position correction');
  console.log('PASS: real queue transition settles once, with synchronized card border: ' + action);
}

export async function assertNoticeStackMotion(page) {
  const fixtures = '.chat-settings-notices > [data-notice-motion-fixture]';
  await page.evaluate(() => {
    const slot = document.createElement('div');
    slot.className = 'chat-notice-slot';
    slot.dataset.noticeMotionFixture = '';
    slot.inert = true;
    slot.setAttribute('aria-hidden', 'true');
    for (const name of ['upper', 'lower']) {
      const item = document.createElement('div');
      item.className = 'chat-notice-positioner';
      item.dataset.fixtureItem = name;
      item.innerHTML = '<aside class="components-notice" style="height:72px">Owned synthetic notice</aside>';
      slot.append(item);
    }
    document.querySelector('.chat-settings-notices').append(slot);
  });
  const settle = () => page.evaluate(() => new Promise(resolve =>
    requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const sample = (change, reduced = false) => page.evaluate(async ({ change, reduced }) => {
    const slot = document.querySelector('[data-notice-motion-fixture]');
    const lower = slot.querySelector('[data-fixture-item="lower"]');
    const upper = slot.querySelector('[data-fixture-item="upper"]');
    const read = () => ({ time: performance.now() - start, y: lower.getBoundingClientRect().top,
      x: lower.getBoundingClientRect().left });
    const start = performance.now();
    const frames = [read()];
    if (change === 'remove') upper.remove();
    else if (change === 'insert') {
      const item = lower.cloneNode(true);
      item.dataset.fixtureItem = 'upper';
      slot.prepend(item);
    } else upper.firstElementChild.style.height = change === 'shrink' ? '72px' : '136px';
    let interrupted = false, timing;
    while (performance.now() - start < (reduced ? 70 : change === 'interrupt' ? 560 : 380)) {
      await new Promise(requestAnimationFrame);
      frames.push(read());
      timing ??= lower.getAnimations().find(animation => animation.effect instanceof KeyframeEffect &&
        animation.effect.getKeyframes().some(frame => 'transform' in frame))?.effect.getTiming();
      if (change === 'interrupt' && !interrupted && performance.now() - start >= 80) {
        upper.firstElementChild.style.height = '200px';
        interrupted = true;
      }
    }
    return { frames, timing };
  }, { change, reduced });
  try {
    await settle();
    for (const change of ['remove', 'insert', 'grow', 'shrink', 'interrupt']) {
      const { frames, timing } = await sample(change);
      const start = frames[0].y, end = frames.at(-1).y;
      const distance = end - start;
      assert.ok(Math.abs(distance) >= 60, `${change}: fixture must cause a real layout shift`);
      assert.ok(timing?.duration > 0 && timing.easing.includes('cubic-bezier'), `${change}: nonlinear position animation required`);
      assert.ok(frames.some(frame => Math.abs(frame.y - start) > 2 && Math.abs(frame.y - end) > 2), `${change}: intermediate positions required`);
      for (let index = 1; index < frames.length; index++) {
        assert.ok(Math.abs(frames[index].x - frames[0].x) < 0.5, `${change}: horizontal anchor must stay fixed`);
        assert.ok((frames[index].y - frames[index - 1].y) * Math.sign(distance) >= -0.5, `${change}: movement must continue without reversing`);
        assert.ok(Math.abs(frames[index].y - frames[index - 1].y) < Math.abs(distance) * 0.7, `${change}: no single-frame teleport: ${JSON.stringify({ frames, timing })}`);
      }
      if (change !== 'interrupt') {
        const middle = frames.find(frame => frame.time >= Number(timing.duration) / 2);
        assert.ok((middle.y - start) / distance > 0.65, `${change}: actual travel must ease out, not move linearly`);
      }
    }
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const { frames, timing } = await sample('remove', true);
    assert.ok(!timing, 'Reduced motion must not start a position animation');
    assert.ok(frames.slice(1).every(frame => Math.abs(frame.y - frames.at(-1).y) < 0.5), 'Reduced motion must settle immediately');
    console.log('PASS: notice removal, insertion, growth, shrinkage, interrupted motion, fixed horizontal anchor, nonlinear travel and reduced motion');
  } finally {
    await page.locator(fixtures).evaluateAll(nodes => nodes.forEach(node => node.remove()));
    await page.emulateMedia({ reducedMotion: 'no-preference' });
  }
}
