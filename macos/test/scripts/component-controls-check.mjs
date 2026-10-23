import assert from 'node:assert/strict';

// Presentation-only fixtures: no model files, network, capture devices or live account.
export async function checkComponentControls({ app, page, state, poll, capture, choose }) {
  const flatten = (node) => [node, ...(node.children ?? []).flatMap(flatten)];
  await app.evaluate(({ app }) => {
    const require = process
      .getBuiltinModule('module')
      .createRequire(app.getAppPath() + '/package.json');
    const { ComponentService } = require(
      app.getAppPath() + '/dist-electron/shared/electron/backend/components/service.js',
    );
    const original = ComponentService.prototype.state;
    const fixture = (globalThis.uiComponentControls = {});
    ComponentService.prototype.state = function () {
      fixture.service = this;
      return structuredClone(fixture.value ?? original.call(this));
    };
    fixture.set = (phase, phases = {}) => {
      const value = fixture.value ?? fixture.service.state();
      fixture.value = {
        ...value,
        phase,
        error: null,
        revision: value.revision + 1,
        removable: true,
        items: value.items.map((item) => ({
          ...item,
          removable: true,
          phase: phases[item.id] ?? item.phase,
          received:
            (phases[item.id] ?? item.phase) === 'downloading' ? item.bytes * 0.08 : item.received,
        })),
      };
      fixture.service.options.emit(fixture.service.state());
      return fixture.service.state();
    };
    ComponentService.prototype.download = function () {
      fixture.set('checking', { speech: 'checking' });
      return new Promise((resolve) => {
        fixture.finish = resolve;
      });
    };
    ComponentService.prototype.cancel = function () {
      const value = fixture.set('needed', { speech: 'pending', qwen: 'pending', rag: 'ready' });
      fixture.finish?.(value);
      return Promise.resolve(value);
    };
  });
  await page.evaluate(() => window.desktop.components({ op: 'status' }));
  const set = (phase, phases) =>
    app.evaluate((_, { phase, phases }) => globalThis.uiComponentControls.set(phase, phases), {
      phase,
      phases,
    });
  await set('needed', { speech: 'pending', qwen: 'pending', rag: 'ready' });
  let composer;
  for (const candidate of app.context().pages())
    if (!candidate.isClosed() && (await candidate.title()) === 'VoxCue composer')
      composer = candidate;
  await composer
    .getByRole('textbox', { name: '聊天消息', exact: true })
    .fill('合成测试：提示条上方滚动与虚化。');
  await composer.getByRole('button', { name: '发送消息', exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector('.chat-scroll')?.scrollHeight > innerHeight * 2,
  );
  const notice = page.locator('.chat-column > .components-notice');
  const scroll = page.locator('.chat-scroll');
  await scroll.evaluate((node) => {
    node.scrollTop = 0;
  });
  await notice.waitFor();
  for (const width of [1280, 960]) {
    await app.evaluate(
      ({ BrowserWindow }, width) =>
        BrowserWindow.getAllWindows()
          .find((win) => win.getTitle() === 'VoxCue')
          .setSize(width, 800),
      width,
    );
    await page.waitForFunction((width) => innerWidth === width, width);
    await scroll.evaluate((node) => {
      node.scrollTop = 0;
    });
    const geometry = await notice.evaluate((node) => ({
      notice: node.getBoundingClientRect().toJSON(),
      toolbar: document
        .querySelector('.preparation-workspace .page-toolbar')
        .getBoundingClientRect()
        .toJSON(),
    }));
    assert.ok(
      geometry.notice.top >= geometry.toolbar.bottom + 10,
      'Component notice must remain below the title and toolbar: ' + JSON.stringify(geometry),
    );
  }
  await capture('components-notice-layout');
  const noticeShape = await notice
    .getByRole('button', { name: '前往设置', exact: true })
    .evaluate((node) => ({
      radius: getComputedStyle(node).borderTopLeftRadius,
      corner: getComputedStyle(node).getPropertyValue('corner-shape'),
    }));
  assert.deepEqual(noticeShape, { radius: '999px', corner: 'round' });
  await scroll.evaluate((node) => {
    node.scrollTop = 250;
  });
  await poll(
    state,
    (value) =>
      flatten(value.tree).some(
        (node) => node.identifier === 'voxcue-header-material' && node.alpha === 1,
      ),
    'Chat content must pass behind the native toolbar and activate its blur while the notice stays fixed',
  );
  const scrolled = await notice.boundingBox();
  assert.equal(scrolled.y, 72, 'The notice must stay fixed below the toolbar while chat scrolls');
  await capture('components-notice-scrolled');
  await scroll.evaluate((node) => {
    node.scrollTop = 0;
  });
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((win) => win.getTitle() === 'VoxCue')
      .setSize(1280, 800),
  );
  await page.waitForFunction(() => innerWidth === 1280);
  await notice.getByRole('button', { name: '前往设置', exact: true }).click();
  const settings = page.getByRole('dialog', { name: '设置', exact: true });
  await settings.waitFor();
  await settings.getByRole('heading', { name: '本地组件', exact: true }).waitFor();
  await settings.getByRole('button', { name: '个性化', exact: true }).click();
  await choose(settings.getByRole('button', { name: '外观主题', exact: true }), '深色');
  await settings.getByRole('button', { name: '本地组件', exact: true }).click();
  const row = (id) => settings.locator(`.component-row[data-component-id="${id}"]`);
  const qwen = row('qwen').getByRole('button', { name: '下载', exact: true });
  const rag = row('rag').getByRole('button', { name: /^删除：/ });
  const native = async (button) => {
    const rect = await button.boundingBox();
    const value = await poll(
      state,
      (value) =>
        flatten(value.tree).some(
          (node) =>
            node.class === 'NSButton' &&
            Math.abs(node.centerX - rect.x - rect.width / 2) < 1 &&
            Math.abs(node.centerY - rect.y - rect.height / 2) < 1,
        ),
      'Component native action missing',
    );
    const source = flatten(value.tree).find(
      (node) =>
        node.class === 'NSButton' &&
        Math.abs(node.centerX - rect.x - rect.width / 2) < 1 &&
        Math.abs(node.centerY - rect.y - rect.height / 2) < 1,
    );
    return Object.fromEntries(
      [
        'bezelStyle',
        'borderShape',
        'frameWidth',
        'frameHeight',
        'title',
        'image',
        'imagePosition',
        'foregroundColor',
        'tintProminence',
        'enabled',
        'inGlassContent',
      ].map((key) => [key, source[key]]),
    );
  };
  await page.mouse.move(1000, 750);
  const before = { qwen: await native(qwen), rag: await native(rag) };
  assert.equal(before.rag.bezelStyle, 1, 'Component delete uses flat standard artwork');
  assert.equal(before.rag.frameWidth, 36);
  assert.equal(before.rag.frameHeight, 36);
  assert.equal(await settings.getByText('已就绪', { exact: true }).count(), 0);
  await rag.click();

  const armed = row('rag').getByRole('button', { name: /^确认删除：/ });
  await page.waitForTimeout(200);
  const confirmation = await native(armed);
  assert.equal(confirmation.bezelStyle, 1, 'Expanded component delete stays flat');
  assert.equal(confirmation.frameHeight, 36);
  assert.ok(confirmation.foregroundColor[0] > confirmation.foregroundColor[1]);
  await capture('components-delete-flat');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
  await row('speech').getByRole('button', { name: '下载', exact: true }).click();
  await page.mouse.move(1000, 750);
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll('.component-row button')].filter((node) => node.disabled)
        .length === 3,
  );
  assert.deepEqual(
    await native(qwen),
    { ...before.qwen, enabled: false },
    'Checking another cache must preserve download artwork',
  );
  assert.deepEqual(
    await native(rag),
    { ...before.rag, enabled: false },
    'Checking another cache must preserve delete artwork',
  );
  await set('downloading', { speech: 'downloading', qwen: 'pending', rag: 'ready' });
  const download = row('speech').locator('.download-button');
  await download.waitFor();
  await page.mouse.move(1000, 750);
  const indicator = await poll(
    state,
    (value) =>
      flatten(value.tree).some(
        (node) =>
          node.identifier === 'voxcue-content-progress' &&
          !node.indeterminate &&
          Math.abs(node.value - 8) < 0.01,
      ),
    'Native progress ring must display the received byte percentage',
  );
  const ring = flatten(indicator.tree).find(
    (node) => node.identifier === 'voxcue-content-progress',
  );
  assert.equal(ring.progressStyle, 1);
  assert.equal(ring.controlSize, 1);
  assert.equal(ring.frameHeight, ring.frameWidth);
  assert.ok(ring.frameWidth >= 12 && ring.frameWidth <= 20, 'Use the small native progress ring');
  assert.equal(await download.locator('[role=progressbar]').getAttribute('aria-valuenow'), '8');
  assert.equal((await download.locator('.download-button-progress').innerText()).trim(), '8%');
  const backplate = await native(download);
  assert.equal(backplate.title, '', 'Progress foreground stays in the shared button');
  assert.equal(
    backplate.imagePosition,
    0,
    'Hidden cancellation icon must not appear with the percentage',
  );
  assert.deepEqual(
    await native(qwen),
    { ...before.qwen, enabled: false },
    'Downloading must preserve unrelated download artwork',
  );
  assert.deepEqual(
    await native(rag),
    { ...before.rag, enabled: false },
    'Downloading must preserve unrelated delete artwork',
  );
  assert.equal(await qwen.isDisabled(), true);
  assert.equal(await rag.isDisabled(), true);
  await capture('components-download-ring');
  await page.waitForFunction(() => document.querySelector('.download-button.is-cancellable'));
  await download.hover();
  await download.locator('.download-button-cancel').waitFor({ state: 'visible' });
  await download.evaluate(async (node) => {
    await Promise.all(node.getAnimations().map((animation) => animation.finished.catch(() => {})));
  });
  const cancel = await poll(
    () =>
      download.evaluate((node) => {
        const probe = document.createElement('span');
        probe.style.color = 'var(--danger)';
        document.body.append(probe);
        const danger = getComputedStyle(probe).color;
        probe.remove();
        return {
          color: getComputedStyle(node).color,
          background: getComputedStyle(node).backgroundColor,
          danger,
        };
      }),
    (value) => value.color === value.danger,
    'Cancellation text must finish its hover transition to red',
  );
  assert.equal(cancel.color, cancel.danger, 'Cancellation text and icon must be red');
  assert.notEqual(
    cancel.background,
    cancel.danger,
    'Cancellation must retain its neutral background',
  );
  await poll(
    state,
    (value) => !flatten(value.tree).some((node) => node.identifier === 'voxcue-content-progress'),
    'Hover cancellation must hide the native progress ring',
  );
  await capture('components-download-cancel');
  await download.click();
  await row('speech').getByRole('button', { name: '下载', exact: true }).waitFor();
  await set('ready', { speech: 'ready', qwen: 'ready', rag: 'ready' });
  await page.waitForFunction(
    () => document.querySelectorAll('.component-ready-actions').length === 3,
  );
  assert.equal(await settings.getByText('已就绪', { exact: true }).count(), 0);
  await settings.getByRole('button', { name: '面试设置', exact: true }).click();
  await choose(
    settings.getByRole('button', { name: '语音识别模型', exact: true }),
    'Qwen3-ASR 0.6B',
  );
  const device = settings.getByRole('button', { name: '语音推理设备', exact: true });
  if (await device.isEnabled()) await choose(device, 'CPU');
  await settings.getByRole('button', { name: '关闭设置', exact: true }).click();
  await page.getByRole('complementary', { name: '语音推理性能提示', exact: true }).waitFor();
  await scroll.evaluate((node) => {
    node.scrollTop = 250;
  });
  await poll(
    state,
    (value) =>
      flatten(value.tree).some(
        (node) => node.identifier === 'voxcue-header-material' && node.alpha === 1,
      ),
    'CPU notice must preserve toolbar blur during chat scrolling',
  );
  const warning = await notice.evaluate((node) => ({
    top: node.getBoundingClientRect().top,
    shadow: getComputedStyle(node).boxShadow,
  }));
  assert.equal(warning.top, 72);
  assert.notEqual(warning.shadow, 'none', 'The fixed notice must have a floating shadow');
  await capture('components-performance-notice');
  await page.getByRole('button', { name: '个人信息', exact: true }).click();
  const personal = page.locator('.personal-panel[data-open=true]');
  const resume = personal.locator('details[aria-label="简历摘要"]');
  await resume.locator('summary').click();
  const edit = resume.getByRole('button', { name: '编辑', exact: true });
  await edit.scrollIntoViewIfNeeded();
  await page.waitForTimeout(250);
  const activeEdit = await native(edit);
  assert.equal(activeEdit.bezelStyle, 1, 'Controls on the glass personal pane use over-glass');
  assert.equal(activeEdit.inGlassContent, true);
  assert.equal(activeEdit.enabled, true);
  const foreground = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--foreground').trim(),
  );
  assert.equal(
    '#' +
      activeEdit.foregroundColor
        .slice(0, 3)
        .map((channel) =>
          Math.round(channel * 255)
            .toString(16)
            .padStart(2, '0'),
        )
        .join(''),
    foreground,
  );
  const disabledDelete = resume.locator('.confirm-delete');
  assert.equal(await disabledDelete.isDisabled(), true);
  const unavailable = await native(disabledDelete);
  assert.equal(unavailable.bezelStyle, 1);
  assert.equal(
    unavailable.enabled,
    false,
    'Only the unavailable action receives the system disabled appearance',
  );
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((win) => win.getTitle() === 'VoxCue')
      .blur(),
  );
  await poll(
    state,
    (value) =>
      flatten(value.tree).some(
        (node) =>
          node.class === 'NSButton' && node.inGlassContent && !node.windowKey && node.enabled,
      ),
    'Inactive windows preserve enabled controls and use AppKit inactive artwork',
  );
  const inactiveEdit = await native(edit);
  assert.equal(inactiveEdit.bezelStyle, 1);
  assert.equal(inactiveEdit.enabled, true);
  assert.equal((await native(disabledDelete)).enabled, false);
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((win) => win.getTitle() === 'VoxCue')
      .focus(),
  );
  await capture('components-personal-button-contrast');
  console.log('native progress ring size', ring.frameWidth);
  console.log(
    'PASS: notice layout, independent component artwork, native small ring, red hover cancellation, flat confirmation and no ready labels',
  );
}
