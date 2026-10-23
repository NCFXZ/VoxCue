import assert from 'node:assert/strict';

// Raster checks use only the fixture's own window and opaque synthetic backdrop.
// NativeImage decodes pixels in memory; no test images or reports are retained.
export async function checkHandoffContent({
  app,
  page,
  state,
  probe,
  probeFile,
  poll,
  choose,
  capture,
}) {
  const flatten = (node) => [node, ...(node.children ?? []).flatMap(flatten)];
  // Keep protection disabled for this owned synthetic window throughout the
  // comparison. Toggling it per capture invalidates Chromium's compositor and
  // can return different pending frames even without changing any material.
  await app.evaluate(({ app, BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((win) => win.getTitle() === 'VoxCue');
    win.setContentProtection(false);
    app.focus({ steal: true });
    win.focus();
  });
  await poll(state, (value) => value.windowKey, 'The owned content window must have native focus');
  const raster = async (clip) =>
    Buffer.from(
      await app.evaluate(
        async ({ BrowserWindow, nativeImage }, { file, clip }) => {
          const require = process
            .getBuiltinModule('module')
            .createRequire(process.cwd() + '/package.json');
          const win = BrowserWindow.getAllWindows().find((win) => win.getTitle() === 'VoxCue');
          const result = await require(file).snapshot(win.getNativeWindowHandle());
          const image = nativeImage.createFromBuffer(result.png);
          return image
            .crop({
              x: Math.round(result.crop.x + clip.x),
              y: Math.round(result.crop.y + clip.y),
              width: Math.floor(clip.width),
              height: Math.floor(clip.height),
            })
            .toBitmap()
            .toString('base64');
        },
        { file: probeFile, clip },
      ),
      'base64',
    );
  const header = (value) =>
    flatten(value.tree).find((node) => node.identifier === 'voxcue-header-material');
  const delay = () => page.waitForTimeout(250);
  await page.getByRole('button', { name: '新对话', exact: true }).click();
  const surface = await poll(
    async () => {
      for (const candidate of app.context().pages())
        if (!candidate.isClosed() && (await candidate.title()) === 'VoxCue composer')
          return candidate;
    },
    Boolean,
    'Projected composer missing',
  );
  for (const dark of [false, true]) {
    await page.evaluate((dark) => document.documentElement.classList.toggle('dark', dark), dark);
    for (const name of ['添加附件', '聊天模型', '思考强度']) {
      const button = surface.getByRole('button', { name, exact: true });
      await surface.mouse.move(1, 1);
      await probe('moveAt', { x: 1, y: 1 });
      await button.evaluate((node) => node.blur());
      await delay();
      assert.equal(
        await button.evaluate((node) => getComputedStyle(node).backgroundColor),
        'rgba(0, 0, 0, 0)',
      );
      const before = await button.boundingBox();
      await button.hover();
      await probe('moveAt', { x: before.x + before.width / 2, y: before.y + before.height / 2 });
      await delay();
      if (!(await button.evaluate((node) => node.matches(':hover')))) {
        console.error('Projected hover route', {
          name,
          dark,
          before,
          nativeKey: (await state()).windowKey,
          browser: await surface.evaluate(
            ({ x, y }) => ({
              focused: document.hasFocus(),
              hovered: [...document.querySelectorAll(':hover')].map(
                (node) => node.tagName + '.' + node.className,
              ),
              hit: document.elementFromPoint(x, y)?.outerHTML,
              width: innerWidth,
              height: innerHeight,
            }),
            { x: before.x + before.width / 2, y: before.y + before.height / 2 },
          ),
          windows: await app.evaluate(({ BrowserWindow }) =>
            BrowserWindow.getAllWindows().map((win) => ({
              title: win.getTitle(),
              visible: win.isVisible(),
              focused: win.isFocused(),
            })),
          ),
        });
      }
      assert.equal(await button.evaluate((node) => node.matches(':hover')), true);
      assert.notEqual(
        await button.evaluate((node) => getComputedStyle(node).backgroundColor),
        'rgba(0, 0, 0, 0)',
      );
      assert.deepEqual(await button.boundingBox(), before);
      await surface.keyboard.press('Tab');
      await button.focus();
      assert.equal(await button.evaluate((node) => node.matches(':focus-visible')), true);
      await surface.mouse.move(1, 1);
      await probe('moveAt', { x: 1, y: 1 });
      await delay();
      assert.notEqual(
        await button.evaluate((node) => getComputedStyle(node).backgroundColor),
        'rgba(0, 0, 0, 0)',
      );
    }
    const marker = await surface.evaluate(() => {
      const node = document.createElement('div');
      node.id = 'owned-raster-marker';
      node.style.cssText =
        'position:absolute;left:50%;bottom:3px;width:8px;height:8px;background:rgb(40,220,100);z-index:100;pointer-events:none';
      document.querySelector('.composer').append(node);
      return node.getBoundingClientRect().toJSON();
    });
    const clip = { x: marker.x + 2, y: marker.y + 2, width: 3, height: 3 };
    await page.mouse.move(1, 1);
    await delay();
    const before = await raster(clip);
    await choose(page.getByRole('button', { name: '用户菜单', exact: true }), '设置');
    const settings = page.getByRole('dialog', { name: '设置', exact: true });
    try {
      await settings.waitFor();
    } catch (error) {
      const native = await state();
      console.error('Settings menu did not open the modal', {
        dark,
        windowKey: native.windowKey,
        menuItems: native.menuItems,
        page: await page.evaluate(() => ({
          active: document.activeElement?.outerHTML,
          dialogs: [...document.querySelectorAll('dialog')].map((node) => ({
            open: node.open,
            text: node.textContent.slice(0, 80),
          })),
          menus: [...document.querySelectorAll('[role="menu"]')].map((node) => node.outerHTML),
        })),
      });
      await capture('handoff-settings-failure');
      throw error;
    }
    await poll(
      state,
      (value) => flatten(value.tree).some((node) => node.class === 'VoxCueModalBackground'),
      'Native modal dimming is missing',
    );
    const dialogBox = await settings.boundingBox();
    assert.ok(clip.y > dialogBox.y + dialogBox.height, 'Raster marker must be outside the modal');
    await delay();
    const dimmed = await raster(clip);
    for (let i = 0; i < before.length; i++)
      if (i % 4 !== 3)
        assert.ok(
          Math.abs(dimmed[i] - before[i] * 0.6) <= 2,
          `Projected native foreground must receive exactly 40% black: ${before[i]} -> ${dimmed[i]}`,
        );
    assert.equal(await settings.evaluate((node) => getComputedStyle(node).boxShadow), 'none');
    await capture(`handoff-settings-${dark ? 'dark' : 'light'}`);
    await settings.getByRole('button', { name: '关闭设置', exact: true }).click();
    await delay();
    assert.ok(
      before.equals(await raster(clip)),
      'Closing the modal restores projected foreground pixels',
    );
    await surface.evaluate(() => document.getElementById('owned-raster-marker').remove());
  }
  await app.evaluate(({ app }) => {
    const require = process
      .getBuiltinModule('module')
      .createRequire(app.getAppPath() + '/package.json');
    const { ChatGPTService } = require(
      app.getAppPath() + '/dist-electron/shared/electron/backend/chat/service.js',
    );
    ChatGPTService.prototype.stream = async () => ({
      answerText: '合成提案检查',
      usage: null,
      sources: [],
      profileChanges: {
        background: '原生玻璃路径中的合成摘要',
        skills: [
          { id: 'handoff-skill', title: '合成技能', content: '只用于本次隔离验收', sources: [] },
        ],
      },
    });
  });
  await surface.getByRole('textbox', { name: '聊天消息', exact: true }).fill('生成合成资料提案');
  await surface.getByRole('button', { name: '发送消息', exact: true }).click();
  const proposal = page.locator('.profile-proposal').last();
  await proposal.waitFor();
  for (const saved of [false, true]) {
    if (saved) {
      await proposal.getByRole('button', { name: '保存所选', exact: true }).click();
      await proposal.getByText('已保存所选资料', { exact: true }).waitFor();
    }
    const expand = proposal.getByRole('button', { name: '展开技能清单', exact: true });
    if (await expand.count()) await expand.click();
    assert.equal(await proposal.locator('.proposal-view').count(), 3);
    for (const button of await proposal.locator('.proposal-view').all()) {
      await button.scrollIntoViewIfNeeded();
      await page.mouse.move(1, 1);
      await button.evaluate((node) => node.blur());
      await delay();
      assert.equal(
        await button.evaluate((node) => getComputedStyle(node).backgroundColor),
        'rgba(0, 0, 0, 0)',
      );
      const rect = await button.boundingBox();
      await button.hover();
      await delay();
      assert.notEqual(
        await button.evaluate((node) => getComputedStyle(node).backgroundColor),
        'rgba(0, 0, 0, 0)',
      );
      assert.deepEqual(await button.boundingBox(), rect);
      await page.keyboard.press('Tab');
      await button.focus();
      assert.equal(await button.evaluate((node) => node.matches(':focus-visible')), true);
    }
  }
  await page.getByRole('button', { name: '知识库', exact: true }).click();
  await page.evaluate(() => {
    const marker = document.createElement('div');
    marker.id = 'owned-knowledge-marker';
    marker.style.cssText =
      'position:fixed;left:12px;top:180px;width:8px;height:8px;background:rgb(40,220,100);z-index:100;pointer-events:none';
    document.body.append(marker);
  });
  const knowledgeClip = { x: 14, y: 182, width: 3, height: 3 };
  await delay();
  const knowledgeBefore = await raster(knowledgeClip);
  const checkKnowledgeMask = async (dialog) => {
    await dialog.waitFor();
    await delay();
    assert.equal(await dialog.evaluate((node) => getComputedStyle(node).boxShadow), 'none');
    const dimmed = await raster(knowledgeClip);
    for (let i = 0; i < dimmed.length; i++)
      if (i % 4 !== 3)
        assert.ok(
          Math.abs(dimmed[i] - knowledgeBefore[i] * 0.6) <= 2,
          'Knowledge native backdrop must dim exactly once without a halo',
        );
  };
  await page
    .locator('.knowledge-page .page-toolbar')
    .getByRole('button', { name: '创建知识库', exact: true })
    .click();
  const create = page.getByRole('dialog', { name: '创建知识库', exact: true });
  await checkKnowledgeMask(create);
  await create.getByLabel('知识库名称', { exact: true }).fill('原生压暗合成知识库');
  await create.getByRole('button', { name: '保存', exact: true }).click();
  const library = page.getByRole('dialog', { name: '原生压暗合成知识库', exact: true });
  await checkKnowledgeMask(library);
  await library.getByRole('button', { name: '重命名', exact: true }).click();
  const renameLibrary = page.getByRole('dialog', { name: '重命名知识库', exact: true });
  await checkKnowledgeMask(renameLibrary);
  await renameLibrary.press('Escape');
  await library.getByRole('button', { name: '关闭对话框', exact: true }).click();
  await delay();
  assert.ok(
    knowledgeBefore.equals(await raster(knowledgeClip)),
    'Knowledge closing restores the background',
  );
  await page.evaluate(() => document.getElementById('owned-knowledge-marker').remove());
  await page.getByRole('button', { name: '面试记录', exact: true }).click();
  await page.evaluate(() => {
    const startedAt = Date.now() - 600000;
    const transcripts = Array.from({ length: 90 }, (_, i) => ({
      id: 'native-transcript-' + i,
      source: 'system',
      text: `第${i}条合成转写：检查原生工具栏虚化和正文。`,
      time: '10:00',
      startMs: startedAt + i * 1000,
      final: true,
    }));
    const record = {
      id: 'native-handoff-record',
      title: '原生长记录合成验收',
      titleStatus: 'ready',
      startedAt,
      endedAt: Date.now(),
      status: 'ended',
      mock: false,
      transcripts,
      answers: [
        {
          id: 'native-answer',
          question: transcripts[50].text,
          content: '合成回答内容',
          status: 'completed',
          createdAt: startedAt + 50000,
          sourceTranscriptIds: [transcripts[50].id],
        },
      ],
    };
    localStorage.setItem('copilot-interview-history-v1', JSON.stringify([record]));
    window.dispatchEvent(new StorageEvent('storage', { key: 'copilot-interview-history-v1' }));
  });
  await page.locator('.history-row').click();
  for (const dark of [false, true]) {
    await page.evaluate((dark) => document.documentElement.classList.toggle('dark', dark), dark);
    for (const width of [1280, 980]) {
      await app.evaluate(
        ({ BrowserWindow }, width) =>
          BrowserWindow.getAllWindows()
            .find((win) => win.getTitle() === 'VoxCue')
            .setSize(width, 800),
        width,
      );
      await page.waitForFunction((width) => innerWidth === width, width);
      const scroll = page.locator('.record-transcript-scroll');
      await scroll.evaluate((node) => (node.scrollTop = 400));
      await poll(
        state,
        (value) => header(value)?.alpha === 1 && header(value)?.style === 0,
        'History detail must use the actual native Regular header',
      );
      const toolbar = await page.locator('.record-detail-toolbar').boundingBox();
      const native = header(await state());
      const frame = native.frame.match(/-?[\d.]+/g).map(Number);
      assert.ok(
        Math.abs(frame[2] - toolbar.width) < 1 && Math.abs(frame[3] - toolbar.height) < 1,
        'Native header only covers the actual toolbar',
      );
      assert.ok(
        flatten((await state()).tree).find((node) => node.identifier === 'voxcue-header-title')
          .hidden,
        'Detail must not acquire a duplicate native title',
      );
      const rect = await scroll.boundingBox();
      const bodyClip = {
        x: rect.x + 12,
        y: toolbar.y + toolbar.height + 12,
        width: rect.width - 24,
        height: 150,
      };
      await page.mouse.move(1, 1);
      await delay();
      let body = await raster(bodyClip);
      await poll(
        async () => {
          const next = await raster(bodyClip),
            stable = body.equals(next);
          body = next;
          return stable;
        },
        Boolean,
        'Native body must settle before comparing header visibility',
      );
      await probe('headerHidden', true);
      await delay();
      const uncovered = await raster(bodyClip);
      if (!body.equals(uncovered)) {
        let pixels = 0,
          minY = 1000,
          maxY = 0;
        for (let i = 0; i < body.length; i += 4)
          if (!body.subarray(i, i + 4).equals(uncovered.subarray(i, i + 4))) {
            const y = Math.floor(i / 4 / Math.floor(bodyClip.width));
            pixels++;
            minY = Math.min(minY, y);
            maxY = Math.max(maxY, y);
          }
        console.error('Native header spill', { dark, width, bodyClip, pixels, minY, maxY });
      }
      assert.ok(
        body.equals(uncovered),
        'Native glass must not cover or blur the body below the toolbar',
      );
      await probe('headerHidden', false);
      await delay();
      const headerPixels = await raster(toolbar);
      await scroll.evaluate((node) => (node.style.visibility = 'hidden'));
      await delay();
      assert.equal(
        headerPixels.equals(await raster(toolbar)),
        false,
        'Transcript pixels must actually paint behind the native header',
      );
      await scroll.evaluate((node) => {
        node.style.visibility = '';
        node.scrollTop = 0;
      });
      await poll(
        state,
        (value) => header(value)?.alpha === 0,
        'Returning to the top clears native header glass',
      );
      await page.getByRole('heading', { name: '原生长记录合成验收', exact: true }).waitFor();
      if (process.argv.some((arg) => arg.startsWith('--screenshots='))) {
        await scroll.evaluate((node) => (node.scrollTop = 400));
        await delay();
        await capture(`handoff-history-${dark ? 'dark' : 'light'}-${width}`);
        await scroll.evaluate((node) => (node.scrollTop = 0));
      }
    }
  }
  await page.getByRole('button', { name: 'AI 回答面板', exact: true }).click();
  await page.locator('.record-answer-panel').waitFor({ state: 'visible' });
  if (process.argv.some((arg) => arg.startsWith('--screenshots=')))
    await capture('handoff-history-answer-panel');
  await page.getByRole('button', { name: '定位到原问题', exact: true }).click();
  await page.locator('.record-transcript-row.is-located').waitFor();
  await page.getByRole('button', { name: '收起侧栏', exact: true }).click();
  await delay();
  const fullToolbar = await page.locator('.record-detail-toolbar').boundingBox();
  const workspace = await page.locator('.history-detail').boundingBox();
  assert.equal(
    fullToolbar.width,
    workspace.width,
    'Header retains full width while answers or sidebar change',
  );
  await app.evaluate(({ dialog }) => {
    dialog.showSaveDialog = async () => {
      throw Error('Synthetic export failure');
    };
  });
  await page.getByRole('button', { name: '导出 TXT', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: '导出失败' }).waitFor();
  const alert = await page.locator('.record-export-error').boundingBox();
  const viewport = await page.locator('.record-transcript-scroll').boundingBox();
  assert.ok(viewport.y >= alert.y + alert.height, 'Error messages retain their own layout row');
  await page.getByRole('button', { name: '重命名标题', exact: true }).click();
  const rename = page.getByRole('dialog', { name: '重命名标题', exact: true });
  await rename.getByRole('textbox').fill('原生长记录已重命名');
  await rename.getByRole('button', { name: '保存标题', exact: true }).click();
  await page.getByRole('heading', { name: '原生长记录已重命名', exact: true }).waitFor();
  console.log(
    'PASS: actual Liquid Glass composer hover/keyboard, 40% projected-foreground dimming/restoration, and native history header/body raster checks in both themes and narrow windows.',
  );
}
