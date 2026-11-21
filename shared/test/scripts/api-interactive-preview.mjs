import path from 'node:path';
import { assertPlainProviderLogo } from './assert-provider-logo.mjs';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { writeFile } from 'node:fs/promises';
import workspace from '../../scripts/workspace.mjs';
import { testRoot, electron } from './test-workspace.mjs';
import { offlineElectronEntry } from './offline-electron-entry.mjs';
import { captureRequested } from './capture-requested.mjs';
import {
  enterPrimaryUiAccount,
  installUiAccount,
  closeUiApp,
  focusUiWindow,
  openModelMenu,
} from './install-ui-account.mjs';

const profile = path.join(testRoot, 'profile');
const checkOnly = process.argv.includes('--check-only');
const check = checkOnly || process.argv.includes('--check');
const fixture = fileURLToPath(new URL('../fixtures/api-interactive-preview.cjs', import.meta.url));
const entry = path.join(testRoot, 'api-preview.cjs');
const compiled = path.join(workspace.platformRoot, 'dist-electron/shared/electron/main.js');
await writeFile(
  entry,
  [
    'require(' +
      JSON.stringify(fixture) +
      ').install(' +
      JSON.stringify(workspace.platformRoot) +
      ',' +
      JSON.stringify(profile) +
      ');',
    'require(' + JSON.stringify(compiled) + ');',
  ].join('\n'),
);
const env = Object.fromEntries(
  Object.entries(process.env).filter(([name]) =>
    /^(?:systemroot|windir|comspec|path|pathext|temp|tmp|tmpdir|userprofile|home|appdata|localappdata|lang|lc_all|display|wayland_display|xdg_runtime_dir|sessionname)$/i.test(
      name,
    ),
  ),
);
const app = await electron.launch({
  args: [await offlineElectronEntry(entry)],
  env: {
    ...env,
    COPILOT_TEST_USER_DATA: profile,
    VOXCUE_ACCOUNT_API: '',
    VITE_DEV_SERVER_URL: '',
  },
});
async function runPreview() {
  await installUiAccount(app, { speech: true, components: true });
  const login = await app.firstWindow();
  const page = login.url().endsWith('#login') ? await enterPrimaryUiAccount(app, login) : login;
  page.setDefaultTimeout(15000);
  await page.addStyleTag({ content: `
    .ai-services-panel > .settings-hint:first-child::after {
      display: block;
      margin-top: 4px;
      content: "离线模拟预览 · 余额和回复为示例";
    }
  ` });
  await focusUiWindow(app, page);
  const settings = page.getByRole('dialog', { name: '设置', exact: true });
  async function openSettings() {
    await page.getByRole('button', { name: '用户菜单', exact: true }).click();
    await page.getByRole('menuitem', { name: '设置', exact: true }).click();
    await settings.getByRole('navigation', { name: '设置分类' })
      .getByRole('button', { name: 'AI 服务', exact: true }).click();
  }
  async function checkProviderLogos() {
    const button = (scope, name) => scope.getByRole('button', { name, exact: true });
    const icons = new Map();
    async function source(image) {
      await image.waitFor();
      await assertPlainProviderLogo(image);
      return image.evaluate(node => {
        const rect = node.getBoundingClientRect();
        if (!node.naturalWidth || rect.width < 1 || rect.height < 1) throw Error('Provider image is not visible');
        return node.currentSrc;
      });
    }
    async function select(name) {
      await openSettings();
      await settings.getByRole('radio', { name: 'API 密钥', exact: true }).click();
      const row = settings.getByRole('group', { name, exact: true });
      icons.set(name, await source(row.locator('.api-service-disclosure img')));
      const enable = button(row, '启用');
      if (await enable.isVisible()) await enable.click();
      await button(row, '禁用').waitFor();
      await button(settings, '关闭设置').click();
      await settings.waitFor({ state: 'hidden' });
    }
    async function verify(answer, name) {
      const label = answer.locator('.provider-name');
      await label.waitFor();
      assert.equal(await label.innerText(), name, 'Answer provider');
      const image = answer.locator('.provider-avatar img');
      assert.ok(await source(image) === icons.get(name), name + ' answer must use its settings logo');
      await answer.locator('.markdown-content').getByText(/这是模拟回答/).waitFor();
      await answer.locator('.typing-caret').waitFor({ state: 'detached' });
    }
    async function chat(question, name) {
      const answers = page.locator('.chat-message.assistant');
      const index = await answers.count();
      await page.getByRole('textbox', { name: '聊天消息', exact: true }).fill(question);
      await button(page, '发送消息').click();
      const answer = answers.nth(index);
      await verify(answer, name);
      await answer.locator('.chat-message-actions').waitFor();
      await button(page, '停止回复').waitFor({ state: 'detached' });
      await button(page, '发送消息').waitFor();
      assert.doesNotMatch(await page.locator('.preparation-notices').innerText(),
        /(?:未启用|不支持|未提供).{0,16}(?:网页|网络|联网)搜索|(?:网页|网络|联网)搜索.{0,16}(?:未启用|不可用|未执行)/,
        'A successful API reply must not leave a web search warning below the chat');
      return answer;
    }
    async function interview(question, name, capture) {
      await button(page, '开始面试').click();
      const start = page.getByRole('dialog', { name: '开始面试', exact: true });
      const [floating] = await Promise.all([app.waitForEvent('window'), button(start, '确认开始').click()]);
      await floating.waitForURL(url => url.hash === '#interview');
      const input = floating.getByRole('textbox', { name: '面试提问', exact: true });
      await input.fill(question);
      await input.press('Enter');
      const answer = floating.getByRole('article', { name: '回答：' + question, exact: true });
      await verify(answer, name);
      if (capture) await captureRequested(floating.locator('.floating-answer'), 'VoxCue-1.3.0-interview-provider-logo');
      await button(floating, '结束面试').click();
      await Promise.all([floating.waitForEvent('close'), button(floating, '确认结束面试').click()]);
    }
    const firstQuestion = '请介绍本场面试使用的模型。';
    await select('OpenAI API');
    const openai = await chat('请介绍当前使用的模型。', 'OpenAI API');
    await interview(firstQuestion, 'OpenAI API', false);
    await select('DeepSeek');
    assert.ok(icons.get('DeepSeek') !== icons.get('OpenAI API'), 'The two settings logos must differ');
    await verify(openai, 'OpenAI API');
    const deepseek = await chat('切换后，现在使用哪个模型？', 'DeepSeek');
    await verify(openai, 'OpenAI API');
    await verify(deepseek, 'DeepSeek');
    for (const theme of ['深色', '浅色']) {
      await openSettings();
      await button(settings.getByRole('navigation', { name: '设置分类' }), '通用').click();
      await button(settings, '外观主题').click();
      await page.getByRole('menuitemradio', { name: theme, exact: true }).click();
      await button(settings, '关闭设置').click();
      await settings.waitFor({ state: 'hidden' });
      await page.waitForFunction(dark => document.documentElement.classList.contains('dark') === dark, theme === '深色');
      for (const [answer, name] of [[openai, 'OpenAI API'], [deepseek, 'DeepSeek']]) {
        await verify(answer, name);
        const metrics = await answer.locator('.answer-label .provider-avatar').evaluate(avatar => {
          const style = getComputedStyle(avatar), slot = avatar.getBoundingClientRect();
          const image = avatar.querySelector('img').getBoundingClientRect();
          const text = avatar.nextElementSibling.getBoundingClientRect();
          const px = value => Math.round(value * 1000) / 1000;
          return {
            background: style.backgroundColor, image: style.backgroundImage, shadow: style.boxShadow,
            border: ['Top', 'Right', 'Bottom', 'Left'].some(side =>
              parseFloat(style['border' + side + 'Width']) > 0 && !['none','hidden'].includes(style['border' + side + 'Style']) &&
              style['border' + side + 'Color'] !== 'rgba(0, 0, 0, 0)'),
            logo: [px(image.width), px(image.height)], slot: [px(slot.width), px(slot.height)],
            gap: px(text.left - slot.right), rowHeight: px(avatar.parentElement.getBoundingClientRect().height),
          };
        });
        assert.deepEqual(metrics, { background:'rgba(0, 0, 0, 0)', image:'none', shadow:'none', border:false,
          logo:[18,18], slot:[25,25], gap:7, rowHeight:25 }, name + ' ' + theme + ' answer logo');
      }
    }
    await captureRequested(page.locator('.preparation-workspace'), 'VoxCue-1.3.0-chat-provider-logos-plain');
    await button(page, '面试记录').click();
    await page.locator('.history-row-open').first().click();
    const toggle = button(page, 'AI 回答面板');
    if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
    await verify(page.getByRole('article', { name: '回答：' + firstQuestion, exact: true }), 'OpenAI API');
    await button(page, '新对话').click();
    await interview('请说明本场面试的模型和思考设置。', 'DeepSeek', true);
    console.log('OpenAI and DeepSeek settings, chat, interview and retained answer logos passed.');
  }
  if (process.argv.includes('--provider-logos')) return checkProviderLogos();
  async function checkInterviewBilling(expected, screenshotName) {
    await page.getByRole('button', { name: '开始面试', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '开始面试', exact: true });
    const summary = dialog.getByRole('group', { name: '当前面试设置', exact: true });
    const row = summary.locator('dl > div').filter({
      has: page.getByText('AI服务用量', { exact: true }).and(page.locator('dt')),
    });
    await row.getByText(expected, { exact: true }).waitFor();
    assert.deepEqual(await row.locator(':scope > dt, :scope > dd').allInnerTexts(), ['AI服务用量', expected]);
    assert.ok(await row.evaluate(node => {
      const label = node.querySelector('dt').getBoundingClientRect();
      const value = node.querySelector('dd').getBoundingClientRect();
      return label.width > 0 && value.width > 0 && label.right <= value.left &&
        label.top < value.bottom && value.top < label.bottom;
    }), expected + ' must appear to the right of its label in the same row');
    await dialog.getByRole('button', { name: '确认开始', exact: true }).and(dialog.locator(':enabled')).waitFor();
    if (screenshotName) await captureRequested(dialog, screenshotName);
    await dialog.getByRole('button', { name: '取消', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
  }
  await openSettings();
  const methods = settings.getByRole('radiogroup', { name: '连接方式', exact: true });
  let connectSizes;
  if (check) {
    await methods.getByRole('radio', { name: '账号授权', exact: true }).click();
    const accountRows = settings.locator('[data-settings-target="chatgpt"], [data-settings-target="copilot"]');
    await accountRows.last().waitFor();
    connectSizes = await accountRows.getByRole('button', { name: '连接', exact: true }).evaluateAll(
      buttons => buttons.map(button => [button.offsetWidth, button.offsetHeight]),
    );
  }
  await methods.getByRole('radio', { name: 'API 密钥', exact: true }).click();
  const active = settings.getByRole('group', { name: 'DeepSeek', exact: true });
  const qwen = settings.getByRole('group', { name: '通义千问', exact: true });
  const regionTrigger = qwen.getByRole('button', { name: '服务地域', exact: true });
  async function selectedRegionWidth(name) {
    assert.equal(await regionTrigger.getAttribute('aria-expanded'), 'false');
    const label = regionTrigger.getByText(name, { exact: true }).and(
      regionTrigger.locator('span:not([aria-hidden="true"], [aria-hidden="true"] *)'),
    );
    const { fits, width } = await label.evaluate(span => {
      const trigger = span.closest('button');
      const button = trigger.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(span);
      const text = range.getBoundingClientRect();
      const bounds = span.getBoundingClientRect();
      const right = trigger.querySelector('svg').getBoundingClientRect().left;
      return { width: button.width, fits: text.width > 0 && text.left >= Math.max(button.left, bounds.left) - 1
        && text.right <= Math.min(right, bounds.right) + 1 };
    });
    assert.ok(fits, name + ' fits beside the chevron');
    return width;
  }
  async function chooseQwenRegion(name) {
    await regionTrigger.click();
    await page.getByRole('menuitemradio', { name, exact: true }).click();
    return selectedRegionWidth(name);
  }
  async function expectDetails(group, provider, open) {
    const id = 'api-settings-' + provider;
    await group.locator(`button[aria-controls="${id}"][aria-expanded="${open}"]`).waitFor();
    const panel = group.locator('#' + id);
    if (!open) {
      assert.ok(await panel.evaluate(node => {
        const content = node.querySelector('.api-service-details');
        if (!content) return true;
        const action = content.querySelector('button:not(:disabled), input:not(:disabled)');
        action?.focus();
        return !!content.closest('[inert]') && !node.contains(document.activeElement);
      }), 'Closing details immediately disables focus and interaction');
      await panel.locator('.api-service-details').waitFor({ state: 'detached' });
      assert.equal(await panel.evaluate(node => node.getBoundingClientRect().height), 0);
      return;
    }
    const reveal = panel.locator(':scope > .interview-reveal[data-open="true"]:not([inert])');
    await reveal.waitFor();
    await reveal.evaluate(async node => {
      await Promise.allSettled(node.getAnimations().map(animation => animation.finished));
    });
    assert.ok(await panel.evaluate(node => node.getBoundingClientRect().height > 0));
    assert.ok(await panel.getByRole('button', { name: /更换密钥|输入 API 密钥/ }).isVisible());
  }
  async function checkUsageLayout(group, { balance, routing }) {
    const detail = group.locator('.api-service-details');
    const card = detail.locator('.api-usage.account-quota[aria-busy="false"]');
    await card.waitFor();
    const metrics = card.locator('dl.api-usage-values > .api-usage-line');
    const labels = ['本机请求', '输入 token', '输出 token'];
    assert.deepEqual(await metrics.locator('dt').allTextContents(),
      balance ? ['账户余额', ...labels] : labels);
    assert.equal(await detail.locator('progress, [role="progressbar"], .account-quota-progress').count(), 0);
    assert.equal(await detail.locator(':scope > .api-routing-fields').count(), routing ? 1 : 0);
    const layout = await detail.evaluate(node => {
      const bounds = element => element.getBoundingClientRect();
      const group = node.closest('.api-service');
      const serviceHeader = group.querySelector('.ai-service-row');
      const usage = node.querySelector('.api-usage');
      const card = bounds(usage);
      const heading = bounds(usage.querySelector('header strong'));
      const refresh = bounds(usage.querySelector('header button'));
      const stats = usage.querySelector('dl');
      const items = [...stats.querySelectorAll('.api-usage-line')];
      const keyRow = node.querySelector('.api-detail-row');
      const textActions = [...keyRow.querySelectorAll('.api-text-action:enabled')];
      const key = bounds(keyRow.querySelector('.api-key-value'));
      const links = bounds(keyRow.querySelector('.api-links'));
      const routing = node.querySelector('.api-routing-fields');
      const workspace = routing?.querySelector('input');
      const wideInput = workspace?.getBoundingClientRect().width;
      function routingInline() {
        if (!routing) return true;
        const fields = [...routing.querySelectorAll('.api-routing-field > span:first-child, button, input')].map(bounds);
        const row = bounds(routing);
        return fields.length === 4 && Math.max(...fields.map(r => r.top)) < Math.min(...fields.map(r => r.bottom))
          && fields.every((r, i) => r.width > 0 && r.left >= (i ? fields[i - 1].right : row.left) - 1
            && r.right <= row.right + 1);
      }
      function singleRegionAligned() {
        if (!workspace) return true;
        const field = workspace.closest('.api-routing-field'), next = field.nextSibling;
        const trigger = routing.querySelector('button'), width = bounds(trigger).width;
        field.remove();
        try {
          const row = bounds(routing), label = bounds(trigger.previousElementSibling), button = bounds(trigger);
          return Math.abs(label.left - row.left) <= 1 && Math.abs(button.right - row.right) <= 1
            && Math.abs(button.width - width) <= 1 && button.left - label.right >= 32;
        } finally {
          routing.insertBefore(field, next);
        }
      }
      const lastRow = routing ?? keyRow;
      const divider = bounds(group).bottom;
      const nextHeader = group.nextElementSibling.querySelector('.ai-service-row');
      const headerPositions = header => [
        bounds(header.querySelector('.service-brand-icon')).left,
        bounds(header.querySelector('.ai-service-label strong')).left,
        ...[...header.querySelectorAll('.ai-service-actions button')].flatMap(button => {
          const { left, right } = bounds(button);
          return [left, right];
        }),
      ];
      const collapsed = headerPositions(nextHeader);
      const standardHeight = parseFloat(getComputedStyle(node).getPropertyValue('--control-height'));
      const wideTops = items.map(item => bounds(item).top);
      const openSides = style => [style.borderTopWidth, style.borderLeftWidth, style.borderRightWidth]
        .every(width => parseFloat(width) === 0);
      const normal = {
        alignedServiceHeaders: nextHeader.querySelector('.api-service-disclosure').getAttribute('aria-expanded') === 'false'
          && headerPositions(serviceHeader).every((position, i) => Math.abs(position - collapsed[i]) <= 1),
        noOuterFrame: openSides(getComputedStyle(group)) && ['::before', '::after'].every(pseudo => {
          const style = getComputedStyle(group, pseudo);
          return style.content === 'none' || style.opacity === '0' || openSides(style);
        }),
        outlinedCard: parseFloat(getComputedStyle(usage).borderTopWidth) > 0,
        innerDividers: items.slice(1).every(item => parseFloat(getComputedStyle(item).borderInlineStartWidth) > 0)
          && (!routing || parseFloat(getComputedStyle(routing).borderBlockStartWidth) > 0),
        refreshInCard: card.top <= refresh.top && heading.right < refresh.left &&
          heading.top < refresh.bottom && refresh.top < heading.bottom && refresh.bottom <= bounds(stats).top + 1,
        standardRefresh: Math.abs(refresh.height - standardHeight) < 1,
        metricsInline: Math.max(...wideTops) - Math.min(...wideTops) <= 1,
        keysBelowCard: bounds(keyRow).top >= card.bottom - 1,
        textLinkPointers: textActions.length === 3 && textActions.every(button => {
          const icon = button.querySelector('svg');
          return icon && getComputedStyle(button).cursor === 'pointer' && getComputedStyle(icon).cursor === 'pointer';
        }),
        linksAtRight: key.right <= links.left + 1 && key.top < links.bottom && links.top < key.bottom &&
          Math.abs(links.right - bounds(keyRow).right) <= 1,
        routingLast: lastRow === node.lastElementChild && (!routing || bounds(routing).top >= bounds(keyRow).bottom - 1),
        routingInline: routingInline(),
        singleRegionAligned: singleRegionAligned(),
        dividerLast: getComputedStyle(serviceHeader).borderBottomWidth === '0px' &&
          parseFloat(getComputedStyle(group).borderBottomWidth) > 0 &&
          bounds(lastRow).bottom < divider && divider <= bounds(nextHeader).top + 1,
      };
      const fittedWidth = node.style.width;
      try {
        node.style.width = '280px';
        const narrow = bounds(node);
        const tops = items.map(item => bounds(item).top);
        const contents = [...node.querySelectorAll('button, input, dt, dd')];
        return {
          ...normal,
          narrowRouting: routingInline() && (!workspace || bounds(workspace).width < wideInput),
          narrowWraps: Math.max(...tops) - Math.min(...tops) > 1,
          narrowFits: node.scrollWidth <= node.clientWidth + 1 && contents.every(element => {
            const rect = bounds(element);
            return rect.left >= narrow.left - 1 && rect.right <= narrow.right + 1;
          }),
        };
      } finally {
        node.style.width = fittedWidth;
      }
    });
    const name = await group.getAttribute('aria-label');
    for (const [requirement, met] of Object.entries(layout))
      assert.ok(met, name + ' usage layout: ' + requirement);
  }
  await active.getByRole('button', { name: '启用', exact: true }).click();
  await active.getByRole('button', { name: '禁用', exact: true }).waitFor();
  await settings.getByText('28.50 CNY', { exact: true }).waitFor();
  if (check) {
    await expectDetails(active, 'deepseek', true);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    const motion = await active.locator('#api-settings-deepseek').evaluateHandle(panel => {
      const runs = [];
      function record(event) {
        if (event.propertyName === 'grid-template-rows' && event.target.parentElement === panel)
          runs.push(event.target.dataset.open);
      }
      panel.addEventListener('transitionrun', record);
      return { runs, stop: () => panel.removeEventListener('transitionrun', record) };
    });
    try {
      await active.getByRole('button', { name: '禁用', exact: true }).click();
      await expectDetails(active, 'deepseek', false);
      await active.getByRole('button', { name: '启用', exact: true }).click();
      await expectDetails(active, 'deepseek', true);
      assert.deepEqual(await motion.evaluate(observer => observer.runs), ['false', 'true'],
        'Collapsing and expanding each start a grid row height transition');
    } finally {
      await motion.evaluate(observer => observer.stop());
      await motion.dispose();
      await page.emulateMedia({ reducedMotion: null });
    }
    await active.getByText('28.50 CNY', { exact: true }).waitFor();
    const detail = active.locator('#api-settings-deepseek .api-service-details');
    await detail.locator('.api-key-mask').waitFor();
    assert.equal(await detail.getByRole('textbox').count(), 0);
    const refresh = detail.getByRole('button', { name: '刷新用量', exact: true });
    await detail.locator('.api-usage[aria-busy="false"]').waitFor();
    assert.equal((await refresh.textContent()).trim(), '刷新');
    await refresh.locator('svg').waitFor();
    await refresh.click();
    await detail.locator('.api-usage[aria-busy="false"]').waitFor();
    await detail.getByText('28.50 CNY', { exact: true }).waitFor();
    await checkUsageLayout(active, { balance: true, routing: false });
    const actions = qwen.locator('.ai-service-actions').getByRole('button');
    const rectangles = () => actions.evaluateAll(async (buttons) => {
      await Promise.allSettled(buttons.flatMap(button => button.getAnimations().map(a => a.finished)));
      return buttons.map(button => {
        const { x, y, width, height } = button.getBoundingClientRect();
        const cssPixel = v => Math.round(v * 64) / 64;
        return { x: cssPixel(x), y: cssPixel(y), width: cssPixel(width), height: cssPixel(height) };
      });
    });
    const idle = await rectangles();
    const standardHeight = await settings.evaluate(dialog =>
      parseFloat(getComputedStyle(dialog).getPropertyValue('--control-height')));
    assert.deepEqual(idle.map(rect => rect.height), [standardHeight, standardHeight]);
    const enableSize = [Math.round(idle[0].width), Math.round(idle[0].height)];
    assert.deepEqual(connectSizes, [enableSize, enableSize], 'Account Connect must match API Enable');
    console.log('Service buttons (CSS px)', { connect: connectSizes[0], enable: enableSize, remove: idle[1].width });
    await qwen.getByRole('button', { name: '启用', exact: true }).click();
    await expectDetails(qwen, 'qwen', true);
    await expectDetails(active, 'deepseek', false);
    await qwen.getByRole('textbox', { name: /工作区 ID/ }).waitFor();
    const regionWidths = [];
    for (const name of ['北京', '新加坡', '东京', '香港', '法兰克福', '弗吉尼亚'])
      regionWidths.push(await chooseQwenRegion(name));
    assert.ok(Math.max(...regionWidths) - Math.min(...regionWidths) <= 1, 'Region selection preserves trigger width');
    await checkUsageLayout(qwen, { balance: false, routing: true });
    await chooseQwenRegion('北京');
    const removeKey = qwen.getByRole('button', { name: /^移除密钥/ });
    await removeKey.scrollIntoViewIfNeeded();
    const selected = await rectangles();
    await removeKey.click();
    const confirmed = qwen.getByRole('button', { name: /^确认/ });
    await confirmed.waitFor();
    assert.deepEqual(await rectangles(), selected, 'Confirming removal must preserve both capsules');
    await confirmed.click();
    await expectDetails(qwen, 'qwen', false);
    assert.equal(await qwen.getByRole('textbox', { name: /工作区 ID/ }).count(), 0);
    assert.ok(await qwen.getByRole('button', { name: '启用', exact: true }).isDisabled());
    const add = qwen.getByRole('button', { name: '添加密钥', exact: true });
    const qwenToggle = qwen.locator('button[aria-controls="api-settings-qwen"]');
    await qwenToggle.click();
    await expectDetails(qwen, 'qwen', true);
    await chooseQwenRegion('东京');
    assert.ok(await add.isDisabled(), 'Tokyo requires a workspace');
    await chooseQwenRegion('香港');
    assert.ok(await add.isEnabled(), 'Hong Kong also accepts the shared regional endpoint');
    await chooseQwenRegion('法兰克福');
    assert.ok(await add.isDisabled(), 'Frankfurt requires a workspace');
    await qwen.getByRole('textbox', { name: '工作区 ID', exact: true }).fill('fixture-space');
    assert.ok(await add.isEnabled(), 'Frankfurt accepts a workspace-specific key');
    await qwenToggle.click();
    await expectDetails(qwen, 'qwen', false);
    const prompt = page.getByRole('dialog', { name: '添加 API 密钥', exact: true });
    await add.click();
    const sample = prompt.getByLabel('通义千问 API 密钥', { exact: true }).and(prompt.locator('input'));
    await sample.waitFor();
    assert.equal(await sample.getAttribute('placeholder'), null);
    assert.equal(await prompt.locator('.dialog-subtitle').count(), 0);
    for (const name of ['取消', '验证并保存', '显示密钥'])
      await prompt.getByRole('button', { name, exact: true }).locator('svg').waitFor();
    const textInset = await sample.evaluate(input => {
      const frame = input.closest('.api-key-input-frame');
      return input.getBoundingClientRect().left - frame.getBoundingClientRect().left
        - parseFloat(getComputedStyle(frame).borderLeftWidth) + parseFloat(getComputedStyle(input).paddingLeft);
    });
    assert.ok(Math.abs(textInset - 12) < 0.02, 'Match the 12px inset of a standard settings input');
    await prompt.getByRole('button', { name: '取消', exact: true }).click();
    await prompt.waitFor({ state: 'hidden' });
    await qwenToggle.click();
    await chooseQwenRegion('弗吉尼亚');
    await add.click();
    const save = prompt.getByRole('button', { name: '验证并保存', exact: true });
    for (let attempt = 0; attempt < 2; attempt++) {
      const previous = await sample.elementHandle();
      if (attempt === 0) await save.click();
      else await page.keyboard.press('Enter');
      await prompt.getByRole('alert').filter({ hasText: 'API 密钥格式无效。' }).waitFor();
      await page.waitForFunction(old => {
        const current = document.querySelector('[data-api-key-field] input');
        return current && current !== old && current === document.activeElement;
      }, previous);
      await previous.dispose();
      assert.ok(await save.isEnabled());
      assert.equal(await prompt.getByRole('button', { name: '重新输入' }).count(), 0);
    }
    const errorColors = await prompt.getByRole('alert').evaluate(alert => {
      const root = document.documentElement;
      const wasDark = root.classList.contains('dark');
      const swatch = document.createElement('span');
      swatch.style.color = 'var(--danger)';
      alert.append(swatch);
      try {
        return [false, true].map(dark => {
          root.classList.toggle('dark', dark);
          return [getComputedStyle(alert).color, getComputedStyle(swatch).color];
        });
      } finally {
        root.classList.toggle('dark', wasDark);
        swatch.remove();
      }
    });
    for (const [actual, expected] of errorColors) assert.equal(actual, expected);
    assert.notEqual(errorColors[0][0], errorColors[1][0]);
    await page.keyboard.type('demo-key');
    await prompt.getByRole('button', { name: /显示.*密钥/ }).click();
    await prompt.locator('[data-api-key-field] input[type=text]').waitFor();
    await prompt.getByRole('button', { name: /隐藏.*密钥/ }).click();
    await prompt.locator('[data-api-key-field] input[type=password]').waitFor();
    await prompt.getByRole('button', { name: '验证并保存', exact: true }).click();
    await qwen.getByRole('button', { name: /^移除密钥/ }).waitFor();
    await active.getByRole('button', { name: '启用', exact: true }).click();
    await expectDetails(active, 'deepseek', true);
    await settings.getByRole('button', { name: '关闭设置', exact: true }).click();
    const menu = await openModelMenu(page);
    await menu.getByRole('menuitem', { name: '刷新模型列表', exact: true }).click();
    for (const name of ['DeepSeek-V4.1-Flash', 'DeepSeek-V4-Pro'])
      await menu.getByRole('menuitemradio', { name, exact: true }).waitFor();
    await menu.getByRole('menuitem', { name: '刷新模型列表', exact: true }).waitFor();
    await page.keyboard.press('Escape');
    await checkInterviewBilling('DeepSeek API计费', 'VoxCue-1.3.0-API-billing');
    await openSettings();
    await active.getByRole('button', { name: '禁用', exact: true }).waitFor();
    await settings.locator('#api-settings-deepseek').getByRole('button', { name: /更换.*密钥/ }).waitFor();
  }
  if (await settings.getByRole('button', { name: /^移除密钥/ }).count() !== 8)
    throw Error('八家模拟服务尚未全部配置。');
  await qwen.getByRole('button', { name: '启用', exact: true }).click();
  await qwen.getByRole('button', { name: '禁用', exact: true }).waitFor();
  await expectDetails(qwen, 'qwen', true);
  let displayed = qwen;
  if (check) {
    await selectedRegionWidth('弗吉尼亚');
    await qwen.getByRole('button', { name: '更换密钥', exact: true }).click();
    const replace = page.getByRole('dialog', { name: '更换 API 密钥', exact: true });
    const field = replace.getByLabel('通义千问 API 密钥', { exact: true }).and(replace.locator('input'));
    await field.waitFor();
    assert.ok(await field.evaluate(input => input.validity.valueMissing && !input.placeholder));
    assert.equal(await replace.locator('.dialog-subtitle').count(), 0);
    await replace.getByRole('button', { name: '取消', exact: true }).click();
    await replace.waitFor({ state: 'hidden' });
    displayed = settings.getByRole('group', { name: 'Claude API', exact: true });
    await displayed.getByRole('button', { name: '启用', exact: true }).click();
    await expectDetails(displayed, 'anthropic', true);
    const workspace = await displayed.locator('.api-routing-fields > label:only-child input').evaluate(input => {
      const detail = input.closest('.api-service-details');
      const standard = parseFloat(getComputedStyle(input).getPropertyValue('--settings-control-width'));
      function measure() {
        const field = input.getBoundingClientRect();
        const label = input.closest('label').firstElementChild.getBoundingClientRect();
        const card = detail.querySelector('.api-usage').getBoundingClientRect();
        return {
          aligned: Math.abs(label.left - card.left) <= 1 && Math.abs(field.right - card.right) <= 1
            && label.top < field.bottom && field.top < label.bottom,
          gap: field.left - label.right,
          width: field.width,
        };
      }
      const wide = measure(), previous = detail.style.width;
      try {
        detail.style.width = '280px';
        return { standard, wide, narrow: measure() };
      } finally {
        detail.style.width = previous;
      }
    });
    assert.ok(workspace.wide.aligned && workspace.wide.gap >= 32
      && Math.abs(workspace.wide.width - workspace.standard) <= 1, 'Claude uses a standard input at the far right');
    assert.ok(workspace.narrow.aligned && workspace.narrow.gap >= 0
      && workspace.narrow.width > 0 && workspace.narrow.width < workspace.wide.width, 'Narrow Claude input shrinks without overlapping its label');
    await settings.getByRole('button', { name: '关闭设置', exact: true }).click();
    const claudeMenu = await openModelMenu(page);
    await claudeMenu.getByRole('menuitemradio', { name: 'Claude Opus 5.5', exact: true }).waitFor();
    await page.keyboard.press('Escape');
    await checkInterviewBilling('Claude API计费');
    if (!checkOnly) {
      await openSettings();
      await expectDetails(displayed, 'anthropic', true);
    }
  }
  if (checkOnly) {
    await checkProviderLogos();
    console.log('API settings interaction checks passed.');
  } else {
    await displayed.evaluate(row => row.scrollIntoView({ block: 'center', behavior: 'instant' }));
    await (await app.browserWindow(page)).evaluate(win => win.setTitle('VoxCue · API 密钥模拟预览'));
    console.log(
      `API_PREVIEW_READY — 8 家已配置，${await displayed.getAttribute('aria-label')} 已启用并展开。余额和回复均为模拟数据。可使用 demo-key 试填。关闭主窗口后自动清理。`,
    );
    await page.waitForEvent('close', { timeout: 0 });
  }
}
try {
  await runPreview();
} finally {
  await closeUiApp(app);
}
