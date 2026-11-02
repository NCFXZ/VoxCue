import { connectUiAccount } from './install-ui-account.mjs';
import { testRoot, electron } from './test-workspace.mjs';

import { mkdir, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { installUiAccount, closeUiApp } from './install-ui-account.mjs';
await mkdir(path.join(testRoot, 'test/results'), { recursive: true });
const directory = await mkdtemp(path.resolve(path.join(testRoot, 'test/results/chat-lifecycle-')));
let app, page;
const errors = [],
  checks = [];
async function launch() {
  app = await electron.launch({
    args: ['.'],
    env: { ...process.env, COPILOT_TEST_USER_DATA: directory, VITE_DEV_SERVER_URL: '' },
  });
  await installUiAccount(app, { speech: true });
  await app.evaluate(({ app, dialog }) => {
    const require = process
      .getBuiltinModule('module')
      .createRequire(app.getAppPath() + '/package.json');
    const { ChatGPTService } = require(
      app.getAppPath() + '/dist-electron/shared/electron/backend/chat/service.js',
    );
    globalThis.requests = [];
    dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
    ChatGPTService.prototype.stream = async (request, emit, signal) => {
      globalThis.requests.push({
        webSearch: request.webSearch,
        profileTask: request.profileTask,
        prompt: request.turns.at(-1).content,
        fileBytes: request.turns.at(-1).files?.map((file) => [...file.bytes]),
      });
      const prompt = request.turns.at(-1).content;
      let changes = {};
      if (prompt.includes('更新简历')) {
        emit({ id: request.id, type: 'delta', text: '正在整理提案。' });
        emit({
          id: request.id,
          type: 'profile-preview',
          preview: { background: '简历摘要第一部分' },
        });
        await new Promise((resolve) => {
          globalThis.releasePreview = resolve;
        });
        signal.throwIfAborted();
        emit({
          id: request.id,
          type: 'profile-preview',
          preview: { background: '简历摘要第一部分\n项目与专业技能第二部分' },
        });
        await new Promise((resolve) => {
          globalThis.finishPreview = resolve;
        });
        signal.throwIfAborted();
        changes = { background: '简历摘要第一部分\n项目与专业技能第二部分' };
      } else if (prompt.includes('更新JD'))
        changes = { jobDescription: '已确认的 JD：软件工程与技术沟通。' };
      else if (request.profileTask === 'skills') changes = { skills: [] };
      return {
        answerText: '合成回复已完成。',
        profileChanges: changes,
        reasoningSummary: '公开摘要',
        provider: { id: 'chatgpt', name: 'ChatGPT', dataRecipient: 'OpenAI' },
        sources: [],
        usage: null,
      };
    };
  });
  const login = await app.firstWindow();
  page = await connectUiAccount(app, login);
  page.setDefaultTimeout(15000);
  page.on('pageerror', (error) => errors.push(error.message));
  await page.getByRole('textbox', { name: '聊天消息', exact: true }).waitFor();
  await page.waitForFunction(() => !document.querySelector('[aria-label="聊天消息"]').disabled);
}
async function closeNormally() {
  const closed = page.waitForEvent('close');
  const applicationClosed = process.platform === 'darwin' ? undefined : app.waitForEvent('close');
  await page.evaluate(() => window.desktop.windowAction('close'));
  await closed;
  // The Mac app remains resident after its last window closes; restart means quit.
  if (process.platform === 'darwin') await closeUiApp(app);
  else await applicationClosed;
  app = undefined;
}
const input = () => page.getByRole('textbox', { name: '聊天消息', exact: true });
const send = () => page.getByRole('button', { name: '发送消息', exact: true });
const proposals = () =>
  page.locator('.chat-message').getByRole('region', { name: '待确认的资料更新', exact: true });
try {
  await launch();
  assert.equal(
    await page.evaluate(() =>
      window.desktop.finishSessionClose('invalid', true).then(
        () => false,
        () => true,
      ),
    ),
    true,
  );
  await input().fill('普通聊天需要保留');
  await page.getByLabel('添加聊天文件', { exact: true }).setInputFiles({
    name: 'sent.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('sent attachment'),
  });
  await send().click();
  await page.locator('.chat-answer').getByText('合成回复已完成。', { exact: true }).waitFor();
  await send().waitFor();
  await page.getByRole('button', { name: '新对话', exact: true }).click();
  await input().fill('更新简历');
  await send().click();
  const preview = page.getByRole('region', { name: '正在生成的资料提案', exact: true });
  await preview.getByText('简历摘要第一部分', { exact: true }).waitFor();
  assert.equal(
    await preview.getByRole('button', { name: '保存所选', exact: true }).isDisabled(),
    true,
  );
  assert.equal(await page.evaluate(() => localStorage.getItem('copilot-personal-info-v1')), null);
  await app.evaluate(() => globalThis.releasePreview());
  await preview.getByText(/项目与专业技能第二部分/).waitFor();
  await page.screenshot({});
  await app.evaluate(() => globalThis.finishPreview());
  await proposals().last().getByRole('button', { name: '保存所选', exact: true }).click();
  await proposals().last().getByText('已保存所选资料', { exact: true }).waitFor();
  assert.equal(await page.locator('.preparation-guide').count(), 0);
  await page.getByRole('button', { name: '新对话', exact: true }).click();
  await page.locator('.preparation-guide').getByText('接下来想做什么？', { exact: true }).waitFor();
  const count = await app.evaluate(() => globalThis.requests.length);
  await page
    .locator('.preparation-guide')
    .getByRole('button', { name: '添加职位描述', exact: true })
    .click();
  assert.match(await input().inputValue(), /职位描述/);
  assert.equal(await app.evaluate(() => globalThis.requests.length), count);
  await input().fill('更新JD：岗位需要软件开发和专业沟通');
  await send().click();
  await proposals().last().getByRole('button', { name: '保存所选', exact: true }).click();
  await proposals().last().getByText('已保存所选资料', { exact: true }).waitFor();
  assert.equal(await page.locator('.preparation-guide').count(), 0);
  await page.getByRole('button', { name: '新对话', exact: true }).click();
  const updateSkills = page
    .locator('.preparation-guide')
    .getByRole('button', { name: '生成技能', exact: true });
  assert.equal(await updateSkills.isEnabled(), true);
  await updateSkills.click();
  await send().waitFor();
  assert.deepEqual(
    await app.evaluate(() => {
      const r = globalThis.requests.at(-1);
      return { webSearch: r.webSearch, profileTask: r.profileTask };
    }),
    { webSearch: true, profileTask: 'skills' },
  );
  checks.push(
    'live proposal grows before completion, confirmation locked; missing JD has an actionable explanation and skills enable after confirmation',
  );
  const draftTitle = await page
    .locator('.conversation-row.active .conversation > span')
    .last()
    .innerText();

  await input().fill('重启之后保留这个草稿');
  await page.getByLabel('添加聊天文件', { exact: true }).setInputFiles({
    name: 'draft.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('draft attachment'),
  });
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    window.chatWriteFailures = 0;
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === 'state') {
        window.chatWriteFailures++;
        throw Error('synthetic storage failure');
      }
      return original.apply(this, args);
    };
    window.restoreChatWrites = () => {
      IDBObjectStore.prototype.put = original;
    };
  });
  await input().fill('保存失败也不能丢掉的草稿');
  await page.getByRole('button', { name: '重试保存聊天', exact: true }).waitFor();
  const failures = await page.evaluate(() => window.chatWriteFailures);
  await page.evaluate(() => window.desktop.windowAction('close'));
  await page.waitForFunction((before) => window.chatWriteFailures > before, failures);
  assert.equal(page.isClosed(), false);
  await page.evaluate(() => window.restoreChatWrites());
  await page.getByRole('button', { name: '重试保存聊天', exact: true }).click();
  await page
    .getByRole('button', { name: '重试保存聊天', exact: true })
    .waitFor({ state: 'detached' });
  await closeNormally();
  await launch();
  assert.equal(await input().inputValue(), '保存失败也不能丢掉的草稿');
  await page.locator('.chat-attachment').getByText('draft.txt', { exact: false }).waitFor();
  await page
    .locator('.conversation-row')
    .filter({ hasText: '普通聊天需要保留' })
    .locator('.conversation')
    .click();
  await page.locator('.chat-message.user').getByText('普通聊天需要保留', { exact: true }).waitFor();
  await page.locator('.message-options').getByText('附件：sent.txt', { exact: false }).waitFor();
  await page.locator('.chat-answer').getByText('合成回复已完成。', { exact: true }).waitFor();
  await page
    .locator('.conversation-row')
    .filter({ hasText: draftTitle })
    .locator('.conversation')
    .click();
  assert.equal(await input().inputValue(), '保存失败也不能丢掉的草稿');
  await send().click();
  await send().waitFor();
  assert.deepEqual(await app.evaluate(() => globalThis.requests.at(-1).fileBytes?.[0]), [
    ...Buffer.from('draft attachment'),
  ]);
  checks.push(
    'close waits for successful save, failure retains window; process restart restores messages, active draft, sent attachments and actual pending file bytes',
  );

  const old = page.locator('.conversation-row').filter({ hasText: '普通聊天需要保留' });
  await old.hover();
  await old.getByRole('button', { name: '删除对话：普通聊天需要保留', exact: true }).click();
  await old.getByRole('button', { name: '确认删除：对话：普通聊天需要保留', exact: true }).click();
  await closeNormally();
  await launch();
  assert.equal(
    await page.locator('.conversation-row').filter({ hasText: '普通聊天需要保留' }).count(),
    0,
  );
  assert.equal(await page.locator('.conversation-row').count(), 3);
  await app.evaluate(({ BrowserWindow }) => {
    const contents = BrowserWindow.getAllWindows().find(
      (win) => !win.webContents.getURL().includes('#login'),
    ).webContents;
    const send = contents.send.bind(contents);
    globalThis.restoreLogoutSend = () => {
      contents.send = send;
      globalThis.releaseLogoutSave?.();
    };
    contents.send = (channel, ...args) => {
      if (channel === 'session:request-close') {
        globalThis.releaseLogoutSave = () => send(channel, ...args);
        return;
      }
      send(channel, ...args);
    };
  });
  await page.getByRole('button', { name: '用户菜单', exact: true }).click();
  await page.getByRole('menuitem', { name: '退出登录', exact: true }).click();
  const loginOpened = app.waitForEvent('window');
  await page.getByRole('button', { name: '退出登录', exact: true }).click();
  await app.evaluate(async () => {
    const deadline = Date.now() + 5000;
    while (!globalThis.releaseLogoutSave) {
      if (Date.now() > deadline) throw Error('Logout save handshake was not requested');
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  });
  assert.equal(page.isClosed(), false, 'Outgoing data stays available until save finishes');
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1);
  await app.evaluate(() => globalThis.releaseLogoutSave());
  const login = await loginOpened;
  await login.getByRole('heading', { name: '登录 VoxCue', exact: true }).waitFor();
  page = await connectUiAccount(app, login);
  await page.locator('.conversation-row').filter({ hasText: '更新简历' }).waitFor();
  checks.push(
    'explicit deletion survives restart; primary logout waits for outgoing save before reopening the account gate, then preserves remaining chat',
  );
  assert.deepEqual(errors, []);
  await console.log(JSON.stringify({ checks, errors }, null, 2));
  console.log(JSON.stringify({ directory, checks, errors }));
} catch (error) {
  console.error(error);
  if (app) console.error('Synthetic requests:', await app.evaluate(() => globalThis.requests));
  if (page && !page.isClosed()) {
    await page.screenshot({});
    console.log((await page.locator('body').innerText()).slice(-1800));
  }
  throw error;
} finally {
  if (app) {
    await app.evaluate(() => globalThis.restoreLogoutSend?.()).catch(() => {});
    await closeUiApp(app);
  }
}
