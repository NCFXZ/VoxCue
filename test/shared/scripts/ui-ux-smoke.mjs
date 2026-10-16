import { _electron as electron } from 'playwright';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { installUiAccount, closeUiApp } from './install-ui-account.mjs';

await mkdir('test/results', { recursive: true });
const profile = await mkdtemp(path.resolve('test/results/ui-ux-fixes-'));
const app = await electron.launch({
  args: ['.'],
  env: { ...process.env, COPILOT_TEST_USER_DATA: profile, VITE_DEV_SERVER_URL: '' },
});
const checks = [];
const errors = [];
try {
  await installUiAccount(app, { speech: true });
  await app.evaluate(({ app }) => {
    const require = process
      .getBuiltinModule('module')
      .createRequire(app.getAppPath() + '/package.json');
    const { ChatGPTService } = require(
      app.getAppPath() + '/dist-electron/shared/electron/backend/chat/service.js',
    );
    const { SpeechHost } = require(
      app.getAppPath() + '/dist-electron/shared/electron/backend/speech/host.js',
    );
    globalThis.delayedReady = new Promise((resolve) => {
      globalThis.resolveDelayedReady = resolve;
    });
    const devices = [
      { id: 'synthetic-output', source: 'system', name: 'Synthetic speaker', default: true },
      { id: 'synthetic-mic', source: 'microphone', name: 'Synthetic microphone', default: true },
    ];
    SpeechHost.prototype.call = async function (call) {
      if (call.op === 'start') {
        this.emit({ type: 'activity', source: 'system', speaking: true, level: 0.4 });
        this.emit({
          type: 'segment',
          segment: {
            id: 'ui-speech',
            source: 'system',
            text: '请介绍你的项目',
            final: true,
            startMs: 0,
            endMs: 1000,
            reason: 'silence',
          },
        });
      }
      return {
        state: call.op === 'start' ? 'running' : 'idle',
        model: 'Synthetic UI port',
        devices,
      };
    };
    ChatGPTService.prototype.models = async () => {
      if (globalThis.failModels) throw Error('Synthetic model list failure');
      return [
        {
          id: 'test-model',
          label: 'Test Model',
          description: '',
          provider: { id: 'chatgpt', name: 'ChatGPT', dataRecipient: 'OpenAI' },
          reasoningEfforts: ['low', 'high'],
        },
      ];
    };
    ChatGPTService.prototype.stream = async function (request, emit, signal) {
      if (request.id.startsWith('history-title-'))
        return { answerText: '项目经历与技术追问', sources: [], usage: null };
      if (globalThis.failNext) {
        globalThis.failNext = false;
        throw Error('Synthetic request failure');
      }
      const prompt = request.turns.at(-1)?.content ?? '';
      if (prompt.includes('延迟回答'))
        return new Promise((resolve) => {
          globalThis.finishDelayed = () => {
            emit({ id: request.id, type: 'delta', text: '迟到文字' });
            resolve({ answerText: '迟到终稿', sources: [], usage: null });
          };
          globalThis.resolveDelayedReady();
        });
      const answerText = prompt.includes('长回答')
        ? Array.from({ length: 70 }, (_, i) => `段落 ${i + 1}：这是用于滚动检查的合成回复。`).join(
            '\n\n',
          )
        : '**合成回答**\n\n项目背景、个人贡献与结果。';
      emit({ id: request.id, type: 'delta', text: answerText });
      return {
        answerText,
        provider: { id: 'chatgpt', name: 'ChatGPT', dataRecipient: 'OpenAI' },
        profileChanges: prompt.includes('资料提案')
          ? { language: 'English' }
          : prompt.includes('自定义指令')
            ? { customInstructions: '自然表达，清楚有逻辑' }
            : undefined,
        sources: [],
        usage: null,
      };
    };
  });
  const login = await app.firstWindow();
  const [page] = await Promise.all([
    app.waitForEvent('window'),
    login.getByRole('button', { name: '使用 ChatGPT 继续', exact: true }).click(),
  ]);
  page.setDefaultTimeout(20000);
  page.on('pageerror', (e) => errors.push(e.message));
  await page.getByRole('heading', { name: '今天想准备哪一部分面试？', exact: true }).waitFor();
  const message = page.getByRole('textbox', { name: '聊天消息', exact: true });
  const info = page.getByRole('button', { name: '个人信息', exact: true });
  assert.equal(
    await page
      .locator('.page-toolbar')
      .getByRole('button', { name: '回答风格', exact: true })
      .count(),
    0,
  );
  const panel = page.getByRole('complementary', { name: '个人信息', exact: true });
  const settings = async () => {
    await page.getByRole('button', { name: '用户菜单', exact: true }).click();
    await page.getByRole('menuitem', { name: '设置', exact: true }).click();
  };
  await settings();
  await page.getByRole('button', { name: '外观主题', exact: true }).click();
  await page.getByRole('menuitemradio', { name: '浅色', exact: true }).click();
  await page.getByRole('button', { name: '关闭设置', exact: true }).click();
  assert.equal(await page.locator('.nav-item.active').count(), 0);
  await page.getByText('保存在本机', { exact: true }).waitFor();
  await message.fill('未发送草稿 A');
  await page.getByLabel('添加聊天文件', { exact: true }).setInputFiles({
    name: 'draft.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('synthetic draft'),
  });
  await page.getByRole('button', { name: '新对话', exact: true }).click();
  assert.equal(await message.inputValue(), '');
  await message.fill('未发送草稿 B');
  await page
    .locator('.conversation-row')
    .filter({ hasText: '未发送草稿 A' })
    .locator('.conversation')
    .click();
  assert.equal(await message.inputValue(), '未发送草稿 A');
  assert.equal(await page.locator('.chat-attachment').count(), 1);
  checks.push('per-conversation drafts and attachments, new-chat semantics, session notice');
  if (!(await panel.isVisible())) await info.click();
  await panel.getByLabel('姓名', { exact: true }).fill('合成姓名');
  await page.getByRole('button', { name: '关闭个人信息', exact: true }).click();
  if (!(await panel.isVisible())) await info.click();
  assert.equal(await panel.getByLabel('姓名', { exact: true }).inputValue(), '合成姓名');
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    globalThis.restoreStorage = () => (Storage.prototype.setItem = original);
    Storage.prototype.setItem = function (k, v) {
      if (k === 'copilot-personal-info-v1') throw Error('Synthetic save failure');
      return original.call(this, k, v);
    };
  });
  await panel.getByRole('button', { name: '保存', exact: true }).click();
  await panel.getByRole('alert').waitFor();
  assert.equal(await panel.getByLabel('姓名', { exact: true }).inputValue(), '合成姓名');
  await page.evaluate(() => globalThis.restoreStorage());
  await panel.getByRole('button', { name: '保存', exact: true }).click();
  await panel.locator('.personal-save-bar').waitFor({ state: 'hidden' });
  await panel.getByLabel('姓名', { exact: true }).fill('未保存的另一姓名');
  await page.getByRole('button', { name: '关闭个人信息', exact: true }).click();
  await page.getByRole('button', { name: '新对话', exact: true }).click();
  await message.fill('更新个人资料提案');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await page.getByRole('button', { name: '确认更新', exact: true }).click();
  if (!(await panel.isVisible())) await info.click();
  await panel.getByText('基本信息已有更新', { exact: true }).waitFor();
  assert.equal(await panel.getByRole('button', { name: '保存', exact: true }).isDisabled(), true);
  await panel.getByRole('button', { name: '载入最新资料', exact: true }).click();
  assert.equal(await panel.getByLabel('姓名', { exact: true }).inputValue(), '合成姓名');
  assert.equal(
    await panel.getByRole('button', { name: '面试语言', exact: true }).innerText(),
    'English',
  );
  await page.getByRole('button', { name: '关闭个人信息', exact: true }).click();
  if (!(await panel.isVisible())) await info.click();
  const instructions = panel.getByRole('region', { name: '自定义指令', exact: true });
  await instructions.getByRole('button', { name: '编辑', exact: true }).click();
  const editor = page.getByRole('region', { name: '编辑自定义指令', exact: true });
  await editor.getByLabel('自定义指令内容', { exact: true }).fill('自然表达，清楚有逻辑');
  await editor.getByRole('button', { name: '保存', exact: true }).click();
  if (!(await panel.isVisible())) await info.click();
  await instructions.getByText('自然表达，清楚有逻辑', { exact: true }).waitFor();
  assert.equal(await instructions.getByText(/\d+\/10/).count(), 0);
  assert.equal(await panel.getByLabel('目标岗位', { exact: true }).count(), 0);
  await panel.getByLabel('姓名', { exact: true }).fill('窄窗草稿');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(960, 680));
  await page.waitForFunction(() => innerWidth <= 970);
  assert.equal(await panel.evaluate((e) => getComputedStyle(e).position), 'absolute');
  await page.screenshot({
    path: path.join(profile, 'personal-narrow-light.png'),
    animations: 'disabled',
  });
  const saveGeometry = await panel.locator('.personal-save-bar').evaluate((e) => {
    const r = e.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, viewport: innerHeight };
  });
  assert(
    saveGeometry.top >= 0 && saveGeometry.bottom <= saveGeometry.viewport,
    JSON.stringify(saveGeometry),
  );
  await page.getByRole('button', { name: '关闭个人信息', exact: true }).click();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1280, 800));
  checks.push(
    'personal drafts, direct single instruction editing, save failure recovery, concurrent profile update, sticky save and narrow drawer',
  );
  await settings();
  assert.equal(await page.getByRole('button', { name: '调整聊天模型', exact: true }).count(), 0);
  assert.equal(await page.getByRole('button', { name: '调整回答风格', exact: true }).count(), 0);
  await page
    .getByRole('button', { name: '主题色', exact: true })
    .getByText('跟随系统', { exact: true })
    .waitFor();
  await page.getByRole('button', { name: '主题色', exact: true }).click();
  await page.getByRole('menuitemradio', { name: '紫色', exact: true }).click();
  await page.waitForFunction(
    () => document.documentElement.style.getPropertyValue('--system-accent') === '#8764b8',
  );
  await page.screenshot({
    path: path.join(profile, 'settings-accent-light.png'),
    animations: 'disabled',
  });
  await page.getByRole('button', { name: '关闭设置', exact: true }).click();
  await app.evaluate(() => {
    globalThis.failModels = true;
  });
  await page.getByRole('button', { name: '聊天模型', exact: true }).click();
  await page.getByRole('menuitem', { name: '刷新模型列表', exact: true }).click();
  await page.getByText('账户已授权 · 模型不可用', { exact: true }).waitFor();
  await app.evaluate(() => {
    globalThis.failModels = false;
  });
  await page
    .locator('.preparation-workspace')
    .getByRole('button', { name: '重新加载模型', exact: true })
    .click();
  await page.getByText('ChatGPT 可用', { exact: true }).waitFor();
  await app.evaluate(() => {
    globalThis.failNext = true;
  });
  await message.fill('失败的问题');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await page.getByRole('button', { name: '重试回答', exact: true }).waitFor();
  const users = await page.locator('.chat-message.user').count();
  await page.getByRole('button', { name: '重试回答', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('[aria-label="停止回复"]'));
  assert.equal(await page.locator('.chat-message.user').count(), users);
  checks.push(
    'removed settings shortcuts, system/default and chosen accent, truthful model state and retry, inline answer retry without duplicate question',
  );
  await message.fill('长回答');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await page.waitForFunction(
    () =>
      document.querySelector('.chat-scroll')?.scrollHeight > 2000 &&
      !document.querySelector('[aria-label="停止回复"]'),
  );
  await page.locator('.chat-scroll').evaluate((e) => {
    e.scrollTop = 0;
    e.dispatchEvent(new Event('scroll'));
  });
  await page.getByRole('button', { name: '返回最新回复', exact: true }).waitFor();
  await message.fill('新的问题');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await page.getByRole('button', { name: '有新回复 · 返回最新', exact: true }).click();
  assert.equal(
    await page
      .locator('.chat-scroll')
      .evaluate((e) => e.scrollHeight - e.scrollTop - e.clientHeight < 48),
    true,
  );
  await assert.rejects(
    () => page.evaluate(() => window.desktop.updateSessionState({ text: 'invalid' })),
    /Invalid session state/,
  );
  await app.evaluate(({ dialog }) => {
    globalThis.closeObserved = new Promise((r) => (globalThis.resolveClose = r));
    dialog.showMessageBox = async (_win, options) => {
      globalThis.closeOptions = options;
      globalThis.resolveClose();
      return { response: 0 };
    };
  });
  await page.evaluate(() => window.desktop.windowAction('close'));
  await app.evaluate(async () => await globalThis.closeObserved);
  assert.equal(await app.evaluate(() => globalThis.closeOptions.defaultId), 0);
  assert.equal(page.isClosed(), false);
  checks.push(
    'new-content navigation and native close cancellation, typed session state validation',
  );
  await page.getByRole('button', { name: '面试记录', exact: true }).click();
  const marker = await page.locator('.nav-item.active').evaluate((element) => {
    const style = getComputedStyle(element, '::before');
    return {
      height: parseFloat(style.height),
      width: parseFloat(style.width),
      left: parseFloat(style.left),
      radius: parseFloat(style.borderRadius),
      row: element.clientHeight,
      shadow: getComputedStyle(element).boxShadow,
    };
  });
  assert(
    marker.height < marker.row &&
      marker.height === 18 &&
      marker.width === 3 &&
      marker.left > 0 &&
      marker.radius >= marker.width &&
      marker.shadow === 'none',
    JSON.stringify(marker),
  );
  await page.screenshot({
    path: path.join(profile, 'sidebar-selection-light.png'),
    animations: 'disabled',
  });
  await page.evaluate(() => {
    const now = Date.now();
    localStorage.setItem(
      'copilot-interview-history-v1',
      JSON.stringify(
        ['项目面试', '行为面试'].map((title, i) => ({
          id: 'filter-' + i,
          title,
          startedAt: now - i * 86400000,
          endedAt: now - i * 86400000 + 60000,
          status: 'ended',
          transcripts: [],
          answers: [],
          mock: false,
          titleStatus: 'ready',
        })),
      ),
    );
    window.dispatchEvent(new StorageEvent('storage', { key: 'copilot-interview-history-v1' }));
  });
  await page.getByLabel('搜索标题', { exact: true }).fill('行为');
  assert.equal(await page.locator('.history-row').count(), 1);
  assert.equal(await page.getByLabel('开始日期', { exact: true }).count(), 0);
  assert.equal(await page.getByLabel('结束日期', { exact: true }).count(), 0);
  await page.getByLabel('搜索标题', { exact: true }).fill('不存在的标题');
  await page.getByText('没有符合条件的面试记录。', { exact: true }).waitFor();
  await page.getByRole('button', { name: '清除筛选', exact: true }).click();
  assert.equal(await page.locator('.history-row').count(), 2);
  assert.equal(await page.getByText('中文（简体）', { exact: false }).count(), 0);
  await page.locator('.history-row').filter({ hasText: '项目面试' }).click();
  await page.getByRole('button', { name: '重命名标题', exact: true }).click();
  const rename = page.getByRole('dialog', { name: '重命名标题', exact: true });
  await rename.getByLabel('记录标题', { exact: true }).fill('');
  assert.equal(
    await rename.getByRole('button', { name: '保存标题', exact: true }).isDisabled(),
    true,
  );
  await rename.getByLabel('记录标题', { exact: true }).fill('合成的专业技术交流');
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    globalThis.restoreHistoryStorage = () => (Storage.prototype.setItem = original);
    Storage.prototype.setItem = function (key, value) {
      if (key === 'copilot-interview-history-v1') throw Error('Synthetic storage failure');
      return original.call(this, key, value);
    };
  });
  await rename.getByRole('button', { name: '保存标题', exact: true }).click();
  await rename.getByRole('alert').waitFor();
  assert.equal(
    await rename.getByLabel('记录标题', { exact: true }).inputValue(),
    '合成的专业技术交流',
  );
  await page.evaluate(() => globalThis.restoreHistoryStorage());
  await rename.getByRole('button', { name: '保存标题', exact: true }).click();
  await page.getByRole('heading', { name: '合成的专业技术交流', exact: true }).waitFor();
  assert.equal(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem('copilot-interview-history-v1')).find(
          (record) => record.id === 'filter-0',
        ).titleSource,
    ),
    'manual',
  );
  await page.getByRole('button', { name: '返回面试记录', exact: true }).click();
  await page.getByLabel('搜索标题', { exact: true }).fill('专业技术');
  assert.equal(await page.locator('.history-row').count(), 1);
  await page.screenshot({
    path: path.join(profile, 'history-search-light.png'),
    animations: 'disabled',
  });
  await page.getByRole('button', { name: '知识库', exact: true }).click();
  await page.getByRole('button', { name: '＋ 创建知识库', exact: true }).first().click();
  await page.getByLabel('知识库名称', { exact: true }).fill('合成资料');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  const base = page.getByRole('dialog', { name: '合成资料', exact: true });
  assert.equal(await base.getByRole('button', { name: '检索方式', exact: true }).count(), 0);
  await base.getByLabel('导入知识库文档', { exact: true }).setInputFiles({
    name: 'notes.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from('Synthetic user interface document.'),
  });
  await base.locator('.upload-dropzone.is-compact').waitFor();
  await base
    .getByText(/原件已保存/)
    .first()
    .waitFor();
  await base.getByRole('button', { name: '高级选项', exact: true }).click();
  await base.getByRole('button', { name: '检索方式', exact: true }).waitFor();
  await base.getByRole('button', { name: '关闭对话框', exact: true }).click();
  checks.push(
    'title-only history search, rename persistence and save failure recovery, no invented language label, compact document import and advanced retrieval options',
  );
  await page.getByRole('button', { name: '新对话', exact: true }).click();
  await page.getByRole('button', { name: '开始面试', exact: true }).click();
  await page.getByRole('button', { name: '前往面试设置', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '设置', exact: true });
  assert.equal(
    await dialog
      .getByRole('button', { name: '面试设置', exact: true })
      .getAttribute('aria-current'),
    'page',
  );
  await page.getByRole('button', { name: '麦克风设备', exact: true }).click();
  await page.getByRole('menuitemradio', { name: '不使用麦克风', exact: true }).click();
  await page.getByRole('button', { name: '关闭设置', exact: true }).click();
  await page.getByRole('dialog', { name: '开始面试', exact: true }).waitFor();
  const [floating] = await Promise.all([
    app.waitForEvent('window'),
    page.getByRole('button', { name: '确认开始', exact: true }).click(),
  ]);
  floating.setDefaultTimeout(20000);
  floating.on('pageerror', (e) => errors.push(e.message));
  await floating.waitForFunction(
    () => document.documentElement.style.getPropertyValue('--system-accent') === '#8764b8',
  );
  await page.evaluate(() => {
    localStorage.setItem('copilot-accent-color-v1', '#008c95');
    window.dispatchEvent(new Event('voxcue-accent-changed'));
  });
  await floating.waitForFunction(
    () => document.documentElement.style.getPropertyValue('--system-accent') === '#008c95',
  );
  await floating.getByRole('status').filter({ hasText: '语音模型已就绪' }).waitFor();
  assert.equal(await floating.locator('.floating-toolbar [role="status"]').count(), 0);
  assert.equal(await floating.getByLabel('音频输入状态', { exact: true }).count(), 0);
  await assert.rejects(
    () => floating.evaluate(() => window.desktop.updateSessionState(true)),
    /Unauthorized window/,
  );
  await floating.getByRole('button', { name: '静音后自动提交完整问题', exact: true }).click();
  await floating.getByLabel('面试提问', { exact: true }).fill('延迟回答');
  await floating.getByRole('button', { name: '发送面试问题', exact: true }).click();
  await app.evaluate(async () => await globalThis.delayedReady);
  await floating.getByRole('button', { name: '停止当前回答', exact: true }).click();
  await app.evaluate(() => globalThis.finishDelayed?.());
  await floating.getByText('已停止', { exact: true }).waitFor();
  assert.equal(await floating.getByText('迟到终稿', { exact: true }).count(), 0);
  await floating.getByRole('button', { name: '重试面试回答', exact: true }).waitFor();
  await floating.getByLabel('面试提问', { exact: true }).fill('介绍项目');
  await floating.getByRole('button', { name: '发送面试问题', exact: true }).click();
  await floating.getByRole('button', { name: '复制面试回答', exact: true }).last().waitFor();
  await floating.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: async (text) => {
          globalThis.copiedAnswer = text;
        },
      },
      configurable: true,
    });
  });
  await floating.getByRole('button', { name: '复制面试回答', exact: true }).last().click();
  await floating.getByText('已复制回答', { exact: true }).waitFor();
  assert(
    (await floating
      .locator('.floating-answer-meta')
      .getByText('ChatGPT', { exact: true })
      .count()) > 0,
  );
  const bounds = () =>
    app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((w) => w.webContents.getURL().endsWith('#interview'))
        .getBounds(),
    );
  const before = await bounds();
  await floating.getByRole('button', { name: '拖动右下角调整尺寸', exact: true }).focus();
  await floating.keyboard.press('ArrowRight');
  await floating.waitForFunction((width) => innerWidth > width + 2, before.width);
  assert((await bounds()).width > before.width);
  await floating.screenshot({
    path: path.join(profile, 'floating-light.png'),
    animations: 'disabled',
  });
  await floating.getByRole('button', { name: '收起面试窗口', exact: true }).click();
  assert.equal(await floating.locator('.floating-panels').isHidden(), true);
  await floating.screenshot({
    path: path.join(profile, 'floating-collapsed.png'),
    animations: 'disabled',
  });
  await floating.getByRole('button', { name: '展开面试窗口', exact: true }).click();
  await floating.getByRole('button', { name: '结束面试', exact: true }).click();
  await Promise.all([
    floating.waitForEvent('close'),
    floating.getByRole('button', { name: '确认结束面试', exact: true }).click(),
  ]);
  checks.push(
    'read-only start/settings return, speech model readiness beside transcript title, no brand activity status, stop answer without stopping capture, provider/copy feedback, keyboard resize, collapse and end',
  );
  await settings();
  await page.getByRole('button', { name: '外观主题', exact: true }).click();
  await page.getByRole('menuitemradio', { name: '深色', exact: true }).click();
  await page.getByRole('button', { name: '关闭设置', exact: true }).click();
  await page.screenshot({ path: path.join(profile, 'main-dark.png'), animations: 'disabled' });
  await page.getByRole('button', { name: '用户菜单', exact: true }).click();
  await page.getByRole('menuitem', { name: '退出登录', exact: true }).click();
  assert.equal(
    await page
      .getByRole('dialog', { name: '退出登录', exact: true })
      .getByRole('button', { name: '取消', exact: true })
      .evaluate((e) => e === document.activeElement),
    true,
  );
  await page
    .getByRole('dialog', { name: '退出登录', exact: true })
    .getByRole('button', { name: '取消', exact: true })
    .click();
  await page.getByRole('button', { name: '用户菜单', exact: true }).click();
  await page.getByRole('menuitem', { name: '退出登录', exact: true }).click();
  const [returnedLogin] = await Promise.all([
    app.waitForEvent('window'),
    page.getByRole('button', { name: '确认退出登录', exact: true }).click(),
  ]);
  await returnedLogin.getByRole('heading', { name: '欢迎使用 VoxCue', exact: true }).waitFor();
  await returnedLogin.waitForFunction(
    () => document.documentElement.style.getPropertyValue('--system-accent') === '#008c95',
  );
  checks.push('accent synchronizes between main/floating windows and persists into login');
  assert.deepEqual(errors, []);
  await writeFile(
    path.join(profile, 'report.json'),
    JSON.stringify(
      {
        checks,
        errors,
        scope:
          'Synthetic account, devices, replies and documents; no live account/audio quality claim',
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ profile, checks, errors }));
} finally {
  await closeUiApp(app);
}
