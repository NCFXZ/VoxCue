import { openModelMenu, openReasoningControl } from './install-ui-account.mjs';
import { connectUiAccount } from './install-ui-account.mjs';
import { testRoot, electron } from './test-workspace.mjs';
import { offlineElectronEntry } from './offline-electron-entry.mjs';

import { mkdir, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { installUiAccount, closeUiApp } from './install-ui-account.mjs';
import { captureRequested } from './capture-requested.mjs';
import {
  verifyContinuousCorners,
  verifyCornerRendering,
  verifyCallbackCorners,
} from './continuous-corners.mjs';

await mkdir(path.join(testRoot, 'test/results'), { recursive: true });
const directory = await mkdtemp(path.resolve(path.join(testRoot, 'test/results/typography-')));
const app = await electron.launch({
  args: [await offlineElectronEntry()],
  env: { ...process.env, COPILOT_TEST_USER_DATA: directory, VITE_DEV_SERVER_URL: '' },
});
const checks = [],
  errors = [];
let applicationOutput = '';
app.process().stderr.on('data', (data) => {
  applicationOutput = (applicationOutput + data).slice(-8000);
});
const previewStates = new Set([
  'login-light',
  'personal-dark',
  'settings-通用-dark',
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
const mathAnswer = [
  String.raw`Inline: \(E = mc^2\).`,
  String.raw`\[\begin{bmatrix}1&2\\3&4\end{bmatrix}\begin{bmatrix}5&6\\7&8\end{bmatrix}=\begin{bmatrix}19&22\\43&50\end{bmatrix}\]`,
  '$$' + Array.from({ length: 80 }, (_, i) => `x_{${i}}`).join(' + ') + '$$',
  '```tex\n' + String.raw`\(literal\)` + '\n```',
].join('\n\n');
const verifyNeutralSelection = async (page, name) => {
  const samples = await page.evaluate(() => {
    const selection = getSelection();
    const saved = Array.from({ length: selection.rangeCount }, (_, index) =>
      selection.getRangeAt(index).cloneRange(),
    );
    const targets = [
      document.body,
      ...document.querySelectorAll(
        '.cloud-account-form input[type="email"],.chat-composer textarea,' +
          '.floating-composer textarea,.user-bubble > p,' +
          '.chat-message.assistant .markdown-content p,.answer-bubble .markdown-content p',
      ),
    ].filter((node) => node.checkVisibility());
    try {
      return targets.map((node) => {
        const ordinary = getComputedStyle(node),
          highlight = getComputedStyle(node, '::selection');
        const selectionAllowed =
          !node.closest('[inert], .login-preview') &&
          !node.matches('.login-page :is(input, textarea):placeholder-shown');
        let selectedText = null,
          expectedText = null;
        if (selectionAllowed && node instanceof HTMLTextAreaElement) {
          const start = node.selectionStart,
            end = node.selectionEnd,
            direction = node.selectionDirection;
          node.setSelectionRange(0, node.value.length);
          selectedText = node.value.slice(node.selectionStart, node.selectionEnd);
          expectedText = node.value;
          node.setSelectionRange(start, end, direction);
        } else if (selectionAllowed && node.matches('p')) {
          const text = document
            .createTreeWalker(node, NodeFilter.SHOW_TEXT, {
              acceptNode: (child) =>
                child.textContent.trim() && !child.parentElement.closest('.katex')
                  ? NodeFilter.FILTER_ACCEPT
                  : NodeFilter.FILTER_REJECT,
            })
            .nextNode();
          if (text) {
            const range = document.createRange();
            range.selectNodeContents(text);
            selection.removeAllRanges();
            selection.addRange(range);
            selectedText = selection.toString();
            expectedText = text.textContent;
          }
        }
        return {
          type: node.className || node.tagName,
          background: highlight.backgroundColor,
          color: highlight.color,
          foreground: ordinary.color,
          shadow: highlight.textShadow,
          expectedText,
          selectedText,
        };
      });
    } finally {
      selection.removeAllRanges();
      for (const range of saved) selection.addRange(range);
    }
  });
  const forcedColors = await page.evaluate(() => matchMedia('(forced-colors: active)').matches);
  assert.ok(samples.length > 0, name + ': selection samples are present');
  for (const sample of samples) {
    const [red, green, blue, alpha = 1] = sample.background.match(/[\d.]+/g).map(Number);
    if (!forcedColors) {
      assert.ok(
        red === green && green === blue && alpha > 0 && alpha < 1,
        name + ': text selection uses translucent neutral grey: ' + JSON.stringify(sample),
      );
      assert.equal(sample.color, sample.foreground, name + ': selection preserves text colour');
    }
    assert.equal(sample.shadow, 'none');
    if (sample.selectedText !== null)
      assert.equal(sample.selectedText, sample.expectedText, name + ': text remains selectable');
  }
};
const inspectMath = async (page, selector, name) => {
  const content = page.locator(selector).last();
  await content.locator('.katex-html').nth(2).waitFor();
  await page.evaluate(() => document.fonts.ready);
  assert.equal(await content.locator('.katex').count(), 3, name + ': all formulas rendered');
  assert.equal(await content.locator('.katex-error').count(), 0, name + ': no formula errors');
  assert.equal(await content.locator('pre code').innerText(), String.raw`\(literal\)` + '\n');
  for (const dark of [false, true]) {
    await page.evaluate((dark) => document.documentElement.classList.toggle('dark', dark), dark);
    const geometry = await content.evaluate((root) => {
      const formulas = [...root.querySelectorAll('.katex-display')];
      const long = formulas.at(-1);
      long.scrollLeft = 100;
      return {
        overflow: root.scrollWidth > root.clientWidth + 1,
        scrollable: long.scrollWidth > long.clientWidth && long.scrollLeft > 0,
        matrix: root.querySelectorAll('.mtable').length,
        fontLoaded: [...document.fonts].some(
          (font) => font.family.includes('KaTeX_Main') && font.status === 'loaded',
        ),
      };
    });
    assert.equal(geometry.overflow, false, name + ': math must not widen the answer');
    assert.equal(geometry.scrollable, true, name + ': long math scrolls inside its own block');
    assert.equal(geometry.matrix, 3, name + ': matrix rows and columns rendered');
    assert.equal(geometry.fontLoaded, true, name + ': bundled math font loaded');
    await verifyNeutralSelection(page, name + (dark ? '-dark' : '-light'));
  }
  if (requestedPreviews.has(name))
    console.log(
      JSON.stringify({
        preview: name,
        jpeg: (await page.screenshot({ type: 'jpeg', quality: 65, scale: 'css' })).toString(
          'base64',
        ),
      }),
    );
  console.log('Inspect math: ' + name);
};
const inspect = async (page, name) => {
  await page.waitForFunction(
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
  const corners = await verifyContinuousCorners(page, name);
  if (name === 'login-light')
    console.log(JSON.stringify({ cornerRendering: await verifyCornerRendering(page, app) }));
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
      .map((e) => {
        const control = e.getBoundingClientRect();
        const label = e.closest('.speech-device').querySelector('.speech-device-heading').getBoundingClientRect();
        return {
          left: control.left, top: control.top, width: control.width,
          centerOffset: label.top + label.height / 2 - control.top - control.height / 2,
        };
      });
    const fields = [
      ...document.querySelectorAll(
        '.personal-info-v2 .field-label input,.personal-info-v2 .field-label .choice-trigger',
      ),
    ]
      .filter(visible)
      .map((e) => e.getBoundingClientRect().height);
    const standardControls = [
      ...active.querySelectorAll(
        '.settings-choice,.speech-select,.history-filters input,.history-filters > button,.dialog-footer > .ui-button:not(.button-icon)',
      ),
    ]
      .filter(visible)
      .map((e) => ({
        label: e.getAttribute('aria-label') || e.textContent.trim().slice(0, 30) || e.tagName,
        height: e.getBoundingClientRect().height,
        expectedHeight: e.matches('.history-filters input[type="search"]') ? 44 : 36,
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
    let dialogHeader = null;
    if (active !== document.body) {
      const settings = active.matches('.settings-dialog');
      const heading = active.querySelector(':scope > .dialog-heading');
      const title = heading?.querySelector('.dialog-title h2');
      const close = settings
        ? active.querySelector('.settings-sidebar > .dialog-close-button')
        : heading?.querySelector('.dialog-close-button');
      if (!close || (settings ? !!heading : !title))
        throw Error(
          settings
            ? 'Settings must keep its sidebar close button without a global title header'
            : 'Open modal must use the shared title and upper-right close header',
        );
      const style = getComputedStyle(active),
        t = title?.getBoundingClientRect(),
        c = close.getBoundingClientRect();
      const firstField = active.querySelector(
        ':scope > .dialog-scroll > .field-label:first-child,' +
          ':scope > .dialog-scroll > form:first-child > .field-label:first-child',
      );
      const compactField =
        firstField &&
        heading &&
        !active.hasAttribute('data-overlay-header') &&
        !active.hasAttribute('data-scrollable');
      dialogHeader = {
        settings,
        titleLeft: t ? t.left - bounds.left - parseFloat(style.borderLeftWidth) : null,
        closeLeft: c.left - bounds.left - parseFloat(style.borderLeftWidth),
        closeRight: bounds.right - parseFloat(style.borderRightWidth) - c.right,
        closeTop: c.top - bounds.top - parseFloat(style.borderTopWidth),
        centerOffset: t ? t.top + t.height / 2 - c.top - c.height / 2 : null,
        closeWidth: c.width,
        closeHeight: c.height,
        firstFieldGap: compactField
          ? firstField.getBoundingClientRect().top -
            Math.max(...[...heading.children].map((child) => child.getBoundingClientRect().bottom))
          : null,
      };
    }
    return {
      overflow,
      selects,
      fields,
      standardControls,
      misalignedIcons,
      misalignedFooters,
      activeAnswerContrast,
      dialogHeader,
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
  await captureRequested(page, name);
  assert.deepEqual(geometry.overflow, [], `${name}: horizontal overflow`);
  assert(geometry.dialogContained, `${name}: dialog outside viewport`);
  if (geometry.dialogHeader) {
    const header = geometry.dialogHeader;
    assert(
      (header.settings
        ? [header.closeLeft, header.closeTop]
        : [header.titleLeft, header.closeRight, header.closeTop]
      ).every((inset) => Math.abs(inset - 24) <= 1 / 64),
      `${name}: modal header (or Settings sidebar close) must retain fixed 24px insets: ${JSON.stringify(header)}`,
    );
    assert(
      header.settings || Math.abs(header.centerOffset) <= 1 / 64,
      `${name}: title and close control must share a vertical center`,
    );
    assert(
      Math.abs(header.closeWidth - 36) <= 1 / 64 && Math.abs(header.closeHeight - 36) <= 1 / 64,
      `${name}: modal close hit target stays 36px`,
    );
    if (/^(personal-editor|record-rename|knowledge-(create|rename))/.test(name))
      assert.notEqual(header.firstFieldGap, null, `${name}: the editor form fits on one page`);
    if (header.firstFieldGap !== null)
      assert(
        Math.abs(header.firstFieldGap - 16) <= 1 / 64,
        `${name}: the first label starts 16px below the header content: ${JSON.stringify(header)}`,
      );
  }
  assert.deepEqual(geometry.misalignedIcons, [], `${name}: icon not centered in its button`);
  assert.deepEqual(geometry.misalignedFooters, [], `${name}: dialog actions not centered`);
  assert.deepEqual(
    geometry.standardControls.filter(
      ({ height, expectedHeight }) => Math.abs(height - expectedHeight) > 0.5,
    ),
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
      Math.abs(geometry.selects[0].left - geometry.selects[1].left) <= 1 / 64 &&
        Math.abs(geometry.selects[0].width - geometry.selects[1].width) <= 1 / 64 &&
        geometry.selects[1].top > geometry.selects[0].top &&
        geometry.selects.every((control) => Math.abs(control.centerOffset) <= 1 / 64),
      `${name}: device rows keep their labels centered beside one aligned control column`,
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
          designedSize: e.matches('.login-auth-content h1')
            ? 26
            : e.matches('.cloud-account-form label')
              ? 13
              : e.matches('.login-footer small')
                ? 11
                : e.matches(
                      '.login-preview .login-interview-preview .floating-empty p,' +
                        '.login-preview .login-interview-preview .login-preview-thinking',
                    )
                  ? 11
                  : null,
          expectedControlSize: e.matches('.login-interview-preview textarea')
            ? 11
            : e.matches(
                  '.login-form-links .ui-button,.profile-edit-dialog textarea.profile-editor-input,.chat-copy,.user-message-toggle,' +
                    '.chat-source-link,.reasoning-model-selector,.floating-composer .floating-composer-toolbar .ui-button',
                )
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
  const invalid = rows.filter(
    (row) =>
      row.size !== row.designedSize &&
      ![12, 14, 15, 18].includes(row.size) &&
      !(row.expectedControlSize === 11 && row.size === 11),
  );
  assert.deepEqual(invalid, [], `${name}: unexpected type sizes`);
  const wrongControls = rows.filter(
    (row) =>
      ['BUTTON', 'INPUT', 'TEXTAREA'].includes(row.tag) && row.size !== row.expectedControlSize,
  );
  assert.deepEqual(wrongControls, [], `${name}: inconsistent control text`);
  checks.push({ name, rows, geometry, corners });
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
        globalThis.typographyAnswerText ??
        '我会先确认问题和边界，再结合已知事实说明实现方法。\n\n### 实现要点\n\n使用明确的接口校验，说明选择理由。';
      emit({ id: request.id, type: 'delta', text: answerText });
      return { answerText, usage: null, sources: [] };
    };
  });
  const login = await app.firstWindow();
  login.setDefaultTimeout(15000);
  await login.getByRole('heading', { name: '登录 VoxCue', exact: true }).waitFor();
  await inspect(login, 'login-light');
  await verifyNeutralSelection(login, 'login-light');
  await login.evaluate(() => document.documentElement.classList.add('dark'));
  await inspect(login, 'login-dark');
  await verifyNeutralSelection(login, 'login-dark');
  const page = await connectUiAccount(app, login);
  page.setDefaultTimeout(15000);
  page.on('pageerror', (e) => errors.push(e.message));
  await page.locator('.welcome h1').waitFor();
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
          titleStatus: 'failed',
          titleError: '标题生成失败，可稍后重试。',
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
    for (const [label, menu] of [
      ['添加附件', 'attachments'],
      ['聊天模型', 'model'],
      ['思考强度', 'effort'],
    ]) {
      if (menu === 'model') await openModelMenu(page);
      else if (menu === 'effort') await openReasoningControl(page);
      else await page.getByRole('button', { name: label, exact: true }).click();
      await page.mouse.move(0, 0);
      await inspect(page, `chat-menu-${menu}-${theme}`);
      await page.keyboard.press('Escape');
    }
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
      false,
    );
    assert.equal(
      await section.getByRole('button', { name: '编辑', exact: true }).evaluate((button) => {
        const box = button.getBoundingClientRect();
        const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
        return document.querySelector('dialog[open]')?.contains(hit);
      }),
      true,
      'The modal blocks the background while its edit trigger remains available for focus restoration',
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
    await page.getByRole('button', { name: '个人信息', exact: true }).click();
    await page.getByRole('button', { name: '用户菜单', exact: true }).click();
    await inspect(page, `user-menu-${theme}`);
    await page.getByRole('menuitem', { name: '设置', exact: true }).click();
    await page
      .getByRole('navigation', { name: '设置分类' })
      .getByRole('button', { name: '通用', exact: true })
      .click();
    const settings = page.getByRole('dialog', { name: '设置', exact: true });
    await settings.getByRole('heading', { name: '通用', exact: true }).waitFor();
    assert.equal(await settings.getByRole('button', { name: '知识库', exact: true }).count(), 0);
    for (const category of [
      'VoxCue 账号',
      'AI 服务',
      '本地组件',
      '面试设置',
      '通用',
      '关于与更新',
    ]) {
      await settings.getByRole('button', { name: category, exact: true }).click();
      await settings.getByRole('heading', { name: category, exact: true }).waitFor();
      await inspect(page, `settings-${category}-${theme}`);
      if (category === '通用') {
        for (const menu of ['外观主题']) {
          await settings.getByRole('button', { name: menu, exact: true }).click();
          await inspect(page, `settings-menu-${menu}-${theme}`);
          await page.keyboard.press('Escape');
        }
      }
      if (category === 'AI 服务') {
        assert.equal(
          await settings.getByRole('button', { name: '重置用量', exact: true }).count(),
          0,
        );
        await inspect(page, `account-usage-${theme}`);
      }
    }
    await page.getByRole('button', { name: '关闭设置', exact: true }).click();
    await page.getByRole('button', { name: '面试记录', exact: true }).click();
    await page.locator('.history-row').first().waitFor();
    await page.getByRole('searchbox').fill('接口');
    await inspect(page, `history-filtered-${theme}`);
    assert.equal(await page.getByRole('button', { name: '清除筛选', exact: true }).count(), 0);
    await page.getByRole('searchbox').fill('');
    await inspect(page, `history-${theme}`);
    await page
      .locator('.history-row')
      .first()
      .locator('.history-row-open')
      .click({ position: { x: 16, y: 16 } });
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
    await library.locator('.document-row').getByRole('alert').waitFor();
    await inspect(page, `knowledge-documents-error-${theme}`);
    assert.equal(await library.getByRole('button', { name: '预览', exact: true }).count(), 0);
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
  await page.getByRole('button', { name: '个人信息', exact: true }).click();
  await page.getByRole('button', { name: '面试记录', exact: true }).click();
  await page
    .locator('.history-row')
    .first()
    .locator('.history-row-open')
    .click({ position: { x: 16, y: 16 } });
  await page.getByRole('button', { name: 'AI 回答面板', exact: true }).click();
  await inspect(page, 'record-answers-narrow-dark');
  const titleState = await page.evaluate(() => ({
    records: localStorage.getItem('copilot-interview-history-v1'),
    language: localStorage.getItem('voxcue-language-v1'),
  }));
  try {
    for (const [name, language, error, expected, retry] of [
      ['zh', 'zh-CN', '标题生成失败，可稍后重试。', '标题生成失败，可稍后重试。', '重试生成标题'],
      ['en', 'en', '标题生成失败，可稍后重试。', 'Could not generate a title. You can try again later.', 'Retry title generation'],
      ['en-long', 'en', 'Title generation failed: ' + 'UnbrokenFailureDetail'.repeat(15),
        'Title generation failed: ' + 'UnbrokenFailureDetail'.repeat(15), 'Retry title generation'],
    ]) {
      await page.evaluate(({ language, error }) => {
        const key = 'copilot-interview-history-v1';
        const records = JSON.parse(localStorage.getItem(key));
        const record = records.find((item) => item.id === 'type-record');
        record.titleStatus = 'failed';
        record.titleError = error;
        localStorage.setItem(key, JSON.stringify(records));
        localStorage.setItem('voxcue-language-v1', language);
        for (const key of ['copilot-interview-history-v1', 'voxcue-language-v1'])
          window.dispatchEvent(new StorageEvent('storage', { key }));
      }, { language, error });
      const status = page.locator('.record-title-status');
      await status.getByRole('button', { name: retry, exact: true }).waitFor();
      await page.waitForFunction((expected) =>
        document.querySelector('.record-title-status > span')?.textContent === expected, expected);
      const answerCount = language === 'zh-CN' ? '1 条 AI 回答' : '1 AI answer';
      await page.waitForFunction((expected) =>
        document.querySelector('.record-panel-toggle > span')?.textContent === expected &&
        document.querySelector('.record-facts')?.textContent.endsWith(expected), answerCount);
      await page.evaluate(() => document.fonts.ready);
      const geometry = await status.evaluate((node) => {
        const scroll = node.closest('.record-transcript-scroll');
        const viewport = scroll.getBoundingClientRect();
        const panel = node.closest('.record-detail-body')
          .querySelector('.record-answer-panel[data-open="true"]');
        const right = Math.min(viewport.right, panel.getBoundingClientRect().left);
        const label = node.querySelector(':scope > span');
        const button = node.querySelector('button');
        const range = document.createRange();
        range.selectNodeContents(label);
        const lines = [...range.getClientRects()].filter((rect) => rect.width > 0);
        const bounds = [label.getBoundingClientRect(), button.getBoundingClientRect(), ...lines];
        return {
          contained: bounds.every((rect) => rect.left >= viewport.left - 1 &&
            rect.right <= right + 1 && rect.top >= viewport.top - 1 &&
            rect.bottom <= viewport.bottom + 1),
          unobscured: [...lines, button.getBoundingClientRect()].every((rect) => {
            const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
            return node.contains(hit);
          }),
          statusOverflow: node.scrollWidth > node.clientWidth + 1,
          transcriptOverflow: scroll.scrollWidth > scroll.clientWidth + 1,
        };
      });
      assert.deepEqual(geometry, {
        contained: true, unobscured: true, statusOverflow: false, transcriptOverflow: false,
      }, `record-title-status-${name}: full error text and retry button stay inside the unobscured transcript column`);
      await captureRequested(page, `record-title-status-${name}-narrow-dark`);
      checks.push({ name: `record-title-status-${name}`, geometry });
    }
  } finally {
    await page.evaluate(({ records, language }) => {
      for (const [key, value] of [
        ['copilot-interview-history-v1', records], ['voxcue-language-v1', language],
      ]) {
        if (value === null) localStorage.removeItem(key);
        else localStorage.setItem(key, value);
        window.dispatchEvent(new StorageEvent('storage', { key }));
      }
    }, titleState);
    await page.getByRole('button', { name: '重试生成标题', exact: true }).waitFor();
  }
  await page.getByRole('button', { name: '知识库', exact: true }).click();
  await page.locator('.knowledge-card').filter({ hasText: 'LongKnowledgeBaseName' }).click();
  await inspect(page, 'knowledge-documents-narrow-dark');
  await page.getByRole('dialog').getByRole('button', { name: '关闭对话框', exact: true }).click();
  await page.getByRole('button', { name: '用户菜单', exact: true }).click();
  await inspect(page, 'user-menu-narrow-dark');
  await page.getByRole('menuitem', { name: '设置', exact: true }).click();
  await page
    .getByRole('navigation', { name: '设置分类' })
    .getByRole('button', { name: '通用', exact: true })
    .click();
  for (const category of ['VoxCue 账号', 'AI 服务', '本地组件', '面试设置', '通用', '关于与更新']) {
    await page
      .getByRole('dialog', { name: '设置', exact: true })
      .getByRole('button', { name: category, exact: true })
      .click();
    await page.getByRole('heading', { name: category, exact: true }).waitFor();
    await inspect(page, `settings-${category}-narrow-dark`);
  }
  await page.getByRole('button', { name: '关闭设置', exact: true }).click();
  await page.getByRole('button', { name: '新对话', exact: true }).click();
  await app.evaluate((_, text) => {
    globalThis.typographyAnswerText = text;
  }, mathAnswer);
  await page.getByRole('textbox', { name: '聊天消息', exact: true }).fill('Formula layout');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await inspectMath(page, '.chat-message.assistant .markdown-content', 'chat-math');
  await page.locator('.interview-start-trigger').click();
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
  await floating.getByRole('textbox', { name: '面试提问', exact: true }).fill('Formula layout');
  await floating.getByRole('button', { name: '发送面试问题', exact: true }).click();
  await inspectMath(floating, '.answer-bubble .markdown-content', 'interview-math');
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
  const callbacks = await verifyCallbackCorners(app);
  await console.log(
    JSON.stringify(
      {
        checks: checks.map(({ name, geometry, corners }) => ({ name, geometry, corners })),
        callbacks,
        errors,
        scope: 'Isolated synthetic account/audio/AI; actual Electron UI and computed typography',
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({ directory, states: checks.length, callbacks: callbacks.length, errors }),
  );
} catch (error) {
  console.error('Owned UI diagnostic', {
    exitCode: app.process().exitCode,
    signalCode: app.process().signalCode,
    output: applicationOutput,
  });
  const page = app.windows().at(-1);
  if (page && !page.isClosed()) await page.screenshot({});
  throw error;
} finally {
  await closeUiApp(app);
}
