import { captureRequested } from '../../../shared/test/scripts/capture-requested.mjs';
import { testRoot, electron } from '../../../shared/test/scripts/test-workspace.mjs';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {
  installUiAccount,
  connectUiAccount,
  closeUiApp,
} from '../../../shared/test/scripts/install-ui-account.mjs';

await mkdir(path.join(testRoot, 'test/results'), { recursive: true });
const output = await mkdtemp(path.resolve(path.join(testRoot, 'test/results/icons-native-')));
const symbols = JSON.parse(await readFile('src/symbols.json', 'utf8'));
const env = { ...process.env, COPILOT_TEST_USER_DATA: output, VITE_DEV_SERVER_URL: '' };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: ['.'], env });
const checks = [],
  errors = [];
let glyphExtents;
const verifyIcons = async (page, minimum) => {
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .every(
        (animation) =>
          animation.effect?.getTiming().iterations === Infinity ||
          animation.playState !== 'running',
      ),
  );
  const icons = await page.locator('svg').evaluateAll((elements) =>
    elements.map((element) => ({
      name: element.getAttribute('data-sf-symbol'),
      mask: !!element.querySelector('mask image'),
      color: getComputedStyle(element.querySelector('rect') || element).fill,
      width: element.getBoundingClientRect().width,
      canvasWidth: parseFloat(getComputedStyle(element).width),
      canvasHeight: parseFloat(getComputedStyle(element).height),
      size: parseFloat(element.style.getPropertyValue('--icon-size')),
      visible: element.checkVisibility({ opacityProperty: true, visibilityProperty: true }),
    })),
  );
  assert.ok(
    icons.every((item) => item.name && item.mask),
    JSON.stringify(icons),
  );
  // The profile editor stays mounted inside a hidden panel; only visible SVGs
  // have nonzero bounds, while every mounted icon still needs a system symbol.
  assert.ok(icons.filter((item) => item.width > 0).length >= minimum, JSON.stringify(icons));
  assert.deepEqual(
    icons.filter(
      (item) =>
        item.visible &&
        (Math.abs(item.canvasWidth - item.size) > 0.01 ||
          Math.abs(item.canvasHeight - item.size) > 0.01),
    ),
    [],
    'Icons must use their intended component sizes without extra enlargement.',
  );
  if (glyphExtents) {
    const small = icons.filter(
      (item) =>
        item.visible &&
        item.width > 0 &&
        !['textformat.size.smaller', 'textformat.size.larger'].includes(item.name) &&
        item.canvasWidth * glyphExtents[item.name] < item.size * 0.6,
    );
    assert.deepEqual(
      small,
      [],
      'Native artwork keeps its normal canvas and transparent asset margins: ' +
        JSON.stringify(small),
    );
  }
  await page.evaluate(async () => {
    await Promise.all(
      [...document.querySelectorAll('svg image')].map(async (element) => {
        const image = new Image();
        image.src = element.getAttribute('href');
        await image.decode();
      }),
    );
  });
  return icons;
};
try {
  const login = await app.firstWindow();
  await login.getByRole('heading', { name: '登录 VoxCue', exact: true }).waitFor();
  await verifyIcons(login, 4);
  await login.screenshot({ animations: 'disabled' });
  const assets = await app.evaluate(({ nativeImage, app }, symbols) => {
    if (!app.getPath('userData').includes('/test/results/icons-native-'))
      throw Error('Non-test profile');
    return Object.keys(symbols).map((key) => {
      const image = nativeImage.createFromPath(
        app.getAppPath() + '/public/sf-symbols/' + key + '.png',
      );
      const bitmap = image.toBitmap();
      let opaque = 0;
      let top = 192;
      let bottom = -1;
      let left = 192,
        right = -1;
      for (let index = 3; index < bitmap.length; index += 4)
        if (bitmap[index] > 0) {
          opaque++;
          const y = Math.floor(index / 4 / 192);
          top = Math.min(top, y);
          bottom = Math.max(bottom, y);
          const x = ((index - 3) / 4) % 192;
          left = Math.min(left, x);
          right = Math.max(right, x);
        }
      return {
        key,
        size: image.getSize(),
        opaque,
        inkWidth: right - left + 1,
        inkHeight: bottom - top + 1,
        bottom,
      };
    });
  }, symbols);
  assert.equal(assets.length, Object.keys(symbols).length);
  glyphExtents = Object.fromEntries(
    assets.map((item) => [symbols[item.key], Math.max(item.inkWidth, item.inkHeight) / 192]),
  );
  const standardAssets = assets.filter((item) => !item.key.startsWith('Font'));
  assert.ok(
    standardAssets.every((item) => Math.max(item.inkWidth, item.inkHeight) <= 162),
    'Standard symbols must retain transparent margins inside their normal canvas.',
  );
  const chevron = assets.find((item) => item.key === 'ChevronDown');
  assert.ok(
    chevron.inkWidth / chevron.size.width < 0.75,
    'The native chevron must keep its side bearings instead of filling a common ink width.',
  );
  assert.ok(
    assets.every(
      (item) =>
        item.size.width === 192 &&
        item.size.height === 192 &&
        item.opaque > 100 &&
        item.opaque < 192 * 192,
    ),
  );
  const smallFont = assets.find((item) => item.key === 'FontDecrease');
  const largeFont = assets.find((item) => item.key === 'FontIncrease');
  assert.ok(smallFont.inkHeight >= 70, JSON.stringify(smallFont));
  assert.ok(
    largeFont.inkHeight >= smallFont.inkHeight * 1.45,
    JSON.stringify({ smallFont, largeFont }),
  );
  // Native side bearings can differ by a fraction of a point after scaling.
  assert.ok(Math.abs(smallFont.bottom - largeFont.bottom) <= 8);
  checks.push(
    `${assets.length} 个实际 AppKit SF Symbols 均非空、具有透明背景；登录图标使用本平台实现`,
    '字号图标原生笔画加粗、基线对齐，大 A 的实际像素高度至少为小 A 的 1.45 倍',
  );
  await installUiAccount(app, { speech: true, components: true });
  await app.evaluate(({ app }) => {
    const require = process
      .getBuiltinModule('module')
      .createRequire(app.getAppPath() + '/package.json');
    const root = app.getAppPath() + '/dist-electron/';
    const devices = [
      { id: 'output', name: 'Synthetic output', source: 'system', default: true },
      { id: 'input', name: 'Synthetic microphone', source: 'microphone', default: true },
    ];
    require(root + 'macos/electron/speech/access.js').InterviewAccess.prototype.check = async (
      options,
    ) => ({
      ready: true,
      devices,
      checks: options.sources.map((source) => ({
        source,
        status: 'granted',
        message: source === 'system' ? '系统音频可用' : '麦克风可用',
      })),
    });
    require(root + 'shared/electron/backend/speech/host.js').SpeechHost.prototype.call = async (
      call,
    ) => ({
      state: call.op === 'start' ? 'running' : 'idle',
      model: 'Synthetic',
      ...(call.op === 'devices' ? { devices } : {}),
    });
  });
  const page = await connectUiAccount(app, login);
  page.on('pageerror', (error) => errors.push(error.message));
  const surface = page;
  await surface.getByRole('textbox', { name: '聊天消息', exact: true }).waitFor();
  await surface.waitForFunction(() => !document.querySelector('[aria-label="聊天消息"]').disabled);
  await verifyIcons(page, 10);
  await page.screenshot({ animations: 'disabled' });
  await captureRequested(page, 'mac-sf-main');
  await page.getByRole('button', { name: '用户菜单', exact: true }).click();
  await page.getByRole('menuitem', { name: '设置', exact: true }).click();
  const settings = page.getByRole('dialog', { name: '设置', exact: true });
  await settings.waitFor();
  await verifyIcons(page, 20);
  await settings.screenshot({ animations: 'disabled' });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.waitForFunction(() => document.documentElement.classList.contains('dark'));
  const dark = await verifyIcons(page, 20);
  assert.ok(dark.some((item) => item.color !== 'rgb(0, 0, 0)'));
  await settings.screenshot({ animations: 'disabled' });
  await settings.getByRole('button', { name: 'AI 服务', exact: true }).click();
  const officialUsage = settings.getByRole('link', { name: '查看官方用量', exact: true });
  assert.equal(await officialUsage.getAttribute('href'), 'https://chatgpt.com/settings/usage');
  assert.equal(await officialUsage.locator('svg').count(), 0);
  assert.equal(await settings.getByRole('button', { name: '重置用量', exact: true }).count(), 0);
  assert.equal(new Set([symbols.Refresh, symbols.Reset, symbols.Update]).size, 3);
  await settings.getByRole('button', { name: '关于与更新', exact: true }).click();
  await settings.getByRole('button', { name: '检查更新', exact: true }).waitFor();
  assert.equal(
    await settings
      .getByRole('button', { name: '检查更新', exact: true })
      .locator('svg')
      .getAttribute('data-sf-symbol'),
    symbols.Update,
  );
  checks.push('重置、刷新和软件更新分别使用不同的图形，更新设置入口与操作按钮一致');
  await settings.getByRole('button', { name: '面试设置', exact: true }).click();
  await settings.getByRole('slider', { name: '面试字体大小', exact: true }).waitFor();
  assert.equal(
    await settings.getByRole('slider', { name: '面试背景透明度', exact: true }).count(),
    0,
  );
  await settings.getByRole('button', { name: '关闭设置', exact: true }).click();
  checks.push('主界面/设置含菜单、导航、主题、输入和关闭图标均为 SF Symbols，浅深主题继承颜色');
  await page.getByRole('button', { name: '开始面试', exact: true }).click();
  const start = page.getByRole('dialog', { name: '开始面试', exact: true });
  await start.getByRole('button', { name: '确认开始', exact: true }).waitFor();
  const floatingOpened = app.waitForEvent('window');
  await start.getByRole('button', { name: '确认开始', exact: true }).click();
  const floating = await floatingOpened;
  floating.on('pageerror', (error) => errors.push(error.message));
  await floating.getByRole('textbox', { name: '面试提问', exact: true }).waitFor();
  await verifyIcons(floating, 10);
  assert.equal(
    await floating
      .getByRole('button', { name: '面试设置', exact: true })
      .locator('svg')
      .getAttribute('data-sf-symbol'),
    symbols.Settings,
  );
  assert.equal(
    await floating
      .locator('.resize-right svg')
      .evaluate((element) => getComputedStyle(element).transform),
    'matrix(-1, 0, 0, 1, 0, 0)',
  );
  await floating.screenshot({ animations: 'disabled' });
  await floating.emulateMedia({ colorScheme: 'dark' });
  await floating.waitForFunction(() => document.documentElement.classList.contains('dark'));
  await verifyIcons(floating, 10);
  await floating.screenshot({ animations: 'disabled' });
  const closed = floating.waitForEvent('close');
  await floating.evaluate(() => window.desktop.confirmInterviewEnd());
  await closed;
  checks.push(
    '面试浮窗的保护/结束/截图/发送/拖动/缩放全部替换，右下角镜像保持；音频为合成 fixture',
  );
  const cards = [];
  for (const [key, name] of Object.entries(symbols)) {
    const data = (await readFile(path.join('public/sf-symbols', key + '.png'))).toString('base64');
    cards.push(
      `<div class="card"><i style="mask-image:url(data:image/png;base64,${data})"></i><strong>${key}</strong><small>${name}</small></div>`,
    );
  }
  const html = `<!doctype html><meta charset="utf-8"><style>body{margin:0;font:13px -apple-system;color:#222}section{padding:24px;display:grid;grid-template-columns:repeat(5,1fr);gap:10px}.dark{background:#202020;color:#eee}.card{height:78px;display:flex;flex-direction:column;align-items:center;gap:5px}i{display:block;width:26px;height:26px;background:currentColor;mask-size:contain;mask-repeat:no-repeat}small{font-size:10px;opacity:.7}h2{grid-column:1/-1;margin:0 0 12px}</style><section><h2>SF Symbols · Mac · ${assets.length} icons</h2>${cards.join('')}</section><section class="dark"><h2>Dark appearance</h2>${cards.join('')}</section>`;
  const galleryFile = path.join(output, 'gallery.html');
  await writeFile(galleryFile, html);
  const galleryOpened = app.waitForEvent('window');
  await app.evaluate(async ({ BrowserWindow }, file) => {
    const window = new BrowserWindow({
      show: false,
      width: 1100,
      height: 900,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
    });
    await window.loadFile(file);
  }, galleryFile);
  const gallery = await galleryOpened;
  await gallery.screenshot({ fullPage: true });
  await captureRequested(gallery, 'mac-sf-gallery');
  await gallery.close();
  assert.deepEqual(errors, []);
  await console.log(JSON.stringify({ status: 'passed', checks, assets, errors }, null, 2));
  console.log(JSON.stringify({ status: 'passed', output, checks }));
} finally {
  await closeUiApp(app);
}
