import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { installUiAccount } from '../../../shared/test/scripts/install-ui-account.mjs';

export async function checkLoginControls({ app, page, probeFile, poll }) {
  const flatten = (node) => [node, ...(node.children ?? []).flatMap(flatten)];
  const directory = process.argv.find((arg) => arg.startsWith('--screenshots='))?.slice(14);
  if (directory) {
    assert.ok(path.isAbsolute(directory));
    await mkdir(directory, { recursive: true });
  }
  const inspect = () =>
    app.evaluate(({ BrowserWindow }, file) => {
      const require = process
        .getBuiltinModule('module')
        .createRequire(process.cwd() + '/package.json');
      return JSON.parse(
        require(file).inspect(BrowserWindow.getAllWindows()[0].getNativeWindowHandle()),
      );
    }, probeFile);
  const button = page.getByRole('button', { name: '使用 ChatGPT 继续', exact: true });
  assert.equal(await button.count(), 1);
  const brand = button.locator('img.service-brand-icon');
  assert.equal(await brand.count(), 1);
  await brand.evaluate((image) => image.decode());
  assert.ok(await brand.evaluate((image) => image.complete && image.naturalWidth > 0));
  await app.evaluate(({ BrowserWindow }, file) => {
    const require = process
      .getBuiltinModule('module')
      .createRequire(process.cwd() + '/package.json');
    require(file).backdrop(BrowserWindow.getAllWindows()[0].getNativeWindowHandle(), 2);
  }, probeFile);
  await poll(
    inspect,
    (value) => {
      const nodes = flatten(value.tree);
      return (
        nodes.filter((node) => node.identifier === 'voxcue-interview-preview-scene').length === 1 &&
        nodes.filter((node) => node.identifier === 'voxcue-interview-clear').length === 3 &&
        nodes.filter((node) => node.identifier === 'voxcue-interview-regular').length === 5
      );
    },
    'Login preview must use actual Clear chrome/panels and Regular reading/composer materials',
  );
  const preview = page.locator('.login-preview .interview-preview-scene');
  assert.ok(
    flatten((await inspect()).tree).some((node) => node.class === 'VoxCueLoginBackdrop'),
    'Login has its own website showcase background',
  );
  assert.equal(await preview.locator('.floating-panel').count(), 2);
  assert.equal(await preview.locator('.provider-identity').innerText(), 'ChatGPT');
  assert.equal(
    await preview.locator('button,input,[tabindex="0"]').count(),
    0,
    'The preview is display-only',
  );
  assert.equal(await preview.locator('textarea').getAttribute('tabindex'), '-1');
  assert.deepEqual(
    await page.locator('.login-preview').evaluate((node) => {
      const css = getComputedStyle(node);
      return [
        css.borderTopLeftRadius,
        css.borderBottomLeftRadius,
        css.borderTopRightRadius,
        css.borderBottomRightRadius,
      ];
    }),
    ['0px', '0px', '0px', '0px'],
  );
  assert.equal(await page.locator('.login-preview .macos-native-panel-material').count(), 9);
  assert.notEqual(
    await page
      .locator('.login-shell')
      .evaluate((node) => getComputedStyle(node, '::before').clipPath),
    'none',
  );
  for (const theme of ['light', 'dark']) {
    await app.evaluate(({ nativeTheme }, theme) => {
      nativeTheme.themeSource = theme;
    }, theme);
    await page.evaluate((theme) => {
      document.documentElement.classList.toggle('dark', theme === 'dark');
      document.documentElement.style.colorScheme = theme;
    }, theme);
    const foreground = theme === 'dark' ? 1 : 0;
    const value = await poll(
      inspect,
      (value) =>
        flatten(value.tree).some(
          (node) =>
            node.class === 'VoxCueLoginBackdrop' &&
            node.layerMasked === false &&
            node.dark === (theme === 'dark') &&
            node.appearance ===
              (theme === 'dark' ? 'NSAppearanceNameDarkAqua' : 'NSAppearanceNameAqua'),
        ) &&
        flatten(value.tree).some(
          (node) =>
            node.class === 'NSButton' &&
            node.title === '使用 ChatGPT 继续' &&
            node.bezelStyle === 16 &&
            node.foregroundColor?.slice(0, 3).every((value) => Math.abs(value - foreground) < 0.01),
        ),
      'Login must use the real Glass bezel and theme-specific black/white foreground',
    );
    const native = flatten(value.tree).find(
      (node) => node.class === 'NSButton' && node.title === '使用 ChatGPT 继续',
    );
    assert.equal(native.image, true, 'Preserve the original ChatGPT brand artwork');
    assert.equal(
      native.contentCentered,
      true,
      'Center the original brand image and title as one group',
    );
    assert.equal(await page.locator('.login-explanation').count(), 0);
    assert.equal(native.borderShape, 1);
    assert.equal(native.frameHeight, 46);
    assert.equal(native.focusRingType, 1);
    assert.ok(native.titleColor.slice(0, 3).every((value) => Math.abs(value - foreground) < 0.01));
    assert.equal(await button.evaluate((node) => getComputedStyle(node).opacity), '0');
    await button.hover();
    await poll(
      inspect,
      (value) =>
        flatten(value.tree).some((node) => node.title === '使用 ChatGPT 继续' && node.highlighted),
      'Login keeps native hover feedback',
    );
    await page.mouse.move(900, 550);
    // Wait for Chromium's GPU frame as well as AppKit properties. Capturing
    // the native window immediately can otherwise reuse its previous web frame.
    await page.screenshot();
    const scene = await preview.boundingBox();
    await poll(
      () =>
        app.evaluate(
          async ({ BrowserWindow, nativeImage, app }, { file, output, scene, theme }) => {
            const require = process
              .getBuiltinModule('module')
              .createRequire(process.cwd() + '/package.json');
            const win = BrowserWindow.getAllWindows()[0];
            app.focus({ steal: true });
            win.focus();
            const protectedWindow = win.isContentProtected();
            win.setContentProtection(false);
            try {
              await new Promise((resolve) => setTimeout(resolve, 250));
              const result = await require(file).snapshot(win.getNativeWindowHandle());
              const image = nativeImage.createFromBuffer(result.png).crop(result.crop);
              const bytes = image.toBitmap();
              if (bytes.length !== image.getSize().width * image.getSize().height * 4)
                throw Error('Native capture bitmap scale does not match its reported size');
              const offset =
                4 *
                (Math.floor(scene.y + 3) * image.getSize().width +
                  Math.floor(scene.x + scene.width / 2));
              const pixel = [...bytes.subarray(offset, offset + 3)];
              const brightness = pixel.reduce((sum, value) => sum + value, 0) / 3;
              if (theme === 'dark' ? brightness > 145 : brightness < 150) {
                console.error('login theme pixels', theme, pixel);
                return false;
              }
              for (const edge of [scene.y, scene.y + scene.height])
                for (let y = Math.floor(edge) - 1; y <= Math.ceil(edge) + 1; y++)
                  for (let x = Math.ceil(scene.x); x < Math.floor(scene.x + scene.width); x++) {
                    const start = 4 * (y * image.getSize().width + x);
                    const neighbor = 4 * ((Math.floor(edge) - 3) * image.getSize().width + x);
                    if (
                      [0, 1, 2].some((i) => Math.abs(bytes[start + i] - bytes[neighbor + i]) > 14)
                    ) {
                      console.error('login seam pixels', theme, x, y, [
                        ...bytes.subarray(start, start + 4),
                      ]);
                      return false;
                    }
                  }
              for (const y of [10, image.getSize().height - 11]) {
                const start = 4 * (y * image.getSize().width + image.getSize().width - 24);
                if (Math.min(...bytes.subarray(start, start + 3)) > 235 && bytes[start + 3] > 240) {
                  console.error('login corner pixels', theme, y, [
                    ...bytes.subarray(start, start + 4),
                  ]);
                  return false;
                }
              }
              if (output) require('node:fs').writeFileSync(output, image.toPNG());
              return true;
            } finally {
              win.setContentProtection(protectedWindow);
            }
          },
          {
            file: probeFile,
            output: directory ? path.join(directory, 'mac-login-' + theme + '.png') : null,
            scene,
            theme,
          },
        ),
      Boolean,
      'The rendered login theme must settle without top/bottom seams',
    );
  }
  await assert.rejects(
    page.evaluate(() => window.desktop.setContentControls([{ kind: 'search' }])),
  );
  await assert.rejects(
    page.evaluate(() =>
      window.desktop.setInterviewMaterials([
        {
          id: 1,
          style: 'modal-exclusion',
          dark: true,
          round: false,
          x: 1,
          y: 1,
          width: 100,
          height: 100,
          radius: 20,
          opacity: 1,
          fadeBottom: 0,
          clip: { x: 1, y: 1, width: 100, height: 100 },
        },
      ]),
    ),
  );
  await (await app.browserWindow(page)).evaluate((win) => win.setSize(860, 520));
  await page.waitForFunction(() => innerWidth === 860 && innerHeight === 520);
  assert.ok(
    await preview.locator('.interview-font-preview').evaluate((node) => {
      const panels = [...node.children].map((child) => child.getBoundingClientRect());
      return (
        panels[0].right < panels[1].left &&
        panels.every((box) => box.top >= 0 && box.bottom <= innerHeight)
      );
    }),
    'Minimum login retains two visible preview panels',
  );
  await installUiAccount(app);
  const rectangle = await button.boundingBox();
  const opened = app.waitForEvent('window');
  await app.evaluate(
    ({ BrowserWindow }, { file, rectangle }) => {
      const require = process
        .getBuiltinModule('module')
        .createRequire(process.cwd() + '/package.json');
      require(file).clickAt(BrowserWindow.getAllWindows()[0].getNativeWindowHandle(), {
        x: rectangle.x + rectangle.width / 2,
        y: rectangle.y + rectangle.height / 2,
      });
    },
    { file: probeFile, rectangle },
  );
  const main = await opened;
  await main.getByRole('button', { name: '开始面试', exact: true }).waitFor();
  console.log(
    'PASS: actual Glass login capsule, original brand, black/white themes, native hover, bounded login port and shared sign-in click.',
  );
}
