import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { testRoot } from '../../../shared/test/scripts/test-workspace.mjs';

// Native material content is a separate owned WebContents. Keep the parent
// page for window assertions, and locate the actual input surface for typing.
export async function composerPage(app, parent) {
  const native = await parent.evaluate(() => window.desktop.presentation.liquidGlass === true);
  const deadline = Date.now() + 15000;
  do {
    for (const page of app.context().pages()) {
      if (page.isClosed()) continue;
      if ((await page.title()) === 'VoxCue composer') {
        await page.getByRole('textbox', { name: '聊天消息', exact: true }).waitFor();
        return page;
      }
    }
    if (
      !native &&
      (await parent.evaluate(
        () => !!document.querySelector('[aria-label="聊天消息"]')?.checkVisibility(),
      ))
    )
      return parent;
    await new Promise((resolve) => setTimeout(resolve, 50));
  } while (Date.now() < deadline);
  throw Error('Owned composer surface did not appear');
}

let probeFile;
export async function chooseNativeMenu(app, page, trigger, title) {
  if (!(await page.evaluate(() => window.desktop.presentation.liquidGlass))) {
    await trigger.click();
    await page.getByRole('menuitem', { name: title, exact: true }).click();
    return;
  }
  if (!probeFile) {
    probeFile = path.join(testRoot, 'NativeUIProbe.node');
    const result = spawnSync(
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
    if (result.error) throw result.error;
    if (result.status !== 0) throw Error('Native menu probe compilation failed');
  }
  await app.evaluate(
    ({ BrowserWindow }, { file, title }) => {
      const require = process
        .getBuiltinModule('module')
        .createRequire(process.cwd() + '/package.json');
      const win = BrowserWindow.getAllWindows().find((win) => win.getTitle() === 'VoxCue');
      require(file).selectMenuItem(win.getNativeWindowHandle(), title);
    },
    { file: probeFile, title },
  );
  await trigger.click();
  await page.waitForFunction(() => !document.querySelector('.dropdown-content[data-state="open"]'));
}
