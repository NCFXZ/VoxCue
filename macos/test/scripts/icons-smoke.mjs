import { testRoot, electron } from '../../../shared/test/scripts/test-workspace.mjs';
import workspace from '../../../shared/scripts/workspace.mjs';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { installUiAccount, closeUiApp } from '../../../shared/test/scripts/install-ui-account.mjs';

await mkdir(path.join(testRoot, 'test/results'), { recursive: true });
const output = await mkdtemp(path.resolve(path.join(testRoot, 'test/results/icons-native-')));
const symbols = JSON.parse(await readFile('src/symbols.json', 'utf8'));
const env = { ...process.env, COPILOT_TEST_USER_DATA: output, VITE_DEV_SERVER_URL: '' };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: ['.'], env });
const checks = [],
  errors = [];
const verifyIcons = async (page, minimum) => {
  const icons = await page.locator('svg').evaluateAll((elements) =>
    elements.map((element) => ({
      name: element.getAttribute('data-sf-symbol'),
      mask: !!element.querySelector('mask image'),
      color: getComputedStyle(element.querySelector('rect') || element).fill,
      width: element.getBoundingClientRect().width,
    })),
  );
  assert.ok(
    icons.every((item) => item.name && item.mask),
    JSON.stringify(icons),
  );
  // The profile editor stays mounted inside a hidden panel; only visible SVGs
  // have nonzero bounds, while every mounted icon still needs a system symbol.
  assert.ok(icons.filter((item) => item.width > 0).length >= minimum, JSON.stringify(icons));
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
  await login.getByRole('button', { name: '使用 ChatGPT 继续', exact: true }).waitFor();
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
      for (let index = 3; index < bitmap.length; index += 4) if (bitmap[index] > 0) opaque++;
      return { key, size: image.getSize(), opaque };
    });
  }, symbols);
  assert.equal(assets.length, 46);
  assert.ok(
    assets.every(
      (item) =>
        item.size.width === 192 &&
        item.size.height === 192 &&
        item.opaque > 100 &&
        item.opaque < 192 * 192,
    ),
  );
  checks.push('46 个实际 AppKit SF Symbols 均非空、具有透明背景；登录图标使用本平台实现');
  await installUiAccount(app);
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
  const mainOpened = app.waitForEvent('window');
  await login.getByRole('button', { name: '使用 ChatGPT 继续', exact: true }).click();
  const page = await mainOpened;
  page.on('pageerror', (error) => errors.push(error.message));
  await page.getByRole('textbox', { name: '聊天消息', exact: true }).waitFor();
  await page.waitForFunction(() => !document.querySelector('[aria-label="聊天消息"]').disabled);
  await verifyIcons(page, 10);
  await page.screenshot({ animations: 'disabled' });
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
  const html = `<!doctype html><meta charset="utf-8"><style>body{margin:0;font:13px -apple-system;color:#222}section{padding:24px;display:grid;grid-template-columns:repeat(5,1fr);gap:10px}.dark{background:#202020;color:#eee}.card{height:78px;display:flex;flex-direction:column;align-items:center;gap:5px}i{display:block;width:26px;height:26px;background:currentColor;mask-size:contain;mask-repeat:no-repeat}small{font-size:10px;opacity:.7}h2{grid-column:1/-1;margin:0 0 12px}</style><section><h2>SF Symbols · Mac · 46 icons</h2>${cards.join('')}</section><section class="dark"><h2>Dark appearance</h2>${cards.join('')}</section>`;
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
  await gallery.close();
  assert.deepEqual(errors, []);
  await console.log(JSON.stringify({ status: 'passed', checks, assets, errors }, null, 2));
  console.log(JSON.stringify({ status: 'passed', output, checks }));
} finally {
  await closeUiApp(app);
}
