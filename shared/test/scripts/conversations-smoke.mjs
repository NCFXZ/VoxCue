import { connectUiAccount, installUiAccount, closeUiApp } from './install-ui-account.mjs';
import { testRoot, electron } from './test-workspace.mjs';
import { offlineElectronEntry } from './offline-electron-entry.mjs';
import { waitForAsync } from './wait-for-async.mjs';

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
    ChatGPTService.prototype.stream = async (request, emit, signal) => {
      const title = request.turns.at(-1).content;
      let content = title === '短对话'
        ? '短回复。'
        : Array.from({ length: 120 }, (_, index) =>
            `${title} 段落 ${index + 1}：用于检查独立聊天的阅读位置和流式回复。`,
          ).join('\n\n');
      emit({ id: request.id, type: 'delta', text: content });
      if (title !== '短对话') {
        let abort;
        try {
          await new Promise((resolve, reject) => {
            abort = () => reject(new DOMException('Stopped', 'AbortError'));
            signal.addEventListener('abort', abort, { once: true });
            globalThis.conversationReplies.set(title, {
              finish: resolve,
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
  await page.getByRole('textbox', { name: '聊天消息', exact: true }).fill('第一条对话');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await page.getByRole('button', { name: '停止回复', exact: true }).click();
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
  assert.equal(await page.locator('.conversation-row').count(), 1);
  assert.equal(await page.locator('.chat-message').count(), 0);
  const remaining = page.locator('.conversation-row');
  await remaining.locator('.conversation').click();
  await page.locator('.chat-message.user').getByText('第二条对话', { exact: true }).waitFor();
  await remaining.hover();
  await remaining.getByRole('button', { name: '删除对话：第二条对话', exact: true }).click();
  await page.screenshot({});
  await remaining.getByRole('button', { name: '确认删除：对话：第二条对话', exact: true }).click();
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
  const startFrames = async () => {
    await page.waitForFunction(() => !document.querySelector('.chat-thread, .welcome')?.getAnimations().length);
    await page.evaluate(() => {
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
      const sample = () => {
        const content = document.querySelector('.preparation-workspace .chat-thread, .preparation-workspace .welcome');
        const active = content?.getAnimations() ?? [];
        active.forEach((animation) => animations.add(animation));
        const style = content && getComputedStyle(content);
        frames.push({
          opacity: style ? Number(style.opacity) : 1,
          y: style && style.transform !== 'none' ? new DOMMatrix(style.transform).m42 : 0,
          active: active.length,
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
    });
  };
  const finishFrames = async (animate) => {
    await page.waitForFunction(() => !document.querySelector('.chat-thread, .welcome')?.getAnimations().length);
    const result = await page.evaluate(() => {
      const result = window.conversationFrames.stop();
      delete window.conversationFrames;
      return result;
    });
    assert.ok(result.frames.every((frame) => frame.fixed), 'Toolbar/composer DOM and bounds stay fixed');
    assert.ok(result.frames.every((frame) => frame.active <= 1), 'Rapid switches never stack content animations');
    assert.ok(result.states.every((state) => state === 'idle'), 'Finished/replaced animations release their effects');
    if (animate)
      assert.ok(result.frames.some((frame) => frame.opacity > 0 && frame.opacity < 1 && frame.y > 0),
        'Only chat content must have intermediate fade/slide frames');
    else assert.equal(result.animations, 0, 'Deltas and reduced motion must not start conversation animations');
    return result;
  };

  await send('滚动对话 A');
  await finish('滚动对话 A');
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
  assert.equal((await finishFrames(true)).animations, 1, 'A conversation switch starts one content animation');
  await startFrames();
  await page.getByRole('button', { name: '新对话', exact: true }).click();
  await page.locator('.welcome').waitFor();
  await finishFrames(true);
  await select('滚动对话 A');
  await expectPosition(900);
  await page.getByRole('button', { name: '知识库', exact: true }).click();
  await page.locator('.knowledge-page').waitFor();
  await select('滚动对话 A');
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

  await page.waitForFunction(() => !document.querySelector('.chat-thread').getAnimations().length);
  await startFrames();
  await app.evaluate(() => globalThis.conversationReplies.get('流式追加').append('\n\n前台新增片段。'));
  await page.getByText('前台新增片段。', { exact: true }).waitFor();
  await finish('流式追加');
  await expectPosition(900);
  await finishFrames(false);
  await page.getByRole('button', { name: '有新回复 · 返回最新', exact: true }).click();
  await page.waitForFunction(() => {
    const node = document.querySelector('.chat-scroll');
    return node.scrollHeight - node.clientHeight - node.scrollTop <= 1;
  });

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
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  assert.deepEqual(errors, []);
  console.log(
    'PASS: switching/deletion, per-chat reading positions across short/welcome/hidden views, delayed scroll notification with real provider delta, background streams/latest, chat-only motion, fixed chrome, rapid switching and reduced motion.',
  );
} finally {
  await closeUiApp(app);
}
