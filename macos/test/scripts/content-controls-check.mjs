import assert from 'node:assert/strict';

export async function checkContentControls({
  app,
  page,
  state,
  probe,
  poll,
  capture,
  choose,
  copyOnly = false,
}) {
  const flatten = (node) => [node, ...(node.children ?? []).flatMap(flatten)];
  const header = (value) =>
    flatten(value.tree).find((node) => node.identifier === 'voxcue-header-material');
  const checkIconSizes = async () => {
    const sizes = await page.locator('button.button-icon').evaluateAll((buttons) =>
      buttons
        .filter(
          (button) =>
            button.getClientRects().length &&
            !button.closest(
              '.floating-viewport,.interview-font-preview,[hidden],dialog:not([open])',
            ),
        )
        .map((button) => {
          const rect = button.getBoundingClientRect();
          return {
            label: button.getAttribute('aria-label'),
            width: rect.width,
            height: rect.height,
            compact: button.classList.contains('is-compact'),
          };
        }),
    );
    for (const size of sizes) {
      assert.equal(size.width, size.compact ? 32 : 36, `${size.label}: icon button width`);
      assert.equal(size.height, size.compact ? 32 : 36, `${size.label}: icon button height`);
    }
  };
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((win) => win.getTitle() === 'VoxCue')
      .setSize(1280, 800),
  );
  await page.waitForFunction(() => innerWidth === 1280 && innerHeight === 800);
  if (!(await page.locator('.chat-copy').count())) {
    const composer = await poll(
      async () => {
        for (const candidate of app.context().pages())
          if (!candidate.isClosed() && (await candidate.title()) === 'VoxCue composer')
            return candidate;
      },
      Boolean,
      'Projected composer missing',
    );
    await composer
      .getByRole('textbox', { name: '聊天消息', exact: true })
      .fill('合成测试：AppKit 复制按钮。');
    await composer.getByRole('button', { name: '发送消息', exact: true }).click();
    await page.locator('.chat-copy').first().waitFor();
  }
  await checkIconSizes();
  assert.equal(
    await page.locator('.chat-thread button.macos-content-native:not(.chat-copy)').count(),
    0,
    'Response disclosures retain their existing presentation',
  );
  if (await page.locator('.chat-copy').count()) {
    const copy = page.locator('.chat-copy').first();
    await copy.scrollIntoViewIfNeeded();
    await page.waitForFunction(() =>
      document.querySelector('.chat-copy')?.classList.contains('macos-content-native'),
    );
    await page.evaluate(() =>
      Object.defineProperty(navigator.clipboard, 'writeText', {
        configurable: true,
        value: async (text) => {
          window.syntheticCopiedText = text;
        },
      }),
    );
    await page.mouse.move(1100, 100);
    await poll(
      state,
      (value) =>
        flatten(value.tree).some(
          (node) =>
            node.class === 'NSButton' &&
            node.title === '复制' &&
            node.hoverBorderOnly &&
            !node.highlighted,
        ),
      'Copy is borderless while idle',
    );
    await copy.hover();
    await poll(
      state,
      (value) =>
        flatten(value.tree).some(
          (node) =>
            node.class === 'NSButton' &&
            node.title === '复制' &&
            node.hoverBorderOnly &&
            node.highlighted,
        ),
      'Hover reveals the AppKit button background',
    );
    const bodyLeft = await copy.evaluate(
      (node) => node.closest('article').querySelector('.chat-answer').getBoundingClientRect().x,
    );
    assert.ok(
      Math.abs(
        flatten((await state()).tree).find((node) => node.title === '复制').imageLeft - bodyLeft,
      ) <= 1.5,
      'Hovered copy leading image aligns with answer text',
    );
    const copyHit = await copy.boundingBox();
    await probe('clickAt', { x: copyHit.x + copyHit.width / 2, y: copyHit.y + copyHit.height / 2 });
    await poll(
      state,
      (value) =>
        flatten(value.tree).some(
          (node) =>
            node.class === 'NSButton' &&
            node.title === '已复制' &&
            node.bezelStyle === 1 &&
            !node.inGlassContent,
        ),
      'Copy feedback must update the native content button',
    );
    assert.match(await page.evaluate(() => window.syntheticCopiedText), /合成回答/);
    await page.mouse.move(1100, 100);
    await page.waitForTimeout(100);
    await poll(
      state,
      (value) =>
        flatten(value.tree).some(
          (node) =>
            node.class === 'NSButton' &&
            node.title === '已复制' &&
            node.hoverBorderOnly &&
            !node.highlighted &&
            node.frameWidth >= node.fittingWidth,
        ),
      'Copied feedback stays borderless and fits',
    );
    assert.ok(
      Math.abs(
        flatten((await state()).tree).find((node) => node.title === '已复制').imageLeft - bodyLeft,
      ) <= 1.5,
      'Copied feedback keeps the same leading alignment',
    );
    assert.ok(
      flatten((await state()).tree).find((node) => node.title === '已复制').underScrollChrome,
      'Copy stays under toolbar glass',
    );
    await capture('content-copy-idle');
    const composer = await poll(
      async () => {
        for (const candidate of app.context().pages())
          if (!candidate.isClosed() && (await candidate.title()) === 'VoxCue composer')
            return candidate;
      },
      Boolean,
      'Composer remains available for another synthetic reply',
    );
    await composer
      .getByRole('textbox', { name: '聊天消息', exact: true })
      .fill('合成检查：让前一个复制按钮滚到工具栏后。');
    await composer.getByRole('button', { name: '发送消息', exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('.chat-copy').length >= 2);
    await copy.scrollIntoViewIfNeeded();
    const copyRect = await copy.boundingBox();
    await page.locator('.chat-scroll').evaluate((node, delta) => {
      node.scrollTop += delta;
    }, copyRect.y - 18);
    await poll(
      state,
      (value) =>
        flatten(value.tree)
          .filter((node) => node.title === '已复制')
          .every((node) => node.underScrollChrome),
      'Scrolled copy cannot cover the toolbar title',
    );
    await capture('content-copy-header');
    await page.locator('.chat-scroll').evaluate((node, delta) => {
      node.scrollTop -= delta;
    }, copyRect.y - 18);
    const shape = await page
      .locator('.chat-copy')
      .first()
      .evaluate((node) => {
        const css = getComputedStyle(node);
        return { radius: css.borderTopLeftRadius, corner: css.getPropertyValue('corner-shape') };
      });
    assert.equal(shape.radius, '999px');
    assert.equal(shape.corner, 'round');
  }
  await page.locator('.chat-scroll').evaluate((node) => {
    node.scrollTop -= 300;
  });
  const followPage = await poll(
    async () => {
      for (const candidate of app.context().pages())
        if (!candidate.isClosed() && (await candidate.title()) === 'VoxCue follow')
          return candidate;
    },
    Boolean,
    'Follow-latest foreground missing',
  );
  const latest = page.locator('.macos-follow-slot > button.follow-latest');
  await latest.hover();
  await poll(
    state,
    (value) =>
      flatten(value.tree).some(
        (node) =>
          node.identifier === 'voxcue-follow-material' &&
          !node.hidden &&
          node.style === 0 &&
          node.radius === 0 &&
          node.tint[3] === 0.12 &&
          node.tint
            .slice(0, 3)
            .every(
              (channel) => channel === (node.appearance === 'NSAppearanceNameDarkAqua' ? 1 : 0),
            ) &&
          node.foregroundAttached,
      ),
    'Follow uses the same untinted Regular and actual foreground as the composer',
  );
  assert.equal(await latest.evaluate((node) => node.matches(':hover')), true);
  await capture('content-follow-hover');
  assert.equal(
    flatten((await state()).tree).some((node) => node.identifier === 'voxcue-follow-hover'),
    false,
    'No extra Push backplate changes the Regular material',
  );
  await page.mouse.move(10, 10);
  await poll(
    state,
    (value) =>
      flatten(value.tree).some(
        (node) => node.identifier === 'voxcue-follow-material' && node.tint.length === 0,
      ),
    'Leaving follow restores untinted Regular',
  );
  await latest.hover();
  const latestRect = await latest.boundingBox();
  await probe('clickAt', {
    x: latestRect.x + latestRect.width / 2,
    y: latestRect.y + latestRect.height / 2,
  });
  await page.waitForFunction(() => {
    const scroll = document.querySelector('.chat-scroll');
    return scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 48;
  });
  if (copyOnly) {
    console.log(
      'PASS: copy alignment/hover/header clipping and Regular follow hover/native click.',
    );
    return;
  }
  const sidebarDelete = page.locator('.conversation-delete').first();
  if (await sidebarDelete.count()) {
    await page.locator('.conversation-row').first().hover();
    const idle = await sidebarDelete.boundingBox();
    assert.equal(idle.width, 32, 'Conversation delete must remain compact');
    assert.equal(idle.width, idle.height);
    await sidebarDelete.click();
    await page.waitForTimeout(250);
    const armed = await sidebarDelete.boundingBox();
    assert.ok(armed.width > armed.height);
    assert.equal(armed.height, idle.height, 'Compact delete must retain its height');
    assert.equal(
      await sidebarDelete.evaluate((node) =>
        getComputedStyle(node).getPropertyValue('corner-shape'),
      ),
      'round',
    );
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
    const restored = await sidebarDelete.boundingBox();
    assert.equal(restored.width, restored.height);
  }
  await page.getByRole('button', { name: '个人信息', exact: true }).click();
  await poll(
    state,
    (value) =>
      flatten(value.tree).some(
        (node) =>
          node.class === 'VoxCueMaterialButton' &&
          node.title === '个人信息' &&
          node.imagePosition === 7 &&
          node.focusRingType === 1 &&
          !node.showsFirstResponder,
      ),
    'Personal info must use a leading icon without a native focus ring',
  );
  const personal = page.locator('.personal-panel[data-open=true]');
  await personal.waitFor();
  await page.waitForTimeout(300);
  await page.waitForFunction(
    () => !document.querySelector('.personal-panel details:not([open]) .macos-content-native'),
  );
  const resume = personal.locator('details[aria-label="简历摘要"]');
  await resume.locator('summary').click();
  const edit = resume.getByRole('button', { name: '编辑', exact: true });
  assert.equal((await edit.innerText()).trim(), '');
  await checkIconSizes();
  await edit.scrollIntoViewIfNeeded();
  await page.waitForFunction(() =>
    document
      .querySelector('details[aria-label="简历摘要"] .profile-section-actions button')
      ?.classList.contains('macos-content-native'),
  );
  const editRect = await edit.boundingBox();
  await poll(
    state,
    (value) =>
      flatten(value.tree).some(
        (node) =>
          node.class === 'NSButton' &&
          Math.abs(node.centerX - editRect.x - editRect.width / 2) < 1 &&
          Math.abs(node.centerY - editRect.y - editRect.height / 2) < 1 &&
          node.bezelStyle === 1 &&
          node.inGlassContent,
      ),
    'Personal edit uses over-glass artwork on its native glass card',
  );
  await edit.click();
  const editor = page.getByRole('dialog', { name: '编辑简历摘要', exact: true });
  await editor.waitFor();
  await page.waitForFunction(() =>
    document
      .querySelector('.profile-edit-dialog button[type=submit]')
      ?.classList.contains('macos-content-native'),
  );
  const closeEditor = editor.getByRole('button', { name: '关闭对话框', exact: true });
  await closeEditor.hover();
  await page.waitForFunction(() =>
    document.querySelector('.profile-edit-dialog .dialog-close-button')?.matches(':hover'),
  );
  const closeRect = await closeEditor.boundingBox();
  await poll(
    state,
    (value) =>
      flatten(value.tree).some(
        (node) =>
          node.class === 'NSButton' &&
          Math.abs(node.centerX - closeRect.x - closeRect.width / 2) < 1 &&
          Math.abs(node.centerY - closeRect.y - closeRect.height / 2) < 1 &&
          node.highlighted,
      ),
    'Native close button must brighten on hover',
  );
  await closeEditor.click();
  await resume.locator('summary').click();
  await personal.locator('.personal-panel-scroll').evaluate((node) => {
    node.scrollTop = 300;
  });
  await page.waitForTimeout(300);
  await page.waitForFunction(
    () => !document.querySelector('.personal-panel details:not([open]) .macos-content-native'),
  );
  assert.ok(
    !flatten((await state()).tree).some(
      (node) => node.class === 'NSButton' && (node.title === '编辑' || node.title === '删除'),
    ),
    'Closed disclosures must not paint their hidden buttons',
  );
  await capture('content-profile-folded');
  assert.equal(
    await personal.getByRole('button', { name: '关闭个人信息', exact: true }).count(),
    0,
  );
  await page.getByRole('button', { name: '个人信息', exact: true }).click();
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: '知识库', exact: true }).click();
  await page.locator('.knowledge-page').waitFor();
  await poll(
    state,
    (value) => header(value)?.alpha === 0,
    'Knowledge header must start transparent',
  );
  await poll(
    state,
    (value) =>
      flatten(value.tree).some(
        (node) => node.identifier === 'voxcue-header-title' && node.text === '知识库',
      ),
    'Header title must follow the management route',
  );
  const create = page
    .locator('.knowledge-page .page-toolbar')
    .getByRole('button', { name: '创建知识库', exact: true });
  assert.equal((await create.innerText()).trim(), '');
  await page.waitForFunction(() =>
    document
      .querySelector('.knowledge-page .page-toolbar button')
      ?.classList.contains('macos-content-native'),
  );
  const createRect = await create.boundingBox();
  await poll(
    state,
    (value) =>
      flatten(value.tree).some(
        (node) =>
          node.class === 'NSButton' &&
          Math.abs(node.centerX - createRect.x - createRect.width / 2) < 1 &&
          Math.abs(node.centerY - createRect.y - createRect.height / 2) < 1 &&
          node.bezelStyle === 16 &&
          !node.bezelColor.length,
      ),
    'Knowledge creation uses an uncolored native glass circle',
  );
  const sidebarToggle = await page
    .getByRole('button', { name: '收起侧栏', exact: true })
    .boundingBox();
  assert.equal(
    createRect.width,
    sidebarToggle.width,
    'Header icon buttons must have the same width',
  );
  assert.equal(
    createRect.height,
    sidebarToggle.height,
    'Header icon buttons must have the same height',
  );
  await probe('clickAt', {
    x: createRect.x + createRect.width / 2,
    y: createRect.y + createRect.height / 2,
  });
  const editing = page.getByRole('dialog', { name: '创建知识库', exact: true });
  await editing.waitFor();
  const footerWidths = await editing
    .locator('.dialog-footer button')
    .evaluateAll((nodes) => nodes.map((n) => n.getBoundingClientRect().width));
  await editing.getByLabel('知识库名称', { exact: true }).fill('合成知识库');
  await page.waitForTimeout(100);
  assert.deepEqual(
    await editing
      .locator('.dialog-footer button')
      .evaluateAll((nodes) => nodes.map((n) => n.getBoundingClientRect().width)),
    footerWidths,
    'Input focus must not resize footer actions',
  );
  await editing.getByRole('button', { name: '保存', exact: true }).click();
  const base = page.getByRole('dialog', { name: '合成知识库', exact: true });
  await base.waitFor();
  assert.equal(await base.locator('.knowledge-search,.knowledge-hits,.dialog-intro').count(), 0);
  const name = await base.locator('h2').boundingBox(),
    rename = await base.getByRole('button', { name: '重命名', exact: true }).boundingBox();
  assert.ok(
    rename.x >= name.x + name.width && rename.x - name.x - name.width < 30,
    'Rename must sit beside the title',
  );
  await page.waitForTimeout(150);
  await checkIconSizes();
  assert.equal(
    (await base.getByRole('button', { name: '重命名', exact: true }).innerText()).trim(),
    '',
  );
  assert.equal(
    (
      await base
        .getByRole('button', { name: '删除知识库', exact: true })
        .locator('.confirm-delete-idle')
        .innerText()
    ).trim(),
    '',
  );
  const renameIcon = base.getByRole('button', { name: '重命名', exact: true });
  const renameRect = await renameIcon.boundingBox();
  const at = (node, rect) =>
    Math.abs(node.centerX - rect.x - rect.width / 2) < 1 &&
    Math.abs(node.centerY - rect.y - rect.height / 2) < 1;
  await page.mouse.move(900, 750);
  await page.waitForTimeout(100);
  assert.equal(
    await renameIcon.evaluate((node) => node.classList.contains('macos-content-native')),
    false,
  );
  assert.equal(
    flatten((await state()).tree).some((node) => node.class === 'NSButton' && at(node, renameRect)),
    false,
    'Idle knowledge rename must show only its source icon',
  );
  const sidebarButton = flatten((await state()).tree).find(
    (node) => node.class === 'VoxCueMaterialButton' && node.borderShape === 3,
  );
  for (const control of [
    base.getByRole('button', { name: '删除知识库', exact: true }),
    base.getByRole('button', { name: '关闭对话框', exact: true }),
  ]) {
    const rect = await control.boundingBox();
    const native = flatten((await state()).tree).find(
      (node) => node.class === 'NSButton' && at(node, rect),
    );
    assert.ok(native);
    assert.equal(native.bezelStyle, 1, 'Knowledge icon actions use standard unaccented artwork');
    for (const key of ['frameWidth', 'frameHeight', 'borderShape', 'controlSize', 'tintProminence'])
      assert.equal(
        native[key],
        sidebarButton[key],
        `Content icon must match the sidebar's actual native ${key}`,
      );
  }
  await renameIcon.hover();
  await poll(
    state,
    (value) =>
      flatten(value.tree).some(
        (node) =>
          node.class === 'NSButton' &&
          at(node, renameRect) &&
          node.bezelStyle === 1 &&
          node.borderShape === 3 &&
          node.highlighted,
      ),
    'Knowledge rename must reveal the matching native circle on hover',
  );
  await page.mouse.move(900, 750);
  await page.waitForTimeout(100);
  await capture('content-knowledge-dialog');
  await base.getByRole('button', { name: '重命名', exact: true }).click();
  const renaming = page.getByRole('dialog', { name: '重命名知识库', exact: true });
  await renaming.waitFor();
  await renaming.getByLabel('知识库名称', { exact: true }).fill('合成知识库已改名');
  await renaming.getByRole('button', { name: '保存', exact: true }).click();
  const renamed = page.getByRole('dialog', { name: '合成知识库已改名', exact: true });
  await renamed.waitFor();
  const remove = renamed.getByRole('button', { name: '删除知识库', exact: true });
  const idleRect = await remove.boundingBox();
  assert.equal(idleRect.width, idleRect.height);
  assert.equal(idleRect.height, 36);
  await remove.click();
  const confirm = renamed.getByRole('button', {
    name: '确认删除：知识库：合成知识库已改名',
    exact: true,
  });
  await confirm.waitFor();
  await page.waitForTimeout(250);
  const armedRect = await confirm.boundingBox();
  assert.ok(armedRect.width > armedRect.height);
  assert.equal(armedRect.height, idleRect.height, 'Delete must retain its height when expanded');
  const deletion = await poll(
    state,
    (value) =>
      flatten(value.tree).some((node) => node.class === 'NSButton' && node.title === '确认删除'),
    'Native confirmation text must appear',
  );
  const confirmation = flatten(deletion.tree).find(
    (node) => node.class === 'NSButton' && node.title === '确认删除',
  );
  assert.ok(armedRect.width < 128, 'Confirmation expands only enough to fit its content');
  assert.equal(confirmation.bezelStyle, 1, 'Expanded knowledge delete stays flat');
  assert.ok(confirmation.foregroundColor[0] > confirmation.foregroundColor[1]);
  assert.ok(
    confirmation.frameWidth >= confirmation.fittingWidth,
    'Confirmation label must fit without clipping',
  );
  assert.equal(
    await page.locator('.knowledge-card').count(),
    1,
    'First click must keep the knowledge base',
  );
  await confirm.click();
  await renamed.waitFor({ state: 'hidden' });
  assert.equal(
    await page.locator('.knowledge-card').count(),
    0,
    'Only the second click removes the synthetic base',
  );
  await page.evaluate(async () => {
    await new Promise((resolve, reject) => {
      const request = indexedDB.open('copilot-local-documents', 1);
      request.onsuccess = () => {
        const db = request.result,
          tx = db.transaction('bases', 'readwrite');
        for (let i = 0; i < 37; i++)
          tx.objectStore('bases').put({
            id: 'synthetic-base-' + i,
            name: '合成资料 ' + i,
            createdAt: Date.now() - i,
          });
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
      request.onerror = () => reject(request.error);
    });
  });
  await page.getByRole('button', { name: '面试记录', exact: true }).click();
  await page.getByRole('button', { name: '知识库', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('.knowledge-card').length === 37);
  assert.deepEqual(
    await page.locator('.nav-item.active').evaluate((node) => {
      const marker = getComputedStyle(node, '::before');
      return [marker.width, marker.height, marker.borderRadius, marker.cornerShape];
    }),
    ['3px', '18px', '999px', 'round'],
    'Native navigation must share the capsule marker with conversations and the web fallback',
  );
  await page.locator('.management-scroll').evaluate((node) => {
    node.scrollTop = 250;
  });
  await poll(
    state,
    (value) => header(value)?.alpha === 1,
    'Knowledge header must blur content while scrolling',
  );
  await capture('content-knowledge-scrolled');
  await page.getByRole('button', { name: '收起侧栏', exact: true }).click();
  await page.waitForTimeout(300);
  const sidebar = await page.locator('aside.sidebar').boundingBox();
  const toggle = await page.getByRole('button', { name: '展开侧栏', exact: true }).boundingBox();
  assert.ok(
    sidebar.width <= 86 &&
      Math.abs(toggle.x + toggle.width / 2 - sidebar.x - sidebar.width / 2) < 1,
  );
  const host = flatten((await state()).tree).find(
    (node) =>
      node.class === 'VoxCueGlassControlHost' && node.children?.some((child) => child.title === ''),
  );
  assert.ok(
    host && host.frame.startsWith('{{24,'),
    'Native sidebar icon must move with its shared anchor',
  );
  await capture('content-collapsed');
  await page.getByRole('button', { name: '展开侧栏', exact: true }).click();
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: '面试记录', exact: true }).click();
  assert.equal(
    await page
      .locator('.history-page .page-toolbar .count-label,.history-page .page-toolbar .mock-badge')
      .count(),
    0,
  );
  await page.evaluate(() => {
    const records = Array.from({ length: 40 }, (_, i) => ({
      id: 'synthetic-record-' + i,
      title: '合成记录' + i,
      titleStatus: 'ready',
      startedAt: Date.now() - i * 60000,
      endedAt: Date.now() - i * 60000 + 1000,
      status: 'ended',
      mock: false,
      transcripts: [],
      answers: [],
    }));
    localStorage.setItem('copilot-interview-history-v1', JSON.stringify(records));
    window.dispatchEvent(new StorageEvent('storage', { key: 'copilot-interview-history-v1' }));
  });
  await page.waitForFunction(() => document.querySelectorAll('.history-row').length === 40);
  await poll(
    state,
    (value) => flatten(value.tree).some((node) => node.class === 'NSSearchField'),
    'History must use NSSearchField',
  );
  await capture('content-history-search');
  assert.ok(
    flatten((await state()).tree).find((node) => node.class === 'NSSearchField')?.underScrollChrome,
    'Native search stays below the scrolling toolbar glass',
  );
  assert.equal(
    await page.locator('.history-page input[type=search]').count(),
    1,
    'Search must remain mounted',
  );
  const search = await page.locator('input[type=search]').boundingBox();
  const pane = await page.locator('.history-page').boundingBox();
  assert.ok(search.width > pane.width - 100, 'Search must span the main content pane');
  assert.equal(search.height, 44, 'Search reserves the shared taller control row');
  await probe('clickAt', { x: search.x + 100, y: search.y + search.height / 2 });
  await page.waitForTimeout(100);
  const editingSearch = flatten((await state()).tree).find(
    (node) => node.class === 'NSSearchField',
  );
  assert.ok(editingSearch?.editing, 'Pointer must focus the native search editor');
  assert.equal(editingSearch.focusRingType, 1, 'Search must not draw a rectangular focus ring');
  assert.equal(editingSearch.bezeled, true, 'Use the complete AppKit search field');
  assert.equal(editingSearch.borderShape, 1, 'Search uses the system capsule shape');
  assert.ok(
    editingSearch.textLeft > 0 && Math.abs(editingSearch.editorLeft - editingSearch.textLeft) <= 1,
    'The editor must use AppKit searchTextBounds, not the icon hit area: ' +
      JSON.stringify({ editor: editingSearch.editorLeft, text: editingSearch.textLeft }),
  );
  assert.equal(
    await page.locator('input[type=search]').evaluate((node) => getComputedStyle(node).opacity),
    '0',
    'The shared search paints no second text layer while AppKit owns the field',
  );
  await capture('content-history-search-focused');
  // An explicit preview pause can move focus to the user's foreground app.
  await probe('clickAt', { x: search.x + 100, y: search.y + search.height / 2 });
  await poll(
    state,
    (value) => flatten(value.tree).some((node) => node.class === 'NSSearchField' && node.editing),
    'Native search focus must be restored after preview',
  );
  await probe('typeText', '合成记录7');
  await page.waitForFunction(() => document.querySelectorAll('.history-row').length === 1);
  assert.equal(await page.locator('input[type=search]').inputValue(), '合成记录7');
  assert.equal(await page.getByRole('button', { name: '清除筛选', exact: true }).count(), 0);
  await capture('content-history-editing');
  const typedSearch = flatten((await state()).tree).find((node) => node.class === 'NSSearchField');
  await probe('clickAt', typedSearch.cancelPoint);
  await page.waitForFunction(() => document.querySelectorAll('.history-row').length === 40);
  assert.equal(await page.locator('input[type=search]').inputValue(), '');
  await page.locator('input[type=search]').fill('合成记录7');
  await page.waitForFunction(() => document.querySelectorAll('.history-row').length === 1);
  await page.locator('input[type=search]').fill('');
  await page.waitForFunction(() => document.querySelectorAll('.history-row').length === 40);
  await page.locator('.management-scroll').evaluate((node) => {
    node.scrollTop = 250;
  });
  await poll(
    state,
    (value) => header(value)?.alpha === 1,
    'History header must blur while scrolling',
  );
  await capture('content-history-scrolled');
  await page.locator('.management-scroll').evaluate((node) => {
    node.scrollTop = 0;
  });
  await page.locator('.history-row').first().click();
  const detail = page.locator('.history-detail');
  await detail.waitFor();
  assert.equal(
    await detail
      .locator('.record-toolbar-actions [data-native-control-style="standalone-glass"]')
      .count(),
    3,
  );
  await poll(
    state,
    (value) =>
      flatten(value.tree).filter((node) => node.class === 'NSButton' && node.bezelStyle === 16)
        .length === 4,
    'Requested management toolbar controls use native glass bezels',
  );
  const recordRename = detail.getByRole('button', { name: '重命名标题', exact: true });
  await recordRename.hover();
  const recordRenameRect = await recordRename.boundingBox();
  await poll(
    state,
    (value) =>
      flatten(value.tree).some(
        (node) =>
          node.class === 'NSButton' &&
          at(node, recordRenameRect) &&
          node.bezelStyle === 1 &&
          node.borderShape === 3,
      ),
    'Record rename reveals a flat circle without the glass highlight',
  );
  await page.mouse.move(900, 650);
  const answerToggle = detail.getByRole('button', { name: 'AI 回答面板', exact: true });
  const expanded = await answerToggle.getAttribute('aria-expanded');
  await answerToggle.click();
  await page.waitForTimeout(300);
  assert.equal(await detail.getByRole('button', { name: '收起 AI 回答', exact: true }).count(), 0);
  const card = await detail.locator('.record-answer-panel').boundingBox();
  assert.ok(card.x + card.width < 1280, 'Answer card must be inset from the window');
  assert.notEqual(await answerToggle.getAttribute('aria-expanded'), expanded);
  await page.mouse.move(900, 650);
  await poll(
    state,
    (value) =>
      flatten(value.tree).some(
        (node) =>
          node.class === 'NSButton' &&
          /AI 回答/.test(node.title) &&
          node.imagePosition === 7 &&
          node.focusRingType === 1 &&
          !node.showsFirstResponder &&
          !node.highlighted,
      ),
    'Expanded AI toggle must use a leading icon without a persistent pressed highlight or focus ring',
  );
  await detail.getByRole('button', { name: '删除记录', exact: true }).click();
  const recordConfirm = detail.getByRole('button', { name: /^确认删除：面试记录：/ });
  await recordConfirm.waitFor();
  await poll(
    state,
    (value) =>
      flatten(value.tree).some(
        (node) => node.class === 'NSButton' && node.title === '确认删除' && node.bezelStyle === 16,
      ),
    'The requested toolbar glass style remains during confirmation',
  );
  await recordConfirm.press('Escape');
  await capture('content-history-detail-glass');
  await detail.getByRole('button', { name: '返回面试记录', exact: true }).click();
  await choose(page.getByRole('button', { name: '用户菜单', exact: true }), '设置');
  const settings = page.getByRole('dialog', { name: '设置', exact: true });
  await settings.waitFor();
  await poll(
    state,
    (value) => flatten(value.tree).filter((node) => node.class === 'NSPopUpButton').length >= 2,
    'Content dropdowns must use native NSPopUpButton',
  );
  const items = await choose(settings.getByRole('button', { name: '外观主题', exact: true }), [53]);
  assert.ok(items.filter((item) => !item.separator).every((item) => item.imageVisible));
  assert.equal(
    await settings.getByRole('switch', { name: 'Liquid Glass', exact: true }).count(),
    0,
  );
  await choose(settings.getByRole('button', { name: '外观主题', exact: true }), '跟随系统');
  for (const name of ['外观主题', '主题色']) {
    assert.equal(
      await settings
        .getByRole('button', { name, exact: true })
        .locator('svg[data-sf-symbol="circle.lefthalf.filled"]')
        .count(),
      1,
      `${name}: follow-system must use the half-lit circle icon`,
    );
  }
  await capture('content-settings-controls');
  await checkIconSizes();
  await choose(settings.getByRole('button', { name: '外观主题', exact: true }), '深色');
  await page.waitForFunction(() => document.documentElement.classList.contains('dark'));
  await settings.getByRole('button', { name: '账户与用量', exact: true }).click();
  const reset = settings.getByRole('button', { name: '重置用量', exact: true });
  await reset.waitFor();
  for (let cycle = 0; cycle < 3; cycle++) {
    await reset.click();
    const animation = await settings.locator('.confirm-delete').evaluate(async (node) => {
      const widths = [],
        gaps = [];
      let last = performance.now(),
        start = last;
      await new Promise((resolve) => {
        const tick = (now) => {
          widths.push(node.getBoundingClientRect().width);
          gaps.push(now - last);
          last = now;
          if (now - start < 240) requestAnimationFrame(tick);
          else resolve();
        };
        requestAnimationFrame(tick);
      });
      return { widths, gaps };
    });
    const compactWidth = await settings
      .locator('.confirm-delete-confirm')
      .evaluate((node) => Math.ceil(node.scrollWidth + 24));
    assert.ok(
      Math.abs(animation.widths.at(-1) - compactWidth) < 1,
      'Reset expands to its intrinsic content plus compact end padding',
    );
    assert.ok(
      animation.widths.length >= 5 && Math.max(...animation.gaps) < 130,
      'Reset expansion must remain responsive',
    );
    await settings.locator('.confirm-delete').press('Escape');
    await page.waitForTimeout(250);
  }
  await settings.getByRole('button', { name: '更新', exact: true }).click();
  const autoDownload = settings.getByRole('switch', { name: '自动下载更新', exact: true });
  await page.waitForFunction(() =>
    document
      .querySelector('[data-native-control-style="switch"]')
      ?.classList.contains('macos-content-native'),
  );
  const initialAutoDownload = await autoDownload.getAttribute('aria-checked');
  await poll(
    state,
    (value) =>
      flatten(value.tree).some(
        (node) =>
          node.class === 'NSSwitch' &&
          node.identifier === 'voxcue-content-switch' &&
          node.state === Number(initialAutoDownload === 'true'),
      ),
    'Automatic update switch must use the native NSSwitch and current preference',
  );
  const switchRect = await autoDownload.boundingBox();
  const switchClick = JSON.parse(
    await probe('clickAt', {
      x: switchRect.x + switchRect.width / 2,
      y: switchRect.y + switchRect.height / 2,
    }),
  );
  assert.equal(
    switchClick.nativeSwitch,
    true,
    'AppKit must receive switch mouse tracking for its glass interaction',
  );
  await page.waitForFunction(
    (initial) =>
      document
        .querySelector('[data-native-control-style="switch"]')
        ?.getAttribute('aria-checked') !== initial,
    initialAutoDownload,
  );
  const updated = await page.evaluate(() => window.desktop.updates({ op: 'status' }));
  assert.equal(updated.autoDownload, initialAutoDownload !== 'true');
  await poll(
    state,
    (value) =>
      flatten(value.tree).some(
        (node) =>
          node.class === 'NSSwitch' &&
          node.identifier === 'voxcue-content-switch' &&
          node.state === Number(updated.autoDownload),
      ),
    'Native switch must reflect the saved shared update preference',
  );
  await capture('content-settings-update-switch');
  await autoDownload.press('Space');
  await page.waitForFunction(
    (initial) =>
      document
        .querySelector('[data-native-control-style="switch"]')
        ?.getAttribute('aria-checked') === initial,
    initialAutoDownload,
  );
  assert.equal(
    (await page.evaluate(() => window.desktop.updates({ op: 'status' }))).autoDownload,
    initialAutoDownload === 'true',
  );
  const capsuleButtons = flatten((await state()).tree).filter(
    (node) => node.class === 'NSButton' && node.title && node.borderShape === 1,
  );
  assert.ok(capsuleButtons.length > 0);
  assert.ok(
    capsuleButtons.every((node) => node.contentCentered),
    'Native capsule buttons must center image and title as one group',
  );
  await settings.getByRole('button', { name: '个性化', exact: true }).click();
  await choose(settings.getByRole('button', { name: '外观主题', exact: true }), '浅色');
  await page.waitForFunction(() => !document.documentElement.classList.contains('dark'));
  await capture('content-settings-light');
  await settings.getByRole('button', { name: '面试设置', exact: true }).click();
  const interviewIcon = settings.locator('.interview-font-preview .button-icon').first();
  await interviewIcon.waitFor();
  const interviewIconRect = await interviewIcon.boundingBox();
  assert.equal(interviewIconRect.width, 32, 'Interview preview icons must retain their size');
  assert.equal(interviewIconRect.height, 32, 'Interview preview icons must retain their size');
  assert.equal(
    await settings.getByRole('slider', { name: '面试背景透明度', exact: true }).count(),
    0,
  );
  const fontAlignment = await settings
    .locator('.interview-display-controls.single-setting')
    .evaluate((node) => {
      const rect = node.getBoundingClientRect(),
        parent = node.parentElement.getBoundingClientRect();
      return Math.abs(rect.x + rect.width / 2 - parent.x - parent.width / 2);
    });
  assert.ok(fontAlignment < 1, 'The remaining font-size control must be horizontally centered');
  const font = settings.getByRole('slider', { name: '面试字体大小', exact: true });
  await font.scrollIntoViewIfNeeded();
  await poll(
    state,
    (value) =>
      flatten(value.tree).some(
        (node) =>
          node.class === 'NSSlider' &&
          node.minimum === 12 &&
          node.maximum === 24 &&
          node.continuous,
      ),
    'Font size uses a native content-area NSSlider',
  );
  const beforeFont = Number(await font.inputValue());
  const fontRect = await font.boundingBox();
  const fontClick = JSON.parse(
    await probe('clickAt', {
      x: fontRect.x + fontRect.width * 0.75,
      y: fontRect.y + fontRect.height / 2,
    }),
  );
  assert.ok(fontClick.nativeSlider, 'AppKit receives slider mouse tracking');
  await page.waitForFunction(
    (before) => Number(document.querySelector('input[aria-label="面试字体大小"]').value) !== before,
    beforeFont,
  );
  const selectedFont = Number(await font.inputValue());
  assert.equal(
    await page.evaluate(() => Number(localStorage.getItem('voxcue-interview-font-size-v1'))),
    selectedFont,
  );
  await font.focus();
  await font.press('ArrowLeft');
  assert.equal(Number(await font.inputValue()), selectedFont - 1);
  await capture('content-font-slider');
  await settings.locator('.interview-preview-scene').scrollIntoViewIfNeeded();
  const capsules = settings.locator('.interview-preview-capsule[data-interview-preview-button]');
  const bodyRect = await settings.locator('.settings-content-body').boundingBox();
  await page.mouse.move(bodyRect.x + bodyRect.width - 12, bodyRect.y + bodyRect.height / 2);
  for (const delta of [-32, 24, -20, 28, -24]) {
    await page.mouse.wheel(0, delta);
    await poll(
      async () => ({
        native: await state(),
        rects: await capsules.evaluateAll((nodes) =>
          nodes
            .filter((node) => {
              const rect = node.getBoundingClientRect();
              for (let parent = node.parentElement; parent; parent = parent.parentElement) {
                const css = getComputedStyle(parent),
                  box = parent.getBoundingClientRect();
                if (
                  /(auto|hidden|scroll|clip)/.test(css.overflowY) &&
                  (rect.top < box.top || rect.bottom > box.bottom)
                )
                  return false;
              }
              return rect.top >= 0 && rect.bottom <= innerHeight;
            })
            .map((node) => {
              const { x, y, width, height } = node.getBoundingClientRect();
              return { x, y, width, height };
            }),
        ),
      }),
      ({ native, rects }) =>
        rects.every((rect) =>
          flatten(native.tree).some(
            (node) =>
              node.class === 'NSButton' &&
              Math.abs(node.centerX - rect.x - rect.width / 2) < 1 &&
              Math.abs(node.centerY - rect.y - rect.height / 2) < 1,
          ),
        ),
      'Preview capsule artwork stays aligned with its shared caption during settings scrolling',
    );
  }
  await page.waitForFunction(() => document.querySelector('dialog[data-native-preview]'));
  await poll(
    state,
    (value) => flatten(value.tree).some((node) => node.identifier === 'voxcue-interview-clear'),
    'Preview must render actual native Clear glass',
  );
  assert.ok(
    flatten((await state()).tree)
      .filter((node) => node.identifier === 'voxcue-interview-clear')
      .every((node) =>
        node.children.some(
          (child) =>
            child.identifier === 'voxcue-interview-dimming' &&
            !child.hidden &&
            Math.abs(child.layerBackground[3] - 0.78) < 0.001,
        ),
      ),
    'Preview uses the same black backing strength as the real interview',
  );
  const previewFills = await settings
    .locator('.interview-preview-scene .macos-native-panel-material')
    .evaluateAll((nodes) =>
      nodes.map((node) => ({
        name: node.className,
        color: getComputedStyle(node).backgroundColor,
      })),
    );
  assert.ok(previewFills.length >= 7);
  assert.ok(
    previewFills.every((item) => item.color === 'rgba(0, 0, 0, 0)'),
    'Native preview backplates must replace all shared fills: ' + JSON.stringify(previewFills),
  );
  await capture('content-settings-interview-preview');
  await page.evaluate(() => {
    localStorage.setItem('voxcue-liquid-glass-enabled-v1', 'false');
    window.dispatchEvent(new Event('storage'));
  });
  await page.waitForTimeout(150);
  await page.waitForFunction(() => document.querySelector('dialog[data-native-preview]'));
  assert.equal(
    await settings
      .locator('.answer-bubble')
      .first()
      .evaluate((node) => getComputedStyle(node).backgroundColor),
    'rgba(0, 0, 0, 0)',
    'Legacy preference cannot switch the native preview to a web surface',
  );
  await settings.getByRole('button', { name: '关闭设置', exact: true }).click();
  await page.getByRole('button', { name: '新对话', exact: true }).click();
  await page.locator('.preparation-workspace').waitFor();
  await poll(
    state,
    (value) =>
      flatten(value.tree).some((node) => node.class === 'VoxCueForegroundSurface' && !node.hidden),
    'Chat composer must return after route changes',
  );
  await page.getByRole('button', { name: '开始面试', exact: true }).click();
  const start = page.getByRole('dialog', { name: '开始面试', exact: true });
  await start.waitFor();
  await page.waitForFunction(() =>
    [...document.querySelectorAll('.interview-start-dialog button')].every(
      (node) => !node.getClientRects().length || node.classList.contains('macos-content-native'),
    ),
  );
  const accent = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--accent').trim().toLowerCase(),
  );
  const referenceWidth = (await page.locator('.interview-start-trigger').boundingBox()).width;
  assert.equal(
    (await start.getByRole('button', { name: '重新检查', exact: true }).boundingBox()).width,
    referenceWidth,
  );
  assert.equal(
    (await start.getByRole('button', { name: '确认开始', exact: true }).boundingBox()).width,
    referenceWidth,
  );
  const colorHex = (channels) =>
    '#' +
    channels
      .slice(0, 3)
      .map((value) =>
        Math.round(value * 255)
          .toString(16)
          .padStart(2, '0'),
      )
      .join('');
  await poll(
    state,
    (value) =>
      flatten(value.tree).some(
        (node) =>
          node.class === 'NSButton' &&
          node.title === '确认开始' &&
          colorHex(node.foregroundColor) === accent &&
          colorHex(node.titleColor) === accent,
      ),
    'Start confirmation must use the theme accent',
  );
  await capture('content-interview-start');
  await start.getByRole('button', { name: '取消', exact: true }).click();
  console.log(
    'management headers, content buttons/popups, native search/switch, rename and collapsed sidebar passed',
  );
}
