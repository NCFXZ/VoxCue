import { closeUiApp, connectUiAccount, openModelMenu } from '../../../shared/test/scripts/install-ui-account.mjs';
import { testRoot, electron } from '../../../shared/test/scripts/test-workspace.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { captureRequested } from '../../../shared/test/scripts/capture-requested.mjs';

const assertControlRows = async (scope) => {
  const rows = await scope.locator('.speech-setting-row').evaluateAll((rows) => rows.filter((row) =>
    row.querySelector(':scope > button,:scope > .frosted-slider'),
  ).map((row) => {
    const label = row.querySelector('.speech-setting-label').getBoundingClientRect();
    const control = row.querySelector(':scope > button,:scope > .frosted-slider').getBoundingClientRect();
    return {
      labelLeft: label.left,
      labelRight: label.right,
      left: control.left,
      width: control.width,
      centerOffset: label.top + label.height / 2 - control.top - control.height / 2,
      overflow: row.scrollWidth > row.clientWidth,
    };
  }));
  assert.equal(rows.length, 7, 'Two audio, three model and two display rows share one layout');
  assert.ok(rows.every((row) =>
    row.labelRight < row.left &&
    Math.abs(row.labelLeft - rows[0].labelLeft) <= 1 / 64 &&
    Math.abs(row.left - rows[0].left) <= 1 / 64 &&
    Math.abs(row.width - rows[0].width) <= 1 / 64 &&
    Math.abs(row.centerOffset) <= 1 / 64 && !row.overflow,
  ), JSON.stringify(rows));
};

const profile = path.resolve(path.join(testRoot, 'test/results'), `interview-effort-${Date.now()}`);
await mkdir(profile, { recursive: true });
const fixture = path.join(profile, 'main.cjs');
// Isolated test service boundaries only. The built UI, preload, main IPC,
// configuration coordinator and answer pipeline remain real. Model availability
// is synthetic, as is the existing speech host; no model/account/audio is used.
await writeFile(
  fixture,
  `
const {app, ipcMain} = require('electron');
app.setAppPath(${JSON.stringify(process.cwd())});
// Observe actual update IPC without replacing its sender/parameter checks or
// coordinator. Draft pointer movements must not reach this boundary.
globalThis.interviewModelUpdates = [];
const handle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, listener) => handle(channel, channel === 'interview:update-model'
  ? function (event, value) {
      globalThis.interviewModelUpdates.push(structuredClone(value));
      const result = listener.call(this, event, value);
      return globalThis.holdModelUpdate
        ? Promise.resolve(result).then((reply) => new Promise((resolve) => {
            globalThis.releaseModelUpdate = () => { globalThis.holdModelUpdate = false; resolve(reply); };
          }))
        : result;
    }
  : listener);
const {ChatGPTAuthService} = require(${JSON.stringify(path.resolve('dist-electron/shared/electron/backend/auth/service.js'))});
const {ChatGPTService} = require(${JSON.stringify(path.resolve('dist-electron/shared/electron/backend/chat/service.js'))});
const {advertisedEfforts} = require(${JSON.stringify(path.resolve('dist-electron/shared/electron/backend/chat/models.js'))});
const {SpeechHost} = require(${JSON.stringify(path.resolve('dist-electron/shared/electron/backend/speech/host.js'))});
const {ComponentService} = require(${JSON.stringify(path.resolve('dist-electron/shared/electron/backend/components/service.js'))});
// Keep this controls/IPC regression independent of installed model caches. The
// availability port matches installUiAccount's explicit components fixture;
// production renderer and main-process readiness guards are still exercised.
const componentState = ComponentService.prototype.state;
ComponentService.prototype.state = function () {
  const state = componentState.call(this);
  return {...state,phase:'ready',error:null,items:state.items.map(item=>({...item,phase:'ready',received:item.bytes}))};
};
ComponentService.prototype.status = async function () { return this.state(); };
ComponentService.prototype.ready = () => true;
require(${JSON.stringify(path.resolve('dist-electron/shared/electron/backend/speech/models.js'))}).speechModelInstalled = () => true;
require(${JSON.stringify(path.resolve('test/fixtures/interview-access-fixture.cjs'))})(${JSON.stringify(path.resolve('dist-electron/windows/electron/speech/access.js'))});
ChatGPTAuthService.prototype.session = async () => ({mode:'chatgpt', user:{id:'fixture',name:'Test',email:''},expiresAt:Date.now()+3600000});
ChatGPTService.prototype.models = async (force) => {
  if (globalThis.failNextModelRead) {
    globalThis.failNextModelRead = false;
    throw Error('Synthetic model lookup failed');
  }
  if (force && globalThis.nextCatalogModel) globalThis.publishedModel = globalThis.nextCatalogModel;
  return [
  {id:'test-model',label:'Test Model',description:'',reasoningEfforts:advertisedEfforts(['ultra','max','xhigh','high','medium','low'])},
  {id:'restricted-model',label:'Restricted Model',description:'',reasoningEfforts:['medium']},
  {id:'unknown-model',label:'Unknown Model',description:''},
  ...(globalThis.publishedModel ? [{id:globalThis.publishedModel,label:globalThis.publishedModel,description:''}] : []),
  ...Array.from({length:globalThis.shortCatalog ? 0 : 16},(_,index)=>({id:'scroll-model-'+index,label:'Synthetic scrolling model '+index,description:'',reasoningEfforts:['low','high']}))
  ];
};
ChatGPTService.prototype.usage = async () => ({requests:0,inputTokens:0,outputTokens:0,totalTokens:0,updatedAt:null});
globalThis.interviewRequests = [];
ChatGPTService.prototype.stream = async (request) => {
  if (request.id.startsWith('history-title-')) return {answerText:'合成面试标题',usage:null,sources:[]};
  globalThis.interviewRequests.push(request);
  return {answerText:'Fixture answer '+globalThis.interviewRequests.length,usage:null,sources:[]};
};
globalThis.testSpeechCalls=[];
SpeechHost.prototype.call = async (call) => {globalThis.testSpeechCalls.push(call);return {state:call.op==='start'?'running':'idle',model:'Test only',devices:[]};};
SpeechHost.prototype.stop = () => {};
require(${JSON.stringify(path.resolve('dist-electron/shared/electron/main.js'))});
`,
);
const app = await electron.launch({
  args: [fixture],
  env: { ...process.env, COPILOT_TEST_USER_DATA: profile, VITE_DEV_SERVER_URL: '' },
});
try {
  const main = await connectUiAccount(app, await app.firstWindow());
  main.setDefaultTimeout(15000);
  await main
    .getByRole('button', { name: '聊天模型', exact: true })
    .getByText('Test Model', { exact: true })
    .waitFor();
  const openSettings = async () => {
    await main.getByRole('button', { name: '用户菜单', exact: true }).click();
    await main.getByRole('menuitem', { name: '设置', exact: true }).click();
    await main
      .getByRole('navigation', { name: '设置分类' })
      .getByRole('button', { name: '通用', exact: true })
      .click();
    await main.getByRole('button', { name: '面试设置', exact: true }).click();
    await main.getByRole('heading', { name: '面试设置', exact: true }).waitFor();
  };
  await openSettings();
  const dialog = main.getByRole('dialog', { name: '设置', exact: true });
  assert.equal(await dialog.getByRole('button', { name: '语音识别模型', exact: true }).count(), 1);
  const inferenceDevice = dialog.getByRole('button', { name: '语音推理设备', exact: true });
  assert.equal(await inferenceDevice.innerText(), 'CPU');
  assert.equal(await inferenceDevice.isDisabled(), true);
  await assertControlRows(dialog);

  const effort = dialog.getByRole('button', { name: '面试回答模型', exact: true });
  assert.equal(
    await dialog.getByRole('button', { name: '面试回答思考强度', exact: true }).count(),
    0,
  );
  assert.match(await effort.innerText(), /轻度/);
  const combinedTrigger = await effort.evaluate((button) => {
    const model = button.querySelector('.model-name').getBoundingClientRect();
    const level = button.querySelector('.reasoning-trigger-level').getBoundingClientRect();
    const reference = document.querySelector('button[aria-label="语音识别模型"]');
    return {
      background: getComputedStyle(button).backgroundColor,
      referenceBackground: getComputedStyle(reference).backgroundColor,
      labelGap: level.left - model.right,
      reveal: button.hasAttribute('data-reveal-on-hover'),
    };
  });
  assert.equal(combinedTrigger.reveal, false);
  assert.equal(combinedTrigger.background, combinedTrigger.referenceBackground);
  assert.notEqual(combinedTrigger.background, 'rgba(0, 0, 0, 0)');
  assert.ok(Math.abs(combinedTrigger.labelGap - 6) < 1 / 32, JSON.stringify(combinedTrigger));
  const modelPopup = await openModelMenu(main, '面试回答模型', '面试回答思考强度');
  async function assertCatalogLayout(page, scenario) {
    const popup = page.locator('.reasoning-effort-popup[data-state="open"]');
    for (const [language, refresh] of [['en', 'Refresh models'], ['zh-CN', '刷新模型列表']]) {
      await page.evaluate((language) => {
        const key = 'voxcue-language-v1';
        localStorage.setItem(key, language);
        window.dispatchEvent(new StorageEvent('storage', { key }));
      }, language);
      await popup.getByRole('menuitem', { name: refresh, exact: true }).waitFor();
      const layout = await popup.evaluate(async (node) => {
        await Promise.all(
          node.getAnimations({ subtree: true }).map((animation) => animation.finished.catch(() => {})),
        );
        const list = node.querySelector('.reasoning-model-list');
        const refresh = node.querySelector('.reasoning-model-refresh');
        const root = document.documentElement;
        const initialDark = root.classList.contains('dark');
        const scrollTop = list.scrollTop;
        const maxEdgeDifference = () => {
          const footer = refresh.getBoundingClientRect();
          return Math.max(...Array.from(list.children, (option) => {
            const row = option.getBoundingClientRect();
            return Math.max(Math.abs(row.left - footer.left), Math.abs(row.right - footer.right));
          }));
        };
        try {
          return [false, true].map((dark) => {
            root.classList.toggle('dark', dark);
            list.scrollTop = 0;
            const before = refresh.getBoundingClientRect();
            const withScrollbar = maxEdgeDifference();
            list.scrollTop = list.scrollHeight;
            const after = refresh.getBoundingClientRect();
            const footerShift = Math.abs(before.top - after.top);
            list.style.scrollbarWidth = 'none';
            const withoutGutter = maxEdgeDifference();
            list.style.removeProperty('scrollbar-width');
            return { dark, withScrollbar, withoutGutter, footerShift };
          });
        } finally {
          list.style.removeProperty('scrollbar-width');
          list.scrollTop = scrollTop;
          root.classList.toggle('dark', initialDark);
        }
      });
      assert.ok(layout.every(row =>
        row.withScrollbar <= 1 / 64 && row.withoutGutter <= 1 / 64 && row.footerShift <= 1 / 64,
      ), `${scenario} (${language}): model and refresh capsules must align and refresh must stay fixed ${JSON.stringify(layout)}`);
    }
  }
  async function checkRefresh(page, menu, newModel) {
    const refresh = menu.getByRole('menuitem', { name: '刷新模型列表', exact: true });
    const scrollingModel = menu.getByRole('menuitemradio', { name: 'Synthetic scrolling model 15', exact: true });
    await app.evaluate(() => { globalThis.shortCatalog = true; });
    await refresh.click();
    await scrollingModel.waitFor({ state: 'hidden' });
    await assertCatalogLayout(page, newModel + ' short list');
    const options = menu.getByRole('menuitemradio');
    await options.first().hover();
    assert.equal(await options.first().getAttribute('data-highlighted'), '');
    await options.first().press('ArrowDown');
    assert.ok(await options.nth(1).evaluate(option => option === document.activeElement));
    const option = menu.getByRole('menuitemradio', { name: newModel, exact: true });
    assert.equal(await option.count(), 0);
    await app.evaluate((_, id) => {
      globalThis.shortCatalog = false;
      globalThis.nextCatalogModel = id;
    }, newModel);
    await refresh.click();
    await option.waitFor();
    await scrollingModel.waitFor();
    await assertCatalogLayout(page, newModel + ' long list');
  }
  await checkRefresh(main, modelPopup, 'pre-interview-new-model');
  await modelPopup.locator('.reasoning-model-list').evaluate((node) => {
    node.scrollTop = node.scrollHeight;
  });
  await modelPopup.evaluate(async (node) => {
    await Promise.all(
      node.getAnimations({ subtree: true }).map((animation) => animation.finished.catch(() => {})),
    );
  });
  const scroller = await modelPopup.evaluate((node) => {
    const outer = node.getBoundingClientRect(),
      style = getComputedStyle(node);
    const list = node.querySelector('.reasoning-model-list'),
      rect = list.getBoundingClientRect();
    const row = list.firstElementChild.getBoundingClientRect();
    return {
      scrolling: list.scrollHeight > list.clientHeight + 20,
      contained:
        rect.top >= outer.top + 5 &&
        rect.bottom <= outer.bottom - 5 &&
        rect.left >= outer.left + parseFloat(style.borderLeftWidth) - 1 / 64 &&
        rect.right <= outer.right - parseFloat(style.borderRightWidth) + 1 / 64 &&
        row.left >= outer.left + 5 &&
        row.right <= outer.right - 5,
      outerOverflow: style.overflowY,
      padding: parseFloat(style.paddingLeft),
      curve: style.cornerShape,
    };
  });
  assert.equal(scroller.scrolling, true);
  assert.equal(scroller.contained, true, JSON.stringify(scroller));
  assert.equal(scroller.outerOverflow, 'hidden');
  assert.equal(scroller.padding, 6);
  assert.match(scroller.curve, /superellipse\(2\)|squircle/);
  await captureRequested(main, 'combined-interview-settings-scroll');
  await modelPopup
    .getByRole('menuitemradio', { name: 'Synthetic scrolling model 15', exact: true })
    .click();
  await main.keyboard.press('Escape');
  assert.match(await effort.innerText(), /Synthetic scrolling model 15/);
  await openModelMenu(main, '面试回答模型', '面试回答思考强度');
  await dialog.getByRole('menuitemradio', { name: 'Test Model', exact: true }).click();
  await main.keyboard.press('Escape');
  // The invalid legacy saved value must never survive into a confirmed request.
  await main.evaluate(() =>
    localStorage.setItem(
      'copilot-interview-settings-v1',
      JSON.stringify({ modelId: 'test-model', effort: 'ultra' }),
    ),
  );
  await main.reload();
  await connectUiAccount(app, main);
  await main
    .getByRole('button', { name: '聊天模型', exact: true })
    .getByText('Test Model', { exact: true })
    .waitFor();
  const chatPopup = await openModelMenu(main);
  await checkRefresh(main, chatPopup, 'preparation-new-model');
  assert.equal(await chatPopup.getAttribute('data-side'), 'top', 'The composer catalog opens above its bottom trigger');
  await chatPopup.getByRole('menuitemradio', { name: 'Test Model', exact: true }).click();
  const chatEffort = main.getByRole('slider', { name: '思考强度', exact: true });
  assert.equal(await chatEffort.getAttribute('min'), '0');
  assert.equal(await chatEffort.getAttribute('max'), '4');
  await chatEffort.press('Home');
  await main.waitForFunction(() => {
    const fill = document.querySelector('.reasoning-slider-fill');
    return fill && Number(getComputedStyle(fill).opacity) === 0;
  });
  const wasDark = await main.evaluate(() => document.documentElement.classList.contains('dark'));
  for (const dark of [false, true]) {
    await main.evaluate((dark) => document.documentElement.classList.toggle('dark', dark), dark);
    const minimum = await chatEffort.evaluate((input) => {
      const slider = input.closest('.reasoning-slider');
      const track = slider.querySelector('.reasoning-slider-track').getBoundingClientRect();
      const thumb = slider.querySelector('.reasoning-slider-thumb');
      const rect = thumb.getBoundingClientRect();
      const style = getComputedStyle(thumb);
      return {
        fill: Number(getComputedStyle(slider.querySelector('.reasoning-slider-fill')).opacity),
        borders: ['Top', 'Right', 'Bottom', 'Left'].map((side) =>
          parseFloat(style['border' + side + 'Width']),
        ),
        offset: rect.left - track.left,
        diameter: rect.width,
        height: rect.height,
        shadow: style.boxShadow,
      };
    });
    assert.equal(minimum.fill, 0, 'Minimum has no residual colored half-cap beneath the thumb');
    assert.deepEqual(minimum.borders, [0, 0, 0, 0], 'Thumb has no hard outline');
    assert(Math.abs(minimum.offset) < 0.5, 'Minimum thumb aligns with the track end');
    assert(Math.abs(minimum.diameter - 28) < 0.5 && Math.abs(minimum.height - 28) < 0.5);
    assert.notEqual(minimum.shadow, 'none', 'The soft thumb shadow remains');
  }
  await main.evaluate((dark) => document.documentElement.classList.toggle('dark', dark), wasDark);
  await chatEffort.press('End');
  assert.equal(await chatEffort.getAttribute('aria-valuetext'), '最高');
  await chatEffort.press('Escape');
  await openSettings();
  assert.match(await effort.innerText(), /轻度/);
  const selectEffort = async (label) => {
    await effort.click();
    const slider = dialog.getByRole('slider', { name: '面试回答思考强度', exact: true });
    const index = ['轻度', '中', '高', '极高', '最高'].indexOf(label);
    assert.ok(index >= 0, `Supported test effort: ${label}`);
    await slider.press('Home');
    for (let step = 0; step < index; step++) await slider.press('ArrowRight');
    assert.equal(await slider.getAttribute('aria-valuetext'), label);
    assert.equal(await slider.isVisible(), true, 'Draft settings retain the open effort popup');
    await slider.press('Enter');
    assert.equal(await slider.isVisible(), true, 'Confirming an effort keeps its popup open');
    await slider.press('Escape');
  };
  const selectModel = async (label) => {
    if (label === 'Test Model') {
      await effort.evaluate(button => {
        const pane = button.closest('.settings-content-body');
        const header = button.closest('.settings-content').querySelector('.settings-content-heading');
        pane.scrollTop += button.getBoundingClientRect().top - header.getBoundingClientRect().bottom - 4;
      });
    }
    const menu = await openModelMenu(main, '面试回答模型', '面试回答思考强度');
    if (label === 'Test Model') {
      await menu.locator('.reasoning-model-list').evaluate(list => {
        if (list.clientHeight < list.firstElementChild.clientHeight) throw Error('No complete model option fits');
      });
      assert.equal(await menu.getAttribute('data-side'), 'bottom', 'The catalog opens below a high settings trigger');
    }
    await menu.getByRole('menuitemradio', { name: label, exact: true }).click();
    await main.keyboard.press('Escape');
  };
  await selectEffort('高');
  await selectModel('Restricted Model');
  assert.match(await effort.innerText(), /中/);
  await effort.click();
  const restrictedEffort = dialog.getByRole('slider', { name: '面试回答思考强度', exact: true });
  assert.equal(await restrictedEffort.getAttribute('max'), '0');
  assert.equal(await restrictedEffort.getAttribute('aria-valuetext'), '中');
  assert.equal(await restrictedEffort.isDisabled(), true);
  await main.keyboard.press('Escape');
  await selectModel('Unknown Model');
  assert.equal(await effort.isDisabled(), false);
  assert.doesNotMatch(await effort.innerText(), /自动/);
  await effort.click();
  assert.equal(
    await dialog.getByRole('slider', { name: '面试回答思考强度', exact: true }).count(),
    0,
  );
  await main.keyboard.press('Escape');
  await selectModel('Test Model');
  await selectEffort('最高');
  assert.equal(await dialog.evaluate((e) => e.scrollWidth > e.clientWidth), false);
  await dialog.screenshot({ animations: 'disabled' });
  await main.evaluate(() => document.documentElement.classList.add('dark'));
  await dialog.screenshot({ animations: 'disabled' });
  await dialog.getByRole('button', { name: '关闭设置', exact: true }).click();
  assert.ok(
    (await main.evaluate(() => window.desktop.components({ op: 'status' }))).items.some(
      (item) => item.id === 'speech' && item.phase === 'ready',
    ),
    'The isolated speech-availability fixture reaches the real readiness API',
  );
  await main.locator('.interview-start-trigger').click();
  const confirmation = main.getByRole('dialog', { name: '开始面试', exact: true });
  const [floating] = await Promise.all([
    app.waitForEvent('window'),
    confirmation.getByRole('button', { name: '确认开始', exact: true }).click(),
  ]);
  floating.setDefaultTimeout(15000);
  const confirmed = await floating.evaluate(
    async () => (await window.desktop.interviewState()).configuration,
  );
  assert.equal(confirmed.effort, 'max');
  await floating.getByRole('status', { name: '语音模型：正常', exact: true }).waitFor();
  assert.equal(
    await floating.getByRole('button', { name: '面试回答思考强度', exact: true }).count(),
    0,
  );
  await floating.reload();
  await floating.getByRole('textbox', { name: '面试提问', exact: true }).waitFor();
  assert.equal(
    await floating.evaluate(
      async () => (await window.desktop.interviewState()).configuration.effort,
    ),
    'max',
  );
  const tamperingRejected = await floating.evaluate(async () => {
    try {
      await window.desktop.interviewAnswer({
        id: 'tampered',
        question: 'why',
        modelId: 'test-model',
        effort: 'low',
      });
      return false;
    } catch {
      return true;
    }
  });
  assert.equal(tamperingRejected, true);
  await floating.getByRole('textbox', { name: '面试提问', exact: true }).fill('Explain scheduling');
  await floating.getByRole('button', { name: '发送面试问题', exact: true }).click();
  await floating.getByText('Fixture answer 1', { exact: true }).waitFor();
  const request = await app.evaluate(() => globalThis.interviewRequests[0]);
  assert.equal(request.effort, 'max');
  assert.equal(request.modelId, 'test-model');
  await floating.getByRole('button', { name: '面试设置', exact: true }).click();
  const activeSettings = floating.getByRole('dialog', { name: '面试设置', exact: true });
  const activeEffort = activeSettings.getByRole('button', { name: '面试回答模型', exact: true });
  await assertControlRows(activeSettings);
  const liveMenu = await openModelMenu(floating, '面试回答模型', '面试思考强度');
  await checkRefresh(floating, liveMenu, 'live-interview-new-model');
  await floating.keyboard.press('Escape');
  await activeEffort.click();
  const activeSlider = activeSettings.getByRole('slider', { name: '面试思考强度', exact: true });
  await activeSlider.evaluate(async (node) => {
    await Promise.all(
      node
        .closest('.reasoning-effort-popup')
        .getAnimations({ subtree: true })
        .map((animation) => animation.finished.catch(() => {})),
    );
  });
  assert.equal(await activeSlider.getAttribute('aria-valuetext'), '最高');
  const updatesBefore = await app.evaluate(() => globalThis.interviewModelUpdates.length);
  const sliderBox = await activeSlider.boundingBox();
  const sliderY = sliderBox.y + sliderBox.height / 2;
  const thumbRadius = 14;
  const sliderLeft = sliderBox.x + thumbRadius;
  const sliderTravel = sliderBox.width - thumbRadius * 2;
  await floating.mouse.move(sliderLeft + sliderTravel, sliderY);
  await floating.mouse.down();
  try {
    for (const [progress, label] of [
      [0.8, '极高'],
      [0.5, '高'],
      [0.25, '中'],
      [0, '轻度'],
    ]) {
      await floating.mouse.move(sliderLeft + sliderTravel * progress, sliderY, { steps: 8 });
      assert.equal(
        await activeSlider.isVisible(),
        true,
        'The popup stays open throughout dragging',
      );
      assert.equal(await activeSlider.getAttribute('aria-valuetext'), label);
      if (progress === 0.8) {
        const continuousValue = await activeSlider.evaluate((node) => node.valueAsNumber);
        assert.ok(
          continuousValue > 3 && continuousValue < 4,
          'Pointer motion previews a continuous position',
        );
      }
      assert.equal(
        await app.evaluate(() => globalThis.interviewModelUpdates.length),
        updatesBefore,
        'Intermediate pointer positions do not invoke update-model IPC',
      );
      assert.equal(
        await floating.evaluate(
          async () => (await window.desktop.interviewState()).configuration.effort,
        ),
        'max',
        'The confirmed interview effort stays unchanged before release',
      );
    }
  } finally {
    await floating.mouse.up();
  }
  await floating.waitForFunction(
    async () => (await window.desktop.interviewState()).configuration.effort === 'low',
    undefined,
    { polling: 50 },
  );
  await floating.waitForTimeout(80);
  const committedUpdates = await app.evaluate(() => globalThis.interviewModelUpdates);
  assert.equal(
    committedUpdates.length,
    updatesBefore + 1,
    'Release commits exactly one update-model IPC',
  );
  assert.deepEqual(committedUpdates.at(-1), { modelId: 'test-model', effort: 'low' });
  assert.equal(await activeSlider.isVisible(), true, 'The popup remains open after a pointer save');
  // Restore the matrix's original confirmed setting through the same real UI.
  await app.evaluate(() => {
    globalThis.holdModelUpdate = true;
  });
  const heldSlider = await activeSlider.elementHandle();
  await activeSlider.press('End');
  const activeTrigger = activeSettings.locator('button[aria-label="面试回答模型"]');
  await floating.waitForFunction(
    () => document.querySelector('button[aria-label="面试回答模型"]')?.disabled,
  );
  assert.equal(await activeSlider.isVisible(), true, 'Saving does not dismiss the effort popup');
  assert.equal(await heldSlider.evaluate((node) => node.isConnected), true);
  assert.equal(await activeSlider.getAttribute('aria-disabled'), 'true');
  assert.equal(await activeSlider.getAttribute('aria-valuetext'), '最高');
  assert.equal(await activeSettings.locator('.reasoning-model-selector').isDisabled(), true);
  assert.equal(await activeSlider.evaluate((node) => document.activeElement === node), true);
  await floating.keyboard.press('Home');
  const savingBox = await activeSlider.boundingBox();
  await floating.mouse.click(savingBox.x + 14, savingBox.y + savingBox.height / 2);
  assert.equal(await activeSlider.getAttribute('aria-valuetext'), '最高');
  assert.equal(
    await app.evaluate(() => globalThis.interviewModelUpdates.length),
    updatesBefore + 2,
    'Saving blocks further keyboard/pointer submissions and model selection',
  );
  await app.evaluate(async () => {
    const deadline = Date.now() + 3000;
    while (!globalThis.releaseModelUpdate && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 10));
    if (!globalThis.releaseModelUpdate) throw Error('The isolated update reply was not held');
    globalThis.releaseModelUpdate();
  });
  await floating.waitForFunction(
    () =>
      !document.querySelector('button[aria-label="面试回答模型"]')?.disabled &&
      document.querySelector('input[aria-label="面试思考强度"]')?.getAttribute('aria-disabled') !==
        'true',
  );
  assert.equal(await activeTrigger.isEnabled(), true);
  assert.equal(await heldSlider.evaluate((node) => node.isConnected), true);
  assert.equal(await activeSlider.isVisible(), true);
  assert.equal(await activeSlider.evaluate((node) => document.activeElement === node), true);
  assert.equal(await activeSlider.getAttribute('aria-valuetext'), '最高');
  await floating.waitForFunction(
    async () => (await window.desktop.interviewState()).configuration.effort === 'max',
    undefined,
    { polling: 50 },
  );
  assert.equal(
    await app.evaluate(() => globalThis.interviewModelUpdates.length),
    updatesBefore + 2,
  );
  await app.evaluate(() => {
    globalThis.failNextModelRead = true;
  });
  await activeSlider.press('Home');
  await activeSettings.locator('.danger-text[role="alert"]').waitFor();
  await floating.waitForFunction(
    () =>
      !document.querySelector('button[aria-label="面试回答模型"]')?.disabled &&
      document.querySelector('input[aria-label="面试思考强度"]')?.getAttribute('aria-valuetext') ===
        '最高',
  );
  assert.equal(await app.evaluate(() => globalThis.failNextModelRead), false);
  assert.equal(await activeSlider.isVisible(), true, 'Failed saves retain the popup and roll back');
  assert.equal(await activeSlider.evaluate((node) => document.activeElement === node), true);
  assert.equal(
    await floating.evaluate(
      async () => (await window.desktop.interviewState()).configuration.effort,
    ),
    'max',
    'Failed model lookup leaves the confirmed configuration unchanged',
  );
  assert.equal(
    await app.evaluate(() => globalThis.interviewModelUpdates.length),
    updatesBefore + 3,
  );
  await activeSlider.press('Escape');
  await activeSlider.waitFor({ state: 'hidden' });
  await floating.waitForFunction(
    () => document.activeElement?.getAttribute('aria-label') === '面试回答模型',
  );
  assert.equal(await activeTrigger.evaluate((node) => document.activeElement === node), true);
  await activeTrigger.click();
  await activeSlider.waitFor();
  const outside = await activeSettings
    .locator('.interview-settings-section > h3')
    .filter({ hasText: '模型设置' })
    .boundingBox();
  await floating.mouse.click(outside.x + 4, outside.y + outside.height / 2);
  await activeSlider.waitFor({ state: 'hidden' });
  await activeSettings.getByRole('button', { name: '关闭对话框', exact: true }).click();
  await floating.getByRole('button', { name: '结束面试', exact: true }).click();
  await Promise.all([
    floating.waitForEvent('close'),
    floating.getByRole('button', { name: '确认结束面试', exact: true }).click(),
  ]);
  await openSettings();
  await selectModel('Unknown Model');
  assert.equal(await effort.isDisabled(), false);
  await dialog.getByRole('button', { name: '关闭设置', exact: true }).click();
  await main.locator('.interview-start-trigger').click();
  const [unsupported] = await Promise.all([
    app.waitForEvent('window'),
    confirmation.getByRole('button', { name: '确认开始', exact: true }).click(),
  ]);
  await unsupported
    .getByRole('textbox', { name: '面试提问', exact: true })
    .fill('Explain unsupported reasoning capability');
  await unsupported.getByRole('button', { name: '发送面试问题', exact: true }).click();
  await unsupported.getByText('Fixture answer 2', { exact: true }).waitFor();
  assert.equal(await app.evaluate(() => 'effort' in globalThis.interviewRequests[1]), false);
  console.log(
    'PASS: model-supported explicit effort/default low/disabled unknown, confirmed defaults after reload, tamper rejection, live drag with one release commit, persistent save popup/focus with concurrency lock and failure rollback, explicit dismissal, and UI→IPC→AI effort or omitted unsupported capability; temporary profile cleaned at exit.',
  );
} finally {
  await app.evaluate(({ BrowserWindow }) => {
    for (const win of BrowserWindow.getAllWindows()) win.destroy();
  });
  await closeUiApp(app);
}
