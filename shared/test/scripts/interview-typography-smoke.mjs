import { connectUiAccount } from './install-ui-account.mjs';
import { offlineElectronEntry } from './offline-electron-entry.mjs';
import { testRoot, electron } from './test-workspace.mjs';
import { installUiAccount, closeUiApp, focusUiWindow } from './install-ui-account.mjs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const profile = path.join(testRoot, 'interview-font-profile');
const screenshotDirectory = process.argv.find((arg) => arg.startsWith('--screenshots='))?.slice(14);
if (screenshotDirectory) await mkdir(path.resolve(screenshotDirectory), { recursive: true });
const capture = async (target, name) => {
  if (screenshotDirectory)
    await target.screenshot({
      path: path.join(path.resolve(screenshotDirectory), name + '.png'),
      animations: 'disabled',
      scale: 'css',
    });
};
await mkdir(profile);
const env = { ...process.env, COPILOT_TEST_USER_DATA: profile, VITE_DEV_SERVER_URL: '' };
delete env.ELECTRON_RUN_AS_NODE;
let app = await electron.launch({ args: [await offlineElectronEntry()], env });
const key = 'voxcue-interview-font-size-v1';
const transparencyKey = 'voxcue-interview-background-transparency-v1';
const errors = [];
const materialStyles = (scope) =>
  scope.evaluate((root) =>
    [
      '.floating-toolbar',
      '.floating-panel',
      '.transcript-item > p',
      '.floating-question',
      '.answer-bubble',
      '.floating-composer',
      '.floating-answer',
      '.floating-answer > .floating-chrome-base',
    ].map((selector) => {
      const style = getComputedStyle(
        root.querySelector(selector),
        selector.endsWith('.floating-chrome-base') ? '::after' : null,
      );
      return {
        background: style.backgroundColor,
        image: style.backgroundImage,
        filter: style.backdropFilter,
      };
    }),
  );
const fixedTextStyles = (scope) =>
  scope.evaluate((root) => {
    const bubbles = '.transcript-item > p,.floating-question,.answer-bubble';
    return [...root.querySelectorAll('*')]
      .filter(
        (element) =>
          element instanceof HTMLElement &&
          element.getClientRects().length &&
          !element.closest(bubbles) &&
          (element.matches('input,textarea') ||
            [...element.childNodes].some(
              (node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim(),
            )),
      )
      .map((element) => {
        const path = [];
        for (let current = element; current !== root; current = current.parentElement)
          path.unshift([...current.parentElement.children].indexOf(current));
        return {
          path: path.join('/'),
          font: getComputedStyle(element).fontSize,
          placeholder: element.matches('input,textarea')
            ? getComputedStyle(element, '::placeholder').fontSize
            : undefined,
        };
      });
  });
const matchingFonts = (scope) =>
  scope.evaluate((root) =>
    [
      '.floating-panel h2',
      '.floating-toolbar strong',
      '.transcript-meta',
      '.transcript-item > p',
      '.floating-question',
      '.answer-bubble',
      '.answer-bubble .markdown-content',
      '.floating-composer textarea',
    ].map((selector) => {
      const style = getComputedStyle(root.querySelector(selector));
      return [style.fontSize, style.lineHeight, style.fontFamily, style.fontWeight];
    }),
  );
const paintedSurfaces = async (target, scope) => {
  const points = await scope.evaluate((root) =>
    [
      '.floating-toolbar',
      '.floating-panel',
      '.transcript-item > p',
      '.floating-question',
      '.answer-bubble',
      '.floating-composer',
      '.floating-answer',
    ].map((selector) => {
      const box = root.querySelector(selector).getBoundingClientRect();
      const panel = selector === '.floating-panel' || selector === '.floating-answer';
      return {
        x: Math.round(panel ? box.left + 4 : box.left + box.width / 2),
        y: Math.round(
          panel || selector === '.floating-composer' ? box.top + box.height / 2 : box.top + 8,
        ),
      };
    }),
  );
  const png = await target.screenshot({ animations: 'disabled', scale: 'css' });
  return app.evaluate(
    ({ nativeImage }, { data, points }) => {
      const image = nativeImage.createFromBuffer(Buffer.from(data, 'base64'));
      const { width, height } = image.getSize(),
        pixels = image.toBitmap();
      return points.map(({ x, y }) => {
        if (x < 1 || y < 1 || x >= width - 1 || y >= height - 1)
          throw Error('Surface sample is outside viewport');
        const color = [0, 0, 0, 0];
        for (let row = y - 1; row <= y + 1; row++)
          for (let column = x - 1; column <= x + 1; column++)
            for (let channel = 0; channel < 4; channel++)
              color[channel] += pixels[(row * width + column) * 4 + channel] / 9;
        return color.map(Math.round);
      });
    },
    { data: png.toString('base64'), points },
  );
};
try {
  await installUiAccount(app, { speech: true, components: true });
  await app.evaluate(async ({ app, session }) => {
    // Fixed branding must remain available when a separate image asset fails.
    // Keep this regression offline while denying only that local SVG resource.
    session.defaultSession.webRequest.onBeforeRequest((request, callback) => {
      const url = new URL(request.url);
      callback({
        cancel:
          ['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol) ||
          (url.protocol === 'file:' && /\/chatgpt[^/]*\.svg$/.test(url.pathname)),
      });
    });
    await session.defaultSession.clearCache();
    const require = process
      .getBuiltinModule('module')
      .createRequire(app.getAppPath() + '/package.json');
    const { ChatGPTService } = require(
      app.getAppPath() + '/dist-electron/shared/electron/backend/chat/service.js',
    );
    ChatGPTService.prototype.stream = async (request, emit) => {
      const answerText =
        '先说明目标，再介绍自己的工作和结果。\n\n### 实现要点\n\n保持清晰的接口与可靠的本地存储。';
      emit({ id: request.id, type: 'delta', text: answerText });
      return {
        provider: { id: 'chatgpt', name: 'ChatGPT', dataRecipient: 'OpenAI' },
        answerText,
        usage: null,
        sources: [],
      };
    };
  });
  const login = await app.firstWindow();
  await login.reload();
  const checkBrandImage = async (target, selector) => {
    const image = target.locator(selector).first();
    await image.evaluate(async (image) => image.decode());
    assert.equal(
      await image.evaluate((image) => image.naturalWidth > 0 && image.naturalHeight > 0),
      true,
    );
  };
  await checkBrandImage(login, '.service-brand-icon');
  const page = await connectUiAccount(app, login);
  page.setDefaultTimeout(15000);
  page.on('pageerror', (error) => errors.push(error.message));
  const openSettings = async (target = page) => {
    await target.getByRole('button', { name: '用户菜单', exact: true }).click();
    await target.getByRole('menuitem', { name: '设置', exact: true }).click();
    await target
      .getByRole('navigation', { name: '设置分类' })
      .getByRole('button', { name: '个性化', exact: true })
      .click();
    await target
      .getByRole('dialog', { name: '设置', exact: true })
      .getByRole('button', { name: '面试设置', exact: true })
      .click();
  };
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await openSettings();
  const settings = page.getByRole('region', { name: '面试界面', exact: true });
  const background = settings.getByRole('region', { name: '预览背景，可上下滚动', exact: true });
  await background.scrollIntoViewIfNeeded();
  const hint = await background.evaluate(async (node) => {
    const start = performance.now(),
      samples = [];
    while (performance.now() - start < 2700) {
      await new Promise(requestAnimationFrame);
      samples.push({ time: performance.now() - start, top: node.scrollTop });
    }
    return {
      samples,
      target: node.firstElementChild.clientHeight - node.clientHeight / 2,
    };
  });
  assert.ok(
    hint.samples.filter((sample) => sample.time < 700).every((sample) => sample.top === 0),
    'Preview remains still before its initial delay',
  );
  assert.ok(
    hint.samples.find((sample) => sample.top > 0).time >= 850,
    'Scroll starts after the one-second viewing delay',
  );
  const peak = Math.max(...hint.samples.map((sample) => sample.top));
  assert.ok(Math.abs(peak - hint.target) < 1, 'Downward scroll reaches half photo and half text');
  assert.ok(
    hint.samples.every((sample, index) => !index || sample.top >= hint.samples[index - 1].top),
    'The hint only scrolls downward, with no return stage',
  );
  const nudge = await background.evaluate((node) => node.scrollTop);
  assert.ok(Math.abs(peak - nudge) < 1, 'Remain at the half photo and half text position');
  await capture(settings.locator('.interview-preview-scene'), 'preview-split-background');
  await page.locator('.settings-content-body').evaluate((node) => {
    node.scrollTop = 0;
  });
  await background.scrollIntoViewIfNeeded();
  await page.waitForTimeout(2700);
  assert.equal(
    await background.evaluate((node) => node.scrollTop),
    nudge,
    'Hint runs once per visit',
  );
  const sceneMetrics = await background.evaluate(async (node) => {
    const photo = node.querySelector('.preview-backdrop-photo img');
    await photo.decode();
    const text = node.querySelector('.preview-backdrop-paper');
    return {
      image:
        photo.naturalWidth > 0 &&
        photo.clientHeight >= node.clientHeight &&
        getComputedStyle(photo).objectFit === 'cover',
      onlyText: !text.querySelector('img,svg,canvas') && text.textContent.includes('清澈的湖泊'),
    };
  });
  assert.deepEqual(sceneMetrics, { image: true, onlyText: true });
  const categories = page.getByRole('navigation', { name: '设置分类' });
  const revisit = async () => {
    await categories.getByRole('button', { name: '关于与更新', exact: true }).click();
    await categories.getByRole('button', { name: '面试设置', exact: true }).click();
    await background.scrollIntoViewIfNeeded();
  };
  for (const [when, interaction] of [
    [400, 'wheel'],
    [1200, 'wheel'],
    [1450, 'scrollbar'],
  ]) {
    await revisit();
    await page.waitForTimeout(when);
    const before = await background.evaluate((node) => node.scrollTop);
    if (interaction === 'wheel') {
      await background.hover();
      await page.mouse.wheel(0, 90);
    } else {
      // Native scrollbar changes can arrive without a DOM pointer event.
      await background.evaluate((node) => {
        node.scrollTop += 90;
      });
    }
    await page.waitForTimeout(300);
    const manual = await background.evaluate((node) => node.scrollTop);
    assert.ok(manual > before, `Manual scrolling takes over at ${when}ms`);
    await page.waitForTimeout(Math.max(0, 2700 - when - 300));
    assert.equal(
      await background.evaluate((node) => node.scrollTop),
      manual,
      `No late animation after user interaction at ${when}ms`,
    );
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await revisit();
  await page.waitForTimeout(2700);
  assert.equal(await background.evaluate((node) => node.scrollTop), 0, 'Reduced motion skips hint');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await checkBrandImage(settings, '.provider-avatar img');
  const slider = settings.getByRole('slider', { name: '面试字体大小', exact: true });
  for (const width of [1280, 960]) {
    await app.evaluate(
      ({ BrowserWindow }, width) =>
        BrowserWindow.getAllWindows()
          .find((win) => win.isVisible())
          .setContentSize(width, 800),
      width,
    );
    const storyLayout = await background.evaluate((node) => {
      const copy = node.querySelector('.preview-backdrop-paper .preview-backdrop-copy');
      const text = copy.querySelector('p').getBoundingClientRect();
      const bounds = copy.getBoundingClientRect();
      const placement = (selector) => {
        const story = node.querySelector(selector);
        return (
          story.querySelector('.preview-story-art').getBoundingClientRect().left <
          story.querySelector('.preview-backdrop-copy').getBoundingClientRect().left
        );
      };
      return {
        left: text.left - bounds.left,
        right: bounds.right - text.right,
        textLength: copy.textContent.length,
        darkImageLeft: placement('.preview-backdrop-night'),
        colorImageLeft: placement('.preview-backdrop-color'),
      };
    });
    assert.ok(Math.abs(storyLayout.left - storyLayout.right) < 0.5, JSON.stringify(storyLayout));
    assert.ok(storyLayout.textLength > 350);
    assert.equal(storyLayout.darkImageLeft, true);
    assert.equal(storyLayout.colorImageLeft, false);
    for (const theme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: theme });
      await checkBrandImage(settings, '.provider-avatar img');
      const fixedPreview = await fixedTextStyles(settings);
      for (const size of [24, 12, 14]) {
        await slider.fill(String(size));
        const metrics = await settings.evaluate((section) => ({
          preview: [
            ...section.querySelectorAll(
              '.interview-font-sample,.interview-font-preview .markdown-content',
            ),
          ].map((e) => parseFloat(getComputedStyle(e).fontSize)),
          overflow: [
            ...section.querySelectorAll(
              '.interview-display-controls,.frosted-slider,.interview-preview-scene,.interview-font-preview,.interview-font-preview > section,.interview-preview-shell .floating-composer',
            ),
          ].some((e) => e.scrollWidth > e.clientWidth + 1),
        }));
        assert.ok(
          metrics.preview.every((value) => value === size),
          JSON.stringify(metrics),
        );
        assert.equal(metrics.overflow, false);
        assert.deepEqual(await fixedTextStyles(settings), fixedPreview);
        assert.equal(
          await settings
            .getByRole('textbox', { name: '预览输入框', exact: true })
            .evaluate((element) => getComputedStyle(element).fontSize),
          '14px',
        );
        if (screenshotDirectory && width === 1280 && size === 24) {
          const content = page.locator('.settings-content');
          const top = await content.evaluate((node) => node.scrollTop);
          await capture(
            page.getByRole('dialog', { name: '设置', exact: true }),
            'font-preview-24px-' + theme,
          );
          await settings
            .getByRole('textbox', { name: '预览输入框', exact: true })
            .scrollIntoViewIfNeeded();
          await capture(
            page.getByRole('dialog', { name: '设置', exact: true }),
            'font-preview-input-24px-' + theme,
          );
          await content.evaluate((node, top) => {
            node.scrollTop = top;
          }, top);
        }
      }
    }
  }
  assert.equal(
    await settings.getByRole('slider', { name: '面试背景透明度', exact: true }).count(),
    1,
  );
  assert.equal(
    await page.evaluate(() => document.documentElement.dataset.interviewTransparency),
    '100',
  );
  assert.equal(
    await settings
      .locator('.interview-preview-scene')
      .evaluate((e) => getComputedStyle(e).backgroundImage === 'none'),
    false,
  );
  assert.equal(await settings.locator('.display-slider-icon').count(), 4);
  const transparency = settings.getByRole('slider', { name: '面试背景透明度', exact: true });
  const scrollbar = await background.evaluate((node) => ({
    width: getComputedStyle(node, '::-webkit-scrollbar').width,
    // Chromium snaps borders to whole device pixels at fractional display scaling.
    thumbBorderPixels: Math.round(
      parseFloat(getComputedStyle(node, '::-webkit-scrollbar-thumb').borderLeftWidth) *
        devicePixelRatio,
    ),
    expectedBorderPixels: Math.floor(2 * devicePixelRatio),
    button: getComputedStyle(node, '::-webkit-scrollbar-button').display,
    gutter: node.offsetWidth - node.clientWidth,
  }));
  assert.equal(scrollbar.width, '6px');
  assert.equal(scrollbar.thumbBorderPixels, scrollbar.expectedBorderPixels);
  assert.equal(scrollbar.button, 'none');
  assert.ok(scrollbar.gutter <= 7, JSON.stringify(scrollbar));
  for (const value of [0, 50, 100]) {
    await transparency.fill(String(value));
    assert.equal(await transparency.getAttribute('aria-valuetext'), value + '%');
    const materials = await materialStyles(settings);
    assert.deepEqual(materials[0], materials[4], 'Preview capsule follows bubble material');
    if (value === 0) {
      const opaque = await materialStyles(settings);
      assert.equal(opaque[1].background, 'rgb(29, 35, 39)');
      assert.equal(opaque[2].background, 'color(srgb 0.109804 0.12549 0.137255)');
      assert.equal(opaque[1].filter, 'none');
    }
  }
  await background.scrollIntoViewIfNeeded();
  const shell = await settings.locator('.interview-preview-shell').boundingBox();
  const outerScroll = await page.locator('.settings-content-body').evaluate((e) => e.scrollTop);
  await background.hover();
  await page.mouse.wheel(0, 360);
  await page.waitForFunction(
    () => document.querySelector('.interview-preview-background').scrollTop > 0,
  );
  assert.deepEqual(await settings.locator('.interview-preview-shell').boundingBox(), shell);
  assert.equal(
    await page.locator('.settings-content-body').evaluate((e) => e.scrollTop),
    outerScroll,
  );
  await focusUiWindow(app, page);
  await background.focus();
  await page.keyboard.press('End');
  await page.waitForFunction(() => {
    const node = document.querySelector('.interview-preview-background');
    return node.scrollTop + node.clientHeight >= node.scrollHeight - 1;
  });
  await capture(settings.locator('.interview-preview-scene'), 'preview-color-background');
  await focusUiWindow(app, page);
  await background.focus();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowUp' : 'Home');
  await page
    .waitForFunction(() => document.querySelector('.interview-preview-background').scrollTop === 0)
    .catch(async (error) => {
      console.error(
        'Preview keyboard diagnostic',
        await background.evaluate((node) => ({
          top: node.scrollTop,
          height: node.clientHeight,
          scrollHeight: node.scrollHeight,
          active: document.activeElement?.className,
          focused: document.hasFocus(),
          scale: devicePixelRatio,
        })),
      );
      throw error;
    });
  await capture(settings.locator('.interview-preview-scene'), 'preview-photo-background');
  await background.evaluate((node) => {
    node.scrollTop = node.querySelector('.preview-backdrop-paper').offsetTop;
  });
  await capture(settings.locator('.interview-preview-scene'), 'preview-text-background');
  for (const [selector, name] of [
    ['.preview-backdrop-night', 'preview-story-left'],
    ['.preview-backdrop-color', 'preview-story-right'],
  ]) {
    await background.evaluate((node, selector) => {
      node.scrollTop = node.querySelector(selector).offsetTop;
    }, selector);
    await capture(settings.locator('.interview-preview-scene'), name);
  }
  const thumb = await slider.evaluate((e) => ({
    color: getComputedStyle(e, '::-webkit-slider-thumb').backgroundColor,
    track: parseFloat(
      getComputedStyle(e.closest('.frosted-slider-control').querySelector('.frosted-slider-track'))
        .height,
    ),
  }));
  assert.equal(thumb.track, 6);
  await slider.fill('18');
  await transparency.fill('37');
  await page.getByRole('button', { name: '关闭设置', exact: true }).click();
  await page.reload();
  await openSettings();
  assert.equal(await slider.inputValue(), '18');
  assert.equal(await transparency.inputValue(), '37');
  assert.equal(
    await page.evaluate(() => localStorage.getItem('voxcue-interview-background-transparency-v1')),
    '37',
  );
  await page.evaluate(
    (keys) => {
      const original = Storage.prototype.setItem;
      globalThis.restoreStorage = () => (Storage.prototype.setItem = original);
      Storage.prototype.setItem = function (name, value) {
        if (keys.includes(name)) throw Error('Synthetic storage failure');
        return original.call(this, name, value);
      };
    },
    [key, transparencyKey],
  );
  await slider.fill('19');
  await settings.getByRole('alert').filter({ hasText: '保存失败' }).waitFor();
  assert.equal(await slider.inputValue(), '18');
  await transparency.fill('45');
  assert.equal(await transparency.inputValue(), '37');
  assert.equal(
    await page.evaluate(() => document.documentElement.dataset.interviewTransparency),
    '37',
  );
  await page.evaluate(() => globalThis.restoreStorage());
  await slider.focus();
  await page.keyboard.press('ArrowLeft');
  assert.equal(await slider.inputValue(), '17');
  assert.equal(await settings.getByRole('alert').count(), 0);
  await page.getByRole('button', { name: '关闭设置', exact: true }).click();
  await page.getByRole('button', { name: '开始面试', exact: true }).click();
  const [floating] = await Promise.all([
    app.waitForEvent('window'),
    page
      .getByRole('dialog', { name: '开始面试', exact: true })
      .getByRole('button', { name: '确认开始', exact: true })
      .click(),
  ]);
  floating.setDefaultTimeout(15000);
  floating.on('pageerror', (error) => errors.push(error.message));
  await floating.locator('.transcript-item > p').first().waitFor();
  await floating.locator('.answer-text h3').first().waitFor();
  await checkBrandImage(floating, '.provider-avatar img');
  await floating.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(
      [...document.querySelectorAll('img')].map((image) => image.decode().catch(() => {})),
    );
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
  });
  await floating.waitForFunction(() =>
    document
      .getAnimations()
      .every(
        (animation) =>
          animation.effect?.getTiming().iterations === Infinity ||
          animation.playState !== 'running',
      ),
  );
  const toolbar = await floating.locator('.floating-toolbar').boundingBox();
  const fixedInterview = await fixedTextStyles(floating.locator('body'));
  for (const size of [18, 24, 12, 14]) {
    await page.evaluate(({ key, size }) => localStorage.setItem(key, String(size)), { key, size });
    await floating.waitForFunction(
      (size) =>
        getComputedStyle(document.querySelector('.floating-question')).fontSize === size + 'px',
      size,
    );
    const metrics = await floating.evaluate(() => ({
      text: [
        ...document.querySelectorAll(
          '.transcript-item > p,.floating-question,.answer-bubble,.answer-bubble .markdown-content',
        ),
      ].map((e) => parseFloat(getComputedStyle(e).fontSize)),
      icons: [...document.querySelectorAll('.floating-question > svg')].map((e) => ({
        width: e.getBoundingClientRect().width,
        size: parseFloat(e.style.getPropertyValue('--icon-size')),
      })),
      overflow: [
        ...document.querySelectorAll('.floating-panel,.floating-scroll,.floating-composer'),
      ].some((e) => e.scrollWidth > e.clientWidth + 1),
      heading: parseFloat(getComputedStyle(document.querySelector('.answer-text h3')).fontSize),
    }));
    assert.ok(
      metrics.text.every((value) => value === size),
      JSON.stringify(metrics),
    );
    assert.ok(
      metrics.icons.every((m) => Math.abs(m.width - m.size) < 0.01),
      JSON.stringify(metrics),
    );
    assert.equal(metrics.overflow, false);
    assert.deepEqual(await fixedTextStyles(floating.locator('body')), fixedInterview);
    assert.equal(
      await floating
        .getByRole('textbox', { name: '面试提问', exact: true })
        .evaluate((element) => getComputedStyle(element).fontSize),
      '14px',
    );
    assert.ok(Math.abs(metrics.heading - (size * 15) / 14) < 0.01);
    assert.deepEqual(
      await floating.locator('.floating-toolbar').boundingBox(),
      toolbar,
      JSON.stringify(
        await floating.locator('.floating-toolbar').evaluate((node) =>
          [...node.querySelectorAll('*')].map((item) => ({
            class: item.className,
            width: item.getBoundingClientRect().width,
            font: getComputedStyle(item).font,
            transform: getComputedStyle(item).transform,
          })),
        ),
      ),
    );
    await capture(floating, 'font-actual-' + size + 'px');
  }
  await floating.getByRole('button', { name: '面试设置', exact: true }).click();
  const floatSettings = floating.getByRole('dialog', { name: '面试设置', exact: true });
  await floatSettings.getByRole('slider', { name: '面试字体大小', exact: true }).fill('18');
  assert.equal(
    await floatSettings.getByRole('slider', { name: '面试背景透明度', exact: true }).count(),
    1,
  );
  await (await app.browserWindow(page)).evaluate((win) => win.show());
  await openSettings();
  const floatTransparency = floatSettings.getByRole('slider', {
    name: '面试背景透明度',
    exact: true,
  });
  for (const value of [0, 50, 100, 37]) {
    await floatTransparency.fill(String(value));
    await page.waitForFunction(
      (value) => document.documentElement.dataset.interviewTransparency === String(value),
      value,
    );
    assert.equal(await transparency.inputValue(), String(value));
    assert.deepEqual(
      await materialStyles(settings),
      await materialStyles(floating.locator('.floating-shell')),
    );
    const materials = await materialStyles(floating.locator('.floating-shell'));
    assert.deepEqual(materials[0], materials[4], 'Real capsule follows bubble material');
  }
  await page.emulateMedia({ contrast: 'more' });
  await floating.emulateMedia({ contrast: 'more' });
  assert.deepEqual(
    await materialStyles(settings),
    await materialStyles(floating.locator('.floating-shell')),
  );
  assert.equal((await materialStyles(settings))[1].filter, 'none');
  await page.emulateMedia({ contrast: 'no-preference' });
  await floating.emulateMedia({ contrast: 'no-preference' });
  await page.getByRole('button', { name: '关闭设置', exact: true }).click();
  await page.waitForFunction((key) => localStorage.getItem(key) === '18', key);
  assert.equal(
    await floating.evaluate(() => localStorage.getItem('voxcue-frosted-transparency-v2')),
    null,
  );
  assert.equal(await floatSettings.getByRole('button', { name: '完成', exact: true }).count(), 0);
  await floatSettings.getByRole('button', { name: '关闭对话框', exact: true }).click();
  await openSettings();
  await (await app.browserWindow(page)).evaluate((win) => win.setContentSize(1280, 1000));
  const normalize = `
    .floating-shell, .interview-preview-shell { -webkit-text-fill-color: transparent !important; }
    .floating-shell :is(svg,img), .interview-preview-shell :is(svg,img) { visibility: hidden !important; }
    .floating-panels .floating-answer > .floating-scroll { clip-path: inset(0 0 calc(var(--floating-composer-height) + 8px) 0); }
  `;
  const previewPaint = await page.addStyleTag({
    content:
      normalize +
      '.interview-preview-background { background: #e8edf3; } .interview-preview-background > section { visibility: hidden; }',
  });
  const actualPaint = await floating.addStyleTag({
    content: normalize + 'body { background: #e8edf3 !important; }',
  });
  for (const theme of ['light', 'dark']) {
    await page.evaluate(
      (theme) => document.documentElement.classList.toggle('dark', theme === 'dark'),
      theme,
    );
    for (const value of [0, 37, 50, 100]) {
      await transparency.fill(String(value));
      await floating.waitForFunction(
        (value) => document.documentElement.dataset.interviewTransparency === String(value),
        value,
      );
      for (const size of [12, 14, 18, 24]) {
        await slider.fill(String(size));
        await floating.waitForFunction(
          (size) =>
            getComputedStyle(document.querySelector('.floating-question')).fontSize === `${size}px`,
          size,
        );
        assert.deepEqual(
          await matchingFonts(settings),
          await matchingFonts(floating.locator('.floating-shell')),
          `Font parity: ${theme}/${value}%/${size}px`,
        );
      }
      await background.scrollIntoViewIfNeeded();
      await floating.locator('.floating-scroll').evaluateAll((nodes) =>
        nodes.forEach((node) => {
          node.scrollTop = 0;
        }),
      );
      const previewPixels = await paintedSurfaces(page, settings);
      const actualPixels = await paintedSurfaces(floating, floating.locator('.floating-shell'));
      for (let surface = 0; surface < previewPixels.length; surface++)
        for (let channel = 0; channel < 4; channel++)
          assert.ok(
            Math.abs(previewPixels[surface][channel] - actualPixels[surface][channel]) <= 2,
            `Paint parity ${theme}/${value}% surface ${surface}: ${JSON.stringify({ previewPixels, actualPixels })}`,
          );
    }
  }
  await previewPaint.evaluate((node) => node.remove());
  await actualPaint.evaluate((node) => node.remove());
  await slider.fill('18');
  await transparency.fill('37');
  await page.getByRole('button', { name: '关闭设置', exact: true }).click();
  await floating.keyboard.press('Control+-');
  if (process.platform === 'darwin') {
    await floating.keyboard.press('Meta+-');
    await floating.keyboard.press('Meta+=');
    await floating.keyboard.press('Meta+0');
  }
  assert.equal(
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((w) => w.webContents.getURL().endsWith('#interview'))
        .webContents.getZoomFactor(),
    ),
    1,
  );
  await floating.getByRole('button', { name: '收起面试窗口', exact: true }).click();
  assert.equal(
    await floating.locator('.floating-toolbar').evaluate((e) => e.scrollWidth > e.clientWidth + 1),
    false,
  );
  await floating.getByRole('button', { name: '展开面试窗口', exact: true }).click();
  await floating.getByRole('button', { name: '结束面试', exact: true }).click();
  await Promise.all([
    floating.waitForEvent('close'),
    floating.getByRole('button', { name: '确认结束面试', exact: true }).click(),
  ]);
  await closeUiApp(app);
  app = await electron.launch({ args: [await offlineElectronEntry()], env });
  await installUiAccount(app, { speech: true, components: true });
  const restartedLogin = await app.firstWindow();
  const restarted = await connectUiAccount(app, restartedLogin);
  await openSettings(restarted);
  assert.equal(
    await restarted.getByRole('slider', { name: '面试字体大小', exact: true }).inputValue(),
    '18',
  );
  assert.equal(
    await restarted.evaluate(() => document.documentElement.dataset.interviewTransparency),
    '37',
  );
  assert.deepEqual(errors, []);
  console.log(
    'PASS: one-second scroll delay, downward-only hint, user cancellation before and during animation, reduced motion, one-time hint, font/paint parity, percentage controls, fine scrollbar, keyboard, contrast fallback, persistence and cross-window sync; synthetic account/audio only.',
  );
} finally {
  await closeUiApp(app);
}
