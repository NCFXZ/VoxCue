import assert from 'node:assert/strict';
import path from 'node:path';
import { captureRequested } from './capture-requested.mjs';

// Own synthetic IndexedDB/history only; no real documents, indexing or hardware.
export async function checkManagementScrollbars({ app, main, directory }) {
  await main.evaluate(async () => {
    localStorage.setItem(
      'copilot-interview-history-v1',
      JSON.stringify(
        Array.from({ length: 24 }, (_, i) => ({
          id: 'scroll-record-' + i,
          title: '合成滚动面试 ' + i,
          titleStatus: 'ready',
          titleSource: 'manual',
          startedAt: Date.now() - i * 60000,
          endedAt: Date.now(),
          status: 'ended',
          mock: false,
          transcripts: Array.from({ length: 60 }, (_, j) => ({
            id: 't-' + j,
            text: '合成转写，用于验证滚动条和固定标题的避让。',
            source: 'system',
            final: true,
            time: '00:01',
          })),
          answers: Array.from({ length: 20 }, (_, j) => ({
            id: 'a-' + j,
            question: '合成问题 ' + j,
            content: '合成回答用于检查侧栏滚动。'.repeat(15),
            provider: 'chatgpt',
            createdAt: Date.now(),
            status: 'completed',
          })),
        })),
      ),
    );
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('copilot-local-documents', 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore('bases', { keyPath: 'id' });
        request.result
          .createObjectStore('documents', { keyPath: 'id' })
          .createIndex('baseId', 'baseId');
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise((resolve, reject) => {
      const tx = db.transaction(['bases', 'documents'], 'readwrite');
      for (let i = 0; i < 16; i++)
        tx.objectStore('bases').put({
          id: 'scroll-base-' + i,
          name: '合成滚动知识库 ' + i,
          createdAt: Date.now() - i,
        });
      for (let i = 0; i < 18; i++)
        tx.objectStore('documents').put({
          id: 'scroll-file-' + i,
          baseId: 'scroll-base-0',
          name: '合成文件-' + i + '.txt',
          size: 9,
          type: 'text/plain',
          createdAt: Date.now() - i,
          blob: new Blob(['synthetic']),
        });
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  });
  const settle = () =>
    main.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
  const verify = async (scroll, header, { gutter = true, material = true } = {}) => {
    await scroll.waitFor();
    await header.waitFor();
    // New page contents mount before their browser snapshot stops intercepting
    // input. Wheel coverage must exercise the live scroll viewport.
    await main.waitForFunction(
      () =>
        !document.documentElement.dataset.viewDirection &&
        document
          .getAnimations()
          .every(
            (animation) =>
              animation.effect?.getTiming().iterations === Infinity ||
              animation.playState !== 'running',
          ),
    );
    const top = await header.evaluate((node) => node.getBoundingClientRect().top);
    assert.ok(await scroll.evaluate((node) => node.scrollHeight > node.clientHeight));
    for (const position of [0, 240, Number.MAX_SAFE_INTEGER]) {
      await scroll.evaluate((node, position) => {
        node.scrollTop = position;
      }, position);
      await settle();
      const geometry = await scroll.evaluate(
        (node, headerSelector) => {
          const header = document.querySelector(headerSelector),
            a = node.getBoundingClientRect(),
            b = header.getBoundingClientRect(),
            scrollbar = getComputedStyle(node, '::-webkit-scrollbar'),
            thumb = getComputedStyle(node, '::-webkit-scrollbar-thumb');
          return {
            top: b.top,
            height: b.height,
            headerBottom: b.bottom,
            scrollTop: a.top,
            track: parseFloat(getComputedStyle(node, '::-webkit-scrollbar-track').marginTop),
            gutterLeft: a.left + node.clientWidth,
            headerRight: b.right,
            filter: getComputedStyle(header, '::before').backdropFilter,
            contentHeight: node.scrollHeight,
            viewportHeight: node.clientHeight,
            contentTop: node.scrollTop,
            roundedEndResidual: node.scrollHeight - node.scrollTop - node.clientHeight,
            scrollbar: {
              width: parseFloat(scrollbar.width),
              height: parseFloat(scrollbar.height),
              radius: parseFloat(thumb.borderTopLeftRadius),
              corner: thumb.cornerShape,
            },
          };
        },
        await header.evaluate((node) => {
          node.dataset.scrollbarCheckHeader = 'true';
          return '[data-scrollbar-check-header="true"]';
        }),
      );
      assert.ok(Math.abs(top - geometry.top) < 1, JSON.stringify(geometry));
      assert.equal(geometry.scrollbar.width, 6, 'The existing scrollbar width stays unchanged');
      assert.equal(geometry.scrollbar.height, 6, 'Horizontal scrollbar thickness stays unchanged');
      assert.ok(['round', 'superellipse(1)'].includes(geometry.scrollbar.corner));
      assert.ok(
        geometry.scrollbar.radius >= geometry.scrollbar.width / 2,
        'The thumb end caps must normalize to semicircles: ' + JSON.stringify(geometry.scrollbar),
      );
      assert.ok(
        geometry.scrollTop + geometry.track >= geometry.headerBottom - 1,
        JSON.stringify(geometry),
      );
      if (gutter)
        assert.ok(geometry.headerRight <= geometry.gutterLeft + 1, JSON.stringify(geometry));
      if (material) assert.ok(geometry.filter.includes('24px'), JSON.stringify(geometry));
      if (position === Number.MAX_SAFE_INTEGER) {
        // Under fractional application zoom, the two integer height properties
        // round independently from the fractional scroll position (125% gave
        // 1882 - 1304.8 - 576 = 1.2). Check the actual browser clamp and the
        // final content box instead, keeping the original <1 CSS px precision.
        const end = await scroll.evaluate((node) => {
          const before = node.scrollTop;
          node.scrollTop += 4096;
          const viewport = node.getBoundingClientRect();
          return {
            remainingMovement: node.scrollTop - before,
            lastBottom: node.lastElementChild.getBoundingClientRect().bottom,
            viewportBottom: viewport.bottom - parseFloat(getComputedStyle(node).borderBottomWidth),
          };
        });
        assert.equal(end.remainingMovement, 0, JSON.stringify({ geometry, end }));
        assert.ok(end.lastBottom - end.viewportBottom < 1, JSON.stringify({ geometry, end }));
        if (Math.abs(geometry.roundedEndResidual) >= 1)
          console.log('Fractional scroll-end geometry: ' + JSON.stringify({ geometry, end }));
      }
      await header.evaluate((node) => delete node.dataset.scrollbarCheckHeader);
    }
    await scroll.evaluate((node) => {
      node.scrollTop = 0;
    });
    await settle();
    const bounds = await scroll.boundingBox();
    await main.mouse.move(bounds.x + Math.min(150, bounds.width / 2), bounds.y + bounds.height / 2);
    await main.mouse.wheel(0, 240);
    await main.waitForFunction(
      (selector) => document.querySelector(selector).scrollTop > 0,
      await scroll.evaluate((node) => {
        node.dataset.scrollbarCheckScroll = 'true';
        return '[data-scrollbar-check-scroll="true"]';
      }),
    );
    await scroll.evaluate((node) => delete node.dataset.scrollbarCheckScroll);
  };
  for (const width of [1280, 960]) {
    await app.evaluate(
      ({ BrowserWindow }, width) =>
        BrowserWindow.getAllWindows()
          .find((win) => win.isVisible())
          .setSize(width, width === 1280 ? 800 : 680),
      width,
    );
    await main.waitForTimeout(240);
    const sidebar = main.locator('.sidebar');
    const contentWidth = 210;
    await main.getByRole('button', { name: '收起侧栏', exact: true }).click();
    await main.waitForTimeout(230);
    await main.getByRole('button', { name: '展开侧栏', exact: true }).click();
    await main.waitForTimeout(70);
    assert.ok(
      Math.abs(
        (await sidebar.locator('nav').evaluate((node) => node.getBoundingClientRect().width)) -
          contentWidth,
      ) < 0.1,
    );
    await main.waitForTimeout(180);
    const layout = await sidebar.evaluate((node) => {
      const parent = node.getBoundingClientRect();
      return [
        ...node.querySelectorAll(
          '.sidebar-toggle-button, .user-button, .nav-item, .conversation-row',
        ),
      ].map((item) => {
        const r = item.getBoundingClientRect();
        return {
          className: item.className,
          left: r.left - parent.left,
          right: parent.right - r.right,
        };
      });
    });
    assert.ok(
      layout.every((item) => item.left >= 0 && item.right >= 4),
      JSON.stringify(layout),
    );
    for (const dark of [false, true]) {
      await main.evaluate((dark) => document.documentElement.classList.toggle('dark', dark), dark);
      for (const [label, selector] of [
        ['面试记录', '.history-page'],
        ['知识库', '.knowledge-page'],
      ]) {
        await main.getByRole('button', { name: label, exact: true }).click();
        const page = main.locator(selector);
        await page.waitFor();
        if (label === '面试记录') await page.locator('.history-row').first().waitFor();
        else await page.locator('.knowledge-card').first().waitFor();
        await verify(
          page.locator(':scope > .management-scroll'),
          page.locator(':scope > .page-toolbar'),
        );
        await captureRequested(main, `scrollbar-${width}-${dark ? 'dark' : 'light'}-${label}`);
        if (process.argv.includes('--preview'))
          await main.screenshot({
            path: path.join(
              directory,
              `scrollbar-${width}-${dark ? 'dark' : 'light'}-${label}.png`,
            ),
          });
        if (process.argv.includes('--preview')) {
          await page.locator(':scope > .management-scroll').evaluate((node) => {
            node.scrollTop = 0;
          });
          await settle();
          await main.screenshot({
            path: path.join(
              directory,
              `scrollbar-top-${width}-${dark ? 'dark' : 'light'}-${label}.png`,
            ),
          });
        }
      }
    }
  }
  await main.getByRole('button', { name: '面试记录', exact: true }).click();
  await main
    .locator('.history-row')
    .first()
    .locator('.history-row-open')
    .click({ position: { x: 16, y: 16 } });
  await main.locator('.history-detail').waitFor();
  await verify(main.locator('.record-transcript-scroll'), main.locator('.record-detail-toolbar'), {
    gutter: false,
  });
  await main.getByRole('button', { name: 'AI 回答面板', exact: true }).click();
  await main.waitForTimeout(260);
  await verify(
    main.locator('.record-answer-scroll'),
    main.locator('.record-answer-panel > header'),
  );
  await main.getByRole('button', { name: '返回面试记录', exact: true }).click();
  await main.getByRole('button', { name: '知识库', exact: true }).click();
  await main.locator('.knowledge-card').filter({ hasText: '合成滚动知识库 0' }).click();
  const detail = main.getByRole('dialog', { name: '合成滚动知识库 0', exact: true });
  await verify(
    detail.locator(':scope > .dialog-scroll'),
    detail.locator(':scope > .dialog-heading'),
  );
  await detail.getByRole('button', { name: '关闭对话框', exact: true }).click();

  await main.getByRole('button', { name: '用户菜单', exact: true }).click();
  await main.getByRole('menuitem', { name: '设置', exact: true }).click();
  const settings = main.getByRole('dialog', { name: '设置', exact: true });
  await settings.getByRole('button', { name: 'AI 服务', exact: true }).click();
  await settings
    .locator('.settings-entry')
    .filter({ hasText: 'ChatGPT' })
    .getByRole('button', { name: '连接', exact: true })
    .click();
  await settings
    .locator('.settings-entry')
    .filter({ hasText: 'ChatGPT' })
    .getByRole('button', { name: '断开连接', exact: true })
    .waitFor();
  await settings.getByRole('button', { name: '关闭设置', exact: true }).click();
  await main.getByRole('button', { name: '新对话', exact: true }).click();
  if (process.argv.includes('--preview')) {
    console.log('SCROLLBAR_VISUAL_DIRECTORY=' + directory);
    await new Promise((resolve) => setTimeout(resolve, 60000));
  }
  console.log(
    'Management scrollbar UI: history/knowledge lists in light/dark at 1280/960, fixed headers, clear gutters, top/bottom/wheel scrolling, history transcript/answer rail, knowledge documents and free-mode preflight passed.',
  );
}
