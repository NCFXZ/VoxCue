import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { testRoot, electron } from './test-workspace.mjs';
import { offlineElectronEntry } from './offline-electron-entry.mjs';
import { installUiAccount, closeUiApp } from './install-ui-account.mjs';
import { verifyContinuousCorners } from './continuous-corners.mjs';

const screenshotDirectory = process.argv.find((arg) => arg.startsWith('--screenshots='))?.slice(14);
if (screenshotDirectory) await mkdir(path.resolve(screenshotDirectory), { recursive: true });
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
      if ((question === '请求停止' || question.startsWith('生命周期活动')) && attempt === 2) {
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
      if (question === '渐隐与返回最新') {
        fixture.visualEmit = (text) => emit({ id: request.id, type: 'delta', text });
        return new Promise((resolve) => {
          fixture.visualComplete = (answerText) =>
            resolve({ answerText, usage: null, sources: [] });
        });
      }
      if (question === '长错误') throw Error('合成网络错误：连接暂时不可用。'.repeat(40));
      if (question === '空回答') return { answerText: '', usage: null, sources: [] };
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
  await page
    .locator('.transcript-item > p')
    .getByText('Synthetic interviewer question', { exact: true })
    .waitFor();
  await page.getByRole('button', { name: '转写面板', exact: true }).click();
  await main.evaluate(() => localStorage.setItem('voxcue-interview-font-size-v1', '24'));
  const latest = () => page.locator('.floating-answer-item').last();
  const capture = async (name) => {
    if (screenshotDirectory)
      await page.screenshot({
        path: path.join(path.resolve(screenshotDirectory), name + '.png'),
        animations: 'disabled',
        scale: 'css',
      });
  };
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
  for (const theme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: theme });
    await capture('retry-3-of-3-' + theme);
  }
  await app.evaluate(() => globalThis.retryFixture.complete());
  await latest().locator('.answer-bubble').getByText('本次完整回答。', { exact: true }).waitFor();
  await page.getByRole('button', { name: '发送面试问题', exact: true }).waitFor();
  assert.equal(await latest().locator('.interview-answer-status').count(), 0);
  assert.equal(await latest().locator('.answer-bubble').innerText(), '本次完整回答。');
  await capture('retry-recovered');

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
  for (const theme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: theme });
    await capture('failure-with-partial-' + theme);
  }
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
  await capture('retry-wait-stopped');
  for (const attempt of [2, 3]) {
    const question = '等待停止-' + attempt;
    await send(question);
    await latest()
      .locator('.interview-answer-status')
      .filter({ hasText: `正在重试 ${attempt}/3` })
      .waitFor();
    await stop();
    assert.equal(await calls(question), attempt);
    assert.equal(await latest().locator('.interview-answer-failure').count(), 0);
  }
  await send('请求停止');
  await latest().locator('.activity-detail').filter({ hasText: '活动重试请求已开始' }).waitFor();
  assert.equal(await calls('请求停止'), 2);
  await stop();
  await latest().locator('.interview-answer-status').getByText('已停止', { exact: true }).waitFor();
  await capture('retry-active-stopped');
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

  for (const question of ['长错误', '空回答']) {
    await send(question);
    const card = latest().locator('.interview-answer-failure');
    await card.waitFor();
    assert.equal(await calls(question), 4);
    assert.equal(await latest().locator('.answer-bubble').count(), 0);
    assert.equal(await card.getAttribute('role'), 'alert');
    assert.equal(
      await page.locator('.interview-answer-failure').first().getAttribute('role'),
      'note',
    );
    await capture(question === '长错误' ? 'failure-long-reason' : 'failure-empty-answer');
  }

  await send('渐隐与返回最新');
  await latest().locator('.answer-pending').waitFor();
  assert.equal(
    await latest()
      .locator('.answer-pending')
      .evaluate((node) => getComputedStyle(node).fontSize),
    '24px',
  );
  await capture('initial-generation-24px');
  const answer = [
    '### 工程实现与验证',
    ...Array.from(
      { length: 18 },
      (_, i) =>
        `第 ${i + 1} 项：使用清晰的接口组织功能，隔离状态与异步任务，并通过实际界面确认结果。`,
    ),
    '```ts\nconst attempts = 4;\nconsole.log(attempts);\n```',
  ].join('\n\n');
  await app.evaluate((_electron, text) => globalThis.retryFixture.visualEmit(text), answer);
  await latest().locator('pre code').waitFor();
  const scroll = page.locator('.floating-answer .floating-scroll');
  const style = await scroll.evaluate((node) => ({
    mask: getComputedStyle(node).maskImage,
    padding: getComputedStyle(node).paddingBottom,
  }));
  assert.match(style.mask, /36px/);
  assert.equal(style.padding, '36px');
  await scroll.evaluate((node) => {
    node.scrollTop = 0;
    node.dispatchEvent(new Event('scroll'));
  });
  const readingTop = await scroll.evaluate((node) => node.scrollTop);
  const tail = '\n\n最后一行：返回最新后，这一行应完整可读。';
  await app.evaluate((_electron, text) => globalThis.retryFixture.visualEmit(text), tail);
  await latest()
    .getByText('最后一行：返回最新后，这一行应完整可读。', { exact: true })
    .waitFor({ state: 'attached' });
  assert.equal(await scroll.evaluate((node) => node.scrollTop), readingTop);
  const follow = page.locator('.floating-composer > .follow-latest');
  assert.equal(await follow.locator('.follow-latest-dots > span').count(), 3);
  await capture('fade-reading-while-generating');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(
    await follow
      .locator('.follow-latest-dots > span')
      .evaluateAll((nodes) =>
        nodes.every((node) => getComputedStyle(node).animationName === 'none'),
      ),
    true,
  );
  await follow.click();
  await page.waitForFunction(() => {
    const node = document.querySelector('.floating-answer .floating-scroll');
    return node.scrollHeight - node.scrollTop - node.clientHeight < 2;
  });
  assert.equal(await calls('渐隐与返回最新'), 1);
  await app.evaluate(
    (_electron, text) => globalThis.retryFixture.visualComplete(text),
    answer + tail,
  );
  await page.getByRole('button', { name: '发送面试问题', exact: true }).waitFor();
  const tailVisible = await latest()
    .locator('.markdown-content > p')
    .last()
    .evaluate((node) => {
      const bottom = node.getBoundingClientRect().bottom;
      const viewport = node.closest('.floating-scroll').getBoundingClientRect();
      return bottom <= viewport.bottom - 35;
    });
  assert.equal(tailVisible, true);
  for (const theme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: theme });
    await capture('fade-latest-' + theme);
  }
  await scroll.evaluate((node) => {
    node.scrollTop = 0;
    node.dispatchEvent(new Event('scroll'));
  });
  await follow.locator('.follow-latest-arrow').waitFor();
  await capture('return-latest-arrow');
  await follow.click();
  const resize = page.getByRole('button', { name: '拖动右下角调整尺寸', exact: true });
  for (let i = 0; i < 20; i++) await resize.press('-');
  await page.waitForFunction(async () => {
    const before = innerWidth;
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
    return before === innerWidth;
  });
  if (await follow.isVisible()) await follow.click();
  await page.waitForFunction(() => {
    const node = document.querySelector('.floating-answer .floating-scroll');
    return node.scrollHeight - node.scrollTop - node.clientHeight < 2;
  });
  for (const theme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: theme });
    await capture('minimum-fade-' + theme);
  }
  await send('最小窗失败');
  await latest().locator('.interview-answer-failure').waitFor();
  assert.equal(
    await latest()
      .locator('.interview-answer-failure')
      .evaluate((node) => node.scrollWidth <= node.clientWidth + 1),
    true,
  );
  for (const theme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: theme });
    await capture('minimum-failure-' + theme);
  }
  const endInterview = async (target) => {
    await target.getByRole('button', { name: '结束面试', exact: true }).click();
    await Promise.all([
      target.waitForEvent('close'),
      target.getByRole('button', { name: '确认结束面试', exact: true }).click(),
    ]);
  };
  await endInterview(page);
  const lifecycleCalls = [];
  for (const phase of ['等待', '活动']) {
    for (const action of ['结束', '关闭', '销毁']) {
      await main.getByRole('button', { name: '开始面试', exact: true }).click();
      const [target] = await Promise.all([
        app.waitForEvent('window'),
        main.getByRole('button', { name: '确认开始', exact: true }).click(),
      ]);
      target.on('pageerror', (error) => errors.push(error.message));
      await target.getByRole('button', { name: '静音后自动提交完整问题', exact: true }).click();
      // The deterministic speech fixture arrives 50 ms after capture starts.
      // Let its initial autofill settle before Playwright selects/replaces text.
      await target
        .locator('.transcript-item > p')
        .getByText('Synthetic interviewer question', { exact: true })
        .waitFor();
      const question = '生命周期' + phase + '-' + action;
      await target.getByRole('textbox', { name: '面试提问', exact: true }).fill(question);
      await target.getByRole('button', { name: '发送面试问题', exact: true }).click();
      assert.equal(await target.locator('.floating-question').last().innerText(), question);
      if (phase === '等待')
        await target
          .locator('.interview-answer-status')
          .filter({ hasText: '正在重试 1/3' })
          .waitFor();
      else
        await target
          .locator('.activity-detail')
          .filter({ hasText: '活动重试请求已开始' })
          .waitFor();
      assert.equal(
        await calls(question),
        phase === '等待' ? 1 : 2,
        JSON.stringify(await app.evaluate(() => globalThis.retryFixture.calls)),
      );
      lifecycleCalls.push([question, phase === '等待' ? 1 : 2]);
      if (action === '关闭')
        await app.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()
            .find((win) => win.webContents.getURL().endsWith('#interview'))
            .close(),
        );
      if (action === '销毁') {
        await Promise.all([
          target.waitForEvent('close'),
          app.evaluate(({ BrowserWindow }) =>
            BrowserWindow.getAllWindows()
              .find((win) => win.webContents.getURL().endsWith('#interview'))
              .destroy(),
          ),
        ]);
      } else if (action === '关闭') {
        await Promise.all([
          target.waitForEvent('close'),
          target.getByRole('button', { name: '确认结束面试', exact: true }).click(),
        ]);
      } else await endInterview(target);
      if (phase === '活动') await app.evaluate(() => globalThis.retryFixture.late());
    }
  }
  // A cancelled first wait must remain quiet after its original 500ms deadline.
  await new Promise((resolve) => setTimeout(resolve, 650));
  for (const [question, count] of lifecycleCalls)
    assert.equal(await calls(question), count, 'Cancelled lifecycle request: ' + question);
  assert.equal(await app.evaluate(() => globalThis.retryFixture.aborts), 4);
  assert.doesNotMatch(
    await main.evaluate(() => localStorage.getItem('copilot-interview-history-v1') ?? ''),
    /停止后的迟到输出/,
  );
  assert.deepEqual(errors, []);
  console.log(
    'PASS: automatic recovery/exhaustion (4 requests), partial replacement, manual retry, fixed status typography, continuous corners, cancel all three retry waits/active request, late events/next question, empty/long errors, reading pause, fade/last line, latest dots/arrow/reduced motion, minimum window and six waiting/active end/close/destroy cases; synthetic account/audio only.',
  );
} finally {
  await app
    .evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().forEach((window) => window.destroy()),
    )
    .catch(() => {});
  await closeUiApp(app);
}
