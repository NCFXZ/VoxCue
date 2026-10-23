import { testRoot, electron } from './test-workspace.mjs';
import { installUiAccount, closeUiApp } from './install-ui-account.mjs';
import { offlineElectronEntry } from './offline-electron-entry.mjs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const profile = path.join(testRoot, 'ui-refinement-profile');
await mkdir(profile);
const app = await electron.launch({
  args: [await offlineElectronEntry()],
  env: { ...process.env, COPILOT_TEST_USER_DATA: profile, VITE_DEV_SERVER_URL: '' },
});
const settle = (page) =>
  page.waitForFunction(() =>
    document
      .getAnimations()
      .every((a) => a.effect?.getTiming().iterations === Infinity || a.playState !== 'running'),
  );
const errors = [];
async function fixedZoom(page) {
  for (const key of [
    'Control+-',
    'Control+=',
    'Control+Shift+=',
    'Control+0',
    ...(process.platform === 'darwin' ? ['Meta+-', 'Meta+=', 'Meta+Shift+=', 'Meta+0'] : []),
  ]) {
    await page.keyboard.press(key);
    assert.equal(
      await app.evaluate(
        ({ BrowserWindow }, url) =>
          BrowserWindow.getAllWindows()
            .find((w) => w.webContents.getURL() === url)
            .webContents.getZoomFactor(),
        page.url(),
      ),
      1,
    );
  }
  const session = await page.context().newCDPSession(page);
  try {
    await session.send('Input.synthesizePinchGesture', {
      x: 180,
      y: 160,
      scaleFactor: 1.5,
      relativeSpeed: 800,
      gestureSourceType: 'touch',
    });
    assert.equal(await page.evaluate(() => visualViewport.scale), 1);
  } finally {
    await session.detach();
  }
}
try {
  await installUiAccount(app, { speech: true, components: true });
  await app.evaluate(({ app }) => {
    const require = process
      .getBuiltinModule('module')
      .createRequire(app.getAppPath() + '/package.json');
    const { ChatGPTService } = require(
      app.getAppPath() + '/dist-electron/shared/electron/backend/chat/service.js',
    );
    ChatGPTService.prototype.stream = async (request, emit) => {
      if (request.id.startsWith('history-title-'))
        return { answerText: '合成记录', usage: null, sources: [] };
      emit({ id: request.id, type: 'activity', activity: { phase: 'thinking' } });
      await new Promise((resolve) => {
        globalThis.finishRefinementAnswer = resolve;
      });
      return { answerText: '合成回答', usage: null, sources: [] };
    };
    const { KnowledgeHost } = require(
      app.getAppPath() + '/dist-electron/shared/electron/backend/knowledge/host.js',
    );
    KnowledgeHost.prototype.listDocuments = async () => [];
    KnowledgeHost.prototype.indexDocument = async function (input) {
      globalThis.refinementDocument = input.documentId;
      this.progress({
        documentId: input.documentId,
        phase: 'embedding',
        completed: 1,
        total: 4,
      });
      return await new Promise((resolve) => {
        globalThis.finishRefinementIndex = () => {
          this.progress({
            documentId: input.documentId,
            phase: 'ready',
            completed: 4,
            total: 4,
          });
          resolve({ documentId: input.documentId });
        };
      });
    };
  });
  const login = await app.firstWindow();
  await fixedZoom(login);
  const [page] = await Promise.all([
    app.waitForEvent('window'),
    login.getByRole('button', { name: '使用 ChatGPT 继续', exact: true }).click(),
  ]);
  page.setDefaultTimeout(15000);
  page.on('pageerror', (error) => errors.push(error.message));
  await page.getByRole('textbox', { name: '聊天消息' }).waitFor();
  await fixedZoom(page);
  await page.evaluate(() => {
    localStorage.setItem(
      'copilot-personal-info-v1',
      JSON.stringify({
        name: '合成用户',
        language: '简体中文',
        background: '# 合成简历标题\n\n' + '合成简历。'.repeat(80),
        jobDescription: '## 合成职位描述\n\n合成职责要求',
        customInstructions: '合成指令',
        skills: [
          { id: 'synthetic-skill', title: '合成技能', content: '合成技能内容', sources: [] },
        ],
      }),
    );
  });
  await page.reload();
  const panel = page.locator('.personal-panel');
  const info = page.getByRole('button', { name: '个人信息', exact: true });
  for (const theme of ['light', 'dark']) {
    await page.evaluate(
      (theme) => document.documentElement.classList.toggle('dark', theme === 'dark'),
      theme,
    );
    await info.click();
    await settle(page);
    assert.equal(await panel.locator('.profile-disclosure[open]').count(), 0);
    for (const label of ['简历摘要', '职位描述摘要', '自定义指令', '面试知识库', '面试技能']) {
      const fold = panel.locator(`details[aria-label="${label}"]`);
      for (const expanding of [true, false]) {
        const heights = await fold.evaluate(async (element) => {
          const values = [element.getBoundingClientRect().height];
          element.querySelector(':scope > summary').click();
          const started = performance.now();
          while (performance.now() - started < 300) {
            await new Promise(requestAnimationFrame);
            values.push(element.getBoundingClientRect().height);
          }
          return values;
        });
        const [start, end] = [heights[0], heights.at(-1)];
        assert.ok(expanding ? end > start + 20 : start > end + 20);
        assert.ok(
          heights.some((h) => h > Math.min(start, end) + 2 && h < Math.max(start, end) - 2),
          `${theme} ${label}: disclosure must animate through intermediate heights`,
        );
      }
      await fold.evaluate(async (e) => {
        const summary = e.querySelector(':scope > summary');
        summary.click();
        await new Promise((r) => setTimeout(r, 60));
        summary.click();
        await new Promise((r) => setTimeout(r, 60));
        summary.click();
      });
      await settle(page);
      const expandedHeight = await fold.evaluate((e) => e.getBoundingClientRect().height);
      await fold.locator(':scope > summary').click();
      await settle(page);
      assert.ok(expandedHeight > (await fold.boundingBox()).height + 20);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      assert.equal(
        await fold.evaluate((e) => getComputedStyle(e, '::details-content').transitionDuration),
        '0s',
      );
      await page.emulateMedia({ reducedMotion: 'no-preference' });
    }
    assert.equal(await panel.locator('.profile-proposal,.skill-update-prompt').count(), 0);
    for (const label of ['简历摘要', '职位描述摘要', '自定义指令', '面试技能']) {
      const section = panel.locator(`details[aria-label="${label}"]`);
      if (!(await section.evaluate((e) => e.open)))
        await section.locator(':scope > summary').click();
      if (
        label === '面试技能' &&
        !(await section.locator('.profile-entry').evaluate((e) => e.open))
      )
        await section.locator('.profile-entry > summary').click();
      const reading = section.locator(
        '.profile-summary .markdown-content,.profile-entry > div .plain-text-content',
      );
      assert.ok((await reading.count()) > 0);
      for (const content of await reading.all()) {
        assert.equal(await content.evaluate((e) => getComputedStyle(e).fontSize), '12px');
        for (const heading of await content.locator('h1,h2,h3,h4,h5,h6').all())
          assert.equal(await heading.evaluate((e) => getComputedStyle(e).fontSize), '14px');
      }
      await section.getByRole('button', { name: '编辑', exact: true }).click();
      const editor = page.getByRole('dialog', {
        name: label === '面试技能' ? '编辑技能' : '编辑' + label,
        exact: true,
      });
      await editor.waitFor();
      assert.equal(await editor.locator('textarea').count(), 1);
      assert.equal(
        await editor.locator('textarea').evaluate((e) => getComputedStyle(e).fontSize),
        '12px',
      );
      assert.equal(await panel.locator('textarea').count(), 0);
      assert.equal(await editor.evaluate((e) => e.scrollWidth > e.clientWidth + 1), false);
      await editor.getByRole('button', { name: '取消', exact: true }).click();
      await page.waitForFunction(
        () => document.activeElement?.getAttribute('aria-label') === '编辑',
      );
      for (const button of await section.locator('.profile-section-actions button').all()) {
        assert.equal(
          await button.evaluate((e) => {
            const b = e.getBoundingClientRect();
            const label = (e.querySelector('.confirm-delete-idle') ?? e).getBoundingClientRect();
            return label.left >= b.left - 1 && label.right <= b.right + 1;
          }),
          true,
        );
        assert.equal(
          await button.evaluate((e) => Math.round(e.getBoundingClientRect().height)),
          36,
        );
      }
    }
    const instructions = panel.locator('details[aria-label="自定义指令"]');
    const editInstructions = instructions.getByRole('button', { name: '编辑', exact: true });
    const savedInstructions = () =>
      page.evaluate(
        () => JSON.parse(localStorage.getItem('copilot-personal-info-v1')).customInstructions,
      );
    const originalInstructions = await savedInstructions();
    await editInstructions.click();
    const editor = page.getByRole('dialog', { name: '编辑自定义指令', exact: true });
    const content = editor.getByLabel('自定义指令内容', { exact: true });
    assert.equal(await content.evaluate((e) => e === document.activeElement), true);
    await content.fill('取消的合成草稿');
    await page.keyboard.press('Escape');
    await editor.waitFor({ state: 'detached' });
    assert.equal(await savedInstructions(), originalInstructions);
    await editInstructions.click();
    await content.fill('点击遮罩取消的合成草稿');
    await page.mouse.click(8, 120);
    await editor.waitFor({ state: 'detached' });
    assert.equal(await savedInstructions(), originalInstructions);
    await editInstructions.click();
    await content.fill('保存重试的合成指令');
    await page.evaluate(() => {
      const original = Storage.prototype.setItem;
      globalThis.restoreEditorStorage = () => {
        Storage.prototype.setItem = original;
      };
      Storage.prototype.setItem = function (key, value) {
        if (key === 'copilot-personal-info-v1') throw Error('Synthetic quota failure');
        return original.call(this, key, value);
      };
    });
    await editor.getByRole('button', { name: '保存', exact: true }).click();
    await editor.getByRole('alert').waitFor();
    assert.equal(await content.inputValue(), '保存重试的合成指令');
    assert.equal(await savedInstructions(), originalInstructions);
    await page.evaluate(() => globalThis.restoreEditorStorage());
    await editor.getByRole('button', { name: '保存', exact: true }).click();
    await editor.waitFor({ state: 'detached' });
    assert.equal(await savedInstructions(), '保存重试的合成指令');
    await editInstructions.click();
    await content.fill(originalInstructions);
    await editor.getByRole('button', { name: '保存', exact: true }).click();
    await editor.waitFor({ state: 'detached' });
    await page.bringToFront();
    const separator = page.getByRole('separator', { name: '调整个人信息宽度' });
    await panel.locator('.personal-panel-scroll').evaluate((e) => (e.scrollTop = 0));
    const initial = (await panel.boundingBox()).width;
    const grip = await separator.boundingBox();
    await page.mouse.move(grip.x + grip.width / 2, grip.y + 120);
    await page.mouse.down();
    assert.equal(await page.locator('.is-resizing-info').count(), 1);
    assert.equal(await separator.evaluate((e) => getComputedStyle(e).cursor), 'col-resize');
    await page.mouse.move(grip.x - 80, grip.y + 120, { steps: 6 });
    await page.mouse.up();
    await settle(page);
    assert.ok((await panel.boundingBox()).width > initial + 40);
    await separator.dblclick({ position: { x: 3, y: 120 } });
    await settle(page);
    assert.ok(Math.abs((await panel.boundingBox()).width - initial) < 1);
    await separator.focus();
    await page.keyboard.press('ArrowLeft');
    await settle(page);
    assert.ok((await panel.boundingBox()).width > initial + 15);
    await page.keyboard.press('Home');
    await settle(page);
    assert.ok(Math.abs((await panel.boundingBox()).width - initial) < 1);
    for (let i = 0; i < 24; i++) await page.keyboard.press('ArrowRight');
    await settle(page);
    assert.equal(Math.round((await panel.boundingBox()).width), 300);
    for (let i = 0; i < 30; i++) await page.keyboard.press('ArrowLeft');
    await settle(page);
    const maximumWidth = await page
      .locator('.preparation-layout')
      .evaluate((e) => Math.min(640, Math.max(300, e.clientWidth - 280)));
    assert.equal(Math.round((await panel.boundingBox()).width), maximumWidth);
    await page.keyboard.press('Home');
    await settle(page);
    for (const event of ['pointercancel', 'lostpointercapture', 'blur']) {
      const box = await separator.boundingBox();
      await page.mouse.move(box.x + 3, box.y + 120);
      await page.mouse.down();
      assert.equal(await page.locator('.is-resizing-info').count(), 1);
      if (event === 'blur') await page.evaluate(() => window.dispatchEvent(new Event('blur')));
      else await separator.dispatchEvent(event, { pointerId: 1 });
      await page.locator('.is-resizing-info').waitFor({ state: 'detached' });
      await page.mouse.move(box.x - 40, box.y + 120);
      await page.mouse.up();
      assert.ok(Math.abs((await panel.boundingBox()).width - initial) < 1);
    }
    assert.equal(await panel.evaluate((e) => e.scrollWidth > e.clientWidth + 1), false);
    while (await panel.locator('.profile-disclosure[open]').count())
      await panel.locator('.profile-disclosure[open]').first().locator(':scope > summary').click();
    await settle(page);
    await page.getByRole('button', { name: '个人信息' }).click();
    console.log(`Profile refinement ${theme} passed`);
  }
  await app.evaluate(
    ({ BrowserWindow }, url) =>
      BrowserWindow.getAllWindows()
        .find((w) => w.webContents.getURL() === url)
        .setContentSize(960, 680),
    page.url(),
  );
  await info.click();
  await settle(page);
  const narrowSeparator = page.getByRole('separator', { name: '调整个人信息宽度' });
  await narrowSeparator.focus();
  for (let i = 0; i < 30; i++) await page.keyboard.press('ArrowLeft');
  await settle(page);
  assert.equal(
    await page.locator('.preparation-layout').evaluate((e) => e.scrollWidth > e.clientWidth + 1),
    false,
  );
  await page.keyboard.press('Home');
  await settle(page);
  await page.getByRole('button', { name: '个人信息' }).click();
  await app.evaluate(
    ({ BrowserWindow }, url) =>
      BrowserWindow.getAllWindows()
        .find((w) => w.webContents.getURL() === url)
        .setContentSize(1280, 800),
    page.url(),
  );
  await page.getByRole('button', { name: '添加附件', exact: true }).click();
  assert.equal(await page.locator('.attachment-menu-hint').count(), 0);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.session-note').count(), 0);
  await page.getByRole('textbox', { name: '聊天消息' }).fill('合成问题');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await page.locator('.response-duration').waitFor();
  assert.equal(
    await page.locator('.response-duration').evaluate((e) => getComputedStyle(e).fontSize),
    '14px',
  );
  await app.evaluate(() => globalThis.finishRefinementAnswer());
  await page.getByRole('button', { name: '发送消息', exact: true }).waitFor();
  await page.getByRole('button', { name: '知识库', exact: true }).click();
  await page
    .getByRole('button', { name: /创建知识库/ })
    .first()
    .click();
  await page.getByLabel('知识库名称').fill('合成资料库');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  const base = page.getByRole('dialog', { name: '合成资料库', exact: true });
  const zone = base.locator('.upload-dropzone');
  const before = await zone.evaluate((e) => ({
    display: getComputedStyle(e).display,
    padding: getComputedStyle(e).padding,
    height: e.getBoundingClientRect().height,
  }));
  await base.getByLabel('导入知识库文档').setInputFiles({
    name: 'synthetic.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('Synthetic input only'),
  });
  await base.locator('.document-row').getByText('索引中 25%', { exact: false }).waitFor();
  const after = await zone.evaluate((e) => ({
    display: getComputedStyle(e).display,
    padding: getComputedStyle(e).padding,
    height: e.getBoundingClientRect().height,
  }));
  assert.equal(after.display, before.display);
  assert.equal(after.padding, before.padding);
  assert.ok(Math.abs(after.height - before.height) < 0.5);
  assert.equal(
    await base.locator('.document-details > p').first().innerText(),
    '20 B · 索引中 25%',
  );
  await app.evaluate(() => globalThis.finishRefinementIndex());
  await base.locator('.document-row').getByText('索引完成', { exact: false }).waitFor();
  // Exercise a genuinely overflowing dialog at both scroll extremes. The frame
  // clips its internal scrollbar, whose track avoids the rounded corners.
  await base.evaluate((dialog) => {
    const content = dialog.querySelector('.dialog-scroll');
    const fixture = document.createElement('div');
    fixture.className = 'synthetic-long-dialog';
    fixture.style.height = '1600px';
    fixture.textContent = 'Synthetic long content';
    content.append(fixture);
  });
  const scroll = base.locator('.dialog-scroll');
  for (const theme of ['light', 'dark']) {
    await page.evaluate(
      (theme) => document.documentElement.classList.toggle('dark', theme === 'dark'),
      theme,
    );
    const geometry = await base.evaluate((dialog) => {
      const port = dialog.querySelector('.dialog-scroll');
      const outer = dialog.getBoundingClientRect(),
        inner = port.getBoundingClientRect();
      return {
        clipped: getComputedStyle(dialog).overflow,
        scrollable: port.scrollHeight > port.clientHeight,
        contained:
          inner.top >= outer.top && inner.bottom <= outer.bottom && inner.right <= outer.right,
        inset: parseFloat(getComputedStyle(port, '::-webkit-scrollbar-track').marginTop),
        radius: parseFloat(getComputedStyle(dialog).borderTopRightRadius),
      };
    });
    assert.equal(geometry.clipped, 'hidden');
    assert.equal(geometry.scrollable, true);
    assert.equal(geometry.contained, true);
    assert.ok(geometry.inset >= geometry.radius);
    for (const bottom of [false, true]) {
      await scroll.evaluate((e, bottom) => {
        e.scrollTop = bottom ? e.scrollHeight : 0;
      }, bottom);
      assert.equal(await scroll.evaluate((e) => e.scrollTop > 0), bottom);
      if (process.argv.includes('--preview-dialog')) {
        const box = await base.boundingBox();
        console.log(
          JSON.stringify({
            preview: `dialog-corner-${theme}-${bottom ? 'bottom' : 'top'}`,
            jpeg: (
              await page.screenshot({
                type: 'jpeg',
                quality: 85,
                clip: {
                  x: box.x + box.width - 100,
                  y: box.y,
                  width: 120,
                  height: box.height,
                },
              })
            ).toString('base64'),
          }),
        );
      }
    }
  }
  await base.locator('.synthetic-long-dialog').evaluate((e) => e.remove());
  await scroll.evaluate((e) => {
    e.scrollTop = 0;
  });
  await base.getByRole('button', { name: '关闭对话框', exact: true }).click();
  assert.deepEqual(errors, []);
  console.log(
    'PASS: 100% zoom; five animated disclosures, reversal and reduced motion; modal save/cancel/Escape/focus/storage failure; divider drag/reset/bounds/keyboard/cancel/narrow layout; clipped and scrollable dialog corners; upload/index state and thinking font. Synthetic offline input only.',
  );
} finally {
  await closeUiApp(app);
}
