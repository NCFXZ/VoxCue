import assert from 'node:assert/strict';

export async function assertLoadingIcon(page, container) {
  const icon = container.locator('svg').first();
  await icon.waitFor({ state: 'visible' });
  const mac = await page.evaluate(() => window.desktop.platform === 'macos');
  if (mac) assert.equal(await icon.getAttribute('data-sf-symbol'), 'progress.indicator');
  const animation = mac ? icon.locator('.macos-loading-sweep') : container;
  const initial = await animation.evaluate((element) => ({
    name: getComputedStyle(element).animationName,
    transform: getComputedStyle(element).transform,
  }));
  assert.notEqual(initial.name, 'none');
  await page.waitForFunction(
    ({ element, initial }) => getComputedStyle(element).transform !== initial,
    {
      element: await animation.elementHandle(),
      initial: initial.transform,
    },
  );
  // Check rendered pixels as well as the compositor timeline. A flat/symmetric
  // mask can have a running CSS animation without any visible movement.
  const frames = [];
  for (let index = 0; index < 3; index++) {
    const transform = await animation.evaluate((element) => getComputedStyle(element).transform);
    frames.push(await icon.screenshot({ animations: 'allow' }));
    await page.waitForFunction(
      ({ element, transform }) => getComputedStyle(element).transform !== transform,
      {
        element: await animation.elementHandle(),
        transform,
      },
    );
  }
  assert.ok(
    frames.some((frame) => !frame.equals(frames[0])),
    'Visible loading pixels must advance',
  );
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(
    await animation.evaluate((element) => getComputedStyle(element).animationName),
    'none',
  );
  await page.emulateMedia({ reducedMotion: 'no-preference' });
}
