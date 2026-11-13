import { captureRequested } from './capture-requested.mjs';
import assert from 'node:assert/strict';
import path from 'node:path';
import { testRoot, electron } from './test-workspace.mjs';
import { offlineElectronEntry } from './offline-electron-entry.mjs';
import { installUiAccount, connectUiAccount, closeUiApp } from './install-ui-account.mjs';
const app = await electron.launch({
  args: [await offlineElectronEntry()],
  env: {
    ...process.env,
    COPILOT_TEST_USER_DATA: path.join(testRoot, 'updates-ui'),
    VITE_DEV_SERVER_URL: '',
  },
});
const errors = [];
try {
  const login = await app.firstWindow();
  await login.getByRole('heading', { name: '登录 VoxCue', exact: true }).waitFor();
  await login.waitForFunction(() => document.visibilityState === 'visible');
  const native = await app.browserWindow(login);
  assert.equal(await native.evaluate((w) => w.isVisible()), true);
  await installUiAccount(app, { speech: true, components: true });
  const page = await connectUiAccount(app, login);
  page.on('pageerror', (e) => errors.push(e.message));
  await page.waitForFunction(
    () => !document.querySelector('[aria-label="聊天消息"]')?.disabled,
  );
  const win = await app.browserWindow(page);
  const motion = async (selector, button) =>
    page.evaluate(
      async ({ selector, button }) => {
        const node = document.querySelector(selector),
          widths = [node.getBoundingClientRect().width];
        const style = getComputedStyle(node),
          duration = style.transitionDuration,
          easing = style.transitionTimingFunction;
        document.querySelector(button).click();
        const start = performance.now();
        while (performance.now() - start < 320) {
          await new Promise(requestAnimationFrame);
          widths.push(node.getBoundingClientRect().width);
        }
        return { widths, duration, easing };
      },
      { selector, button },
    );
  for (const dark of [false, true])
    for (const width of [1280, 880]) {
      await page.emulateMedia({
        colorScheme: dark ? 'dark' : 'light',
        reducedMotion: 'no-preference',
        forcedColors: 'none',
      });
      await win.evaluate((w, width) => w.setSize(width, 800), width);
      await page.evaluate(
        () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
      );
      for (const [selector, button] of [
        ['.sidebar', '.sidebar-toggle-button'],
        ['.personal-panel', 'button[aria-label="个人信息"]'],
      ])
        for (let direction = 0; direction < 2; direction++) {
          const result = await motion(selector, button),
            a = result.widths[0],
            b = result.widths.at(-1);
          assert.ok(result.duration.includes('0.24s'), JSON.stringify(result));
          assert.ok(
            result.easing.includes('cubic-bezier(0.2, 0, 0, 1)'),
            JSON.stringify(result),
          );
          assert.ok(Math.abs(a - b) > 100, JSON.stringify(result));
          assert.ok(
            result.widths.some((x) => x > Math.min(a, b) + 2 && x < Math.max(a, b) - 2),
            'Real intermediate animation frames required',
          );
        }
      for (const reduced of [false, true]) {
        await page.emulateMedia({
          reducedMotion: reduced ? 'reduce' : 'no-preference',
          forcedColors: reduced ? 'active' : 'none',
        });
        await page.locator('.chat-column').evaluate((node) => {
          const dataTransfer = new DataTransfer();
          dataTransfer.items.add(new File(['synthetic'], 'fixture.txt'));
          node.dispatchEvent(new DragEvent('dragenter', { dataTransfer, bubbles: true }));
        });
        const card = page.locator('.chat-drop-card');
        await card.getByText('添加到当前对话', { exact: true }).waitFor();
        assert.equal(await card.locator('svg').count(), 1);
        await card.getByText('最多 20 个文件', { exact: true }).waitFor();
        await card.getByText('单个不超过 20 MB', { exact: true }).waitFor();
        const geometry = await card.evaluate((node) => {
          const r = node.getBoundingClientRect();
          return {
            left: r.left,
            right: r.right,
            top: r.top,
            bottom: r.bottom,
            width: innerWidth,
            height: innerHeight,
            animation: getComputedStyle(node).animationName,
          };
        });
        assert.ok(
          geometry.left >= 0 &&
            geometry.right <= geometry.width &&
            geometry.top >= 0 &&
            geometry.bottom <= geometry.height,
          JSON.stringify(geometry),
        );
        if (reduced) assert.equal(geometry.animation, 'none');
        if (!reduced) await captureRequested(page, `drag-${dark ? 'dark' : 'light'}-${width}`);
        await page.evaluate(() => window.dispatchEvent(new Event('dragend')));
        assert.equal(await card.count(), 0);
      }
    }
  await page.emulateMedia({ reducedMotion: 'no-preference', forcedColors: 'none' });
  await app.evaluate(({ shell }) => {
    globalThis.feedbackCalls = [];
    shell.openExternal = async (url) => {
      globalThis.feedbackCalls.push(url);
      if (globalThis.feedbackFail) throw Error('synthetic external failure');
    };
  });
  await page.getByRole('button', { name: '用户菜单', exact: true }).click();
  await page.getByRole('menuitem', { name: '设置', exact: true }).click();
  const settings = page.getByRole('dialog', { name: '设置', exact: true });
  await settings.getByRole('button', { name: '关于与更新', exact: true }).click();
  const feedback = settings.getByRole('link', { name: 'GitHub 仓库', exact: true });
  assert.equal(
    await feedback.getAttribute('href'),
    'https://github.com/NCFXZ/VoxCue',
  );
  assert.equal(await feedback.locator('img').getAttribute('aria-hidden'), 'true');
  await feedback.locator('img').evaluate((image) => image.decode());
  await captureRequested(page, 'feedback-about');
  assert.match(
    await feedback.evaluate((node) => getComputedStyle(node).textDecorationLine),
    /underline/,
  );
  assert.equal(
    await settings
      .getByText('开发版本不检查线上更新，请使用 VoxCue 安装版。', { exact: true })
      .count(),
    0,
  );
  await app.evaluate(() => {
    globalThis.feedbackFail = true;
  });
  await feedback.focus();
  await feedback.press('Enter');
  await settings
    .getByRole('alert')
    .filter({ hasText: '无法打开 GitHub 仓库，请稍后重试。' })
    .waitFor();
  await app.evaluate(() => {
    globalThis.feedbackFail = false;
  });
  await feedback.press('Enter');
  await settings
    .getByText('无法打开 GitHub 仓库，请稍后重试。', { exact: true })
    .waitFor({ state: 'hidden' });
  assert.deepEqual(
    await app.evaluate(() => globalThis.feedbackCalls),
    Array(2).fill('https://github.com/NCFXZ/VoxCue'),
  );
  await settings.getByRole('button', { name: '关闭设置', exact: true }).click();
  assert.deepEqual(errors, []);
  console.log(
    'PASS sidebar/profile 240ms bidirectional animation frames, drag file card/theme/minimum/accessibility, repository link keyboard/error/retry and local external port; no production traffic',
  );
} finally {
  await closeUiApp(app);
}
