import { connectUiAccount, installUiAccount } from './install-ui-account.mjs';
import { testRoot, electron } from './test-workspace.mjs';
import { offlineElectronEntry } from './offline-electron-entry.mjs';
import { closeUiApp } from './install-ui-account.mjs';
import { dropdownRevealGeometry } from './continuous-corners.mjs';

import { mkdir, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

await mkdir(path.join(testRoot, 'test/results'), { recursive: true });
const profile = await mkdtemp(path.resolve(path.join(testRoot, 'test/results/settings-profile-')));
const env = { ...process.env, COPILOT_TEST_USER_DATA: profile, VITE_DEV_SERVER_URL: '' };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: [await offlineElectronEntry()], env });
try {
  await installUiAccount(app);
  const login = await app.firstWindow();
  await login.getByRole('heading', { name: '登录 VoxCue', exact: true }).waitFor();
  await login.waitForFunction(() => document.visibilityState === 'visible');
  const page = await connectUiAccount(app, login);
  page.setDefaultTimeout(30000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const startMenuFrames = async (triggerId) =>
    page.evaluate((triggerId) => {
      const frames = [];
      let frame;
      const sample = () => {
        const menu = [...document.querySelectorAll('.dropdown-content')].find(
          (node) => node.getAttribute('aria-labelledby') === triggerId,
        );
        if (menu) {
          const style = getComputedStyle(menu);
          const transform =
            style.transform === 'none' ? new DOMMatrix() : new DOMMatrix(style.transform);
          const box = menu.getBoundingClientRect();
          const wrapper = menu.parentElement.getBoundingClientRect();
          const masks = [...menu.querySelectorAll('[mask]')];
          frames.push({
            state: menu.getAttribute('data-state'),
            opacity: Number(style.opacity),
            unscaled: Math.abs(transform.m11 - 1) < 0.001 && Math.abs(transform.m22 - 1) < 0.001,
            width: box.width,
            height: box.height,
            top: box.top,
            bottom: box.bottom,
            frameHeight: wrapper.height,
            frameTop: wrapper.top,
            frameBottom: wrapper.bottom,
            side: menu.getAttribute('data-side'),
            clip: style.clipPath,
            radius: parseFloat(style.borderTopLeftRadius),
            overflow: style.overflow,
            shadow: style.boxShadow,
            frameOverflow: getComputedStyle(menu.parentElement).overflow,
            inert: menu.inert,
            ariaHidden: menu.getAttribute('aria-hidden'),
            snapshot: menu.hasAttribute('data-menu-outro'),
            roles: menu.querySelectorAll('[role]').length + Number(menu.hasAttribute('role')),
            identities: [...menu.querySelectorAll('[id], [name], [autofocus]')].filter(
              (node) =>
                node.namespaceURI !== 'http://www.w3.org/2000/svg' ||
                node.hasAttribute('name') ||
                node.hasAttribute('autofocus'),
            ).length,
            masks: masks.length,
            brokenMasks: masks.filter((node) => {
              const id = node.getAttribute('mask')?.match(/^url\(#(.+)\)$/)?.[1];
              const resource = id && document.getElementById(id);
              return !resource || !node.closest('svg')?.contains(resource);
            }).length,
            duplicateIds:
              new Set([...document.querySelectorAll('[id]')].map((node) => node.id)).size !==
              document.querySelectorAll('[id]').length,
            animating: menu
              .getAnimations({ subtree: true })
              .some((animation) => animation.playState === 'running'),
          });
        }
        frame = requestAnimationFrame(sample);
      };
      frame = requestAnimationFrame(sample);
      window.settingsMenuFrames = { frames, stop: () => cancelAnimationFrame(frame) };
    }, triggerId);
  const finishMenuFrames = async (triggerId) => {
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
    await page.waitForFunction((triggerId) => {
      const menu = [...document.querySelectorAll('.dropdown-content')].find(
        (node) => node.getAttribute('aria-labelledby') === triggerId,
      );
      return (
        !menu ||
        menu
          .getAnimations({ subtree: true })
          .every((animation) => animation.playState !== 'running')
      );
    }, triggerId);
    const frames = await page.evaluate(() => {
      const probe = window.settingsMenuFrames;
      probe.stop();
      delete window.settingsMenuFrames;
      return probe.frames;
    });
    return frames.map((frame) => ({ ...frame, ...dropdownRevealGeometry(frame) }));
  };
  const captureUserMenuIcon = async (phase) => {
    const geometry = await page.evaluate(async (phase) => {
      const menu = document.querySelector(
        phase === 'open' ? '.user-menu:not([data-menu-outro])' : '.user-menu[data-menu-outro]',
      );
      let icon = [...menu.querySelectorAll('[data-ui-icon]')].at(-1);
      if (phase === 'open') {
        window.settingsMenuIconReference = icon.cloneNode(true);
      } else if (phase === 'exit') {
        window.settingsIconExitAnimations = menu.getAnimations();
        for (const animation of window.settingsIconExitAnimations) {
          animation.pause();
          animation.currentTime = Number(animation.effect.getTiming().duration) * 0.1;
        }
      } else {
        // Render the independently saved live SVG in the same slot and at the
        // same native pixel phase as the already captured exit icon.
        const reference = window.settingsMenuIconReference;
        const snapshotIcon = icon;
        window.settingsRestoreMenuIcon = () => reference.replaceWith(snapshotIcon);
        icon.replaceWith(reference);
        icon = reference;
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      }
      const box = icon.getBoundingClientRect(),
        surface = menu.getBoundingClientRect();
      const layout = (node) => {
        const { x, y, width, height } = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        return {
          rect: { x, y, width, height },
          position: style.position,
          top: style.top,
          bottom: style.bottom,
          width: style.width,
          height: style.height,
          border: style.borderWidth,
          padding: style.padding,
          transform: style.transform,
        };
      };
      return {
        rect: { x: box.x, y: box.y, width: box.width, height: box.height },
        dpr: devicePixelRatio,
        side: menu.dataset.side,
        pinned: menu.hasAttribute('data-menu-height-motion'),
        layout: {
          row: layout(icon.closest('.dropdown-item')),
          scroll: layout(menu.querySelector('.dropdown-scroll')),
          surface: layout(menu),
          wrapper: layout(menu.parentElement),
        },
        contained: box.top >= surface.top && box.bottom <= surface.bottom,
        opacity: Number(getComputedStyle(menu).opacity),
        clip: {
          x: Math.floor(box.left),
          y: Math.floor(box.top),
          width: Math.ceil(box.right) - Math.floor(box.left),
          height: Math.ceil(box.bottom) - Math.floor(box.top),
        },
      };
    }, phase);
    if (phase === 'open') return geometry;
    const windowId = await (await app.browserWindow(page)).evaluate((win) => win.id);
    const bitmap = await app.evaluate(
      async ({ BrowserWindow }, { windowId, clip }) => {
        const image = await BrowserWindow.fromId(windowId).webContents.capturePage(clip);
        return {
          size: image.getSize(),
          scaleFactors: image.getScaleFactors(),
          bytes: [...image.toBitmap()],
        };
      },
      { windowId, clip: geometry.clip },
    );
    return { ...geometry, ...bitmap };
  };
  const open = async () => {
    await page.getByRole('button', { name: '用户菜单', exact: true }).click();
    await page.getByRole('menuitem', { name: '设置', exact: true }).click();
    assert.equal(
      await page
        .getByRole('navigation', { name: '设置分类' })
        .getByRole('button', { name: 'VoxCue 账号', exact: true })
        .getAttribute('aria-current'),
      'page',
    );
    await page
      .getByRole('navigation', { name: '设置分类' })
      .getByRole('button', { name: '通用', exact: true })
      .click();
    await page.getByRole('heading', { name: '通用', exact: true }).waitFor();
  };
  const settings = page.getByRole('dialog', { name: '设置', exact: true });
  const category = (name) =>
    settings
      .getByRole('navigation', { name: '设置分类' })
      .getByRole('button', { name, exact: true });
  const verifyCategoryCorners = async () => {
    await settings.getByRole('heading', { name: '通用', exact: true }).waitFor();
    await page.waitForFunction(
      () =>
        !document.documentElement.dataset.viewDirection &&
        !document.querySelector('[data-menu-outro]'),
    );
    const clips = await settings.evaluate((dialog) => {
      const box = dialog.querySelector('.settings-content').getBoundingClientRect();
      return [
        { x: Math.floor(box.right) - 8, y: Math.ceil(box.top), width: 8, height: 8 },
        { x: Math.floor(box.right) - 8, y: Math.floor(box.bottom) - 8, width: 8, height: 8 },
      ];
    });
    const windowId = await (await app.browserWindow(page)).evaluate((win) => win.id);
    const captureCorners = () =>
      app.evaluate(
        async ({ BrowserWindow }, { windowId, clips }) => {
          const colors = [];
          for (const [corner, clip] of clips.entries()) {
            const image = await BrowserWindow.fromId(windowId).webContents.capturePage(clip);
            const size = image.getSize(),
              bytes = image.toBitmap();
            // Sample a 2x2 patch inside the rectangular content bounds but safely
            // outside the dialog's rounded paint. Map native pixels at every DPI.
            const points = [];
            for (const x of [5, 6])
              for (const y of corner === 0 ? [1, 2] : [5, 6]) {
                const px = Math.min(
                  size.width - 1,
                  Math.floor(((x + 0.5) * size.width) / clip.width),
                );
                const py = Math.min(
                  size.height - 1,
                  Math.floor(((y + 0.5) * size.height) / clip.height),
                );
                const offset = (py * size.width + px) * 4;
                points.push([...bytes.subarray(offset, offset + 3)]);
              }
            colors.push(points);
          }
          return colors;
        },
        { windowId, clips },
      );
    const painted = () =>
      page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
      );
    const before = await captureCorners();
    await page.evaluate(() => {
      const probe = { frame: 0, animations: [], ready: false };
      const sample = () => {
        const animations = document
          .getAnimations()
          .filter((animation) => ['screen-enter', 'screen-exit'].includes(animation.animationName));
        if (animations.length === 2) {
          for (const animation of animations) {
            animation.pause();
            animation.currentTime = Number(animation.effect.getTiming().duration) / 2;
          }
          probe.animations = animations;
          probe.ready = true;
        } else probe.frame = requestAnimationFrame(sample);
      };
      probe.frame = requestAnimationFrame(sample);
      window.settingsCornerProbe = probe;
    });
    try {
      await category('AI 服务').click();
      await page.waitForFunction(() => window.settingsCornerProbe.ready);
      await painted();
      const during = await captureCorners();
      const difference = (a, b) => Math.max(...a.map((value, index) => Math.abs(value - b[index])));
      for (const [corner, points] of during.entries())
        assert.ok(
          points.every((point, index) => difference(point, before[corner][index]) <= 6),
          'Settings transition must retain its static right ' +
            (corner ? 'bottom' : 'top') +
            ' rounded pixels: ' +
            JSON.stringify({ before: before[corner], during: points, clip: clips[corner] }),
        );
      // A square-corner negative control proves these native pixels detect the
      // regression instead of sampling an unchanged portion of the background.
      await page.evaluate(() => {
        const marker = document.createElement('style');
        marker.id = 'settings-corner-square-control';
        marker.textContent = '::view-transition-group(screen) { border-radius: 0 !important; }';
        document.head.append(marker);
      });
      await painted();
      const square = await captureCorners();
      for (const [corner, points] of square.entries())
        assert.ok(
          points.some((point, index) => difference(point, before[corner][index]) >= 24),
          'Native corner probe must detect an unrounded transition: ' +
            JSON.stringify({ before: before[corner], square: points }),
        );
    } finally {
      await page.evaluate(() => {
        document.getElementById('settings-corner-square-control')?.remove();
        const probe = window.settingsCornerProbe;
        cancelAnimationFrame(probe.frame);
        for (const animation of probe.animations) animation.play();
        delete window.settingsCornerProbe;
      });
    }
    await page.waitForFunction(() => !document.documentElement.dataset.viewDirection);
    await category('通用').click();
    await settings.getByRole('heading', { name: '通用', exact: true }).waitFor();
    await page.waitForFunction(() => !document.documentElement.dataset.viewDirection);
  };
  const geometry = async () => {
    assert.equal(
      await settings.evaluate((dialog) => {
        const rect = dialog.getBoundingClientRect();
        return (
          rect.left >= 0 &&
          rect.top >= 0 &&
          rect.right <= innerWidth &&
          rect.bottom <= innerHeight &&
          [...dialog.querySelectorAll('.settings-sidebar, .settings-content')].every(
            (element) => element.scrollWidth <= element.clientWidth + 1,
          )
        );
      }),
      true,
      'Settings and document rows must fit the window',
    );
  };
  const noKnowledgeSettings = async () => {
    assert.equal(await category('知识库').count(), 0);
    assert.equal(
      await settings.getByRole('button', { name: '资料使用方式', exact: true }).count(),
      0,
    );
    await geometry();
  };
  const userMenu = page.getByRole('button', { name: '用户菜单', exact: true });
  const userTriggerId = await userMenu.getAttribute('id');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const originalDark = await page.evaluate(() =>
    document.documentElement.classList.contains('dark'),
  );
  for (const dark of [false, true]) {
    await page.evaluate((dark) => document.documentElement.classList.toggle('dark', dark), dark);
    await startMenuFrames(userTriggerId);
    await userMenu.click();
    await page.getByRole('menuitem', { name: '设置', exact: true }).waitFor();
    await finishMenuFrames(userTriggerId);
    const iconBefore = await captureUserMenuIcon('open');
    await startMenuFrames(userTriggerId);
    await page.keyboard.press('Escape');
    try {
      const iconDuring = await captureUserMenuIcon('exit');
      const reference = await captureUserMenuIcon('reference');
      const describe = ({ bytes, ...geometry }) => ({ ...geometry, bitmapBytes: bytes.length });
      const diagnostic = JSON.stringify({
        theme: dark ? 'dark' : 'light',
        before: iconBefore,
        during: describe(iconDuring),
        reference: describe(reference),
      });
      assert.ok(iconDuring.contained && iconDuring.opacity === 1, diagnostic);
      for (const key of ['width', 'height'])
        assert.ok(
          Math.abs(iconBefore.rect[key] - iconDuring.rect[key]) <= 1 / 64,
          `Menu exit icon ${key} changed by ${iconDuring.rect[key] - iconBefore.rect[key]} CSS px: ${diagnostic}`,
        );
      for (const key of Object.keys(iconDuring.rect))
        assert.ok(
          Math.abs(reference.rect[key] - iconDuring.rect[key]) <= 1 / 64,
          `The reference must share the exit icon's ${key}: ${diagnostic}`,
        );
      assert.equal(iconDuring.dpr, reference.dpr, diagnostic);
      assert.deepEqual(iconDuring.clip, reference.clip, diagnostic);
      assert.deepEqual(iconDuring.size, reference.size, diagnostic);
      assert.deepEqual(iconDuring.scaleFactors, reference.scaleFactors, diagnostic);
      assert.equal(
        iconDuring.bytes.length,
        iconDuring.size.width * iconDuring.size.height * 4,
        diagnostic,
      );
      assert.equal(reference.bytes.length, iconDuring.bytes.length, diagnostic);
      const contrast = Math.max(
        ...[0, 1, 2].map((channel) => {
          const values = reference.bytes.filter((_, index) => index % 4 === channel);
          return Math.max(...values) - Math.min(...values);
        }),
      );
      assert.ok(
        contrast > 20,
        'The live SVG supplies a visible reference silhouette: ' + diagnostic,
      );
      const difference = Math.max(
        ...iconDuring.bytes.map((value, index) => Math.abs(value - reference.bytes[index])),
      );
      assert.ok(
        difference <= 2,
        `Menu exit preserves its icon silhouette (${dark ? 'dark' : 'light'}): ${difference}. ${diagnostic}`,
      );
    } finally {
      await page.evaluate(() => {
        window.settingsRestoreMenuIcon?.();
        for (const animation of window.settingsIconExitAnimations ?? []) animation.play();
        delete window.settingsMenuIconReference;
        delete window.settingsRestoreMenuIcon;
        delete window.settingsIconExitAnimations;
      });
    }
    await page.waitForFunction(
      () => document.activeElement?.getAttribute('aria-label') === '用户菜单',
    );
    assert.equal(
      await userMenu.evaluate((node) => Boolean(node.closest('[aria-hidden="true"]'))),
      false,
      'Closing a portaled menu releases accessibility before the visual snapshot finishes',
    );
    const portalFrames = await finishMenuFrames(userTriggerId);
    const portalExit = portalFrames.filter((frame) => frame.state === 'closed');
    assert.ok(
      portalExit.some((frame) => frame.revealed > 0.03 && frame.revealed < 0.97),
      'Portaled dropdown must visibly fold back toward its trigger after Radix unmounts',
    );
    assert.ok(
      portalExit.length > 0 &&
        portalExit.every(
          (frame) =>
            frame.snapshot &&
            frame.inert &&
            frame.ariaHidden === 'true' &&
            frame.roles === 0 &&
            frame.identities === 0 &&
            frame.brokenMasks === 0 &&
            !frame.duplicateIds &&
            (process.platform !== 'darwin' || frame.masks > 0) &&
            frame.opacity >= 0 &&
            frame.opacity <= 1 &&
            (frame.revealed <= 0.12 || frame.opacity === 1) &&
            frame.unscaled &&
            frame.clip === 'none' &&
            frame.radius > 0 &&
            frame.overflow === 'hidden' &&
            frame.frameOverflow === 'visible' &&
            frame.shadow !== 'none' &&
            (frame.revealed <= 0.03 || Math.abs(frame.anchorGap) < 0.6),
        ),
      'Portaled exit snapshot must have no menu roles or interactive accessibility',
    );
    assert.ok(
      portalExit.some((frame) => frame.opacity > 0 && frame.opacity < 1 && frame.revealed < 0.12),
      'Portaled exit fades only near its collapsed rounded edge',
    );
  }
  await page.evaluate(
    (dark) => document.documentElement.classList.toggle('dark', dark),
    originalDark,
  );
  await open();
  await category('通用').click();
  assert.deepEqual(
    await settings
      .getByRole('navigation', { name: '设置分类' })
      .getByRole('button')
      .allTextContents(),
    ['VoxCue 账号', 'AI 服务', '本地组件', '面试设置', '通用', '关于与更新'],
  );
  await category('VoxCue 账号').click();
  await settings.getByRole('region', { name: '云同步', exact: true }).waitFor();
  await settings.getByRole('button', { name: '立即同步', exact: true }).waitFor();
  await settings.getByRole('button', { name: '刷新容量', exact: true }).waitFor();
  await settings.getByRole('button', { name: '删除账号', exact: true }).waitFor();
  await geometry();
  await category('通用').click();
  await settings.getByRole('heading', { name: '通用', exact: true }).waitFor();
  assert.equal(await settings.getByRole('button', { name: '主题色', exact: true }).count(), 0);
  const languageMenu = settings.getByRole('button', { name: '语言', exact: true });
  const personalInfoBefore = await page.evaluate(() =>
    localStorage.getItem('copilot-personal-info-v1'),
  );
  assert.equal(await languageMenu.innerText(), '简体中文');
  const languageTriggerId = await languageMenu.getAttribute('id');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await startMenuFrames(languageTriggerId);
  await languageMenu.focus();
  await page.keyboard.press('Enter');
  assert.deepEqual(await settings.getByRole('menuitemradio').allTextContents(), [
    '简体中文',
    'English',
  ]);
  const openingFrames = await finishMenuFrames(languageTriggerId);
  assert.ok(
    openingFrames.some(
      (frame) => frame.state === 'open' && frame.revealed > 0.03 && frame.revealed < 0.97,
    ),
    'Dropdown opening must grow its actual rounded surface through intermediate heights',
  );
  assert.ok(
    openingFrames
      .filter((frame) => frame.state === 'open')
      .every(
        (frame) =>
          !frame.inert &&
          frame.ariaHidden !== 'true' &&
          frame.opacity >= 0 &&
          frame.opacity <= 1 &&
          (frame.revealed <= 0.65 || frame.opacity === 1) &&
          frame.unscaled &&
          frame.clip === 'none' &&
          frame.radius > 0 &&
          frame.overflow === 'hidden' &&
          frame.frameOverflow === 'visible' &&
          frame.shadow !== 'none' &&
          (frame.revealed <= 0.03 || Math.abs(frame.anchorGap) < 0.6),
      ),
    'Open dropdown keeps its main height range opaque, unscaled and anchored with options accessible',
  );
  assert.ok(
    openingFrames.some((frame) => frame.opacity > 0 && frame.opacity < 1 && frame.revealed < 0.65),
    'Opening fades only at the start of its height expansion',
  );
  assert.equal(
    await settings
      .getByRole('menuitemradio', { name: '简体中文', exact: true })
      .getAttribute('aria-checked'),
    'true',
  );
  await startMenuFrames(languageTriggerId);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '语言');
  assert.equal(await languageMenu.evaluate((node) => node === document.activeElement), true);
  const releasedDuringExit = await settings.evaluate((dialog) => {
    const close = dialog.querySelector('[aria-label="关闭设置"]');
    return {
      accessible: !close.closest('[aria-hidden="true"]'),
      liveMenus: dialog.querySelectorAll('.dropdown-content:not([data-menu-outro])').length,
      animatingSnapshot: [...dialog.querySelectorAll('[data-menu-outro]')].some((node) =>
        node.getAnimations().some((animation) => animation.playState === 'running'),
      ),
    };
  });
  assert.deepEqual(
    releasedDuringExit,
    { accessible: true, liveMenus: 0, animatingSnapshot: true },
    'Parent dialog must regain accessibility and release the live menu before its visual exit finishes',
  );
  const closingFrames = await finishMenuFrames(languageTriggerId);
  const exiting = closingFrames.filter((frame) => frame.state === 'closed');
  assert.ok(
    exiting.some((frame) => frame.revealed > 0.03 && frame.revealed < 0.97),
    'Dropdown closing must shrink its actual rounded surface through intermediate heights',
  );
  assert.ok(
    exiting.length > 0 &&
      exiting.every(
        (frame) =>
          frame.snapshot &&
          frame.inert &&
          frame.ariaHidden === 'true' &&
          frame.roles === 0 &&
          frame.opacity >= 0 &&
          frame.opacity <= 1 &&
          (frame.revealed <= 0.12 || frame.opacity === 1) &&
          frame.unscaled &&
          frame.clip === 'none' &&
          frame.radius > 0 &&
          frame.overflow === 'hidden' &&
          frame.frameOverflow === 'visible' &&
          frame.shadow !== 'none' &&
          (frame.revealed <= 0.03 || Math.abs(frame.anchorGap) < 0.6),
      ),
    'Only an inert accessibility-hidden snapshot remains throughout the visual exit',
  );
  assert.ok(
    exiting.some((frame) => frame.opacity > 0 && frame.opacity < 1 && frame.revealed < 0.12),
    'Closing fades only near its collapsed rounded edge',
  );
  await languageMenu.click();
  await settings.getByRole('menuitemradio', { name: '简体中文', exact: true }).waitFor();
  await page.keyboard.press('Escape');
  assert.equal(await settings.locator('[data-menu-outro]').count(), 1);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForFunction(() => !document.querySelector('[data-menu-outro]'));
  try {
    await startMenuFrames(languageTriggerId);
    await languageMenu.click();
    await settings.getByRole('menuitemradio', { name: '简体中文', exact: true }).waitFor();
    const reducedOpen = await finishMenuFrames(languageTriggerId);
    assert.ok(
      reducedOpen.length > 0 &&
        reducedOpen.every(
          (frame) =>
            frame.opacity === 1 && frame.unscaled && frame.revealed === 1 && !frame.animating,
        ),
      'Reduced motion opens the dropdown directly without animation',
    );
    await startMenuFrames(languageTriggerId);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '语言');
    const reducedClose = await finishMenuFrames(languageTriggerId);
    assert.ok(
      reducedClose.every(
        (frame) => !frame.animating && frame.opacity === 1 && frame.revealed === 1,
      ),
      'Reduced motion closes the dropdown without intermediate animation',
    );
    assert.equal(
      await page.evaluate(
        (triggerId) =>
          [...document.querySelectorAll('.dropdown-content')].some(
            (node) => node.getAttribute('aria-labelledby') === triggerId,
          ),
        languageTriggerId,
      ),
      false,
      'Reduced motion removes the closed dropdown directly',
    );
    assert.equal(await languageMenu.evaluate((node) => node === document.activeElement), true);
  } finally {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
  }
  // Selecting an unchanged option closes only the live menu. A second real
  // Escape must reach the parent dialog while the inert snapshot still folds away.
  await languageMenu.click();
  await settings.getByRole('menuitemradio', { name: '简体中文', exact: true }).click();
  await settings.getByRole('button', { name: '关闭设置', exact: true }).waitFor();
  assert.ok(
    await settings.evaluate((dialog) =>
      [...dialog.querySelectorAll('[data-menu-outro]')].some(
        (node) =>
          node.inert &&
          node.getAttribute('aria-hidden') === 'true' &&
          node.getAnimations().some((animation) => animation.playState === 'running'),
      ),
    ),
    'Option selection must release accessibility while its snapshot is still animating',
  );
  await page.keyboard.press('Escape');
  await settings.waitFor({ state: 'detached' });
  await open();
  await languageMenu.click();
  await settings.getByRole('menuitemradio', { name: 'English', exact: true }).click();
  const englishSettings = page.getByRole('dialog', { name: 'Settings', exact: true });
  const englishLanguage = englishSettings.getByRole('button', { name: 'Language', exact: true });
  assert.equal(await englishLanguage.innerText(), 'English');
  assert.equal(await page.evaluate(() => localStorage.getItem('voxcue-language-v1')), 'en');
  await englishSettings.getByRole('heading', { name: 'General', exact: true }).waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.lang), 'en');
  await englishLanguage.click();
  await englishSettings.getByRole('menuitemradio', { name: '简体中文', exact: true }).click();
  assert.equal(
    await page.evaluate(() => localStorage.getItem('copilot-personal-info-v1')),
    personalInfoBefore,
    'UI language preference must not change interview language or personal information',
  );
  await settings.getByRole('button', { name: '关闭设置', exact: true }).click();
  await open();
  assert.equal(await languageMenu.innerText(), '简体中文');
  const themeMenu = settings.getByRole('button', { name: '外观主题', exact: true });
  for (let attempt = 0; attempt < 3; attempt++) {
    await themeMenu.dispatchEvent('keydown', { key: 'Enter', code: 'Enter' });
    assert.equal(await page.getByRole('menu').count(), 1);
    assert.equal(await settings.locator('[aria-haspopup="menu"][aria-expanded="true"]').count(), 1);
    await page.keyboard.press('Escape');
    await page.waitForFunction(
      () => document.activeElement?.getAttribute('aria-label') === '外观主题',
    );
    assert.equal(await page.getByRole('menu').count(), 0);
    assert.equal(await settings.isVisible(), true);
  }
  assert.equal(
    await settings
      .getByRole('button', { name: /调整聊天模型|调整聊天思考强度|调整回答风格/ })
      .count(),
    0,
  );
  assert.equal(await settings.getByText(/聊天偏好用于后续准备聊天/).count(), 0);
  const systemColor = async (color) =>
    app.evaluate(({ BrowserWindow }, value) => {
      for (const win of BrowserWindow.getAllWindows())
        win.webContents.send('appearance:accent-changed', value);
    }, color);
  await systemColor('#0078d4');
  await page.waitForFunction(
    () => document.documentElement.style.getPropertyValue('--system-accent') === '#0078d4',
  );
  await page.evaluate(() => localStorage.setItem('copilot-accent-color-v1', '#008c95'));
  await systemColor('#8764b8');
  await page.waitForFunction(
    () => document.documentElement.style.getPropertyValue('--system-accent') === '#8764b8',
  );
  await page.getByRole('button', { name: '外观主题', exact: true }).click();
  await page.keyboard.press('Escape');
  assert.equal(
    await settings.isVisible(),
    true,
    'Escape closes theme menu before the settings dialog',
  );
  await page.getByRole('button', { name: '外观主题', exact: true }).click();
  await page.getByRole('menuitemradio', { name: '浅色', exact: true }).click();
  await geometry();
  await noKnowledgeSettings();
  await verifyCategoryCorners();
  await category('通用').click();
  await page.screenshot({ animations: 'disabled' });
  await category('AI 服务').click();
  await settings.getByRole('heading', { name: 'AI 服务', exact: true }).waitFor();
  await settings.getByRole('region', { name: '账户额度' }).waitFor();
  assert.equal(await settings.getByRole('button', { name: '重置用量', exact: true }).count(), 0);
  await page.screenshot({ animations: 'disabled' });
  await category('关于与更新').click();
  await settings.getByText('VoxCue', { exact: true }).waitFor();
  await category('通用').click();
  await page.getByRole('button', { name: '外观主题', exact: true }).click();
  await page.getByRole('menuitemradio', { name: '深色', exact: true }).click();
  await noKnowledgeSettings();
  await category('面试设置').click();
  await settings.getByRole('heading', { name: '面试设置', exact: true }).waitFor();
  await page.screenshot({ animations: 'disabled' });
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows().find((window) => !window.isDestroyed());
    window.setMinimumSize(500, 500);
    window.setSize(600, 600);
  });
  await page.waitForFunction(() => innerWidth <= 620);
  await geometry();
  await noKnowledgeSettings();
  await page.screenshot({ animations: 'disabled' });
  await page.getByRole('button', { name: '关闭设置', exact: true }).click();
  await page.reload();
  await open();
  assert.equal(await languageMenu.innerText(), '简体中文');
  await languageMenu.click();
  assert.equal(
    await settings
      .getByRole('menuitemradio', { name: '简体中文', exact: true })
      .getAttribute('aria-checked'),
    'true',
  );
  await settings.getByRole('menuitemradio', { name: '简体中文', exact: true }).click();
  assert.equal(await languageMenu.innerText(), '简体中文');
  assert.equal(await page.evaluate(() => localStorage.getItem('voxcue-language-v1')), 'zh-CN');
  assert.equal(
    await page.locator('html').evaluate((element) => element.classList.contains('dark')),
    true,
  );
  assert.equal(await settings.getByRole('button', { name: '主题色', exact: true }).count(), 0);
  assert.equal(
    await page.evaluate(() => localStorage.getItem('copilot-accent-color-v1')),
    '#008c95',
  );
  await systemColor('#c74a85');
  await page.waitForFunction(
    () => document.documentElement.style.getPropertyValue('--system-accent') === '#c74a85',
  );
  await page.getByRole('button', { name: '外观主题', exact: true }).click();
  await page.getByRole('menuitemradio', { name: '跟随系统', exact: true }).click();
  await page.emulateMedia({ colorScheme: 'light' });
  await page.waitForFunction(() => !document.documentElement.classList.contains('dark'));
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.waitForFunction(() => document.documentElement.classList.contains('dark'));
  await page.keyboard.press('Escape');
  await settings.waitFor({ state: 'detached' });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1280, 800));
  assert.deepEqual(errors, []);
  console.log(
    'Settings categories, language switching, keyboard, themes, persistence and responsive layout passed',
  );
} finally {
  await closeUiApp(app);
}
