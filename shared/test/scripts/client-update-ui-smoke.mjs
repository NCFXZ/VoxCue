import { captureRequested } from './capture-requested.mjs';
import assert from 'node:assert/strict';
import path from 'node:path';
import packageInfo from '../../package.json' with { type: 'json' };
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
  const settings = page.locator('.settings-dialog');
  await page.getByRole('dialog', { name: '设置', exact: true }).waitFor();
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
  for (const language of ['zh-CN', 'en']) {
    const english = language === 'en';
    await page.evaluate((value) => {
      localStorage.setItem('voxcue-language-v1', value);
      dispatchEvent(new StorageEvent('storage', { key: 'voxcue-language-v1' }));
    }, language);
    await page.getByRole('dialog', { name: english ? 'Settings' : '设置', exact: true }).waitFor();
    const licenseRow = settings
      .getByText(english ? 'Open-source license' : '开源协议', { exact: true })
      .locator('..');
    await licenseRow.waitFor();
    const row = await licenseRow.boundingBox();
    const versionRow = settings.getByText('VoxCue', { exact: true }).locator('..');
    const version = await versionRow.boundingBox();
    const automatic = await settings.getByRole('switch').boundingBox();
    assert.ok(row.y >= version.y + version.height - 1 && row.y + row.height <= automatic.y);
    for (const [label, url, error, scope] of [
      [
        'AGPL-3.0-only',
        'https://github.com/NCFXZ/VoxCue/blob/main/LICENSE',
        english
          ? 'Could not open the open-source license. Please try again later.'
          : '无法打开开源协议，请稍后重试。',
        licenseRow,
      ],
      [
        english ? 'Third-party licenses' : '第三方许可',
        'https://github.com/NCFXZ/VoxCue/blob/main/THIRD_PARTY_NOTICES.md',
        english
          ? 'Could not open third-party licenses. Please try again later.'
          : '无法打开第三方许可，请稍后重试。',
        licenseRow,
      ],
      [
        english ? 'Release notes' : '更新日志',
        `https://voxcue.com.cn/${english ? 'en/' : ''}changelog/`,
        english
          ? 'Could not open the release notes. Please try again later.'
          : '无法打开更新日志，请稍后重试。',
        versionRow,
      ],
    ]) {
      const link = scope.getByRole('link', { name: label, exact: true });
      assert.equal(await link.getAttribute('href'), url);
      assert.equal(await link.getAttribute('title'), null);
      const box = await link.boundingBox();
      const bounds = await scope.boundingBox();
      assert.ok(box.x >= bounds.x - 1 && box.x + box.width <= bounds.x + bounds.width + 1);
      if (scope === versionRow) {
        const number = await versionRow.getByText(packageInfo.version, { exact: true }).boundingBox();
        assert.ok(number.x + number.width < box.x && number.y < box.y + box.height && box.y < number.y + number.height,
          'Release notes stays beside the current version');
      }
      await app.evaluate(() => {
        globalThis.feedbackFail = true;
      });
      await link.focus();
      await link.press('Enter');
      assert.equal(
        await link.evaluate((element) => getComputedStyle(element).textDecorationThickness),
        '2px',
        'Keyboard activation retains a visible link focus indicator',
      );
      await settings.getByRole('alert').filter({ hasText: error }).waitFor();
      await app.evaluate(() => {
        globalThis.feedbackFail = false;
      });
      await link.press('Enter');
      await settings.getByText(error, { exact: true }).waitFor({ state: 'hidden' });
      assert.deepEqual(await app.evaluate(() => globalThis.feedbackCalls.slice(-2)), [url, url]);
    }
  }
  await page.evaluate(() => {
    localStorage.setItem('voxcue-language-v1', 'zh-CN');
    dispatchEvent(new StorageEvent('storage', { key: 'voxcue-language-v1' }));
  });
  await settings.getByRole('button', { name: '关闭设置', exact: true }).click();
  assert.deepEqual(errors, []);
  console.log(
    'PASS sidebar/profile 240ms bidirectional animation frames, drag file card/theme/minimum/accessibility, repository, bilingual license and release-note page links with keyboard/error/retry, layout and local external port; no production traffic',
  );
} finally {
  await closeUiApp(app);
}
