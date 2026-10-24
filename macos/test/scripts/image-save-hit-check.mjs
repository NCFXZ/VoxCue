import { testRoot, electron } from '../../../shared/test/scripts/test-workspace.mjs';
import { installUiAccount } from '../../../shared/test/scripts/install-ui-account.mjs';
import { mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import assert from 'node:assert/strict';

const probeFile = path.join(testRoot, 'ImageSaveProbe.node');
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
for (const name of ['profile', 'home', 'tmp']) await mkdir(path.join(testRoot, name));
const env = {
  ...process.env,
  COPILOT_TEST_USER_DATA: path.join(testRoot, 'profile'),
  CFFIXED_USER_HOME: path.join(testRoot, 'home'),
  TMPDIR: path.join(testRoot, 'tmp'),
  VITE_DEV_SERVER_URL: '',
};
delete env.ELECTRON_RUN_AS_NODE;
const flatten = (node) => [node, ...(node.children ?? []).flatMap(flatten)];
const poll = async (read, expected, label) => {
  const end = Date.now() + 15000;
  do {
    const value = await read();
    if (expected(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  } while (Date.now() < end);
  throw Error(label);
};
let app;
try {
  app = await electron.launch({ args: ['.'], env });
  console.log('Isolated screenshot fixture launched');
  await installUiAccount(app, { components: true });
  const login = await app.firstWindow();
  const [page] = await Promise.all([
    app.waitForEvent('window'),
    login.getByRole('button', { name: '使用 ChatGPT 继续', exact: true }).click(),
  ]);
  page.setDefaultTimeout(15000);
  console.log('Synthetic account signed in');
  const id = '9aa55ec0-3a14-4d67-81ab-27ad56ba12de';
  await app.evaluate(async ({ app, nativeImage, dialog, BrowserWindow }, id) => {
    const fs = process.getBuiltinModule('fs/promises'),
      path = process.getBuiltinModule('path');
    const directory = path.join(app.getPath('userData'), 'interview-images-v1');
    await fs.mkdir(directory, { recursive: true });
    const image = nativeImage.createFromBitmap(Buffer.alloc(320 * 200 * 4, 200), {
      width: 320,
      height: 200,
      scaleFactor: 1,
    });
    if (image.isEmpty()) throw Error('Synthetic image unavailable');
    await fs.writeFile(path.join(directory, id + '.image'), image.toPNG());
    await fs.writeFile(path.join(directory, id.slice(0, -1) + 'f.image'), image.toPNG());
    await fs.writeFile(
      path.join(directory, id + '.preview'),
      'data:image/jpeg;base64,' + image.toJPEG(75).toString('base64'),
    );
    await fs.writeFile(
      path.join(directory, id.slice(0, -1) + 'f.preview'),
      'data:image/jpeg;base64,' + image.toJPEG(75).toString('base64'),
    );
    globalThis.imageSaveClicks = 0;
    dialog.showSaveDialog = async () => {
      globalThis.imageSaveClicks++;
      return { canceled: true };
    };
    app.focus({ steal: true });
    const win = BrowserWindow.getAllWindows().find((win) => win.getTitle() === 'VoxCue');
    win.setSize(1280, 800);
    win.focus();
  }, id);
  await page.evaluate((id) => {
    const time = Date.now();
    localStorage.setItem(
      'copilot-interview-history-v1',
      JSON.stringify([
        {
          id: 'image-hit-test',
          title: '合成图片命中检查',
          titleStatus: 'ready',
          startedAt: time - 1000,
          endedAt: time,
          status: 'ended',
          mock: false,
          transcripts: [],
          answers: [
            {
              id: 'answer',
              question: '合成截图',
              content: '合成回答',
              provider: 'chatgpt',
              screenshot: 'only',
              images: [{ id }, { id: id.slice(0, -1) + 'f' }],
            },
          ],
        },
      ]),
    );
    window.dispatchEvent(new StorageEvent('storage', { key: 'copilot-interview-history-v1' }));
  }, id);
  await page.getByRole('button', { name: '面试记录', exact: true }).click();
  await page.locator('.history-row').first().click();
  await page.locator('.record-images-section .interview-image-thumbnail').first().click();
  const viewer = page.getByRole('dialog', { name: '截图', exact: true });
  const save = viewer.getByRole('button', { name: '保存图片', exact: true });
  await poll(() => save.isEnabled(), Boolean, 'Save never enabled');
  await page.waitForFunction(() =>
    document.querySelector('.interview-image-save')?.classList.contains('macos-content-native'),
  );
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
  const native = async () =>
    flatten(JSON.parse(await probe('inspect')).tree).find(
      (node) => node.identifier === 'voxcue-image-save',
    );
  const clicks = () => app.evaluate(() => globalThis.imageSaveClicks);
  const nodes = async () => flatten(JSON.parse(await probe('inspect')).tree);
  await poll(
    nodes,
    (items) =>
      items.filter((node) => node.identifier === 'voxcue-image-overlay-regular').length === 3 &&
      items.some(
        (node) =>
          node.identifier === 'voxcue-image-page-number' &&
          node.text === '1 / 2' &&
          node.frameWidth > 0 &&
          node.frameHeight > 0,
      ),
    'Regular navigation and native page label must be laid out',
  );
  await viewer.press('ArrowRight');
  await poll(
    nodes,
    (items) =>
      items.some((node) => node.identifier === 'voxcue-image-page-number' && node.text === '2 / 2'),
    'Native page label did not update',
  );
  await viewer.press('ArrowLeft');
  for (const theme of ['light', 'dark']) {
    await app.evaluate(({ nativeTheme }, theme) => {
      nativeTheme.themeSource = theme;
    }, theme);
    await page.emulateMedia({ colorScheme: theme });
    await page.waitForFunction(
      (dark) => document.documentElement.classList.contains('dark') === dark,
      theme === 'dark',
    );
    for (const [width, height] of [
      [1280, 800],
      [1000, 720],
    ]) {
      await app.evaluate(
        ({ BrowserWindow }, [width, height]) => {
          BrowserWindow.getAllWindows()
            .find((win) => win.getTitle() === 'VoxCue')
            .setSize(width, height);
        },
        [width, height],
      );
      await page.waitForFunction(
        ([width, height]) => innerWidth === width && innerHeight === height,
        [width, height],
      );
      await page.mouse.move(width - 100, height - 100);
      const rect = await save.boundingBox();
      const state = await poll(
        native,
        (node) =>
          node &&
          !node.borderEmphasized &&
          Math.abs(node.centerX - rect.x - rect.width / 2) <= 1 &&
          Math.abs(node.centerY - rect.y - rect.height / 2) <= 1,
        'Native save geometry did not settle',
      );
      assert.equal(
        state.foregroundColor[0] > 0.5,
        theme === 'dark',
        'Native foreground must match actual appearance',
      );
      if (process.argv.includes('--preview') && width === 1280) {
        await probe('backdrop', 2);
        await page.waitForTimeout(300);
        const output = path.join(testRoot, 'screenshot-viewer-' + theme + '.png');
        await app.evaluate(
          async ({ BrowserWindow, nativeImage }, { file, output }) => {
            const require = process
              .getBuiltinModule('module')
              .createRequire(process.cwd() + '/package.json');
            const win = BrowserWindow.getAllWindows().find((win) => win.getTitle() === 'VoxCue');
            const protectedWindow = win.isContentProtected();
            win.setContentProtection(false);
            try {
              const shot = await require(file).snapshot(win.getNativeWindowHandle());
              require('node:fs').writeFileSync(
                output,
                nativeImage.createFromBuffer(shot.png).crop(shot.crop).toPNG(),
              );
            } finally {
              win.setContentProtection(protectedWindow);
            }
          },
          { file: probeFile, output },
        );
        console.log(JSON.stringify({ preview: output }));
        process.stdin.resume();
        await new Promise((resolve) => process.stdin.once('data', resolve));
        process.stdin.pause();
      }
      console.log(
        JSON.stringify({
          theme,
          width,
          height,
          rect,
          center: [state.centerX, state.centerY],
          imageCenter: [state.imageCenterX, state.imageCenterY],
        }),
      );
      assert.ok(
        Math.abs(state.centerX - rect.x - rect.width / 2) <= 1,
        'Native horizontal center differs from DOM',
      );
      assert.ok(
        Math.abs(state.centerY - rect.y - rect.height / 2) <= 1,
        'Native vertical center differs from DOM',
      );
      assert.ok(
        Math.abs(state.imageCenterX - state.centerX) <= 1,
        'Native image horizontal center differs',
      );
      assert.ok(
        Math.abs(state.imageCenterY - state.centerY) <= 1,
        'Native image vertical center differs',
      );
      for (const [dx, dy] of [
        [0, 0],
        [-12, 0],
        [12, 0],
        [0, -12],
        [0, 12],
      ]) {
        const point = { x: rect.x + rect.width / 2 + dx, y: rect.y + rect.height / 2 + dy };
        await poll(
          async () => {
            await probe('moveAt', point);
            return save.evaluate((node) => node.matches(':hover'));
          },
          Boolean,
          'Native mouse move misses shared button',
        );
        const hovered = await poll(
          native,
          (node) => node.hoverBorderOnly && node.borderEmphasized,
          'Native hover missing',
        );
        assert.equal(
          hovered.imageCenterX,
          state.imageCenterX,
          'Hover moves the image horizontally',
        );
        assert.equal(hovered.imageCenterY, state.imageCenterY, 'Hover moves the image vertically');
        const before = await clicks();
        await probe('clickAt', point);
        await poll(
          clicks,
          (value) => value === before + 1,
          'Native mouse click misses save action',
        );
      }
      for (const dx of [-24, 24]) {
        const point = { x: rect.x + rect.width / 2 + dx, y: rect.y + rect.height / 2 };
        await probe('moveAt', point);
        await poll(
          () => save.evaluate((node) => !node.matches(':hover')),
          Boolean,
          'Shared hover remains outside',
        );
        const outside = await poll(
          native,
          (node) => !node.borderEmphasized,
          'Native hover remains outside',
        );
        assert.equal(outside.imageCenterX, state.imageCenterX);
        assert.equal(outside.imageCenterY, state.imageCenterY);
      }
    }
  }
  await viewer.press('Escape');
  await poll(
    nodes,
    (items) =>
      !items.some(
        (node) =>
          node.identifier === 'voxcue-image-save' ||
          node.identifier === 'voxcue-image-overlay-regular' ||
          node.class === 'VoxCueModalBackground',
      ),
    'Closing viewer must retire native image controls and backdrop',
  );
  console.log(
    'PASS: screenshot save native/DOM/image centers, five interior points, outside hover and click routing in light/dark at two sizes.',
  );
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  if (app) {
    const stopped = new Promise((resolve) => app.process().once('exit', resolve));
    await app
      .evaluate(({ app }, profile) => {
        if (app.getPath('userData') !== profile) throw Error('Isolated profile required');
        app.exit(0);
      }, env.COPILOT_TEST_USER_DATA)
      .catch(() => {});
    await stopped;
  }
}
