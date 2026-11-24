import assert from 'node:assert/strict';
import path from 'node:path';
import { testRoot, electron } from './test-workspace.mjs';
import { offlineElectronEntry } from './offline-electron-entry.mjs';
import { closeUiApp, connectUiAccount, focusUiWindow, installUiAccount } from './install-ui-account.mjs';

const app = await electron.launch({
  args: [await offlineElectronEntry()],
  env: {
    ...process.env,
    COPILOT_TEST_USER_DATA: path.join(testRoot, 'composer-resize'),
    VITE_DEV_SERVER_URL: '',
  },
});

const lines = (rows) => Array.from({ length: rows }, (_, i) => `第 ${i + 1} 行合成输入`).join('\n');

async function sampleResize(input, edit) {
  await input.evaluate((node) => {
    const form = node.closest('form');
    const toolbar = form.querySelector('.composer-bottom, .floating-composer-toolbar');
    const frames = [];
    let frame;
    const sample = () => {
      frames.push({
        height: node.getBoundingClientRect().height,
        composer: form.getBoundingClientRect().height,
        bottom: form.getBoundingClientRect().bottom,
        toolbar: toolbar.getBoundingClientRect().top,
        easings: node.getAnimations().map((animation) => animation.effect.getTiming().easing),
      });
    };
    const tick = () => {
      sample();
      frame = requestAnimationFrame(tick);
    };
    tick();
    window.readComposerFrames = () => {
      cancelAnimationFrame(frame);
      sample();
      return frames;
    };
  });
  await edit();
  return input.evaluate(async (node) => {
    await Promise.all(node.getAnimations().map((animation) => animation.finished));
    const frames = window.readComposerFrames();
    delete window.readComposerFrames;
    return frames;
  });
}

const click = (button) => button.evaluate((node) => node.click());

async function verifyEditor(page, label, minRows, maxRows) {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const input = page.getByRole('textbox', { name: label, exact: true });
  await input.waitFor();
  const resize = async (value, direction, motion = true) => {
    const frames = await sampleResize(input, () => input.fill(value));
    const first = frames[0];
    const last = frames.at(-1);
    assert.ok(direction * (last.height - first.height) > 10, `${label} changes height`);
    const easings = frames.flatMap(({ easings }) => easings);
    assert.equal(easings.length > 0, motion, `${label} has the requested motion preference`);
    assert.ok(easings.every((easing) => easing.startsWith('cubic-bezier')));
    if (motion) {
      const intermediate = frames.filter(({ height }) =>
        direction * (height - first.height) > 0.5 && direction * (last.height - height) > 0.5);
      assert.ok(intermediate.length >= 3, `${label} renders intermediate heights`);
    }
    for (const [index, frame] of frames.entries()) {
      const previous = frames[Math.max(0, index - 1)];
      assert.ok(direction * (frame.height - previous.height) >= -0.1, `${label} resizes without reversing`);
      assert.ok(Math.abs(frame.composer - first.composer - (frame.height - first.height)) < 1);
      assert.ok(Math.abs(frame.bottom - first.bottom) < 1 && Math.abs(frame.toolbar - first.toolbar) < 1,
        `${label} keeps the toolbar and bottom edge anchored`);
    }
    return last.height;
  };
  const start = await input.evaluate((node) => node.getBoundingClientRect().height);
  const wrapped = await resize('需要自动换行的合成文字。'.repeat(30), 1);
  assert.ok(wrapped > start);
  const cleared = await resize('', -1);
  assert.ok(Math.abs(cleared - start) < 1);
  for (const rows of [...Array.from({ length: maxRows - minRows + 1 }, (_, i) => i + minRows), maxRows - 1, minRows]) {
    await input.fill(lines(rows));
    const size = await input.evaluate(async (node) => {
      await Promise.all(node.getAnimations().map((animation) => animation.finished));
      return { height: node.getBoundingClientRect().height, line: parseFloat(getComputedStyle(node).lineHeight) };
    });
    assert.ok(Math.abs(size.height - rows * size.line) <= 1, JSON.stringify({ label, rows, ...size }));
  }
  const capped = await resize(lines(25), 1);
  await input.fill(lines(35));
  const scrolling = await input.evaluate((node) => ({
    height: node.getBoundingClientRect().height,
    scrollable: node.scrollHeight > node.clientHeight && getComputedStyle(node).overflowY === 'auto',
  }));
  assert.ok(scrolling.scrollable && Math.abs(scrolling.height - capped) < 1, `${label} scrolls at its cap`);
  await resize('', -1);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await resize(lines(maxRows), 1, false);
  await resize('', -1, false);
  await input.fill('中文组合输入草稿');
  await input.dispatchEvent('compositionstart', { data: '中' });
  await input.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', isComposing: true });
  assert.equal(await input.inputValue(), '中文组合输入草稿');
  await input.dispatchEvent('compositionend', { data: '中文' });
  await input.fill('');
  console.log(`${label} passed multiline motion, anchored controls, capped scrolling and reduced motion.`);
}

try {
  await installUiAccount(app, { speech: true, components: true });
  const main = await connectUiAccount(app, await app.firstWindow());
  await focusUiWindow(app, main);
  await verifyEditor(main, '聊天消息', 2, 11);
  assert.equal(await main.locator('.chat-message.user').count(), 0);
  await click(main.locator('.interview-start-trigger'));
  const opening = app.waitForEvent('window');
  await click(main.getByRole('button', { name: '确认开始', exact: true }));
  const interview = await opening;
  await interview.locator('.floating-composer').waitFor();
  await click(interview.getByRole('button', { name: '静音后自动提交完整问题', exact: true }));
  await interview.locator('.transcript-item p').filter({ hasText: /^Synthetic interviewer question$/ }).waitFor();
  await focusUiWindow(app, interview);
  await verifyEditor(interview, '面试提问', 1, 6);
} finally {
  await closeUiApp(app);
}
