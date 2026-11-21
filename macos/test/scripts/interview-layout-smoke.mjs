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
      main.setDefaultTimeout(15000);
      await main.getByRole('button', { name: '开始面试', exact: true }).click();
      const dialog = main.getByRole('dialog', { name: '开始面试', exact: true });
      await dialog.getByRole('heading', { name: '开始面试', exact: true }).waitFor();
      await dialog.locator('.interview-start-summary-group').first().waitFor();
      const rows = await dialog
        .locator('.interview-start-summary-group > div')
        .evaluateAll((nodes) =>
          nodes.map((node) => ({
            title: node.querySelector('dt').textContent,
            value: (
              node.querySelector('.interview-start-summary-value') ?? node.querySelector('dd')
            ).textContent,
            parameters: [...node.querySelectorAll('.interview-start-summary-meta')].map((meta) => ({
              label: meta.getAttribute('aria-label'),
              value: meta.textContent,
            })),
            y: node.getBoundingClientRect().y,
            width: node.getBoundingClientRect().width,
            labelRight: node.querySelector('dt').getBoundingClientRect().right,
            valueLeft: node.querySelector('dd').getBoundingClientRect().left,
          })),
        );
      assert.deepEqual(
        rows.map((row) => row.title),
        [
          '面试知识库',
          'AI 服务用量',
          '系统音频 · 面试官',
          '麦克风 · 面试者',
          '回答模型',
          '语音模型',
        ],
      );
      for (let index = 0; index < rows.length; index++) {
        assert.ok(Math.abs(rows[index].width - rows[0].width) <= 1 / 64);
        assert.ok(Math.abs(rows[index].valueLeft - rows[0].valueLeft) <= 1 / 64);
        assert.ok(Math.abs(rows[index].valueLeft - rows[index].labelRight - 16) <= 1 / 64);
        if (index) assert.ok(rows[index].y > rows[index - 1].y);
      }
      assert.equal(rows[5].value, '轻量语音识别');
      assert.deepEqual(rows[5].parameters, [{ label: '推理设备', value: 'CPU' }]);
      assert.deepEqual(
        rows[4].parameters.map((item) => item.label),
        ['思考强度'],
      );
      const opened = app.waitForEvent('window');
      await dialog.getByRole('button', { name: '确认开始', exact: true }).click();
      const floating = await opened;
      floating.setDefaultTimeout(15000);
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
      assert.deepEqual(
        await nativeBounds(),
        both,
        'Transcript hiding keeps the bounded native canvas',
      );
      await floating.getByRole('button', { name: '转写面板', exact: true }).click();
      await floating.locator('.floating-transcript').waitFor({ state: 'visible' });
      const restored = await nativeBounds();
      assertAnchor(restored, both, 'Restore transcript');
      assert.ok(Math.abs(restored.width - both.width) <= 1 && Math.abs(restored.x - both.x) <= 1);
      await floating.getByRole('button', { name: '收起面试窗口', exact: true }).click();
      await floating.getByRole('button', { name: '展开面试窗口', exact: true }).waitFor();
      await floating.waitForFunction(async () => {
        const state = await window.desktop.interviewState();
        return state.collapsed && state.layout?.height === 72 && !document.querySelector('.floating-shell').dataset.panelMotion;
      });
      assert.deepEqual(await nativeBounds(), restored, 'The 72-DIP capsule retains the native panel surface');
      await floating.getByRole('button', { name: '展开面试窗口', exact: true }).click();
      await floating.getByRole('button', { name: '收起面试窗口', exact: true }).waitFor();
      assert.deepEqual(await nativeBounds(), restored, 'Expanding the panels retains the same native surface');
      await floating.getByRole('button', { name: '结束面试', exact: true }).click();
      await floating.getByRole('button', { name: '确认结束面试', exact: true }).click();
    } catch (error) {
      console.error(
        'Mac layout failure at scale',
        scale,
        await app
          ?.evaluate(({ BrowserWindow }) =>
            BrowserWindow.getAllWindows().map((window) => ({
              url: window.webContents.getURL(),
              bounds: window.getBounds(),
              visible: window.isVisible(),
            })),
          )
          .catch(() => []),
      );
      throw error;
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
