import { testRoot, electron } from './test-workspace.mjs';

import { mkdir, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { installUiAccount, closeUiApp } from './install-ui-account.mjs';

await mkdir(path.join(testRoot, 'test/results'), { recursive: true });
const profile = await mkdtemp(path.resolve(path.join(testRoot, 'test/results/adversarial-fixed-')));
const executable = process.argv
  .find((arg) => arg.startsWith('--app-executable='))
  ?.slice('--app-executable='.length);
const packaged = !!executable;
const env = { ...process.env, COPILOT_TEST_USER_DATA: profile, VITE_DEV_SERVER_URL: '' };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  ...(packaged ? { executablePath: path.resolve(executable) } : {}),
  args: packaged ? [] : ['.'],
  env,
});
const errors = [],
  checks = [];
try {
  const login = await app.firstWindow();
  await installUiAccount(app);
  await app.evaluate(({ app }) => {
    const require = process
      .getBuiltinModule('module')
      .createRequire(app.getAppPath() + '/package.json');
    const { ChatGPTService } = require(
      app.getAppPath() + '/dist-electron/shared/electron/backend/chat/service.js',
    );
    globalThis.auditHeld = undefined;
    ChatGPTService.prototype.stream = async (request, emit, signal) => {
      if (request.turns.at(-1).content === 'held-for-reload') {
        emit({ id: request.id, type: 'delta', text: 'Synthetic saved partial' });
        return new Promise((resolve) => {
          globalThis.auditHeld = { id: request.id, signal, emit, resolve };
        });
      }
      emit({ id: request.id, type: 'delta', text: 'Synthetic successful answer' });
      return { answerText: 'Synthetic successful answer', sources: [], usage: null };
    };
  });
  const [page] = await Promise.all([
    app.waitForEvent('window'),
    login.getByRole('button', { name: '使用 ChatGPT 继续', exact: true }).click(),
  ]);
  page.setDefaultTimeout(15000);
  page.on('pageerror', (error) => errors.push(error.message));
  const ready = async () => {
    await page.getByRole('textbox', { name: '聊天消息' }).waitFor();
    await page.getByRole('button', { name: '发送消息', exact: true }).waitFor();
  };
  await ready();
  await page.getByRole('textbox', { name: '聊天消息' }).fill('held-for-reload');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await page
    .locator('.chat-answer')
    .getByText('Synthetic saved partial', { exact: true })
    .waitFor();
  // Wait for the real IndexedDB commit, not an arbitrary sleep.
  await page.waitForFunction(async () => {
    const db = await new Promise((resolve) => {
      const r = indexedDB.open('voxcue-preparation-chats', 1);
      r.onsuccess = () => resolve(r.result);
    });
    try {
      const r = db.transaction('state').objectStore('state').get('current');
      return await new Promise(
        (resolve) =>
          (r.onsuccess = () =>
            resolve(
              r.result?.conversations.some((c) =>
                c.messages.some((m) => m.content === 'Synthetic saved partial'),
              ),
            )),
      );
    } finally {
      db.close();
    }
  });
  await page.reload();
  await ready();
  assert.equal(await app.evaluate(() => globalThis.auditHeld.signal.aborted), true);
  await page
    .locator('.chat-answer')
    .getByText('Synthetic saved partial', { exact: true })
    .waitFor();
  const next = await page.evaluate(() =>
    window.desktop.chatSend({
      id: 'after-reload',
      modelId: 'test-model',
      instructions: '',
      webSearch: false,
      turns: [{ role: 'user', content: 'new request' }],
    }),
  );
  assert.equal(next.ok, true);
  await app.evaluate(() => {
    const old = globalThis.auditHeld;
    old.emit({ id: old.id, type: 'delta', text: 'Forbidden late text' });
    old.resolve({ answerText: 'Forbidden late text', sources: [], usage: null });
  });
  assert.equal(await page.getByText('Forbidden late text', { exact: false }).count(), 0);
  checks.push(
    'reload cancels old native request, preserves committed partial text, immediately accepts next request, rejects ignored-cancel late result',
  );

  const raw = JSON.stringify([
    {
      id: 'broken',
      title: 'Synthetic damaged record',
      startedAt: 1,
      endedAt: 2,
      status: 'ended',
      mock: false,
      transcripts: [],
      answers: [null],
    },
  ]);
  await page.evaluate((raw) => localStorage.setItem('copilot-interview-history-v1', raw), raw);
  await page.getByRole('button', { name: '面试记录', exact: true }).click();
  await page
    .getByRole('alert')
    .getByText('无法读取本地记录，原始数据已保留。', { exact: true })
    .waitFor();
  assert.equal(await page.getByRole('button', { name: '新对话', exact: true }).isVisible(), true);
  assert.equal(
    await page.evaluate(() => localStorage.getItem('copilot-interview-history-v1')),
    raw,
  );
  await page.screenshot({});
  checks.push(
    'damaged nested history shows visible error, preserves original bytes and usable sidebar',
  );
  await page.evaluate(() => localStorage.removeItem('copilot-interview-history-v1'));
  await page.reload();
  await ready();
  await page.evaluate(async () => {
    const db = await new Promise((resolve) => {
      const r = indexedDB.open('voxcue-preparation-chats', 1);
      r.onsuccess = () => resolve(r.result);
    });
    const tx = db.transaction(['state', 'files'], 'readwrite');
    tx.objectStore('files').clear();
    tx.objectStore('state').put(
      {
        version: 1,
        conversations: [],
        activeConversation: null,
        draft: '',
        attachments: [],
        modelId: 'test-model',
        effort: 'low',
        webSearch: false,
        send: 'corrupted-string',
        streaming: true,
      },
      'current',
    );
    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = reject;
    });
    db.close();
  });
  await page.reload();
  await ready();
  await page.getByRole('textbox', { name: '聊天消息' }).fill('Synthetic restored action');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await page
    .locator('.chat-answer')
    .getByText('Synthetic successful answer', { exact: true })
    .waitFor();
  checks.push(
    'persisted extra action/runtime keys do not replace send or streaming state; normal UI send succeeds',
  );
  assert.deepEqual(errors, []);
  await console.log(JSON.stringify({ packaged, checks, errors }, null, 2));
  console.log(JSON.stringify({ profile, packaged, checks, errors }));
} finally {
  await closeUiApp(app);
}
