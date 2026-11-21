import assert from 'node:assert/strict';

// Measure fine stripes through the actual menu, then disable its filter to verify
// that the same pixels would otherwise show the background sharply.
export async function assertMenuBackdrop(app, page, backdrop) {
  const menu = page.getByRole('menu');
  await page.waitForFunction(() => {
    const el = document.querySelector('[role="menu"][data-state="open"]');
    return el && !el.hasAttribute('data-menu-height-motion') && el.clientHeight > 0;
  });
  const clip = await menu.evaluate((el, backdrop) => {
    const rect = el.getBoundingClientRect();
    if (backdrop === 'settings') {
      const dialog = el.closest('dialog').getBoundingClientRect();
      if (rect.bottom <= dialog.bottom + 8) throw Error('Expected the source menu to extend past the dialog');
      return {
        x: Math.floor(rect.left + rect.width / 2 - 28),
        y: Math.floor((dialog.bottom + rect.bottom) / 2),
        width: 56, height: 1,
      };
    }
    const left = Math.ceil(rect.left) + 12;
    const right = Math.min(rect.right, document.querySelector('.sidebar').getBoundingClientRect().right);
    return {
      x: left, y: Math.floor(rect.top + rect.height / 2),
      width: Math.min(56, Math.floor(right) - left - 8),
      height: 1,
    };
  }, backdrop);
  assert.ok(clip.width >= 18, 'The sample must cover several stripes beneath the menu');
  const target = backdrop === 'sidebar' ? '.sidebar' : '.settings-dialog::after';
  const probe = await page.addStyleTag({ content: `
    .dropdown-content > .dropdown-scroll { visibility: hidden !important; }
    .settings-dialog::after { content: ''; position: absolute; inset: 0; z-index: 2; pointer-events: none; }
    ${target} { background-image: repeating-linear-gradient(to right,
      var(--foreground) 0 3px, transparent 3px 6px) !important; }
  ` });
  const win = await app.browserWindow(page);
  const sample = async (phase) => {
    await probe.evaluate((style, phase) => {
      const texture = Array.from(style.sheet.cssRules).at(-1).style;
      texture.backgroundPositionX = phase + 'px';
    }, phase);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    return win.evaluate(async (w, rect) => {
      const image = await w.webContents.capturePage(rect);
      const bytes = image.resize({ width: rect.width, height: 1 }).toBitmap({ scaleFactor: 1 });
      // Native BGRA is premultiplied. Composite over neutral gray as on a desktop.
      return Array.from({ length: rect.width }, (_, x) =>
        bytes[x * 4 + 2] + 128 * (1 - bytes[x * 4 + 3] / 255));
    }, clip);
  };
  const contrast = async () => {
    // Invert the fine stripes in place. The wide gradient at the sidebar edge
    // is real blurred content and cancels out between these two frames.
    const original = await sample(0);
    const shifted = await sample(3);
    return original.reduce((sum, level, x) => sum + Math.abs(level - shifted[x]), 0) / original.length;
  };
  let disabled;
  try {
    const blurred = await contrast();
    disabled = await page.addStyleTag({ content: '.dropdown-content { backdrop-filter: none !important; }' });
    const sharp = await contrast();
    assert.ok(sharp > 24 && blurred < sharp * .15,
      `Menu over ${backdrop} must diffuse the stripes at ${JSON.stringify(clip)} (blurred ${blurred}, sharp ${sharp})`);
  } finally {
    if (disabled) await disabled.evaluate(el => el.remove());
    await probe.evaluate(el => el.remove());
    await win.dispose();
  }
}
