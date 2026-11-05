import { connectUiAccount } from './install-ui-account.mjs';
import { offlineElectronEntry } from './offline-electron-entry.mjs';
import { testRoot, electron } from './test-workspace.mjs';
import { installUiAccount, closeUiApp } from './install-ui-account.mjs';
import { assertInitialDownloadProgress, assertDownloadButton } from './assert-download-button.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { captureRequested } from './capture-requested.mjs';
import { assertLoadingIcon } from './assert-loading-icon.mjs';

for (const name of ['profile', 'tmp', 'home'])
  await mkdir(path.join(testRoot, name), { recursive: true });
const fixture = path.join(testRoot, 'components-ui.cjs');
await writeFile(
  fixture,
  `
const {app}=require('electron');
app.setAppPath(${JSON.stringify(process.cwd())});
const service=require(${JSON.stringify(path.resolve('dist-electron/shared/electron/backend/components/service.js'))});
const hardware=require(${JSON.stringify(path.resolve('dist-electron/shared/electron/backend/speech/hardware.js'))});
globalThis.uiSpeechHardware=process.platform==='darwin'?{cuda:false,metal:true}:{cuda:true};
hardware.SpeechHardwareProbe=class {
 read(){return Promise.resolve(globalThis.uiSpeechHardware);}
 require(){return Promise.resolve();}
};
service.ComponentService=class extends service.ComponentService {
 constructor(options){super({...options,managed:true});globalThis.uiComponents=this;}
 status(){if(this.value.phase==='checking')this.publish('needed');return Promise.resolve(this.state());}
 download(id){
  if(['downloading','verifying'].includes(this.value.phase))return Promise.resolve(this.state());
  const item=this.value.items.find(item=>item.id===id);
  item.phase='downloading';item.received=Math.floor(item.bytes*.05);this.publish('downloading');
  clearInterval(this.progressTimer);
  this.progressTimer=setInterval(()=>{item.received+=100;this.publish('downloading');},25);
  return Promise.resolve(this.state());
 }
 cancel(){
  clearInterval(this.progressTimer);
  for(const item of this.value.items)if(item.phase!=='ready'){item.phase='pending';item.received=0;}
  this.publish('cancelled');return Promise.resolve(this.state());
 }
 remove(id){
  this.removedId=id;
  const item=this.value.items.find(item=>item.id===id);
  item.phase='pending';item.received=0;this.publish('needed');
  return Promise.resolve(this.state());
 }
};
require(${JSON.stringify(path.resolve('dist-electron/shared/electron/main.js'))});
`,
);
const env = {
  ...process.env,
  COPILOT_TEST_USER_DATA: path.join(testRoot, 'profile'),
  VITE_DEV_SERVER_URL: '',
  HOME: path.join(testRoot, 'home'),
  CFFIXED_USER_HOME: path.join(testRoot, 'home'),
  TMPDIR: path.join(testRoot, 'tmp'),
};
delete env.ELECTRON_RUN_AS_NODE;
let app;
const modelsOnly = process.argv.includes('--models-only');
const assertAnimated = (widths, label) => {
  const start = widths[0],
    end = widths.at(-1);
  if (Math.abs(start - end) <= 1) {
    assert.ok(
      widths.every((width) => Math.abs(width - start) <= 1),
      `${label}: equal natural widths must stay stable`,
    );
    return;
  }
  assert.ok(
    widths.some(
      (width) => width > Math.min(start, end) + 0.1 && width < Math.max(start, end) - 0.1,
    ),
    `${label}: needs intermediate widths: ${JSON.stringify(widths)}`,
  );
};
try {
  app = await electron.launch({ args: [await offlineElectronEntry(fixture)], env });
  const login = await app.firstWindow();
  await login.getByRole('heading', { name: '登录 VoxCue', exact: true }).waitFor();
  await installUiAccount(app);
  const page = await connectUiAccount(app, login);
  page.setDefaultTimeout(15000);
  const errors = [];
  await page.emulateMedia({
    reducedMotion: 'no-preference',
    colorScheme: process.argv.includes('--dark-preview') ? 'dark' : 'light',
  });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.locator('.chat-column > .components-notice').waitFor();
  if (modelsOnly)
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((win) => win.isVisible())
        .setContentSize(1000, 900),
    );
  for (const width of modelsOnly ? [] : [1400, 1080, 960]) {
    await app.evaluate(
      ({ BrowserWindow }, width) =>
        BrowserWindow.getAllWindows()
          .find((win) => win.isVisible())
          .setContentSize(width, 900),
      width,
    );
    for (const open of [true, false]) {
      const samples = await page.evaluate(async (open) => {
        const panel = document.querySelector('.personal-panel');
        const chat = document.querySelector('.chat-column');
        const notice = chat.querySelector('.components-notice');
        const read = () => {
          const p = panel.getBoundingClientRect(),
            c = chat.getBoundingClientRect(),
            n = notice.getBoundingClientRect();
          return {
            width: p.width,
            chat: c.width,
            center: (n.left + n.right - c.left - c.right) / 2,
            inert: panel.inert,
            hidden: panel.getAttribute('aria-hidden'),
          };
        };
        const samples = [read()];
        document
          .querySelector(open ? 'button[aria-label="个人信息"]' : 'button[aria-label="个人信息"]')
          .click();
        const start = performance.now();
        while (performance.now() - start < 350) {
          await new Promise(requestAnimationFrame);
          samples.push(read());
        }
        return samples;
      }, open);
      assertAnimated(
        samples.map((sample) => sample.width),
        `personal panel ${width}/${open}`,
      );
      assertAnimated(
        samples.map((sample) => sample.chat),
        `chat resize ${width}/${open}`,
      );
      assert.ok(
        samples.every((sample) => Math.abs(sample.center) < 1),
        'notice stays centered in chat column',
      );
      assert.equal(samples.at(-1).inert, !open);
      assert.equal(samples.at(-1).hidden, String(!open));
      if (width === 1400 && open) await captureRequested(page, 'notice-with-personal-card');
      if (width === 1400 && open && process.argv.includes('--preview'))
        console.log(
          JSON.stringify({
            preview: '个人信息展开后，提示随聊天列收窄并居中',
            jpeg: (
              await page
                .locator('.preparation-layout')
                .screenshot({ type: 'jpeg', quality: 65, scale: 'css' })
            ).toString('base64'),
          }),
        );
    }
    assert.equal(
      await page
        .getByRole('button', { name: '个人信息', exact: true })
        .evaluate((el) => document.activeElement === el),
      true,
    );
  }
  await page.getByRole('button', { name: '用户菜单', exact: true }).click();
  await page.getByRole('menuitem', { name: '设置', exact: true }).click();
  await page
    .getByRole('navigation', { name: '设置分类' })
    .getByRole('button', { name: '通用', exact: true })
    .click();
  const settings = page.getByRole('dialog', { name: '设置', exact: true });
  await settings
    .getByRole('navigation', { name: '设置分类' })
    .getByRole('button', { name: '本地组件', exact: true })
    .click();
  const rows = settings.locator('.component-row');
  const speechGroup = settings.getByRole('region', { name: '语音识别组件', exact: true });
  const knowledgeGroup = settings.getByRole('region', { name: '知识库检索组件', exact: true });
  assert.equal(await knowledgeGroup.locator('.component-row').count(), 1);
  await knowledgeGroup.getByText('知识库检索', { exact: true }).waitFor();
  await speechGroup.getByText('轻量语音识别', { exact: true }).waitFor();
  assert.equal(await speechGroup.getByText('知识库检索组件', { exact: true }).count(), 0);
  if (['win32', 'darwin'].includes(process.platform))
    await speechGroup.getByText('多语言语音识别', { exact: true }).waitFor();
  for (const name of await rows.locator('.component-model-name').all())
    assert.equal(await name.evaluate((element) => getComputedStyle(element).fontWeight), '400');
  if (!modelsOnly) {
    const rowCount = await rows.count();
    await settings.evaluate(async (dialog) => {
      await Promise.all(
        dialog
          .getAnimations({ subtree: true })
          .filter((animation) => animation.effect?.getTiming().iterations !== Infinity)
          .map((animation) => animation.finished),
      );
    });
    const panelGap = await settings.evaluate(
      (dialog) =>
        dialog.querySelector('.components-panel').getBoundingClientRect().top -
        dialog.querySelector('.settings-content-heading').getBoundingClientRect().bottom,
    );
    // Blink layout uses 1/64 CSS px; fractional Windows DPI introduces float32
    // noise when the two DOMRect coordinates are subtracted.
    assert.equal(
      await settings
        .locator('.components-panel')
        .evaluate((panel) => getComputedStyle(panel).marginTop),
      '16px',
    );
    assert.ok(
      Math.round(panelGap * 64) >= 16 * 64,
      `Component card must clear the heading separator: ${panelGap}px`,
    );
    for (let index = 0; index < rowCount; index++) {
      const row = rows.nth(index),
        other = rows.nth((index + 1) % rowCount);
      await row.getByRole('button', { name: '下载', exact: true }).hover();
      const progress = row.locator('.download-button');
      // CSS transitions use the compositor clock. Inspect them in real time,
      // then start a separate download under the controlled JS timer below.
      const widths = await row.evaluate(async (row) => {
        const samples = [row.querySelector('button').getBoundingClientRect().width];
        row.querySelector('button').click();
        const start = performance.now();
        while (performance.now() - start < 350) {
          await new Promise(requestAnimationFrame);
          samples.push(row.querySelector('button').getBoundingClientRect().width);
        }
        return samples;
      });
      assertAnimated(widths, 'download action');
      assert.ok(
        Math.abs(widths.at(-1) - widths.at(-2)) < 0.1,
        'frequent progress events must not restart the width transition',
      );
      assert.equal(
        await row
          .locator('button')
          .evaluate(
            (element) =>
              element
                .getAnimations()
                .filter(
                  (animation) =>
                    animation.effect?.getTiming().iterations !== Infinity &&
                    animation.playState === 'running' &&
                    animation.effect
                      ?.getKeyframes()
                      .some((frame) => 'width' in frame || 'minWidth' in frame),
                ).length,
          ),
        0,
        'width transition finishes while progress continues',
      );
      assert.equal(
        await other.getByRole('button', { name: '下载', exact: true }).isDisabled(),
        true,
      );
      assert.equal(await other.getByText(/尚未下载/).isVisible(), true);
      assert.equal(await settings.getByText('准备中…', { exact: true }).count(), 0);
      await captureRequested(page, 'component-' + index + '-progress');
      await progress.hover();
      await progress.locator('.download-button-cancel').waitFor({ state: 'visible' });
      await captureRequested(page, 'component-' + index + '-cancel');
      await progress.click();
      await row.getByRole('button', { name: '下载', exact: true }).waitFor();
      await assertInitialDownloadProgress(progress, () =>
        row.getByRole('button', { name: '下载', exact: true }).click(),
      );
      await assertDownloadButton(page, progress);
      if (index === 0 && process.argv.includes('--preview')) {
        // Keep cancellation visible while screenshot clipping adjusts the viewport.
        await page.keyboard.press('Tab');
        await progress.focus();
        await progress.locator('.download-button-cancel').waitFor({ state: 'visible' });
        await progress.evaluate((element) =>
          Promise.all(
            element.getAnimations().map((animation) => animation.finished.catch(() => {})),
          ),
        );
        console.log(
          JSON.stringify({
            preview: '红色取消按钮与另一个未开始的模型',
            jpeg: (
              await settings
                .locator('.components-panel')
                .screenshot({ type: 'jpeg', quality: 80, scale: 'css' })
            ).toString('base64'),
          }),
        );
      }
      await progress.click();
      await row.getByRole('button', { name: '下载', exact: true }).waitFor();
      await other.getByRole('button', { name: '下载', exact: true }).waitFor({ state: 'visible' });
      assert.equal(
        await other.getByRole('button', { name: '下载', exact: true }).isEnabled(),
        true,
      );
    }
    if (process.platform === 'darwin') {
      await app.evaluate(() => {
        const service = globalThis.uiComponents;
        service.value.items[0].phase = 'verifying';
        service.publish('verifying');
      });
      const verifying = rows.first().locator('.download-ring');
      await verifying.waitFor();
      assert.equal(await verifying.getAttribute('aria-valuenow'), null);
      assert.equal(await verifying.getAttribute('aria-valuetext'), '校验中');
      await page.mouse.move(1, 1);
      await assertLoadingIcon(page, verifying);
      await captureRequested(rows.first().locator('.download-button'), 'component-verifying', {
        animations: 'allow',
      });
    }
    await app.evaluate(() => {
      const service = globalThis.uiComponents;
      for (const item of service.value.items) {
        item.phase = 'ready';
        item.received = item.bytes;
      }
      service.publish('ready');
    });
    await rows.locator('.component-ready-actions').first().waitFor();
    assert.equal(await rows.getByText('已就绪', { exact: true }).count(), 0);
    await captureRequested(page, 'components-ready');
    for (const colorScheme of ['dark', 'light']) {
      await page.emulateMedia({ colorScheme });
      await page.waitForFunction(
        (dark) => document.documentElement.classList.contains('dark') === dark,
        colorScheme === 'dark',
      );
      await settings.evaluate(async (dialog) => {
        await Promise.all(
          dialog
            .getAnimations({ subtree: true })
            .filter((animation) => animation.effect?.getTiming().iterations !== Infinity)
            .map((animation) => animation.finished),
        );
      });
      const geometry = await settings.locator('.components-panel').evaluate((panel) => ({
        scroll: panel.scrollWidth,
        client: panel.clientWidth,
        rows: [...panel.querySelectorAll('.component-row')].map((row) => ({
          row: row.getBoundingClientRect().toJSON(),
          action: row.querySelector('.component-ready-actions').getBoundingClientRect().toJSON(),
        })),
      }));
      const layoutUnit = (value) => Math.round(value * 64);
      assert.ok(
        geometry.scroll <= geometry.client &&
          geometry.rows.every(
            ({ row, action }) =>
              layoutUnit(action.left) >= layoutUnit(row.left) &&
              layoutUnit(action.right) <= layoutUnit(row.right),
          ),
        JSON.stringify(geometry),
      );
    }
    if (process.argv.includes('--preview-components'))
      console.log(
        'VOXCUE_COMPONENTS_PREVIEW:' +
          (
            await settings
              .locator('.components-panel')
              .screenshot({ type: 'jpeg', quality: 75, scale: 'css' })
          ).toString('base64'),
      );
    for (let index = 0; index < rowCount; index++) {
      const row = rows.nth(index),
        other = rows.nth((index + 1) % rowCount);
      const label = await row.locator('.component-model-name').innerText();
      const remove = row.getByRole('button', { name: '删除：' + label, exact: true });
      await remove.click();
      assert.equal(await app.evaluate(() => globalThis.uiComponents.removedId), undefined);
      await page.keyboard.press('Escape');
      await remove.waitFor();
      await remove.click();
      const otherReady = await other.locator('.component-ready-actions').count();
      await row.getByRole('button', { name: '确认删除：' + label, exact: true }).click();
      await row.getByRole('button', { name: '下载', exact: true }).waitFor();
      assert.equal(
        await app.evaluate(() => globalThis.uiComponents.removedId),
        await row.getAttribute('data-component-id'),
      );
      assert.equal(await other.locator('.component-ready-actions').count(), otherReady);
      await app.evaluate(() => {
        globalThis.uiComponents.removedId = undefined;
      });
    }
  }
  await app.evaluate(() => {
    const service = globalThis.uiComponents;
    const item = service.value.items.find((item) => item.id === 'speech');
    item.phase = 'ready';
    item.received = item.bytes;
    service.publish('needed');
  });
  await settings.getByRole('button', { name: '关闭设置', exact: true }).click();
  await page.getByRole('button', { name: '用户菜单', exact: true }).click();
  await page.getByRole('menuitem', { name: '设置', exact: true }).click();
  await page
    .getByRole('navigation', { name: '设置分类' })
    .getByRole('button', { name: '通用', exact: true })
    .click();
  await settings
    .getByRole('navigation', { name: '设置分类' })
    .getByRole('button', { name: '面试设置', exact: true })
    .click();
  const modelSettings = settings.getByRole('region', { name: '模型设置', exact: true });
  const device = modelSettings.getByRole('button', { name: '语音推理设备', exact: true });
  const assertDisabledMenu = async () => {
    assert.equal(await device.isDisabled(), true);
    await device.scrollIntoViewIfNeeded();
    const bounds = await device.boundingBox();
    await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    await device.dispatchEvent('keydown', { key: 'ArrowDown' });
    await device.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
    assert.equal(await device.getAttribute('aria-expanded'), 'false');
    assert.equal(await settings.getByRole('menuitemradio').count(), 0);
  };
  await assertDisabledMenu();
  if (['win32', 'darwin'].includes(process.platform)) {
    const speechModel = modelSettings.getByRole('button', { name: '语音识别模型', exact: true });
    await speechModel.click();
    const menuPreview = process.argv.find((argument) => argument.startsWith('--menu-preview='));
    if (menuPreview) {
      const previewPath = menuPreview.slice('--menu-preview='.length);
      if (!path.isAbsolute(previewPath)) throw Error('Preview path must be absolute');
      await settings
        .locator('.choice-menu[data-state="open"]')
        .screenshot({ path: previewPath, scale: 'css' });
    }
    const missing = settings.getByRole('menuitemradio', {
      name: '多语言语音识别（未下载）',
      exact: true,
    });
    assert.equal(await missing.getAttribute('aria-disabled'), 'true');
    await missing.hover();
    const missingBounds = await missing.boundingBox();
    await page.mouse.click(
      missingBounds.x + missingBounds.width / 2,
      missingBounds.y + missingBounds.height / 2,
    );
    await page.keyboard.press('Escape');
    assert.match(await speechModel.innerText(), /轻量语音识别/);
    assert.equal(await modelSettings.getByText(/请先在.*本地组件.*下载/).count(), 0);
    assert.equal(await modelSettings.getByText(/已检测到兼容显卡和驱动/).count(), 0);
    await app.evaluate(() => {
      const service = globalThis.uiComponents;
      const item = service.value.items.find((item) => item.id === 'qwen');
      item.phase = 'ready';
      item.received = item.bytes;
      service.publish('ready');
    });
    await modelSettings.getByRole('button', { name: '语音识别模型', exact: true }).click();
    await settings.getByRole('menuitemradio', { name: '多语言语音识别', exact: true }).click();
    assert.equal(await device.isEnabled(), true);
    await device.evaluate((element) =>
      Promise.all(element.getAnimations().map((animation) => animation.finished)),
    );
    assert.equal(await device.evaluate((element) => getComputedStyle(element).opacity), '1');
    await device.click();
    assert.equal(
      await settings
        .getByRole('menuitemradio', {
          name: process.platform === 'darwin' ? 'Metal（推荐）' : 'CUDA（推荐）',
          exact: true,
        })
        .count(),
      1,
    );
    await settings.getByRole('menuitemradio', { name: 'CPU', exact: true }).click();
    await modelSettings.getByRole('alert').filter({ hasText: '转写可能出现明显延迟' }).waitFor();
    if (process.argv.includes('--memory-preview')) {
      for (const colorScheme of ['light', 'dark']) {
        await page.emulateMedia({ colorScheme });
        await page.waitForFunction(
          (dark) => document.documentElement.classList.contains('dark') === dark,
          colorScheme === 'dark',
        );
        await modelSettings.evaluate(async (element) => {
          await new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          );
          await Promise.all(
            element
              .getAnimations({ subtree: true })
              .filter((animation) => animation.effect?.getTiming().iterations !== Infinity)
              .map((animation) => animation.finished.catch(() => {})),
          );
        });
        console.log(
          'VOXCUE_MODEL_PREVIEW:' +
            (await modelSettings.screenshot({ type: 'jpeg', quality: 80, scale: 'css' })).toString(
              'base64',
            ),
        );
      }
    }
  }
  const formRows = await modelSettings.locator('.speech-setting-row').evaluateAll((rows) =>
    rows.map((row) => ({
      text: row.querySelector('.speech-setting-label').textContent,
      label: row.querySelector('.speech-setting-label').getBoundingClientRect().toJSON(),
      control: row.lastElementChild.getBoundingClientRect().toJSON(),
      row: row.getBoundingClientRect().toJSON(),
    })),
  );
  assert.equal(formRows.length, 3);
  assert.deepEqual(
    formRows.map((row) => row.text),
    ['回答模型', '语音模型', '推理设备'],
  );
  assert.equal(
    await modelSettings
      .getByRole('group', { name: '回答生成', exact: true })
      .locator('.speech-setting-row')
      .count(),
    1,
  );
  assert.equal(
    await modelSettings
      .getByRole('group', { name: '语音识别', exact: true })
      .locator('.speech-setting-row')
      .count(),
    2,
  );
  for (const row of formRows) {
    assert.ok(Math.abs(row.label.left - formRows[0].label.left) < 1);
    assert.ok(Math.abs(row.control.left - formRows[0].control.left) < 1);
    assert.ok(Math.abs(row.control.width - formRows[0].control.width) < 1);
    assert.ok(row.label.right <= row.control.left);
  }
  if (['win32', 'darwin'].includes(process.platform))
    assert.ok(
      await modelSettings
        .locator('.speech-model-notices')
        .evaluate(
          (notice) =>
            notice.getBoundingClientRect().top >=
            notice.previousElementSibling.getBoundingClientRect().bottom,
        ),
    );
  if (['win32', 'darwin'].includes(process.platform)) {
    await device.click();
    await settings
      .getByRole('menuitemradio', {
        name: process.platform === 'darwin' ? 'Metal（推荐）' : 'CUDA（推荐）',
        exact: true,
      })
      .click();
  }
  await settings.getByRole('button', { name: '关闭设置', exact: true }).click();
  if (['win32', 'darwin'].includes(process.platform)) {
    for (const reason of ['unsupported-gpu', 'driver-unavailable', 'driver-outdated']) {
      await app.evaluate((_electron, reason) => {
        globalThis.uiSpeechHardware = { cuda: false, metal: false, reason };
        const service = globalThis.uiComponents;
        const qwen = service.value.items.find((item) => item.id === 'qwen');
        qwen.phase = 'ready';
        qwen.received = qwen.bytes;
        service.publish('ready');
      }, reason);
      await page.getByRole('button', { name: '用户菜单', exact: true }).click();
      await page.getByRole('menuitem', { name: '设置', exact: true }).click();
      await page
        .getByRole('navigation', { name: '设置分类' })
        .getByRole('button', { name: '通用', exact: true })
        .click();
      await settings
        .getByRole('navigation', { name: '设置分类' })
        .getByRole('button', { name: '面试设置', exact: true })
        .click();
      await modelSettings.getByRole('button', { name: '语音识别模型', exact: true }).click();
      await settings.getByRole('menuitemradio', { name: '多语言语音识别', exact: true }).click();
      await device.getByText('CPU', { exact: true }).waitFor();
      await modelSettings.getByRole('alert').filter({ hasText: '转写可能出现明显延迟' }).waitFor();
      assert.equal(await modelSettings.getByText(/当前显卡|NVIDIA 驱动/).count(), 0);
      await page.waitForFunction(
        () =>
          JSON.parse(localStorage.getItem('copilot-interview-settings-v1')).inferenceDevice ===
            'cpu' &&
          JSON.parse(localStorage.getItem('copilot-interview-settings-v1')).speechModel === 'qwen',
      );
      const selectedModel = modelSettings.getByRole('button', {
        name: '语音识别模型',
        exact: true,
      });
      assert.equal(await selectedModel.isEnabled(), true);
      assert.match(await selectedModel.innerText(), /多语言语音识别/);
      await selectedModel.evaluate((element) => element.scrollIntoView({ block: 'end' }));
      await selectedModel.click();
      const popup = settings.getByRole('menu');
      await popup.waitFor();
      await popup.evaluate(async (element) => {
        // Visible starts at the first reveal frame, before Popper has settled
        // and the menu has reached its real rounded bounds.
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        await Promise.all(
          element
            .getAnimations({ subtree: true })
            .filter((animation) => animation.effect?.getTiming().iterations !== Infinity)
            .map((animation) => animation.finished.catch(() => {})),
        );
      });
      const menuBounds = await popup.evaluate((element) => {
        const menu = element.getBoundingClientRect();
        const dialog = element.closest('dialog').getBoundingClientRect();
        return {
          left: menu.left - dialog.left,
          top: menu.top - dialog.top,
          right: dialog.right - menu.right,
          bottom: dialog.bottom - menu.bottom,
          height: menu.height,
        };
      });
      assert.ok(
        menuBounds.height > 40 &&
          ['left', 'top', 'right', 'bottom'].every((edge) => menuBounds[edge] >= 8 - 1 / 64),
        `Dropdown must remain inside the native settings dialog: ${JSON.stringify(menuBounds)}`,
      );
      await page.keyboard.press('Escape');
      await assertDisabledMenu();
      assert.equal(
        await settings
          .getByRole('menuitemradio', {
            name: process.platform === 'darwin' ? 'Metal（推荐）' : 'CUDA（推荐）',
            exact: true,
          })
          .count(),
        0,
      );
      assert.equal(await modelSettings.getByRole('alert').count(), 1);
      if (reason === 'unsupported-gpu') {
        const previewArgument = process.argv.find((argument) =>
          argument.startsWith('--hardware-preview='),
        );
        if (previewArgument) {
          const previewPath = previewArgument.slice('--hardware-preview='.length);
          if (!path.isAbsolute(previewPath)) throw Error('Preview path must be absolute');
          await modelSettings.screenshot({ path: previewPath, scale: 'css' });
          console.log('Synthetic Qwen CPU preview: ' + previewPath);
        }
      }
      await settings.getByRole('button', { name: '关闭设置', exact: true }).click();
      await app.evaluate(() => {
        const service = globalThis.uiComponents;
        const qwen = service.value.items.find((item) => item.id === 'qwen');
        qwen.phase = 'pending';
        qwen.received = 0;
        service.publish('needed');
      });
      await page.waitForFunction(() => {
        const value = JSON.parse(localStorage.getItem('copilot-interview-settings-v1'));
        return value.speechModel === 'paraformer' && value.inferenceDevice === 'cpu';
      });
      await page.getByRole('button', { name: '用户菜单', exact: true }).click();
      await page.getByRole('menuitem', { name: '设置', exact: true }).click();
      await page
        .getByRole('navigation', { name: '设置分类' })
        .getByRole('button', { name: '通用', exact: true })
        .click();
      await settings
        .getByRole('navigation', { name: '设置分类' })
        .getByRole('button', { name: '本地组件', exact: true })
        .click();
      const download = rows
        .filter({ hasText: '多语言语音识别' })
        .getByRole('button', { name: '下载', exact: true });
      assert.equal(await download.isEnabled(), true);
      assert.equal(await settings.getByRole('button', { name: '不支持', exact: true }).count(), 0);
      assert.equal(await settings.getByText(/建议使用 CUDA/).count(), 0);
      if (reason === 'unsupported-gpu') {
        const previewArgument = process.argv.find((argument) =>
          argument.startsWith('--hardware-preview='),
        );
        if (previewArgument)
          await settings.locator('.components-panel').screenshot({
            path: path.join(
              path.dirname(previewArgument.slice('--hardware-preview='.length)),
              'qwen-cpu-components.png',
            ),
            scale: 'css',
          });
      }
      await download.click();
      assert.equal(
        await app.evaluate(
          () => globalThis.uiComponents.value.items.find((item) => item.id === 'qwen').phase,
        ),
        'downloading',
      );
      await app.evaluate(() => globalThis.uiComponents.cancel());
      await settings.getByRole('button', { name: '关闭设置', exact: true }).click();
    }
    await app.evaluate(() => {
      const service = globalThis.uiComponents;
      const qwen = service.value.items.find((item) => item.id === 'qwen');
      qwen.phase = 'ready';
      qwen.received = qwen.bytes;
      service.publish('ready');
    });
    await page.getByRole('button', { name: '用户菜单', exact: true }).click();
    await page.getByRole('menuitem', { name: '设置', exact: true }).click();
    await page
      .getByRole('navigation', { name: '设置分类' })
      .getByRole('button', { name: '通用', exact: true })
      .click();
    await settings
      .getByRole('navigation', { name: '设置分类' })
      .getByRole('button', { name: '面试设置', exact: true })
      .click();
    const selectedSpeech = modelSettings.getByRole('button', { name: '语音识别模型', exact: true });
    assert.match(await selectedSpeech.innerText(), /轻量语音识别/);
    await selectedSpeech.click();
    await settings.getByRole('menuitemradio', { name: '多语言语音识别', exact: true }).click();
    const beforeRemoval = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('copilot-interview-settings-v1')),
    );
    await settings
      .getByRole('navigation', { name: '设置分类' })
      .getByRole('button', { name: '本地组件', exact: true })
      .click();
    const qwenRow = settings.locator('.component-row[data-component-id="qwen"]');
    await qwenRow.getByRole('button', { name: '删除：多语言语音识别', exact: true }).click();
    await qwenRow.getByRole('button', { name: '确认删除：多语言语音识别', exact: true }).click();
    await qwenRow.getByRole('button', { name: '下载', exact: true }).waitFor();
    await page.waitForFunction(() => {
      const value = JSON.parse(localStorage.getItem('copilot-interview-settings-v1'));
      return value.speechModel === 'paraformer' && value.inferenceDevice === 'cpu';
    });
    assert.deepEqual(
      await page.evaluate(() => JSON.parse(localStorage.getItem('copilot-interview-settings-v1'))),
      { ...beforeRemoval, speechModel: 'paraformer', inferenceDevice: 'cpu' },
    );
    await settings
      .getByRole('navigation', { name: '设置分类' })
      .getByRole('button', { name: '面试设置', exact: true })
      .click();
    await selectedSpeech.getByText('轻量语音识别', { exact: true }).waitFor();
    await assertDisabledMenu();
    await settings.getByRole('button', { name: '关闭设置', exact: true }).click();
    await page.reload();
    await page.getByRole('textbox', { name: '聊天消息', exact: true }).waitFor();
    await page.getByRole('button', { name: '用户菜单', exact: true }).click();
    await page.getByRole('menuitem', { name: '设置', exact: true }).click();
    await page
      .getByRole('navigation', { name: '设置分类' })
      .getByRole('button', { name: '通用', exact: true })
      .click();
    await settings
      .getByRole('navigation', { name: '设置分类' })
      .getByRole('button', { name: '面试设置', exact: true })
      .click();
    await selectedSpeech.getByText('轻量语音识别', { exact: true }).waitFor();
    assert.equal(await device.isDisabled(), true);
    await settings.getByRole('button', { name: '关闭设置', exact: true }).click();
    await app.evaluate(() => {
      const service = globalThis.uiComponents;
      for (const item of service.value.items) {
        item.phase = 'ready';
        item.received = item.bytes;
      }
      service.publish('ready');
    });
    await page.getByRole('button', { name: '用户菜单', exact: true }).click();
    await page.getByRole('menuitem', { name: '设置', exact: true }).click();
    await page
      .getByRole('navigation', { name: '设置分类' })
      .getByRole('button', { name: '通用', exact: true })
      .click();
    await settings
      .getByRole('navigation', { name: '设置分类' })
      .getByRole('button', { name: '本地组件', exact: true })
      .click();
    const paraformerRow = settings.locator('.component-row[data-component-id="speech"]');
    await paraformerRow.getByRole('button', { name: '删除：轻量语音识别', exact: true }).click();
    await paraformerRow
      .getByRole('button', { name: '确认删除：轻量语音识别', exact: true })
      .click();
    await paraformerRow.getByRole('button', { name: '下载', exact: true }).waitFor();
    await page.waitForFunction(() => {
      const value = JSON.parse(localStorage.getItem('copilot-interview-settings-v1'));
      return value.speechModel === 'qwen' && value.inferenceDevice === 'cpu';
    });
    await settings.getByRole('button', { name: '关闭设置', exact: true }).click();
    assert.equal(await page.getByLabel('本地组件提示', { exact: true }).count(), 0);
    await page
      .getByLabel('语音推理性能提示', { exact: true })
      .getByText('多语言语音识别性能受限', { exact: true })
      .waitFor();
    assert.equal(await page.locator('.interview-start-trigger').isEnabled(), true);
    if (process.argv.includes('--readiness-preview'))
      console.log(
        'VOXCUE_READINESS_PREVIEW:' +
          (await page.screenshot({ type: 'jpeg', quality: 65, scale: 'css' })).toString('base64'),
      );
    await page
      .getByLabel('语音推理性能提示', { exact: true })
      .getByRole('button', { name: '前往设置', exact: true })
      .click();
    await modelSettings.waitFor();
    assert.equal(
      await settings
        .getByRole('navigation', { name: '设置分类' })
        .getByRole('button', { name: '面试设置', exact: true })
        .getAttribute('aria-current'),
      'page',
    );
    await settings.getByRole('button', { name: '关闭设置', exact: true }).click();
    await page.reload();
    await page.getByLabel('语音推理性能提示', { exact: true }).waitFor();
    assert.equal(await page.getByLabel('本地组件提示', { exact: true }).count(), 0);
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('button', { name: '个人信息', exact: true }).click();
  assert.equal(
    await page.locator('.personal-panel').evaluate((el) => el.getAnimations().length),
    0,
  );
  await page.getByRole('button', { name: '个人信息', exact: true }).click();
  assert.deepEqual(errors, []);
  console.log(
    modelsOnly
      ? 'PASS: grouped models, unavailable model selection, disabled pointer/keyboard menus, Qwen download and CPU selection without CUDA, CPU performance warning and hidden CUDA. Synthetic accounts and device states only.'
      : 'PASS: independent model labels, animated download width, red icon cancellation, component spacing, light/dark delete confirmation/cancellation and download restoration, responsive personal panel/chat animation, focus and reduced motion. Synthetic component operations only.',
  );
} finally {
  if (app) await closeUiApp(app);
}
