import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';

const flatten = (node) => [node, ...(node.children ?? []).flatMap(flatten)];
export async function checkSidebarUpdates({ app, page, state, poll, probe, probeFile }) {
  const directory = process.argv.find((arg) => arg.startsWith('--screenshots='))?.slice(14);
  if (directory) {
    assert.ok(path.isAbsolute(directory));
    await mkdir(directory, { recursive: true });
  }
  const settle = async (button) => {
    await button.evaluate(async (node) => {
      await new Promise(requestAnimationFrame);
      for (;;) {
        node.getBoundingClientRect();
        const active = node
          .getAnimations()
          .filter((animation) => animation.playState === 'running');
        if (!active.length) return;
        await Promise.all(active.map((animation) => animation.finished.catch(() => {})));
        await new Promise(requestAnimationFrame);
      }
    });
  };
  const native = async (button, title) => {
    await poll(
      () => button.boundingBox(),
      (rect) => (title ? rect?.width > 80 : Math.abs((rect?.width ?? 0) - 36) < 1),
      'Shared update action must reach its requested circle/capsule state',
    );
    await settle(button);
    const rect = await button.boundingBox();
    const value = await poll(
      state,
      (value) =>
        flatten(value.tree).some(
          (node) =>
            node.class === 'NSButton' &&
            node.title === title &&
            Math.abs(node.centerX - rect.x - rect.width / 2) < 1 &&
            Math.abs(node.centerY - rect.y - rect.height / 2) < 1 &&
            Math.abs(node.frameWidth - rect.width) < 1,
        ),
      'Native update button must follow the shared circle/capsule and title',
    ).catch(async (error) => {
      console.error('update control mismatch', {
        title,
        rect,
        source: await button.evaluate((node) => ({
          text: node.innerText,
          hovered: node.matches(':hover'),
          rect: node.getBoundingClientRect().toJSON(),
        })),
        native: flatten((await state()).tree)
          .filter((node) => node.class === 'NSButton')
          .map(({ title, centerX, centerY, frameWidth }) => ({
            title,
            centerX,
            centerY,
            frameWidth,
          })),
      });
      throw error;
    });
    const node = flatten(value.tree).find(
      (node) =>
        node.class === 'NSButton' &&
        node.title === title &&
        Math.abs(node.centerX - rect.x - rect.width / 2) < 1 &&
        Math.abs(node.centerY - rect.y - rect.height / 2) < 1,
    );
    assert.equal(
      node.bezelStyle,
      1,
      'Update actions use neutral over-glass Push, not a Glass bezel',
    );
    assert.equal(node.inSystemGlassContent, true);
    assert.equal(node.frameHeight, 36);
    assert.equal(node.contentCentered, true);
    assert.equal(node.image, true);
    assert.equal(node.focusRingType, 1);
    return { node, rect };
  };
  const screenshot = async (name) => {
    if (!directory) return;
    await page.screenshot();
    const bottom = await page.locator('.sidebar-bottom').boundingBox();
    const sidebar = await page.locator('.sidebar').boundingBox();
    const height = await page.evaluate(() => innerHeight);
    const clip = {
      x: sidebar.x,
      y: Math.floor(bottom.y - 12),
      width: sidebar.width,
      height: Math.ceil(height - bottom.y + 12),
    };
    await app.evaluate(
      async ({ app, BrowserWindow, nativeImage }, { file, output, clip }) => {
        const require = process
          .getBuiltinModule('module')
          .createRequire(process.cwd() + '/package.json');
        const win = BrowserWindow.getAllWindows().find((win) => win.getTitle() === 'VoxCue');
        app.focus({ steal: true });
        win.focus();
        const protectedWindow = win.isContentProtected();
        win.setContentProtection(false);
        try {
          await new Promise((resolve) => setTimeout(resolve, 250));
          const result = await require(file).snapshot(win.getNativeWindowHandle());
          const image = nativeImage.createFromBuffer(result.png);
          const crop = {
            x: Math.round(result.crop.x + clip.x),
            y: Math.round(result.crop.y + clip.y),
            width: Math.round(clip.width),
            height: Math.round(clip.height),
          };
          require('node:fs').writeFileSync(output, image.crop(crop).toPNG());
        } finally {
          win.setContentProtection(protectedWindow);
        }
      },
      { file: probeFile, output: path.join(directory, name + '.png'), clip },
    );
  };
  await probe('backdrop', 2);
  await app.evaluate(({ app, BrowserWindow, nativeTheme }) => {
    nativeTheme.themeSource = 'light';
    app.focus({ steal: true });
    BrowserWindow.getAllWindows()
      .find((win) => win.getTitle() === 'VoxCue')
      .focus();
  });
  await page.evaluate(() => document.documentElement.classList.remove('dark'));
  await page.waitForFunction(
    async () => (await window.desktop.updates({ op: 'status' })).phase === 'available',
  );
  const sidebar = page.locator('.sidebar-bottom');
  const collapsed = async (button) => {
    await page.getByRole('button', { name: '收起侧栏', exact: true }).click();
    await page.waitForFunction(() =>
      document.querySelector('.sidebar')?.classList.contains('collapsed'),
    );
    await button.hover();
    assert.equal((await native(button, '')).rect.width, 36, 'Collapsed hover remains icon-only');
    await page.keyboard.press('Tab');
    await button.focus();
    assert.equal(
      (await native(button, '')).rect.width,
      36,
      'Collapsed keyboard focus remains icon-only',
    );
    await page.getByRole('button', { name: '展开侧栏', exact: true }).click();
    await page.mouse.move(900, 100);
    await button.evaluate((node) => node.blur());
  };
  const download = sidebar.getByRole('button', { name: '下载更新', exact: true });
  await page.mouse.move(900, 100);
  const circle = await native(download, '');
  assert.equal(circle.rect.width, 36);
  await download.hover();
  await native(download, '下载更新');
  await screenshot('mac-update-download-light');
  await download.click();
  const progress = sidebar.locator('.download-button');
  await progress.waitFor();
  assert.equal(await progress.getAttribute('aria-disabled'), 'true');
  await progress.hover();
  assert.equal((await progress.boundingBox()).width, 36);
  await app.evaluate(() =>
    globalThis.sidebarUpdateDriver.emit('download-progress', { percent: 38 }),
  );
  await page.waitForFunction(() =>
    document.querySelector('.sidebar-update')?.classList.contains('is-cancellable'),
  );
  for (const dark of [false, true]) {
    await app.evaluate(({ nativeTheme }, dark) => {
      nativeTheme.themeSource = dark ? 'dark' : 'light';
    }, dark);
    await page.evaluate((dark) => document.documentElement.classList.toggle('dark', dark), dark);
    await progress.hover();
    const capsule = await native(progress, '取消下载');
    assert.ok(capsule.rect.width > 80 && capsule.rect.width < 180, JSON.stringify(capsule.rect));
    assert.notEqual(capsule.node.borderShape, circle.node.borderShape);
    assert.ok(capsule.node.foregroundColor[0] > capsule.node.foregroundColor[2]);
    await screenshot('mac-update-cancel-' + (dark ? 'dark' : 'light'));
    await page.mouse.move(900, 100);
    await progress.evaluate((node) => node.blur());
    await settle(progress);
    assert.equal((await progress.boundingBox()).width, 36);
    await page.keyboard.press('Tab');
    await progress.focus();
    await native(progress, '取消下载');
    await progress.evaluate((node) => node.blur());
  }
  await collapsed(progress);
  await progress.hover();
  await progress.click();
  await download.waitFor();
  await download.click();
  await page.waitForFunction(
    async () => (await window.desktop.updates({ op: 'status' })).phase === 'downloading',
  );
  await app.evaluate(() => globalThis.sidebarUpdateDriver.finish());
  const restart = sidebar.getByRole('button', { name: '重启以更新', exact: true });
  await restart.waitFor();
  for (const dark of [false, true]) {
    await app.evaluate(({ nativeTheme }, dark) => {
      nativeTheme.themeSource = dark ? 'dark' : 'light';
    }, dark);
    await page.evaluate((dark) => document.documentElement.classList.toggle('dark', dark), dark);
    await page.mouse.move(900, 100);
    await restart.evaluate((node) => node.blur());
    assert.equal((await native(restart, '')).rect.width, 36);
    await restart.hover();
    const expanded = await native(restart, '重启以更新');
    assert.ok(expanded.rect.width > 80 && expanded.rect.width < 190);
    await screenshot('mac-update-restart-' + (dark ? 'dark' : 'light'));
    await page.mouse.move(900, 100);
    await restart.evaluate((node) => node.blur());
    await native(restart, '');
    await page.keyboard.press('Tab');
    await restart.focus();
    await native(restart, '重启以更新');
    await restart.evaluate((node) => node.blur());
  }
  await collapsed(restart);
  await restart.hover();
  await native(restart, '重启以更新');
  assert.equal(
    (await page.evaluate(() => window.desktop.updates({ op: 'status' }))).phase,
    'downloaded',
  );
  console.log(
    'PASS: actual AppKit update circles/capsules, native titles/colors, hover/keyboard expansion, 36px height, first-second guard, cancel and downloaded state.',
  );
}
