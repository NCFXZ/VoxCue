import { evaluateHistory } from '../../../shared/test/scripts/stored-history-fixture.mjs';
import { connectUiAccount } from '../../../shared/test/scripts/install-ui-account.mjs';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { testRoot, electron } from '../../../shared/test/scripts/test-workspace.mjs';
import { installUiAccount, closeUiApp } from '../../../shared/test/scripts/install-ui-account.mjs';
import { captureRequested } from '../../../shared/test/scripts/capture-requested.mjs';

const selected = process.argv.find((arg) => arg.startsWith('--scale='))?.slice(8);
const syncOnly = process.argv.includes('--sync-popover');
const scales = selected ? [selected] : ['1', '1.25', '1.5', '1.75', '2'];
assert.ok(scales.every((scale) => ['1', '1.25', '1.5', '1.75', '2'].includes(scale)));
const preview = process.argv.includes('--preview');
if (preview && !process.stdin.isTTY)
  throw Error('Temporary preview requires an interactive terminal');
const checks = [];
async function checkSyncPopover(app, page) {
  await app.evaluate(({ app }) => {
    const load = process.getBuiltinModule('module').createRequire(app.getAppPath() + '/package.json');
    const { CloudSyncClient } = load('./dist-electron/shared/electron/backend/cloud/sync.js');
    globalThis.fixtureSyncError = '暂时无法同步这条面试记录，请稍后重试。';
    CloudSyncClient.prototype.call = async input => {
      if (input.action === 'list') {
        const empty = { profile: 0, history: 0, knowledgebase: 0 };
        return { ok: true, value: { items: [], nextCursor: null, storage: {
          currentBytes: empty, reservedBytes: empty, storedBytes: empty,
          capacityBytes: 100000000, knowledgeCapacityBytes: 100000000,
        } } };
      }
      if (input.action === 'create' && input.key === 'record:scrollbar-fixture')
        return { ok: false, status: 500, error: globalThis.fixtureSyncError };
      throw Error('Unexpected synthetic sync request: ' + input.action);
    };
  });
  await page.getByRole('button', { name: '用户菜单', exact: true }).click();
  await page.getByRole('menuitem', { name: '设置', exact: true }).click();
  const settings = page.getByRole('dialog', { name: '设置', exact: true });
  await settings.getByRole('button', { name: 'VoxCue 账号', exact: true }).click();
  await settings.getByRole('switch', { name: '同步面试记录', exact: true }).click();
  await settings.getByRole('button', { name: '关闭设置', exact: true }).click();
  const badge = page.locator('.history-row-wrap').getByRole('button', { name: /：同步失败$/ });
  await badge.waitFor();
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const popup = page.locator('.sync-popover:not([data-menu-outro])');
  const sample = async opening => {
    await page.evaluate(opening => {
      window.syncMotionSample = (async () => {
        const frames = [];
        let seen = false;
        const stop = performance.now() + 5000;
        while (performance.now() < stop) {
          await new Promise(requestAnimationFrame);
          const menu = document.querySelector(opening ? '.sync-popover:not([data-menu-outro])' : '.sync-popover[data-menu-outro]');
          if (!menu) {
            if (seen && !opening) return frames;
            continue;
          }
          seen = true;
          const body = menu.querySelector('.sync-popover-body');
          const box = menu.getBoundingClientRect(), frame = menu.parentElement.getBoundingClientRect();
          const overflow = body.scrollHeight - body.clientHeight;
          frames.push({ height: box.height, left: box.left, width: box.width, target: frame.height,
            overflow, thumb: ['auto', 'scroll'].includes(getComputedStyle(body).overflowY) && overflow > 1 });
          if (opening && !menu.hasAttribute('data-menu-height-motion')) return frames;
        }
        throw Error('Did not observe the real sync popup ' + (opening ? 'opening' : 'closing'));
      })();
    }, opening);
    await badge.press(opening ? 'Enter' : 'Escape');
    const frames = await page.evaluate(async () => {
      const frames = await window.syncMotionSample;
      delete window.syncMotionSample;
      return frames;
    });
    const to = frames.at(-1);
    const middle = frames.filter(frame => frame.height > 3 && frame.height < frame.target - 2);
    assert.ok(middle.length > 1, 'Expected intermediate popup heights');
    assert.ok(frames.every(frame => Math.abs(frame.left - to.left) <= 1 && Math.abs(frame.width - to.width) <= 1),
      'Sync popup stays anchored horizontally throughout its original animation');
    return { to, middle, flash: frames.filter(frame => frame.thumb) };
  };
  const opened = await sample(true), closed = await sample(false);
  console.log('Short sync error', { openFramesWithScrollbar: opened.flash.length,
    closedFramesWithScrollbar: closed.flash.length, settledOverflow: opened.to.overflow,
    maxOpeningOverflow: Math.max(...opened.middle.map(frame => frame.overflow)) });
  assert.equal(opened.flash.length + closed.flash.length, 0,
    'A short history sync failure must never need a scrollbar while the surface opens or closes');
  await badge.press('Enter');
  await popup.getByRole('button', { name: '重试同步' }).waitFor();
  const longMessage = '受限网络暂时不能完成云端同步。'.repeat(400);
  await app.evaluate((_electron, error) => { globalThis.fixtureSyncError = error; }, longMessage);
  await popup.getByRole('button', { name: '重试同步' }).click();
  await popup.getByText(longMessage, { exact: true }).waitFor({ state: 'attached' });
  await page.keyboard.press('Escape');
  await page.locator('.sync-popover').waitFor({ state: 'detached' });
  await sample(true);
  const long = await popup.locator('.sync-popover-body').evaluate(body => {
    const rect = body.parentElement.getBoundingClientRect();
    body.scrollTop = body.scrollHeight;
    return { top: rect.top, bottom: rect.bottom, viewport: innerHeight, scrolled: body.scrollTop,
      reachable: body.querySelector('.sync-popover-actions').getBoundingClientRect().bottom <= body.getBoundingClientRect().bottom + 1 };
  });
  assert.ok(long.scrolled > 100 && long.reachable && long.top >= 0 && long.bottom <= long.viewport + 1,
    'A genuinely long error scrolls to its retry button within the viewport: ' + JSON.stringify(long));
  await page.keyboard.press('Escape');
  await page.locator('.sync-popover').waitFor({ state: 'detached' });
}
for (const scale of scales) {
  const profile = path.join(testRoot, 'profile-' + scale);
  await mkdir(profile);
  const app = await electron.launch({
    args: ['.'],
    env: {
      ...process.env,
      COPILOT_TEST_USER_DATA: profile,
      VITE_DEV_SERVER_URL: '',
      VOXCUE_TEST_SCALE_FACTOR: scale,
    },
  });
  try {
    await installUiAccount(app, { components: true });
    const login = await app.firstWindow();
    if (preview) await login.evaluate(() => localStorage.setItem('copilot-theme', 'dark'));
    const page = await connectUiAccount(app, login);
    await page.getByRole('button', { name: '面试记录', exact: true }).click();
    await evaluateHistory(page, async () => {
      const record = {
        id: 'scrollbar-fixture',
        title: '合成面试记录：滚动条与固定工具栏边界',
        titleStatus: 'ready',
        startedAt: 1000,
        endedAt: 121000,
        status: 'ended',
        mock: false,
        transcripts: Array.from({ length: 120 }, (_, i) => ({
          id: 't' + i,
          source: 'system',
          text: '合成转录内容 '.repeat(5),
          time: '00:01',
          startMs: 1000 + i * 1000,
          final: true,
        })),
        answers: [
          {
            id: 'answer',
            question: '合成问题',
            content: '合成回答。\n\n'.repeat(50),
            provider: 'chatgpt',
            sourceTranscriptIds: ['t0'],
            createdAt: 2000,
          },
        ],
      };
      await fixtureHistory.replace([record]);
    });
    if (syncOnly || scale === '1.25') {
      await checkSyncPopover(app, page);
      if (syncOnly) continue;
    }
    await page
      .locator('.history-row')
      .locator('.history-row-open')
      .click({ position: { x: 16, y: 16 } });
    if (preview) {
      await page.getByRole('button', { name: 'AI 回答面板', exact: true }).click();
      await page.waitForFunction(() =>
        document
          .getAnimations()
          .every(
            (animation) =>
              animation.effect?.getTiming().iterations === Infinity ||
              animation.playState !== 'running',
          ),
      );
      const output = path.join(testRoot, `record-initial-${scale}.png`);
      await writeFile(output, await page.screenshot({ scale: 'css' }));
      console.log('INITIAL ' + output);
    }
    const browser = await app.browserWindow(page);
    for (const size of [
      [1280, 800],
      [960, 680],
    ]) {
      await browser.evaluate((win, size) => win.setContentSize(...size), size);
      for (const dark of [false, true]) {
        await page.evaluate(
          (dark) => document.documentElement.classList.toggle('dark', dark),
          dark,
        );
        for (const expanded of [false, true]) {
          const toggle = page.getByRole('button', { name: 'AI 回答面板', exact: true });
          if ((await toggle.getAttribute('aria-expanded')) !== String(expanded))
            await toggle.click();
          await page.waitForFunction(() =>
            document
              .getAnimations()
              .every(
                (animation) =>
                  animation.effect?.getTiming().iterations === Infinity ||
                  animation.playState !== 'running',
              ),
          );
          const scroll = page.locator('.record-transcript-scroll');
          await scroll.evaluate((node) => {
            node.scrollTop = 0;
          });
          const toolbar = await page.locator('.record-detail-toolbar').boundingBox();
          const viewport = await scroll.boundingBox();
          const covered =
            expanded &&
            (await page
              .locator('.record-answer-panel')
              .evaluate((node) => getComputedStyle(node).position === 'absolute'));
          // Give only the thumb a sentinel color, preserving its real native
          // geometry, viewport, track margins and the toolbar composition.
          const sentinel = await page.evaluateHandle(() => {
            const sheet = [...document.styleSheets].find((value) =>
              value.href?.startsWith(new URL('.', location.href).href),
            );
            if (!sheet) throw Error('The application stylesheet is unavailable');
            const index = sheet.cssRules.length;
            // Application CSP rejects inline style tags. Instrument only this
            // owned document's existing CSSOM; do not relax its security policy.
            sheet.insertRule(
              '.record-transcript-scroll::-webkit-scrollbar-thumb{background:rgb(255,0,255)!important;border:0!important}',
              index,
            );
            return { sheet, index };
          });
          assert.equal(
            await scroll.evaluate(
              (node) => getComputedStyle(node, '::-webkit-scrollbar-thumb').backgroundColor,
            ),
            'rgb(255, 0, 255)',
            'The pixel sentinel must be applied before inspecting native scrollbar geometry',
          );
          await scroll.evaluate(async (node) => {
            // Recreate only the scrollbar's cached paint after the CSSOM
            // instrumentation. Restore the exact inline style and geometry.
            const top = node.scrollTop;
            const value = node.style.getPropertyValue('overflow');
            const priority = node.style.getPropertyPriority('overflow');
            node.style.setProperty('overflow', 'hidden');
            node.getBoundingClientRect();
            if (value) node.style.setProperty('overflow', value, priority);
            else node.style.removeProperty('overflow');
            node.scrollTop = top;
            await new Promise((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(resolve)),
            );
          });
          assert.deepEqual(
            await scroll.boundingBox(),
            viewport,
            'Color instrumentation preserves the exact viewport',
          );
          const clip = {
            x: Math.max(0, Math.floor(viewport.x + viewport.width - 12)),
            y: Math.max(0, Math.floor(toolbar.y)),
            width: 12,
            height: Math.ceil(toolbar.height + 100),
          };
          const png = await page.screenshot({ clip, scale: 'css', animations: 'disabled' });
          const thumb = await app.evaluate(({ nativeImage }, encoded) => {
            const image = nativeImage.createFromBuffer(Buffer.from(encoded, 'base64'));
            const { width, height } = image.getSize(),
              pixels = image.toBitmap(),
              ys = [];
            for (let y = 0; y < height; y++)
              for (let x = 0; x < width; x++) {
                const i = (y * width + x) * 4;
                if (
                  pixels[i] > 240 &&
                  pixels[i + 1] < 15 &&
                  pixels[i + 2] > 240 &&
                  pixels[i + 3] > 200
                )
                  ys.push(y);
              }
            return { first: ys.length ? Math.min(...ys) : null, count: ys.length };
          }, png.toString('base64'));
          if (thumb.first === null)
            await captureRequested(page, `history-thumb-${scale}-${size[0]}-${dark}-${expanded}`);
          await sentinel.evaluate(({ sheet, index }) => sheet.deleteRule(index));
          await sentinel.dispose();
          if (thumb.first === null)
            assert.equal(
              covered,
              true,
              'Only the narrow answer overlay may occlude the thumb: ' +
                JSON.stringify({
                  scale,
                  size,
                  dark,
                  expanded,
                  toolbar,
                  viewport,
                  thumb,
                  metrics: await scroll.evaluate((node) => ({
                    scrollHeight: node.scrollHeight,
                    clientHeight: node.clientHeight,
                    scrollWidth: node.scrollWidth,
                    clientWidth: node.clientWidth,
                    scrollbarWidth: getComputedStyle(node).scrollbarWidth,
                    track: getComputedStyle(node, '::-webkit-scrollbar-track').marginTop,
                    position: getComputedStyle(node).position,
                    thumb: getComputedStyle(node, '::-webkit-scrollbar-thumb').backgroundColor,
                  })),
                }),
            );
          else {
            assert.ok(
              clip.y + thumb.first >= toolbar.y + toolbar.height - 1,
              JSON.stringify({ scale, size, dark, expanded, toolbar, viewport, thumb }),
            );
          }
          await scroll.evaluate((node) => {
            node.scrollTop = 500;
          });
          assert.ok(await scroll.evaluate((node) => node.scrollTop > 0));
          const after = await page.locator('.record-detail-toolbar').boundingBox();
          assert.deepEqual(after, toolbar, 'Toolbar stays fixed while transcript scrolls');
          const exportButton = page.getByRole('button', { name: '导出转写', exact: true });
          assert.equal(
            await exportButton.evaluate((node) => {
              const rect = node.getBoundingClientRect();
              return node.contains(
                document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2),
              );
            }),
            true,
            'Export remains unobscured and hit-testable',
          );
          checks.push({
            scale,
            size,
            dark,
            expanded,
            covered,
            thumbTop: thumb.first === null ? null : clip.y + thumb.first,
            headerBottom: toolbar.y + toolbar.height,
          });
          if (
            preview &&
            scale === '1.75' &&
            expanded &&
            ((size[0] === 1280 && !dark) || (size[0] === 960 && dark))
          ) {
            await scroll.evaluate((node) => {
              node.scrollTop = 0;
            });
            const output = path.join(testRoot, `record-${size[0]}-${dark ? 'dark' : 'light'}.png`);
            await writeFile(output, await page.screenshot({ scale: 'css' }));
            console.log('PREVIEW ' + output);
          }
        }
      }
    }
  } finally {
    await closeUiApp(app);
  }
}
console.log(
  JSON.stringify({
    status: 'passed',
    checks: checks.length,
    scales,
    syncPopover: syncOnly || scales.includes('1.25'),
    nativeThumbPixels: !syncOnly,
    fixedHeader: !syncOnly,
    exportHit: !syncOnly,
  }),
);
if (preview) {
  console.log('Preview files are temporary; press Enter to clean up.');
  await new Promise((resolve) => process.stdin.once('data', resolve));
  process.stdin.pause();
}
