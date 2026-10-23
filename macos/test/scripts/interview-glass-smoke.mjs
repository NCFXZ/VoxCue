import { testRoot, electron } from '../../../shared/test/scripts/test-workspace.mjs';
import { offlineElectronEntry } from '../../../shared/test/scripts/offline-electron-entry.mjs';
import { installUiAccount, closeUiApp } from '../../../shared/test/scripts/install-ui-account.mjs';
import { exerciseInterviewWindowDrag } from '../../../shared/test/scripts/interview-window-drag.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import assert from 'node:assert/strict';

const probeFile = path.join(testRoot, 'InterviewGlassProbe.node');
const screenshotDirectory = process.argv.find((arg) => arg.startsWith('--screenshots='))?.slice(14);
if (screenshotDirectory) {
  assert.ok(path.isAbsolute(screenshotDirectory));
  await mkdir(screenshotDirectory, { recursive: true });
}
const compiled = spawnSync(
  '/usr/bin/xcrun',
  [
    'clang++',
    '-std=c++17',
    '-fobjc-arc',
    '-DNAPI_VERSION=8',
    '-bundle',
    '-undefined',
    'dynamic_lookup',
    '-arch',
    'arm64',
    '-mmacosx-version-min=26.0',
    '-I',
    path.resolve('.cache/node-api-headers'),
    path.resolve('test/fixtures/SidebarGlassProbe.mm'),
    '-framework',
    'AppKit',
    '-framework',
    'QuartzCore',
    '-framework',
    'ScreenCaptureKit',
    '-o',
    probeFile,
  ],
  { stdio: 'inherit' },
);
if (compiled.error) throw compiled.error;
assert.equal(compiled.status, 0);
for (const name of ['profile', 'tmp', 'home'])
  await mkdir(path.join(testRoot, name), { recursive: true });
const env = {
  ...process.env,
  COPILOT_TEST_USER_DATA: path.join(testRoot, 'profile'),
  CFFIXED_USER_HOME: path.join(testRoot, 'home'),
  TMPDIR: path.join(testRoot, 'tmp'),
  VITE_DEV_SERVER_URL: '',
};
delete env.ELECTRON_RUN_AS_NODE;
const flatten = (node) => [node, ...(node.children ?? []).flatMap(flatten)];
const poll = async (read, check, message) => {
  const until = Date.now() + 15000;
  do {
    const value = await read();
    if (check(value)) return value;
    await new Promise((r) => setTimeout(r, 75));
  } while (Date.now() < until);
  throw Error(message);
};
let app;
try {
  app = await electron.launch({ args: [await offlineElectronEntry()], env });
  app.process().stderr.on('data', (data) => process.stdout.write(data));
  app
    .process()
    .on('exit', (code, signal) => console.log('test application exited', { code, signal }));
  const login = await app.firstWindow();
  await installUiAccount(app, { speech: true, components: true });
  await app.evaluate(({ app }) => {
    const require = process
      .getBuiltinModule('module')
      .createRequire(app.getAppPath() + '/package.json');
    const { ChatGPTService } = require(
      app.getAppPath() + '/dist-electron/shared/electron/backend/chat/service.js',
    );
    const { ChatServiceError } = require(
      app.getAppPath() + '/dist-electron/shared/electron/backend/chat/errors.js',
    );
    ChatGPTService.prototype.stream = async (request, emit) => {
      if (globalThis.failInterviewGlass)
        throw new ChatServiceError({
          message: '合成异常提示，用于检查 Regular 材质。',
          status: 400,
          code: 'invalid_request',
        });
      if (globalThis.holdInterviewGlass)
        await new Promise((resolve) => {
          globalThis.releaseInterviewGlass = resolve;
        });
      const text =
        '合成回答：描述项目背景、个人职责、技术方案与结果，检查清晰文字和玻璃背景。\n\n'.repeat(12);
      emit({ id: request.id, type: 'delta', text });
      return { answerText: text, usage: null, sources: [] };
    };
  });
  const [main] = await Promise.all([
    app.waitForEvent('window'),
    login.getByRole('button', { name: '使用 ChatGPT 继续', exact: true }).click(),
  ]);
  await main.getByRole('button', { name: '开始面试', exact: true }).click();
  await main.getByRole('button', { name: '确认开始', exact: true }).click();
  const page = await poll(
    async () =>
      app
        .context()
        .pages()
        .find((page) => page.url().endsWith('#interview')),
    Boolean,
    'Interview page missing',
  );
  page.setDefaultTimeout(15000);
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.log('interview:', msg.text());
  });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const probe = (op, value) =>
    app.evaluate(
      ({ BrowserWindow }, { file, op, value }) => {
        const require = process
          .getBuiltinModule('module')
          .createRequire(process.cwd() + '/package.json');
        const win = BrowserWindow.getAllWindows().find((win) =>
          win.webContents.getURL().endsWith('#interview'),
        );
        return require(file)[op](win.getNativeWindowHandle(), value);
      },
      { file: probeFile, op, value },
    );
  const state = async () => JSON.parse(await probe('inspect'));
  const cornerPixels = () =>
    app.evaluate(async ({ BrowserWindow, nativeImage }, file) => {
      const require = process
        .getBuiltinModule('module')
        .createRequire(process.cwd() + '/package.json');
      const win = BrowserWindow.getAllWindows().find((win) =>
        win.webContents.getURL().endsWith('#interview'),
      );
      const result = await require(file).snapshot(win.getNativeWindowHandle());
      const image = nativeImage.createFromBuffer(result.png);
      const { x, y, width, height } = result.crop;
      return [
        [x + 3, y + 3],
        [x + width - 6, y + 3],
        [x + 3, y + height - 6],
        [x + width - 6, y + height - 6],
      ].map(([x, y]) =>
        image
          .crop({ x: Math.round(x), y: Math.round(y), width: 2, height: 2 })
          .toBitmap()
          .toString('base64'),
      );
    }, probeFile);
  const capture = async (label, backdrop = 2) => {
    await probe('backdrop', backdrop);
    await page.waitForTimeout(300);
    const png = await app.evaluate(async ({ BrowserWindow, nativeImage }, file) => {
      const require = process
        .getBuiltinModule('module')
        .createRequire(process.cwd() + '/package.json');
      const win = BrowserWindow.getAllWindows().find((win) =>
        win.webContents.getURL().endsWith('#interview'),
      );
      const result = await require(file).snapshot(win.getNativeWindowHandle());
      return nativeImage.createFromBuffer(result.png).crop(result.crop).toPNG();
    }, probeFile);
    const output = path.resolve(screenshotDirectory ?? testRoot, label + '.png');
    assert.ok(output.startsWith(path.resolve(screenshotDirectory ?? testRoot) + path.sep));
    await writeFile(output, png);
    console.log(JSON.stringify({ preview: output }));
    if (process.argv.includes('--preview') || process.argv.includes('--preview=' + label)) {
      process.stdin.resume();
      await new Promise((resolve) => process.stdin.once('data', resolve));
      process.stdin.pause();
    }
  };
  await page.waitForFunction(() =>
    document.documentElement.classList.contains('macos-interview-glass'),
  );
  await page.evaluate(() => {
    localStorage.setItem('copilot-theme', 'dark');
    window.dispatchEvent(new Event('storage'));
  });
  await main.evaluate(() => window.desktop.setNativeTheme('dark'));
  await probe('backdrop', 2);
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((win) =>
      win.webContents.getURL().endsWith('#interview'),
    );
    win.setContentProtection(false);
    win.focus();
  });
  await page.locator('.answer-bubble').first().waitFor();
  await page.waitForFunction(
    () => document.querySelectorAll('.floating-panel.macos-native-interview-material').length === 2,
  );
  let native = flatten((await state()).tree);
  assert.ok(
    native
      .filter((node) => node.class === 'NSGlassEffectView')
      .every((node) => node.appearance === 'NSAppearanceNameDarkAqua'),
  );
  const clear = native.filter((node) => node.identifier === 'voxcue-interview-clear');
  assert.equal(clear.length, 3, 'Toolbar and both panels must use native Clear');
  assert.ok(
    clear.every((node) =>
      node.children.some(
        (child) =>
          child.class === 'NSGlassEffectView' && child.style === 1 && child.tint.length === 0,
      ),
    ),
  );
  assert.ok(
    native.filter((node) => node.identifier === 'voxcue-interview-regular').length >= 3,
    'Bubbles and composer must use native Regular',
  );
  await page.mouse.move(10, 10);
  await page.waitForTimeout(100);
  const toolbarRect = await page.locator('.floating-toolbar').boundingBox();
  const toolbarButtons = (value) =>
    flatten(value.tree).filter(
      (node) =>
        node.class === 'NSButton' &&
        node.bezelStyle === 1 &&
        node.inGlassContent &&
        node.centerY >= toolbarRect.y &&
        node.centerY <= toolbarRect.y + toolbarRect.height,
    );
  const idleGlassButtons = toolbarButtons(await state()).length;
  assert.equal(idleGlassButtons, 0, 'Toolbar icons must not keep idle button backplates');
  await page.getByRole('button', { name: '面试设置', exact: true }).hover();
  await poll(
    state,
    (value) => toolbarButtons(value).length > idleGlassButtons,
    'Toolbar hover must reveal native glass',
  );
  await page.mouse.move(10, 10);
  await page.waitForTimeout(100);
  assert.ok(
    native.filter(
      (node) => node.class === 'NSGlassEffectView' && node.style === 1 && node.radius === 0,
    ).length >= 2,
    'Continuous panel contours must not become native circular arcs',
  );
  const backgrounds = await page.locator('.macos-native-interview-material').evaluateAll((nodes) =>
    nodes.map((node) => ({
      background: getComputedStyle(node).backgroundColor,
      blur: getComputedStyle(node).backdropFilter,
    })),
  );
  assert.ok(
    backgrounds.every((css) => css.background === 'rgba(0, 0, 0, 0)' && css.blur === 'none'),
    'Legacy web tint/blur must be removed',
  );
  const dimming = native.filter(
    (node) => node.identifier === 'voxcue-interview-dimming' && !node.hidden,
  );
  assert.equal(dimming.length, 3, 'Only Clear toolbar and panels receive a black backing');
  assert.ok(
    dimming.every(
      (node) =>
        node.layerBackground.slice(0, 3).every((v) => v === 0) &&
        Math.abs(node.layerBackground[3] - 0.78) < 0.001,
    ),
  );
  await capture('interview-black-backing-bright', 3);
  await page.getByRole('button', { name: '关闭截图保护', exact: true }).click();
  await page.locator('.floating-capture-notice').waitFor();
  await poll(
    state,
    (value) =>
      flatten(value.tree).some(
        (node) =>
          node.identifier === 'voxcue-interview-dark-notice' &&
          node.children.some(
            (child) =>
              child.class === 'NSGlassEffectView' && child.style === 0 && child.tint[3] === 0.55,
          ),
      ),
    'Only the capture warning receives darker native Regular tint',
  );
  await capture('interview-dark-notice-bright', 3);
  await probe('tintComparison', true);
  await capture('interview-black-tint-comparison', 3);
  await probe('tintComparison', false);
  await capture('interview-glass-dark');
  await page.locator('.floating-answer .floating-scroll').evaluate((node) => {
    node.scrollTop = 0;
  });
  const followPage = await poll(
    async () => {
      for (const candidate of app.context().pages())
        if (!candidate.isClosed() && (await candidate.title()) === 'VoxCue follow')
          return candidate;
    },
    Boolean,
    'Interview follow foreground must be inside the native material',
  );
  const latest = page.locator('.floating-composer .macos-follow-slot > button.follow-latest');
  await latest.waitFor({ state: 'visible' });
  const followRect = await latest.boundingBox(),
    composerRect = await page.locator('.floating-composer').boundingBox();
  assert.ok(
    Math.abs(composerRect.y - followRect.y - followRect.height - 10) < 1.5,
    'Interview latest button has the same 10px composer gap as chat',
  );
  await latest.hover();
  assert.equal(await latest.locator('svg').count(), 1, 'Latest keeps its shared arrow');
  assert.equal(await latest.evaluate((node) => getComputedStyle(node).opacity), '0');
  assert.equal(await followPage.locator('button.follow-latest svg').count(), 1);
  await poll(
    state,
    (value) =>
      flatten(value.tree).some(
        (node) =>
          node.identifier === 'voxcue-follow-material' &&
          node.style === 0 &&
          node.radius === 0 &&
          node.tint[3] === 0.12 &&
          node.foregroundAttached,
      ),
    'Interview latest uses the same untinted Regular as the composer above message text',
  );
  await capture('interview-follow-hover');
  await page.mouse.move(10, 10);
  await poll(
    state,
    (value) =>
      flatten(value.tree).some(
        (node) => node.identifier === 'voxcue-follow-material' && node.tint.length === 0,
      ),
    'Interview follow restores untinted Regular after hover',
  );
  await probe('clickAt', {
    x: followRect.x + followRect.width / 2,
    y: followRect.y + followRect.height / 2,
  });
  await latest.waitFor({ state: 'hidden' });
  const input = page.getByRole('textbox', { name: '面试提问', exact: true });
  await app.evaluate(() => {
    globalThis.holdInterviewGlass = true;
  });
  await input.fill('合成检查：思考中的三点。');
  await input.press('Enter');
  await latest.waitFor({ state: 'visible' });
  await followPage.locator('.follow-latest-dots').waitFor();
  assert.equal(await followPage.locator('.follow-latest-dots > span').count(), 3);
  await poll(
    state,
    (value) =>
      flatten(value.tree).some(
        (node) =>
          node.identifier === 'voxcue-follow-material' && !node.hidden && node.foregroundAttached,
      ),
    'Thinking indicator remains visible in Regular',
  );
  await capture('interview-follow-thinking');
  await app.evaluate(() => {
    globalThis.holdInterviewGlass = false;
    globalThis.releaseInterviewGlass();
  });
  await followPage.locator('.follow-latest-dots').waitFor({ state: 'hidden' });
  await latest.waitFor({ state: 'hidden' });
  await input.fill('合成输入：检查焦点、自动回答开关和共享发送。');
  const auto = page.getByRole('button', { name: '静音后自动提交完整问题', exact: true });
  const oldAuto = await auto.getAttribute('aria-pressed');
  await auto.click();
  assert.notEqual(await auto.getAttribute('aria-pressed'), oldAuto);
  await app.evaluate(() => {
    globalThis.failInterviewGlass = true;
  });
  await input.press('Enter');
  await page.getByRole('alert', { name: '回答生成失败', exact: true }).waitFor();
  await page.waitForFunction(() =>
    document
      .querySelector('.interview-answer-failure')
      ?.classList.contains('macos-native-interview-material'),
  );
  await capture('interview-glass-error');
  await poll(
    state,
    (value) =>
      flatten(value.tree).some(
        (node) =>
          node.class === 'NSButton' &&
          node.title === '重试面试回答' &&
          node.bezelStyle === 1 &&
          node.borderShape === 1 &&
          node.inGlassContent,
      ),
    'Retry uses a native over-glass capsule inside its Regular card',
  );
  await app.evaluate(() => {
    globalThis.failInterviewGlass = false;
  });
  await page.getByRole('button', { name: '重试面试回答', exact: true }).click();
  await page.getByRole('alert', { name: '回答生成失败', exact: true }).waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: '转写面板', exact: true }).click();
  await poll(
    state,
    (value) =>
      flatten(value.tree).filter((node) => node.identifier === 'voxcue-interview-clear').length ===
      2,
    'Hidden transcript glass must be removed',
  );
  await page.getByRole('button', { name: '转写面板', exact: true }).click();
  await page.getByRole('button', { name: '收起面试窗口', exact: true }).click();
  await page.getByRole('button', { name: '展开面试窗口', exact: true }).hover();
  const brandSpacing = await page.locator('.floating-brand').evaluate((node) => {
    const box = node.getBoundingClientRect(),
      first = node.firstElementChild.getBoundingClientRect(),
      last = node.lastElementChild.getBoundingClientRect();
    return { left: first.left - box.left, right: box.right - last.right };
  });
  assert.ok(
    brandSpacing.left >= 14 && brandSpacing.right >= 14,
    'Brand capsule reserves breathing room at both rounded ends',
  );
  await capture('interview-collapsed-brand-hover');
  await poll(
    state,
    (value) =>
      flatten(value.tree).filter((node) => node.identifier === 'voxcue-interview-clear').length ===
        1 &&
      flatten(value.tree).filter((node) => node.identifier === 'voxcue-interview-regular')
        .length === 0,
    'Collapsed window must keep only toolbar glass',
  );
  await page.getByRole('button', { name: '展开面试窗口', exact: true }).click();
  await page.waitForFunction(
    () => document.querySelectorAll('.floating-panel.macos-native-interview-material').length === 2,
  );
  const before = await input.inputValue();
  await input.fill('缩放后仍可输入');
  await page.evaluate(() => window.desktop.resizeInterview(-1));
  await page.waitForTimeout(350);
  assert.equal(await input.inputValue(), '缩放后仍可输入');
  const clearCorners = await cornerPixels();
  await page.getByRole('button', { name: '面试设置', exact: true }).click();
  const settings = page.getByRole('dialog', { name: '面试设置', exact: true });
  await settings.waitFor();
  await page.waitForTimeout(200);
  assert.equal(
    flatten((await state()).tree).some((node) => node.identifier === 'voxcue-dialog-halo'),
    false,
    'Interview settings must not add a native halo',
  );
  assert.deepEqual(
    await cornerPixels(),
    clearCorners,
    'Opening interview settings must preserve all four empty-corner pixels',
  );
  assert.equal(
    await settings.evaluate((node) => getComputedStyle(node, '::backdrop').backgroundColor),
    'rgba(0, 0, 0, 0)',
    'Settings must not dim the whole interview window',
  );
  await page.waitForFunction(() =>
    document
      .querySelector('.interview-settings-dialog [aria-haspopup=menu]')
      ?.classList.contains('macos-content-native'),
  );
  assert.equal(
    await settings.getByRole('slider', { name: '面试背景透明度', exact: true }).count(),
    0,
  );
  assert.ok(
    flatten((await state()).tree).some((node) => node.class === 'NSPopUpButton'),
    'Interview settings must use main-style native popup controls',
  );
  await probe('menuKeys', [53]);
  await settings.getByRole('button', { name: '面试回答模型', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('.dropdown-content[data-state=open]'));
  await settings.waitFor();
  const font = settings.getByRole('slider', { name: '面试字体大小', exact: true });
  await font.scrollIntoViewIfNeeded();
  await poll(
    state,
    (value) =>
      flatten(value.tree).some(
        (node) =>
          node.class === 'NSSlider' &&
          node.minimum === 12 &&
          node.maximum === 24 &&
          node.continuous,
      ),
    'Floating settings use the same native content-area slider',
  );
  const oldFont = Number(await font.inputValue()),
    fontRect = await font.boundingBox();
  assert.ok(
    JSON.parse(
      await probe('clickAt', {
        x: fontRect.x + fontRect.width * 0.8,
        y: fontRect.y + fontRect.height / 2,
      }),
    ).nativeSlider,
  );
  await page.waitForFunction(
    (before) => Number(document.querySelector('input[aria-label="面试字体大小"]').value) !== before,
    oldFont,
  );
  assert.equal(
    await page.evaluate(() => Number(localStorage.getItem('voxcue-interview-font-size-v1'))),
    Number(await font.inputValue()),
  );
  await capture('interview-native-font-slider');
  await settings.locator('.dialog-scroll').evaluate((node) => {
    node.scrollTop = 0;
  });
  await capture('interview-glass-settings');
  await page.getByRole('button', { name: '关闭对话框', exact: true }).click();
  await input.fill(before);
  await page.evaluate(() => {
    localStorage.setItem('copilot-theme', 'light');
    window.dispatchEvent(new Event('storage'));
  });
  await main.evaluate(() => window.desktop.setNativeTheme('light'));
  assert.equal(
    await page
      .locator('.floating-panel h2')
      .first()
      .evaluate((node) => getComputedStyle(node).color),
    'rgb(231, 235, 237)',
  );
  assert.equal(
    await page.locator('.floating-composer').evaluate((node) => getComputedStyle(node).color),
    'rgb(231, 235, 237)',
  );
  await page.mouse.move(10, 10);
  assert.equal(
    await page.locator('.floating-brand').evaluate((node) => getComputedStyle(node).color),
    'rgb(231, 235, 237)',
    'Idle toolbar icons must remain legible over Clear in a light app',
  );
  assert.equal(
    await page.evaluate(() => document.documentElement.classList.contains('dark')),
    true,
  );
  const darkState = await poll(
    state,
    (value) =>
      value.windowAppearance === 'NSAppearanceNameDarkAqua' &&
      value.tree.appearance === 'NSAppearanceNameDarkAqua',
    'Interview window and native content must remain DarkAqua after the main theme changes',
  );
  const lightNative = flatten(darkState.tree);
  assert.equal(
    lightNative[0].appearance,
    'NSAppearanceNameDarkAqua',
    'Main light theme must not change interview native appearance',
  );
  assert.ok(
    lightNative
      .filter((node) => node.identifier === 'voxcue-interview-clear')
      .every((node) =>
        node.children.some(
          (child) =>
            child.class === 'NSGlassEffectView' && child.appearance === 'NSAppearanceNameDarkAqua',
        ),
      ),
  );
  assert.ok(
    lightNative
      .filter((node) => node.identifier === 'voxcue-interview-regular')
      .every((node) =>
        node.children.some(
          (child) =>
            child.class === 'NSGlassEffectView' && child.appearance === 'NSAppearanceNameDarkAqua',
        ),
      ),
  );
  await capture('interview-glass-main-light');
  await exerciseInterviewWindowDrag(app, page);
  await page.waitForFunction(() =>
    document.documentElement.classList.contains('macos-interview-glass'),
  );
  if (screenshotDirectory) {
    await app.evaluate(
      ({ desktopCapturer, nativeImage, screen, BrowserWindow, systemPreferences }) => {
        const status = systemPreferences.getMediaAccessStatus.bind(systemPreferences);
        systemPreferences.getMediaAccessStatus = (type) =>
          type === 'screen' ? 'granted' : status(type);
        desktopCapturer.getSources = async () => {
          const win = BrowserWindow.getAllWindows().find((win) =>
            win.webContents.getURL().endsWith('#interview'),
          );
          return [
            {
              id: 'screen:synthetic',
              display_id: String(screen.getDisplayMatching(win.getBounds()).id),
              thumbnail: nativeImage.createFromBitmap(Buffer.from([70, 140, 200, 255]), {
                width: 1,
                height: 1,
              }),
            },
          ];
        };
      },
    );
    const camera = page.getByRole('button', { name: '截取图像', exact: true });
    await page.waitForFunction(
      () => !document.querySelector('.floating-screenshot-button').disabled,
    );
    const cameraBackplate = async (width, shape, enabled) => {
      const box = await camera.boundingBox();
      await poll(
        state,
        (value) =>
          flatten(value.tree).some(
            (node) =>
              node.class === 'NSButton' &&
              node.inGlassContent &&
              node.bezelStyle === 1 &&
              node.borderShape === shape &&
              node.frameWidth === width &&
              node.frameHeight === 32 &&
              node.enabled === enabled &&
              Math.abs(node.centerX - box.x - box.width / 2) < 1 &&
              Math.abs(node.centerY - box.y - box.height / 2) < 1,
          ),
        'Screenshot must have the actual native circle/capsule, including its disabled state',
      );
    };
    await cameraBackplate(32, 3, true);
    await camera.click();
    await page.waitForFunction(
      () => document.querySelectorAll('.floating-screenshot-preview').length === 1,
    );
    await capture('interview-screenshot-one');
    await cameraBackplate(76, 1, true);
    for (let count = 2; count <= 5; count++) {
      await camera.click();
      await page.waitForFunction(
        (count) => document.querySelectorAll('.floating-screenshot-preview').length === count,
        count,
      );
    }
    await capture('interview-screenshot-five');
    await cameraBackplate(76, 1, false);
  }
  await page.getByRole('button', { name: '结束面试', exact: true }).click();
  const endConfirm = page.getByRole('button', { name: '确认结束面试', exact: true });
  await endConfirm.waitFor();
  await page.waitForTimeout(250);
  const endRect = await endConfirm.boundingBox();
  assert.equal(endRect.height, 32);
  assert.equal(endRect.width, 104);
  const confirmationState = await poll(
    state,
    (value) =>
      flatten(value.tree).some(
        (node) =>
          node.class === 'NSButton' &&
          Math.abs(node.centerX - endRect.x - endRect.width / 2) < 1 &&
          Math.abs(node.centerY - endRect.y - endRect.height / 2) < 1 &&
          node.frameWidth === 104 &&
          node.frameHeight === 32 &&
          node.bezelStyle === 1 &&
          node.inGlassContent &&
          node.borderShape === 1,
      ),
    'The actual end confirmation must have a 104×32 native capsule backplate',
  );
  assert.ok(confirmationState);
  await capture('interview-end-confirm-capsule');
  await page.getByRole('button', { name: '结束面试', exact: true }).waitFor();
  await page.evaluate(() => {
    localStorage.setItem('voxcue-liquid-glass-enabled-v1', 'false');
    window.dispatchEvent(new Event('storage'));
  });
  await page.waitForTimeout(150);
  await page.waitForFunction(() =>
    document.documentElement.classList.contains('macos-interview-glass'),
  );
  assert.ok(
    flatten((await state()).tree).some((node) => node.identifier === 'voxcue-interview-materials'),
    'Legacy preferences cannot disable Liquid Glass',
  );
  assert.equal(
    await main.evaluate(async () => {
      try {
        await window.desktop.setInterviewMaterials([]);
        return false;
      } catch {
        return true;
      }
    }),
    false,
  );
  assert.equal(
    await page.evaluate(async () => {
      try {
        await window.desktop.setInterviewMaterials([{ id: 1, style: 'fake' }]);
        return false;
      } catch {
        return true;
      }
    }),
    true,
  );
  assert.deepEqual(errors, []);
  console.log(
    'PASS: interview Clear backgrounds, Regular bubbles/errors/composer, over-glass controls, source input, collapse, transcript and resize.',
  );
} finally {
  if (app) {
    await closeUiApp(app).catch(() => {});
    await app.close().catch(() => {});
  }
}
