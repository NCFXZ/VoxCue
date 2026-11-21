import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { testRoot, electron } from './test-workspace.mjs';
import { closeUiApp, connectUiAccount, focusUiWindow, installUiAccount, openModelMenu } from './install-ui-account.mjs';
import { offlineElectronEntry } from './offline-electron-entry.mjs';

const profile = path.resolve(testRoot, 'test/results', `conversation-status-${Date.now()}`);
await mkdir(profile, { recursive: true });
const env = { ...process.env, COPILOT_TEST_USER_DATA: profile, VITE_DEV_SERVER_URL: '' };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: [await offlineElectronEntry()], env });

try {
  await installUiAccount(app);
  await app.evaluate(({ app }) => {
    const require = process.getBuiltinModule('module').createRequire(app.getAppPath() + '/package.json');
    const { ChatGPTService } = require('./dist-electron/shared/electron/backend/chat/service.js');
    ChatGPTService.prototype.stream = async (request, emit, signal) => {
      emit({ id: request.id, type: 'activity', activity: { phase: 'thinking' } });
      let answerText = '';
      globalThis.appendReply = text => {
        answerText += text;
        emit({ id: request.id, type: 'delta', text });
      };
      try {
        await new Promise((resolve, reject) => {
          globalThis.finishReply = resolve;
          signal.addEventListener('abort', () => reject(new DOMException('Stopped', 'AbortError')), { once: true });
        });
        return { answerText: answerText || 'Synthetic completed answer', usage: null, sources: [] };
      } finally {
        delete globalThis.appendReply;
        delete globalThis.finishReply;
      }
    };
  });
  const page = await connectUiAccount(app, await app.firstWindow());
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  // Give both ends of the pulse a known contrast, independent of the OS accent.
  await page.addStyleTag({ content: '.sidebar-conversations { --system-accent: #0078d4; }' });
  const accent = [0, 120, 212, 255];
  const models = await openModelMenu(page);
  await models.getByRole('menuitemradio', { name: 'Test Model', exact: true }).click();
  await page.keyboard.press('Escape');
  await focusUiWindow(app, page);
  const streaming = page.locator('.conversation-dot[data-state="streaming"]');
  const send = async (title) => {
    await page.getByRole('textbox', { name: '聊天消息', exact: true }).fill(title);
    await page.getByRole('button', { name: '发送消息', exact: true }).click();
    await streaming.waitFor();
  };
  const finish = async () => {
    await app.evaluate(async () => {
      for (let i = 0; i < 100 && typeof globalThis.finishReply !== 'function'; i++)
        await new Promise((resolve) => setTimeout(resolve, 20));
      globalThis.finishReply();
    });
    await streaming.waitFor({ state: 'detached' });
  };
  await send('后台回复状态');
  const row = page.locator('.conversation-row').filter({ hasText: '后台回复状态' });
  const button = row.locator('.conversation');
  assert.match(await button.getAttribute('aria-label'), /正在回复/);
  const slot = await row.locator('.conversation-indicator').boundingBox();
  assert.ok(Math.abs(slot.width - 14) < 0.01 && Math.abs(slot.height - 14) < 0.01);
  const dot = await row.locator('.conversation-dot').elementHandle();
  assert.equal(await dot.evaluate(node => getComputedStyle(node).clipPath), 'circle(50%)');
  await dot.evaluate((node) => {
    // Sample the center fill of the dot, including the status tint painted over its
    // paused pulse. Chromium converts both computed CSS colors to the same sRGB space.
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    const paint = (color, opacity = 1) => {
      context.globalAlpha = opacity;
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
    };
    const pixel = () => Array.from(context.getImageData(0, 0, 1, 1).data);
    node.sampleStatusDot = () => {
      context.clearRect(0, 0, 1, 1);
      paint(getComputedStyle(node).backgroundColor);
      const overlay = getComputedStyle(node, '::after');
      if (!['none', 'normal'].includes(overlay.content) && overlay.display !== 'none' && overlay.visibility === 'visible')
        paint(overlay.backgroundColor, Number(overlay.opacity));
      const { width, height } = node.getBoundingClientRect();
      return { width, height, color: pixel() };
    };
  });
  const grey = [152, 165, 166, 255];
  const diameter = 5;
  const assertBreathing = async (phase) => {
    const pulse = await dot.evaluate(async (node, { accent, grey, diameter }) => {
      const distance = (color, other) => Math.hypot(...color.map((channel, i) => channel - other[i]));
      const range = distance(accent, grey);
      const colors = new Set();
      let sizeError = 0, strong = -Infinity, faint = Infinity, brightened = false, dimmed = false;
      let peakColor;
      const start = performance.now();
      do {
        await new Promise(requestAnimationFrame);
        const { width, height, color } = node.sampleStatusDot();
        sizeError = Math.max(sizeError, Math.abs(width - diameter), Math.abs(height - diameter));
        colors.add(color.join(','));
        const strength = distance(color, grey) / range;
        brightened ||= strength - faint > 0.4;
        dimmed ||= strong - strength > 0.4;
        if (strength > strong) peakColor = color;
        strong = Math.max(strong, strength);
        faint = Math.min(faint, strength);
        if (performance.now() - start >= 2200 && strong > 0.9 && faint < 0.1 && brightened && dimmed) break;
      } while (performance.now() - start < 5000);
      return { sizeError, colors: colors.size, strong, faint, brightened, dimmed, peakColor, accent,
        accentCss: getComputedStyle(node).getPropertyValue('--system-accent'),
        state: node.dataset.state, overlay: getComputedStyle(node, '::after').opacity };
    }, { accent, grey, diameter });
    assert.ok(pulse.sizeError < 0.02 && pulse.colors > 5 && pulse.strong > 0.9 && pulse.faint < 0.1 &&
      pulse.brightened && pulse.dimmed,
      phase + ': ' + JSON.stringify(pulse));
  };
  await page.locator('.chat-message.assistant').last().getByText(/^正在思考/).first().waitFor();
  await assertBreathing('Thinking');
  await app.evaluate(() => globalThis.appendReply('Synthetic'));
  const partial = page.locator('.chat-message.assistant').last().locator('.chat-answer');
  await partial.getByText('Synthetic', { exact: true }).waitFor();
  await Promise.all([
    assertBreathing('Writing'),
    app.evaluate(async () => {
      for (const letter of ' completed answer') {
        await new Promise(resolve => setTimeout(resolve, 160));
        globalThis.appendReply(letter);
      }
    }),
  ]);
  await partial.getByText('Synthetic completed answer', { exact: true }).waitFor();

  // Arm the observer while a visible pulse is partway through the opposite leg.
  // Sample the frame before the state change and its first computed appearance.
  const checkHandoff = async (name, towardBright, change) => {
    await dot.evaluate(async (node, { towardBright, grey, accent }) => {
      const sample = () => node.sampleStatusDot();
      if (towardBright !== null) {
        const distance = color => Math.hypot(...color.map((channel, i) => channel - grey[i]));
        const range = distance(accent);
        let previous = distance(sample().color) / range;
        const until = performance.now() + 4200;
        for (;;) {
          await new Promise(requestAnimationFrame);
          const current = distance(sample().color) / range;
          if ((towardBright ? current > previous : current < previous) && current > 0.4 && current < 0.6) break;
          previous = current;
          if (performance.now() > until) throw Error('Expected an intermediate breath');
        }
      }
      let previous = sample(), frame;
      const record = () => { previous = sample(); frame = requestAnimationFrame(record); };
      frame = requestAnimationFrame(record);
      node.dotHandoff = null;
      const observer = new MutationObserver(() => {
        cancelAnimationFrame(frame);
        observer.disconnect();
        const samples = [sample()];
        const until = performance.now() + 450;
        const follow = () => {
          samples.push(sample());
          if (performance.now() < until) requestAnimationFrame(follow);
          else node.dotHandoff = { previous, samples };
        };
        requestAnimationFrame(follow);
      });
      observer.observe(node, { attributes: true, attributeFilter: ['data-state'] });
    }, { towardBright, accent, grey });
    await change();
    // A page switch clears unread only after the view-transition callback commits.
    await page.waitForFunction((node) => !node.isConnected || !!node.dotHandoff, dot);
    const state = await dot.evaluate((node) => ({ sameDot: node.isConnected, ...node.dotHandoff }));
    assert.ok(state.sameDot && state.previous && state.samples.length > 2, name + ' retains its dot');
    const first = state.samples[0], last = state.samples.at(-1);
    assert.ok([state.previous, ...state.samples].every(frame =>
      Math.abs(frame.width - diameter) < 0.02 && Math.abs(frame.height - diameter) < 0.02), name + ' keeps its diameter');
    assert.ok(state.previous.color.every((value, i) => Math.abs(value - first.color[i]) < 34),
      name + ' retains its visible color');
    assert.ok(state.samples.some(({ color }) => color.some((value, i) =>
      value > Math.min(first.color[i], last.color[i]) + 1 && value < Math.max(first.color[i], last.color[i]) - 1)),
      name + ' passes through intermediate colors');
  };
  const settled = async (state, color) => {
    await page.waitForFunction(({ state, diameter, color, node }) => {
      const { width, height, color: visible } = node.sampleStatusDot();
      return node.dataset.state === state && Math.abs(width - diameter) < 0.02 &&
        Math.abs(height - diameter) < 0.02 && color.every((channel, i) => visible[i] === channel);
    }, { node: dot, state, diameter, color });
  };
  await page.getByRole('button', { name: '知识库', exact: true }).click();
  await page.locator('main.knowledge-page').waitFor();
  await checkHandoff('Background completion', false, finish);
  await settled('unread', accent);
  assert.match(await button.getAttribute('aria-label'), /回复完成，尚未查看/);
  await checkHandoff('View completed reply', null, () => button.click());
  await page.getByText('Synthetic completed answer', { exact: true }).waitFor();
  await settled('read', grey);
  await send('前台正在查看');
  await checkHandoff('Foreground completion', true, finish);
  await settled('read', grey);

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await send('手动停止');
  await settled('streaming', accent);
  assert.ok(await dot.evaluate(async (node, { accent, diameter }) => {
    const until = performance.now() + 1400;
    do {
      await new Promise(requestAnimationFrame);
      const { width, height, color } = node.sampleStatusDot();
      if (node.getAnimations({ subtree: true }).length || !accent.every((channel, i) => color[i] === channel) ||
          Math.abs(width - diameter) >= 0.02 || Math.abs(height - diameter) >= 0.02) return false;
    } while (performance.now() < until);
    return true;
  }, { accent, diameter }), 'Reduced motion stays steady over a full pulse leg');
  await page.getByRole('button', { name: '停止回复', exact: true }).click();
  await settled('read', grey);
  assert.deepEqual(errors, []);
  console.log('PASS: sidebar dot breathes, settles continuously on completion and read, and respects reduced motion.');
} finally {
  await closeUiApp(app);
}
