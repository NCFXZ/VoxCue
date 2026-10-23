import { testRoot, electron } from '../../../shared/test/scripts/test-workspace.mjs';
import { offlineElectronEntry } from '../../../shared/test/scripts/offline-electron-entry.mjs';
import { installUiAccount, closeUiApp } from '../../../shared/test/scripts/install-ui-account.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { checkContentControls } from './content-controls-check.mjs';
import { checkComponentControls } from './component-controls-check.mjs';
import { checkSidebarUpdates } from './sidebar-updates-check.mjs';
import { checkLoginControls } from './login-controls-check.mjs';

if (process.platform !== 'darwin' || process.arch !== 'arm64')
  throw Error('Apple Silicon required.');
const probeFile = path.join(testRoot, 'SidebarGlassProbe.node');
const compilation = spawnSync(
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
if (compilation.error) throw compilation.error;
if (compilation.status !== 0) throw Error('Native sidebar probe compilation failed.');

for (const name of ['profile', 'tmp', 'home'])
  await mkdir(path.join(testRoot, name), { recursive: true });
if (process.argv.includes('--updates-only'))
  await writeFile(
    path.join(testRoot, 'profile/update-settings.json'),
    JSON.stringify({ schemaVersion: 1, autoDownload: false }),
  );
const fixture = path.join(testRoot, 'sidebar-glass.cjs');
await writeFile(
  fixture,
  `const {app,dialog}=require('electron');
  dialog.showErrorBox=(title,message)=>{console.error(title,message);app.exit(91);};
  process.on('uncaughtException',error=>{console.error(error.stack);app.exit(92);});
  ${
    process.argv.includes('--updates-only')
      ? `
  const {EventEmitter}=require('node:events');
  const driver=new EventEmitter();
  driver.checkForUpdates=async()=>{driver.emit('update-available',{version:'9.9.9'});};
  driver.downloadUpdate=signal=>new Promise((resolve,reject)=>{
    driver.finish=()=>{driver.emit('update-downloaded');resolve();};
    signal.addEventListener('abort',()=>reject(Error('cancelled')),{once:true});
  });
  driver.quitAndInstall=()=>{throw Error('Native UI test must not install updates');};
  globalThis.sidebarUpdateDriver=driver;
  require(${JSON.stringify(path.resolve('dist-electron/shared/electron/backend/updates/driver.js'))}).createUpdateDriver=()=>driver;
  `
      : ''
  }
  require(${JSON.stringify(path.resolve('dist-electron/shared/electron/main.js'))});`,
);
const env = {
  ...process.env,
  COPILOT_TEST_USER_DATA: path.join(testRoot, 'profile'),
  CFFIXED_USER_HOME: path.join(testRoot, 'home'),
  TMPDIR: path.join(testRoot, 'tmp'),
  VITE_DEV_SERVER_URL: '',
};
delete env.ELECTRON_RUN_AS_NODE;

const flatten = (node) => [node, ...(node.children ?? []).flatMap(flatten)];
const poll = async (read, expected, message) => {
  const deadline = Date.now() + 15000;
  do {
    const value = await read();
    if (expected(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  } while (Date.now() < deadline);
  throw Error(message);
};
const contentPreview = process.argv.includes('--content-preview');
const previewLabel = process.argv.find((arg) => arg.startsWith('--preview='))?.slice(10);
const preview = process.argv.includes('--preview') || contentPreview || !!previewLabel;
const pausePreview = async () => {
  if (!preview) return;
  process.stdin.resume();
  await new Promise((resolve) => process.stdin.once('data', resolve));
  process.stdin.pause();
};
let app;
try {
  app = await electron.launch({ args: [await offlineElectronEntry(fixture)], env });
  app.process().stderr.on('data', (data) => process.stdout.write(data));
  app
    .process()
    .on('exit', (code, signal) => console.log('test application exited', { code, signal }));
  const login = await app.firstWindow();
  await login.getByRole('button', { name: '使用 ChatGPT 继续', exact: true }).waitFor();
  if (process.argv.includes('--login-only')) {
    await checkLoginControls({ app, page: login, probeFile, poll });
    await closeUiApp(app);
    app = undefined;
    process.exit(0); // test-workspace's exit hook removes the owned temporary root.
  }
  await installUiAccount(app, { components: true, speech: true });
  await app.evaluate(({ app, session, BrowserWindow, webContents }) => {
    // A rebuild may remove the original hashed CSS asset. Deny stylesheet
    // reloads by projection children while preserving the offline boundary.
    session.defaultSession.webRequest.onBeforeRequest((request, callback) => {
      const contents = webContents.fromId(request.webContentsId),
        win = contents && BrowserWindow.fromWebContents(contents);
      callback({
        cancel:
          /^(https?|wss?):/.test(request.url) ||
          (request.resourceType === 'stylesheet' && !!win?.getParentWindow()),
      });
    });
    const require = process
      .getBuiltinModule('module')
      .createRequire(app.getAppPath() + '/package.json');
    const { ChatGPTService } = require(
      app.getAppPath() + '/dist-electron/shared/electron/backend/chat/service.js',
    );
    const { InterviewAccess } = require(
      app.getAppPath() + '/dist-electron/macos/electron/speech/access.js',
    );
    InterviewAccess.prototype.check = async (options) => ({
      ready: true,
      checks: options.sources.map((source) => ({
        source,
        status: 'granted',
        message: 'Synthetic',
      })),
      devices: [
        { id: 'output', source: 'system', name: '合成播放设备', default: true },
        { id: 'input', source: 'microphone', name: '合成麦克风', default: true },
      ],
    });
    ChatGPTService.prototype.stream = async (request, emit) => {
      const text = Array.from(
        { length: 30 },
        (_, i) =>
          `合成回答第${i + 1}段：这是用于检查顶部和底部系统虚化、布局与阅读对比度的测试文字。内容覆盖整个聊天列，保持原有输入、选择和滚动行为。`,
      ).join('\n\n');
      emit({ id: request.id, type: 'delta', text });
      return { answerText: text, usage: null, sources: [] };
    };
  });
  const [page] = await Promise.all([
    app.waitForEvent('window'),
    login.getByRole('button', { name: '使用 ChatGPT 继续', exact: true }).click(),
  ]);
  page.setDefaultTimeout(15000);
  page.on('console', (message) => console.log('page:', message.text()));
  page.on('pageerror', (error) => console.log('renderer error:', error.message));
  const probe = (op, value) =>
    app.evaluate(
      ({ BrowserWindow }, { file, op, value }) => {
        const require = process
          .getBuiltinModule('module')
          .createRequire(process.cwd() + '/package.json');
        const win = BrowserWindow.getAllWindows().find((win) => win.getTitle() === 'VoxCue');
        return require(file)[op](win.getNativeWindowHandle(), value);
      },
      { file: probeFile, op, value },
    );
  const state = async () => JSON.parse(await probe('inspect'));
  const headerIn = (value) =>
    flatten(value.tree).find((node) => node.identifier === 'voxcue-header-material');
  await page.waitForFunction(() =>
    document.documentElement.classList.contains('native-scroll-chrome'),
  );
  await poll(state, (value) => headerIn(value)?.alpha === 0, 'Empty header must be transparent');
  await new Promise((resolve) => setTimeout(resolve, 1000));
  let surface = await poll(
    async () => {
      for (const candidate of app.context().pages())
        if (!candidate.isClosed() && (await candidate.title()) === 'VoxCue composer')
          return candidate;
    },
    Boolean,
    'Composer foreground missing',
  );
  assert.ok(surface);
  await surface.getByRole('textbox', { name: '聊天消息', exact: true }).waitFor();
  const projectionStyle = await surface.evaluate(() => {
    const textarea = document.querySelector('textarea'),
      css = getComputedStyle(textarea);
    return {
      snapshot: !!document.querySelector('style[data-presentation-styles="loaded"]'),
      links: document.querySelectorAll('link[rel="stylesheet"]').length,
      border: css.borderTopWidth,
      font: css.fontSize,
      files: [...document.querySelectorAll('input[type=file]')].map((node) => ({
        width: node.getBoundingClientRect().width,
        height: node.getBoundingClientRect().height,
        overflow: getComputedStyle(node).overflow,
        clip: getComputedStyle(node).clip,
        clipPath: getComputedStyle(node).clipPath,
      })),
    };
  });
  assert.equal(projectionStyle.snapshot, true, 'Projection must reuse already loaded style rules');
  assert.equal(
    projectionStyle.links,
    0,
    'Projection must not reload potentially obsolete CSS assets',
  );
  assert.equal(projectionStyle.border, '0px', 'Textarea must retain the shared styling');
  assert.equal(projectionStyle.font, '14px');
  assert.equal(projectionStyle.files.length, 2);
  assert.ok(
    projectionStyle.files.every(
      (node) =>
        node.width <= 1 &&
        node.height <= 1 &&
        ['hidden', 'clip'].includes(node.overflow) &&
        node.clipPath === 'inset(50%)',
    ),
    'File pickers must remain visually hidden: ' + JSON.stringify(projectionStyle),
  );
  await probe('backdrop', 0);
  await app.evaluate(({ app, BrowserWindow }) => {
    app.focus({ steal: true });
    BrowserWindow.getAllWindows()
      .find((win) => win.getTitle() === 'VoxCue')
      .focus();
  });
  await page.waitForFunction(
    () => !document.documentElement.classList.contains('macos-window-inactive'),
  );
  const aligned = await poll(
    state,
    (value) =>
      flatten(value.tree).filter((node) => node.class === 'VoxCueMaterialButton' && node.title)
        .length === 2,
    'Native toolbar buttons missing',
  );
  const nativeTitle = flatten(aligned.tree).find(
    (node) => node.identifier === 'voxcue-header-title',
  );
  assert.equal(
    nativeTitle.frameHeight,
    nativeTitle.fittingHeight,
    'Title must use its natural AppKit line height',
  );
  for (const button of flatten(aligned.tree).filter(
    (node) => node.class === 'VoxCueMaterialButton' && node.title,
  )) {
    assert.equal(button.frameHeight, 36, 'Native toolbar must preserve the 36px DOM height');
    assert.ok(
      Math.abs(button.centerY - nativeTitle.centerY) <= 0.5,
      'Title and toolbar buttons must share their horizontal center line: ' +
        JSON.stringify({ button, nativeTitle }),
    );
  }
  const capture = async (label) => {
    const output = path.join(testRoot, label + '.png');
    const source = await page.evaluate(() => ({
      native: document.documentElement.classList.contains('native-scroll-chrome'),
      title: document.querySelector(
        '.preparation-route:not([hidden]) .page-toolbar strong,.management-page .page-toolbar strong',
      )?.textContent,
      detail: !!document.querySelector('.history-detail'),
      modal: document.querySelector('dialog[open]')?.getBoundingClientRect().toJSON(),
    }));
    await poll(
      state,
      (value) => {
        const nodes = flatten(value.tree),
          title = nodes.find((n) => n.identifier === 'voxcue-header-title');
        if (!source.native)
          return !title && !nodes.some((node) => node.class === 'VoxCueModalBackground');
        if (source.title && title?.text !== source.title) return false;
        if (source.detail && title) return false;
        if (source.modal) {
          const native = nodes.find((n) => n.class === 'VoxCueModalBackground');
          const numbers = native?.exclusion?.match(/-?[\d.]+/g)?.map(Number);
          if (
            !numbers ||
            Math.abs(numbers[0] - source.modal.x) > 1 ||
            Math.abs(numbers[2] - source.modal.width) > 1 ||
            Math.abs(numbers[3] - source.modal.height) > 1
          )
            return false;
        }
        return true;
      },
      'Native header/modal geometry must match the current route and dialog',
    );
    await app.evaluate(
      async ({ app, BrowserWindow }, { file, output }) => {
        const require = process
          .getBuiltinModule('module')
          .createRequire(process.cwd() + '/package.json');
        const win = BrowserWindow.getAllWindows().find((win) => win.getTitle() === 'VoxCue');
        app.focus({ steal: true });
        win.focus();
        const protectedWindow = win.isContentProtected();
        win.setContentProtection(false);
        try {
          await new Promise((resolve) => setTimeout(resolve, 300));
          const { png } = await require(file).snapshot(win.getNativeWindowHandle());
          require('node:fs').writeFileSync(output, png);
        } finally {
          win.setContentProtection(protectedWindow);
        }
      },
      { file: probeFile, output },
    );
    console.log(JSON.stringify({ preview: output }));
    if (
      (!contentPreview || label.startsWith('content-')) &&
      (!previewLabel || previewLabel === label)
    )
      await pausePreview();
  };
  const buttonsIn = (value) =>
    flatten(value.tree).filter((node) => node.class === 'VoxCueMaterialButton');
  assert.ok(
    buttonsIn(await state()).every(
      (node) => node.bezelStyle === 16 && node.tintProminence === 1 && !node.bezelColor.length,
    ),
  );
  const choose = async (trigger, keys) => {
    const anchor = await trigger.boundingBox();
    if (typeof keys === 'string') await probe('selectMenuItem', keys);
    else await probe('menuKeys', keys);
    await trigger.click();
    await page.waitForFunction(
      () => !document.querySelector('.dropdown-content[data-state="open"]'),
    );
    const native = await state();
    if (native.menuFrame?.height) {
      const menu = native.menuFrame;
      assert.ok(
        Math.min(
          Math.abs(menu.y + menu.height - anchor.y),
          Math.abs(menu.y - anchor.y - anchor.height),
        ) < 14,
        'Native menu must touch its trigger edge',
      );
    }
    assert.equal(
      buttonsIn(native).length,
      (await page.locator('.preparation-route:not([hidden])').count()) ? 3 : 1,
    );
    return native.menuItems;
  };
  if (process.argv.includes('--updates-only')) {
    await checkSidebarUpdates({ app, page, state, poll, probe, probeFile });
    if (preview) {
      console.log('更新演示已停在“重启以更新”，按 Enter 后关闭演示；不会执行真实更新。');
      await Promise.race([pausePreview(), page.waitForEvent('close', { timeout: 0 })]);
      process.stdin.pause();
    }
  } else if (process.argv.includes('--components-only')) {
    await checkComponentControls({ app, page, state, poll, capture, choose });
  } else if (process.argv.includes('--content-only') || process.argv.includes('--copy-only')) {
    await checkContentControls({
      app,
      page,
      state,
      probe,
      poll,
      capture,
      choose,
      copyOnly: process.argv.includes('--copy-only'),
    });
  } else {
    assert.ok(surface);
    const input = surface.getByRole('textbox', { name: '聊天消息', exact: true });
    await input.waitFor({ state: 'visible' });
    await surface.waitForFunction(() => !document.querySelector('textarea').disabled);
    const rect = await input.boundingBox();
    await probe('clickAt', { x: rect.x + 40, y: rect.y + 15 });
    await surface.waitForFunction(() => document.activeElement?.tagName === 'TEXTAREA', null, {
      timeout: 15000,
    });
    await surface.keyboard.type('native input');
    assert.match(await input.inputValue(), /native input/);
    await input.fill('合成测试：请生成一段较长的回答。');
    await surface.getByRole('button', { name: '发送消息', exact: true }).click();
    await page.locator('.chat-message.assistant').waitFor();
    assert.deepEqual(
      await page.locator('.conversation-row.active').evaluate((node) => {
        const marker = getComputedStyle(node, '::before');
        return [marker.width, marker.height, marker.borderRadius, marker.cornerShape];
      }),
      ['3px', '18px', '999px', 'round'],
      'Liquid Glass must use the shared capsule selection marker',
    );
    await page.waitForFunction(() => {
      const scroll = document.querySelector('.chat-scroll');
      return scroll && scroll.scrollHeight > scroll.clientHeight;
    });
    await page.locator('.chat-scroll').evaluate((element) => {
      element.scrollTop = 400;
    });
    await new Promise((resolve) => setTimeout(resolve, 400));
    await poll(
      state,
      (value) => headerIn(value)?.alpha === 1 && headerIn(value)?.style === 0,
      'Content behind the header must enable native Regular glass',
    );
    await poll(
      state,
      (value) =>
        flatten(value.tree).filter((node) => node.class === 'VoxCueForegroundSurface').length === 2,
      'Composer and follow button need independent native Regular surfaces',
    );
    const followPage = await poll(
      async () => {
        for (const candidate of app.context().pages())
          if (!candidate.isClosed() && (await candidate.title()) === 'VoxCue follow')
            return candidate;
      },
      Boolean,
      'Native follow foreground missing',
    );
    // The projection is inert artwork. Pointer actions belong to the original
    // accessible shared button, whose hit target remains in the parent page.
    await page.locator('.macos-follow-slot > button.follow-latest').hover();
    await poll(
      state,
      (value) =>
        flatten(value.tree).some(
          (node) =>
            node.identifier === 'voxcue-follow-material' &&
            Math.abs((node.tint[3] ?? 0) - 0.12) < 0.001,
        ),
      'Hover must brighten the current Regular follow surface',
    );
    await page.mouse.move(900, 100);
    await poll(
      state,
      (value) =>
        flatten(value.tree).some(
          (node) => node.identifier === 'voxcue-follow-material' && node.tint.length === 0,
        ),
      'Leaving follow restores the composer material',
    );
    const foregrounds = flatten((await state()).tree).filter(
      (node) => node.class === 'VoxCueForegroundSurface',
    );
    if (foregrounds.some((node) => Object.hasOwn(node, 'interactive')))
      assert.ok(
        foregrounds.some((node) => node.interactive),
        'Follow button must use the public interactive glass response when supported',
      );
    assert.ok(
      flatten((await state()).tree)
        .filter((node) => node.class === 'VoxCueForegroundSurface')
        .every((node) => node.style === 0 && node.tint.length === 0),
    );
    await capture('native-scrolled');
    const verifyComposer = async () => {
      const slot = await page.locator('.macos-composer-slot').boundingBox();
      const form = await surface.locator('form').boundingBox();
      const viewport = await surface.evaluate(() => ({ width: innerWidth, height: innerHeight }));
      assert.ok(
        Math.abs(form.x - slot.x) < 1 && Math.abs(form.y - slot.y) < 1,
        'Composer foreground must follow its shared anchor',
      );
      assert.ok(
        Math.abs(form.width - slot.width) < 2 && Math.abs(form.height - slot.height) < 2,
        'Native and shared composer sizes must agree',
      );
      assert.equal(viewport.width, await page.evaluate(() => innerWidth));
      assert.ok(
        (await state()).trafficLights.every((light) => Math.abs(light.centerY - 25) < 1),
        'Traffic lights must remain at their configured vertical position',
      );
      return slot;
    };
    const original = await verifyComposer();
    for (let i = 0; i < 2; i++) {
      await page.getByRole('button', { name: '个人信息', exact: true }).click();
      assert.equal(
        await page
          .getByRole('button', { name: '个人信息', exact: true })
          .getAttribute('aria-expanded'),
        'true',
      );
      await page.waitForTimeout(300);
      await verifyComposer();
      await page.getByRole('button', { name: '个人信息', exact: true }).click();
      assert.equal(
        await page
          .getByRole('button', { name: '个人信息', exact: true })
          .getAttribute('aria-expanded'),
        'false',
      );
      await page.waitForTimeout(300);
      const restored = await verifyComposer();
      assert.ok(
        Math.abs(restored.x - original.x) < 1 && Math.abs(restored.width - original.width) < 1,
        'Profile close must restore composer geometry',
      );
    }
    await capture('native-profile-restored');
    await page.getByRole('button', { name: '收起侧栏', exact: true }).click();
    await page.waitForTimeout(300);
    await verifyComposer();
    await page.getByRole('button', { name: '展开侧栏', exact: true }).click();
    await page.waitForTimeout(300);
    await verifyComposer();
    const attachmentItems = await choose(
      surface.getByRole('button', { name: '添加附件', exact: true }),
      [53],
    );
    assert.deepEqual(
      attachmentItems
        .filter((item) => !item.separator)
        .map((item) => [item.title, item.imageVisible]),
      [
        ['添加文件', true],
        ['添加文件夹', true],
        ['网络搜索', true],
      ],
    );
    const modelItems = await choose(
      surface.getByRole('button', { name: '聊天模型', exact: true }),
      [53],
    );
    assert.ok(
      modelItems.find((item) => item.title === '刷新模型列表')?.imageVisible,
      'Refresh models must retain its visible leading icon',
    );
    await choose(surface.getByRole('button', { name: '思考强度', exact: true }), [53]);
    const accountItems = await choose(
      page.getByRole('button', { name: '用户菜单', exact: true }),
      '设置',
    );
    assert.ok(accountItems.filter((item) => !item.separator).every((item) => item.imageVisible));
    const settings = page.getByRole('dialog', { name: '设置', exact: true });
    await settings.waitFor();
    await new Promise((resolve) => setTimeout(resolve, 250));
    const modal = await state();
    assert.equal(buttonsIn(modal).length, 3);
    assert.ok(buttonsIn(modal).every((node) => node.bezelStyle === 16));
    assert.ok(flatten(modal.tree).some((node) => node.class === 'VoxCueModalBackground'));
    assert.ok(
      flatten(modal.tree)
        .filter((node) => node.class === 'VoxCueForegroundSurface')
        .every((node) => !node.maskCorner),
      'Dialog exclusion must not invert rounded surface corners',
    );
    await capture('native-settings');
    const profile = await page.getByRole('button', { name: '个人信息', exact: true }).boundingBox();
    await app.evaluate(({ app, BrowserWindow }) => {
      app.focus({ steal: true });
      BrowserWindow.getAllWindows()
        .find((win) => win.getTitle() === 'VoxCue')
        .focus();
    });
    await page.waitForFunction(
      () => !document.documentElement.classList.contains('macos-window-inactive'),
    );
    await probe('clickAt', { x: profile.x + profile.width / 2, y: profile.y + profile.height / 2 });
    await settings.waitFor({ state: 'hidden' });
    assert.equal(
      await page
        .getByRole('button', { name: '个人信息', exact: true })
        .getAttribute('aria-expanded'),
      'false',
    );
    await choose(page.getByRole('button', { name: '用户菜单', exact: true }), '设置');
    await settings.waitFor();
    const accents = await choose(
      settings.getByRole('button', { name: '主题色', exact: true }),
      [53],
    );
    assert.ok(accents.filter((item) => !item.separator).every((item) => item.imageVisible));
    const themeItems = await choose(
      settings.getByRole('button', { name: '外观主题', exact: true }),
      '深色',
    );
    assert.ok(themeItems.filter((item) => !item.separator).every((item) => item.imageVisible));
    await page.waitForFunction(() => document.documentElement.classList.contains('dark'));
    await page.waitForTimeout(250);
    await capture('native-settings-dark');
    await settings.getByRole('button', { name: '关闭设置', exact: true }).click();
    await settings.waitFor({ state: 'hidden' });
    await new Promise((resolve) => setTimeout(resolve, 250));
    assert.ok(
      !flatten((await state()).tree).some((node) => node.class === 'VoxCueModalBackground'),
      'Closing settings must remove dimming',
    );
    await capture('native-dark-scrolled');
    assert.ok(
      await page.evaluate(() =>
        document.documentElement.classList.contains('native-scroll-chrome'),
      ),
      'Settings close must preserve native glass',
    );
    assert.ok(
      flatten((await state()).tree)
        .filter((node) => ['NSGlassEffectView', 'VoxCueForegroundSurface'].includes(node.class))
        .every((node) => node.appearance === 'NSAppearanceNameDarkAqua'),
    );
    await page.locator('.chat-scroll').evaluate((element) => {
      element.scrollTop = 0;
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    await poll(
      state,
      (value) => headerIn(value)?.alpha === 0,
      'Header must clear again at the start of the conversation',
    );
    const before = await page.locator('.chat-scroll').evaluate((element) => element.scrollTop);
    await input.fill('多行输入\n'.repeat(8));
    assert.equal(
      await page.locator('.chat-scroll').evaluate((element) => element.scrollTop),
      before,
    );
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((win) => win.getTitle() === 'VoxCue')
        .setSize(960, 680),
    );
    await page.waitForFunction(() => innerWidth === 960 && innerHeight === 680);
    await new Promise((resolve) => setTimeout(resolve, 250));
    await verifyComposer();
    await capture('native-narrow');
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((win) => win.getTitle() === 'VoxCue')
        .blur(),
    );
    await page.waitForFunction(() =>
      document.documentElement.classList.contains('macos-window-inactive'),
    );
    assert.ok(buttonsIn(await state()).every((node) => node.bezelStyle === 16));
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((win) => win.getTitle() === 'VoxCue')
        .focus(),
    );
    await page.waitForFunction(
      () => !document.documentElement.classList.contains('macos-window-inactive'),
    );
    await choose(page.getByRole('button', { name: '用户菜单', exact: true }), '设置');
    await settings.waitFor();
    assert.equal(
      await settings.getByRole('switch', { name: 'Liquid Glass', exact: true }).count(),
      0,
    );
    await page.evaluate(() => {
      localStorage.setItem('voxcue-liquid-glass-enabled-v1', 'false');
      window.dispatchEvent(new Event('storage'));
    });
    await page.waitForFunction(
      () => !document.documentElement.classList.contains('native-scroll-chrome'),
    );
    assert.equal(
      await page.evaluate(() => localStorage.getItem('voxcue-liquid-glass-enabled-v1')),
      'false',
    );
    await page.evaluate(() => {
      localStorage.setItem('voxcue-liquid-glass-enabled-v1', 'true');
      window.dispatchEvent(new Event('storage'));
    });
    await page.waitForFunction(() =>
      document.documentElement.classList.contains('native-scroll-chrome'),
    );
    await settings.getByRole('button', { name: '关闭设置', exact: true }).click();
    await settings.waitFor({ state: 'hidden' });
    await page.waitForTimeout(300);
    surface = await poll(
      async () => {
        for (const candidate of app.context().pages())
          if (!candidate.isClosed() && (await candidate.title()) === 'VoxCue composer')
            return candidate;
      },
      Boolean,
      'Composer did not return after enabling glass',
    );
    await verifyComposer();
    await page.reload();
    await page.waitForFunction(() =>
      document.documentElement.classList.contains('native-scroll-chrome'),
    );
    await checkContentControls({ app, page, state, probe, poll, capture, choose });
    console.log(
      'native menus, settings stacking, focus appearance, paused reading, resize and reload passed',
    );
    console.log('native pointer, input, shared submit and scroll passed');
  }
} catch (error) {
  console.error(error);
  throw error;
} finally {
  if (app && app.process().exitCode === null && app.process().signalCode === null)
    await closeUiApp(app);
}
