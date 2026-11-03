import { connectUiAccount } from '../../../shared/test/scripts/install-ui-account.mjs';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { testRoot, electron } from '../../../shared/test/scripts/test-workspace.mjs';
import { installUiAccount, closeUiApp } from '../../../shared/test/scripts/install-ui-account.mjs';
import { captureRequested } from '../../../shared/test/scripts/capture-requested.mjs';

const selected = process.argv.find((arg) => arg.startsWith('--scale='))?.slice(8);
const scales = selected ? [selected] : ['1', '1.25', '1.5', '1.75', '2'];
assert.ok(scales.every((scale) => ['1', '1.25', '1.5', '1.75', '2'].includes(scale)));
const preview = process.argv.includes('--preview');
if (preview && !process.stdin.isTTY)
  throw Error('Temporary preview requires an interactive terminal');
const checks = [];
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
    await page.evaluate(() => {
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
      localStorage.setItem('copilot-interview-history-v1', JSON.stringify([record]));
      window.dispatchEvent(new StorageEvent('storage', { key: 'copilot-interview-history-v1' }));
    });
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
          const exportButton = page.getByRole('button', { name: '导出 TXT', exact: true });
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
    nativeThumbPixels: true,
    fixedHeader: true,
    exportHit: true,
  }),
);
if (preview) {
  console.log('Preview files are temporary; press Enter to clean up.');
  await new Promise((resolve) => process.stdin.once('data', resolve));
  process.stdin.pause();
}
