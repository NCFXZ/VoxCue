import assert from 'node:assert/strict';
import { probe } from './window-probe.mjs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { testRoot } from '../../../shared/test/scripts/test-workspace.mjs';

// Called by the shared end-to-end screenshot fixture. The export dialog port
// targets only its synthetic profile; input is guarded by the owned native HWND.
export async function checkImageSaveHit(app, page, viewer) {
  assert.equal(probe('desktop').interactive, true);
  const cursor = probe('cursor');
  const window = await app.browserWindow(page);
  const before = await window.evaluate((win) => ({
    handle: win.getNativeWindowHandle().readBigUInt64LE().toString(),
    topmost: win.isAlwaysOnTop(),
  }));
  try {
    await window.evaluate((win) => {
      win.show();
      win.setAlwaysOnTop(true, 'normal');
      win.moveTop();
      win.focus();
    });
    const save = viewer.getByRole('button', { name: '保存图片', exact: true });
    const close = viewer.getByRole('button', { name: '关闭截图', exact: true });
    for (const dark of [false, true]) {
      await page.evaluate((dark) => document.documentElement.classList.toggle('dark', dark), dark);
      await close.focus();
      const box = await save.boundingBox();
      assert.equal(Math.round(box.width * 64), 36 * 64);
      assert.equal(Math.round(box.height * 64), 36 * 64);
      const icon = await save.locator('svg').boundingBox();
      assert.equal(Math.round(icon.width * 64), 17 * 64);
      assert.equal(Math.round(icon.height * 64), 17 * 64);
      const point = async (dx, dy) =>
        app.evaluate(
          ({ BrowserWindow, screen }, value) => {
            const win = BrowserWindow.fromId(value.id),
              bounds = win.getContentBounds();
            return screen.dipToScreenPoint({
              x: Math.round(bounds.x + value.x),
              y: Math.round(bounds.y + value.y),
            });
          },
          {
            id: await window.evaluate((win) => win.id),
            x: box.x + box.width / 2 + dx,
            y: box.y + box.height / 2 + dy,
          },
        );
      for (const [dx, dy] of [
        [0, 0],
        [-16, 0],
        [16, 0],
        [0, -16],
        [0, 16],
      ]) {
        const location = await point(dx, dy);
        assert.equal(probe('hit', before.handle, location.x, location.y).expected, true);
        assert.equal(
          probe('hittest', before.handle, location.x, location.y).result,
          1,
          'Viewer controls stay native HTCLIENT, never a drag caption',
        );
        const count = await app.evaluate(() => globalThis.imageExportCalls);
        probe('click', before.handle, location.x, location.y);
        const calls = await app.evaluate(async (_electron, previous) => {
          const end = Date.now() + 3000;
          while (Date.now() < end && globalThis.imageExportCalls === previous)
            await new Promise((resolve) => setTimeout(resolve, 10));
          return globalThis.imageExportCalls;
        }, count);
        assert.equal(calls, count + 1);
        await page.waitForFunction(
          () =>
            document.querySelector('.interview-image-save')?.getAttribute('aria-busy') === 'false',
        );
        assert.deepEqual(
          await save.locator('svg').boundingBox(),
          icon,
          'Hover/click keeps icon geometry',
        );
      }
      for (const [dx, dy] of [
        [-22, 0],
        [0, -22],
        [0, 22],
      ]) {
        const location = await point(dx, dy);
        probe('move', location.x, location.y);
        assert.equal(
          await save.evaluate((node) => node.matches(':hover')),
          false,
          'Outside points do not hover save',
        );
      }
    }
    console.log(
      'PASS: Windows native screenshot save center/four edges in light/dark, 36px hit area, 17px stable icon, no-drag HTCLIENT and outside hover exclusion',
    );
    const framework = path.join(process.env.WINDIR, 'Microsoft.NET/Framework64/v4.0.30319');
    const executable = path.join(testRoot, 'ImageSaveDialog.exe');
    const compile = spawnSync(
      path.join(framework, 'csc.exe'),
      [
        '/nologo',
        '/platform:x64',
        '/target:exe',
        ...['UIAutomationClient', 'UIAutomationTypes', 'WindowsBase'].map(
          (name) => '/r:' + path.join(framework, 'WPF', name + '.dll'),
        ),
        '/out:' + executable,
        path.resolve('test/fixtures/ImageSaveDialog.cs'),
      ],
      { encoding: 'utf8', windowsHide: true, timeout: 30000 },
    );
    assert.equal(compile.status, 0, compile.stdout + compile.stderr);
    const destination = await app.evaluate(({ app, dialog }) => {
      const target = process
        .getBuiltinModule('path')
        .join(app.getPath('userData'), 'native-image-export.png');
      globalThis.imageRealSaveCalls = 0;
      dialog.showSaveDialog = async (owner, options) => {
        globalThis.imageRealSaveCalls++;
        try {
          const result = await globalThis.imageRealSaveDialog(owner, {
            ...options,
            defaultPath: target,
          });
          globalThis.imageRealSaveResult = { canceled: result.canceled };
          return result;
        } catch (error) {
          globalThis.imageRealSaveError = String(error);
          throw error;
        }
      };
      return target;
    });
    for (const operation of [destination, 'cancel']) {
      await viewer.getByRole('button', { name: '保存图片', exact: true }).click();
      const action = spawnSync(
        executable,
        [String(await app.evaluate(() => process.pid)), before.handle, operation],
        {
          encoding: 'utf8',
          windowsHide: true,
          timeout: 25000,
        },
      );
      if (action.status !== 0)
        console.error(
          'Synthetic native save state',
          await app.evaluate(() => ({
            calls: globalThis.imageRealSaveCalls,
            result: globalThis.imageRealSaveResult,
            error: globalThis.imageRealSaveError,
          })),
        );
      assert.equal(action.status, 0, action.stdout + action.stderr);
      await page.waitForFunction(
        () =>
          document.querySelector('.interview-image-save')?.getAttribute('aria-busy') === 'false',
      );
      assert.equal(await viewer.locator('.danger-text').count(), 0);
    }
    assert.equal(
      await app.evaluate(async (_electron, target) => {
        const fs = process.getBuiltinModule('fs/promises'),
          path = process.getBuiltinModule('path');
        const original = await fs.readFile(
          path.join(path.dirname(target), 'synthetic-image-export.png'),
        );
        return original.equals(await fs.readFile(target));
      }, destination),
      true,
      'Native Windows save preserves the exact original bytes',
    );
    console.log(
      'PASS: actual owned Windows save dialog export/cancel and exact original bytes; temporary synthetic destinations only',
    );
  } finally {
    await window.evaluate((win, topmost) => win.setAlwaysOnTop(topmost, 'normal'), before.topmost);
    probe('move', cursor.x, cursor.y);
  }
}
