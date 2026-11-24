import { connectUiAccount, installUiAccount, closeUiApp } from './install-ui-account.mjs';
import { testRoot, electron } from './test-workspace.mjs';
import { offlineElectronEntry } from './offline-electron-entry.mjs';
import { waitForAsync } from './wait-for-async.mjs';
import { assertSmoothFollow } from './assert-follow-latest.mjs';

import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const profile = path.resolve(
  path.join(testRoot, 'test/results'),
  `conversations-profile-${Date.now()}`,
);
await mkdir(profile, { recursive: true });
const app = await electron.launch({
  args: [await offlineElectronEntry()],
  env: { ...process.env, COPILOT_TEST_USER_DATA: profile, VITE_DEV_SERVER_URL: '' },
});
try {
  const login = await app.firstWindow();
  await login.getByRole('heading', { name: '登录 VoxCue', exact: true }).waitFor();
  await login.waitForFunction(() => document.visibilityState === 'visible');
  await installUiAccount(app, { components: true });
  await app.evaluate(({ app }) => {
    const require = process.getBuiltinModule('module').createRequire(app.getAppPath() + '/package.json');
    const { ChatGPTService } = require(
      app.getAppPath() + '/dist-electron/shared/electron/backend/chat/service.js',
    );
    globalThis.conversationReplies = new Map();
    globalThis.conversationPrompts = [];
    ChatGPTService.prototype.stream = async (request, emit, signal) => {
      const title = request.turns.at(-1).content;
      globalThis.conversationPrompts.push(title);
      let content = title === '短对话'
        ? '短回复。'
        : Array.from({ length: 120 }, (_, index) =>
            `${title} 段落 ${index + 1}：用于检查独立聊天的阅读位置和流式回复。`,
          ).join('\n\n');
      const firstChunk = title === '第二轮追问' ? content.split('\n\n', 1)[0] : content;
      emit({ id: request.id, type: 'delta', text: firstChunk });
      if (title !== '短对话') {
        let abort;
        try {
          await new Promise((resolve, reject) => {
            abort = () => reject(new DOMException('Stopped', 'AbortError'));
            signal.addEventListener('abort', abort, { once: true });
            globalThis.conversationReplies.set(title, {
              finish: resolve,
              sendRemaining: () => emit({ id: request.id, type: 'delta', text: content.slice(firstChunk.length) }),
              append: (text) => {
                content += text;
                emit({ id: request.id, type: 'delta', text });
              },
            });
            if (signal.aborted) abort();
          });
        } finally {
          signal.removeEventListener('abort', abort);
          globalThis.conversationReplies.delete(title);
        }
      }
      return { answerText: content, usage: null, sources: [] };
    };
  });
  const page = await connectUiAccount(app, login);
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const composerInput = page.getByRole('textbox', { name: '聊天消息', exact: true });
  await composerInput.fill('第一条对话');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await waitForAsync(app, () => globalThis.conversationReplies.has('第一条对话'));
  await composerInput.fill('留在输入框里的下一问');
  await page.getByRole('button', { name: '停止回复', exact: true }).click();
  await page.getByRole('button', { name: '发送消息', exact: true }).waitFor();
  assert.equal(await composerInput.inputValue(), '留在输入框里的下一问');
  assert.equal(await page.locator('.chat-message.user').count(), 1, 'Stopping must not submit the next question');
  await waitForAsync(app, () => !globalThis.conversationReplies.has('第一条对话'));
  assert.deepEqual(await app.evaluate(() => globalThis.conversationPrompts), ['第一条对话']);
  console.log('Stop with draft: original request stopped, draft retained, 1 user message, 1 provider request.');
  await page.getByRole('button', { name: '新对话', exact: true }).click();
  await page.getByRole('textbox', { name: '聊天消息', exact: true }).fill('第二条对话');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  const row = page.locator('.conversation-row').filter({ hasText: '第一条对话' });
  await row.hover();
  await row.getByRole('button', { name: '删除对话：第一条对话', exact: true }).click();
  await row
    .getByRole('button', { name: '确认删除：对话：第一条对话', exact: true })
    .press('Escape');
  assert.equal(await page.locator('.conversation-row').count(), 2);
  await row.getByRole('button', { name: '第一条对话', exact: true }).click();
  await page.locator('.chat-message.user').getByText('第一条对话', { exact: true }).waitFor();
  await row.hover();
  await row.getByRole('button', { name: '删除对话：第一条对话', exact: true }).click();
  await row.getByRole('button', { name: '确认删除：对话：第一条对话', exact: true }).click();
  await row.waitFor({ state: 'detached' });
  assert.equal(await page.locator('.conversation-row').count(), 1);
  assert.equal(await page.locator('.chat-message').count(), 0);
  const remaining = page.locator('.conversation-row');
  await remaining.locator('.conversation').click();
  await page.locator('.chat-message.user').getByText('第二条对话', { exact: true }).waitFor();
  await remaining.hover();
  await remaining.getByRole('button', { name: '删除对话：第二条对话', exact: true }).click();
  await page.screenshot({});
  await remaining.getByRole('button', { name: '确认删除：对话：第二条对话', exact: true }).click();
  await remaining.waitFor({ state: 'detached' });
  assert.equal(await page.locator('.conversation-row').count(), 0);

  const chat = page.locator('.chat-scroll');
  const select = async (title) => {
    await page.locator('.conversation-row').filter({ hasText: title }).locator('.conversation').click();
    await page.locator('.chat-message.user').getByText(title, { exact: true }).waitFor();
  };
  const send = async (title) => {
    await page.getByRole('textbox', { name: '聊天消息', exact: true }).fill(title);
    await page.getByRole('button', { name: '发送消息', exact: true }).click();
    await page.locator('.chat-answer').getByText(
      title === '短对话' ? '短回复。' : `${title} 段落 120：用于检查独立聊天的阅读位置和流式回复。`,
      { exact: true },
    ).waitFor();
  };
  const finish = async (title) => {
    await waitForAsync(app, (_electron, title) => globalThis.conversationReplies.has(title), title);
    await app.evaluate((_electron, title) => globalThis.conversationReplies.get(title).finish(), title);
    await page.getByRole('button', { name: '停止回复', exact: true }).waitFor({ state: 'detached' });
  };
  const expectPosition = async (top) => {
    await page.waitForFunction((top) => {
      const node = document.querySelector('.chat-scroll');
      return node?.clientHeight > 0 && Math.abs(node.scrollTop - top) <= 1;
    }, top);
  };
  const scrollTo = async (top) => {
    await chat.evaluate((node, top) => {
      node.dispatchEvent(new WheelEvent('wheel', { deltaY: -1, bubbles: true }));
      node.scrollTop = top;
      node.dispatchEvent(new Event('scroll', { bubbles: true }));
    }, top);
    await expectPosition(top);
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  };
  const startFrames = async (anchor = null) => {
    await page.waitForFunction(() => !document.querySelector('.chat-scroll, .welcome')?.getAnimations().length);
    await page.evaluate((anchor) => {
      const header = document.querySelector('.preparation-workspace > .page-toolbar');
      const composer = document.querySelector('.chat-composer');
      const bounds = (node) => {
        const rect = node.getBoundingClientRect();
        return [rect.x, rect.y, rect.width, rect.height];
      };
      const initial = [bounds(header), bounds(composer)];
      const animations = new Set();
      const frames = [];
      let frame;
      let paragraph;
      const sample = () => {
        const content = document.querySelector('.preparation-workspace .chat-scroll, .preparation-workspace .welcome');
        const active = content?.getAnimations() ?? [];
        active.forEach((animation) => animations.add(animation));
        const style = content && getComputedStyle(content);
        if (anchor && content?.matches('.chat-scroll') && !paragraph?.isConnected) {
          const candidate = content.querySelectorAll('.chat-answer .markdown-content > p')[anchor.index];
          if (candidate?.textContent === anchor.text) paragraph = candidate;
        }
        frames.push({
          opacity: style ? Number(style.opacity) : 1,
          y: style && style.transform !== 'none' ? new DOMMatrix(style.transform).m42 : 0,
          active: active.length,
          scrollTop: content?.scrollTop,
          ...(anchor && content?.matches('.chat-scroll') && {
            historicalEntrances: content.querySelectorAll('.chat-message.user.sent-message-enter').length,
            paragraphY: paragraph?.isConnected ? paragraph.getBoundingClientRect().top - header.getBoundingClientRect().bottom : null,
            bottomGap: content.scrollHeight - content.clientHeight - content.scrollTop,
            following: content.dataset.followingLatest === 'true',
          }),
          fixed: header === document.querySelector('.preparation-workspace > .page-toolbar') &&
            composer === document.querySelector('.chat-composer') &&
            [header, composer].every((node, index) =>
              bounds(node).every((value, key) => Math.abs(value - initial[index][key]) <= 1) &&
              Number(getComputedStyle(node).opacity) === 1 && node.getAnimations().length === 0),
        });
        frame = requestAnimationFrame(sample);
      };
      sample();
      window.conversationFrames = {
        stop: () => {
          cancelAnimationFrame(frame);
          return { frames, animations: animations.size, states: [...animations].map((animation) => animation.playState) };
        },
      };
    }, anchor);
  };
  const finishFrames = async (animate, settlingFrames = 0) => {
    await page.waitForFunction(() => !document.querySelector('.chat-scroll, .welcome')?.getAnimations().length);
    const result = await page.evaluate(async (settlingFrames) => {
      if (settlingFrames) {
        const until = performance.now() + 350;
        for (let i = 0; i < settlingFrames || performance.now() < until; i++) await new Promise(requestAnimationFrame);
      }
      const result = window.conversationFrames.stop();
      delete window.conversationFrames;
      return result;
    }, settlingFrames);
    assert.ok(result.frames.every((frame) => frame.fixed), 'Toolbar/composer DOM and bounds stay fixed');
    assert.ok(result.frames.every((frame) => frame.active <= 1), 'Rapid switches never stack content animations');
    assert.ok(result.states.every((state) => state === 'idle'), 'Finished/replaced animations release their effects');
    if (animate)
      assert.ok(result.frames.some((frame) => frame.opacity > 0 && frame.opacity < 1 && frame.y > 0),
        'Only chat content must have intermediate fade/slide frames');
    else assert.equal(result.animations, 0, 'Deltas and reduced motion must not start conversation animations');
    return result;
  };
  const expectIncomingPosition = async (top) => {
    const result = await finishFrames(true);
    assert.equal(result.animations, 1, 'A conversation switch starts one content animation');
    const incoming = result.frames.filter(frame => frame.active);
    assert.ok(incoming.every((frame, index) => !index || frame.y <= incoming[index - 1].y + 0.1),
      'The incoming viewport moves upward toward its resting position');
    const first = result.frames.findIndex(frame => frame.active);
    assert.ok(result.frames.slice(first).every(frame => Math.abs(frame.scrollTop - top) <= 1),
      'The saved reading position is already in place throughout the incoming animation');
  };

  const checkLongEntrance = async (titles, following) => {
    const anchor = await chat.evaluate((node, titles) => {
      const answers = [...node.querySelectorAll('.chat-answer')];
      if (answers.length !== titles.length) throw Error(`Expected ${titles.length} answers, found ${answers.length}`);
      answers.forEach((answer, turn) => {
        const parts = [...answer.querySelectorAll('.markdown-content > p')];
        if (parts.length !== 120 || parts.some((p, i) =>
          p.textContent !== `${titles[turn]} 段落 ${i + 1}：用于检查独立聊天的阅读位置和流式回复。`))
          throw Error(`Expected the 120 numbered paragraphs in answer ${turn + 1}, found ${parts.length}`);
      });
      const paragraphs = [...node.querySelectorAll('.chat-answer .markdown-content > p')];
      const headerY = document.querySelector('.preparation-workspace > .page-toolbar').getBoundingClientRect().bottom;
      const top = Math.max(headerY, node.getBoundingClientRect().top,
        document.querySelector('.chat-settings-notices').getBoundingClientRect().bottom);
      const bottom = Math.min(node.getBoundingClientRect().bottom, document.querySelector('.chat-composer').getBoundingClientRect().top);
      const center = (top + bottom) / 2;
      const visible = paragraphs.filter(p => {
        const rect = p.getBoundingClientRect();
        return rect.top >= top && rect.bottom <= bottom;
      });
      const p = visible.sort((a, b) =>
        Math.abs(a.getBoundingClientRect().top - center) - Math.abs(b.getBoundingClientRect().top - center))[0];
      if (!p) throw Error('No complete numbered paragraph is visible between the header/notices and composer');
      return { index: paragraphs.indexOf(p), text: p.textContent, y: p.getBoundingClientRect().top - headerY,
        top: node.scrollTop, maxTop: node.scrollHeight - node.clientHeight,
        viewport: `${window.innerWidth}×${window.innerHeight}`, paragraphs: paragraphs.length };
    }, titles);
    assert.ok(anchor.maxTop > 900 && (following ? Math.abs(anchor.top - anchor.maxTop) <= 1 :
      Math.abs(anchor.top - anchor.maxTop / 2) <= 1), 'Start at the real bottom or midpoint of a long chat');
    await page.getByRole('button', { name: '新对话', exact: true }).click();
    await page.locator('.welcome').waitFor();
    await startFrames(anchor);
    await select(titles[0]);
    const result = await finishFrames(true, 8);
    const frames = result.frames.filter(frame => Object.hasOwn(frame, 'paragraphY'));
    assert.equal(result.animations, 1, 'Only the returning conversation animates');
    assert.ok(frames.length && frames.every(frame => Number.isFinite(frame.paragraphY)),
      'The same numbered paragraph must be present from the first chat frame');
    assert.ok(frames.every(frame => !frame.historicalEntrances), 'Restoring a conversation does not replay sent-message entrances');
    const lastMoving = frames.findLastIndex(frame => frame.active);
    const tail = frames.slice(lastMoving + 1);
    assert.ok(lastMoving >= 0 && tail.length >= 6, 'Observe the last moving frame and at least six subsequent rendered frames');
    const restingY = tail[0].paragraphY;
    const endDrift = Math.max(...tail.map(frame => Math.abs(frame.paragraphY - restingY)));
    const handoffStep = Math.abs(tail[0].paragraphY - frames[lastMoving].paragraphY);
    const maxUnexpectedMove = Math.max(...frames.map(frame => Math.abs(frame.paragraphY - restingY - frame.y)));
    const restoreError = Math.abs(restingY - anchor.y);
    const rise = frames[0].paragraphY - tail.at(-1).paragraphY;
    const metrics = `${following ? 'bottom' : 'midpoint'}: viewport ${anchor.viewport}, paragraph ${anchor.index + 1}/${anchor.paragraphs}, scrollTop ${anchor.top.toFixed(2)}/${anchor.maxTop}px, end bottom gap ${tail.at(-1).bottomGap.toFixed(2)}px, visible Y ${frames[0].paragraphY.toFixed(2)}→${tail.at(-1).paragraphY.toFixed(2)}px, handoff ${handoffStep.toFixed(2)}px, drift ${endDrift.toFixed(2)}px across ${tail.length} settled frames, tracking error ${maxUnexpectedMove.toFixed(2)}px, restore error ${restoreError.toFixed(2)}px`;
    assert.ok(frames.every((frame, index) => frame.following === following &&
      Math.abs(frame.scrollTop - anchor.top) <= 1 && Math.abs(frame.bottomGap - (anchor.maxTop - anchor.top)) <= 1 &&
      (!index || frame.paragraphY <= frames[index - 1].paragraphY + 0.1)), metrics);
    assert.ok(rise > 0.5 && handoffStep <= 0.75 && endDrift <= 0.75 && maxUnexpectedMove <= 0.75 && restoreError <= 0.75, metrics);
    console.log(`Long chat entrance ${metrics}`);
  };

  // At fractional DPI, the penultimate spring frame can already be within one CSS pixel.
  const waitForSettledBottom = () => chat.evaluate(async node => {
    const deadline = performance.now() + 5000;
    let stable = 0, previousTop = NaN;
    while (stable < 8) {
      if (performance.now() > deadline) throw Error('Bottom following did not settle before navigation');
      await new Promise(requestAnimationFrame);
      const top = node.scrollTop;
      const atBottom = node.dataset.followingLatest === 'true' && Math.abs(node.scrollHeight - node.clientHeight - top) <= 1;
      stable = top === previousTop && atBottom ? stable + 1 : 0;
      previousTop = top;
    }
  });
  const measureSentTurn = async (title) => {
    await composerInput.fill(title);
    await waitForSettledBottom();
    await chat.evaluate((node, title) => {
      const before = node.scrollTop;
      const visibleTop = document.querySelector('.preparation-workspace > .page-toolbar').getBoundingClientRect().bottom;
      const visibleBottom = document.querySelector('.chat-composer').getBoundingClientRect().top;
      const oldParagraph = [...node.querySelectorAll('.chat-answer .markdown-content > p')].find(p => {
        const rect = p.getBoundingClientRect();
        return rect.top >= visibleTop && rect.bottom <= visibleBottom;
      });
      if (!oldParagraph) throw Error('No existing answer paragraph is visible before sending');
      const baselineY = oldParagraph.getBoundingClientRect().top;
      window.sentTurnFrames = (async () => {
        const frames = [];
        let started;
        const deadline = performance.now() + 5000;
        while (performance.now() < deadline) {
          await new Promise(requestAnimationFrame);
          const group = [...node.querySelectorAll('.chat-message.user')].at(-1);
          if (group?.querySelector('.user-message-text')?.textContent !== title) continue;
          started ??= performance.now();
          const motion = group.getAnimations().find(a => a.animationName === 'screen-enter');
          const style = getComputedStyle(group);
          const y = group.getBoundingClientRect().top;
          const children = ['.user-bubble', '.user-message-text', '.chat-message-time', '.chat-copy']
            .map(selector => group.querySelector(selector));
          frames.push({ y, scroll: node.scrollTop - before, oldShift: baselineY - oldParagraph.getBoundingClientRect().top,
            transformY: style.transform === 'none' ? 0 : new DOMMatrix(style.transform).m42,
            opacity: Number(style.opacity), motion: !!motion,
            duration: motion?.effect.getTiming().duration, delay: motion?.effect.getTiming().delay,
            together: children.every(child => child && (!motion || child.closest('.sent-message-enter') === group) &&
              getComputedStyle(child).transform === 'none' && child.getAnimations().every(a => a.animationName !== 'screen-enter')),
            offsets: children.map(child => child && child.getBoundingClientRect().top - y),
            other: node.querySelectorAll('.sent-message-enter').length - Number(!!motion),
          });
          if (performance.now() - started > 350) return frames;
        }
        throw Error('The sent message group did not appear');
      })();
    }, title);
    await page.getByRole('button', { name: '发送消息', exact: true }).click();
    const frames = await page.evaluate(() => window.sentTurnFrames);
    await page.evaluate(() => { delete window.sentTurnFrames; });
    const first = frames[0], last = frames.at(-1);
    assert.ok(first.motion && first.duration === 240 && first.delay === 0 && !last.motion, 'The page entrance starts on the first message frame');
    assert.ok(frames.some(f => f.opacity > 0 && f.opacity < 1 && f.transformY > 0) &&
      frames.every(f => f.together && !f.other && f.transformY >= 0 && f.transformY <= 8.01 &&
        f.offsets.every((value, i) => Math.abs(value - first.offsets[i]) <= 0.75)),
      'Bubble, text, timestamp and copy button share the same fade and translation');
    const local = first.transformY - last.transformY;
    const scroll = last.scroll - first.scroll;
    const screen = first.y - last.y;
    assert.ok(frames.every(f => Math.abs(f.oldShift - f.scroll) <= 1) && scroll > 8 &&
      Math.abs(screen - scroll - local) <= 1, 'The independent follow scroll adds to the group entrance');
    console.log(`Sent message: local ${local.toFixed(2)}px, follow scroll ${scroll.toFixed(2)}px, screen ${screen.toFixed(2)}px, four elements together, 240ms, no delay.`);
    await waitForAsync(app, (_electron, title) => globalThis.conversationReplies.has(title), title);
    await app.evaluate((_electron, title) => globalThis.conversationReplies.get(title).sendRemaining(), title);
    await page.locator('.chat-answer').getByText(`${title} 段落 120：用于检查独立聊天的阅读位置和流式回复。`, { exact: true }).waitFor();
  };

  await send('滚动对话 A');
  await finish('滚动对话 A');
  await scrollTo(await chat.evaluate(node => Math.round((node.scrollHeight - node.clientHeight) / 2)));
  await checkLongEntrance(['滚动对话 A'], false);
  await page.locator('.chat-composer').getByRole('button', { name: /返回最新/ }).click();
  await measureSentTurn('第二轮追问');
  await finish('第二轮追问');
  await waitForSettledBottom();
  await checkLongEntrance(['滚动对话 A', '第二轮追问'], true);
  await scrollTo(900);
  await page.getByRole('button', { name: '新对话', exact: true }).click();
  await send('滚动对话 B');
  await finish('滚动对话 B');
  await scrollTo(450);
  await page.getByRole('button', { name: '新对话', exact: true }).click();
  await send('短对话');
  assert.ok(await chat.evaluate((node) => node.scrollHeight - node.clientHeight < 450), 'Short chat clamps old offsets');
  await select('滚动对话 A');
  await expectPosition(900);
  await startFrames();
  await select('滚动对话 B');
  await expectPosition(450);
  await expectIncomingPosition(450);
  await startFrames();
  await page.getByRole('button', { name: '新对话', exact: true }).click();
  await page.locator('.welcome').waitFor();
  await finishFrames(true);
  await startFrames();
  await select('滚动对话 A');
  await expectPosition(900);
  await expectIncomingPosition(900);
  await page.getByRole('button', { name: '知识库', exact: true }).click();
  await page.locator('.knowledge-page').waitFor();
  const firstVisible = page.waitForFunction(() => {
    const node = document.querySelector('.preparation-route:not([hidden]) .chat-scroll');
    return node?.clientHeight ? { top: node.scrollTop } : false;
  });
  await select('滚动对话 A');
  const position = await firstVisible;
  assert.ok(Math.abs((await position.jsonValue()).top - 900) <= 1, 'Returning from another page restores the first visible frame');
  await position.dispose();
  await expectPosition(900);
  await page.waitForFunction(() => !document.documentElement.dataset.viewDirection);

  // A hidden stream belongs to its chat; returning restores the reader rather
  // than the old DOM's clamp or the background reply's latest position.
  await send('流式追加');
  await select('滚动对话 B');
  await expectPosition(450);
  await app.evaluate(() => globalThis.conversationReplies.get('流式追加').append('\n\n后台新增片段。'));
  await expectPosition(450);
  await select('滚动对话 A');
  await page.getByText('后台新增片段。', { exact: true }).waitFor();
  await expectPosition(900);
  await page.getByRole('button', { name: '有新回复 · 返回最新', exact: true }).waitFor();

  // A native scroll can precede its notification. Keep the hook's last real
  // snapshot at 1100 while moving the actual DOM to 1250, then deliver a real
  // provider delta before allowing React to receive the delayed scroll.
  await scrollTo(1100);
  await chat.evaluate((node) => {
    let blocked = 0;
    const delay = (event) => {
      if (event.target !== node) return;
      blocked++;
      event.stopImmediatePropagation();
    };
    window.addEventListener('scroll', delay, true);
    window.conversationDelayedScroll = {
      blocked: () => blocked,
      release: () => {
        window.removeEventListener('scroll', delay, true);
        node.dispatchEvent(new Event('scroll', { bubbles: true }));
      },
    };
    node.scrollTop = 1250;
  });
  try {
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await expectPosition(1250);
    assert.ok(
      await page.evaluate(() => window.conversationDelayedScroll.blocked() > 0),
      'The native scroll notification must actually be delayed before the provider delta',
    );
    await app.evaluate(() => globalThis.conversationReplies.get('流式追加').append('\n\n延迟滚动通知期间的真实追加片段。'));
    await page.getByText('延迟滚动通知期间的真实追加片段。', { exact: true }).waitFor();
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await expectPosition(1250);
  } finally {
    await page.evaluate(() => {
      window.conversationDelayedScroll.release();
      delete window.conversationDelayedScroll;
    });
  }
  await select('滚动对话 B');
  await expectPosition(450);
  await select('滚动对话 A');
  await expectPosition(1250);
  await scrollTo(900);

  await page.waitForFunction(() => !document.querySelector('.chat-scroll').getAnimations().length);
  await startFrames();
  await app.evaluate(() => globalThis.conversationReplies.get('流式追加').append('\n\n前台新增片段。'));
  await page.getByText('前台新增片段。', { exact: true }).waitFor();
  await finish('流式追加');
  await expectPosition(900);
  await finishFrames(false);
  await assertSmoothFollow(chat, page.getByRole('button', { name: '有新回复 · 返回最新', exact: true }));

  await startFrames();
  await page.evaluate(async () => {
    for (const title of ['滚动对话 B', '滚动对话 A', '滚动对话 B']) {
      [...document.querySelectorAll('.conversation-row .conversation')]
        .find((node) => node.querySelector(':scope > span:last-child')?.textContent.trim() === title).click();
      await new Promise(requestAnimationFrame);
    }
  });
  await expectPosition(450);
  await finishFrames(true);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await startFrames();
  await select('滚动对话 A');
  await page.waitForFunction(() => {
    const node = document.querySelector('.chat-scroll');
    return node.scrollHeight - node.clientHeight - node.scrollTop <= 1;
  });
  await finishFrames(false);
  await scrollTo(900);
  const reducedFollow = page.getByRole('button', { name: '返回最新回复', exact: true });
  assert.ok(await reducedFollow.evaluate((button) => {
    button.click();
    const node = document.querySelector('.chat-scroll');
    return node.scrollHeight - node.clientHeight - node.scrollTop <= 1;
  }), 'Reduced motion reaches the bottom immediately');
  await page.emulateMedia({ reducedMotion: 'no-preference' });

  const newChat = page.getByRole('button', { name: '新对话', exact: true });
  const stopReply = page.getByRole('button', { name: '停止回复', exact: true });
  const firstChat = '并发对话甲';
  const secondChat = '并发对话乙';
  await newChat.click();
  await send(firstChat);
  await newChat.click();
  await page.locator('.welcome').waitFor();
  assert.equal(await stopReply.count(), 0, 'A new chat must not show another chat’s Stop button');
  await send(secondChat);
  const running = () => app.evaluate(() => [...globalThis.conversationReplies.keys()].sort());
  assert.deepEqual(await running(), [firstChat, secondChat].sort());
  assert.equal(await page.locator('.conversation-dot[data-state="streaming"]').count(), 2);
  await app.evaluate((_electron, [a, b]) => {
    globalThis.conversationReplies.get(a).append('\n\n只属于甲的增量。');
    globalThis.conversationReplies.get(b).append('\n\n只属于乙的增量。');
  }, [firstChat, secondChat]);
  await page.getByText('只属于乙的增量。', { exact: true }).waitFor();
  assert.equal(await page.getByText('只属于甲的增量。', { exact: true }).count(), 0);
  await select(firstChat);
  await page.getByText('只属于甲的增量。', { exact: true }).waitFor();
  assert.equal(await page.getByText('只属于乙的增量。', { exact: true }).count(), 0);
  await composerInput.fill('甲的未发送草稿');
  await stopReply.click();
  await waitForAsync(app, (_electron, a) => !globalThis.conversationReplies.has(a), firstChat);
  assert.deepEqual(await running(), [secondChat], 'Stopping A leaves B running');
  assert.equal(await composerInput.inputValue(), '甲的未发送草稿');
  await page.getByRole('button', { name: '重试回答', exact: true }).click();
  await waitForAsync(app, (_electron, a) => globalThis.conversationReplies.has(a), firstChat);
  assert.deepEqual(await running(), [firstChat, secondChat].sort(), 'A can retry while B is running');
  await app.evaluate((_electron, b) => globalThis.conversationReplies.get(b).finish(), secondChat);
  await page.locator('.conversation-row').filter({ hasText: secondChat })
    .locator('.conversation-dot[data-state="unread"]').waitFor();
  assert.deepEqual(await running(), [firstChat]);
  assert.equal(await stopReply.count(), 1, 'A background completion cannot stop the current chat');
  await select(secondChat);
  assert.equal(await stopReply.count(), 0, 'Completed B is ready to send while A is still running');
  await page.getByText('只属于乙的增量。', { exact: true }).waitFor();
  await select(firstChat);
  assert.equal(await composerInput.inputValue(), '甲的未发送草稿');
  await finish(firstChat);
  assert.deepEqual(await running(), []);
  console.log('Parallel chats: two live requests, isolated deltas, independent stop/retry, draft retained and background completion.');
  assert.deepEqual(errors, []);
  console.log(
    'PASS: switching/deletion, per-chat reading positions across short/welcome/hidden views, delayed scroll notification with real provider delta, background streams/latest, chat-only motion, fixed chrome, rapid switching and reduced motion.',
  );
} finally {
  await closeUiApp(app);
}
