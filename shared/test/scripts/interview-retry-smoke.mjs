import path from 'node:path';
import assert from 'node:assert/strict';
import { testRoot, electron } from './test-workspace.mjs';
import { offlineElectronEntry } from './offline-electron-entry.mjs';
import { installUiAccount, closeUiApp } from './install-ui-account.mjs';
import { verifyContinuousCorners } from './continuous-corners.mjs';

const app = await electron.launch({
  args: [await offlineElectronEntry()],
  env: {
    ...process.env,
    COPILOT_TEST_USER_DATA: path.join(testRoot, 'interview-retry'),
    VITE_DEV_SERVER_URL: '',
  },
});
const errors = [];
try {
  await installUiAccount(app, { speech: true, components: true });
  await app.evaluate(({ app }) => {
    const require = process
      .getBuiltinModule('module')
      .createRequire(app.getAppPath() + '/package.json');
    const { ChatGPTService } = require(
      app.getAppPath() + '/dist-electron/shared/electron/backend/chat/service.js',
    );
    globalThis.retryFixture = { calls: {}, aborts: 0, recovered: false };
    ChatGPTService.prototype.stream = async (request, emit, signal) => {
      if (request.id.startsWith('history-title-'))
        return { answerText: '合成重试回归', usage: null, sources: [] };
      const fixture = globalThis.retryFixture;
      const question = request.turns.at(-1).content;
      const attempt = (fixture.calls[question] = (fixture.calls[question] ?? 0) + 1);
      emit({
        id: request.id,
        type: 'provider',
        provider: { id: 'chatgpt', name: 'ChatGPT', dataRecipient: 'OpenAI' },
      });
      if (question === '自动恢复' && attempt === 4) {
        emit({
          id: request.id,
          type: 'activity',
          activity: { phase: 'writing', detail: '恢复请求已开始' },
        });
        return new Promise((resolve) => {
          fixture.complete = () => {
            emit({ id: request.id, type: 'delta', text: '本次完整回答。' });
            resolve({ answerText: '本次完整回答。', usage: null, sources: [] });
          };
        });
      }
      if (question === '请求停止' && attempt === 2) {
        emit({
          id: request.id,
          type: 'activity',
          activity: { phase: 'writing', detail: '活动重试请求已开始' },
        });
        fixture.late = () => emit({ id: request.id, type: 'delta', text: '停止后的迟到输出' });
        return new Promise((_resolve, reject) =>
          signal.addEventListener(
            'abort',
            () => {
              fixture.aborts++;
              reject(signal.reason);
            },
            { once: true },
          ),
        );
      }
      if (question === '下一题' || (question === '全部失败' && fixture.recovered))
        return { answerText: '下一次请求正常完成。', usage: null, sources: [] };
      if (attempt === 1 && ['自动恢复', '全部失败'].includes(question))
        emit({ id: request.id, type: 'delta', text: '前次未完成的正文。' });
      throw Error('合成连接中断，请检查网络后重试。');
    };
  });
  const login = await app.firstWindow();
  const [main] = await Promise.all([
    app.waitForEvent('window'),
    login.getByRole('button', { name: '使用 ChatGPT 继续', exact: true }).click(),
  ]);
  await main.getByRole('button', { name: '开始面试', exact: true }).click();
  const [page] = await Promise.all([
    app.waitForEvent('window'),
    main.getByRole('button', { name: '确认开始', exact: true }).click(),
  ]);
  page.setDefaultTimeout(20000);
  page.on('pageerror', (error) => errors.push(error.message));
  await page.getByRole('button', { name: '静音后自动提交完整问题', exact: true }).click();
  await page.getByRole('button', { name: '转写面板', exact: true }).click();
  await main.evaluate(() => localStorage.setItem('voxcue-interview-font-size-v1', '24'));
  const latest = () => page.locator('.floating-answer-item').last();
  const send = async (question) => {
    await page.getByRole('textbox', { name: '面试提问', exact: true }).fill(question);
    await page.getByRole('button', { name: '发送面试问题', exact: true }).click();
  };
  const stop = () => page.getByRole('button', { name: '停止当前回答', exact: true }).click();
  const calls = (question) =>
    app.evaluate((_electron, question) => globalThis.retryFixture.calls[question] ?? 0, question);
  await send('自动恢复');
  await latest().locator('.activity-detail').filter({ hasText: '恢复请求已开始' }).waitFor();
  assert.equal(await calls('自动恢复'), 4);
  assert.equal(await latest().locator('.interview-answer-status').innerText(), '正在重试 3/3');
  assert.equal(
    await latest()
      .locator('.interview-answer-status')
      .evaluate((node) => getComputedStyle(node).fontSize),
    '12px',
  );
  assert.equal(await latest().locator('.answer-bubble').innerText(), '前次未完成的正文。');
  assert.equal(
    await page.locator('.floating-composer').getByText('正在重试', { exact: false }).count(),
    0,
  );
  await verifyContinuousCorners(page, 'interview automatic retry');
  await app.evaluate(() => globalThis.retryFixture.complete());
  await latest().locator('.answer-bubble').getByText('本次完整回答。', { exact: true }).waitFor();
  await page.getByRole('button', { name: '发送面试问题', exact: true }).waitFor();
  assert.equal(await latest().locator('.interview-answer-status').count(), 0);
  assert.equal(await latest().locator('.answer-bubble').innerText(), '本次完整回答。');

  await send('全部失败');
  const failure = latest().locator('.interview-answer-failure');
  await failure.getByText('已自动重试 3 次，仍未完成。', { exact: true }).waitFor();
  assert.equal(await calls('全部失败'), 4);
  assert.equal(await failure.getAttribute('role'), 'alert');
  assert.equal(await latest().locator('.answer-bubble').innerText(), '前次未完成的正文。');
  assert.equal(
    await failure
      .locator('.interview-answer-failure-reason')
      .evaluate((node) => getComputedStyle(node).fontSize),
    '14px',
  );
  assert.equal(await page.locator('.floating-composer .interview-answer-failure').count(), 0);
  await verifyContinuousCorners(page, 'interview exhausted retry');
  await app.evaluate(() => {
    globalThis.retryFixture.recovered = true;
  });
  await failure.getByRole('button', { name: '重试面试回答', exact: true }).click();
  await latest()
    .locator('.answer-bubble')
    .getByText('下一次请求正常完成。', { exact: true })
    .waitFor();
  assert.equal(await calls('全部失败'), 5);
  assert.equal(await page.locator('.interview-answer-failure').getAttribute('role'), 'note');

  await send('等待停止');
  await latest().locator('.interview-answer-status').filter({ hasText: '正在重试 1/3' }).waitFor();
  await stop();
  await latest().locator('.interview-answer-status').getByText('已停止', { exact: true }).waitFor();
  assert.equal(await calls('等待停止'), 1);
  assert.equal(await latest().locator('.interview-answer-failure').count(), 0);
  await send('请求停止');
  await latest().locator('.activity-detail').filter({ hasText: '活动重试请求已开始' }).waitFor();
  assert.equal(await calls('请求停止'), 2);
  await stop();
  await latest().locator('.interview-answer-status').getByText('已停止', { exact: true }).waitFor();
  await app.evaluate(() => globalThis.retryFixture.late());
  await send('下一题');
  await latest()
    .locator('.answer-bubble')
    .getByText('下一次请求正常完成。', { exact: true })
    .waitFor();
  assert.equal(await calls('等待停止'), 1);
  assert.equal(await calls('请求停止'), 2);
  assert.equal(await page.getByText('停止后的迟到输出', { exact: true }).count(), 0);
  assert.equal(await app.evaluate(() => globalThis.retryFixture.aborts), 1);
  assert.deepEqual(errors, []);
  console.log(
    'PASS: automatic recovery/exhaustion (4 requests), partial replacement, manual retry, fixed status typography, continuous corners, cancel waiting/active retry, late events and next question; synthetic account/audio only.',
  );
} finally {
  await app
    .evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().forEach((window) => window.destroy()),
    )
    .catch(() => {});
  await closeUiApp(app);
}
