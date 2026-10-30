import assert from 'node:assert/strict';
import path from 'node:path';
import { testRoot, electron } from './test-workspace.mjs';
import { offlineElectronEntry } from './offline-electron-entry.mjs';
import { installUiAccount, connectUiAccount, closeUiApp } from './install-ui-account.mjs';
import { captureRequested } from './capture-requested.mjs';

const app = await electron.launch({
  args: [await offlineElectronEntry()],
  env: {
    ...process.env,
    COPILOT_TEST_USER_DATA: path.join(testRoot, 'shimmer'),
    VITE_DEV_SERVER_URL: '',
  },
});
const errors = [],
  results = [];
try {
  await installUiAccount(app);
  await app.evaluate(({ app }) => {
    const require = process
      .getBuiltinModule('module')
      .createRequire(app.getAppPath() + '/package.json');
    const { ChatGPTService } = require(
      app.getAppPath() + '/dist-electron/shared/electron/backend/chat/service.js',
    );
    ChatGPTService.prototype.stream = (request, emit, signal) =>
      new Promise((resolve, reject) => {
        globalThis.shimmerFixture = {
          update(title, phase = 'thinking') {
            emit({
              id: request.id,
              type: 'activity',
              activity: {
                id: 'shimmer-state',
                kind: 'status',
                phase,
                status: 'in_progress',
              },
            });
            emit({
              id: request.id,
              type: 'activity',
              activity: {
                id: 'shimmer-title',
                kind: 'reasoning',
                phase: 'thinking',
                status: 'in_progress',
                detail: '**' + title + '**\n\n合成公开摘要。',
              },
            });
          },
          finish() {
            resolve({ answerText: '扫光专项完成', sources: [], usage: null });
          },
        };
        globalThis.shimmerFixture.update('思考');
        signal.addEventListener('abort', () => reject(Error('cancelled synthetic request')), {
          once: true,
        });
      });
  });
  const page = await connectUiAccount(app, await app.firstWindow());
  page.on('pageerror', (e) => errors.push(e.message));
  const win = await app.browserWindow(page);
  await page.getByRole('textbox', { name: '聊天消息', exact: true }).fill('扫光长度验证');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  const heading = page.locator('.reasoning-heading.is-active');
  const titles = [
    '思',
    '正在思考',
    '正在核对公开资料',
    'Reviewing the available evidence',
    '核对 TypeScript API 与 Windows / macOS 的实现边界',
    '核对这是一段用于验证长标题截断后仍然完整扫过可见文字的合成公开摘要标题'.repeat(3),
  ];
  const minimum = await win.evaluate((w) => w.getMinimumSize());
  for (const [width, height] of [[1280, 800], minimum]) {
    await win.evaluate((w, size) => w.setSize(...size), [width, height]);
    await page.waitForFunction(() =>
      document
        .getAnimations()
        .every(
          (animation) =>
            animation.effect?.getTiming().iterations === Infinity ||
            animation.playState !== 'running',
        ),
    );
    const bounds = await win.evaluate((w) => w.getBounds());
    for (const dark of [false, true]) {
      await page.evaluate((dark) => document.documentElement.classList.toggle('dark', dark), dark);
      for (const [index, title] of titles.entries()) {
        await app.evaluate((_, title) => globalThis.shimmerFixture.update(title), title);
        await heading.filter({ hasText: title }).waitFor();
        const measured = await heading.evaluate(async (node) => {
          await new Promise(requestAnimationFrame);
          const animation = node
            .getAnimations()
            .find((a) => a.animationName === 'reasoning-title-shine');
          if (!animation) throw Error('Missing real title animation');
          const timing = animation.effect.getTiming(),
            keyframes = animation.effect.getKeyframes();
          // Restart the real CSS animation; observe real frames without advancing a mock clock.
          animation.currentTime = 0;
          await animation.ready;
          const samples = [],
            start = performance.now();
          while (performance.now() - start < 1150) {
            await new Promise(requestAnimationFrame);
            samples.push({
              time: Number(animation.currentTime),
              position: parseFloat(getComputedStyle(node).backgroundPositionX),
              width: node.getBoundingClientRect().width,
            });
          }
          return {
            cycle: timing.duration,
            sweep: timing.duration * keyframes[1].offset,
            repeat: getComputedStyle(node).backgroundRepeat,
            samples,
            width: node.getBoundingClientRect().width,
            container: node.closest('.response-progress').getBoundingClientRect().width,
            scroll: node.scrollWidth,
            client: node.clientWidth,
          };
        });
        assert.equal(measured.cycle, 3500);
        assert.ok(
          Math.abs(measured.sweep - 1000) < 0.01,
          'Every text length must sweep in one second',
        );
        assert.equal(measured.repeat, 'no-repeat');
        assert.ok(
          measured.width <= measured.container + 1,
          'Title must fit the actual progress container',
        );
        assert.ok(
          measured.samples.some((s) => s.time >= 1000),
          'Observe the real sweep finish',
        );
        for (const sample of measured.samples) {
          const expected = sample.time < 1000 ? 120 - (140 * sample.time) / 1000 : -20;
          assert.ok(
            Math.abs(sample.position - expected) < 1.5,
            'No stall or reverse motion before the tail',
          );
          assert.ok(
            Math.abs(sample.width - measured.width) < 0.1,
            'Sweep cannot change text geometry',
          );
        }
        results.push({
          width,
          height,
          nativeWidth: bounds.width,
          dark,
          characters: title.length,
          textWidth: measured.width,
          container: measured.container,
          clipped: measured.scroll > measured.client,
          sweepMs: Math.round(measured.sweep),
        });
        if (index === 0 || index === titles.length - 1)
          await captureRequested(page, `shimmer-${width}-${dark ? 'dark' : 'light'}-${index}`);
      }
    }
  }
  assert.ok(
    new Set(results.map((r) => Math.round(r.textWidth))).size >= 4,
    'Exercise genuinely different text widths',
  );
  assert.ok(
    results.some((r) => r.clipped),
    'Exercise an actually clipped long title: ' + JSON.stringify(results),
  );
  const statusTexts = [];
  for (const [phase, label] of Object.entries({
    thinking: '正在思考',
    searching: '正在联网搜索',
    reading: '正在查询网页',
    organizing: '正在整理可保存的资料字段',
  })) {
    await app.evaluate((_, phase) => globalThis.shimmerFixture.update('状态长度', phase), phase);
    const status = page.locator('.progress-state-label.is-active');
    await status.filter({ hasText: label }).waitFor();
    const timing = await status.evaluate((node) => {
      const animation = node
        .getAnimations()
        .find((a) => a.animationName === 'reasoning-title-shine');
      return {
        text: node.textContent,
        duration: animation.effect.getTiming().duration,
        end: animation.effect.getKeyframes()[1].offset,
      };
    });
    assert.ok(Math.abs(timing.duration * timing.end - 1000) < 0.01, timing.text);
    statusTexts.push(timing.text);
  }
  assert.equal(new Set(statusTexts).size, 4, 'Observe four actual status labels');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await app.evaluate(() => globalThis.shimmerFixture.update('减少动态效果'));
  await heading.waitFor();
  for (const selector of ['.reasoning-heading.is-active', '.progress-state-label.is-active'])
    assert.equal(
      await page.locator(selector).evaluate((node) => getComputedStyle(node).animationName),
      'none',
    );
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      passed: true,
      cases: results.length,
      results,
      actualCssFrames: true,
      statusLengths: 4,
      reducedMotion: true,
    }),
  );
} finally {
  await app.evaluate(() => globalThis.shimmerFixture?.finish()).catch(() => {});
  await closeUiApp(app);
}
