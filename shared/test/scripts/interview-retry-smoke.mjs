import { evaluateHistory } from './stored-history-fixture.mjs';
import { connectUiAccount } from './install-ui-account.mjs';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { testRoot, electron } from './test-workspace.mjs';
import { offlineElectronEntry } from './offline-electron-entry.mjs';
import { installUiAccount, closeUiApp } from './install-ui-account.mjs';
import { verifyContinuousCorners } from './continuous-corners.mjs';
import { checkAnswerDivider, checkFirstStatusPosition } from './check-progress-motion.mjs';
import { waitForAsync } from './wait-for-async.mjs';

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
const retryClock = (action, milliseconds = 0) =>
  app.evaluate(
    (_, { action, milliseconds }) => {
      const timers = process.getBuiltinModule('node:test').mock.timers;
      if (action === 'enable') timers.enable({ apis: ['setTimeout'] });
      else if (action === 'tick') timers.tick(milliseconds);
      else timers.reset();
    },
    { action, milliseconds },
  );
try {
  await installUiAccount(app, { speech: true, components: true });
  await app.evaluate(({ app }) => {
    const require = process
      .getBuiltinModule('module')
      .createRequire(app.getAppPath() + '/package.json');
    const { ChatGPTService } = require(
      app.getAppPath() + '/dist-electron/shared/electron/backend/chat/service.js',
    );
    const { ChatServiceError } = require(
      app.getAppPath() + '/dist-electron/shared/electron/backend/chat/errors.js',
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
      if (question === '渐隐与返回最新' || question.startsWith('短回答收起')) {
        fixture.visualEmit = (text) => emit({ id: request.id, type: 'delta', text });
        fixture.visualActivity = activity => emit({ id: request.id, type: 'activity', activity });
        fixture.visualSummary = () => {
          const text = '**公开摘要**\n\n正在核对。';
          emit({ id: request.id, type: 'reasoning-summary', text });
          fixture.visualActivity({ id: 'public-summary-0-fixture', kind: 'reasoning', phase: 'thinking', detail: text });
        };
        return new Promise((resolve) => {
          fixture.visualComplete = (answerText) =>
            resolve({ answerText, usage: null, sources: [] });
        });
      }
      if (question === '长错误' || question === '最小窗长错误')
        throw new ChatServiceError({
          code: 'network_error',
          message: '合成网络错误：连接暂时不可用。'.repeat(40),
        });
      if (question === '未知错误') throw Error('合成网络错误文案不授予重试权限。');
      if (question === '空回答') return { answerText: '', usage: null, sources: [] };
      if (attempt === 1 && ['自动恢复', '全部失败'].includes(question))
        emit({ id: request.id, type: 'delta', text: '前次未完成的正文。' });
      throw new ChatServiceError({
        code: 'network_error',
        message: '合成连接中断，请检查网络后重试。',
      });
    };
  });
  const login = await app.firstWindow();
  const main = await connectUiAccount(app, login);
  await main.locator('.interview-start-trigger').click();
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
  const checkLongErrorBorder = async (card, size) => {
    const scroll = await card.evaluate(async node => {
      const reveal = node.closest('.interview-reveal');
      await Promise.all(reveal.getAnimations({ subtree: true })
        .filter(animation => animation.effect.getTiming().iterations !== Infinity)
        .map(animation => animation.finished.catch(() => {})));
      const outer = node.closest('.floating-scroll');
      const reason = node.querySelector('.interview-answer-failure-reason');
      // The browser clamps scrollTop at a fractional offset. scrollHeight and
      // clientHeight round independently and cannot identify that exact limit.
      const remainingMovement = scroller => {
        const before = scroller.scrollTop;
        scroller.scrollTop = scroller.scrollHeight;
        return scroller.scrollTop - before;
      };
      outer.scrollTop = outer.scrollHeight;
      let bottomFrames = 0;
      const deadline = performance.now() + 2000;
      while (bottomFrames < 2) {
        await new Promise(requestAnimationFrame);
        bottomFrames = remainingMovement(outer) === 0 ? bottomFrames + 1 : 0;
        if (performance.now() > deadline) throw Error('Outer answer scroll did not settle at its bottom');
      }
      const top = outer.scrollTop;
      reason.scrollTop = reason.scrollHeight;
      await new Promise(requestAnimationFrame);
      const remaining = remainingMovement(reason);
      const text = document.createRange();
      text.selectNodeContents(reason);
      const lines = [...text.getClientRects()].filter(rect => rect.height > 0 && rect.width > 0);
      const last = lines.at(-1);
      const viewport = reason.getBoundingClientRect();
      const style = getComputedStyle(reason);
      return {
        reasonTop: reason.scrollTop, remaining, outerShift: outer.scrollTop - top,
        wrapped: !!last && lines.some(line => line.bottom <= last.top),
        lastTop: last?.top, lastBottom: last?.bottom,
        viewportTop: viewport.top + parseFloat(style.borderTopWidth),
        viewportBottom: viewport.bottom - parseFloat(style.borderBottomWidth),
      };
    });
    assert(scroll.reasonTop > 0 && scroll.remaining === 0 && Math.abs(scroll.outerShift) < 1 &&
      scroll.wrapped && scroll.lastTop >= scroll.viewportTop && scroll.lastBottom <= scroll.viewportBottom,
      `${size} long error must scroll to the end inside its card: ${JSON.stringify(scroll)}`);
    const box = await card.boundingBox();
    const clip = { x: Math.ceil(box.x + box.width * 0.3), y: Math.floor(box.y + box.height) - 3,
      width: Math.floor(box.width * 0.4), height: 6 };
    const pixels = () => page.screenshot({ clip, scale: 'css', animations: 'disabled' });
    const painted = await pixels();
    const saved = await card.evaluate(node => {
      const value = node.style.getPropertyValue('border-bottom-color');
      const priority = node.style.getPropertyPriority('border-bottom-color');
      node.style.setProperty('border-bottom-color', 'transparent', 'important');
      return { value, priority };
    });
    let clear;
    try {
      clear = await pixels();
      assert.deepEqual(await card.boundingBox(), box, `${size} border probe must preserve card geometry`);
    } finally {
      await card.evaluate((node, saved) => node.style.setProperty('border-bottom-color', saved.value, saved.priority), saved);
    }
    const visible = await app.evaluate(({ nativeImage }, frames) => {
      const images = frames.map(frame => nativeImage.createFromBuffer(Buffer.from(frame, 'base64')));
      const { width, height } = images[0].getSize();
      const [before, after] = images.map(image => image.toBitmap());
      const difference = (x, y) => {
        const at = (y * width + x) * 4;
        return Math.max(...[0, 1, 2, 3].map(i => Math.abs(before[at + i] - after[at + i])));
      };
      let changed = 0;
      for (let x = 0; x < width; x++) {
        const noise = Math.max(difference(x, 0), difference(x, height - 1));
        // Fractional coordinates and desktop scaling may split a 1px border over adjacent pixels.
        if (Math.max(...[1, 2, 3, 4].map(y => difference(x, y))) > noise + 5) changed++;
      }
      return { changed, width };
    }, [painted, clear].map(image => image.toString('base64')));
    console.log(`${size} long error bottom border: ${visible.changed}/${visible.width} columns`);
    assert(visible.changed >= visible.width * 0.8, `${size} long error bottom border is clipped or covered`);
  };
  const send = async (question) => {
    await page.getByRole('textbox', { name: '面试提问', exact: true }).fill(question);
    await page.getByRole('button', { name: '发送面试问题', exact: true }).click();
  };
  const stop = () => page.getByRole('button', { name: '停止当前回答', exact: true }).click();
  const calls = (question) =>
    app.evaluate((_electron, question) => globalThis.retryFixture.calls[question] ?? 0, question);
  for (const [question, streamed, reduced] of [
    ['短回答收起：直接完成', false, false],
    ['短回答收起：先出正文', true, false],
    ['短回答收起：减弱动态', false, true],
  ]) {
    await page.emulateMedia({ reducedMotion: reduced ? 'reduce' : 'no-preference' });
    await send(question);
    const item = page.getByRole('article', { name: `回答：${question}`, exact: true });
    await item.locator('.response-progress').waitFor();
    if (!reduced) {
      await waitForAsync(app, (_, question) => globalThis.retryFixture.calls[question] === 1, question);
      await checkFirstStatusPosition(item, async () => {
        const progress = item.locator('.response-progress');
        const statusBody = progress.locator('.response-progress-content');
        const measureLabel = async text => {
          const label = statusBody.getByText(text, { exact: true });
          await label.waitFor();
          assert.equal((await statusBody.innerText()).trim(), text, 'one primary status label');
          assert.match(await progress.locator('.response-duration').innerText(),
            text === '正在思考' ? /^正在思考 .*秒$/ : /^用时 .*秒$/);
          return label.evaluate(node => {
            const timer = node.closest('.response-progress').querySelector('.response-duration').getBoundingClientRect();
            const range = document.createRange();
            range.selectNodeContents(node);
            const glyph = range.getBoundingClientRect();
            return { font: getComputedStyle(node).fontSize, x: glyph.left - timer.left, y: glyph.top - timer.bottom };
          });
        };
        const initial = await measureLabel('正在思考');
        const checkLabel = async text => {
          const label = await measureLabel(text);
          assert.equal(label.font, initial.font, text);
          assert(Math.abs(label.x - initial.x) < 1 && Math.abs(label.y - initial.y) < 1,
            `${text} moved from ${JSON.stringify(initial)} to ${JSON.stringify(label)}`);
        };
        const terminal = streamed
          ? ['failed', '本地资料未完整取得，继续回答']
          : ['completed', '已检索本地资料'];
        const emitActivity = activity => app.evaluate((_, value) => globalThis.retryFixture.visualActivity(value), activity);
        for (const [status, text] of [['in_progress', '正在检索本地资料'], terminal]) {
          await emitActivity({ id: 'local-retrieval', kind: 'knowledge', phase: 'thinking', status,
            detail: status === 'failed' ? '本地资料未完整取得，继续回答' : '检索本地资料' });
          await checkLabel(text);
        }
        if (!streamed) {
          for (const [kind, detail] of [['status', '正在核对当前问题'], ['commentary', '我先核对公开资料。']]) {
            await emitActivity({ id: `fixture-${kind}`, kind, phase: 'processing', status: 'in_progress', detail });
            await checkLabel(detail);
          }
        }
        await emitActivity({ id: 'progress-state-1', kind: 'status', phase: 'processing', status: 'in_progress' });
        await checkLabel('正在处理请求');
      });
    }
    const answer = '简短答复。';
    await item.evaluate(async (node, answer) => {
      await Promise.all(node.getAnimations({ subtree: true })
        .filter(animation => animation.effect.getTiming().iterations !== Infinity)
        .map(animation => animation.finished.catch(() => {})));
      const bubble = node.querySelector('.answer-bubble');
      const meta = node.querySelector('.floating-answer-meta');
      const sample = () => {
        const bodyTop = bubble.getBoundingClientRect().top;
        const row = meta.getBoundingClientRect();
        const progress = node.querySelector('.response-progress');
        return {
          space: bodyTop - row.bottom,
          // After unmount, the two adjacent blocks' margins collapse to the larger one.
          restingGap: Math.max(parseFloat(getComputedStyle(meta).marginBottom),
            parseFloat(getComputedStyle(bubble).marginTop)),
          position: bodyTop - row.top,
          progress: Boolean(progress),
          divider: progress ? Number(getComputedStyle(progress, '::after').opacity) : 0,
          text: bubble.textContent.includes(answer),
        };
      };
      window.shortAnswerFold = (async () => {
        const frames = [sample()];
        const deadline = performance.now() + 5000;
        let settled = 0;
        while (settled < 3 && performance.now() < deadline) {
          await new Promise(requestAnimationFrame);
          const frame = sample();
          frames.push(frame);
          settled = !frame.progress && frame.text ? settled + 1 : 0;
        }
        return frames;
      })();
    }, answer);
    if (streamed) await app.evaluate((_, text) => globalThis.retryFixture.visualEmit(text), answer);
    else await app.evaluate((_, text) => globalThis.retryFixture.visualComplete(text), answer);
    const frames = await page.evaluate(() => window.shortAnswerFold);
    const start = frames[0];
    const end = frames.at(-1);
    const steps = frames.slice(1).map((frame, index) => frames[index].position - frame.position);
    const lastVisible = frames.findLast(frame => frame.progress);
    const inBetween = frames.filter(frame => frame.space > end.space + 1 && frame.space < start.space - 1);
    const summary = {
      intermediateFrames: inBetween.length, bodyStart: start.position, bodyEnd: end.position,
      largestRise: Math.max(...steps), largestDrop: Math.max(0, ...steps.map(step => -step)),
      tailStep: lastVisible?.position - end.position, finalExtraSpace: end.space - end.restingGap,
    };
    console.log(question, summary);
    assert(start.progress && !start.text && start.space > end.restingGap + 10, question);
    assert(frames.every(frame => frame.divider === 0), 'transient progress exits without a divider flash');
    assert(!end.progress && end.text && Math.abs(summary.finalExtraSpace) < 1, `${question}: ${JSON.stringify(end)}`);
    if (reduced) assert.equal(inBetween.length, 0, question);
    else {
      assert(new Set(inBetween.map(frame => Math.round(frame.space))).size >= 2,
        `${question} must move the answer through intermediate positions: ${frames.map(frame => frame.space)}`);
      assert(inBetween.some(frame => frame.text), `${question} should show the answer during collapse`);
      assert(steps.every(step => step >= -1 && step < (start.position - end.position) * 0.8),
        `${question} reverses or jumps during collapse: ${steps}`);
      assert(Math.abs(summary.tailStep) < 2, `${question} jumps on unmount: ${summary.tailStep}px`);
    }
    assert(frames.slice(frames.findIndex(frame => frame.text)).every(frame => frame.text), question);
    if (streamed) await app.evaluate((_, text) => globalThis.retryFixture.visualComplete(text), answer);
    await page.getByRole('button', { name: '发送面试问题', exact: true }).waitFor();
    assert.equal(await item.locator('.answer-bubble').innerText(), answer);
  }
  for (const reduced of [false, true]) {
    await page.emulateMedia({ reducedMotion: reduced ? 'reduce' : 'no-preference' });
    const question = `短回答收起：保留摘要${reduced ? '减弱动态' : ''}`;
    await send(question);
    const item = page.getByRole('article', { name: `回答：${question}`, exact: true });
    await item.locator('.response-progress').waitFor();
    await waitForAsync(app, (_, question) => globalThis.retryFixture.calls[question] === 1, question);
    await app.evaluate(() => globalThis.retryFixture.visualSummary());
    const root = item.locator('.response-progress');
    const summary = root.locator('.reasoning-section summary');
    await summary.getByText('公开摘要', { exact: true }).waitFor();
    await summary.click();
    await root.locator('.reasoning-section').getByText('正在核对。', { exact: true }).waitFor();
    const visibleProgress = await root.innerText();
    for (const text of ['公开摘要', '正在核对。'])
      assert.equal(visibleProgress.split(text).length - 1, 1, `public reasoning must appear exactly once: ${visibleProgress}`);
    await summary.click();
    const answer = '带摘要的答复。';
    await checkAnswerDivider(root, () => app.evaluate((_, text) => globalThis.retryFixture.visualEmit(text), answer), reduced);
    await app.evaluate((_, text) => globalThis.retryFixture.visualComplete(text), answer);
    await page.getByRole('button', { name: '发送面试问题', exact: true }).waitFor();
    assert.equal(await root.evaluate(node => getComputedStyle(node, '::after').opacity), '1');
  }
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await send('自动恢复');
  const retryMessage = latest().getByRole('status').filter({ hasText: '恢复请求已开始' });
  await retryMessage.waitFor();
  assert.equal((await retryMessage.innerText()).trim(), '恢复请求已开始');
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
    '12px',
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
  const exhaustedAnswer = page.getByRole('article', { name: '回答：全部失败', exact: true });
  assert.equal(await exhaustedAnswer.locator('.interview-answer-failure').getAttribute('role'), 'note');
  assert.equal(await page.getByRole('alert', { name: '回答生成失败', exact: true }).count(), 0);

  await retryClock('enable');
  await send('等待停止');
  await latest().locator('.interview-answer-status').filter({ hasText: '正在重试 1/3' }).waitFor();
  await stop();
  await latest().locator('.interview-answer-status').getByText('已停止', { exact: true }).waitFor();
  assert.equal(await latest().locator('.typing-caret').count(), 0);
  await retryClock('tick', 4000);
  await retryClock('reset');
  assert.equal(await calls('等待停止'), 1);
  assert.equal(await latest().locator('.interview-answer-failure').count(), 0);
  await capture('retry-wait-stopped');
  for (const attempt of [2, 3]) {
    const question = '等待停止-' + attempt;
    await retryClock('enable');
    await send(question);
    for (let step = 1; step <= attempt; step++) {
      await latest()
        .locator('.interview-answer-status')
        .filter({ hasText: `正在重试 ${step}/3` })
        .waitFor();
      if (step < attempt) await retryClock('tick', 500 * 2 ** (step - 1));
    }
    await stop();
    await retryClock('tick', 4000);
    await retryClock('reset');
    assert.equal(await calls(question), attempt);
    assert.equal(await latest().locator('.interview-answer-failure').count(), 0);
  }
  await send('请求停止');
  await latest().getByRole('status').filter({ hasText: '活动重试请求已开始' }).waitFor();
  assert.equal(await calls('请求停止'), 2);
  await stop();
  await latest().locator('.interview-answer-status').getByText('已停止', { exact: true }).waitFor();
  await capture('retry-active-stopped');
  assert.equal(await latest().locator('.typing-caret').count(), 0);
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

  for (const [question, attempts] of [
    ['长错误', 4],
    ['空回答', 4],
    ['未知错误', 1],
  ]) {
    await send(question);
    const card = latest().locator('.interview-answer-failure');
    await card.waitFor();
    assert.equal(await calls(question), attempts);
    assert.equal(await latest().locator('.answer-bubble').count(), 0);
    assert.equal(await card.getAttribute('role'), 'alert');
    if (question === '长错误') await checkLongErrorBorder(card, 'normal');
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
  for (const size of [12, 14, 18, 24]) {
    await main.evaluate(
      (size) => localStorage.setItem('voxcue-interview-font-size-v1', String(size)),
      size,
    );
    await page.waitForFunction(
      (size) =>
        getComputedStyle(document.querySelector('.answer-pending')).fontSize === `${size}px`,
      size,
    );
    const caret = await latest()
      .locator('.typing-caret')
      .evaluate((node) => ({
        height: node.getBoundingClientRect().height,
        font: parseFloat(getComputedStyle(node).fontSize),
      }));
    assert.equal(caret.font, size);
    assert.ok(
      Math.abs(caret.height - size) < 0.1,
      `Caret must follow ${size}px text: ${JSON.stringify(caret)}`,
    );
  }
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
    padding: parseFloat(getComputedStyle(node).paddingBottom),
    composerHeight: node.parentElement.querySelector('.floating-composer').getBoundingClientRect()
      .height,
  }));
  assert.match(style.mask, /36px/);
  assert.ok(
    style.padding >= style.composerHeight + 36,
    'Final content clears the overlay composer and bottom fade',
  );
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
  const follow = page.locator('.floating-answer > .follow-latest');
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
  await send('最小窗长错误');
  const smallFailure = latest().locator('.interview-answer-failure');
  await smallFailure.waitFor();
  await checkLongErrorBorder(smallFailure, 'minimum');
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
      await main.locator('.interview-start-trigger').click();
      const [target] = await Promise.all([
        app.waitForEvent('window'),
        main.getByRole('button', { name: '确认开始', exact: true }).click(),
      ]);
      target.on('pageerror', (error) => errors.push(error.message));
      const autoAnswer = target.getByRole('button', { name: '静音后自动提交完整问题', exact: true });
      if (await autoAnswer.getAttribute('aria-pressed') === 'true') await autoAnswer.click();
      // The deterministic speech fixture arrives 50 ms after capture starts.
      // Let its initial autofill settle before Playwright selects/replaces text.
      await target
        .locator('.transcript-item > p')
        .getByText('Synthetic interviewer question', { exact: true })
        .waitFor();
      const question = '生命周期' + phase + '-' + action;
      // An automatic answer to the fixture transcript may already be retrying.
      // Let that request finish before freezing the next question's retry timer.
      const sendQuestion = target.getByRole('button', { name: '发送面试问题', exact: true });
      await sendQuestion.waitFor();
      await target.getByRole('textbox', { name: '面试提问', exact: true }).fill(question);
      if (phase === '等待') await retryClock('enable');
      await sendQuestion.click();
      assert.equal(await target.locator('.floating-question').last().innerText(), question);
      if (phase === '等待')
        await target
          .locator('.interview-answer-status')
          .filter({ hasText: '正在重试 1/3' })
          .waitFor();
      else
        await target
          .getByRole('status')
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
      else {
        await retryClock('tick', 4000);
        await retryClock('reset');
      }
    }
  }
  // A cancelled first wait must remain quiet after its original 500ms deadline.
  await new Promise((resolve) => setTimeout(resolve, 650));
  for (const [question, count] of lifecycleCalls)
    assert.equal(await calls(question), count, 'Cancelled lifecycle request: ' + question);
  assert.equal(await app.evaluate(() => globalThis.retryFixture.aborts), 4);
  assert.doesNotMatch(
    await evaluateHistory(main, async () => JSON.stringify(await fixtureHistory.read())),
    /停止后的迟到输出/,
  );
  assert.deepEqual(errors, []);
  console.log(
    'PASS: automatic short-answer progress collapse (streamed, immediate and reduced motion), automatic recovery/exhaustion (4 requests), partial replacement, manual retry, fixed status typography, continuous corners, cancel all three retry waits/active request, late events/next question, empty/long errors, reading pause, fade/last line, latest dots/arrow/reduced motion, minimum window and six waiting/active end/close/destroy cases; synthetic account/audio only.',
  );
} finally {
  await retryClock('reset').catch(() => {});
  await app
    .evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().forEach((window) => window.destroy()),
    )
    .catch(() => {});
  await closeUiApp(app);
}
