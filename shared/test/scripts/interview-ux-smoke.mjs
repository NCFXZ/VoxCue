import { connectUiAccount } from './install-ui-account.mjs';
import { testRoot, electron } from './test-workspace.mjs';
import { offlineElectronEntry } from './offline-electron-entry.mjs';
import { installUiAccount, closeUiApp } from './install-ui-account.mjs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import workspace from '../../scripts/workspace.mjs';
import { waitForAsync } from './wait-for-async.mjs';

const nativeProbe =
  process.platform === 'win32'
    ? (
        await import(
          pathToFileURL(path.join(workspace.platformRoot, 'test/scripts/window-probe.mjs')).href
        )
      ).probe
    : undefined;
const originalCursor = nativeProbe?.('cursor');

const screenshotOption = process.argv.slice(2).find((value) => value.startsWith('--screenshots='));
const memoryPreview = process.argv.includes('--memory-preview');
if (
  process.argv.slice(2).some((value) => value !== screenshotOption && value !== '--memory-preview')
)
  throw Error('Only --screenshots=<requested-output-directory> and --memory-preview are supported');
const screenshots = screenshotOption ? path.resolve(screenshotOption.slice(14)) : undefined;
if (screenshots) await mkdir(screenshots, { recursive: true });
const profile = path.join(testRoot, 'interview-ux');
await mkdir(profile);
const app = await electron.launch({
  args: [await offlineElectronEntry()],
  env: { ...process.env, COPILOT_TEST_USER_DATA: profile, VITE_DEV_SERVER_URL: '' },
});
const checks = [];
async function capture(page, name) {
  // Media emulation acknowledges before Chromium necessarily paints the new
  // palette. Flush its style/frame update before waiting for finite transitions.
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .every(
        (a) =>
          a.effect?.target?.closest?.('.interview-readiness-symbol') ||
          a.effect?.getTiming().iterations === Infinity ||
          a.playState !== 'running',
      ),
  );
  if (screenshots)
    await page.screenshot({
      path: path.join(screenshots, name + '.png'),
      type: 'png',
      scale: 'css',
    });
  if (memoryPreview && ['settings-layout-wide-light', 'settings-layout-narrow-dark'].includes(name))
    console.log(
      'VOXCUE_SETTINGS_PREVIEW:' +
        (
          await page
            .getByRole('dialog', { name: '面试设置', exact: true })
            .screenshot({ type: 'jpeg', quality: 60, scale: 'css' })
        ).toString('base64'),
    );
}
async function settingsLayout(dialog) {
  const result = await dialog.evaluate((element) => {
    const rect = (node) => node.getBoundingClientRect().toJSON();
    const rows = [...element.querySelectorAll('.speech-setting-row')].map((row) => {
      const label = row.querySelector('.speech-setting-label');
      const range = document.createRange();
      range.selectNodeContents(label);
      return {
        text: label.textContent,
        lines: range.getClientRects().length,
        label: rect(label),
        control: rect(row.querySelector('.choice-trigger')),
        row: rect(row),
      };
    });
    return {
      rows,
      sections: [...element.querySelectorAll('.interview-settings-section')].map(rect),
      overflow: element.scrollWidth > element.clientWidth + 1,
      audio: [...element.querySelectorAll('.audio-device-editor .choice-trigger')].map(rect),
      groups: [...element.querySelectorAll('.speech-model-group')].map((group) => ({
        width: group.clientWidth,
        scrollWidth: group.scrollWidth,
      })),
    };
  });
  assert.equal(result.overflow, false);
  assert.equal(result.rows.length, 4);
  for (const row of result.rows) {
    assert.equal(row.lines, 1, `${row.text}: label must remain horizontal`);
    assert.ok(
      row.control.top >= row.label.bottom + 5,
      `${row.text}: control belongs below its label`,
    );
    assert.ok(Math.abs(row.row.width - row.control.width) < 1);
    assert.ok(row.control.width >= 150);
  }
  for (let i = 1; i < result.sections.length; i++)
    assert.ok(result.sections[i].top >= result.sections[i - 1].bottom);
  for (const group of result.groups) assert.ok(group.scrollWidth <= group.width + 1);
  return result;
}
async function geometry(page) {
  const result = await page.evaluate(() => {
    const visible = (e) =>
      e.getBoundingClientRect().width > 0 && e.getBoundingClientRect().height > 0;
    return {
      overflow: [
        ...document.querySelectorAll(
          '.audio-check,.audio-input-meters,.audio-recovery,.interview-settings-dialog,.audio-device-editor',
        ),
      ]
        .filter(visible)
        .filter((e) => e.scrollWidth > e.clientWidth + 1)
        .map((e) => e.className),
      dialogs: [...document.querySelectorAll('dialog[open]')].map((e) => {
        const r = e.getBoundingClientRect();
        return (
          r.left >= -1 && r.right <= innerWidth + 1 && r.top >= -1 && r.bottom <= innerHeight + 1
        );
      }),
      echoCopy: document.body.innerText.includes('回声消除'),
    };
  });
  assert.deepEqual(result.overflow, []);
  assert.ok(result.dialogs.every(Boolean));
  assert.equal(result.echoCopy, false);
}
try {
  await installUiAccount(app, { speech: true, components: true });
  await app.evaluate(({ app }) => {
    const require = process
      .getBuiltinModule('module')
      .createRequire(app.getAppPath() + '/package.json');
    const { ComponentService } = require(
      app.getAppPath() + '/dist-electron/shared/electron/backend/components/service.js',
    );
    const { SpeechHost } = require(
      app.getAppPath() + '/dist-electron/shared/electron/backend/speech/host.js',
    );
    const { ChatGPTService } = require(
      app.getAppPath() + '/dist-electron/shared/electron/backend/chat/service.js',
    );
    const platform = process.platform === 'darwin' ? 'macos' : 'windows';
    const { InterviewAccess } = require(
      app.getAppPath() + '/dist-electron/' + platform + '/electron/speech/access.js',
    );
    InterviewAccess.prototype.check = async (options) => ({
      ready: true,
      checks: options.sources.map((source) => ({
        source,
        status: 'granted',
        message: 'Synthetic',
      })),
      devices: [
        { id: 'output', source: 'system', name: '合成播放设备', default: true },
        { id: 'input', source: 'microphone', name: '合成麦克风', default: true },
      ],
    });
    globalThis.uxNeedSpeech = true;
    globalThis.uxComponentRevision = 0;
    globalThis.uxDownloads = [];
    globalThis.uxCalls = [];
    globalThis.uxAnswers = 0;
    globalThis.uxDevices = [
      { id: 'output', source: 'system', name: '合成播放设备', default: true },
      { id: 'input', source: 'microphone', name: '合成麦克风', default: true },
    ];
    globalThis.uxRequests = [];
    globalThis.uxHold = false;
    globalThis.uxHoldSpeech = false;
    globalThis.uxFailSpeech = false;
    const state = ComponentService.prototype.state;
    ComponentService.prototype.state = function () {
      const result = state.call(this);
      return {
        ...result,
        revision: result.revision + globalThis.uxComponentRevision,
        phase: globalThis.uxNeedSpeech ? 'needed' : 'ready',
        items: result.items.map((item) => ({
          ...item,
          phase:
            globalThis.uxNeedSpeech && ['speech', 'qwen'].includes(item.id) ? 'pending' : 'ready',
        })),
      };
    };
    ComponentService.prototype.ready = (id) =>
      !(['speech', 'qwen'].includes(id) && globalThis.uxNeedSpeech);
    ComponentService.prototype.download = async function (id) {
      globalThis.uxDownloads.push(id);
      globalThis.uxNeedSpeech = false;
      globalThis.uxComponentRevision++;
      return this.state();
    };
    SpeechHost.prototype.call = async function (call) {
      globalThis.uxCalls.push(call);
      globalThis.uxHost = this;
      const devices = globalThis.uxDevices;
      if (call.op === 'devices') return { state: 'idle', model: 'Synthetic', devices };
      if (call.op === 'switch-recognizer') {
        const previous = this.uxStatus;
        this.emit({ type: 'status', status: { ...previous, switching: 'loading' } });
        globalThis.uxSpeechWait = () =>
          this.emit({ type: 'status', status: { ...previous, switching: 'waiting' } });
        if (globalThis.uxHoldSpeech)
          await new Promise((resolve) => {
            globalThis.uxSpeechFinish = resolve;
          });
        if (globalThis.uxFailSpeech) {
          this.emit({ type: 'status', status: previous });
          throw Error('合成候选加载失败，仍使用原配置。');
        }
        const status = {
          state: 'running',
          model: 'Synthetic',
          speechModel: call.options.speechModel,
          inferenceDevice: call.options.inferenceDevice,
        };
        this.uxStatus = status;
        this.emit({ type: 'status', status });
        return status;
      }
      clearInterval(globalThis.uxLevels);
      clearInterval(globalThis.uxProgress);
      const status = {
        state: call.op === 'start' ? 'running' : call.op === 'pause' ? 'paused' : 'idle',
        model: 'Synthetic',
      };
      this.uxStatus = status;
      if (call.op === 'start')
        globalThis.uxLevels = setInterval(() => {
          for (const source of call.options.sources)
            this.emit({
              type: 'activity',
              source,
              speaking: true,
              level: source === 'system' ? 0.08 : 0.04,
            });
        }, 100);
      if (call.op === 'start')
        globalThis.uxProgress = setInterval(
          () =>
            this.emit({
              type: 'audio-progress',
              source: 'system',
              pending: false,
              processedThroughMs: Date.now(),
            }),
          100,
        );
      this.emit({ type: 'status', status });
      return status;
    };
    SpeechHost.prototype.stop = function () {
      clearInterval(globalThis.uxLevels);
      clearInterval(globalThis.uxProgress);
    };
    ChatGPTService.prototype.models = async () => [
      { id: 'test-model', label: 'Test Model', description: '', reasoningEfforts: ['low', 'high'] },
      { id: 'next-model', label: '验证模型', description: '', reasoningEfforts: ['high'] },
    ];
    ChatGPTService.prototype.stream = async function (request, emit, signal) {
      const answering = !request.id.startsWith('history-title-');
      if (answering) {
        globalThis.uxAnswers++;
        globalThis.uxRequests.push({ modelId: request.modelId, effort: request.effort });
      }
      const held = answering && globalThis.uxHold;
      if (held) {
        globalThis.uxHold = false;
        globalThis.uxCurrentSignal = signal;
      }
      const text = request.id.startsWith('history-title-')
        ? '项目介绍与追问'
        : held
          ? '当前回答继续使用原模型。'
          : '我会先确认问题和边界，再结合已知事实说明实现方法。';
      emit({ id: request.id, type: 'delta', text });
      if (held)
        await new Promise((resolve) => {
          globalThis.uxFinish = resolve;
        });
      return {
        answerText: text,
        usage: null,
        sources: [],
        provider: { id: 'chatgpt', name: 'ChatGPT', dataRecipient: 'OpenAI' },
      };
    };
  });
  const login = await app.firstWindow();
  const page = await connectUiAccount(app, login);
  page.setDefaultTimeout(15000);
  await page.getByRole('heading', { name: '今天想准备哪一部分面试？', exact: true }).waitFor();
  await page.getByLabel('本地组件提示', { exact: true }).waitFor();
  assert.ok(await page.getByRole('button', { name: '开始面试', exact: true }).isDisabled());
  await geometry(page);
  await capture(page, '01-readiness');
  await page
    .getByLabel('本地组件提示', { exact: true })
    .getByRole('button', { name: '前往设置', exact: true })
    .click();
  await page
    .locator('.component-row[data-component-id="speech"]')
    .getByRole('button', { name: '下载', exact: true })
    .click();
  await page.getByRole('button', { name: '关闭设置', exact: true }).click();
  await page.getByLabel('本地组件提示', { exact: true }).waitFor({ state: 'hidden' });
  assert.deepEqual(await app.evaluate(() => globalThis.uxDownloads), ['speech']);
  assert.equal(await page.getByText('ChatGPT 可用', { exact: true }).count(), 0);
  assert.equal(await page.getByText('面试练习助手', { exact: true }).count(), 0);
  const brand = await page.locator('.sidebar-wordmark').evaluate((e) => ({
    font: getComputedStyle(e.querySelector('strong')).fontSize,
    title: getComputedStyle(document.querySelector('.page-toolbar .breadcrumb > strong')).fontSize,
    logo: parseFloat(getComputedStyle(e.querySelector('.app-logo')).width),
  }));
  assert.equal(brand.font, brand.title);
  assert.equal(brand.logo, 24);
  checks.push('restored compact component notice and simpler sidebar');

  await page.getByRole('button', { name: '个人信息', exact: true }).click();
  const panel = page.getByRole('complementary', { name: '个人信息', exact: true });
  assert.equal(await panel.locator('.profile-empty-circle').count(), 5);
  assert.equal(await panel.locator('.profile-overview .is-ready').count(), 0);
  await capture(page, '02-profile-empty');
  for (const [name, text] of [
    ['简历摘要', '合成资料：负责检索服务和客户端研发，带领四人团队完成性能改进。'],
    ['职位描述摘要', '合成岗位：客户端工程师，关注跨平台体验与稳定性。'],
  ]) {
    const section = panel.locator(`details[aria-label="${name}"]`);
    await section.locator(':scope > summary').click();
    await section.getByRole('button', { name: '编辑', exact: true }).click();
    const editor = page.getByRole('dialog', { name: '编辑' + name, exact: true });
    await editor.getByRole('textbox').fill(text);
    await editor.getByRole('button', { name: '保存', exact: true }).click();
    await editor.waitFor({ state: 'hidden' });
    await section.locator(':scope > summary').click();
  }
  assert.equal(await panel.locator('.profile-overview .is-ready').count(), 2);
  assert.equal(await panel.locator('.profile-empty-circle').count(), 3);
  await panel.locator('.personal-panel-scroll').evaluate((element) => (element.scrollTop = 0));
  await capture(page, '03-profile-saved');
  await page.getByRole('button', { name: '个人信息', exact: true }).click();
  assert.equal(await panel.getByText('可选', { exact: true }).count(), 0);
  checks.push('profile completion without optional labels or redundant instructions');

  await page.getByRole('button', { name: '用户菜单', exact: true }).click();
  await page.getByRole('menuitem', { name: '设置', exact: true }).click();
  await page
    .getByRole('navigation', { name: '设置分类' })
    .getByRole('button', { name: '个性化', exact: true })
    .click();
  const settings = page.getByRole('dialog', { name: '设置', exact: true });
  await settings.getByRole('button', { name: '面试设置', exact: true }).click();
  await settings.getByRole('slider', { name: '面试字体大小', exact: true }).fill('16');
  assert.equal(
    await settings.getByRole('slider', { name: '面试背景透明度', exact: true }).count(),
    0,
  );
  await settings.getByRole('heading', { name: '模型设置', exact: true }).waitFor();
  assert.equal(await settings.getByRole('button', { name: '测试麦克风', exact: true }).count(), 0);
  assert.equal(await settings.getByRole('button', { name: '刷新设备', exact: true }).count(), 0);
  await app.evaluate(() =>
    globalThis.uxDevices.push({ id: 'input-2', source: 'microphone', name: '合成麦克风2' }),
  );
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await settings.getByRole('button', { name: '麦克风设备', exact: true }).click();
  await page.getByRole('menuitemradio', { name: '合成麦克风2', exact: true }).waitFor();
  await page.keyboard.press('Escape');
  await settings.locator('.settings-content').evaluate((element) => (element.scrollTop = 0));
  await capture(page, '09-display-settings');
  assert.equal(
    await page.evaluate(() => document.documentElement.dataset.interviewTransparency),
    '100',
  );
  const preview = settings.locator('.interview-preview-scene');
  await preview.scrollIntoViewIfNeeded();
  if (screenshots)
    await preview.screenshot({
      path: path.join(screenshots, '12-layered-preview.png'),
      scale: 'css',
    });
  const layers = await preview.evaluate((e) =>
    Object.fromEntries(
      [
        '.floating-panel',
        '.floating-toolbar',
        '.answer-bubble',
        '.floating-composer',
        '.transcript-item p',
      ].map((selector) => {
        const style = getComputedStyle(e.querySelector(selector));
        return [selector, { fill: style.backgroundColor, image: style.backgroundImage }];
      }),
    ),
  );
  assert.notEqual(layers['.floating-panel'].fill, layers['.answer-bubble'].fill);
  assert.equal(layers['.floating-toolbar'].fill, layers['.floating-panel'].fill);
  const commonFill = await preview.locator('.floating-toolbar').evaluate((node) => {
    const probe = document.createElement('span');
    probe.style.backgroundColor = 'var(--web-material-fill)';
    node.append(probe);
    const fill = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return fill;
  });
  assert.equal(
    layers['.floating-toolbar'].image,
    `linear-gradient(${commonFill}, ${commonFill}), none`,
  );
  assert.notEqual(layers['.answer-bubble'].fill, layers['.floating-composer'].fill);
  assert.equal(layers['.answer-bubble'].fill, layers['.transcript-item p'].fill);
  const misSizedIcons = await settings
    .locator('svg[data-ui-icon]')
    .evaluateAll((icons) =>
      icons
        .filter(
          (e) =>
            e.getBoundingClientRect().width > 0 &&
            (Math.abs(
              parseFloat(getComputedStyle(e).width) -
                parseFloat(e.style.getPropertyValue('--icon-size')),
            ) > 0.01 ||
              Math.abs(
                parseFloat(getComputedStyle(e).height) -
                  parseFloat(e.style.getPropertyValue('--icon-size')),
              ) > 0.01),
        )
        .map((e) => e.outerHTML),
    );
  assert.deepEqual(misSizedIcons, []);
  await settings.getByRole('button', { name: '个性化', exact: true }).click();
  assert.equal(
    await settings.getByRole('slider', { name: '毛玻璃透明度', exact: true }).count(),
    0,
  );
  assert.equal(
    await page.evaluate(() => document.documentElement.dataset.frostedTransparency),
    '100',
  );
  await settings.getByRole('button', { name: '关闭设置', exact: true }).click();
  await page.getByRole('button', { name: '开始面试', exact: true }).click();
  const start = page.getByRole('dialog', { name: '开始面试', exact: true });
  await page.evaluate(() => {
    globalThis.uxTestEvents = [];
    globalThis.uxRemoveListener = window.desktop.onDictationEvent((event) =>
      globalThis.uxTestEvents.push(event),
    );
  });
  await start.getByRole('button', { name: '测试系统声音', exact: true }).click();
  await start.getByRole('button', { name: '停止系统声音测试' }).waitFor();
  await app.evaluate(() =>
    globalThis.uxHost.emit({
      type: 'segment',
      segment: {
        id: 'test-private',
        source: 'system',
        text: '此测试转写不得进入资料或面试',
        final: true,
        startMs: Date.now(),
        endMs: Date.now(),
        silenceStartMs: Date.now() - 800,
        reason: 'silence',
      },
    }),
  );
  await start.getByRole('meter', { name: '系统声音电平', exact: true }).waitFor();
  assert.equal(
    await start.getByRole('button', { name: '停止系统声音测试', exact: true }).innerText(),
    '停止',
  );
  await start.getByRole('meter', { name: '系统声音电平', exact: true }).evaluate(
    (e) =>
      new Promise((resolve) => {
        const check = () =>
          Number(e.getAttribute('aria-valuenow')) > 0 ? resolve() : requestAnimationFrame(check);
        check();
      }),
  );
  assert.ok(await start.getByRole('button', { name: '确认开始', exact: true }).isDisabled());
  assert.ok(
    await start.getByRole('button', { name: '确认开始', exact: true }).evaluate((element) => {
      const r = element.getBoundingClientRect();
      return r.top >= 0 && r.bottom <= innerHeight;
    }),
  );
  await geometry(page);
  assert.equal(await start.getByText('有输入', { exact: true }).count(), 0);
  assert.equal(await start.locator('.modal-footer .interview-start-description').count(), 1);
  assert.equal(await start.getByRole('button', { name: '前往面试设置', exact: true }).count(), 0);
  assert.ok(
    await start
      .locator('.modal-footer')
      .evaluate(
        (e) =>
          e.querySelector('.interview-start-description').getBoundingClientRect().bottom <=
          e.querySelector('.interview-start-actions').getBoundingClientRect().top,
      ),
  );
  await capture(page, '04-audio-check');
  await start.getByRole('button', { name: '测试系统声音', exact: true }).waitFor();
  assert.equal(await start.locator('.audio-check-inline').count(), 0);
  await start.getByRole('button', { name: '测试麦克风', exact: true }).click();
  await start.getByRole('meter', { name: '麦克风电平', exact: true }).waitFor();
  await start.getByRole('button', { name: '停止麦克风测试', exact: true }).click();
  await start.getByRole('button', { name: '测试麦克风', exact: true }).waitFor();
  const testEvents = await page.evaluate(() => {
    globalThis.uxRemoveListener();
    return globalThis.uxTestEvents.map((e) => e.type);
  });
  assert.ok(testEvents.includes('activity'));
  assert.ok(!testEvents.includes('segment'));
  checks.push('10-second dual-source test, activity-only routing, release before interview');

  // Observe from creation: production deduplicates unchanged native states.
  // A late observer can miss an already-enabled passthrough state entirely.
  await app.evaluate(({ BrowserWindow }) => {
    const original = BrowserWindow.prototype.setIgnoreMouseEvents;
    globalThis.uxRestorePassthrough = () => {
      BrowserWindow.prototype.setIgnoreMouseEvents = original;
    };
    BrowserWindow.prototype.setIgnoreMouseEvents = function (ignore, ...args) {
      globalThis.uxIgnored = ignore;
      return original.call(this, ignore, ...args);
    };
  });
  const [floating] = await Promise.all([
    app.waitForEvent('window'),
    start.getByRole('button', { name: '确认开始', exact: true }).click(),
  ]);
  floating.setDefaultTimeout(15000);
  await floating.getByRole('status', { name: '语音模型：正常', exact: true }).waitFor();
  await app.evaluate(() => clearInterval(globalThis.uxLevels));
  const badge = (label, status) =>
    floating.getByRole('status', { name: `${label}：${status}`, exact: true });
  await badge('系统音频', '正常').waitFor();
  await app.evaluate(() => {
    globalThis.uxHost.emit({ type: 'activity', source: 'microphone', speaking: true, level: 0.08 });
    globalThis.uxHost.emit({ type: 'activity', source: 'system', speaking: false, level: 0.04 });
  });
  await badge('麦克风', '有输入').waitFor();
  await badge('系统音频', '有输入').waitFor();
  assert.equal(await badge('语音模型', '有输入').count(), 0);
  const bars = floating.locator(
    '.interview-ready-badge[aria-label^="麦克风："] .interview-readiness-level i',
  );
  assert.equal(await bars.count(), 3);
  assert.equal(await bars.first().evaluate((e) => getComputedStyle(e).transitionDuration), '0.09s');
  const firstLevel = await bars.first().evaluate((e) => getComputedStyle(e).transform);
  await app.evaluate(() =>
    globalThis.uxHost.emit({ type: 'activity', source: 'microphone', speaking: false, level: 0 }),
  );
  await floating.waitForFunction((before) => {
    const bar = document.querySelector(
      '.interview-ready-badge[aria-label^="麦克风："] .interview-readiness-level i',
    );
    return bar && getComputedStyle(bar).transform !== before;
  }, firstLevel);
  await badge('麦克风', '正常').waitFor();
  await badge('系统音频', '正常').waitFor();
  await app.evaluate(() => {
    globalThis.uxBadgeActivity = setInterval(
      () =>
        globalThis.uxHost.emit({
          type: 'activity',
          source: 'microphone',
          speaking: true,
          level: 0.06,
        }),
      100,
    );
    globalThis.uxHost.emit({
      type: 'gap',
      source: 'system',
      message: '合成播放设备连接中断，请检查设备连接。',
    });
  });
  await badge('麦克风', '有输入').waitFor();
  await badge('系统音频', '异常').hover();
  await floating
    .getByRole('tooltip', { name: '系统音频：合成播放设备连接中断，请检查设备连接。', exact: true })
    .waitFor();
  await capture(floating, '15-compact-status');
  await app.evaluate(() => {
    clearInterval(globalThis.uxBadgeActivity);
    globalThis.uxHost.emit({ type: 'activity', source: 'system', speaking: false, level: 0 });
  });
  await badge('系统音频', '正常').waitFor();
  await floating.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await bars.first().evaluate((e) => getComputedStyle(e).transitionDuration), '0s');
  await floating.emulateMedia({ reducedMotion: 'no-preference' });
  checks.push(
    'compact status uses actual source activity with animated decay, source-specific warning tooltip, disabled/paused states and reduced-motion support',
  );
  await app.evaluate(() =>
    globalThis.uxHost.emit({
      type: 'segment',
      segment: {
        id: 'pending-1',
        source: 'system',
        text: '请介绍一个你负责过的项目。',
        final: true,
        startMs: Date.now(),
        endMs: Date.now(),
        silenceStartMs: Date.now() - 800,
        reason: 'silence',
      },
    }),
  );
  assert.equal(await floating.getByRole('button', { name: '取消本次', exact: true }).count(), 0);
  assert.equal(await floating.getByText('待提交问题', { exact: true }).count(), 0);
  assert.equal(await floating.locator('.floating-composer-options').getByRole('status').count(), 0);
  await floating
    .getByText('我会先确认问题和边界，再结合已知事实说明实现方法。', { exact: true })
    .waitFor();
  await app.evaluate(() => {
    clearInterval(globalThis.uxLevels);
    globalThis.uxHost.emit({
      type: 'status',
      status: {
        state: 'error',
        model: 'Synthetic',
        error: '所选音频设备已断开。',
        failureSource: 'system',
      },
    });
  });
  await floating.getByRole('button', { name: '重新连接音频', exact: true }).waitFor();
  await badge('系统音频', '异常').waitFor();
  await badge('麦克风', '已暂停').waitFor();
  await badge('语音模型', '已暂停').waitFor();
  await geometry(floating);
  await capture(floating, '06-audio-recovery');
  await floating.getByRole('button', { name: '重新连接音频', exact: true }).click();
  await badge('语音模型', '正常').waitFor();
  assert.ok(
    await floating
      .getByText('我会先确认问题和边界，再结合已知事实说明实现方法。', { exact: true })
      .isVisible(),
  );
  assert.ok((await floating.getByText('请介绍一个你负责过的项目。', { exact: true }).count()) > 0);
  await app.evaluate(() => {
    globalThis.uxHold = true;
  });
  await floating
    .getByRole('textbox', { name: '面试提问', exact: true })
    .fill('如何设计清晰的接口？');
  await floating.getByRole('button', { name: '发送面试问题', exact: true }).click();
  await floating.getByRole('button', { name: '停止当前回答', exact: true }).waitFor();
  await floating.getByText('当前回答继续使用原模型。', { exact: true }).waitFor();
  const clearCorner = { x: 12, y: 12, width: 48, height: 24 };
  const unobscured = await floating.screenshot({ clip: clearCorner, scale: 'css' });
  const passthrough = await floating.evaluate(
    () => window.desktop.presentation.interviewMousePassthrough,
  );
  const waitNativePassthrough = async (expected) => {
    const matched = await app.evaluate(async (_electron, expected) => {
      const deadline = Date.now() + 3000;
      while (Date.now() < deadline) {
        if (globalThis.uxIgnored === expected) return true;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      return false;
    }, expected);
    assert.equal(
      matched,
      true,
      JSON.stringify({
        expected,
        actual: await app.evaluate(() => globalThis.uxIgnored),
        document: await floating.evaluate(() => ({
          corner: document.elementFromPoint(2, 2)?.outerHTML.slice(0, 300),
          dialogs: [...document.querySelectorAll('dialog[open]')].map((d) =>
            d.getAttribute('aria-label'),
          ),
        })),
      }),
    );
  };
  const moveToBlankCorner = async () => {
    await floating.mouse.move(2, 2);
    if (process.platform === 'darwin') {
      // Native forwarding can replay the stationary OS cursor after a CDP move.
      // Supply this fixture's viewport input directly; hit testing, preload/IPC
      // and the real BrowserWindow passthrough call remain under test.
      await floating.evaluate(() =>
        window.dispatchEvent(
          new MouseEvent('mousemove', { clientX: 2, clientY: 2, bubbles: true }),
        ),
      );
    }
    await waitNativePassthrough(true);
  };
  if (passthrough) {
    if (nativeProbe) {
      // CDP mouse movement leaves the Windows cursor unchanged. The production
      // stale-leave guard checks that cursor, so move it onto this window's own
      // blank corner before checking actual native passthrough at every DPI.
      const point = await app.evaluate(({ BrowserWindow, screen }, url) => {
        const win = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL() === url);
        win.moveTop();
        win.focus();
        const bounds = win.getContentBounds();
        return screen.dipToScreenPoint({ x: bounds.x + 2, y: bounds.y + 2 });
      }, floating.url());
      assert.equal(nativeProbe('desktop').interactive, true);
      nativeProbe('move', point.x, point.y);
    }
    await moveToBlankCorner();
  }
  await floating.evaluate(() => {
    window.uxDialogEvents = [];
    for (const type of ['pointerdown', 'cancel', 'close'])
      document.addEventListener(
        type,
        (event) => {
          const target = event.target;
          window.uxDialogEvents.push({
            type,
            trusted: event.isTrusted,
            tag: target.tagName,
            label: target.getAttribute?.('aria-label'),
          });
          window.uxDialogEvents = window.uxDialogEvents.slice(-20);
        },
        true,
      );
  });
  await floating.getByRole('button', { name: '面试设置', exact: true }).click();
  const devices = floating.getByRole('dialog', { name: '面试设置', exact: true });
  await settingsLayout(devices);
  assert.equal(
    await floating.evaluate(() => typeof window.desktop.setInterviewSettingsMaterial),
    'undefined',
  );
  const settingsCorner = await floating.screenshot({ clip: clearCorner, scale: 'css' });
  assert.equal(
    unobscured.equals(settingsCorner),
    true,
    'Interview settings leave the background unchanged',
  );
  const clearPixels = await app.evaluate(({ nativeImage }, bytes) => {
    const pixels = nativeImage.createFromBuffer(Buffer.from(bytes, 'base64')).toBitmap();
    let valid = true;
    for (let i = 0; i < pixels.length; i += 4) valid &&= pixels[i + 3] === 0;
    return { valid, first: [...pixels.subarray(0, 4)] };
  }, settingsCorner.toString('base64'));
  assert.equal(clearPixels.valid, true, JSON.stringify(clearPixels));
  if (passthrough) {
    await waitNativePassthrough(false);
    await floating.mouse.move(2, 2);
    await floating.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
    assert.equal(await app.evaluate(() => globalThis.uxIgnored), false);
  }
  // Dismissal consumes the first click on both the transcript and toolbar.
  await floating.mouse.click(45, 190);
  await devices.waitFor({ state: 'hidden' });
  assert.equal(
    unobscured.equals(await floating.screenshot({ clip: clearCorner, scale: 'css' })),
    true,
    'Closing settings preserves the clear background',
  );
  await floating.getByRole('button', { name: '面试设置', exact: true }).click();
  const end = await floating.getByRole('button', { name: '结束面试', exact: true }).boundingBox();
  await floating.mouse.click(end.x + end.width / 2, end.y + end.height / 2);
  await devices.waitFor({ state: 'hidden' });
  assert.equal(
    await floating.getByRole('button', { name: '确认结束面试', exact: true }).count(),
    0,
  );
  await floating.getByRole('button', { name: '面试设置', exact: true }).click();
  assert.equal(await devices.getByRole('button', { name: '刷新设备', exact: true }).count(), 0);
  await app.evaluate(() =>
    globalThis.uxDevices.push({ id: 'output-2', source: 'system', name: '合成播放设备2' }),
  );
  await floating.evaluate(() => window.dispatchEvent(new Event('focus')));
  await devices.getByRole('button', { name: '选择播放设备', exact: true }).click();
  await floating.getByRole('menuitemradio', { name: '合成播放设备2', exact: true }).waitFor();
  await floating.keyboard.press('Escape');
  await devices.getByRole('button', { name: '选择麦克风', exact: true }).click();
  await devices.getByRole('menuitemradio', { name: '不使用麦克风', exact: true }).click();
  await badge('麦克风', '未启用').waitFor();
  const configuration = await floating.evaluate(() => window.desktop.interviewState());
  assert.deepEqual(configuration.configuration.options.sources, ['system']);
  const captureCalls = () =>
    app.evaluate(
      () =>
        globalThis.uxCalls.filter((call) => ['start', 'stop', 'pause'].includes(call.op)).length,
    );
  const capturesBefore = await captureCalls();
  for (const label of ['选择播放设备', '选择麦克风', '选择播放设备', '选择麦克风']) {
    const trigger = devices.getByRole('button', { name: label, exact: true, includeHidden: true });
    await trigger.dispatchEvent('keydown', { key: 'Enter', code: 'Enter' });
    assert.equal(await floating.getByRole('menu').count(), 1);
    assert.equal(await devices.locator('[aria-haspopup="menu"][aria-expanded="true"]').count(), 1);
    assert.equal(
      await floating.getByRole('menu').getAttribute('aria-labelledby'),
      await trigger.getAttribute('id'),
    );
  }
  await floating.keyboard.press('Escape');
  assert.equal(await floating.getByRole('menu').count(), 0);
  assert.equal(await captureCalls(), capturesBefore);
  await app.evaluate(() => {
    globalThis.uxHoldSpeech = true;
  });
  await devices.getByRole('button', { name: '语音识别模型', exact: true }).click();
  await floating.getByRole('menuitemradio', { name: 'Qwen3-ASR 0.6B', exact: true }).click();
  await devices.getByRole('status').filter({ hasText: '原配置继续转写' }).waitFor();
  assert.equal(
    await devices.getByRole('button', { name: '语音识别模型', exact: true }).isDisabled(),
    true,
  );
  assert.equal(
    await devices.getByRole('button', { name: '选择播放设备', exact: true }).isDisabled(),
    true,
  );
  assert.equal(
    await devices.getByRole('button', { name: '面试回答模型', exact: true }).isDisabled(),
    false,
  );
  await waitForAsync(app, () => typeof globalThis.uxSpeechWait === 'function');
  await app.evaluate(() => globalThis.uxSpeechWait());
  await devices.getByRole('status').filter({ hasText: '等待语音停顿' }).waitFor();
  await devices.getByRole('button', { name: '面试回答模型', exact: true }).click();
  await floating.getByRole('menuitemradio', { name: '验证模型', exact: true }).click();
  await waitForAsync(
    floating,
    async () => (await window.desktop.interviewState()).configuration.modelId === 'next-model',
  );
  await devices.getByRole('button', { name: '面试思考强度', exact: true }).click();
  await floating.getByRole('menuitemradio', { name: '高', exact: true }).click();
  await waitForAsync(
    floating,
    async () => (await window.desktop.interviewState()).configuration.effort === 'high',
  );
  assert.equal(await app.evaluate(() => globalThis.uxCurrentSignal.aborted), false);
  await app.evaluate(() => {
    globalThis.uxHoldSpeech = false;
    globalThis.uxSpeechFinish();
  });
  await waitForAsync(
    floating,
    async () =>
      (await window.desktop.interviewState()).configuration.options.speechModel === 'qwen',
  );
  await devices.getByRole('button', { name: '语音推理设备', exact: true }).click();
  await floating.getByRole('menuitemradio', { name: 'CPU', exact: true }).click();
  await waitForAsync(
    floating,
    async () =>
      (await window.desktop.interviewState()).configuration.options.inferenceDevice === 'cpu',
  );
  await app.evaluate(() => {
    globalThis.uxFailSpeech = true;
  });
  await devices.getByRole('button', { name: '语音推理设备', exact: true }).click();
  await floating
    .getByRole('menuitemradio', {
      name: process.platform === 'darwin' ? 'Metal（推荐）' : 'CUDA（推荐）',
      exact: true,
    })
    .click();
  await devices.getByRole('alert').filter({ hasText: '合成候选加载失败' }).waitFor();
  assert.equal(
    (await floating.evaluate(() => window.desktop.interviewState())).configuration.options
      .inferenceDevice,
    'cpu',
  );
  assert.equal(await floating.getByText('音频采集中断', { exact: true }).count(), 0);
  await app.evaluate(() => {
    globalThis.uxFailSpeech = false;
  });
  await devices.getByRole('button', { name: '语音识别模型', exact: true }).click();
  await floating.getByRole('menuitemradio', { name: 'Paraformer 中英 INT8', exact: true }).click();
  await waitForAsync(
    floating,
    async () =>
      (await window.desktop.interviewState()).configuration.options.speechModel === 'paraformer',
  );
  assert.equal(await captureCalls(), capturesBefore);
  checks.push(
    'background speech/model device switches preserve capture; pending switch leaves answer model editable; failure retains old device without capture error',
  );
  const slider = devices.getByRole('slider', { name: '面试字体大小', exact: true });
  await slider.fill('18');
  assert.equal(
    await devices.getByRole('slider', { name: '面试背景透明度', exact: true }).count(),
    0,
  );
  const actualLayers = await floating.evaluate(() =>
    Object.fromEntries(
      [
        '.floating-panel',
        '.floating-toolbar',
        '.answer-bubble',
        '.floating-composer',
        '.transcript-item p',
      ].map((selector) => {
        const style = getComputedStyle(document.querySelector(selector));
        return [selector, { fill: style.backgroundColor, image: style.backgroundImage }];
      }),
    ),
  );
  assert.deepEqual(
    actualLayers,
    layers,
    'Preview and real interview must share the same reading and chat chrome materials',
  );
  assert.equal(
    await floating.evaluate(() => document.documentElement.dataset.interviewTransparency),
    '100',
  );
  assert.equal(await devices.getByRole('button', { name: /应用.*设置/ }).count(), 0);
  assert.equal(await devices.getByRole('button', { name: '完成', exact: true }).count(), 0);
  assert.equal(await devices.locator('.display-slider-icon').count(), 2);
  assert.equal(await devices.getByText('当前回答结束后可修改', { exact: true }).count(), 0);
  await geometry(floating);
  const backdrop = await devices.evaluate((e) => {
    const style = getComputedStyle(e, '::backdrop');
    return {
      clip: style.clipPath,
      filter: style.backdropFilter,
      color: style.backgroundColor,
      shadow: getComputedStyle(e).boxShadow,
      surface: getComputedStyle(e).backgroundColor,
      surfaceFilter: getComputedStyle(e).backdropFilter,
    };
  });
  assert.equal(backdrop.clip, 'none');
  assert.equal(backdrop.color, 'rgba(0, 0, 0, 0)');
  assert.equal(backdrop.filter, 'none');
  assert.equal(backdrop.surface, 'rgb(28, 32, 35)');
  assert.equal(backdrop.surfaceFilter, 'none');
  assert.equal(backdrop.shadow, 'none');
  const beforeMaterial = backdrop.surface;
  for (const value of [0, 50, 100]) {
    await page.evaluate((value) => {
      localStorage.setItem('voxcue-frosted-transparency-v2', String(value));
      localStorage.setItem('voxcue-interview-background-transparency-v1', String(value));
      window.dispatchEvent(new StorageEvent('storage', { key: 'voxcue-frosted-transparency-v2' }));
    }, value);
    assert.equal(
      await page.evaluate(() => document.documentElement.dataset.frostedTransparency),
      '100',
    );
    assert.equal(
      await floating.evaluate(() => document.documentElement.dataset.frostedTransparency),
      '100',
    );
    assert.equal(
      await floating.evaluate(() => document.documentElement.dataset.interviewTransparency),
      '100',
    );
    for (const theme of ['light', 'dark']) {
      await floating.emulateMedia({ colorScheme: theme });
      assert.equal(
        await floating.locator('html').evaluate((e) => e.classList.contains('dark')),
        true,
      );
      assert.equal(
        await devices.evaluate((e) => getComputedStyle(e).backgroundColor),
        beforeMaterial,
      );
      assert.equal(await devices.evaluate((e) => getComputedStyle(e).backdropFilter), 'none');
    }
  }
  await floating.emulateMedia({ forcedColors: 'active' });
  assert.equal(await devices.evaluate((e) => getComputedStyle(e).backdropFilter), 'none');
  await floating.emulateMedia({ forcedColors: 'none' });
  // Restoring the normal palette can start finite color transitions. Compare
  // the opaque surface only after those transitions have settled.
  await capture(floating, 'settings-palette-settled');
  const settingsBox = await devices.boundingBox();
  // Sample only the panel's inner padding: text antialiasing may differ by one
  // channel value when Chromium recomposites an unrelated filtered layer.
  const opaqueSample = { x: settingsBox.x + 8, y: settingsBox.y + 60, width: 8, height: 120 };
  const covered = await floating.screenshot({ clip: opaqueSample, scale: 'css' });
  await floating.locator('.floating-panels').evaluate((e) => {
    e.style.filter = 'invert(1)';
  });
  const changedBackground = await floating.screenshot({ clip: opaqueSample, scale: 'css' });
  await floating.locator('.floating-panels').evaluate((e) => {
    e.style.removeProperty('filter');
  });
  const pixelDifference = await app.evaluate(
    ({ nativeImage }, images) => {
      const [a, b] = images.map((value) =>
        nativeImage.createFromBuffer(Buffer.from(value, 'base64')).toBitmap(),
      );
      let changed = 0,
        max = 0;
      for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) changed++;
        max = Math.max(max, Math.abs(a[i] - b[i]));
      }
      return { changed, max, first: [...a.subarray(0, 4)], second: [...b.subarray(0, 4)] };
    },
    [covered.toString('base64'), changedBackground.toString('base64')],
  );
  assert.equal(
    pixelDifference.changed,
    0,
    'Opaque settings must hide changes in the underlying interview: ' +
      JSON.stringify(pixelDifference),
  );
  await capture(floating, '07-interview-settings');
  await devices.getByRole('button', { name: '关闭对话框', exact: true }).click();
  await devices.waitFor({ state: 'hidden' });
  if (passthrough) {
    await moveToBlankCorner();
  }
  await app.evaluate(() => globalThis.uxRestorePassthrough());
  assert.equal(await app.evaluate(() => globalThis.uxCurrentSignal.aborted), false);
  assert.equal((await app.evaluate(() => globalThis.uxRequests))[1].modelId, 'test-model');
  await app.evaluate(() => globalThis.uxFinish());
  await floating.getByRole('button', { name: '发送面试问题', exact: true }).waitFor();
  await floating
    .getByRole('textbox', { name: '面试提问', exact: true })
    .fill('新的追问应该如何回答？');
  await floating.getByRole('button', { name: '发送面试问题', exact: true }).click();
  await floating.getByRole('button', { name: '发送面试问题', exact: true }).waitFor();
  assert.deepEqual((await app.evaluate(() => globalThis.uxRequests)).at(-1), {
    modelId: 'next-model',
    effort: 'high',
  });
  checks.push(
    'device/model choices save directly without Apply; active answer continues on old settings and next question uses new model/effort',
  );
  await capture(floating, '05-interview');
  const metadata = await floating
    .locator('.transcript-meta')
    .first()
    .evaluate((e) => {
      const label = e.querySelector('strong').getBoundingClientRect(),
        time = e.querySelector('time').getBoundingClientRect();
      return { gap: time.left - label.right, text: e.textContent };
    });
  assert.ok(metadata.gap >= 0 && metadata.gap < 16);
  assert.ok(!metadata.text.includes('系统音频'));
  checks.push(
    'compact status beside auto-answer, nearby timestamps, green readiness, in-place audio and model settings, centered font slider and fixed 60% material',
  );
  for (const theme of ['light', 'dark']) {
    await floating.emulateMedia({ colorScheme: theme });
    assert.equal(
      await floating.locator('html').evaluate((e) => e.classList.contains('dark')),
      true,
    );
    await geometry(floating);
    await floating.evaluate(() => window.desktop.resizeInterview(-1));
    await geometry(floating);
  }
  await capture(floating, '08-interview-dark');
  const originalWindow = await app.evaluate(({ BrowserWindow }, url) => {
    const window = BrowserWindow.getAllWindows().find(
      (window) => window.webContents.getURL() === url,
    );
    return { size: window.getContentSize(), minimum: window.getMinimumSize() };
  }, floating.url());
  for (const [width, columns] of [
    [960, 2],
    [620, 2],
    [440, 1],
  ]) {
    await app.evaluate(
      ({ BrowserWindow }, { url, width }) => {
        const window = BrowserWindow.getAllWindows().find(
          (window) => window.webContents.getURL() === url,
        );
        window.setMinimumSize(360, 420);
        window.setContentSize(width, 780);
      },
      { url: floating.url(), width },
    );
    for (const theme of ['light', 'dark']) {
      await floating.emulateMedia({ colorScheme: theme });
      assert.equal(
        await floating.locator('html').evaluate((e) => e.classList.contains('dark')),
        true,
      );
      await floating.getByRole('button', { name: '面试设置', exact: true }).click();
      const layout = await settingsLayout(devices);
      if (columns === 2) {
        assert.ok(Math.abs(layout.audio[0].top - layout.audio[1].top) < 1);
        assert.ok(Math.abs(layout.rows[0].control.top - layout.rows[1].control.top) < 1);
      } else {
        assert.ok(layout.audio[1].top > layout.audio[0].bottom);
        assert.ok(layout.rows[1].label.top > layout.rows[0].control.bottom);
      }
      if (width === 960 || width === 440) {
        await devices.locator('.dialog-scroll').evaluate((element) => {
          element.scrollTop = 0;
        });
        if (width === 440)
          await devices.locator('.speech-model-group').last().scrollIntoViewIfNeeded();
        await capture(floating, `settings-layout-${width === 960 ? 'wide' : 'narrow'}-${theme}`);
      }
      await devices.getByRole('button', { name: '关闭对话框', exact: true }).click();
      await devices.waitFor({ state: 'hidden' });
    }
  }
  await app.evaluate(
    ({ BrowserWindow }, { url, originalWindow }) => {
      const window = BrowserWindow.getAllWindows().find(
        (window) => window.webContents.getURL() === url,
      );
      window.setContentSize(...originalWindow.size);
      window.setMinimumSize(...originalWindow.minimum);
    },
    { url: floating.url(), originalWindow },
  );
  checks.push(
    'settings sections stack vertically; paired fields have horizontal labels above full-width controls; 960/620/440 widths in both themes fit without overflow',
  );
  checks.push(
    'fixed dark interview and smaller native interview bounds, automatic device refresh in both settings, font slider and fixed opacity scene, footer privacy and meters without trailing status',
  );
  await floating.getByRole('button', { name: '结束面试', exact: true }).click();
  await floating.getByRole('button', { name: '确认结束面试', exact: true }).click();
  console.log(
    JSON.stringify({
      status: 'passed',
      checks,
      screenshots: screenshots ?? 'none',
      physicalCapture: false,
      realAccounts: false,
    }),
  );
} catch (error) {
  for (const window of app.windows().filter((window) => window.url().endsWith('#interview')))
    console.error(
      'SETTINGS_DIAGNOSTIC',
      JSON.stringify(
        await window.evaluate(() => ({
          events: window.uxDialogEvents,
          focused: document.hasFocus(),
          dialogs: [...document.querySelectorAll('dialog')].map((dialog) => ({
            label: dialog.getAttribute('aria-label'),
            open: dialog.open,
          })),
        })),
      ),
    );
  throw error;
} finally {
  if (nativeProbe && originalCursor) nativeProbe('move', originalCursor.x, originalCursor.y);
  await closeUiApp(app);
}
