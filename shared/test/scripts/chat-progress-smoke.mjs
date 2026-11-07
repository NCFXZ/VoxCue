import { testRoot, electron } from './test-workspace.mjs';
import { offlineElectronEntry } from './offline-electron-entry.mjs';
import { checkProgressMotion } from './check-progress-motion.mjs';

import { mkdir, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {
  connectUiAccount,
  installUiAccount,
  closeUiApp,
  focusUiWindow,
} from './install-ui-account.mjs';

await mkdir(path.join(testRoot, 'test/results'), { recursive: true });
const profile = await mkdtemp(path.resolve(path.join(testRoot, 'test/results/chat-progress-')));
const env = { ...process.env, COPILOT_TEST_USER_DATA: profile, VITE_DEV_SERVER_URL: '' };
delete env.ELECTRON_RUN_AS_NODE;
const executable = process.argv
  .find((arg) => arg.startsWith('--app-executable='))
  ?.slice('--app-executable='.length);
const packaged = !!executable;
const screenshotDirectory = process.argv
  .find((arg) => arg.startsWith('--screenshots='))
  ?.slice('--screenshots='.length);
if (screenshotDirectory) await mkdir(path.resolve(screenshotDirectory), { recursive: true });
const app = await electron.launch({
  ...(packaged ? { executablePath: path.resolve(executable) } : {}),
  args: packaged ? [] : [await offlineElectronEntry()],
  env,
});
const errors = [];
try {
  await app.evaluate(({ app }) => {
    const require = process
      .getBuiltinModule('module')
      .createRequire(app.getAppPath() + '/package.json');
    globalThis.actualChatStream = require(
      app.getAppPath() + '/dist-electron/shared/electron/backend/chat/service.js',
    ).ChatGPTService.prototype.stream;
  });
  await installUiAccount(app);
  await app.evaluate(({ app }) => {
    const require = process
      .getBuiltinModule('module')
      .createRequire(app.getAppPath() + '/package.json');
    const { ChatGPTService } = require(
      app.getAppPath() + '/dist-electron/shared/electron/backend/chat/service.js',
    );
    const { UsageLedger } = require(
      app.getAppPath() + '/dist-electron/shared/electron/backend/chat/usage.js',
    );
    const { profileFields } = require(
      app.getAppPath() + '/dist-electron/shared/electron/contracts/profile.js',
    );
    globalThis.progressRequests = [];
    const attempts = new Map();
    const native = new ChatGPTService({
      access: async () => ({ account: 'synthetic', token: 'synthetic-only' }),
      ledger: new UsageLedger(require('node:path').join(app.getPath('userData'), 'fixture-usage')),
      fetch: async (_url, init) => {
        const body = JSON.parse(init.body);
        const prompt = body.input.at(-1).content;
        attempts.set(prompt, (attempts.get(prompt) ?? 0) + 1);
        globalThis.progressRequests.push({
          prompt,
          input: body.input,
          instructions: body.instructions,
          tool_choice: body.tool_choice,
        });
        const changes = Object.fromEntries(profileFields.map((field) => [field, null]));
        if (prompt === '更新简历') changes.background = '已核对的合成简历摘要';
        if (prompt === '更新 JD') changes.jobDescription = 'TypeScript、接口边界与桌面应用。';
        // Typed requests are interpreted by the provider, not a client-side
        // Chinese keyword classifier. Model that decision in this fixture.
        if (
          body.instructions.includes('本次任务：按技能规则生成技能更新提案。') ||
          prompt === '请联网更新面试技能'
        ) {
          globalThis.skillResponseCount = (globalThis.skillResponseCount ?? 0) + 1;
          const retrieved = Array.from({ length: 7 }, (_, index) => ({
            title: `真实资料${index + 1}`,
            url: `https://example.com/docs/${index}/?utm_source=search`,
          }));
          changes.skills = Array.from({ length: 3 }, (_, index) => ({
            id: `skill-${index}`,
            title: `核心技能${index + 1}`,
            content: `精简技术重点与岗位关系，保留事实边界。版本${globalThis.skillResponseCount}。`,
            sources: [
              {
                title: '模型标题',
                url: (
                  globalThis.failSkillReference === 'partial'
                    ? index === 0
                    : globalThis.failSkillReference
                )
                  ? 'https://example.com/unretrieved'
                  : `https://example.com/docs/${index}/#section`,
              },
            ],
          }));
          const response = {
            id: `skills-${globalThis.skillResponseCount}`,
            object: 'response',
            status: 'completed',
            output: [
              {
                id: 'skills-message',
                type: 'message',
                content: [
                  {
                    type: 'output_text',
                    text: JSON.stringify({
                      answer: '已整理3项核心技能，请确认下方提案。',
                      changes,
                      skillScope: 'all',
                    }),
                  },
                ],
              },
            ],
          };
          return new Response(
            [
              {
                type: 'response.output_item.done',
                output_index: 0,
                item: {
                  id: 'skills-search',
                  type: 'web_search_call',
                  status: 'completed',
                  action: { type: 'search', sources: retrieved },
                },
              },
              {
                type: 'response.output_text.delta',
                output_index: 1,
                delta: response.output[0].content[0].text,
              },
              { type: 'response.completed', response },
            ]
              .map((event) => 'data: ' + JSON.stringify(event) + '\n\n')
              .join(''),
            { headers: { 'content-type': 'text/event-stream' } },
          );
        }
        const answer =
          prompt === '进度测试'
            ? '进度最终回答'
            : prompt === '失败后重试'
              ? '重试完成'
              : '普通问题已回答';
        const text = JSON.stringify({ answer, changes, skillScope: null });
        const terminal = {
          id: 'synthetic-' + globalThis.progressRequests.length,
          object: 'response',
          status: 'completed',
          output: [
            {
              id: 'final',
              type: 'message',
              phase: 'final_answer',
              content: [{ type: 'output_text', text }],
            },
          ],
          usage: { input_tokens: 1, output_tokens: 2, total_tokens: 3 },
        };
        if (!['进度测试', '失败后重试', '停止测试'].includes(prompt) || attempts.get(prompt) > 1)
          return Response.json(terminal);
        const encoder = new TextEncoder();
        const encode = (event) => encoder.encode('data: ' + JSON.stringify(event) + '\n\n');
        return new Response(
          new ReadableStream({
            start(controller) {
              globalThis.progressController = controller;
              globalThis.finishProgress = () => {
                terminal.output.unshift({
                  id: 'reason',
                  type: 'reasoning',
                  summary: [{ type: 'summary_text', text: '**梳理问题**\n\n已收到的公开摘要。' }],
                  encrypted_content: 'PRIVATE',
                });
                terminal.output.splice(1, 0, {
                  id: 'review',
                  type: 'reasoning',
                  summary: [{ type: 'summary_text', text: '**核对资料**\n\n整理公开来源。' }],
                });
                controller.enqueue(
                  encode({
                    type: 'response.output_item.added',
                    output_index: 4,
                    item: { ...terminal.output.at(-1), content: [] },
                  }),
                );
                controller.enqueue(
                  encode({ type: 'response.output_text.delta', output_index: 4, delta: text }),
                );
                controller.enqueue(encode({ type: 'response.completed', response: terminal }));
                controller.close();
              };
              const publicEvents = [
                { type: 'response.created' },
                { type: 'response.in_progress' },
                {
                  type: 'response.output_item.added',
                  output_index: 0,
                  item: { id: 'comment', type: 'message', phase: 'commentary', content: [] },
                },
                {
                  type: 'response.output_text.delta',
                  output_index: 0,
                  delta: '先核对两个官方来源。',
                },
                {
                  type: 'response.output_item.done',
                  output_index: 0,
                  item: {
                    id: 'comment',
                    type: 'message',
                    phase: 'commentary',
                    content: [{ type: 'output_text', text: '先核对两个官方来源。' }],
                  },
                },
                {
                  type: 'response.reasoning_summary_text.delta',
                  item_id: 'reason',
                  summary_index: 0,
                  delta: '**梳理问题**\n\n已收到的公开摘要。',
                },
                { type: 'response.reasoning_text.delta', delta: 'PRIVATE' },
                {
                  type: 'response.output_item.done',
                  output_index: 1,
                  item: {
                    id: 'search',
                    type: 'web_search_call',
                    status: 'completed',
                    action: { type: 'search', queries: ['official first', 'official second'] },
                  },
                },
                {
                  type: 'response.output_item.done',
                  output_index: 2,
                  item: {
                    id: 'read',
                    type: 'web_search_call',
                    status: 'completed',
                    action: {
                      type: 'open_page',
                      url: 'https://example.com/docs?secret=hidden#part',
                    },
                  },
                },
                {
                  type: 'response.output_item.done',
                  output_index: 3,
                  item: {
                    id: 'find',
                    type: 'web_search_call',
                    status: 'completed',
                    action: { type: 'find_in_page', url: 'https://example.com/docs' },
                  },
                },
                {
                  type: 'response.reasoning_summary_text.delta',
                  item_id: 'review',
                  summary_index: 0,
                  delta: '**核对资料**\n\n整理公开来源。',
                },
              ];
              for (const event of publicEvents) controller.enqueue(encode(event));
            },
          }),
          { headers: { 'content-type': 'text/event-stream' } },
        );
      },
    });
    ChatGPTService.prototype.stream = function (request, emit, signal) {
      return globalThis.actualChatStream.call(native, request, emit, signal);
    };
  });
  const login = await app.firstWindow();
  const page = await connectUiAccount(app, login);
  page.setDefaultTimeout(30000);
  page.on('pageerror', (error) => errors.push(error.message));
  const input = () => page.getByRole('textbox', { name: '聊天消息', exact: true });
  const latest = () => page.locator('.chat-message.assistant').last();
  const send = async (text) => {
    await input().fill(text);
    await page.getByRole('button', { name: '发送消息', exact: true }).click();
  };
  const completed = () => page.getByRole('button', { name: '发送消息', exact: true }).waitFor();
  const capture = async (name, target = page, animations = 'disabled') => {
    if (screenshotDirectory)
      await target.screenshot({
        path: path.join(path.resolve(screenshotDirectory), name + '.png'),
        animations,
      });
  };
  await input().waitFor();
  await page.waitForFunction(() => !document.querySelector('[aria-label="聊天消息"]').disabled);
  const measureInput = () =>
    input().evaluate((element) => ({
      height: element.getBoundingClientRect().height,
      width: element.clientWidth,
      line: parseFloat(getComputedStyle(element).lineHeight),
      scroll: element.scrollHeight,
      overflow: getComputedStyle(element).overflowY,
    }));
  const lineCount = async (expected) => {
    await page.waitForFunction((expected) => {
      const node = document.querySelector('[aria-label="聊天消息"]');
      return (
        Math.abs(
          node.getBoundingClientRect().height -
            parseFloat(getComputedStyle(node).lineHeight) * expected,
        ) < 1
      );
    }, expected);
  };
  await lineCount(2);
  await input().fill('第一行\n第二行\n第三行\n第四行');
  await lineCount(4);
  const longDraft = Array.from({ length: 20 }, (_, index) => `第${index + 1}行`).join('\n');
  await input().fill(longDraft);
  await lineCount(11);
  const capped = await measureInput();
  assert.ok(capped.scroll > capped.height && capped.overflow === 'auto');
  const composerBounds = await page.locator('.composer').evaluate((node) => {
    const bounds = node.getBoundingClientRect();
    return { top: bounds.top, bottom: bounds.bottom, viewportHeight: innerHeight };
  });
  assert.ok(composerBounds.top > 0 && composerBounds.bottom < composerBounds.viewportHeight);
  await page.locator('.composer').screenshot({});
  await input().fill('');
  await lineCount(2);
  // Use an uncapped six-line fixture at the current composer width. A fixed
  // paragraph may already hit eleven lines, or keep the same line count after
  // the input's newly constrained maximum width changes.
  const wrappingDraft = await input().evaluate((node) => {
    const context = document.createElement('canvas').getContext('2d');
    context.font = getComputedStyle(node).font;
    const columns = Math.floor((node.clientWidth - 2) / context.measureText('测').width);
    return '测'.repeat(columns * 6 - 1);
  });
  await input().fill(wrappingDraft);
  await page.waitForFunction(
    () => document.querySelector('[aria-label="聊天消息"]').clientHeight > 40,
  );
  const beforeNarrow = await measureInput();
  const mainWindow = await app.browserWindow(page);
  await mainWindow.evaluate((window) => window.setSize(960, 800));
  await page.waitForFunction(
    (width) => document.querySelector('[aria-label="聊天消息"]').clientWidth < width,
    beforeNarrow.width,
  );
  await page.waitForFunction(
    (height) =>
      document.querySelector('[aria-label="聊天消息"]').getBoundingClientRect().height > height,
    beforeNarrow.height,
  );
  const narrow = await measureInput();
  assert.ok(narrow.height > beforeNarrow.height && narrow.height <= narrow.line * 11 + 1);
  await mainWindow.evaluate((window) => window.setSize(1280, 800));
  await input().fill('');
  await lineCount(2);
  await send('更新简历');
  const proposal = latest().getByRole('region', { name: '待确认的资料更新', exact: true });
  await proposal.getByRole('button', { name: '保存所选', exact: true }).click();
  await proposal.getByText('已保存所选资料', { exact: true }).waitFor();
  assert.equal(await page.locator('.preparation-guide').count(), 0);
  await page.reload();
  await input().waitFor();
  assert.equal(await page.locator('.preparation-guide').count(), 0);
  await send('普通问题');
  await completed();
  const next = await app.evaluate(() => globalThis.progressRequests.at(-1));
  assert.ok(
    next.input.some((turn) => turn.role === 'assistant' && turn.content.includes('已成功保存')),
  );
  assert.equal(next.instructions.includes('公开推理摘要和进度说明优先使用简体中文'), false);
  const requests = await app.evaluate(() => globalThis.progressRequests.length);
  await send('确认');
  await latest().getByText('普通问题已回答', { exact: true }).waitFor();
  assert.equal(await app.evaluate(() => globalThis.progressRequests.length), requests + 1);
  assert.equal(await page.locator('.preparation-guide').count(), 0);
  await send('继续提问');
  await completed();
  await send('更新 JD');
  const jdProposal = latest().getByRole('region', { name: '待确认的资料更新', exact: true });
  await jdProposal.getByRole('button', { name: '保存所选', exact: true }).click();
  await jdProposal.getByText('已保存所选资料', { exact: true }).waitFor();
  assert.equal(await page.locator('.preparation-guide').count(), 0);
  await page.getByRole('button', { name: '新对话', exact: true }).click();
  await page
    .locator('.preparation-guide')
    .getByRole('button', { name: '生成技能', exact: true })
    .click();
  const skillsProposal = latest().getByRole('region', { name: '待确认的资料更新', exact: true });
  await skillsProposal.getByRole('button', { name: '保存所选', exact: true }).waitFor();
  assert.equal(await skillsProposal.locator('.proposal-skill-row').count(), 3);
  assert.equal(
    await latest().locator('.chat-answer').innerText(),
    '已整理3项核心技能，请确认下方提案。',
  );
  assert.equal(await latest().locator('.chat-source-group').count(), 1);
  assert.equal(await latest().locator('.chat-source-group button').count(), 7);
  assert.equal(await skillsProposal.locator('a').count(), 0);
  const skillRequest = await app.evaluate(() => globalThis.progressRequests.at(-1));
  assert.ok(skillRequest.prompt.includes('根据已确认的简历和职位描述'));
  assert.equal(skillRequest.tool_choice, 'auto');
  assert.ok(skillRequest.instructions.includes('不凑数量，不设固定字数'));
  assert.ok(skillRequest.instructions.includes('标题和正文只写文字'));
  assert.ok(skillRequest.instructions.includes('完整内容只放在 changes'));
  await latest().screenshot({});
  await skillsProposal.getByRole('button', { name: '保存所选', exact: true }).click();
  const confirmedInfo = await page.evaluate(() => localStorage.getItem('copilot-personal-info-v1'));
  assert.equal(JSON.parse(confirmedInfo).skills.length, 3);
  assert.equal(
    JSON.parse(confirmedInfo).skills[0].sources[0].url,
    'https://example.com/docs/0/?utm_source=search',
  );
  await app.evaluate(() => {
    globalThis.failSkillReference = true;
  });
  await send('请联网更新面试技能');
  const review = latest().getByRole('region', { name: '待确认的资料更新', exact: true });
  await review.getByRole('button', { name: '保存所选', exact: true }).waitFor();
  const skillSeparation = await latest()
    .locator('.proposal-skill-row')
    .evaluateAll((nodes) =>
      nodes.map((node) => {
        const style = getComputedStyle(node);
        return {
          padding: parseFloat(style.paddingTop),
          border: parseFloat(style.borderTopWidth),
        };
      }),
    );
  assert.equal(skillSeparation.length, 3);
  assert.ok(skillSeparation.slice(1).every((item) => item.padding > 0 && item.border > 0));
  assert.equal(await review.locator('.proposal-warning').count(), 0);
  await review
    .getByRole('button', {
      name:
        '查看技能：' +
        (await review.locator('.proposal-skill-row .profile-field-choice').first().innerText()),
      exact: true,
    })
    .click();
  const sourceReader = page.getByRole('dialog');
  assert.equal(await sourceReader.getByRole('note').count(), 0);
  assert.doesNotMatch(
    await sourceReader.innerText(),
    /来源未核验|来源待核验|example\.com\/unretrieved/,
  );
  await sourceReader.getByRole('button', { name: '关闭对话框', exact: true }).click();
  assert.equal(
    await review.getByRole('button', { name: '保存所选', exact: true }).isEnabled(),
    true,
  );
  assert.equal((await latest().innerText()).includes('生成已中断'), false);
  assert.equal(
    await page.evaluate(() => localStorage.getItem('copilot-personal-info-v1')),
    confirmedInfo,
  );
  await capture('source-review-light', review);
  await page.evaluate(() => document.documentElement.classList.add('dark'));
  await capture('source-review-dark', review);
  await page.evaluate(() => document.documentElement.classList.remove('dark'));
  await review.getByRole('button', { name: '保存所选', exact: true }).click();
  const unverifiedSaved = JSON.parse(
    await page.evaluate(() => localStorage.getItem('copilot-personal-info-v1')),
  );
  assert.equal(unverifiedSaved.skills.length, 3);
  assert.ok(
    unverifiedSaved.skills.every(
      (skill) => skill.content.includes('版本2') && skill.sources.length === 0,
    ),
  );
  assert.equal(await review.locator('.proposal-warning').count(), 0);
  // Profile localStorage is synchronous; the conversation is a separate async
  // IndexedDB transaction. Verify its committed proposal before a hard reload
  // bypasses the application's normal close/save handshake.
  await page.waitForFunction(
    async (contents) => {
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open('voxcue-preparation-chats', 1);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        const saved = await new Promise((resolve, reject) => {
          const tx = db.transaction('state', 'readonly');
          const request = tx.objectStore('state').get('current');
          tx.oncomplete = () => resolve(request.result);
          tx.onerror = tx.onabort = () => reject(tx.error);
        });
        const conversation = saved?.conversations.find((c) => c.id === saved.activeConversation);
        const message = conversation?.messages.filter((m) => m.role === 'assistant').at(-1);
        return (
          message?.applied === true &&
          JSON.stringify(message.changes?.skills?.map((skill) => skill.content)) ===
            JSON.stringify(contents)
        );
      } finally {
        db.close();
      }
    },
    unverifiedSaved.skills.map((skill) => skill.content),
  );
  await page.reload();
  await latest().getByText('已保存所选资料', { exact: true }).waitFor();
  assert.equal(await latest().locator('.proposal-warning').count(), 0);
  await app.evaluate(() => {
    globalThis.failSkillReference = 'partial';
  });
  await send('请联网更新面试技能');
  await review.getByRole('button', { name: '保存所选', exact: true }).waitFor();
  assert.equal(await review.locator('.proposal-warning').count(), 0);
  await review.getByRole('button', { name: '保存所选', exact: true }).click();
  await review.getByText('已保存所选资料', { exact: true }).waitFor();
  const mixedSaved = JSON.parse(
    await page.evaluate(() => localStorage.getItem('copilot-personal-info-v1')),
  );
  assert.deepEqual(
    mixedSaved.skills.map((skill) => skill.sources.length),
    [0, 1, 1],
  );
  await app.evaluate(() => {
    globalThis.failSkillReference = false;
  });
  await page.evaluate(() => {
    window.restoreProgressClock = Date.now;
    window.progressEpoch = Date.now();
    Date.now = () => window.progressEpoch;
  });
  await send('进度测试');
  await latest().locator('.response-progress').waitFor();
  await latest()
    .getByText(/^正在思考 /)
    .waitFor();
  const firstTitle = latest().locator('.reasoning-section summary').filter({ hasText: '梳理问题' });
  const currentTitle = latest()
    .locator('.reasoning-section summary')
    .filter({ hasText: '核对资料' });
  await currentTitle.waitFor();
  assert.equal(await firstTitle.locator('..').getAttribute('open'), null);
  assert.equal(await currentTitle.locator('.reasoning-heading.is-active').count(), 1);
  assert.equal(
    await currentTitle
      .locator('.reasoning-heading')
      .evaluate((node) => getComputedStyle(node).animationName),
    'reasoning-title-shine',
  );
  assert.equal(await latest().locator('.progress-state-label.is-active').count(), 1);
  const activeLabel = latest().locator('.progress-state-label.is-active');
  for (const theme of ['light', 'dark']) {
    await page.evaluate(
      (theme) => document.documentElement.classList.toggle('dark', theme === 'dark'),
      theme,
    );
    const style = await activeLabel.evaluate((node) => {
      const style = getComputedStyle(node);
      const canvas = new OffscreenCanvas(1, 1),
        context = canvas.getContext('2d');
      const brightness = (color) => {
        context.clearRect(0, 0, 1, 1);
        context.fillStyle = color;
        context.fillRect(0, 0, 1, 1);
        return (
          [...context.getImageData(0, 0, 1, 1).data].slice(0, 3).reduce((sum, c) => sum + c, 0) / 3
        );
      };
      const probe = document.createElement('span');
      node.append(probe);
      probe.style.color = 'var(--progress-label-highlight)';
      const highlight = brightness(getComputedStyle(probe).color);
      probe.style.color = 'var(--muted)';
      const muted = brightness(getComputedStyle(probe).color);
      probe.remove();
      const animation = node
        .getAnimations()
        .find((a) => a.animationName === 'reasoning-title-shine');
      animation.pause();
      animation.currentTime = 500;
      return {
        gradient: style.backgroundImage,
        base: brightness(style.backgroundColor),
        highlight,
        muted,
      };
    });
    assert.match(style.gradient, /^linear-gradient\(90deg,/);
    assert.ok(style.highlight > style.base, 'Sweep gently brightens the text');
    if (theme === 'light') assert.ok(style.base > style.muted, 'Light theme uses a softer gray');
    await capture('thinking-label-' + theme, activeLabel, 'allow');
    await activeLabel.evaluate((node) => {
      const animation = node
        .getAnimations()
        .find((a) => a.animationName === 'reasoning-title-shine');
      animation.currentTime = 0;
      animation.play();
    });
  }
  await page.evaluate(() => document.documentElement.classList.remove('dark'));
  await focusUiWindow(app, page);
  const shine = await latest()
    .locator('.progress-state-label.is-active')
    .evaluate(async (node) => {
      const animation = node
        .getAnimations()
        .find((a) => a.animationName === 'reasoning-title-shine');
      const timing = animation.effect.getTiming(),
        frames = animation.effect.getKeyframes();
      const samples = [],
        began = performance.now();
      while (performance.now() - began < 8000) {
        await new Promise(requestAnimationFrame);
        samples.push({
          time: Number(animation.currentTime),
          position: parseFloat(getComputedStyle(node).backgroundPositionX),
          width: node.getBoundingClientRect().width,
        });
      }
      return {
        duration: timing.duration,
        frames,
        samples,
        repeat: getComputedStyle(node).backgroundRepeat,
      };
    });
  assert.equal(shine.duration, 3500);
  assert.equal(shine.repeat, 'no-repeat');
  assert.ok(Math.abs(shine.frames[1].offset * 3500 - 1000) < 0.01);
  assert.ok(Math.abs((1 - shine.frames[1].offset) * 3500 - 2500) < 0.01);
  assert.ok(
    new Set(shine.samples.map((s) => Math.floor(s.time / 3500))).size >= 3,
    'Observe two complete loop boundaries',
  );
  for (const sample of shine.samples) {
    const phase = sample.time % 3500;
    const expected = phase < 1000 ? 120 - (140 * phase) / 1000 : -20;
    assert.ok(
      Math.abs(sample.position - expected) < 1.5,
      'Sweep must progress continuously and hold during the pause',
    );
    assert.ok(
      Math.abs(sample.width - shine.samples[0].width) < 0.1,
      'Animation cannot change text geometry',
    );
  }
  assert.equal(
    await latest()
      .locator('.progress-state-label.is-active')
      .evaluate((node) => getComputedStyle(node).animationName),
    'reasoning-title-shine',
  );
  const layout = await latest()
    .locator('.response-progress')
    .evaluate((root) => ({
      first: root.firstElementChild.className,
      border: getComputedStyle(root).borderBottomWidth,
      durationBorder: getComputedStyle(root.firstElementChild).borderBottomWidth,
      rows: [...root.querySelectorAll('.response-steps > li')].map((node) => ({
        kind: node.dataset.kind,
        phase: node.dataset.phase,
        text: node.textContent,
      })),
      durationInSummary: !!root.querySelector('summary .response-duration'),
    }));
  assert.equal(layout.first, 'response-duration');
  assert.ok(parseFloat(layout.border) > 0 && parseFloat(layout.border) <= 1);
  assert.equal(layout.durationInSummary, false);
  assert.equal(parseFloat(layout.durationBorder), 0);
  const firstIndex = layout.rows.findIndex((row) => row.text.includes('梳理问题'));
  const searchIndex = layout.rows.findIndex((row) => row.kind === 'web_search');
  const nextTitleIndex = layout.rows.findIndex((row) => row.text.includes('核对资料'));
  assert.ok(firstIndex >= 0 && firstIndex < searchIndex && searchIndex < nextTitleIndex);
  assert.equal(
    layout.rows.some(
      (row) => row.kind === 'status' && ['waiting', 'processing'].includes(row.phase),
    ),
    false,
  );
  await focusUiWindow(app, page);
  await page.mouse.move(0, 0);
  await currentTitle.locator('.reasoning-chevron').evaluate(async (node) => {
    await Promise.all(node.getAnimations().map((animation) => animation.finished.catch(() => {})));
  });
  assert.equal(
    await currentTitle
      .locator('.reasoning-chevron')
      .evaluate((node) => getComputedStyle(node).opacity),
    '0',
  );
  await focusUiWindow(app, page);
  await page.mouse.move(0, 0);
  await currentTitle.hover();
  await page.waitForFunction(
    () =>
      getComputedStyle(document.querySelector('.reasoning-heading.is-active + .reasoning-chevron'))
        .opacity === '1',
  );
  await currentTitle.click();
  assert.equal(await currentTitle.locator('..').getAttribute('open'), '');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(
    await currentTitle
      .locator('.reasoning-heading')
      .evaluate((node) => getComputedStyle(node).animationName),
    'none',
  );
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.emulateMedia({ contrast: 'more' });
  assert.equal(await activeLabel.evaluate((node) => getComputedStyle(node).animationName), 'none');
  assert.equal(
    await activeLabel.evaluate((node) => getComputedStyle(node).backgroundImage),
    'none',
  );
  await page.emulateMedia({ contrast: 'no-preference' });
  await latest().locator('.response-progress').screenshot({ animations: 'allow' });
  await page.evaluate(() => {
    Date.now = () => window.progressEpoch + 333000;
  });
  await app.evaluate(() => globalThis.finishProgress());
  await latest().getByText('用时 5 分钟 33 秒', { exact: true }).waitFor();
  assert.equal(await latest().locator('.duration-toggle').getAttribute('aria-expanded'), 'false');
  await latest().locator('.response-progress-content').waitFor({ state: 'hidden' });
  await checkProgressMotion(page, latest().locator('.response-progress'));
  await latest().locator('.duration-toggle').click();
  await page.evaluate(() => {
    Date.now = window.restoreProgressClock;
  });
  assert.equal(await latest().locator('.reasoning-heading.is-active').count(), 0);
  assert.equal(await latest().locator('.progress-state-label.is-active').count(), 0);
  await firstTitle.click();
  assert.equal(
    await latest()
      .locator(
        '.response-steps li[data-kind="commentary"], .response-steps li[data-kind="web_search"], .response-steps li[data-kind="open_page"], .response-steps li[data-kind="find_in_page"]',
      )
      .count(),
    4,
  );
  await latest().getByText('official first · official second', { exact: true }).waitFor();
  await latest().getByText('先核对两个官方来源。', { exact: true }).waitFor();
  assert.equal(await latest().locator('.chat-answer').innerText(), '进度最终回答');
  assert.equal((await latest().innerText()).includes('PRIVATE'), false);
  assert.equal((await latest().innerText()).includes('secret'), false);
  assert.equal((await latest().innerText()).includes('推理摘要'), false);
  assert.equal(await latest().locator('.progress-link').first().getAttribute('title'), null);
  const pagePills = latest().locator('.progress-link .chat-source-link');
  assert.equal(await pagePills.count(), 2, 'Read/find activities reuse source pills');
  for (const pill of await pagePills.all()) {
    assert.equal(await pill.getAttribute('href'), 'https://example.com/docs');
    assert.equal(await pill.locator('.chat-source-label').innerText(), 'example.com');
    assert.equal(await pill.getAttribute('title'), null);
  }
  await app.evaluate(({ shell }) => {
    globalThis.pagePillOpenExternal = shell.openExternal;
    globalThis.pagePillOpened = [];
    shell.openExternal = async (url) => {
      globalThis.pagePillOpened.push(url);
    };
  });
  let linkFailure;
  try {
    for (const pill of await pagePills.all()) await pill.click();
    assert.deepEqual(
      await app.evaluate(async () => {
        const end = Date.now() + 5000;
        while (globalThis.pagePillOpened.length < 2) {
          if (Date.now() > end) throw Error('Activity source links did not reach the controlled opener');
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        return globalThis.pagePillOpened;
      }),
      ['https://example.com/docs', 'https://example.com/docs'],
    );
    for (const url of [
      'javascript:alert(1)', 'file:///private/guide', 'https://user:password@example.com/',
    ])
      assert.equal(
        await page.evaluate(async (url) => {
          try {
            await window.desktop.chatOpenLink(url);
            return false;
          } catch {
            return true;
          }
        }, url),
        true,
        'The production link IPC rejects an unsafe URL',
      );
    assert.equal(await app.evaluate(() => globalThis.pagePillOpened.length), 2);
  } catch (error) {
    linkFailure = error;
    throw error;
  } finally {
    try {
      await app.evaluate(({ shell }) => {
        shell.openExternal = globalThis.pagePillOpenExternal;
        delete globalThis.pagePillOpenExternal;
        delete globalThis.pagePillOpened;
      });
    } catch (error) {
      if (!linkFailure) throw error;
      console.error('Activity link fixture restoration failed:', error);
    }
  }
  for (const theme of ['light', 'dark']) {
    await page.evaluate(
      (theme) => document.documentElement.classList.toggle('dark', theme === 'dark'),
      theme,
    );
    const pills = await pagePills.evaluateAll((nodes) => nodes.map((node) => {
        const row = node.closest('li').querySelector(':scope > div');
        const label = row.firstElementChild;
        const icon = node.querySelector('.chat-source-icon');
        const iconGlyph = icon.querySelector('svg');
        const domain = node.querySelector('.chat-source-label');
        const range = document.createRange();
        range.selectNodeContents(domain);
        const text = range.getBoundingClientRect();
        const pill = node.getBoundingClientRect();
        const image = icon.getBoundingClientRect();
        const glyph = iconGlyph.getBoundingClientRect();
        const bound = row.getBoundingClientRect();
        return {
          font: parseFloat(getComputedStyle(node).fontSize),
          rowFont: parseFloat(getComputedStyle(row).fontSize),
          labelFont: parseFloat(getComputedStyle(label).fontSize),
          height: pill.height,
          icon: [image.width, image.height, glyph.width, glyph.height],
          fits:
            image.left >= pill.left && image.right <= pill.right &&
            image.top >= pill.top && image.bottom <= pill.bottom &&
            text.left >= pill.left && text.right <= pill.right &&
            text.top >= pill.top && text.bottom <= pill.bottom &&
            pill.left >= bound.left && pill.right <= bound.right,
        };
    }));
    for (const pill of pills) {
      assert.equal(pill.font, pill.rowFont, 'Activity pill inherits the row font');
      assert.equal(pill.font, pill.labelFont, 'Activity pill matches its status label font');
      assert.ok(Math.abs(pill.height - (pill.font * 20) / 12) <= 1 / 64, 'Pill scales with its text');
      assert.ok(pill.icon.every((size) => Math.abs(size - (pill.font * 11) / 12) <= 1 / 64), 'Pill icon scales with its text');
      assert.equal(pill.fits, true, 'Activity pill and its complete label stay inside the row');
    }
    await page.evaluate(() => document.activeElement?.blur());
    await page.mouse.move(0, 0);
    const normalPillColor = await pagePills.first().evaluate((node) => getComputedStyle(node).color);
    await pagePills.first().hover();
    const hoveredPill = await pagePills.first().evaluate((node) => ({
      color: getComputedStyle(node).color,
      cursors: [node, ...node.querySelectorAll('*')].map((child) => getComputedStyle(child).cursor),
    }));
    assert.notEqual(hoveredPill.color, normalPillColor, 'Activity source pill changes text color on hover');
    assert.ok(hoveredPill.cursors.every((cursor) => cursor === 'pointer'), 'Activity source pill and its children use the hand cursor');
    await latest().locator('.response-progress').screenshot({ animations: 'disabled' });
    await capture('progress-page-pill-' + theme, latest().locator('.response-steps'));
  }
  await page.evaluate(() => {
    window.progressEpoch = Date.now();
    Date.now = () => window.progressEpoch;
  });
  await send('失败后重试');
  await latest().locator('.response-progress').waitFor();
  await app.evaluate(() => {
    const encode = (event) => new TextEncoder().encode('data: ' + JSON.stringify(event) + '\n\n');
    globalThis.progressController.enqueue(
      encode({
        type: 'response.output_item.added',
        output_index: 4,
        item: { id: 'partial', type: 'message', phase: 'final_answer', content: [] },
      }),
    );
    globalThis.progressController.enqueue(
      encode({
        type: 'response.output_text.delta',
        output_index: 4,
        delta: '{"answer":"中断前的部分回答',
      }),
    );
  });
  await latest().locator('.chat-answer').getByText('中断前的部分回答', { exact: true }).waitFor();
  await page.evaluate(() => {
    Date.now = () => window.progressEpoch + 66000;
  });
  await app.evaluate(() =>
    globalThis.progressController.error(Error('synthetic interrupted transport')),
  );
  await latest().getByRole('button', { name: '重试回答', exact: true }).waitFor();
  await latest().getByText('用时 1 分钟 6 秒', { exact: true }).waitFor();
  await page.evaluate(() => {
    Date.now = window.restoreProgressClock;
  });
  const actions = latest().locator('.chat-message-actions');
  for (const language of ['en', 'zh-CN']) {
    await page.evaluate((language) => {
      localStorage.setItem('voxcue-language-v1', language);
      dispatchEvent(new StorageEvent('storage', { key: 'voxcue-language-v1' }));
    }, language);
    for (const dark of [false, true]) {
      await page.evaluate((dark) => document.documentElement.classList.toggle('dark', dark), dark);
      await actions.locator('.chat-copy').hover();
      const geometry = await actions.evaluate((element) => {
        const buttons = [...element.querySelectorAll('button')];
        const [retry, copy] = buttons.map((button) => button.getBoundingClientRect());
        return {
          retryHeight: Math.round(retry.height),
          retryFont: getComputedStyle(buttons[0]).fontSize,
          copyHeight: Math.round(copy.height),
          aligned: Math.abs(retry.top + retry.height / 2 - copy.top - copy.height / 2) < 1,
          separated: copy.left - retry.right >= 7.9,
        };
      });
      assert.deepEqual(geometry, {
        retryHeight: 36,
        retryFont: '14px',
        copyHeight: 28,
        aligned: true,
        separated: true,
      });
      if (process.argv.includes('--preview-actions'))
        console.log(
          'IMAGE:' + (await actions.screenshot({ type: 'jpeg', quality: 80 })).toString('base64'),
        );
    }
  }
  await latest().getByRole('button', { name: '重试回答', exact: true }).click();
  await latest().getByText('重试完成', { exact: true }).waitFor();
  assert.equal(
    (await latest().locator('.response-duration').innerText()).includes('1 分钟 6 秒'),
    false,
  );
  await send('停止测试');
  await latest().locator('.response-progress').waitFor();
  await page.getByRole('button', { name: '停止回复', exact: true }).click();
  await latest().getByText('已停止回复。', { exact: true }).waitFor();
  assert.ok((await latest().locator('.response-duration').innerText()).startsWith('已处理'));
  await input().fill(longDraft);
  await lineCount(11);
  await page.reload();
  await input().waitFor();
  await page.waitForFunction(() =>
    document.querySelector('[aria-label="聊天消息"]').value.includes('第20行'),
  );
  await lineCount(11);
  const stored = page.locator('.chat-message.assistant').filter({ hasText: '进度最终回答' });
  await stored.getByText('用时 5 分钟 33 秒', { exact: true }).waitFor();
  assert.equal(await stored.locator('.response-progress-content').isVisible(), false);
  await stored.locator('.duration-toggle').click();
  await stored.locator('.reasoning-section summary').filter({ hasText: '梳理问题' }).click();
  await stored.getByText('已收到的公开摘要。', { exact: true }).waitFor();
  assert.equal(await stored.locator('.reasoning-section').count(), 2);
  assert.equal(await stored.locator('.response-steps li[data-kind="web_search"]').count(), 1);
  assert.deepEqual(errors, []);
  await console.log(
    JSON.stringify(
      {
        passed: true,
        checks: [
          'button consent without JD does not gate chat',
          'saved summaries and plain consent do not insert onboarding into chat',
          'saved resolution enters history',
          'real Responses SSE public commentary/search/read/find',
          'live and completed duration',
          'failure/stop/retry duration',
          'duration and activities survive reload',
          'progress and nested reasoning animate both ways, reverse smoothly and respect reduced motion',
          'time above separator, real title disclosures and chronological status changes',
          'trailing chevron only on hover/focus, active title shimmer and reduced motion',
          'composer grows from 2 to 11 lines, shrinks, reflows and restores drafts',
          'source notes hidden in proposals and detail dialogs; button save, mixed/all-unverified source metadata and reload persistence',
          'skill generation is available from the new-chat home',
          'retry and copy are aligned and separated in both languages and themes',
          'empty statuses replaced, current status shimmer and no summary language preference',
        ],
        rendererErrors: errors.length,
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ passed: true, profile }));
} catch (error) {
  console.error(error);
  const page = app.windows().find((window) => window.url().includes('index.html'));
  if (page) {
    await page.screenshot({}).catch(() => {});
    console.log(
      await page
        .evaluate(() => {
          const input = document.querySelector('[aria-label="聊天消息"]');
          return {
            viewport: [innerWidth, innerHeight],
            input: input && {
              width: input.clientWidth,
              height: input.clientHeight,
              scroll: input.scrollHeight,
            },
          };
        })
        .catch(() => ({})),
    );
  }
  throw error;
} finally {
  await closeUiApp(app);
}
