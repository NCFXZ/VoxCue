import { openReasoningControl } from './install-ui-account.mjs';
import { enterDemoUiAccount } from './install-ui-account.mjs';
import { offlineElectronEntry } from './offline-electron-entry.mjs';
import { testRoot, electron } from './test-workspace.mjs';
import { closeUiApp } from './install-ui-account.mjs';
import { captureRequested } from './capture-requested.mjs';
import { dropdownRevealGeometry } from './continuous-corners.mjs';

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const profile = path.resolve(path.join(testRoot, 'test/results'), `composer-profile-${Date.now()}`);
await mkdir(profile, { recursive: true });
const app = await electron.launch({
  args: [await offlineElectronEntry()],
  env: { ...process.env, COPILOT_TEST_USER_DATA: profile, VITE_DEV_SERVER_URL: '' },
});
try {
  const login = await app.firstWindow();
  await login.getByRole('heading', { name: '登录 VoxCue', exact: true }).waitFor();
  await login.waitForFunction(() => document.visibilityState === 'visible');
  const [page] = await Promise.all([app.waitForEvent('window'), enterDemoUiAccount(app, login)]);
  page.setDefaultTimeout(15000);
  const errors = [];
  const send = page.getByRole('button', { name: '发送消息', exact: true });
  await send.waitFor();
  assert.equal(await page.getByRole('button', { name: '语音输入', exact: true }).count(), 0);
  const dimensions = await send.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  });
  assert.equal(dimensions.width, dimensions.height);
  const toolbar = await page.locator('.composer').evaluate((composer) => {
    const style = getComputedStyle(composer),
      outer = composer.getBoundingClientRect();
    const buttons = ['添加附件', '聊天模型', '发送消息'].map((label) =>
      composer.querySelector(`button[aria-label="${label}"]`).getBoundingClientRect(),
    );
    const model = getComputedStyle(composer.querySelector('.effort-model-trigger'));
    const text = composer.querySelector('.effort-model-trigger .model-name');
    const textStyle = getComputedStyle(text);
    const context = document.createElement('canvas').getContext('2d');
    context.font = `${textStyle.fontWeight} ${textStyle.fontSize} ${textStyle.fontFamily}`;
    const ink = context.measureText(text.textContent);
    return {
      heights: buttons.map((rect) => rect.height),
      tops: buttons.map((rect) => rect.top),
      edges: [
        buttons[0].left - outer.left - parseFloat(style.borderLeftWidth),
        outer.right - buttons[2].right - parseFloat(style.borderRightWidth),
        outer.bottom -
          Math.max(...buttons.map((rect) => rect.bottom)) -
          parseFloat(style.borderBottomWidth),
      ],
      padding: [model.paddingTop, model.paddingRight, model.paddingBottom, model.paddingLeft].map(
        parseFloat,
      ),
      inkGutter:
        (buttons[1].height - ink.actualBoundingBoxAscent - ink.actualBoundingBoxDescent) / 2,
    };
  });
  assert.ok(toolbar.heights.every((height) => Math.abs(height - 32) < 1 / 32));
  assert.ok(toolbar.tops.every((top) => Math.abs(top - toolbar.tops[0]) < 1 / 32));
  assert.ok(
    toolbar.edges.every((edge) => Math.abs(edge - 8) < 1 / 32),
    JSON.stringify(toolbar),
  );
  assert.deepEqual(toolbar.padding, [6, 10, 6, 10]);
  assert.ok(Math.abs(toolbar.padding[1] - toolbar.inkGutter) < 2, JSON.stringify(toolbar));
  page.on('pageerror', (error) => errors.push(error.message));
  const startPopupFrames = async () =>
    page.evaluate(() => {
      const frames = [];
      let frame;
      const transform = (node) => {
        const value = getComputedStyle(node).transform;
        return value === 'none' ? new DOMMatrix() : new DOMMatrix(value);
      };
      const sample = () => {
        const popup = document.querySelector('.reasoning-effort-popup');
        const view = popup?.querySelector('.reasoning-popup-view');
        const body = popup?.querySelector('.reasoning-popup-body');
        const thumbNode = popup?.querySelector('.reasoning-slider-thumb');
        const thumb = thumbNode?.getBoundingClientRect();
        const surface = popup?.getBoundingClientRect();
        const wrapper = popup?.parentElement.getBoundingClientRect();
        if (popup && view && body)
          frames.push({
            popupOpacity: Number(getComputedStyle(popup).opacity),
            popupUnscaled:
              Math.abs(transform(popup).m11 - 1) < 0.001 &&
              Math.abs(transform(popup).m22 - 1) < 0.001,
            clip: getComputedStyle(popup).clipPath,
            width: popup.getBoundingClientRect().width,
            height: popup.getBoundingClientRect().height,
            top: surface.top,
            bottom: surface.bottom,
            frameHeight: wrapper.height,
            frameTop: wrapper.top,
            frameBottom: wrapper.bottom,
            radius: parseFloat(getComputedStyle(popup).borderTopLeftRadius),
            overflow: getComputedStyle(popup).overflow,
            shadow: getComputedStyle(popup).boxShadow,
            frameOverflow: getComputedStyle(popup.parentElement).overflow,
            side: popup.getAttribute('data-side'),
            panel: view.dataset.panel,
            viewOpacity: Number(getComputedStyle(view).opacity),
            viewMoved: Math.abs(transform(view).m41) > 0.05,
            bodyHeight: body.getBoundingClientRect().height,
            thumbCenter: thumb ? thumb.left + thumb.width / 2 : null,
            thumbAnimating:
              thumbNode?.getAnimations().some((animation) => animation.playState === 'running') ??
              false,
          });
        frame = requestAnimationFrame(sample);
      };
      frame = requestAnimationFrame(sample);
      window.composerPopupFrames = { frames, stop: () => cancelAnimationFrame(frame) };
    });
  const finishPopupFrames = async () => {
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
    await page.waitForFunction(() => {
      const popup = document.querySelector('.reasoning-effort-popup');
      return (
        popup &&
        popup
          .getAnimations({ subtree: true })
          .every(
            (animation) => animation.playState === 'finished' || animation.playState === 'idle',
          )
      );
    });
    const frames = await page.evaluate(() => {
      const probe = window.composerPopupFrames;
      probe.stop();
      delete window.composerPopupFrames;
      return probe.frames;
    });
    return frames.map((frame) => ({ ...frame, ...dropdownRevealGeometry(frame) }));
  };
  const assertPanelTransition = (frames, panel) => {
    assert.ok(
      frames.some(
        (frame) => frame.panel === panel && frame.viewOpacity > 0.03 && frame.viewOpacity < 0.97,
      ),
      `${panel} panel must pass through intermediate opacity`,
    );
    assert.ok(
      frames.some((frame) => frame.panel === panel && frame.viewMoved),
      `${panel} panel must move while switching`,
    );
    const heights = frames.map((frame) => frame.bodyHeight);
    const start = heights[0],
      end = heights.at(-1);
    if (Math.abs(start - end) > 1)
      assert.ok(
        heights.some(
          (height) => height > Math.min(start, end) + 0.2 && height < Math.max(start, end) - 0.2,
        ),
        `${panel} body height must animate between its layouts: ${JSON.stringify(heights)}`,
      );
  };
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.getByRole('button', { name: '添加附件', exact: true }).click();
  await page.getByRole('menuitem', { name: '添加文件夹' }).waitFor();
  assert.equal(await page.getByRole('menuitemcheckbox', { name: '网络搜索' }).count(), 0);
  await page.getByRole('menuitem', { name: '添加文件', exact: true }).waitFor();
  await page.keyboard.press('Escape');
  await startPopupFrames();
  const reasoning = await openReasoningControl(page);
  const opening = await finishPopupFrames();
  assert.ok(
    opening.some((frame) => frame.revealed > 0.03 && frame.revealed < 0.97),
    'Reasoning popup must grow its actual rounded surface through intermediate heights',
  );
  assert.ok(
    opening.every(
      (frame) =>
        frame.popupOpacity >= 0 &&
        frame.popupOpacity <= 1 &&
        (frame.revealed <= 0.65 || frame.popupOpacity === 1) &&
        frame.popupUnscaled &&
        frame.clip === 'none' &&
        frame.radius > 0 &&
        frame.overflow === 'hidden' &&
        frame.frameOverflow === 'visible' &&
        frame.shadow !== 'none' &&
        (frame.revealed <= 0.03 || Math.abs(frame.anchorGap) < 0.6),
    ),
    'Reasoning popup keeps its main height range opaque and unscaled at the trigger edge',
  );
  assert.ok(
    opening.some(
      (frame) => frame.popupOpacity > 0 && frame.popupOpacity < 1 && frame.revealed < 0.65,
    ),
    'Reasoning popup fades only at the start of its height expansion',
  );
  const popupGeometry = await reasoning.evaluate((popup) => {
    const style = getComputedStyle(popup);
    const header = popup.querySelector('.reasoning-model-selector').getBoundingClientRect();
    const slider = popup.querySelector('.reasoning-slider').getBoundingClientRect();
    return {
      radius: parseFloat(style.borderTopLeftRadius),
      composerRadius: parseFloat(
        getComputedStyle(document.querySelector('.composer')).borderTopLeftRadius,
      ),
      headerAbove: header.bottom <= slider.top + 1,
      gap: slider.top - header.bottom,
      padding: [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft].map(
        parseFloat,
      ),
      overflow: popup.scrollWidth > popup.clientWidth + 1,
      levelFontSize: parseFloat(
        getComputedStyle(popup.querySelector('.reasoning-level-heading')).fontSize,
      ),
    };
  });
  assert.ok(
    Math.abs(popupGeometry.radius - popupGeometry.composerRadius) < 1,
    'Reasoning popup shares the composer corner radius',
  );
  assert.equal(popupGeometry.headerAbove, true, 'Model and effort header must precede the slider');
  assert.ok(
    popupGeometry.gap >= -1 && popupGeometry.gap <= 12,
    'Header and slider keep compact spacing',
  );
  assert.ok(
    popupGeometry.padding.every((value) => value <= 12),
    'Reasoning popup keeps compact outer padding',
  );
  assert.equal(popupGeometry.overflow, false, 'Reasoning popup content fits its width');
  assert.equal(
    popupGeometry.levelFontSize,
    12,
    'The current reasoning level uses the same compact size as its model label',
  );
  const modelHeader = reasoning.getByRole('button', { name: '选择模型', exact: true });
  const headerSurface = () =>
    modelHeader.evaluate((node) => ({
      background: getComputedStyle(node).backgroundColor,
      shadow: getComputedStyle(node).boxShadow,
    }));
  const settleHeader = () =>
    page.waitForFunction(() =>
      [...document.querySelectorAll('.reasoning-model-selector')].every((node) =>
        node.getAnimations().every((animation) => animation.playState !== 'running'),
      ),
    );
  await page.mouse.move(0, 0);
  await settleHeader();
  assert.deepEqual(await headerSurface(), { background: 'rgba(0, 0, 0, 0)', shadow: 'none' });
  await modelHeader.hover();
  await settleHeader();
  assert.notEqual((await headerSurface()).shadow, 'none');
  await page.mouse.move(0, 0);
  await settleHeader();
  assert.deepEqual(await headerSurface(), { background: 'rgba(0, 0, 0, 0)', shadow: 'none' });
  await startPopupFrames();
  await reasoning.getByRole('button', { name: '选择模型', exact: true }).click();
  await reasoning.getByRole('menuitemradio').first().waitFor();
  assertPanelTransition(await finishPopupFrames(), 'models');
  await captureRequested(page, 'reasoning-model-list');
  await startPopupFrames();
  await page.getByRole('menuitemradio', { name: /GPT · 推理/ }).click();
  const effort = reasoning.getByRole('slider', { name: '思考强度', exact: true });
  await effort.waitFor();
  assertPanelTransition(await finishPopupFrames(), 'effort');
  const persistedEffort = () =>
    page.evaluate(
      () =>
        new Promise((resolve, reject) => {
          const request = indexedDB.open('voxcue-preparation-chats', 1);
          request.onerror = () => reject(request.error);
          request.onupgradeneeded = () => request.transaction.abort();
          request.onsuccess = () => {
            const db = request.result;
            const transaction = db.transaction('state', 'readonly');
            const snapshot = transaction.objectStore('state').get('current');
            transaction.oncomplete = () => {
              db.close();
              resolve(snapshot.result?.effort);
            };
            transaction.onerror = () => {
              db.close();
              reject(transaction.error);
            };
          };
        }),
    );
  const assertThumbMotion = (frames, from, to, action) => {
    assert.ok(
      frames.some(
        (frame) =>
          Number.isFinite(frame.thumbCenter) &&
          frame.thumbCenter > Math.min(from, to) + 0.3 &&
          frame.thumbCenter < Math.max(from, to) - 0.3,
      ),
      `${action} must move the thumb through intermediate positions`,
    );
  };
  const thumb = reasoning.locator('.reasoning-slider-thumb');
  const rangeBox = await effort.boundingBox();
  const initialThumb = await thumb.boundingBox();
  const startX = rangeBox.x + initialThumb.width / 2;
  const travel = rangeBox.width - initialThumb.width;
  const pointerY = initialThumb.y + initialThumb.height / 2;
  assert.equal(await persistedEffort(), 'low');
  await page.mouse.move(initialThumb.x + initialThumb.width / 2, pointerY);
  await page.mouse.down();
  let releaseX;
  try {
    for (const fraction of [0.37, 0.68]) {
      releaseX = startX + travel * fraction;
      await page.mouse.move(releaseX, pointerY, { steps: 8 });
      await page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
      );
      const following = await effort.evaluate((input) => {
        const slider = input.closest('.reasoning-slider');
        const thumb = slider.querySelector('.reasoning-slider-thumb').getBoundingClientRect();
        return {
          value: input.valueAsNumber,
          dragging: slider.dataset.dragging,
          center: thumb.left + thumb.width / 2,
          fillEdge: slider.querySelector('.reasoning-slider-fill').getBoundingClientRect().right,
        };
      });
      assert.equal(following.dragging, 'true');
      assert.ok(
        Math.abs(following.center - releaseX) < 2,
        'Dragging thumb follows the pointer continuously',
      );
      assert.ok(
        Math.abs(following.value - Math.round(following.value)) > 0.05,
        'Dragging keeps positions between discrete levels',
      );
      assert.ok(
        Math.abs(following.fillEdge - following.center) < 2,
        'Filled track meets the center of the thumb',
      );
      assert.equal(await persistedEffort(), 'low', 'Dragging must not commit intermediate levels');
    }
    await startPopupFrames();
  } finally {
    await page.mouse.up();
  }
  const snappedFrames = await finishPopupFrames();
  const middleThumb = await thumb.boundingBox();
  const middleX = middleThumb.x + middleThumb.width / 2;
  assertThumbMotion(snappedFrames, releaseX, middleX, 'Pointer release');
  assert.equal(Number(await effort.inputValue()), 1, 'Pointer release snaps to the nearest level');
  assert.equal(await effort.getAttribute('aria-valuetext'), '中');
  assert.equal(await persistedEffort(), 'medium');
  await effort.focus();
  await startPopupFrames();
  await effort.press('End');
  const keyboardFrames = await finishPopupFrames();
  const endThumb = await thumb.boundingBox();
  assertThumbMotion(keyboardFrames, middleX, endThumb.x + endThumb.width / 2, 'Keyboard selection');
  assert.equal(await effort.getAttribute('aria-valuetext'), '高');
  assert.equal(await persistedEffort(), 'high');
  await startPopupFrames();
  await page.mouse.click(startX + travel * 0.34, pointerY);
  const clickedFrames = await finishPopupFrames();
  const clickedThumb = await thumb.boundingBox();
  const clickedCenter = clickedThumb.x + clickedThumb.width / 2;
  const movingClick = clickedFrames.filter(
    (frame) => frame.thumbAnimating && Number.isFinite(frame.thumbCenter),
  );
  assert.ok(
    movingClick.some((frame) => Math.abs(frame.thumbCenter - clickedCenter) > 0.3),
    'Track click release animates toward its settled position',
  );
  assert.ok(
    Math.max(...movingClick.map((frame) => frame.thumbCenter)) -
      Math.min(...movingClick.map((frame) => frame.thumbCenter)) >
      0.3,
    'Track click thumb moves during its animation',
  );
  assert.equal(Number(await effort.inputValue()), 1, 'Track click settles at the nearest level');
  await effort.focus();
  await startPopupFrames();
  await effort.press('End');
  await finishPopupFrames();
  assert.equal(await effort.getAttribute('aria-valuetext'), '高');
  await captureRequested(page, 'reasoning-combined-slider');
  await page.evaluate(() => document.documentElement.classList.add('dark'));
  const darkContrast = await reasoning.evaluate((node) => {
    const surface = getComputedStyle(document.documentElement).getPropertyValue('--surface');
    const thumb = getComputedStyle(node.querySelector('.reasoning-slider-thumb')).backgroundColor;
    const fill = getComputedStyle(node.querySelector('.reasoning-slider-fill')).backgroundColor;
    const context = document.createElement('canvas').getContext('2d');
    const light = (color) => {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
      return [...context.getImageData(0, 0, 1, 1).data]
        .slice(0, 3)
        .map((channel) => {
          const value = channel / 255;
          return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
        })
        .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
    };
    const contrast = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    return {
      fill: contrast(light(thumb), light(fill)),
      surface: contrast(light(thumb), light(surface)),
    };
  });
  assert.ok(darkContrast.fill >= 3 && darkContrast.surface >= 3, JSON.stringify(darkContrast));
  await captureRequested(page, 'reasoning-combined-slider-dark');
  await page.evaluate(() => document.documentElement.classList.remove('dark'));
  await page.keyboard.press('Escape');
  await reasoning.waitFor({ state: 'hidden' });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  try {
    await startPopupFrames();
    await openReasoningControl(page);
    const reducedOpening = await finishPopupFrames();
    assert.ok(reducedOpening.length > 0);
    assert.ok(
      reducedOpening.every(
        (frame) =>
          frame.popupOpacity === 1 &&
          frame.viewOpacity === 1 &&
          frame.revealed === 1 &&
          frame.popupUnscaled,
      ),
      'Reduced motion opens directly without fading',
    );
    await startPopupFrames();
    await reasoning.getByRole('button', { name: '选择模型', exact: true }).click();
    await reasoning.getByRole('menuitemradio').first().waitFor();
    const reducedModels = await finishPopupFrames();
    assert.ok(reducedModels.some((frame) => frame.panel === 'models'));
    assert.ok(
      reducedModels.every((frame) => frame.viewOpacity === 1),
      'Reduced motion switches directly to the model list',
    );
    await startPopupFrames();
    await reasoning.getByRole('menuitemradio', { name: /GPT · 推理/ }).click();
    await effort.waitFor();
    const reducedEffort = await finishPopupFrames();
    assert.ok(reducedEffort.some((frame) => frame.panel === 'effort'));
    assert.ok(
      reducedEffort.every((frame) => frame.viewOpacity === 1),
      'Reduced motion switches directly back to effort',
    );
    assert.equal(
      await reasoning.evaluate((popup) => popup.getAnimations({ subtree: true }).length),
      0,
    );
    assert.equal(await effort.getAttribute('aria-valuetext'), '高');
    await page.keyboard.press('Escape');
    await reasoning.waitFor({ state: 'hidden' });
  } finally {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
  }
  await page.getByLabel('添加聊天文件', { exact: true }).setInputFiles({
    name: 'resume-draft.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('本地简历草稿'),
  });
  await page.locator('.chat-attachment').getByText('resume-draft.txt', { exact: false }).waitFor();
  assert.equal(
    await page.locator('.chat-column').evaluate((element) => {
      const transfer = new DataTransfer();
      transfer.setData('text/plain', '普通文本保持浏览器行为');
      return element.dispatchEvent(
        new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }),
      );
    }),
    true,
  );
  await page.locator('.welcome').evaluate((element) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(['项目素材'], 'project.md', { type: 'text/markdown' }));
    element.dispatchEvent(
      new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: transfer }),
    );
  });
  await page.locator('.chat-drop-hint').waitFor();
  await page.locator('.welcome').evaluate((element) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(['项目素材'], 'project.md', { type: 'text/markdown' }));
    element.dispatchEvent(
      new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }),
    );
  });
  await page.locator('.chat-attachment').getByText('project.md', { exact: false }).waitFor();
  assert.equal(await page.locator('.chat-attachment').count(), 2);
  const folder = path.join(profile, 'context');
  await mkdir(folder);
  await writeFile(path.join(folder, 'jd.txt'), '岗位描述');
  await page.getByLabel('添加聊天文件夹', { exact: true }).setInputFiles(folder);
  await page.locator('.chat-attachment').getByText('context/jd.txt', { exact: false }).waitFor();
  await page.getByRole('button', { name: '移除附件 context/jd.txt', exact: true }).click();
  assert.equal(await page.locator('.chat-attachment').count(), 3);
  await page.getByRole('button', { name: '确认删除：附件：context/jd.txt', exact: true }).click();
  assert.equal(await page.locator('.chat-attachment').count(), 2);
  await page.screenshot({});
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await page.locator('.chat-answer').getByText('尚未联网检索', { exact: false }).waitFor();
  assert.equal(await page.locator('.chat-attachment').count(), 0);
  await page.locator('.message-options').getByText('附件：project.md').waitFor();
  assert.equal(
    await page.locator('.message-options').getByText('思考：高', { exact: false }).count(),
    0,
    'Request options are not repeated inside the user bubble',
  );
  await page.getByRole('button', { name: '停止回复', exact: true }).click();
  await page.locator('.chat-scroll').evaluate((element) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(['追问素材'], 'follow-up.txt', { type: 'text/plain' }));
    element.dispatchEvent(
      new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }),
    );
  });
  await page.locator('.chat-attachment').getByText('follow-up.txt', { exact: false }).waitFor();
  assert.equal(
    await page.locator('.chat-attachment').count(),
    1,
    'Bubbling through chat column must add the file once',
  );
  await page.getByLabel('添加聊天文件', { exact: true }).setInputFiles({
    name: 'bad.exe',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from('bad'),
  });
  await page.getByRole('alert').getByText('不支持的文件格式：bad.exe', { exact: false }).waitFor();
  await page.getByRole('button', { name: '用户菜单' }).click();
  await page.getByRole('menuitem', { name: '设置', exact: true }).click();
  await page
    .getByRole('navigation', { name: '设置分类' })
    .getByRole('button', { name: '通用', exact: true })
    .click();
  await page.getByRole('button', { name: '外观主题', exact: true }).click();
  await page.getByRole('menuitemradio', { name: '深色', exact: true }).click();
  await page.getByRole('button', { name: '关闭设置' }).click();
  await page.locator('.chat-column').evaluate((element) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(['Delayed synthetic file'], 'pending.txt', { type: 'text/plain' }));
    Object.defineProperty(transfer, 'items', {
      value: [
        {
          webkitGetAsEntry: () => ({
            name: 'pending.txt',
            isFile: true,
            file(success) {
              globalThis.releaseDroppedFile = () => success(transfer.files[0]);
            },
          }),
        },
      ],
    });
    element.dispatchEvent(
      new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }),
    );
  });
  await page.waitForFunction(() => typeof globalThis.releaseDroppedFile === 'function');
  await page.getByRole('button', { name: '新对话', exact: true }).click();
  await page.evaluate(() => globalThis.releaseDroppedFile());
  await page
    .getByRole('alert')
    .getByText('读取文件期间已切换对话，请在当前对话重新拖入文件。', { exact: true })
    .waitFor();
  assert.equal(await page.locator('.chat-attachment').count(), 0);
  for (const event of ['dragleave', 'blur', 'dragend']) {
    await page.locator('.welcome').evaluate((element) => {
      const transfer = new DataTransfer();
      transfer.items.add(new File(['Synthetic'], 'hint.txt', { type: 'text/plain' }));
      globalThis.hintTransfer = transfer;
      element.dispatchEvent(
        new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: transfer }),
      );
    });
    await page.locator('.chat-drop-hint').waitFor();
    await page.evaluate((event) => {
      if (event === 'dragleave')
        document.querySelector('.chat-column').dispatchEvent(
          new DragEvent(event, {
            bubbles: true,
            cancelable: true,
            dataTransfer: globalThis.hintTransfer,
          }),
        );
      else window.dispatchEvent(new Event(event));
    }, event);
    await page.locator('.chat-drop-hint').waitFor({ state: 'hidden' });
  }
  await page.getByLabel('添加聊天文件', { exact: true }).setInputFiles({
    name: 'project.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from('项目素材'),
  });
  const longText = '这是一段用于验证实际自动换行、全文复制和附件保留的合成用户消息。'.repeat(75);
  await page.evaluate(() => {
    window.copiedMessages = [];
    navigator.clipboard.writeText = async (text) => window.copiedMessages.push(text);
  });
  await page.getByRole('textbox', { name: '聊天消息', exact: true }).fill(longText);
  await send.click();
  const user = page.locator('.chat-message.user').last();
  const assistant = page.locator('.chat-message.assistant').last();
  const body = user.locator('.user-message-text');
  const toggle = user.getByRole('button', { name: '显示更多', exact: true });
  await toggle.waitFor();
  await page.getByRole('button', { name: '停止回复', exact: true }).click();
  await assistant.locator('.chat-copy').waitFor();
  const bubble = await user.locator('.user-bubble').evaluate((node) => {
    const style = getComputedStyle(node);
    const composer = getComputedStyle(document.querySelector('.composer'));
    const text = node.querySelector('.user-message-text');
    const toggle = node.querySelector('.user-message-toggle');
    const ellipsis = node.querySelector('.user-message-ellipsis');
    return {
      radii: ['TopLeft', 'TopRight', 'BottomLeft', 'BottomRight'].map(
        (corner) => style[`border${corner}Radius`],
      ),
      expectedRadius: composer.borderTopLeftRadius,
      shape: style.cornerShape,
      expectedShape: composer.cornerShape,
      visible: text.getBoundingClientRect().height,
      limit: parseFloat(getComputedStyle(text).lineHeight) * 20,
      full: text.scrollHeight,
      toggleLeft: toggle.getBoundingClientRect().left - text.getBoundingClientRect().left,
      toggleBackground: getComputedStyle(toggle).backgroundColor,
      toggleIcon: toggle.querySelector('svg[aria-hidden="true"]') !== null,
      ellipsis: ellipsis.textContent,
      ellipsisAboveToggle:
        ellipsis.getBoundingClientRect().bottom <= toggle.getBoundingClientRect().top,
      attachmentOutsideClamp: !text.contains(node.querySelector('.message-options')),
      attachmentText: node.querySelector('.message-options').textContent.trim(),
    };
  });
  assert.ok(bubble.radii.every((radius) => radius === bubble.expectedRadius));
  assert.equal(bubble.shape, bubble.expectedShape);
  assert.ok(Math.abs(bubble.visible - bubble.limit) <= 0.5 && bubble.full > bubble.limit);
  assert.ok(Math.abs(bubble.toggleLeft) <= 0.5);
  assert.equal(bubble.toggleBackground, 'rgba(0, 0, 0, 0)');
  assert.ok(bubble.toggleIcon && bubble.ellipsisAboveToggle);
  assert.equal(bubble.ellipsis, '...');
  for (const dark of [false, true]) {
    await page.evaluate((dark) => document.documentElement.classList.toggle('dark', dark), dark);
    await toggle.hover();
    assert.deepEqual(
      await toggle.evaluate((node) => ({
        left: getComputedStyle(node).paddingLeft,
        right: getComputedStyle(node).paddingRight,
      })),
      { left: '12px', right: '12px' },
    );
  }
  await page.evaluate(() => document.documentElement.classList.remove('dark'));
  const collapsedIcon = await toggle.locator('svg').innerHTML();
  assert.ok(bubble.attachmentOutsideClamp);
  assert.equal(bubble.attachmentText, '附件：project.md');
  assert.equal(
    longText.includes('\n'),
    false,
    'Clamping is based on visual wrapping, not newlines',
  );
  for (const message of [user, assistant]) {
    const metadata = await message.evaluate((node) => {
      const copy = node.querySelector('.chat-copy');
      const time = node.querySelector('.chat-message-time');
      const c = copy.getBoundingClientRect(),
        d = time.getBoundingClientRect();
      return {
        ordered: node.classList.contains('user') ? d.right <= c.left : c.right <= d.left,
        aligned: Math.abs(d.top + d.height / 2 - c.top - c.height / 2) <= 1 / 64,
        dateTime: time.dateTime,
        text: time.textContent,
        height: c.height,
        fontSize: getComputedStyle(copy).fontSize,
        rightGap: node.classList.contains('user')
          ? c.right - node.querySelector('.user-bubble').getBoundingClientRect().right
          : null,
      };
    });
    assert.ok(metadata.ordered && metadata.aligned);
    assert.match(metadata.text, /^\d{2}:\d{2}$/);
    assert.ok(Number.isFinite(Date.parse(metadata.dateTime)));
    assert.equal(Math.round(metadata.height * 64) / 64, 28);
    assert.equal(metadata.fontSize, '12px');
    if (metadata.rightGap !== null) assert.ok(Math.abs(metadata.rightGap) <= 1 / 64);
  }
  await user.locator('.chat-copy').click();
  assert.equal(await page.evaluate(() => window.copiedMessages.at(-1)), longText);
  for (const expanded of [true, false]) {
    await user.locator('.user-message-toggle').click();
    const moving = await body.evaluate(async (node) => {
      await new Promise(requestAnimationFrame);
      const animations = node.getAnimations();
      for (const animation of animations) {
        animation.pause();
        animation.currentTime = Number(animation.effect.getTiming().duration) / 2;
      }
      const middle = node.getBoundingClientRect().height;
      for (const animation of animations) animation.finish();
      return { middle, final: node.getBoundingClientRect().height, animations: animations.length };
    });
    assert.ok(moving.animations > 0);
    assert.ok(moving.middle > bubble.limit && moving.middle < bubble.full);
    assert.ok(Math.abs(moving.final - (expanded ? bubble.full : bubble.limit)) <= 0.5);
    assert.equal(
      await user.locator('.user-message-toggle').getAttribute('aria-expanded'),
      String(expanded),
    );
    assert.equal(await user.locator('.user-message-ellipsis').count(), expanded ? 0 : 1);
    assert.equal(
      (await user.locator('.user-message-toggle svg').innerHTML()) === collapsedIcon,
      !expanded,
    );
    await user.locator('.chat-copy').click();
    assert.equal(await page.evaluate(() => window.copiedMessages.at(-1)), longText);
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await user.locator('.user-message-toggle').focus();
  await page.keyboard.press('Enter');
  assert.equal(await body.evaluate((node) => node.getAnimations().length), 0);
  assert.ok(Math.abs((await body.boundingBox()).height - bubble.full) <= 0.5);
  await page.keyboard.press('Space');
  assert.ok(Math.abs((await body.boundingBox()).height - bubble.limit) <= 0.5);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await assistant.locator('.chat-copy').click();
  assert.notEqual(await page.evaluate(() => window.copiedMessages.at(-1)), longText);
  const twentyLines = Array.from({ length: 20 }, (_, index) => `短行 ${index + 1}`).join('\n');
  await page.getByRole('textbox', { name: '聊天消息', exact: true }).fill(twentyLines);
  await send.click();
  await page.locator('.chat-message.user').last().locator('.user-message-text').waitFor();
  assert.equal(
    await page.locator('.chat-message.user').last().locator('.user-message-text').textContent(),
    twentyLines,
  );
  await page.getByRole('button', { name: '停止回复', exact: true }).click();
  assert.equal(
    await page.locator('.chat-message.user').last().locator('.user-message-toggle').count(),
    0,
  );
  await page.waitForFunction(async () => {
    const db = await new Promise((resolve) => {
      const request = indexedDB.open('voxcue-preparation-chats', 1);
      request.onsuccess = () => resolve(request.result);
    });
    try {
      const saved = await new Promise((resolve) => {
        const request = db.transaction('state').objectStore('state').get('current');
        request.onsuccess = () => resolve(request.result);
      });
      return (
        saved?.conversations.find((item) => item.id === saved.activeConversation)?.messages.at(-1)
          ?.status === 'stopped'
      );
    } finally {
      db.close();
    }
  });
  const legacy = await page.evaluate(async () => {
    const db = await new Promise((resolve) => {
      const request = indexedDB.open('voxcue-preparation-chats', 1);
      request.onsuccess = () => resolve(request.result);
    });
    try {
      return await new Promise((resolve, reject) => {
        const transaction = db.transaction('state', 'readwrite');
        const store = transaction.objectStore('state');
        const request = store.get('current');
        let result;
        request.onsuccess = () => {
          const saved = request.result;
          const messages = saved.conversations.find(
            (item) => item.id === saved.activeConversation,
          ).messages;
          const day = new Date();
          day.setDate(day.getDate() - 1);
          day.setHours(11, 12, 0, 0);
          delete messages[0].startedAt;
          messages[1].startedAt = day.getTime();
          delete messages.at(-2).startedAt;
          delete messages.at(-1).startedAt;
          result = {
            dateTime: day.toISOString(),
            modelId: messages[0].options.modelId,
            effort: messages[0].options.effort,
          };
          store.put(saved, 'current');
        };
        transaction.oncomplete = () => resolve(result);
        transaction.onerror = () => reject(transaction.error);
      });
    } finally {
      db.close();
    }
  });
  assert.equal(
    legacy.modelId,
    'mock-reasoning',
    'Hidden model metadata remains in the request snapshot',
  );
  assert.equal(legacy.effort, 'high', 'Hidden reasoning metadata remains in the request snapshot');
  await page.reload();
  await page.locator('.chat-message.user').first().locator('.chat-message-time').waitFor();
  assert.equal(
    await page.locator('.chat-message.user').first().locator('time').getAttribute('datetime'),
    legacy.dateTime,
  );
  assert.equal(
    await page.locator('.chat-message.user').first().locator('time').innerText(),
    '昨天',
  );
  assert.equal(
    await page.locator('.chat-message.assistant').first().locator('time').getAttribute('datetime'),
    legacy.dateTime,
  );
  assert.equal(await page.locator('.chat-message.user').last().locator('time').count(), 0);
  assert.equal(await page.locator('.chat-message.assistant').last().locator('time').count(), 0);
  await page.screenshot({});
  assert.deepEqual(errors, []);
  console.log(
    'PASS: attachment menu and drops, request options retained without bubble hints, continuous user corners, visual-line folding with full copy and attachments, ordered message time/copy controls, reduced motion, invalid file validation and compact sidebar.',
  );
} finally {
  await closeUiApp(app);
}
