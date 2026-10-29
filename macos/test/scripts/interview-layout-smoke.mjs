import assert from 'node:assert/strict';
import path from 'node:path';
import { testRoot, electron } from '../../../shared/test/scripts/test-workspace.mjs';
import {
  installUiAccount,
  connectUiAccount,
  closeUiApp,
} from '../../../shared/test/scripts/install-ui-account.mjs';
import { holdDesktopAwake, requireUnlockedDesktop } from './desktop-session.mjs';

// Exercise real Mac setBounds round trips with a synthetic cursor port. Windows
// HWND precompensation is platform-specific; its center/top invariants still apply.
const releaseDesktop = holdDesktopAwake();
let passed = 0;
try {
  for (const scale of ['1', '1.25', '1.5', '1.75', '2']) {
    let app;
    try {
      app = await electron.launch({
        args: ['.'],
        env: {
          ...process.env,
          COPILOT_TEST_USER_DATA: path.join(testRoot, 'profile-' + scale),
          VITE_DEV_SERVER_URL: '',
          VOXCUE_TEST_SCALE_FACTOR: scale,
        },
      });
      await installUiAccount(app, { speech: true, components: true });
      await app.evaluate(({ screen, BrowserWindow }) => {
        globalThis.layoutCursor = { x: 500, y: 500 };
        screen.getCursorScreenPoint = () => globalThis.layoutCursor;
        globalThis.layoutFrames = [];
        const setBounds = BrowserWindow.prototype.setBounds;
        BrowserWindow.prototype.setBounds = function (...args) {
          const result = setBounds.apply(this, args);
          if (this.webContents.getURL().endsWith('#interview'))
            globalThis.layoutFrames.push(this.getBounds());
          return result;
        };
      });
      const main = await connectUiAccount(app, await app.firstWindow());
      await main.getByRole('button', { name: '开始面试', exact: true }).click();
      const dialog = main.getByRole('dialog', { name: '开始面试', exact: true });
      const rows = await dialog.locator('.interview-start-summary > div').evaluateAll((nodes) =>
        nodes.map((node) => ({
          title: node.querySelector('dt').textContent,
          value: node.querySelector('dd').textContent,
          y: node.getBoundingClientRect().y,
          width: node.getBoundingClientRect().width,
        })),
      );
      assert.deepEqual(
        rows.map((row) => row.title),
        [
          '面试知识库',
          'AI 工具剩余用量',
          '面试官 · 系统音频',
          '面试者 · 麦克风',
          '语音模型',
          '推理设备',
          '回答模型',
          '思考强度',
        ],
      );
      for (let index = 0; index < rows.length; index += 2) {
        assert.equal(rows[index].y, rows[index + 1].y);
        assert.ok(Math.abs(rows[index].width - rows[index + 1].width) <= 1);
      }
      assert.ok(rows[0].y < rows[2].y && rows[2].y < rows[4].y && rows[4].y < rows[6].y);
      assert.equal(rows[4].value, 'Paraformer 中英 INT8');
      assert.equal(rows[5].value, 'CPU');
      const opened = app.waitForEvent('window');
      await dialog.getByRole('button', { name: '确认开始', exact: true }).click();
      const floating = await opened;
      await floating.getByRole('button', { name: '结束面试', exact: true }).waitFor();
      const nativeBounds = () =>
        app.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()
            .find((window) => window.webContents.getURL().endsWith('#interview'))
            .getBounds(),
        );
      const assertAnchor = (actual, before, label) => {
        assert.ok(
          Math.abs(actual.x + actual.width / 2 - before.x - before.width / 2) <= 1,
          label + ': toolbar center',
        );
        assert.equal(actual.y, before.y, label + ': toolbar top');
      };
      for (const edge of ['right', 'left']) {
        requireUnlockedDesktop();
        const before = await nativeBounds();
        await app.evaluate(() => {
          globalThis.layoutCursor = { x: 500, y: 500 };
          globalThis.layoutFrames = [];
        });
        await floating.evaluate(
          (edge) => window.desktop.resizeInterview({ phase: 'start', edge }),
          edge,
        );
        for (let step = 1; step <= 6; step++) {
          await app.evaluate(
            (_, { edge, step }) => {
              globalThis.layoutCursor = {
                x: 500 - step * 5,
                y: 500 + (edge === 'right' ? -1 : 1) * step * 5,
              };
            },
            { edge, step },
          );
          await floating.evaluate(() => window.desktop.resizeInterview({ phase: 'move' }));
        }
        const after = await nativeBounds();
        const frames = await app.evaluate(() => globalThis.layoutFrames);
        assert.ok(frames.length >= 3, 'Mac updates native bounds during the gesture');
        for (const frame of frames) assertAnchor(frame, before, edge);
        assert.ok(
          edge === 'right' ? after.width < before.width - 3 : after.width > before.width + 3,
        );
        const count = frames.length;
        for (let i = 0; i < 10; i++)
          await floating.evaluate(() => window.desktop.resizeInterview({ phase: 'move' }));
        assert.equal(
          await app.evaluate(() => globalThis.layoutFrames.length),
          count,
          'Stationary cursor must not cause native bound drift',
        );
        await floating.evaluate(() => window.desktop.resizeInterview({ phase: 'end' }));
        console.log(
          `PASS Mac native interview bounds ${scale} ${edge}: each frame center <=1 DIP, fixed top, live resize and stationary no-op`,
        );
        passed++;
      }
      const both = await nativeBounds();
      await floating.getByRole('button', { name: '转写面板', exact: true }).click();
      await floating.locator('.floating-transcript').waitFor({ state: 'hidden' });
      assertAnchor(await nativeBounds(), both, 'Hide transcript');
      await floating.getByRole('button', { name: '转写面板', exact: true }).click();
      await floating.locator('.floating-transcript').waitFor({ state: 'visible' });
      const restored = await nativeBounds();
      assertAnchor(restored, both, 'Restore transcript');
      assert.ok(Math.abs(restored.width - both.width) <= 1 && Math.abs(restored.x - both.x) <= 1);
      await floating.getByRole('button', { name: '收起面试窗口', exact: true }).click();
      await floating.getByRole('button', { name: '展开面试窗口', exact: true }).waitFor();
      assertAnchor(await nativeBounds(), both, 'Collapse');
      assert.ok(Math.abs((await nativeBounds()).height - 72) <= 1);
      await floating.getByRole('button', { name: '展开面试窗口', exact: true }).click();
      await floating.getByRole('button', { name: '收起面试窗口', exact: true }).waitFor();
      assertAnchor(await nativeBounds(), both, 'Expand');
      await floating.getByRole('button', { name: '结束面试', exact: true }).click();
      await floating.getByRole('button', { name: '确认结束面试', exact: true }).click();
    } finally {
      if (app) {
        await app
          .evaluate(({ BrowserWindow }) => {
            for (const window of BrowserWindow.getAllWindows()) window.destroy();
          })
          .catch(() => {});
        await closeUiApp(app);
      }
    }
  }
} finally {
  releaseDesktop();
}
assert.equal(passed, 10);
console.log(
  JSON.stringify({
    passed,
    total: 10,
    realMacBounds: true,
    syntheticCursor: true,
    globalInputSent: false,
  }),
);
