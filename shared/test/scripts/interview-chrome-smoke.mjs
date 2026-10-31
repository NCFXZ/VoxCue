import { connectUiAccount } from './install-ui-account.mjs';
import assert from 'node:assert/strict';
import path from 'node:path';
import { testRoot, electron } from './test-workspace.mjs';
import { offlineElectronEntry } from './offline-electron-entry.mjs';
import { installUiAccount, closeUiApp } from './install-ui-account.mjs';
import { captureRequested } from './capture-requested.mjs';
import { verifyRoundCapFrames } from './continuous-corners.mjs';

const app = await electron.launch({
  args: [await offlineElectronEntry()],
  env: {
    ...process.env,
    COPILOT_TEST_USER_DATA: path.join(testRoot, 'interview-chrome'),
    VITE_DEV_SERVER_URL: '',
  },
});
const errors = [];
const material = (locator, pseudo = null) =>
  locator.evaluate((node, pseudo) => {
    const style = getComputedStyle(node, pseudo);
    return { fill: style.backgroundColor, filter: style.backdropFilter };
  }, pseudo);
const click = (locator) => locator.evaluate((node) => node.click());
const settle = (page) =>
  page.waitForFunction(() =>
    document
      .getAnimations()
      .every(
        (animation) =>
          animation.effect?.getTiming().iterations === Infinity ||
          animation.playState !== 'running',
      ),
  );
try {
  await installUiAccount(app, { speech: true, components: true });
  await app.evaluate(({ app }) => {
    const require = process
      .getBuiltinModule('module')
      .createRequire(app.getAppPath() + '/package.json');
    const { ChatGPTService } = require(
      app.getAppPath() + '/dist-electron/shared/electron/backend/chat/service.js',
    );
    ChatGPTService.prototype.stream = async (request, emit) => {
      const answerText = request.id.startsWith('history-title-')
        ? '合成材质检查'
        : Array.from(
            { length: 30 },
            (_, i) =>
              `第 ${i + 1} 段合成回答。检验正文在固定标题和输入框后滚动，最后一段能够完整阅读。`,
          ).join('\n\n') + '\n\n结尾标记';
      emit({ id: request.id, type: 'delta', text: answerText });
      return { answerText, usage: null, sources: [] };
    };
  });
  const login = await app.firstWindow();
  const next = app.waitForEvent('window');
  await connectUiAccount(app, login);
  const main = await next;
  await main.emulateMedia({ colorScheme: 'dark' });
  await main.waitForFunction(() => document.documentElement.classList.contains('dark'));
  await main.locator('.chat-composer .composer').waitFor();
  await main.getByRole('textbox', { name: '聊天消息', exact: true }).fill('合成发送按钮状态');
  await settle(main);
  const chatHeader = await material(main.locator('.page-toolbar'), '::before');
  const chatComposer = await material(main.locator('.chat-composer .composer'));
  const followStyle = (locator) =>
    locator.evaluate((node) => {
      const s = getComputedStyle(node);
      return {
        fill: s.backgroundColor,
        filter: s.backdropFilter,
        shadow: s.boxShadow,
        border: s.border,
        radius: s.borderRadius,
      };
    });
  const chatFollow = await followStyle(main.locator('.chat-composer > .follow-latest'));

  const chatShape = await main.locator('.chat-composer .composer').evaluate((e) => ({
    radius: getComputedStyle(e).borderRadius,
    corner: getComputedStyle(e).cornerShape,
  }));
  const chatSend = await main
    .getByRole('button', { name: '发送消息', exact: true })
    .evaluate((e) => ({
      width: e.getBoundingClientRect().width,
      height: e.getBoundingClientRect().height,
      fill: getComputedStyle(e).backgroundColor,
      opacity: getComputedStyle(e).opacity,
    }));
  await main.getByRole('button', { name: '开始面试', exact: true }).waitFor();
  await click(main.getByRole('button', { name: '开始面试', exact: true }));
  const opening = app.waitForEvent('window');
  await click(main.getByRole('button', { name: '确认开始', exact: true }));
  const floating = await opening;
  floating.setDefaultTimeout(15000);
  floating.on('pageerror', (e) => errors.push(e.message));
  await floating.locator('.floating-answer .floating-composer').waitFor();
  await floating.getByRole('textbox', { name: '面试提问', exact: true }).fill('合成发送按钮状态');
  await settle(floating);
  await floating.waitForFunction(
    () =>
      parseFloat(
        document
          .querySelector('.floating-answer')
          .style.getPropertyValue('--floating-composer-height'),
      ) > 0,
  );
  const editor = floating.getByRole('textbox', { name: '面试提问', exact: true });
  const compact = await floating.locator('.floating-composer').boundingBox();
  assert.ok(compact.height < 100, 'One-line interview composer stays compact');
  assert.ok(
    await editor.evaluate(
      (node) => node.clientHeight <= parseFloat(getComputedStyle(node).lineHeight) + 1,
    ),
  );
  await captureRequested(floating, 'interview-compact-composer');
  const panelChrome = await material(floating.locator('.floating-composer'));
  for (const heading of await floating.locator('.floating-panel > header').all())
    assert.deepEqual(await material(heading), { fill: 'rgba(0, 0, 0, 0)', filter: 'none' });
  assert.equal(panelChrome.filter, chatComposer.filter);
  for (const heading of await floating.locator('.floating-panel > header').all())
    assert.equal(await heading.evaluate((e) => getComputedStyle(e, '::before').content), 'none');

  assert.deepEqual(
    await floating.locator('.floating-composer').evaluate((e) => ({
      radius: getComputedStyle(e).borderRadius,
      corner: getComputedStyle(e).cornerShape,
    })),
    chatShape,
  );
  assert.deepEqual(
    await floating.getByRole('button', { name: '发送面试问题', exact: true }).evaluate((e) => ({
      width: e.getBoundingClientRect().width,
      height: e.getBoundingClientRect().height,
      fill: getComputedStyle(e).backgroundColor,
      opacity: getComputedStyle(e).opacity,
    })),
    chatSend,
  );
  await click(floating.getByRole('button', { name: '关闭截图保护', exact: true }));
  await floating.locator('.floating-capture-notice').waitFor();
  assert.equal(
    (await material(floating.locator('.floating-capture-notice'))).filter,
    chatComposer.filter,
  );
  await floating.getByRole('textbox', { name: '面试提问', exact: true }).fill('合成滚动验证');
  await click(floating.getByRole('button', { name: '发送面试问题', exact: true }));
  await floating.locator('.answer-bubble').getByText('结尾标记', { exact: true }).waitFor();
  const wasDark = await floating.evaluate(() =>
    document.documentElement.classList.contains('dark'),
  );
  for (const dark of [false, true]) {
    await floating.evaluate(
      (value) => document.documentElement.classList.toggle('dark', value),
      dark,
    );
    const toolbarMaterial = await material(floating.locator('.floating-toolbar'));
    const bubbleMaterial = await material(floating.locator('.answer-bubble'));
    assert.deepEqual(toolbarMaterial, bubbleMaterial, 'Capsule and bubbles share one material');
    assert.equal(
      await floating
        .locator('.floating-toolbar')
        .evaluate((node) => getComputedStyle(node).backgroundImage),
      'none',
    );
    assert.equal(toolbarMaterial.filter, chatComposer.filter);
    const notice = floating.locator('.floating-capture-notice');
    const noticeLayers = await notice.evaluate((node) => {
      const resolve = (value) => {
        const probe = document.createElement('span');
        probe.style.backgroundColor = value;
        node.append(probe);
        const color = getComputedStyle(probe).backgroundColor;
        probe.remove();
        return color;
      };
      return {
        fill: resolve('rgb(var(--frosted-panel-tint) / var(--interview-chrome-panel-opacity))'),
        overlay: resolve('var(--web-material-fill)'),
        image: getComputedStyle(node).backgroundImage,
      };
    });
    assert.equal((await material(notice)).fill, noticeLayers.fill);
    assert.equal(
      noticeLayers.image,
      `linear-gradient(${noticeLayers.overlay}, ${noticeLayers.overlay}), none`,
    );
    assert.equal(
      await notice.evaluate((node) => getComputedStyle(node).borderTopColor),
      'rgba(0, 0, 0, 0)',
    );
    const composerMaterial = await material(floating.locator('.floating-composer'));
    assert.equal(composerMaterial.filter, chatComposer.filter);
    const expected = await floating.locator('.answer-bubble').evaluate((node, dark) => {
      const probe = document.createElement('span');
      probe.style.backgroundColor = `color-mix(in srgb, var(--surface) ${dark ? 81.2 : 76.4}%, transparent)`;
      node.append(probe);
      const color = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return color;
    }, dark);
    assert.equal(bubbleMaterial.fill, expected, 'Both platforms use the shared 35% bubble curve');
    assert.notEqual(composerMaterial.fill, bubbleMaterial.fill);
  }
  await floating.evaluate(
    (value) => document.documentElement.classList.toggle('dark', value),
    wasDark,
  );
  // The scroller is a focusable labelled div rather than an ARIA region.
  const answerScroll = floating.locator('.floating-answer > .floating-scroll');
  await answerScroll.evaluate((e) => {
    e.scrollTop = e.scrollHeight;
  });
  await floating.waitForFunction(() => {
    const last = document
      .querySelector('.answer-bubble .markdown-content > :last-child')
      .getBoundingClientRect();
    const composer = document.querySelector('.floating-composer').getBoundingClientRect();
    return last.bottom <= composer.top - 36 && last.top > 0;
  });
  const geometry = await floating.locator('.floating-answer').evaluate((e) => {
    const box = e.getBoundingClientRect(),
      scroll = e.querySelector('.floating-scroll');
    return {
      panelBottom: box.bottom,
      scrollBottom: scroll.getBoundingClientRect().bottom,
      mask: getComputedStyle(scroll).maskImage,
    };
  });
  assert.ok(Math.abs(geometry.panelBottom - geometry.scrollBottom) <= 1);
  assert.ok(
    geometry.mask.includes('linear-gradient'),
    'Scroll content fades at the top and bottom edges',
  );

  await answerScroll.evaluate((scroll) => {
    scroll.scrollTop = 0;
    const first = scroll.firstElementChild.getBoundingClientRect();
    const header = scroll.parentElement.querySelector(':scope > header').getBoundingClientRect();
    scroll.scrollTop = first.top - header.bottom + 12;
  });
  assert.deepEqual(await material(floating.locator('.floating-answer > header')), {
    fill: 'rgba(0, 0, 0, 0)',
    filter: 'none',
  });
  await captureRequested(floating, 'interview-header-partial-overlap');
  await answerScroll.evaluate((e) => {
    e.scrollTop = 100;
  });
  assert.deepEqual(await material(floating.locator('.floating-answer > header')), {
    fill: 'rgba(0, 0, 0, 0)',
    filter: 'none',
  });
  assert.deepEqual(
    await material(floating.locator('.floating-answer > .follow-latest')),
    chatComposer,
  );
  assert.deepEqual(
    await followStyle(floating.locator('.floating-answer > .follow-latest')),
    chatFollow,
  );
  await captureRequested(floating, 'interview-shared-chrome');
  // Compare rendered pixels with/without blur over synthetic checkerboards.
  // Matching CSS strings alone cannot detect a nested backdrop root or a cutout.
  const controls = [
    floating.locator('.floating-answer > header'),
    floating.locator('.floating-answer > .follow-latest'),
    floating.locator('.floating-composer'),
  ];
  const heading = controls[0];
  await floating.locator('.floating-answer').evaluate((panel) => {
    const scroll = panel.querySelector('.floating-scroll'),
      origin = scroll.getBoundingClientRect();
    for (const control of panel.querySelectorAll(
      ':scope > header, :scope > .follow-latest, .floating-composer',
    )) {
      const rect = control.getBoundingClientRect(),
        marker = document.createElement('span');
      marker.dataset.chromeSentinel = 'true';
      const height = control.matches('header') ? 160 : 60;
      marker.style.cssText = `position:absolute;left:${rect.x + rect.width / 2 - origin.x - 30}px;top:${rect.y + rect.height / 2 - origin.y + scroll.scrollTop - height / 2}px;width:60px;height:${height}px;background:repeating-conic-gradient(white 0% 25%,black 0% 50%) 0 0/8px 8px;`;
      scroll.append(marker);
    }
  });
  const captureControl = async (index, offsetY = 0) => {
    const box = await controls[index].boundingBox();
    return floating.screenshot({
      animations: 'disabled',
      clip: {
        x: box.x + box.width / 2 - 12,
        y: box.y + box.height / 2 - 12 + offsetY,
        width: 24,
        height: 24,
      },
    });
  };
  const edgeEnergy = (buffer) =>
    app.evaluate(({ nativeImage }, png) => {
      const image = nativeImage.createFromBuffer(Buffer.from(png, 'base64'));
      const { width, height } = image.getSize();
      const pixels = image.toBitmap();
      let sum = 0;
      for (let y = 0; y < height - 1; y++)
        for (let x = 0; x < width - 1; x++) {
          const at = (y * width + x) * 4;
          for (let c = 0; c < 3; c++)
            sum +=
              Math.abs(pixels[at + c] - pixels[at + 4 + c]) +
              Math.abs(pixels[at + c] - pixels[at + width * 4 + c]);
        }
      return sum / ((width - 1) * (height - 1) * 6);
    }, buffer.toString('base64'));
  const blurred = [];
  const solidBackdrop = await floating.addStyleTag({
    content: '.floating-answer { background: #30434a !important; }',
  });
  for (let i = 0; i < controls.length; i++) blurred.push(await captureControl(i));
  const rampOffset = (await controls[0].boundingBox()).height / 2 + 18;
  const fadedRamp = await captureControl(0, rampOffset);
  const noWebBlur = await floating.addStyleTag({
    content:
      '.floating-composer, .floating-answer > .follow-latest { backdrop-filter: none !important; }',
  });
  for (let i = 1; i < controls.length; i++) {
    const sharp = await captureControl(i);
    const before = await edgeEnergy(sharp),
      after = await edgeEnergy(blurred[i]);
    assert.ok(
      before > 2 && after < before * 0.65,
      `Control ${i} must suppress checkerboard edges, not merely tint them: ${after}/${before}`,
    );
  }
  await noWebBlur.evaluate((e) => e.remove());
  const noMask = await floating.addStyleTag({
    content: '.floating-answer > .floating-scroll { mask-image: none !important; }',
  });
  const unmaskedEnergy = await edgeEnergy(await captureControl(0));
  const fadedEnergy = await edgeEnergy(blurred[0]);
  assert.ok(
    unmaskedEnergy > 2 && fadedEnergy < unmaskedEnergy * 0.15,
    `Header content must fade out without a backplate: ${fadedEnergy}/${unmaskedEnergy}`,
  );
  const fullRampEnergy = await edgeEnergy(await captureControl(0, rampOffset));
  const rampEnergy = await edgeEnergy(fadedRamp);
  assert.ok(
    fullRampEnergy > 2 && rampEnergy > fullRampEnergy * 0.2 && rampEnergy < fullRampEnergy * 0.8,
    `Content 18px below header must be midway through the 36px fade: ${rampEnergy}/${fullRampEnergy}`,
  );
  await noMask.evaluate((e) => e.remove());
  await solidBackdrop.evaluate((e) => e.remove());
  await captureRequested(floating, 'interview-chrome-checkerboard');
  await floating
    .locator('[data-chrome-sentinel]')
    .evaluateAll((nodes) => nodes.forEach((node) => node.remove()));
  // A composer resize must update bottom clearance without moving a reader who scrolled up.
  const before = await answerScroll.evaluate((e) => e.scrollTop);
  for (const rows of [1, 2, 3, 4, 5, 6, 5, 2, 1]) {
    await editor.fill(Array.from({ length: rows }, () => '逐行面试输入').join('\n'));
    const size = await editor.evaluate((node) => ({
      height: node.getBoundingClientRect().height,
      line: parseFloat(getComputedStyle(node).lineHeight),
    }));
    assert.ok(Math.abs(size.height - rows * size.line) <= 1, JSON.stringify({ rows, ...size }));
  }
  await editor.fill('中文组合中的面试草稿');
  await editor.dispatchEvent('compositionstart', { data: '中' });
  await editor.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', isComposing: true });
  assert.equal(await editor.inputValue(), '中文组合中的面试草稿');
  await editor.dispatchEvent('compositionend', { data: '中文' });
  await editor.fill(Array.from({ length: 12 }, (_, i) => '第' + i + '行合成输入').join('\n'));
  await floating.waitForFunction((initial) => {
    const panel = document.querySelector('.floating-answer');
    return parseFloat(panel.style.getPropertyValue('--floating-composer-height')) > initial + 60;
  }, compact.height);
  assert.ok(
    await editor.evaluate(
      (node) =>
        node.scrollHeight > node.clientHeight && getComputedStyle(node).overflowY === 'auto',
    ),
  );
  await captureRequested(floating, 'interview-multiline-composer');
  await editor.fill('');
  await floating.waitForFunction(
    (initial) =>
      Math.abs(
        document.querySelector('.floating-composer').getBoundingClientRect().height - initial,
      ) < 1,
    compact.height,
  );
  assert.equal(await answerScroll.evaluate((e) => e.scrollTop), before);
  await click(floating.getByRole('button', { name: '面试设置', exact: true }));
  const settings = floating.getByRole('dialog', { name: '面试设置', exact: true });
  await settings.locator('.dialog-scroll').evaluate((e) => {
    e.scrollTop = 200;
  });
  await floating.waitForFunction(
    () =>
      document
        .querySelector('.interview-settings-dialog')
        .style.getPropertyValue('--dialog-header-opacity') === '1',
  );
  assert.deepEqual(await material(settings.locator('.dialog-heading'), '::before'), chatHeader);
  await captureRequested(floating, 'interview-settings-shared-header');
  await click(settings.getByRole('button', { name: '关闭对话框', exact: true }));
  const cdp = await floating.context().newCDPSession(floating);
  await cdp.send('DOM.enable');
  await cdp.send('CSS.enable');
  const assertSolidControls = async () => {
    for (const selector of [
      '.floating-toolbar',
      '.floating-composer',
      '.floating-capture-notice',
      '.answer-bubble',
    ]) {
      const reduced = await material(floating.locator(selector));
      assert.equal(reduced.filter, 'none');
      assert.equal(
        reduced.fill,
        await floating.locator(selector).evaluate((e) => {
          const probe = document.createElement('span');
          probe.style.backgroundColor = 'var(--surface)';
          e.append(probe);
          const color = getComputedStyle(probe).backgroundColor;
          probe.remove();
          return color;
        }),
      );
    }
  };
  for (const [name, value] of [
    ['prefers-reduced-transparency', 'reduce'],
    ['prefers-contrast', 'more'],
    ['forced-colors', 'active'],
  ]) {
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name, value }] });
    await assertSolidControls();
    await captureRequested(floating, 'interview-accessibility-' + name);
  }
  await cdp.send('Emulation.setEmulatedMedia', { features: [] });
  await floating.evaluate(() => {
    document.documentElement.dataset.frostedTransparency = '0';
  });
  await assertSolidControls();
  await captureRequested(floating, 'interview-accessibility-zero-transparency');
  await floating.evaluate(() => {
    document.documentElement.dataset.frostedTransparency = '100';
  });
  assert.deepEqual(await material(heading), { fill: 'rgba(0, 0, 0, 0)', filter: 'none' });
  await settle(floating);
  assert.equal(
    await floating.evaluate(
      () =>
        new Promise((resolve) => {
          let writes = 0;
          const observer = new MutationObserver((records) => {
            writes += records.length;
          });
          for (const panel of document.querySelectorAll('.floating-panels .floating-panel'))
            observer.observe(panel, { attributes: true, attributeFilter: ['style'] });
          setTimeout(() => {
            observer.disconnect();
            resolve(writes);
          }, 250);
        }),
    ),
    0,
    'Idle chrome measurement must not keep writing styles',
  );
  for (const collapsed of [false, true]) {
    if (collapsed) {
      await click(floating.locator('.floating-brand'));
      await floating.waitForFunction(() =>
        document.querySelector('.floating-shell').classList.contains('is-collapsed'),
      );
    }
    const { root } = await cdp.send('DOM.getDocument');
    const { nodeId } = await cdp.send('DOM.querySelector', {
      nodeId: root.nodeId,
      selector: '.floating-brand',
    });
    await cdp.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: ['hover'] });
    const { gaps, padding, deviceScale } = await floating
      .locator('.floating-toolbar')
      .evaluate((e) => {
        const toolbar = e.getBoundingClientRect(),
          brand = e.querySelector('.floating-brand').getBoundingClientRect(),
          last = e.querySelector('.floating-drag-handle').getBoundingClientRect();
        return {
          gaps: {
            top: brand.top - toolbar.top,
            bottom: toolbar.bottom - brand.bottom,
            left: brand.left - toolbar.left,
            right: toolbar.right - last.right,
          },
          padding: getComputedStyle(e).padding,
          deviceScale: devicePixelRatio,
        };
      });
    assert.equal(padding, '7px');
    assert.ok(Math.abs(gaps.top - gaps.bottom) < 1 / 64, JSON.stringify(gaps));
    assert.ok(Math.abs(gaps.left - gaps.right) < 1 / 64, JSON.stringify(gaps));
    // Windows quantizes a frameless HWND to physical pixels at fractional DPI.
    const tolerance = process.platform === 'win32' ? Math.max(0.1, 1 / deviceScale) : 0.1;
    assert.ok(
      Math.max(...Object.values(gaps)) - Math.min(...Object.values(gaps)) <= tolerance,
      JSON.stringify(gaps),
    );
    await captureRequested(
      floating,
      collapsed ? 'interview-collapsed-insets' : 'interview-expanded-insets',
    );
    await cdp.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: [] });
  }
  // The end-confirmation timer shrinks a capsule back into its icon button.
  // Sample the real transition, including the frame where button-icon returns.
  const endFrames = await floating.locator('.floating-end').evaluate(async (button) => {
    const frames = [];
    button.click();
    const start = performance.now();
    await new Promise((resolve) => {
      const sample = () => {
        const box = button.getBoundingClientRect();
        frames.push({
          time: performance.now() - start,
          width: box.width,
          height: box.height,
          radius: getComputedStyle(button).borderTopLeftRadius,
          radii: ['TopLeft', 'TopRight', 'BottomRight', 'BottomLeft'].map(
            (corner) => getComputedStyle(button)['border' + corner + 'Radius'],
          ),
          border: getComputedStyle(button).borderTopColor,
          idle: Number(getComputedStyle(button.querySelector('.button-morph-idle')).opacity),
          expanded: Number(
            getComputedStyle(button.querySelector('.button-morph-expanded')).opacity,
          ),
        });
        if (performance.now() - start < 3400) requestAnimationFrame(sample);
        else resolve();
      };
      requestAnimationFrame(sample);
    });
    return frames;
  });
  verifyRoundCapFrames(endFrames);
  assert.ok(endFrames.every((frame) => frame.radius === '999px'));
  assert.ok(endFrames.every((frame) => frame.border === 'rgba(0, 0, 0, 0)'));
  const crossfading = (frame) =>
    frame.idle > 0 && frame.idle < 1 && frame.expanded > 0 && frame.expanded < 1;
  assert.ok(
    endFrames.some((frame) => frame.time < 300 && crossfading(frame)),
    'End action crossfades on expansion',
  );
  assert.ok(
    endFrames.some((frame) => frame.time > 2900 && crossfading(frame)),
    'End action crossfades on timer cancellation',
  );
  assert.equal(endFrames.at(-1).idle, 1);
  assert.equal(endFrames.at(-1).expanded, 0);
  assert.ok(endFrames.some((frame) => frame.width > frame.height + 10));
  assert.equal(endFrames.at(-1).width, endFrames.at(-1).height);
  assert.deepEqual(errors, []);
  console.log(
    'PASS: capsule/bubble material parity, unchanged notices, transparent panel headers, rendered 36px top fade, composer blur, full-height scrolling, final-line clearance, reading position and toolbar insets.',
  );
} finally {
  await closeUiApp(app);
}
