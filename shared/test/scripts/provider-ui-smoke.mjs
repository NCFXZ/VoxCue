import { connectUiAccount } from './install-ui-account.mjs';
import { testRoot, electron } from './test-workspace.mjs';

import { mkdir, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { installUiAccount, closeUiApp } from './install-ui-account.mjs';
import { offlineElectronEntry } from './offline-electron-entry.mjs';

await mkdir(path.join(testRoot, 'test/results'), { recursive: true });
const directory = await mkdtemp(path.resolve(path.join(testRoot, 'test/results/provider-ui-')));
const app = await electron.launch({
  args: [await offlineElectronEntry()],
  env: { ...process.env, COPILOT_TEST_USER_DATA: directory, VITE_DEV_SERVER_URL: '' },
});
const checks = [],
  errors = [];
try {
  await installUiAccount(app, { speech: true, components: true });
  await app.evaluate(({ app, systemPreferences }) => {
    systemPreferences.getAccentColor = () => '8764b8ff';
    const require = process
      .getBuiltinModule('module')
      .createRequire(app.getAppPath() + '/package.json');
    const { ChatGPTService } = require(
      app.getAppPath() + '/dist-electron/shared/electron/backend/chat/service.js',
    );
    const providers = [
      { id: 'chatgpt', name: 'ChatGPT', dataRecipient: 'OpenAI' },
      { id: 'synthetic-other', name: '合成提供商', dataRecipient: '合成服务公司' },
    ];
    ChatGPTService.prototype.models = async () =>
      providers.map((provider, i) => ({
        id: 'provider-model-' + i,
        label: i ? '其他测试模型' : '账户测试模型',
        description: '',
        reasoningEfforts: ['low'],
        provider,
      }));
    ChatGPTService.prototype.stream = async (request, emit, signal) => {
      signal.throwIfAborted();
      const provider = providers[request.modelId.endsWith('1') ? 1 : 0];
      const answerText = provider.name + '的合成回答';
      emit({ id: request.id, type: 'delta', text: answerText });
      return { provider, answerText, usage: null, sources: [] };
    };
  });
  const login = await app.firstWindow();
  const page = await connectUiAccount(app, login);
  page.setDefaultTimeout(15000);
  page.on('pageerror', (error) => errors.push(error.message));
  const input = page.getByRole('textbox', { name: '聊天消息', exact: true });
  const send = page.getByRole('button', { name: '发送消息', exact: true });
  await page.getByRole('button', { name: '聊天模型', exact: true }).waitFor();
  assert.equal(await page.getByText('ChatGPT 可用', { exact: true }).count(), 0);
  const openSettings = async () => {
    await page.getByRole('button', { name: '用户菜单', exact: true }).click();
    await page.getByRole('menuitem', { name: '设置', exact: true }).click();
    await page
      .getByRole('navigation', { name: '设置分类' })
      .getByRole('button', { name: '通用', exact: true })
      .click();
  };
  const chooseModel = async (label) => {
    await page.getByRole('button', { name: '聊天模型', exact: true }).click();
    await page.getByRole('menuitemradio', { name: label, exact: true }).click();
  };
  const sendAppearance = async (window, name, size = 36) => {
    await window.mouse.move(0, 0);
    const button = window.getByRole('button', { name, exact: true });
    await button.waitFor();
    await window.waitForFunction((name) => {
      const button = document.querySelector('[aria-label="' + name + '"]');
      return button && getComputedStyle(button).backgroundColor === 'rgb(135, 100, 184)';
    }, name);
    const style = await button.evaluate((element) => {
      const rect = element.getBoundingClientRect(),
        style = getComputedStyle(element);
      const icon = element.querySelector('svg').getBoundingClientRect();
      return {
        width: rect.width,
        height: rect.height,
        radius: style.borderRadius,
        color: style.color,
        iconWidth: Math.round(icon.width * 100) / 100,
        iconHeight: Math.round(icon.height * 100) / 100,
      };
    });
    assert.deepEqual(style, {
      width: size,
      height: size,
      radius: '50%',
      color: 'rgb(255, 255, 255)',
      iconWidth: 20,
      iconHeight: 20,
    });
    if (name === '发送消息') {
      assert.equal(await window.getByRole('button', { name: '语音输入', exact: true }).count(), 0);
    }
    await window.waitForFunction((name) => {
      const button = document.querySelector('[aria-label="' + name + '"]');
      return button && (button.disabled || Number(getComputedStyle(button).opacity) >= 0.999);
    }, name);
    return button;
  };
  assert.equal(await send.isDisabled(), true);
  await openSettings();
  assert.equal(await page.getByRole('button', { name: '主题色', exact: true }).count(), 0);
  await app.evaluate(({ BrowserWindow }) => {
    for (const win of BrowserWindow.getAllWindows())
      win.webContents.send('appearance:accent-changed', '#8764b8');
  });
  await page.getByRole('button', { name: '关闭设置', exact: true }).click();
  await input.fill('第一条合成提问');
  await sendAppearance(page, '发送消息');
  await page.locator('.composer').screenshot({});
  await send.click();
  await page.locator('.chat-answer').getByText('ChatGPT的合成回答', { exact: true }).waitFor();
  await send.waitFor();
  await chooseModel('其他测试模型');
  await page
    .getByRole('button', { name: '聊天模型', exact: true })
    .getByText('其他测试模型', { exact: true })
    .waitFor();
  assert.equal(await page.locator('.simulation-disclaimer').count(), 0);
  await page.getByRole('button', { name: '添加附件', exact: true }).click();
  assert.equal(await page.locator('.attachment-menu-hint').count(), 0);
  await page.getByRole('menuitem', { name: '添加文件', exact: true }).waitFor();
  await page.getByRole('menuitem', { name: '添加文件夹', exact: true }).waitFor();
  assert.equal(
    await page.getByRole('menuitemcheckbox', { name: '网络搜索', exact: true }).count(),
    0,
  );
  await page.keyboard.press('Escape');
  await input.fill('第二条合成提问');
  await send.click();
  await page.locator('.chat-answer').getByText('合成提供商的合成回答', { exact: true }).waitFor();
  await send.waitFor();
  assert.deepEqual(await page.locator('.answer-label strong').allTextContents(), [
    'ChatGPT',
    '合成提供商',
  ]);
  await chooseModel('账户测试模型');
  assert.deepEqual(await page.locator('.answer-label strong').allTextContents(), [
    'ChatGPT',
    '合成提供商',
  ]);
  await chooseModel('其他测试模型');
  checks.push(
    'provider metadata controls status, data recipient, and per-reply identity; changing model preserves old replies',
  );

  await page.getByRole('button', { name: '知识库', exact: true }).click();
  await page.getByRole('button', { name: '创建知识库', exact: true }).first().waitFor();
  assert.equal(await page.locator('.local-storage-note').count(), 0);
  await openSettings();
  const settings = page.getByRole('dialog', { name: '设置', exact: true });
  const category = (name) =>
    settings
      .getByRole('navigation', { name: '设置分类' })
      .getByRole('button', { name, exact: true });
  assert.equal(await category('知识库').count(), 0, 'Retired knowledge settings must not return');
  assert.equal(await settings.getByText(/按需查找需要账户模型支持/).count(), 0);
  assert.equal(await settings.getByText('高级诊断', { exact: true }).count(), 0);
  assert.equal(await settings.getByText(/必要片段会发送至/).count(), 0);
  await category('关于与更新').click();
  assert.equal(await settings.getByText(/通过聊天准备面试/).count(), 0);
  await category('面试设置').click();
  assert.equal(await settings.getByText('设置用于下一场面试。', { exact: true }).count(), 0);
  await settings.getByRole('button', { name: '面试回答模型', exact: true }).click();
  await settings.getByRole('menuitemradio', { name: '其他测试模型', exact: true }).click();
  await category('通用').click();
  await settings.getByRole('button', { name: '外观主题', exact: true }).click();
  await settings.getByRole('menuitemradio', { name: '深色', exact: true }).click();
  await page.getByRole('button', { name: '关闭设置', exact: true }).click();
  await page.getByRole('button', { name: '新对话', exact: true }).click();
  await sendAppearance(page, '发送消息');
  assert.equal(await send.isDisabled(), true);
  await input.fill('仅用于视觉检查');
  assert.equal(await send.isEnabled(), true);
  await sendAppearance(page, '发送消息');
  await page.locator('.composer').screenshot({});
  await input.fill('');
  checks.push(
    'requested settings explanations removed; circular send with 20px arrow, no chat dictation button, and unchanged enabled/disabled behavior in light/dark',
  );

  await page.locator('.interview-start-trigger').click();
  await page
    .getByRole('dialog', { name: '开始面试', exact: true })
    .getByText(/发送至 合成服务公司/)
    .waitFor();
  const [floating] = await Promise.all([
    app.waitForEvent('window'),
    page.getByRole('button', { name: '确认开始', exact: true }).click(),
  ]);
  floating.on('pageerror', (error) => errors.push(error.message));
  await floating
    .locator('.floating-answer-meta strong')
    .getByText('合成提供商', { exact: true })
    .waitFor();
  await sendAppearance(floating, '发送面试问题', 36);
  await floating.locator('.floating-composer').screenshot({});
  await floating.getByRole('button', { name: '结束面试', exact: true }).click();
  await Promise.all([
    floating.waitForEvent('close'),
    floating.getByRole('button', { name: '确认结束面试', exact: true }).click(),
  ]);
  await page.getByRole('button', { name: '面试记录', exact: true }).click();
  await page
    .locator('.history-row')
    .first()
    .locator('.history-row-open')
    .click({ position: { x: 16, y: 16 } });
  await page.getByRole('button', { name: 'AI 回答面板', exact: true }).click();
  await page
    .locator('.record-answer-content strong')
    .getByText('合成提供商', { exact: true })
    .waitFor();
  checks.push(
    'interview uses selected provider and send style; archived reply retains provider metadata',
  );
  assert.deepEqual(errors, []);
  await console.log(JSON.stringify({ checks, errors }, null, 2));
  console.log(JSON.stringify({ directory, checks, errors }));
} catch (error) {
  const page = app.windows().at(-1);
  if (page && !page.isClosed()) await page.screenshot({});
  throw error;
} finally {
  await closeUiApp(app);
}
