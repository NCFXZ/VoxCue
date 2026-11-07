import { enterDemoUiAccount, openModelMenu } from './install-ui-account.mjs';
import { testRoot, electron } from './test-workspace.mjs';
import { offlineElectronEntry } from './offline-electron-entry.mjs';
import { closeUiApp } from './install-ui-account.mjs';
import { captureRequested } from './capture-requested.mjs';

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

async function stableLinkAppearance(link, expected) {
  return link.evaluate(async (node, expected) => {
    const end = performance.now() + 5000;
    let state;
    do {
      await new Promise(requestAnimationFrame);
      const style = getComputedStyle(node);
      const box = node.getBoundingClientRect();
      const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      const animations = node
        .getAnimations()
        .filter((animation) => animation.effect?.getTiming().iterations !== Infinity);
      state = {
        theme: expected.theme,
        kind: expected.kind,
        tag: node.tagName,
        href: node.getAttribute('href'),
        text: node.textContent.trim(),
        hovered: node.matches(':hover'),
        focusVisible: node.matches(':focus-visible'),
        hit: hit === node || node.contains(hit),
        windowFocused: document.hasFocus(),
        color: style.color,
        background: style.backgroundColor,
        foreground: style.getPropertyValue('--foreground').trim(),
        muted: style.getPropertyValue('--muted').trim(),
        animations: animations.map((animation) => ({
          state: animation.playState,
          pending: animation.pending,
        })),
        cursors: [node, ...node.querySelectorAll('*')].map(
          (child) => getComputedStyle(child).cursor,
        ),
      };
      const settled = animations.every(
        (animation) => !animation.pending && animation.playState !== 'running',
      );
      if (
        node.isConnected &&
        settled &&
        state.hovered === expected.hovered &&
        (expected.hovered ? state.hit && state.color !== expected.normalColor : !state.focusVisible)
      )
        return state;
    } while (performance.now() < end);
    throw Error(
      'Link hover feedback did not settle: ' + JSON.stringify({ expected, actual: state }),
    );
  }, expected);
}

const profile = path.resolve(
  path.join(testRoot, 'test/results'),
  `chat-response-profile-${Date.now()}`,
);
await mkdir(profile, { recursive: true });
const fixture = path.join(profile, 'main.cjs');
const syntheticIcon = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><circle cx="8" cy="8" r="7" fill="#547c69"/></svg>').toString('base64');
const faviconImages = ['docs', 'research', 'reference', 'extra'].map((host) => [
  `https://a.favicon.im/${host}.example.org?throw-error-on-404=true`,
  {
    statusCode: host === 'research' ? 404 : 200,
    mimeType: ['research', 'reference'].includes(host) ? 'image/png' : 'image/svg+xml',
    data: host === 'research' ? '' : host === 'reference' ? 'AAAA' : syntheticIcon,
  },
]);
await writeFile(
  fixture,
  `const {app,shell} = require('electron');
globalThis.sourceLinkOpened=[];
globalThis.faviconRequests=[];
globalThis.faviconResponses=[];
globalThis.blockedFaviconProbe=0;
const faviconImages=new Map(${JSON.stringify(faviconImages)});
// This owned fixture remains fully offline: HTTPS is handled locally, with
// fixed image bytes/statuses only. No unknown request can fall back to network.
// The launcher's independent Node/net/socket guards remain untouched.
app.on('session-created', session => {
  const installed=session.protocol.interceptBufferProtocol('https', (request, callback) => {
    const image=request.method==='GET' && faviconImages.get(request.url);
    if(!image) return callback({error:-2});
    globalThis.faviconResponses.push({url:request.url,status:image.statusCode});
    callback({statusCode:image.statusCode,mimeType:image.mimeType,data:Buffer.from(image.data,'base64')});
  });
  if(!installed || !session.protocol.isProtocolIntercepted('https'))
    throw Error('Failed to install the owned offline image protocol');
  session.webRequest.onBeforeRequest(
    {urls:['http://*/*','https://*/*','ws://*/*','wss://*/*']},
    (details, callback) => {
      const image=details.method==='GET' && details.resourceType==='image' && faviconImages.has(details.url);
      if(image) {
        globalThis.faviconRequests.push({url:details.url,referrer:details.referrer});
        callback({});
      } else {
        if(details.url==='https://a.favicon.im/unlisted.example.org?throw-error-on-404=true')
          globalThis.blockedFaviconProbe++;
        callback({cancel:true});
      }
    },
  );
});
shell.openExternal=async(url)=>{globalThis.sourceLinkOpened.push(url);};
app.setAppPath(${JSON.stringify(process.cwd())});
globalThis.chatTestModules = { ...require(${JSON.stringify(path.resolve('dist-electron/shared/electron/backend/chat/service.js'))}), ...require(${JSON.stringify(path.resolve('dist-electron/shared/electron/backend/chat/usage.js'))}) };
require(${JSON.stringify(path.resolve('dist-electron/shared/electron/main.js'))});`,
);
const app = await electron.launch({
  args: [await offlineElectronEntry(fixture)],
  env: { ...process.env, COPILOT_TEST_USER_DATA: profile, VITE_DEV_SERVER_URL: '' },
});
try {
  const login = await app.firstWindow();
  await login.getByRole('heading', { name: '登录 VoxCue', exact: true }).waitFor();
  await login.waitForFunction(() => document.visibilityState === 'visible');
  const [page] = await Promise.all([app.waitForEvent('window'), enterDemoUiAccount(app, login)]);
  page.setDefaultTimeout(15000);
  assert.equal(
    await page.evaluate(() => new Promise((resolve) => {
      const image = new Image();
      const finish = (blocked) => { image.remove(); resolve(blocked); };
      image.onload = () => finish(false);
      image.onerror = () => finish(true);
      image.src = 'https://a.favicon.im/unlisted.example.org?throw-error-on-404=true';
      document.body.append(image);
    })),
    true,
    'An image outside the exact synthetic allowlist remains blocked',
  );
  assert.equal(await app.evaluate(() => globalThis.blockedFaviconProbe), 1);
  assert.equal(await app.evaluate(async () => {
    try {
      await fetch('https://a.favicon.im/docs.example.org?throw-error-on-404=true');
      return false;
    } catch (error) {
      return error.message.includes('Offline desktop regression forbids network access');
    }
  }), true, 'The independent main-process network guard remains enabled');
  // Only the test profile's transport is replaced. Renderer and IPC remain real.
  await app.evaluate(async ({ ipcMain }, profile) => {
    const { ChatGPTService, publicFailure, UsageLedger } = globalThis.chatTestModules;
    let responseCount = 0;
    const service = new ChatGPTService({
      access: async () => ({ account: 'test', token: 'test-only' }),
      ledger: new UsageLedger(profile + '/usage'),
      fetch: async (url, options) => {
        if (url.endsWith('/models'))
          return Response.json({
            models: [{ slug: 'gpt-6-luna', display_name: 'Test Luna', visibility: 'list' }],
          });
        const request = JSON.parse(options.body);
        if (request.input.at(-1).content === '状态测试') {
          const encoder = new TextEncoder();
          const events = [
            { type: 'response.created' },
            { type: 'response.output_item.added', item: { type: 'reasoning' } },
            { type: 'response.web_search_call.searching', item_id: 'search-progress' },
            {
              type: 'response.output_item.added',
              item: {
                type: 'web_search_call',
                id: 'open-reading',
                action: { type: 'open_page', url: 'https://example.com/docs' },
              },
            },
            { type: 'response.output_text.delta', delta: '{"answer":"' },
            {
              type: 'response.output_text.delta',
              delta: JSON.stringify({ answer: '状态演示已完成', changes: {} }).slice(11),
            },
            {
              type: 'response.completed',
              response: { id: 'status-test', status: 'completed', output: [] },
            },
          ];
          return new Response(
            new ReadableStream({
              async start(controller) {
                for (const event of events) {
                  controller.enqueue(encoder.encode('data: ' + JSON.stringify(event) + '\n\n'));
                  await new Promise((resolve) => setTimeout(resolve, 700));
                }
                controller.close();
              },
            }),
            { headers: { 'content-type': 'text/event-stream' } },
          );
        }
        if (request.input.at(-1).content === '失败测试')
          return new Response('<html>upstream error</html>', {
            headers: { 'content-type': 'text/html' },
          });
        if (request.reasoning?.effort !== 'low') throw new Error('Effort not transmitted');
        const markdown =
          '**JSON 回答已显示**\n\n**已核实的 JD。**下面说明\n\n- **岗位名称： **产品测试工程师。\n- **岗位类别： **开发类。\n\n```python\nprint("Hello")\n```\n\n|字段|内容|\n|---|---|\n|姓名|示例|';
        const text =
          request.text?.format?.type === 'json_schema'
            ? JSON.stringify({
                answer:
                  request.input.at(-1).content === '你好'
                    ? markdown +
                      '\n\n引用说明。 ([docs.example.org](https://docs.example.org/guide)) 普通链接：[**阅读说明**](https://docs.example.org/guide)。'
                    : '**已整理资料**，请检查待保存内容并确认。',
                changes:
                  request.input.at(-1).content === '你好'
                    ? {}
                    : {
                        name: '新姓名',
                        jobDescription: '新的 JD',
                        background: null,
                      },
              })
            : markdown +
              '\n\n引用说明。 ([docs.example.org](https://docs.example.org/guide)) 普通链接：[**阅读说明**](https://docs.example.org/guide)。';
        return Response.json({
          object: 'response',
          id: `test-response-${++responseCount}`,
          status: 'completed',
          output: [
            {
              content: [
                {
                  type: 'output_text',
                  text,
                  annotations:
                    request.input.at(-1).content === '你好'
                      ? [
                          {
                            type: 'url_citation',
                            url: 'https://docs.example.org/guide',
                            title: '示例文档',
                          },
                          {
                            type: 'url_citation',
                            url: 'https://research.example.org/paper',
                            title: '研究资料',
                          },
                          {
                            type: 'url_citation',
                            url: 'https://reference.example.org/api',
                            title: '接口参考',
                          },
                          {
                            type: 'url_citation',
                            url: 'https://extra.example.org/detail',
                            title: '补充来源',
                          },
                        ]
                      : [],
                },
              ],
            },
          ],
          usage: { input_tokens: 4, output_tokens: 2, total_tokens: 6 },
        });
      },
    });
    for (const channel of ['auth:session', 'chat:models', 'chat:usage', 'chat:send'])
      ipcMain.removeHandler(channel);
    ipcMain.handle('auth:session', () => ({
      mode: 'chatgpt',
      user: { id: 'test', name: 'Test', email: '' },
      expiresAt: Date.now() + 3600000,
    }));
    ipcMain.handle('chat:models', async () => ({ ok: true, models: await service.models() }));
    ipcMain.handle('chat:usage', async () => ({ ok: true, usage: await service.usage() }));
    ipcMain.handle('chat:send', async (event, request) => {
      try {
        return {
          ok: true,
          ...(await service.stream(
            request,
            (value) => event.sender.send('chat:event', value),
            new AbortController().signal,
          )),
        };
      } catch (error) {
        return { ok: false, error: publicFailure(error) };
      }
    });
  }, profile);
  await page.evaluate(() =>
    localStorage.setItem(
      'copilot-personal-info-v1',
      JSON.stringify({
        name: '旧姓名',
        role: '原岗位',
        jobDescription: '旧 JD',
        background: '已有经历',
      }),
    ),
  );
  await page.reload();
  await page
    .getByRole('button', { name: '聊天模型', exact: true })
    .getByText('Test Luna')
    .waitFor();
  const controls = await page.locator('.composer-tool').evaluateAll((elements) =>
    elements.map((element) => {
      const style = getComputedStyle(element);
      return {
        height: Math.round(element.getBoundingClientRect().height * 100) / 100,
        shadow: style.boxShadow,
        radius: style.borderRadius,
      };
    }),
  );
  assert.deepEqual(
    await page
      .locator('.composer-tool')
      .evaluateAll((elements) => elements.map((element) => element.getAttribute('aria-label'))),
    ['聊天模型'],
  );
  assert.equal(await page.getByRole('button', { name: '网络搜索', exact: true }).count(), 0);
  assert.deepEqual(controls, [{ height: 32, shadow: 'none', radius: '999px' }]);
  await openModelMenu(page);
  assert.equal(await page.locator('.model-option-icon').count(), 0);
  assert.ok(
    await page
      .locator('.model-option')
      .evaluate((element) => element.getBoundingClientRect().height <= 32),
  );
  await page.screenshot({});
  await page.keyboard.press('Escape');
  await page.getByRole('textbox', { name: '聊天消息', exact: true }).fill('你好');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await page.locator('.chat-answer').getByText('JSON 回答已显示', { exact: true }).waitFor();
  assert.equal(
    await page.locator('.answer-usage').count(),
    0,
    'Per-answer token counts are hidden',
  );
  assert.equal(await page.locator('.chat-answer strong').count(), 5);
  assert.equal((await page.locator('.chat-answer').innerText()).includes('**'), false);
  const sourceGroup = page.locator('.chat-source-group').first();
  assert.equal(await sourceGroup.locator('.chat-source-link:visible').count(), 3);
  const inlineCitation = page.locator('.chat-answer a.chat-source-link');
  await inlineCitation.waitFor();
  assert.equal(await inlineCitation.count(), 1);
  assert.equal(await inlineCitation.innerText(), 'docs.example.org');
  const ordinaryLink = page.locator('.chat-answer a:not(.chat-source-link)');
  assert.equal(await ordinaryLink.innerText(), '阅读说明');
  assert.equal(await ordinaryLink.locator('strong').count(), 1);
  assert.equal(
    await inlineCitation.evaluate((node) =>
      node.parentElement.textContent.includes('(docs.example.org)'),
    ),
    false,
  );
  assert.equal(await page.locator('.chat-source-link[title]').count(), 0);
  const inlineIcon = inlineCitation.locator('.chat-source-icon[data-ready="true"] img');
  await inlineIcon.waitFor();
  const icon = await inlineIcon.evaluate((image) => ({
    src: image.src,
    referrer: image.referrerPolicy,
    loading: image.loading,
    decoding: image.decoding,
    crossOrigin: image.crossOrigin,
    alt: image.alt,
    width: Math.round(image.getBoundingClientRect().width * 64) / 64,
    height: Math.round(image.getBoundingClientRect().height * 64) / 64,
    decoded: image.naturalWidth > 0,
  }));
  assert.deepEqual(icon, {
    src: 'https://a.favicon.im/docs.example.org?throw-error-on-404=true',
    referrer: 'no-referrer', loading: 'lazy', decoding: 'async', crossOrigin: null,
    alt: '', width: 11, height: 11, decoded: true,
  });
  assert.equal(
    await sourceGroup.locator('.chat-source-link').filter({ hasText: 'docs.example.org' }).locator('img').getAttribute('src'),
    icon.src,
    'Inline and source-list citations share the same hostname-only image URL',
  );
  const failedIcon = sourceGroup.locator('.chat-source-link').filter({ hasText: 'research.example.org' });
  await failedIcon.locator('img').waitFor({ state: 'detached' });
  assert.equal(await failedIcon.locator('svg').evaluate((node) => getComputedStyle(node).visibility), 'visible');
  const undecodableIcon = sourceGroup.locator('.chat-source-link').filter({ hasText: 'reference.example.org' });
  await undecodableIcon.locator('img').waitFor({ state: 'detached' });
  assert.equal(await undecodableIcon.locator('svg').evaluate((node) => getComputedStyle(node).visibility), 'visible');
  assert.equal(await sourceGroup.locator('[role="alert"]').count(), 0);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const moreSources = sourceGroup.locator('details');
  const disclosureFrames = async () =>
    moreSources.evaluate(async (node) => {
      const frames = [
        {
          height: node.getBoundingClientRect().height,
          opacity: Number(getComputedStyle(node, '::details-content').opacity),
        },
      ];
      node.querySelector('summary').click();
      const start = performance.now();
      do {
        await new Promise(requestAnimationFrame);
        frames.push({
          height: node.getBoundingClientRect().height,
          opacity: Number(getComputedStyle(node, '::details-content').opacity),
        });
      } while (performance.now() - start < 400);
      return frames;
    });
  for (const phase of ['expand', 'collapse']) {
    const frames = await disclosureFrames();
    const minimum = Math.min(frames[0].height, frames.at(-1).height);
    const maximum = Math.max(frames[0].height, frames.at(-1).height);
    assert.ok(
      frames.some((frame) => frame.height > minimum + 0.5 && frame.height < maximum - 0.5),
      phase + ': source list height interpolates',
    );
    assert.ok(
      frames.some((frame) => frame.opacity > 0 && frame.opacity < 1),
      phase + ': source list opacity interpolates',
    );
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await sourceGroup.locator('summary').press('Enter');
  assert.equal(
    await moreSources.evaluate(
      (node) => getComputedStyle(node, '::details-content').transitionDuration,
    ),
    '0s',
  );
  assert.equal(await sourceGroup.locator('.chat-source-link:visible').count(), 4);
  const extraIcon = sourceGroup.locator('details .chat-source-link img');
  await extraIcon.scrollIntoViewIfNeeded();
  await sourceGroup.locator('details .chat-source-icon[data-ready="true"] img').waitFor();
  assert.equal(await extraIcon.getAttribute('src'), 'https://a.favicon.im/extra.example.org?throw-error-on-404=true');
  const faviconRequests = await app.evaluate(() => globalThis.faviconRequests);
  const faviconResponses = await app.evaluate(() => globalThis.faviconResponses);
  assert.ok(faviconResponses.some(({ url, status }) => url.includes('/research.example.org?') && status === 404));
  assert.ok(faviconResponses.some(({ url, status }) => url.includes('/reference.example.org?') && status === 200));
  assert.ok(faviconRequests.length > 0);
  assert.ok(faviconRequests.every(({ url, referrer }) =>
    /^https:\/\/a\.favicon\.im\/[a-z0-9.-]+\?throw-error-on-404=true$/.test(url) && referrer === '',
  ));
  for (const host of ['research', 'reference'])
    assert.equal(faviconRequests.filter(({ url }) => url.includes(`/${host}.example.org?`)).length, 1, 'Failed images are not retried while the source list is toggled');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await inlineCitation.focus();
  await page.keyboard.press('Enter');
  assert.deepEqual(
    await app.evaluate(async () => {
      const deadline = Date.now() + 3000;
      while (!globalThis.sourceLinkOpened.length && Date.now() < deadline)
        await new Promise((resolve) => setTimeout(resolve, 20));
      return globalThis.sourceLinkOpened;
    }),
    ['https://docs.example.org/guide'],
  );
  for (const dark of [false, true]) {
    await page.evaluate((dark) => document.documentElement.classList.toggle('dark', dark), dark);
    const badges = await page.locator('.chat-source-link:visible').evaluateAll((nodes) =>
      nodes.map((node) => {
        const style = getComputedStyle(node);
        return {
          height: node.getBoundingClientRect().height,
          fontSize: parseFloat(style.fontSize),
          radius: parseFloat(style.borderTopLeftRadius),
          decoration: style.textDecorationLine,
          corner: style.cornerShape,
        };
      }),
    );
    assert.ok(
      badges.every(
        (badge) =>
          badge.height <= 22 &&
          badge.fontSize === 12 &&
          badge.radius >= badge.height / 2 &&
          badge.decoration === 'none' &&
          ['round', 'superellipse(1)'].includes(badge.corner),
      ),
    );
    for (const [kind, link] of [
      ['ordinary', ordinaryLink],
      ['inline-source', inlineCitation],
      [
        'source-button',
        sourceGroup.locator('.chat-source-link').filter({ hasText: 'docs.example.org' }),
      ],
    ]) {
      await page.evaluate(() => document.activeElement?.blur());
      await page.mouse.move(0, 0);
      const theme = dark ? 'dark' : 'light';
      const normal = await stableLinkAppearance(link, { theme, kind, hovered: false });
      if (kind === 'ordinary')
        await captureRequested(link, 'chat-link-normal-' + theme);
      await link.hover();
      const hovered = await stableLinkAppearance(link, {
        theme,
        kind,
        hovered: true,
        normalColor: normal.color,
      });
      assert.notEqual(
        hovered.color,
        normal.color,
        theme + '/' + kind + ': enabled links visibly change text color on hover',
      );
      assert.ok(
        hovered.cursors.every((cursor) => cursor === 'pointer'),
        'Links and nested text use the hand cursor',
      );
      assert.equal(await link.getAttribute('title'), null);
      if (link === ordinaryLink)
        await captureRequested(link, 'chat-link-hover-' + (dark ? 'dark' : 'light'));
      await page.mouse.move(0, 0);
      await link.focus();
      await page.keyboard.press('Tab');
      await page.keyboard.press('Shift+Tab');
      assert.equal(
        await link.evaluate(
          (node) => document.activeElement === node && node.matches(':focus-visible'),
        ),
        true,
      );
      assert.ok(
        await link.evaluate((node) => parseFloat(getComputedStyle(node).outlineWidth) > 0),
        'Keyboard link focus remains visible',
      );
    }
    const nonLinkCursors = await page
      .locator('.chat-answer .markdown-content')
      .first()
      .evaluate((root) => {
        const probe = document.createElement('p');
        probe.inert = true;
        probe.setAttribute('aria-hidden', 'true');
        probe.innerHTML =
          '<a href="https://example.org/" aria-disabled="true"><strong>disabled</strong></a><a><span>no href</span></a><button class="chat-source-link" disabled><span>disabled source</span></button>';
        root.append(probe);
        try {
          return {
            ordinary: getComputedStyle(root.querySelector('p > strong')).cursor,
            inactive: [...probe.querySelectorAll('*')].map((node) => getComputedStyle(node).cursor),
          };
        } finally {
          probe.remove();
        }
      });
    assert.equal(nonLinkCursors.ordinary, 'text', 'Ordinary answer text remains selectable');
    assert.ok(
      nonLinkCursors.inactive.every((cursor) => cursor === 'default'),
      'Disabled controls and anchors without href stay noninteractive',
    );
    await captureRequested(page, 'chat-source-capsules-' + (dark ? 'dark' : 'light'));
  }
  if (process.argv.some((arg) => arg.startsWith('--screenshots='))) {
    const wasDark = await page.evaluate(() => document.documentElement.classList.contains('dark'));
    for (const dark of [false, true]) {
      await page.evaluate((dark) => document.documentElement.classList.toggle('dark', dark), dark);
      await captureRequested(page, 'chat-markdown-cjk-' + (dark ? 'dark' : 'light'));
    }
    await page.evaluate((dark) => document.documentElement.classList.toggle('dark', dark), wasDark);
  }
  assert.equal(await page.locator('.chat-answer pre code.language-python').count(), 1);
  assert.equal(await page.locator('.chat-answer table').count(), 1);
  await page.screenshot({});
  await page.evaluate(() => {
    navigator.clipboard.writeText = async (text) => {
      window.testCopiedCode = text;
    };
  });
  await page.getByRole('button', { name: '复制代码', exact: true }).click();
  assert.equal(await page.evaluate(() => window.testCopiedCode), 'print("Hello")');
  await page.getByRole('button', { name: '用户菜单', exact: true }).click();
  await page.getByRole('menuitem', { name: '设置', exact: true }).click();
  await page
    .getByRole('navigation', { name: '设置分类' })
    .getByRole('button', { name: '通用', exact: true })
    .click();
  await page.getByRole('button', { name: 'AI 服务', exact: true }).click();
  const usage = page.getByRole('region', { name: '账户额度', exact: true });
  await usage
    .getByText('ChatGPT 账户额度暂不可用，请刷新或查看官方用量。', { exact: true })
    .waitFor();
  assert.equal(await usage.getByRole('button', { name: '重置用量', exact: true }).count(), 0);
  assert.equal(await usage.getByRole('link', { name: '查看官方用量', exact: true }).count(), 1);
  assert.equal(await page.locator('.sidebar .usage-panel').count(), 0);
  const localLedger = await page.evaluate(() => window.desktop.chatUsage());
  assert.equal(
    localLedger.usage.totalTokens,
    6,
    'Existing local ledger remains intact, independently of account quota',
  );
  await page.screenshot({});
  await page.getByRole('button', { name: '关闭设置', exact: true }).click();
  await page.getByRole('textbox', { name: '聊天消息', exact: true }).fill('失败测试');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await page.locator('.chat-answer').getByText('请求失败，未收到回答。', { exact: true }).waitFor();
  assert.equal(await page.getByText('正在等待回答…', { exact: true }).count(), 0);
  await page.getByRole('alert').getByText('格式 text/html', { exact: false }).waitFor();
  await page.getByLabel('添加聊天文件', { exact: true }).setInputFiles({
    name: 'resume.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from('姓名：新姓名\nJD：新的 JD'),
  });
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  const proposals = page.getByRole('region', { name: '待确认的资料更新', exact: true });
  await proposals.first().getByText('选择要保存的资料', { exact: true }).first().waitFor();
  await page.locator('.chat-answer').getByText('已整理资料', { exact: true }).waitFor();
  assert.equal(
    await page.evaluate(() => JSON.parse(localStorage.getItem('copilot-personal-info-v1')).name),
    '旧姓名',
  );
  await proposals.first().getByRole('button', { name: '保留原资料', exact: true }).click();
  assert.equal(
    await page.evaluate(() => JSON.parse(localStorage.getItem('copilot-personal-info-v1')).name),
    '旧姓名',
  );
  await page.getByRole('textbox', { name: '聊天消息', exact: true }).fill('更新个人信息');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await proposals.last().getByRole('button', { name: '保存所选', exact: true }).waitFor();
  await page.screenshot({});
  await page.getByRole('button', { name: '用户菜单', exact: true }).click();
  await page.getByRole('menuitem', { name: '设置', exact: true }).click();
  await page
    .getByRole('navigation', { name: '设置分类' })
    .getByRole('button', { name: '通用', exact: true })
    .click();
  await page.getByRole('button', { name: '外观主题', exact: true }).click();
  await page.getByRole('menuitemradio', { name: '深色', exact: true }).click();
  await page.getByRole('button', { name: 'AI 服务', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: '重置用量', exact: true }).count(), 0);
  assert.equal(
    await usage
      .getByRole('link', { name: '查看官方用量', exact: true })
      .evaluate((node) => getComputedStyle(node).fontSize),
    '12px',
  );
  await page.screenshot({});
  await page.getByRole('button', { name: '关闭设置', exact: true }).click();
  await page.screenshot({});
  await page.getByRole('button', { name: '个人信息', exact: true }).click();
  assert.equal(await page.getByLabel('姓名', { exact: true }).inputValue(), '旧姓名');
  await proposals.last().getByRole('button', { name: '保存所选', exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector('input[placeholder="你的名字"]')?.value === '新姓名',
  );
  assert.equal(await page.getByLabel('姓名', { exact: true }).inputValue(), '新姓名');
  await page.getByRole('button', { name: '个人信息', exact: true }).click();
  await proposals.last().getByText('已保存所选资料', { exact: true }).waitFor();
  assert.deepEqual(
    await page.evaluate(() => JSON.parse(localStorage.getItem('copilot-personal-info-v1'))),
    { name: '新姓名', role: '原岗位', jobDescription: '新的 JD', background: '已有经历' },
  );
  await page.screenshot({});
  assert.equal(await page.title(), 'VoxCue');
  assert.equal(await app.evaluate(({ app }) => app.getName()), 'VoxCue');
  assert.equal(await page.locator('.answer-label strong').first().textContent(), 'ChatGPT');
  assert.equal(
    await page
      .locator('.provider-avatar img')
      .first()
      .evaluate((img) => img.complete && img.naturalWidth > 0),
    true,
  );
  assert.ok((await page.locator('link[rel="icon"]').getAttribute('href')).endsWith('voxcue.png'));
  await page.getByRole('button', { name: '个人信息', exact: true }).click();
  const panel = page.getByRole('complementary', { name: '个人信息', exact: true });
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .every(
        (animation) =>
          animation.effect?.getTiming().iterations === Infinity ||
          animation.playState !== 'running',
      ),
  );
  const resumeSection = panel.locator('.profile-disclosure').first();
  await resumeSection.locator(':scope > summary').click();
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .every(
        (animation) =>
          animation.effect?.getTiming().iterations === Infinity ||
          animation.playState !== 'running',
      ),
  );
  await resumeSection.locator('.profile-section-actions').scrollIntoViewIfNeeded();
  const geometry = await panel
    .locator('.profile-section-actions')
    .first()
    .evaluate((element) => {
      const buttons = [...element.querySelectorAll('button')].map((e) => {
        const rect = e.getBoundingClientRect();
        return {
          label: e.getAttribute('aria-label') || e.textContent,
          y: rect.y,
          height: rect.height,
        };
      });
      return {
        buttons,
        offset: Math.abs(
          buttons[0].y + buttons[0].height / 2 - buttons[1].y - buttons[1].height / 2,
        ),
      };
    });
  assert.ok(geometry.offset < 1, JSON.stringify(geometry));
  await page.screenshot({});
  await page.getByRole('button', { name: '个人信息', exact: true }).click();
  await page.getByRole('textbox', { name: '聊天消息', exact: true }).fill('状态测试');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  for (const label of ['正在思考', '正在联网搜索', '正在查询网页', '正在生成回答']) {
    await page.locator('.progress-state-label.is-active').filter({ hasText: label }).waitFor();
    const pendingAnswer = page.locator('.chat-message.assistant').last();
    assert.equal((await pendingAnswer.locator('.chat-answer').textContent()).trim(), '');
    assert.equal(await pendingAnswer.locator('.chat-message-time').count(), 0, label + ': no assistant clock before answer text');
    assert.equal(await pendingAnswer.locator('.chat-message-actions').count(), 0, label + ': no empty answer footer');
    assert.equal(await page.locator('.chat-message.user').last().locator('.chat-message-time').count(), 1, 'The sent user message still shows its actual time');
    if (label === '正在查询网页') {
      const pagePill = pendingAnswer.locator('.response-steps li[data-kind="open_page"] .chat-source-link');
      await pagePill.getByText('example.com', { exact: true }).waitFor();
      assert.equal(await pagePill.getAttribute('href'), 'https://example.com/docs');
      await page.screenshot({});
    }
  }
  assert.equal(await page.getByText('正在等待服务响应', { exact: true }).count(), 0);
  await page.getByText('状态演示已完成', { exact: true }).waitFor();
  assert.equal(await page.locator('.chat-message.assistant').last().locator('.chat-message-time').count(), 1, 'The assistant clock appears with nonempty answer text');
  await page.locator('.progress-state-label.is-active').waitFor({ state: 'detached' });
  await page.reload();
  await page.getByRole('button', { name: '个人信息', exact: true }).click();
  assert.equal(await page.getByLabel('姓名', { exact: true }).inputValue(), '新姓名');
  const jd = page.locator('details[aria-label="职位描述摘要"]');
  await jd.locator(':scope > summary').click();
  await jd.getByText('新的 JD', { exact: true }).waitFor();
  assert.equal(await page.locator('.composer-caption').count(), 0);
  assert.equal(await page.locator('.effort-model-trigger').count(), 1);
  assert.equal(await page.getByRole('button', { name: '思考强度', exact: true }).count(), 0);

  console.log(
    'PASS: compact tools, Markdown/code copy, effort, official account usage entry, preserved local ledger and light/dark typography, failure state, attachment proposal, reject/confirm. Test transport only; no production account used.',
  );
} catch (error) {
  const current = app.windows().at(-1);
  if (current && !current.isClosed()) {
    await current.screenshot({});
    console.log((await current.locator('body').innerText()).slice(-2500));
  }
  throw error;
} finally {
  await closeUiApp(app);
}
