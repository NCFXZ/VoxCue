import { testRoot, electron } from './test-workspace.mjs';
import { offlineElectronEntry } from './offline-electron-entry.mjs';

import { mkdir, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { installUiAccount, closeUiApp } from './install-ui-account.mjs';

await mkdir(path.join(testRoot, 'test/results'), { recursive: true });
const directory = await mkdtemp(path.resolve(path.join(testRoot, 'test/results/typography-')));
const app = await electron.launch({
  args: [await offlineElectronEntry()],
  env: { ...process.env, COPILOT_TEST_USER_DATA: directory, VITE_DEV_SERVER_URL: '' },
});
const checks = [],
  errors = [];
const previewStates = new Set([
  'login-light',
  'personal-dark',
  'settings-常规-dark',
  'settings-面试设置-dark',
  'record-answers-narrow-dark',
  'knowledge-documents-narrow-dark',
  'floating-dark',
]);
const requestedPreviews = new Set(
  process.argv
    .find((arg) => arg.startsWith('--preview='))
    ?.slice(10)
    .split(',') ?? [],
);
const inspect = async (page, name) => {
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .every(
        (animation) =>
          animation.effect?.getTiming().iterations === Infinity ||
          animation.playState !== 'running',
      ),
  );
  const geometry = await page.evaluate(() => {
    const visible = (e) => e.getBoundingClientRect().width > 0;
    const active = document.querySelector('dialog[open]:last-of-type') ?? document.body;
    const bounds = active.getBoundingClientRect();
    const overflow = [
      ...active.querySelectorAll(
        '.page-toolbar,.composer,.settings-content,.dialog-heading,.document-row,.personal-panel,.record-answer-panel,[role="menu"]',
      ),
    ]
      .filter(visible)
      .filter((e) => e.scrollWidth > e.clientWidth + 1)
      .map((e) => e.className);
    const selects = [...document.querySelectorAll('.speech-device .speech-select')]
      .filter(visible)
      .map((e) => e.getBoundingClientRect().top);
    const fields = [
      ...document.querySelectorAll(
        '.personal-info-v2 .field-label input,.personal-info-v2 .field-label .choice-trigger',
      ),
    ]
      .filter(visible)
      .map((e) => e.getBoundingClientRect().height);
    const standardControls = [
      ...active.querySelectorAll(
        '.settings-choice,.speech-select,.knowledge-search > input,.knowledge-search > button,.knowledge-search > .choice-trigger,.history-filters input,.history-filters > button,.dialog-footer > .ui-button:not(.button-icon)',
      ),
    ]
      .filter(visible)
      .map((e) => ({
        label: e.getAttribute('aria-label') || e.textContent.trim().slice(0, 30) || e.tagName,
        height: e.getBoundingClientRect().height,
      }));
    const misalignedIcons = [
      ...active.querySelectorAll(
        '.ui-button > svg,.settings-choice > svg,.settings-sidebar nav button > svg,.history-filters button > svg',
      ),
    ]
      .filter(visible)
      .flatMap((icon) => {
        const button = icon.parentElement;
        const b = button.getBoundingClientRect(),
          i = icon.getBoundingClientRect();
        const offset = i.top + i.height / 2 - b.top - b.height / 2;
        return Math.abs(offset) > 1
          ? [{ label: button.getAttribute('aria-label') || button.textContent.trim(), offset }]
          : [];
      });
    const misalignedFooters = [...active.querySelectorAll('.dialog-footer')]
      .filter(visible)
      .flatMap((footer) => {
        const controls = [...footer.querySelectorAll(':scope > button')].filter(visible);
        return controls
          .slice(1)
          .filter((control, index) => {
            const previous = controls[index].getBoundingClientRect(),
              current = control.getBoundingClientRect();
            // Compare controls only on the same flex line; wrapped rows remain valid.
            return (
              Math.abs(previous.top - current.top) <
                Math.min(previous.height, current.height) / 2 &&
              Math.abs(previous.top + previous.height / 2 - current.top - current.height / 2) > 1
            );
          })
          .map((control) => control.textContent.trim());
      });
    const activeAnswer = document.querySelector('.record-panel-toggle.is-active');
    let activeAnswerContrast = null;
    if (activeAnswer) {
      const rgb = (value) => value.match(/[\d.]+/g).map(Number);
      const luminance = (values) =>
        values
          .slice(0, 3)
          .map((value) => {
            const channel = value / 255;
            return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
          })
          .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
      const style = getComputedStyle(activeAnswer);
      const foreground = rgb(style.color),
        background = rgb(style.backgroundColor);
      const surface = rgb(getComputedStyle(document.querySelector('.workspace')).backgroundColor);
      const alpha = background[3] ?? 1;
      const back = luminance(
        background.map((value, index) =>
          index < 3 ? value * alpha + surface[index] * (1 - alpha) : value,
        ),
      );
      const front = luminance(foreground);
      activeAnswerContrast = (Math.max(front, back) + 0.05) / (Math.min(front, back) + 0.05);
    }
    return {
      overflow,
      selects,
      fields,
      standardControls,
      misalignedIcons,
      misalignedFooters,
      activeAnswerContrast,
      dialogContained:
        active === document.body ||
        (bounds.left >= 0 &&
          bounds.top >= 0 &&
          bounds.right <= innerWidth + 1 &&
          bounds.bottom <= innerHeight + 1),
    };
  });
  if (
    requestedPreviews.has(name) ||
    (process.argv.includes('--preview') && (previewStates.has(name) || geometry.overflow.length))
  )
    console.log(
      JSON.stringify({
        preview: name,
        jpeg: (await page.screenshot({ type: 'jpeg', quality: 65, scale: 'css' })).toString(
          'base64',
        ),
      }),
    );
  console.log(`Inspect: ${name}`);
  assert.deepEqual(geometry.overflow, [], `${name}: horizontal overflow`);
  assert(geometry.dialogContained, `${name}: dialog outside viewport`);
  assert.deepEqual(geometry.misalignedIcons, [], `${name}: icon not centered in its button`);
  assert.deepEqual(geometry.misalignedFooters, [], `${name}: dialog actions not centered`);
  assert.deepEqual(
    geometry.standardControls.filter(({ height }) => Math.abs(height - 36) > 0.5),
    [],
    `${name}: inconsistent standard control heights`,
  );
  if (geometry.activeAnswerContrast !== null)
    assert(
      geometry.activeAnswerContrast >= 4.5,
      `${name}: active answer button loses contrast on hover`,
    );
  if (geometry.selects.length === 2)
    assert(
      Math.abs(geometry.selects[0] - geometry.selects[1]) < 1,
      `${name}: device selectors shifted by an error`,
    );
  if (geometry.fields.length > 1)
    assert(
      Math.max(...geometry.fields) - Math.min(...geometry.fields) < 1,
      `${name}: inconsistent form heights`,
    );
  const rows = await page.locator('body').evaluate((body) =>
    [
      ...body.querySelectorAll(
        'h1,h2,h3,h4,p,small,label,summary,button,input,textarea,[role="menuitemradio"]',
      ),
    ]
      .filter((e) => {
        const r = e.getBoundingClientRect(),
          s = getComputedStyle(e);
        return (
          !e.matches('.sr-only') &&
          r.width &&
          r.height &&
          r.bottom > 0 &&
          r.top < innerHeight &&
          s.visibility === 'visible' &&
          (e.textContent.trim() || e.matches('input,textarea'))
        );
      })
      .map((e) => {
        const s = getComputedStyle(e);
        return {
          tag: e.tagName,
          expectedControlSize: e.matches('.profile-edit-dialog textarea.profile-editor-input')
            ? 12
            : 14,
          className: e.className,
          label: e.getAttribute('aria-label') || e.textContent.trim().slice(0, 50),
          size: parseFloat(s.fontSize),
          weight: s.fontWeight,
          line: s.lineHeight,
        };
      }),
  );
  const invalid = rows.filter((row) => ![12, 14, 15, 18].includes(row.size));
  assert.deepEqual(invalid, [], `${name}: unexpected type sizes`);
  const wrongControls = rows.filter(
    (row) =>
      ['BUTTON', 'INPUT', 'TEXTAREA'].includes(row.tag) && row.size !== row.expectedControlSize,
  );
  assert.deepEqual(wrongControls, [], `${name}: inconsistent control text`);
  checks.push({ name, rows, geometry });
  await page.screenshot({ animations: 'disabled' });
};
try {
  await installUiAccount(app, { speech: true, components: true });
  await app.evaluate(({ app }) => {
    const require = process
      .getBuiltinModule('module')
      .createRequire(app.getAppPath() + '/package.json');
    const { ChatGPTService } = require(
      app.getAppPath() + '/dist-electron/shared/electron/backend/chat/service.js',
    );
    const { KnowledgeHost } = require(
      app.getAppPath() + '/dist-electron/shared/electron/backend/knowledge/host.js',
    );
    KnowledgeHost.prototype.listDocuments = async () => [];
    KnowledgeHost.prototype.indexDocument = async () => {
      throw Error('合成资料准备失败，请重试。');
    };
    KnowledgeHost.prototype.search = async () => [];
    ChatGPTService.prototype.stream = async function (request, emit) {
      const answerText =
        '我会先确认问题和边界，再结合已知事实说明实现方法。\n\n### 实现要点\n\n使用明确的接口校验，说明选择理由。';
      emit({ id: request.id, type: 'delta', text: answerText });
      return { answerText, usage: null, sources: [] };
    };
  });
  const login = await app.firstWindow();
  login.setDefaultTimeout(15000);
  await login.getByRole('heading', { name: '欢迎使用 VoxCue', exact: true }).waitFor();
  await inspect(login, 'login-light');
  await login.evaluate(() => document.documentElement.classList.add('dark'));
  await inspect(login, 'login-dark');
  const [page] = await Promise.all([
    app.waitForEvent('window'),
    login.getByRole('button', { name: '使用 ChatGPT 继续', exact: true }).click(),
  ]);
  page.setDefaultTimeout(15000);
  page.on('pageerror', (e) => errors.push(e.message));
  await page.getByRole('heading', { name: '今天想准备哪一部分面试？', exact: true }).waitFor();
  await page.evaluate(() => {
    localStorage.setItem(
      'copilot-personal-info-v1',
      JSON.stringify({
        name: '合成候选人',
        background: '负责本地桌面应用，使用 React 与 TypeScript。',
        jobDescription: '软件开发岗位，要求接口设计与运行时校验。',
        customInstructions: '自然口语，先给结论，再说明理由。',
      }),
    );
    localStorage.setItem(
      'copilot-interview-history-v1',
      JSON.stringify([
        {
          id: 'type-record',
          title: '接口设计与输入校验',
          startedAt: 1000,
          endedAt: 6000,
          status: 'ended',
          mock: false,
          transcripts: [
            {
              id: 't',
              source: 'system',
              text: '你如何校验外部输入？',
              time: '00:01',
              startMs: 1000,
              endMs: 2000,
              final: true,
            },
          ],
          answers: [
            {
              id: 'a',
              question: '你如何校验外部输入？',
              content:
                '我会先明确边界，再校验类型、长度和允许值。\n\n### 实现要点\n\n对不合法的输入返回明确错误。',
              provider: 'chatgpt',
              createdAt: 2000,
            },
          ],
        },
      ]),
    );
  });
  await page.reload();
  const info = page.getByRole('button', { name: '个人信息', exact: true });
  const panel = page.getByRole('complementary', { name: '个人信息', exact: true });
  for (const theme of ['light', 'dark']) {
    await page.evaluate(
      (theme) => document.documentElement.classList.toggle('dark', theme === 'dark'),
      theme,
    );
    await inspect(page, `preparation-${theme}`);
    await info.click();
    await panel.locator('.personal-panel-scroll').evaluate((e) => {
      e.scrollTop = 0;
    });
    await inspect(page, `personal-${theme}`);
    const section = panel.locator('details[aria-label="自定义指令"]');
    if (!(await section.evaluate((e) => e.open))) await section.locator(':scope > summary').click();
    await section.getByRole('button', { name: '编辑', exact: true }).click();
    const editor = page.getByRole('dialog', { name: '编辑自定义指令', exact: true });
    assert.equal(await page.getByRole('dialog').count(), 1);
    assert.equal(
      await section.getByRole('button', { name: '编辑', exact: true }).isDisabled(),
      true,
    );
    assert.equal(await section.locator('.confirm-delete').isDisabled(), true);
    assert.equal(await panel.locator('textarea').count(), 0);
    assert.equal(await editor.getByRole('button', { name: '取消', exact: true }).count(), 1);
    assert.equal(await editor.getByRole('button', { name: '保存', exact: true }).count(), 1);
    await inspect(page, `personal-editor-${theme}`);
    assert.equal(
      await editor
        .getByRole('button', { name: '保存', exact: true })
        .evaluate((e) => getComputedStyle(e).fontSize),
      '14px',
    );
    await editor.getByRole('button', { name: '取消', exact: true }).click();
    await page.getByRole('button', { name: '关闭个人信息', exact: true }).click();
    await page.getByRole('button', { name: '用户菜单', exact: true }).click();
    await page.getByRole('menuitem', { name: '设置', exact: true }).click();
    const settings = page.getByRole('dialog', { name: '设置', exact: true });
    for (const category of [
      '常规',
      '本地组件',
      '账户与用量',
      '面试设置',
      '知识库',
      '更新',
      '关于',
    ]) {
      await settings.getByRole('button', { name: category, exact: true }).click();
      await inspect(page, `settings-${category}-${theme}`);
      if (category === '常规') {
        for (const menu of ['外观主题', '主题色']) {
          await settings.getByRole('button', { name: menu, exact: true }).click();
          await inspect(page, `settings-menu-${menu}-${theme}`);
          await page.keyboard.press('Escape');
        }
      }
      if (category === '账户与用量') {
        await settings.getByRole('button', { name: '重置用量', exact: true }).click();
        await inspect(page, `usage-confirm-${theme}`);
        await page.keyboard.press('Escape');
      }
    }
    await page.getByRole('button', { name: '关闭设置', exact: true }).click();
    await page.getByRole('button', { name: '面试记录', exact: true }).click();
    await page.locator('.history-row').first().waitFor();
    await page.getByRole('searchbox').fill('接口');
    await inspect(page, `history-filtered-${theme}`);
    await page.getByRole('button', { name: '清除筛选', exact: true }).click();
    await inspect(page, `history-${theme}`);
    await page.locator('.history-row').first().click();
    await page.getByRole('heading', { name: '接口设计与输入校验', exact: true }).waitFor();
    await inspect(page, `record-${theme}`);
    await page.getByRole('button', { name: 'AI 回答面板', exact: true }).click();
    await inspect(page, `record-answers-${theme}`);
    await page.getByRole('button', { name: '重命名标题', exact: true }).click();
    await inspect(page, `record-rename-${theme}`);
    await page
      .getByRole('dialog', { name: '重命名标题', exact: true })
      .getByRole('button', { name: '取消', exact: true })
      .click();
    await page.getByRole('button', { name: '知识库', exact: true }).click();
    await inspect(page, `knowledge-${theme}`);
    await page
      .getByRole('button', { name: /创建知识库/ })
      .first()
      .click();
    await inspect(page, `knowledge-create-${theme}`);
    const libraryName =
      theme === 'light' ? '界面对齐测试库' : 'LongKnowledgeBaseName'.repeat(3).slice(0, 60);
    await page.getByLabel('知识库名称', { exact: true }).fill(libraryName);
    await page
      .getByRole('dialog', { name: '创建知识库', exact: true })
      .getByRole('button', { name: '保存', exact: true })
      .click();
    const library = page.getByRole('dialog', { name: libraryName, exact: true });
    await library.waitFor();
    await inspect(page, `knowledge-empty-${theme}`);
    const fileName = '很长的文档名称用于检查工具行对齐'.repeat(3) + '.md';
    await library.getByLabel('导入知识库文档').setInputFiles({
      name: fileName,
      mimeType: 'text/markdown',
      buffer: Buffer.from('这是用于视觉检查的合成文档。'),
    });
    await library.locator('.document-error').waitFor();
    await inspect(page, `knowledge-documents-error-${theme}`);
    await library.getByRole('button', { name: '高级选项', exact: true }).click();
    await library.getByRole('button', { name: '检索方式', exact: true }).click();
    await inspect(page, `knowledge-search-menu-${theme}`);
    await page.keyboard.press('Escape');
    await library.getByRole('button', { name: '预览', exact: true }).click();
    await inspect(page, `knowledge-preview-${theme}`);
    await page
      .getByRole('dialog', { name: fileName, exact: true })
      .getByRole('button', { name: '关闭对话框', exact: true })
      .click();
    await library.getByRole('button', { name: '重命名', exact: true }).click();
    await inspect(page, `knowledge-rename-${theme}`);
    await page
      .getByRole('dialog', { name: '重命名知识库', exact: true })
      .getByRole('button', { name: '取消', exact: true })
      .click();
    await library.getByRole('button', { name: '关闭对话框', exact: true }).click();
    await inspect(page, `knowledge-populated-${theme}`);
    await page.getByRole('button', { name: '新对话', exact: true }).click();
  }
  await page.getByRole('textbox', { name: '聊天消息', exact: true }).fill('请解释接口校验');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await page
    .getByText('我会先确认问题和边界，再结合已知事实说明实现方法。', { exact: true })
    .waitFor();
  await inspect(page, 'chat-dark');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(960, 680));
  await page.waitForFunction(() => innerWidth <= 970);
  await info.click();
  const narrowSection = panel.locator('details[aria-label="自定义指令"]');
  if (!(await narrowSection.evaluate((e) => e.open)))
    await narrowSection.locator(':scope > summary').click();
  await narrowSection.getByRole('button', { name: '编辑', exact: true }).click();
  await inspect(page, 'personal-editor-narrow-dark');
  const overflow = await panel.evaluate((e) => e.scrollWidth > e.clientWidth + 1);
  assert.equal(overflow, false);
  await page
    .getByRole('dialog', { name: '编辑自定义指令', exact: true })
    .getByRole('button', { name: '取消', exact: true })
    .click();
  await page.getByRole('button', { name: '关闭个人信息', exact: true }).click();
  await page.getByRole('button', { name: '面试记录', exact: true }).click();
  await page.locator('.history-row').first().click();
  await page.getByRole('button', { name: 'AI 回答面板', exact: true }).click();
  await inspect(page, 'record-answers-narrow-dark');
  await page.getByRole('button', { name: '知识库', exact: true }).click();
  await page.locator('.knowledge-card').filter({ hasText: 'LongKnowledgeBaseName' }).click();
  await inspect(page, 'knowledge-documents-narrow-dark');
  await page.getByRole('dialog').getByRole('button', { name: '关闭对话框', exact: true }).click();
  await page.getByRole('button', { name: '用户菜单', exact: true }).click();
  await inspect(page, 'user-menu-narrow-dark');
  await page.getByRole('menuitem', { name: '设置', exact: true }).click();
  for (const category of ['常规', '本地组件', '账户与用量', '面试设置', '知识库', '更新', '关于']) {
    await page
      .getByRole('dialog', { name: '设置', exact: true })
      .getByRole('button', { name: category, exact: true })
      .click();
    await inspect(page, `settings-${category}-narrow-dark`);
  }
  await page.getByRole('button', { name: '关闭设置', exact: true }).click();
  await page.getByRole('button', { name: '新对话', exact: true }).click();
  await page.getByRole('button', { name: '开始面试', exact: true }).click();
  const start = page.getByRole('dialog', { name: '开始面试', exact: true });
  await start.getByRole('button', { name: '确认开始', exact: true }).waitFor();
  await inspect(page, 'interview-confirm-dark');
  const [floating] = await Promise.all([
    app.waitForEvent('window'),
    start.getByRole('button', { name: '确认开始', exact: true }).click(),
  ]);
  floating.setDefaultTimeout(15000);
  await floating.getByRole('status', { name: '语音模型：正常', exact: true }).waitFor();
  await inspect(floating, 'floating-light');
  await floating.evaluate(() => document.documentElement.classList.add('dark'));
  await inspect(floating, 'floating-dark');
  await floating.getByRole('button', { name: '收起面试窗口', exact: true }).click();
  await inspect(floating, 'floating-collapsed-dark');
  await floating.getByRole('button', { name: '展开面试窗口', exact: true }).click();
  await floating.getByRole('button', { name: '结束面试', exact: true }).click();
  await inspect(floating, 'floating-end-confirm-dark');
  await Promise.all([
    floating.waitForEvent('close'),
    floating.getByRole('button', { name: '确认结束面试', exact: true }).click(),
  ]);
  assert.deepEqual(errors, []);
  await console.log(
    JSON.stringify(
      {
        checks: checks.map(({ name, geometry }) => ({ name, geometry })),
        errors,
        scope: 'Isolated synthetic account/audio/AI; actual Electron UI and computed typography',
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ directory, states: checks.length, errors }));
} catch (error) {
  const page = app.windows().at(-1);
  if (page && !page.isClosed()) await page.screenshot({});
  throw error;
} finally {
  await closeUiApp(app);
}
