import { testRoot, electron } from './test-workspace.mjs';
import { installUiAccount, closeUiApp } from './install-ui-account.mjs';
import { assertInitialDownloadProgress, assertDownloadButton } from './assert-download-button.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

for (const name of ['profile', 'tmp', 'home'])
  await mkdir(path.join(testRoot, name), { recursive: true });
const fixture = path.join(testRoot, 'components-ui.cjs');
await writeFile(
  fixture,
  `
const {app}=require('electron');
app.setAppPath(${JSON.stringify(process.cwd())});
const service=require(${JSON.stringify(path.resolve('dist-electron/shared/electron/backend/components/service.js'))});
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
const assertAnimated = (widths, label) => {
  const start = widths[0],
    end = widths.at(-1);
  assert.ok(Math.abs(start - end) > 10, `${label}: width must change`);
  assert.ok(
    widths.some((width) => width > Math.min(start, end) + 2 && width < Math.max(start, end) - 2),
    `${label}: needs intermediate widths: ${JSON.stringify(widths)}`,
  );
};
try {
  app = await electron.launch({ args: [fixture], env });
  const login = await app.firstWindow();
  await login.getByRole('button', { name: '使用 ChatGPT 继续', exact: true }).waitFor();
  await installUiAccount(app);
  const [page] = await Promise.all([
    app.waitForEvent('window'),
    login.getByRole('button', { name: '使用 ChatGPT 继续', exact: true }).click(),
  ]);
  page.setDefaultTimeout(15000);
  const errors = [];
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.locator('.chat-column > .components-notice').waitFor();
  for (const width of [1400, 1080, 960]) {
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
          .querySelector(
            open ? 'button[aria-label="个人信息"]' : 'button[aria-label="关闭个人信息"]',
          )
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
  const settings = page.getByRole('dialog', { name: '设置', exact: true });
  await settings
    .getByRole('navigation', { name: '设置分类' })
    .getByRole('button', { name: '本地组件', exact: true })
    .click();
  const rows = settings.locator('.component-row');
  const panelGap = await settings.evaluate(
    (dialog) =>
      dialog.querySelector('.components-panel').getBoundingClientRect().top -
      dialog.querySelector('.settings-content-heading').getBoundingClientRect().bottom,
  );
  assert.ok(panelGap >= 16, 'Component card must clear the heading separator');
  for (const index of [0, 1]) {
    const row = rows.nth(index),
      other = rows.nth(1 - index);
    await row.getByRole('button', { name: '下载', exact: true }).hover();
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
                  animation.playState === 'running',
              ).length,
        ),
      0,
      'width transition finishes while progress continues',
    );
    assert.equal(await other.getByRole('button', { name: '下载', exact: true }).isDisabled(), true);
    assert.equal(await other.getByText(/尚未下载/).isVisible(), true);
    assert.equal(await settings.getByText('准备中…', { exact: true }).count(), 0);
    const progress = row.locator('.download-button');
    await assertInitialDownloadProgress(progress);
    await assertDownloadButton(page, progress);
    if (index === 0 && process.argv.includes('--preview')) {
      // Keep cancellation visible while screenshot clipping adjusts the viewport.
      await page.keyboard.press('Tab');
      await progress.focus();
      await progress.locator('.download-button-cancel').waitFor({ state: 'visible' });
      await progress.evaluate((element) =>
        Promise.all(element.getAnimations().map((animation) => animation.finished.catch(() => {}))),
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
    assert.equal(await other.getByRole('button', { name: '下载', exact: true }).isEnabled(), true);
  }
  await app.evaluate(() => {
    const service = globalThis.uiComponents;
    for (const item of service.value.items) {
      item.phase = 'ready';
      item.received = item.bytes;
    }
    service.publish('ready');
  });
  await rows.getByText('已就绪', { exact: true }).first().waitFor();
  for (const colorScheme of ['dark', 'light']) {
    await page.emulateMedia({ colorScheme });
    await page.waitForFunction(
      (dark) => document.documentElement.classList.contains('dark') === dark,
      colorScheme === 'dark',
    );
    assert.equal(
      await settings.locator('.components-panel').evaluate(
        (panel) =>
          panel.scrollWidth <= panel.clientWidth &&
          [...panel.querySelectorAll('.component-row')].every((row) => {
            const rect = row.getBoundingClientRect();
            const action = row.querySelector('.component-ready-actions').getBoundingClientRect();
            return action.left >= rect.left && action.right <= rect.right;
          }),
      ),
      true,
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
  for (const index of [0, 1]) {
    const row = rows.nth(index),
      other = rows.nth(1 - index);
    const label = await row.locator('strong').innerText();
    const remove = row.getByRole('button', { name: '删除：' + label, exact: true });
    await remove.click();
    assert.equal(await app.evaluate(() => globalThis.uiComponents.removedId), undefined);
    await page.keyboard.press('Escape');
    await remove.waitFor();
    await remove.click();
    const otherReady = await other.getByText('已就绪', { exact: true }).count();
    await row.getByRole('button', { name: '确认删除：' + label, exact: true }).click();
    await row.getByRole('button', { name: '下载', exact: true }).waitFor();
    assert.equal(
      await app.evaluate(() => globalThis.uiComponents.removedId),
      index === 0 ? 'speech' : 'rag',
    );
    assert.equal(await other.getByText('已就绪', { exact: true }).count(), otherReady);
    await app.evaluate(() => {
      globalThis.uiComponents.removedId = undefined;
    });
  }
  await settings.getByRole('button', { name: '关闭设置', exact: true }).click();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('button', { name: '个人信息', exact: true }).click();
  assert.equal(
    await page.locator('.personal-panel').evaluate((el) => el.getAnimations().length),
    0,
  );
  await page.getByRole('button', { name: '关闭个人信息', exact: true }).click();
  assert.deepEqual(errors, []);
  console.log(
    'PASS: independent model labels, animated download width, red icon cancellation, component spacing, light/dark delete confirmation/cancellation and download restoration, responsive personal panel/chat animation, focus and reduced motion. Synthetic component operations only.',
  );
} finally {
  if (app) await closeUiApp(app);
}
