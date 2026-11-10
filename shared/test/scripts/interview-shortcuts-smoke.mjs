import assert from 'node:assert/strict';
import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import { testRoot, electron } from './test-workspace.mjs';
import { offlineElectronEntry } from './offline-electron-entry.mjs';
import { installUiAccount, connectUiAccount, closeUiApp } from './install-ui-account.mjs';
import { waitForAsync } from './wait-for-async.mjs';

// Isolated interview UI: synthetic account and speech ports, no
// hardware capture, real credentials, network, model download or saved images.
const fixture = path.join(testRoot, 'interview-shortcuts-entry.cjs');
await writeFile(
  fixture,
  `
const {globalShortcut,dialog,systemPreferences,nativeImage}=require('electron');
const test=globalThis.shortcutUi={shortcuts:new Map(),windowErrors:[],reduced:false};
test.keys=['Control+Shift+H','Control+Shift+P','Control+Shift+T','Control+Shift+M',
  'Control+Shift+A','Control+Shift+Enter','Control+Shift+Up','Control+Shift+Down','Control+Shift+S'];
test.physicalKey=key=>({'Control+Shift+H':'Control+Alt+Shift+F8',
  'Control+Shift+P':'Control+Alt+Shift+F9','Control+Shift+T':'Control+Alt+Shift+F10',
  'Control+Shift+M':'Control+Alt+Shift+F11','Control+Shift+A':'Control+Alt+Shift+F5',
  'Control+Shift+Enter':'Control+Alt+Shift+F12','Control+Shift+Up':'Control+Alt+Shift+F6',
  'Control+Shift+Down':'Control+Alt+Shift+F7','Control+Shift+S':'Control+Alt+Shift+F4'}[key]??key);
const register=globalShortcut.register.bind(globalShortcut);
const unregister=globalShortcut.unregister.bind(globalShortcut);
globalShortcut.register=(key,callback)=>{
  const physical=test.physicalKey(key);
  const success=register(physical,callback);
  if(success&&test.keys.includes(key))test.shortcuts.set(key,callback);
  return success;
};
globalShortcut.unregister=key=>{
  const physical=test.physicalKey(key);
  if(physical)unregister(physical);
  test.shortcuts.delete(key);
};
dialog.showErrorBox=(title,message)=>test.windowErrors.push({title,message});
const animations=systemPreferences.getAnimationSettings.bind(systemPreferences);
systemPreferences.getAnimationSettings=()=>test.reduced?
  {...animations(),prefersReducedMotion:true,shouldRenderRichAnimation:false}:animations();
test.screenshots=0;
const platform=require(${JSON.stringify(path.resolve('dist-electron', process.platform === 'win32' ? 'windows' : 'macos', 'electron/platform.js'))})[${JSON.stringify(process.platform === 'win32' ? 'windows' : 'macos')}];
platform.captureScreen=async()=>{test.screenshots++;return nativeImage.createFromBitmap(Buffer.alloc(64,255),{width:4,height:4});};
require(${JSON.stringify(path.resolve('dist-electron/shared/electron/main.js'))});
`,
);
const app = await electron.launch({
  args: [await offlineElectronEntry(fixture)],
  env: {
    ...process.env,
    COPILOT_TEST_USER_DATA: path.join(testRoot, 'interview-shortcuts'),
    VITE_DEV_SERVER_URL: '',
  },
});
const errors = [];
let configuration;
const invoke = (key) =>
  app.evaluate((_electron, key) => {
    const callback = globalThis.shortcutUi.shortcuts.get(key);
    if (!callback) throw Error('Owned shortcut missing: ' + key);
    callback();
  }, key);
const keyState = () =>
  app.evaluate(({ globalShortcut }) =>
    globalThis.shortcutUi.keys.map((key) =>
      globalShortcut.isRegistered(globalThis.shortcutUi.physicalKey(key)),
    ),
  );
const waitKeysReleased = () =>
  app.evaluate(async ({ globalShortcut }) => {
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      if (
        globalThis.shortcutUi.keys.every(
          (key) => !globalShortcut.isRegistered(globalThis.shortcutUi.physicalKey(key)),
        )
      )
        return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw Error('Closed interview retained its owned global shortcuts');
  });
const nativeWindows = () =>
  app.evaluate(({ BrowserWindow }) =>
    ['#interview', '#interview-shortcuts'].map((hash) => {
      const win = BrowserWindow.getAllWindows().find((win) =>
        win.webContents.getURL().endsWith(hash),
      );
      if (!win) throw Error('Missing owned window: ' + hash);
      return { visible: win.isVisible(), opacity: win.getOpacity(), bounds: win.getBounds() };
    }),
  );
const waitVisible = (visible) =>
  app.evaluate(async ({ BrowserWindow }, visible) => {
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      const windows = ['#interview', '#interview-shortcuts'].map((hash) =>
        BrowserWindow.getAllWindows().find((win) => win.webContents.getURL().endsWith(hash)),
      );
      if (
        windows.every(
          (win) => win?.isVisible() === visible && Math.abs(win.getOpacity() - 1) < 0.01,
        )
      )
        return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw Error('Native visibility did not settle');
  }, visible);
try {
  await installUiAccount(app, { speech: true, components: true });
  await app.evaluate(({ app, systemPreferences }) => {
    const require = process
      .getBuiltinModule('module')
      .createRequire(app.getAppPath() + '/package.json');
    const path = process.getBuiltinModule('path');
    const capture = require(
      path.join(
        app.getAppPath(),
        'dist-electron',
        process.platform === 'win32' ? 'windows' : 'macos',
        'electron/speech/capture.js',
      ),
    );
    capture.devices = async () => [
      { id: 'synthetic-mic', name: 'Synthetic microphone', source: 'microphone', default: true },
    ];
    capture.probeDevice = async (_helper, source) => {
      if (source !== 'microphone') throw Error('Single-input preflight probed system audio');
      return { ok: true };
    };
    systemPreferences.getMediaAccessStatus = () => 'granted';
    const { SpeechHost } = require(
      path.join(app.getAppPath(), 'dist-electron/shared/electron/backend/speech/host.js'),
    );
    const call = SpeechHost.prototype.call;
    globalThis.shortcutUi.audioCalls = [];
    SpeechHost.prototype.call = function (request) {
      globalThis.shortcutUi.audioCalls.push(structuredClone(request));
      globalThis.shortcutUi.speechHost = this;
      if (request.op === 'start') this.syntheticInput = request.inputState;
      if (request.op === 'set-input-state') {
        const state = structuredClone(request.state);
        return (async () => {
          if (globalThis.shortcutUi.holdNextInput) {
            globalThis.shortcutUi.holdNextInput = false;
            await new Promise((resolve) => {
              globalThis.shortcutUi.releaseInput = resolve;
            });
            globalThis.shortcutUi.releaseInput = undefined;
          }
          this.syntheticInput = state;
          return { state: 'running', model: 'Synthetic speech port', inputState: state };
        })();
      }
      if (request.op === 'cancel-input-state')
        return Promise.resolve({
          state: 'running',
          model: 'Synthetic speech port',
          inputState: this.syntheticInput,
        });
      return call.call(this, request);
    };
  });
  const main = await connectUiAccount(app, await app.firstWindow());
  main.setDefaultTimeout(15000);
  main.on('pageerror', (error) => errors.push(error.message));
  const noRemovedEntries = async (dialog) => {
    for (const name of ['面对面', '说话人区分', '声音录入'])
      assert.equal(await dialog.getByText(name, { exact: true }).count(), 0);
  };
  await main.locator('.interview-start-trigger').click();
  const start = main.getByRole('dialog', { name: '开始面试', exact: true });
  const footerAtBottom = async () => {
    assert.ok(
      await start.evaluate((dialog) => {
        const footer = dialog.querySelector(':scope > .modal-footer');
        return (
          Math.abs(dialog.getBoundingClientRect().bottom - footer.getBoundingClientRect().bottom) <=
          2
        );
      }),
      'Start explanation and actions must stay at the dialog bottom',
    );
  };
  await start.getByText('系统音频 · 面试官', { exact: true }).waitFor();
  await start.getByText('麦克风 · 面试者', { exact: true }).waitFor();
  await noRemovedEntries(start);
  await footerAtBottom();
  assert.equal(await start.locator('.interview-start-summary-meta').count(), 2);
  assert.ok(
    await start.evaluate((dialog) => {
      const probe = document.createElement('span');
      probe.style.color = 'var(--accent)';
      dialog.append(probe);
      const accent = getComputedStyle(probe).color;
      probe.remove();
      return [...dialog.querySelectorAll('.interview-start-summary-meta')].every(
        (node) => getComputedStyle(node).color === accent,
      );
    }),
  );
  await main.keyboard.press('Escape');
  await start.waitFor({ state: 'detached' });
  await main.getByRole('button', { name: '用户菜单', exact: true }).click();
  await main.getByRole('menuitem', { name: '设置', exact: true }).click();
  const mainSettings = main.getByRole('dialog', { name: '设置', exact: true });
  await mainSettings.getByRole('button', { name: '面试设置', exact: true }).click();
  await mainSettings.getByRole('heading', { name: '音频设备', exact: true }).waitFor();
  await noRemovedEntries(mainSettings);
  assert.equal(await mainSettings.locator('.speech-device-heading').count(), 2);
  assert.equal(await mainSettings.locator('.speech-device-heading svg').count(), 0);
  assert.deepEqual(await mainSettings.locator('.speech-device-heading strong').allTextContents(), [
    '系统音频',
    '麦克风',
  ]);
  assert.deepEqual(await mainSettings.locator('.speech-device-heading > span').allTextContents(), [
    '面试官',
    '面试者',
  ]);
  await mainSettings.getByText('系统音频', { exact: true }).waitFor();
  await mainSettings.getByText('麦克风', { exact: true }).waitFor();
  const outputHeadingColor = await mainSettings
    .locator('.speech-device-heading strong')
    .first()
    .evaluate((node) => getComputedStyle(node).color);
  await mainSettings.getByRole('radio', { name: '仅转录', exact: true }).click();
  assert.equal(
    await mainSettings.getByRole('button', { name: '播放设备', exact: true }).isDisabled(),
    true,
  );
  await mainSettings
    .getByRole('button', { name: '播放设备', exact: true })
    .getByText('设置为“仅转录”时不可用。', { exact: true })
    .waitFor();
  assert.equal(await mainSettings.locator('.speech-device-heading small').count(), 0);
  assert.equal(
    await mainSettings
      .locator('.speech-device-heading strong')
      .first()
      .evaluate((node) => getComputedStyle(node).color),
    outputHeadingColor,
    'Transcription mode must not dim the system audio heading',
  );
  assert.equal(
    await mainSettings
      .getByRole('button', { name: '播放设备', exact: true })
      .locator('span')
      .evaluate((node) => getComputedStyle(node).fontSize),
    await mainSettings
      .getByRole('button', { name: '麦克风设备', exact: true })
      .locator('span')
      .evaluate((node) => getComputedStyle(node).fontSize),
    'Unavailable output reason uses the normal dropdown font size',
  );
  const modeHeight = await mainSettings
    .locator('.interview-input-segmented')
    .evaluate((node) => node.getBoundingClientRect().height);
  const selectHeight = await mainSettings
    .getByRole('button', { name: '麦克风设备', exact: true })
    .evaluate((node) => node.getBoundingClientRect().height);
  assert.equal(modeHeight, selectHeight);
  assert.ok(
    await mainSettings
      .locator('.interview-input-segmented')
      .evaluate(
        (node) =>
          parseFloat(getComputedStyle(node).borderTopLeftRadius) >=
          node.getBoundingClientRect().height / 2,
      ),
  );
  await main.evaluate(() => {
    localStorage.setItem('voxcue-language-v1', 'en');
    dispatchEvent(new StorageEvent('storage', { key: 'voxcue-language-v1' }));
  });
  const englishSettings = main.getByRole('dialog', { name: 'Settings', exact: true });
  const englishOutput = englishSettings.getByRole('button', { name: 'output device', exact: true });
  await englishOutput
    .getByText('Unavailable in Transcription only mode.', { exact: true })
    .waitFor();
  assert.ok(
    await englishOutput.evaluate((node) => {
      const span = node.querySelector('span');
      const style = getComputedStyle(span);
      const range = document.createRange();
      range.selectNodeContents(span);
      // Ellipsis may contribute a second fragment on the same visual line.
      const fragments = [...range.getClientRects()];
      return (
        style.whiteSpace === 'nowrap' &&
        style.overflow === 'hidden' &&
        style.textOverflow === 'ellipsis' &&
        fragments.length > 0 &&
        fragments.every((rect) => Math.abs(rect.top - fragments[0].top) < 1 / 64) &&
        span.scrollHeight <= span.clientHeight + 1 &&
        span.getBoundingClientRect().height <= node.getBoundingClientRect().height
      );
    }),
    'Unavailable output reason stays on one line and truncates within the dropdown',
  );
  await main.evaluate(() => {
    localStorage.setItem('voxcue-language-v1', 'zh-CN');
    dispatchEvent(new StorageEvent('storage', { key: 'voxcue-language-v1' }));
  });
  await mainSettings.getByRole('radio', { name: '远程面试', exact: true }).click();
  assert.equal(
    await mainSettings.getByRole('button', { name: '播放设备', exact: true }).isDisabled(),
    false,
  );
  await mainSettings.getByRole('button', { name: '关闭设置', exact: true }).click();
  await mainSettings.waitFor({ state: 'detached' });
  await main.locator('.interview-start-trigger').click();
  const opened = app.waitForEvent('window');
  void opened.catch(() => {});
  await start.getByRole('button', { name: '确认开始', exact: true }).click();
  const floating = await opened;
  floating.setDefaultTimeout(15000);
  floating.on('pageerror', (error) => errors.push(error.message));
  await floating.locator('.floating-toolbar').waitFor();
  configuration = (await floating.evaluate(() => window.desktop.interviewState())).configuration;
  await floating
    .locator('.transcript-item p')
    .filter({ hasText: /^Synthetic interviewer question$/ })
    .waitFor();
  const shortcutsToggle = floating.getByRole('button', { name: '快捷键', exact: true });
  const transcriptToggle = floating.getByRole('button', { name: '转写面板', exact: true });
  let helpPage;
  const findHelp = async () => {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      helpPage = app.windows().find((page) => page.url().endsWith('#interview-shortcuts'));
      if (helpPage) {
        helpPage.setDefaultTimeout(15000);
        helpPage.on('pageerror', (error) => errors.push(error.message));
        await helpPage.getByRole('region', { name: '快捷键', exact: true }).waitFor();
        return helpPage.getByRole('region', { name: '快捷键', exact: true });
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw Error('Default shortcut helper did not appear');
  };
  let help = await findHelp();
  assert.deepEqual(await keyState(), Array(9).fill(true));
  await floating.waitForFunction(
    () =>
      document.querySelector('.floating-shortcuts-toggle')?.getAttribute('aria-pressed') === 'true',
  );
  const buttonDesign = (node) => {
    const style = getComputedStyle(node);
    return {
      height: style.height,
      border: style.border,
      radius: style.borderRadius,
      padding: style.padding,
      font: style.font,
      gap: style.gap,
      dot: node.querySelector('.toggle-dot')?.getBoundingClientRect().height,
      icon: node.querySelector('svg')?.getBoundingClientRect().height,
    };
  };
  await shortcutsToggle.evaluate((node) =>
    Promise.all(node.getAnimations().map((animation) => animation.finished.catch(() => {}))),
  );
  assert.deepEqual(
    await shortcutsToggle.evaluate(buttonDesign),
    await transcriptToggle.evaluate(buttonDesign),
  );
  assert.deepEqual(await help.locator('kbd').allTextContents(), [
    'Ctrl+Shift+H',
    'Ctrl+Shift+P',
    'Ctrl+Shift+T',
    'Ctrl+Shift+M',
    'Ctrl+Shift+A',
    'Ctrl+Shift+Enter',
    'Ctrl+Shift+S',
  ]);
  const bounds = await app.evaluate(({ BrowserWindow, screen }) => {
    const owner = BrowserWindow.getAllWindows().find((win) =>
      win.webContents.getURL().endsWith('#interview'),
    );
    const helper = BrowserWindow.getAllWindows().find((win) =>
      win.webContents.getURL().endsWith('#interview-shortcuts'),
    );
    return {
      help: helper.getBounds(),
      area: screen.getDisplayMatching(owner.getBounds()).workArea,
    };
  });
  assert.ok(Math.abs(bounds.help.x - bounds.area.x - 16) <= 1);
  assert.ok(
    Math.abs(bounds.help.y + bounds.help.height - bounds.area.y - bounds.area.height + 16) <= 1,
  );
  const toolbarTop = await floating
    .locator('.floating-toolbar')
    .evaluate((node) => window.screenY + node.getBoundingClientRect().top);
  assert.ok(toolbarTop >= bounds.area.y && toolbarTop <= bounds.area.y + 64);
  const helperState = await helpPage.evaluate(() => window.desktop.interviewShortcutsState());
  assert.deepEqual(Object.keys(helperState).sort(), [
    'deviceConnected',
    'open',
    'rendererRevision',
  ]);
  assert.ok(helperState.rendererRevision > 0);
  await helpPage.reload();
  await help.waitFor();
  const nextRevision = await helpPage.evaluate(
    async () => (await window.desktop.interviewShortcutsState()).rendererRevision,
  );
  assert.ok(nextRevision > helperState.rendererRevision);
  await assert.rejects(
    () =>
      helpPage.evaluate(
        (revision) => window.desktop.interviewRendererReady(revision),
        helperState.rendererRevision,
      ),
    /Invalid request/,
  );
  await assert.rejects(
    () => helpPage.evaluate(() => window.desktop.interviewState()),
    /Unauthorized window/,
  );
  await assert.rejects(
    () => helpPage.evaluate(() => window.desktop.setInterviewShortcutsOpen(true)),
    /Invalid request/,
  );

  await waitVisible(true);
  const initial = await nativeWindows();
  const fade = await app.evaluate(async ({ BrowserWindow, systemPreferences }) => {
    const settings = systemPreferences.getAnimationSettings(),
      frames = [];
    globalThis.shortcutUi.shortcuts.get('Control+Shift+H')();
    for (let frame = 0; frame < 14; frame++) {
      frames.push(
        ['#interview', '#interview-shortcuts'].map((hash) => {
          const win = BrowserWindow.getAllWindows().find((win) =>
            win.webContents.getURL().endsWith(hash),
          );
          return { visible: win.isVisible(), opacity: win.getOpacity(), bounds: win.getBounds() };
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 16));
    }
    return {
      frames,
      rich: settings.prefersReducedMotion !== true && settings.shouldRenderRichAnimation !== false,
    };
  });
  await waitVisible(false);
  await invoke('Control+Shift+S');
  await floating.waitForFunction(
    () => document.querySelectorAll('.floating-screenshot-preview').length === 1,
    undefined,
    { polling: 25 },
  );
  assert.equal(await app.evaluate(() => globalThis.shortcutUi.screenshots), 1);
  assert.deepEqual(
    (await nativeWindows()).map((win) => win.visible),
    [false, false],
  );
  await floating
    .getByRole('button', { name: '移除截图 1', exact: true })
    .evaluate((button) => button.click());
  await floating.waitForFunction(
    () => document.querySelectorAll('.floating-screenshot-preview').length === 0,
    undefined,
    { polling: 25 },
  );
  const hiddenLayout = await floating.evaluate(() => window.desktop.interviewState());
  for (const [key, field] of [
    ['Control+Shift+P', 'collapsed'],
    ['Control+Shift+T', 'transcriptVisible'],
  ]) {
    await invoke(key);
    await waitForAsync(
      floating,
      async ({ field, expected }) =>
        !document.querySelector('.floating-shell').dataset.panelMotion &&
        (await window.desktop.interviewState())[field] === expected,
      { field, expected: !hiddenLayout[field] },
    );
    await invoke(key);
    await waitForAsync(
      floating,
      async ({ field, expected }) =>
        !document.querySelector('.floating-shell').dataset.panelMotion &&
        (await window.desktop.interviewState())[field] === expected,
      { field, expected: hiddenLayout[field] },
    );
  }
  assert.deepEqual(
    (await nativeWindows()).map((win) => win.visible),
    [false, false],
  );
  const captureOpsBeforeMute = await app.evaluate(
    () =>
      globalThis.shortcutUi.audioCalls.filter((call) =>
        ['start', 'stop', 'pause'].includes(call.op),
      ).length,
  );
  await app.evaluate(() => {
    globalThis.shortcutUi.holdNextInput = true;
  });
  await invoke('Control+Shift+M');
  await app.evaluate(async () => {
    const end = Date.now() + 3000;
    while (!globalThis.shortcutUi.releaseInput) {
      if (Date.now() > end) throw Error('Microphone gate did not reach its deferred ACK');
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    for (const source of ['system', 'microphone'])
      globalThis.shortcutUi.speechHost.emit({
        type: 'segment',
        segment: {
          id: 'mute-boundary-' + source,
          source,
          text: source === 'system' ? 'Synthetic system during mute' : 'Synthetic suppressed mic',
          final: true,
          startMs: Date.now(),
          endMs: Date.now() + 1000,
          reason: 'silence',
        },
      });
  });
  try {
    await floating
      .locator('.transcript-item p')
      .filter({ hasText: /^Synthetic system during mute$/ })
      .waitFor();
    assert.equal(await floating.getByText('Synthetic suppressed mic', { exact: true }).count(), 0);
  } finally {
    await app.evaluate(() => globalThis.shortcutUi.releaseInput?.());
  }
  await floating.getByRole('status', { name: '麦克风：未启用', exact: true }).waitFor();
  assert.deepEqual(
    (await nativeWindows()).map((win) => win.visible),
    [false, false],
  );
  assert.deepEqual(
    (await floating.evaluate(() => window.desktop.interviewState())).configuration.options.sources,
    ['system'],
  );
  await invoke('Control+Shift+M');
  await floating.getByRole('status', { name: '麦克风：正常', exact: true }).waitFor();
  await invoke('Control+Shift+A');
  await floating.getByRole('status', { name: '系统音频：未启用', exact: true }).waitFor();
  await invoke('Control+Shift+A');
  await floating.getByRole('status', { name: '系统音频：正常', exact: true }).waitFor();
  await floating.locator('textarea').evaluate((input) => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(
      input, 'Synthetic question sent while fully hidden',
    );
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await floating.waitForFunction(() =>
    !document.querySelector('button[aria-label="发送面试问题"]').disabled,
    undefined, { polling: 25 },
  );
  await invoke('Control+Shift+Enter');
  await floating.getByRole('article', { name: '回答：Synthetic question sent while fully hidden', exact: true }).waitFor();
  assert.deepEqual((await nativeWindows()).map((win) => win.visible), [false, false]);
  assert.equal(
    await app.evaluate(
      () =>
        globalThis.shortcutUi.audioCalls.filter((call) =>
          ['start', 'stop', 'pause'].includes(call.op),
        ).length,
    ),
    captureOpsBeforeMute,
  );
  assert.equal(await floating.locator('.audio-recovery').count(), 0);
  for (let index = 0; index < 2; index++) {
    if (fade.rich)
      assert.ok(
        fade.frames.some(
          (frame) => frame[index].visible && frame[index].opacity > 0 && frame[index].opacity < 1,
        ),
      );
    assert.ok(
      fade.frames.every(
        (frame) => JSON.stringify(frame[index].bounds) === JSON.stringify(initial[index].bounds),
      ),
    );
  }
  await invoke('Control+Shift+H');
  await waitVisible(true);
  const reversed = await app.evaluate(async ({ BrowserWindow }) => {
    const snapshot = () =>
      ['#interview', '#interview-shortcuts'].map((hash) => {
        const win = BrowserWindow.getAllWindows().find((win) =>
          win.webContents.getURL().endsWith(hash),
        );
        return { opacity: win.getOpacity(), bounds: win.getBounds() };
      });
    globalThis.shortcutUi.shortcuts.get('Control+Shift+H')();
    await new Promise((resolve) => setTimeout(resolve, 40));
    const before = snapshot();
    globalThis.shortcutUi.shortcuts.get('Control+Shift+H')();
    return { before, after: snapshot() };
  });
  for (let index = 0; index < 2; index++) {
    if (fade.rich)
      assert.ok(Math.abs(reversed.before[index].opacity - reversed.after[index].opacity) < 0.05);
    assert.deepEqual(reversed.after[index].bounds, initial[index].bounds);
  }
  await waitVisible(true);
  const reduced = await app.evaluate(({ BrowserWindow }) => {
    globalThis.shortcutUi.reduced = true;
    const read = () =>
      ['#interview', '#interview-shortcuts'].map((hash) => {
        const win = BrowserWindow.getAllWindows().find((win) =>
          win.webContents.getURL().endsWith(hash),
        );
        return { visible: win.isVisible(), opacity: win.getOpacity() };
      });
    globalThis.shortcutUi.shortcuts.get('Control+Shift+H')();
    const hidden = read();
    globalThis.shortcutUi.shortcuts.get('Control+Shift+H')();
    const shown = read();
    globalThis.shortcutUi.reduced = false;
    return { hidden, shown };
  });
  assert.deepEqual(reduced.hidden, [
    { visible: false, opacity: 1 },
    { visible: false, opacity: 1 },
  ]);
  assert.deepEqual(reduced.shown, [
    { visible: true, opacity: 1 },
    { visible: true, opacity: 1 },
  ]);

  await floating.emulateMedia({ reducedMotion: 'reduce' });
  await invoke('Control+Shift+T');
  await floating.waitForFunction(() =>
    document.querySelector('.floating-panels')?.classList.contains('answer-only'),
  );
  await invoke('Control+Shift+P');
  await floating.waitForFunction(() =>
    document.querySelector('.floating-shell')?.classList.contains('is-collapsed'),
  );
  await invoke('Control+Shift+P');
  await floating.waitForFunction(
    () => !document.querySelector('.floating-shell')?.classList.contains('is-collapsed'),
  );
  assert.equal(await floating.locator('.floating-panels.answer-only').count(), 1);
  await invoke('Control+Shift+P');
  await floating.waitForFunction(() =>
    document.querySelector('.floating-shell')?.classList.contains('is-collapsed'),
  );
  await invoke('Control+Shift+T');
  await waitForAsync(
    floating,
    async () => (await window.desktop.interviewState()).transcriptVisible,
  );
  assert.equal(await floating.locator('.floating-shell.is-collapsed').count(), 1);
  await invoke('Control+Shift+P');
  await floating.waitForFunction(
    () => !document.querySelector('.floating-shell')?.classList.contains('is-collapsed'),
  );
  assert.equal(await floating.locator('.floating-panels.answer-only').count(), 0);
  assert.equal(await help.isVisible(), true);
  assert.deepEqual((await nativeWindows())[1].bounds, bounds.help);

  const material = async () => {
    const style = (node) => ({
      background: getComputedStyle(node).backgroundColor,
      radius: getComputedStyle(node).borderRadius,
    });
    return {
      help: await help.evaluate(style),
      transcript: await floating.locator('.floating-transcript').evaluate(style),
    };
  };
  assert.deepEqual((await material()).help, (await material()).transcript);
  const previousBackground = (await material()).help.background;
  await floating.getByRole('button', { name: '面试设置', exact: true }).click();
  const settings = floating.getByRole('dialog', { name: '面试设置', exact: true });
  const opacity = settings.getByRole('slider', { name: '面试背景透明度', exact: true });
  await opacity.focus();
  await opacity.press('Home');
  for (let index = 0; index < 20; index++) await opacity.press('ArrowRight');
  await settings.getByRole('button', { name: '关闭对话框', exact: true }).click();
  await settings.waitFor({ state: 'detached' });
  await helpPage.waitForFunction(
    () => document.documentElement.dataset.interviewTransparency === '20',
  );
  const changed = await material();
  assert.deepEqual(changed.help, changed.transcript);
  assert.notEqual(changed.help.background, previousBackground);
  await floating.evaluate(() => {
    localStorage.setItem('voxcue-language-v1', 'en');
    dispatchEvent(new StorageEvent('storage', { key: 'voxcue-language-v1' }));
  });
  const english = helpPage.getByRole('region', { name: 'Shortcuts', exact: true });
  await english.waitFor();
  assert.ok(
    await english.evaluate((node) => {
      const scroll = node.querySelector('.floating-scroll');
      return (
        scroll.scrollWidth <= scroll.clientWidth &&
        node.querySelector('dl').getBoundingClientRect().top >=
          node.querySelector('header').getBoundingClientRect().bottom
      );
    }),
  );
  await floating.evaluate(() => {
    localStorage.setItem('voxcue-language-v1', 'zh-CN');
    dispatchEvent(new StorageEvent('storage', { key: 'voxcue-language-v1' }));
  });
  await help.waitFor();
  const helperClosed = helpPage.waitForEvent('close');
  await helpPage.keyboard.press('Escape').catch((error) => {
    if (!helpPage.isClosed()) throw error;
  });
  await helperClosed;
  await floating.waitForFunction(
    () =>
      document.querySelector('.floating-shortcuts-toggle')?.getAttribute('aria-pressed') ===
      'false',
  );
  await shortcutsToggle.click();
  help = await findHelp();
  await floating.getByRole('button', { name: '结束面试', exact: true }).click();
  const closed = floating.waitForEvent('close');
  await floating.getByRole('button', { name: '确认结束面试', exact: true }).click();
  await closed;
  await waitKeysReleased();
  assert.deepEqual(await keyState(), Array(9).fill(false));
  await main.locator('.interview-start-trigger').click();
  const beforeMode = await start.boundingBox();
  await start.getByRole('radio', { name: '仅转录', exact: true }).click();
  await start.locator('.interview-access[aria-busy="false"]').waitFor();
  assert.equal((await start.boundingBox()).height, beforeMode.height);
  await footerAtBottom();
  const footerBeforeScroll = await start.locator(':scope > .modal-footer').boundingBox();
  await start.locator(':scope > .dialog-scroll').evaluate((node) => {
    node.scrollTop = node.scrollHeight;
  });
  assert.deepEqual(await start.locator(':scope > .modal-footer').boundingBox(), footerBeforeScroll);
  await footerAtBottom();
  await noRemovedEntries(start);
  assert.equal(
    await start
      .locator('.interview-start-summary')
      .getByText('系统音频 · 面试官', { exact: true })
      .count(),
    0,
  );
  assert.equal(await start.getByText('设置为“仅转录”时不可用。', { exact: true }).count(), 0);
  assert.equal(
    await start.locator('.interview-access-row').filter({ hasText: '系统音频' }).count(),
    0,
  );
  const microphoneWindow = app.waitForEvent('window');
  await start.getByRole('button', { name: '确认开始', exact: true }).click();
  const microphone = await microphoneWindow;
  microphone.setDefaultTimeout(15000);
  await microphone.locator('.floating-toolbar').waitFor();
  await microphone.getByRole('status', { name: '麦克风：正常', exact: true }).waitFor();
  const microphoneState = await microphone.evaluate(() => window.desktop.interviewState());
  assert.equal(microphoneState.configuration.inputMode, 'transcription');
  assert.deepEqual(microphoneState.configuration.options.sources, ['microphone']);
  await app.evaluate(() => {
    const host = globalThis.shortcutUi.speechHost;
    const at = Date.now();
    globalThis.shortcutUi.silenceAt = at;
    host.emit({
      type: 'segment',
      segment: {
        id: 'synthetic-mic-question',
        source: 'microphone',
        text: 'Synthetic microphone question',
        final: true,
        startMs: at - 1500,
        endMs: at + 1000,
        silenceStartMs: at,
        reason: 'silence',
      },
    });
    host.emit({
      type: 'audio-progress',
      source: 'microphone',
      pending: false,
      processedThroughMs: at + 1799,
    });
  });
  await microphone
    .locator('.transcript-item.interviewer p')
    .filter({ hasText: /^Synthetic microphone question$/ })
    .waitFor();
  await microphone.locator('.transcript-item').getByText('麦克风', { exact: true }).waitFor();
  assert.equal(await microphone.locator('textarea').inputValue(), 'Synthetic microphone question');
  await app.evaluate(() =>
    globalThis.shortcutUi.speechHost.emit({
      type: 'audio-progress',
      source: 'microphone',
      pending: false,
      processedThroughMs: globalThis.shortcutUi.silenceAt + 1800,
    }),
  );
  await microphone.getByText('Synthetic interview answer', { exact: true }).waitFor();
  assert.equal(await microphone.locator('textarea').inputValue(), '');
  await invoke('Control+Shift+M');
  await microphone.getByRole('status', { name: '麦克风：未启用', exact: true }).waitFor();
  await invoke('Control+Shift+M');
  await microphone.getByRole('status', { name: '麦克风：正常', exact: true }).waitFor();
  await microphone.getByRole('button', { name: '面试设置', exact: true }).click();
  const activeSettings = microphone.getByRole('dialog', { name: '面试设置', exact: true });
  const captureOpsBeforeMode = await app.evaluate(
    () =>
      globalThis.shortcutUi.audioCalls.filter((call) =>
        ['start', 'stop', 'pause'].includes(call.op),
      ).length,
  );
  assert.equal(
    await activeSettings.getByRole('button', { name: '选择播放设备', exact: true }).isDisabled(),
    true,
  );
  await activeSettings.getByText('设置为“仅转录”时不可用。', { exact: true }).waitFor();
  assert.equal(await activeSettings.getByText('系统声音 · 播放设备', { exact: true }).count(), 0);
  await activeSettings.getByText('系统声音', { exact: true }).waitFor();
  await activeSettings.getByRole('radio', { name: '远程面试', exact: true }).click();
  await waitForAsync(
    microphone,
    async () => (await window.desktop.interviewState()).configuration.inputMode === 'remote',
  );
  await activeSettings.getByRole('button', { name: '选择播放设备', exact: true }).waitFor();
  assert.equal(
    await activeSettings.getByRole('button', { name: '选择播放设备', exact: true }).isDisabled(),
    false,
  );
  await activeSettings.getByRole('radio', { name: '仅转录', exact: true }).click();
  await waitForAsync(
    microphone,
    async () => (await window.desktop.interviewState()).configuration.inputMode === 'transcription',
  );
  assert.equal(
    await activeSettings.getByRole('button', { name: '选择播放设备', exact: true }).isDisabled(),
    true,
  );
  assert.equal(
    await app.evaluate(
      () =>
        globalThis.shortcutUi.audioCalls.filter((call) =>
          ['start', 'stop', 'pause'].includes(call.op),
        ).length,
    ),
    captureOpsBeforeMode,
  );
  await microphone.keyboard.press('Escape');
  await activeSettings.waitFor({ state: 'detached' });
  await microphone.getByRole('button', { name: '结束面试', exact: true }).click();
  const microphoneClosed = microphone.waitForEvent('close');
  await microphone.getByRole('button', { name: '确认结束面试', exact: true }).click();
  await microphoneClosed;
  await waitKeysReleased();
  const reopened = app.waitForEvent('window');
  await main.evaluate((value) => window.desktop.openInterview(value), configuration);
  const failed = await reopened;
  await failed.locator('.floating-toolbar').waitFor();
  const failedClosed = failed.waitForEvent('close');
  await app.evaluate(({ BrowserWindow }) => {
    globalThis.shortcutUi.windowErrors = [];
    const win = BrowserWindow.getAllWindows().find((win) =>
      win.webContents.getURL().endsWith('#interview'),
    );
    win.webContents.emit(
      'did-fail-load',
      {},
      -2,
      'Synthetic failed page load',
      win.webContents.getURL(),
      true,
    );
  });
  await failedClosed;
  await waitKeysReleased();
  assert.equal(
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().some((win) =>
        /#interview(?:-shortcuts)?$/.test(win.webContents.getURL()),
      ),
    ),
    false,
  );
  assert.equal(await app.evaluate(() => globalThis.shortcutUi.windowErrors.length), 1);
  assert.deepEqual(errors, []);
  console.log(
    'PASS: isolated remote/transcription configurable shortcuts, hidden microphone toggle, microphone draft/1800ms answer, disabled system settings, default screen-bottom-left help, matching toggles, native fade/reversal/reduced motion, panel preferences, opacity/language, renderer revisions and owned-window cleanup. No hardware or real credentials.',
  );
} catch (error) {
  console.error(
    'Synthetic window errors:',
    await app.evaluate(() => globalThis.shortcutUi.windowErrors).catch(() => []),
  );
  throw error;
} finally {
  await closeUiApp(app);
}
