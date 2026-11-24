import { evaluateHistory } from './stored-history-fixture.mjs';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import * as fs from 'node:fs/promises';
import { testRoot, electron } from './test-workspace.mjs';
import { offlineElectronEntry } from './offline-electron-entry.mjs';
import { closeUiApp } from './install-ui-account.mjs';
import { captureRequested } from './capture-requested.mjs';
import { assertPasswordVisibility, assertPasswordClearedOnClose } from './assert-password-visibility.mjs';
import workspace from '../../scripts/workspace.mjs';
import { Store, Auth, Services, loadConfig, createApi, routes } from './server-reference.mjs';
const dir = path.join(testRoot, 'account-erasure');
await fs.mkdir(dir);
const syntheticDialog = process.argv.includes('--synthetic-dialog');
const macNativeDialog = process.platform === 'darwin' && process.argv.includes('--native-dialog');
assert.ok(!macNativeDialog || !syntheticDialog, 'Native and synthetic dialog modes are exclusive');
const profile = path.join(dir, 'profile'),
  zip = path.join(dir, macNativeDialog ? 'VoxCue资料.zip' : '用户选择的资料.zip');
const config = loadConfig({
  AUTH_KEY: 'cd'.repeat(32),
  DATABASE_FILE: path.join(dir, 'accounts.sqlite'),
  FEATURE_BACKUPS: '1',
});
const store = new Store(config.database),
  auth = new Auth(store, config, true),
  services = new Services(auth);
const user = {
  id: randomUUID(),
  email: 'erase-synthetic@example.test',
  password_hash: await auth.passwords.hash('Synthetic erase pass8!'),
  created_at: Date.now(),
};
store.addUser(user);
await services.start();
const api = createApi(auth, () => {}, routes(services));
api.server.listen(0, '127.0.0.1');
await once(api.server, 'listening');
const port = api.server.address().port,
  fixture = path.join(dir, 'fixture.cjs');
await fs.writeFile(
  fixture,
  `
const {app,safeStorage,dialog}=require('electron'),path=require('node:path'),fs=require('node:fs');const root=${JSON.stringify(workspace.platformRoot)};app.setAppPath(root);app.commandLine.appendSwitch('use-mock-keychain');app.setPath('documents',${JSON.stringify(dir)});
if(${syntheticDialog})app.on('browser-window-created',(_event,window)=>{window.webContents.setBackgroundThrottling(false);window.once('ready-to-show',()=>setImmediate(()=>window.hide()));});
const save=dialog.showSaveDialog.bind(dialog);let saveCount=0;dialog.showSaveDialog=(...args)=>{if(args.at(-1)?.title==='导出资料'){if(${macNativeDialog}&&args.at(-1).defaultPath!==${JSON.stringify(zip)})throw Error('Native fixture requires its owned default ZIP path');fs.writeFileSync(path.join(app.getPath('userData'),'native-save-count'),String(++saveCount));}return save(...args).then(result=>{if(${macNativeDialog}&&!result.canceled&&path.join(fs.realpathSync(path.dirname(result.filePath)),path.basename(result.filePath))!==${JSON.stringify(zip)})throw Error('Native fixture only accepts its owned synthetic ZIP target');fs.writeFileSync(path.join(app.getPath('userData'),'native-save-result'),String(result.canceled));return result;});};
const base=path.join(root,'dist-electron/shared/electron');
for(const [module,name]of [['backend/auth/service.js','ChatGPTAuthService'],['backend/copilot/auth.js','CopilotAuthService']]){const C=require(path.join(base,module))[name];C.prototype.session=async()=>null;C.prototype.signOut=async()=>({warning:null});}
if(process.platform==='darwin'){const c=require(path.join(root,'dist-electron/macos/electron/credentials.js'));c.createCredentialEncryption=()=>({encrypt:v=>safeStorage.encryptString(v),decrypt:v=>safeStorage.decryptString(v)});}
app.relaunch=()=>{};
require(path.join(base,'main.js'));
`,
);
let app;
const errors = [];
let expectedSave = 0;
async function uiClick(locator) {
  if (syntheticDialog)
    await locator.evaluate((node) => {
      if (node.getAttribute('aria-haspopup') === 'menu') {
        node.dispatchEvent(
          new PointerEvent('pointerdown', {
            button: 0,
            buttons: 1,
            pointerType: 'mouse',
            bubbles: true,
          }),
        );
        node.dispatchEvent(
          new PointerEvent('pointerup', {
            button: 0,
            buttons: 0,
            pointerType: 'mouse',
            bubbles: true,
          }),
        );
      } else node.click();
    });
  else await locator.click();
}
async function captureAccount(page, name) {
  if (!syntheticDialog) return captureRequested(page, name);
  if (!process.argv.some((arg) => arg.startsWith('--screenshots='))) return;
  if (process.platform === 'win32') {
    const { probe } = await import('../../../windows/test/scripts/window-probe.mjs');
    assert.equal(probe('desktop').interactive, true);
  }
  const window = await app.browserWindow(page);
  await window.evaluate((window) => window.showInactive());
  try {
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
    await captureRequested(page, name, { animations: 'allow' });
  } finally {
    await window.evaluate((window) => window.hide());
  }
}
async function nativeDialog(cancel) {
  const expected = String(++expectedSave),
    deadline = Date.now() + 10000;
  while (
    (await fs.readFile(path.join(profile, 'native-save-count'), 'utf8').catch(() => null)) !==
    expected
  ) {
    if (Date.now() > deadline) {
      console.error(
        'SAVE_UI_ALERTS',
        await app.windows().at(-1).getByRole('alert').allTextContents(),
      );
      throw Error('Native showSaveDialog was not reached');
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  const { probe } = await import('../../../windows/test/scripts/window-probe.mjs');
  assert.equal(probe('desktop').interactive, true);
  const actualPid = await app.evaluate(() => process.pid);
  const handle = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((w) => !w.isDestroyed())
      .getNativeWindowHandle()
      .readBigUInt64LE()
      .toString(),
  );
  const pictures = process.argv.find((a) => a.startsWith('--screenshots='))?.slice(14);
  const outcome = probe(
    'save-dialog',
    actualPid,
    cancel ? 'cancel' : zip,
    handle,
    ...(pictures ? [path.join(pictures, cancel ? 'native-cancel.png' : 'native-save.png')] : []),
  );
  assert.equal(outcome.nativeSaveDialog, true);
  assert.equal(outcome.title, '导出资料');
  console.log(
    'PASS owned Windows native save dialog: ' + (cancel ? 'cancel' : 'selected ZIP path'),
  );
}
try {
  app = await electron.launch({
    args: [await offlineElectronEntry(fixture, { loopbackPort: port })],
    env: {
      ...process.env,
      COPILOT_TEST_USER_DATA: profile,
      VOXCUE_ACCOUNT_API: `http://127.0.0.1:${port}`,
      VOXCUE_ACCOUNT_ALLOW_LOCAL: '1',
      VITE_DEV_SERVER_URL: '',
      ELECTRON_RUN_AS_NODE: undefined,
    },
  });
  const login = await app.firstWindow();
  await login.getByLabel('邮箱', { exact: true }).fill(user.email);
  await login.getByLabel('密码', { exact: true }).fill('Synthetic erase pass8!');
  const opened = app.waitForEvent('window');
  void opened.catch(() => {});
  await uiClick(login.getByRole('button', { name: '登录', exact: true }));
  const main = await opened;
  main.on('pageerror', (e) => errors.push(e.message));
  await main.getByRole('button', { name: '用户菜单', exact: true }).waitFor();
  await evaluateHistory(main, async () => {
    localStorage.setItem(
      'copilot-personal-info-v1',
      JSON.stringify({ name: '合成用户', background: '合成经历', jobDescription: '合成岗位' }),
    );
    await fixtureHistory.replace([
      {
        id: 'synthetic-record',
        title: '合成面试',
        startedAt: 1,
        endedAt: 2,
        status: 'ended',
        transcripts: [
          { id: 't', text: '合成转录', time: '00:01', final: true, source: 'system' },
        ],
        answers: [],
        mock: true,
      },
    ]);
    await new Promise((resolve, reject) => {
      const r = indexedDB.open('copilot-local-documents');
      r.onupgradeneeded = () => {
        r.result.createObjectStore('bases', { keyPath: 'id' });
        const d = r.result.createObjectStore('documents', { keyPath: 'id' });
        d.createIndex('baseId', 'baseId');
      };
      r.onerror = reject;
      r.onsuccess = () => {
        const db = r.result,
          tx = db.transaction(['bases', 'documents'], 'readwrite');
        tx.objectStore('bases').put({ id: 'synthetic-base', name: '合成库', createdAt: 1 });
        tx.objectStore('documents').put({
          id: 'synthetic-doc',
          baseId: 'synthetic-base',
          name: '合成原件.txt',
          blob: new Blob(['原件 bytes']),
          size: 12,
          type: 'text/plain',
          createdAt: 1,
        });
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = reject;
      };
    });
  });
  await main.reload();
  await uiClick(main.getByRole('button', { name: '用户菜单', exact: true }));
  await uiClick(main.getByRole('menuitem', { name: '设置', exact: true }));
  const settings = main.getByRole('dialog', { name: '设置', exact: true });
  await uiClick(settings.getByRole('button', { name: 'VoxCue 账号', exact: true }));
  assert.equal(await settings.getByRole('button', { name: '云同步', exact: true }).count(), 0);
  await settings.getByRole('switch', { name: '同步知识库', exact: true }).waitFor();
  const order = await settings.evaluate((node) => ({
    sync: node.querySelector('.cloud-sync-actions').getBoundingClientRect().bottom,
    import: node.querySelector('[aria-label="数据迁移"]').getBoundingClientRect().top,
    importBottom: node.querySelector('[aria-label="数据迁移"]').getBoundingClientRect().bottom,
    export: node.querySelector('[aria-label="导出资料"]').getBoundingClientRect().top,
    exportBottom: node.querySelector('[aria-label="导出资料"]').getBoundingClientRect().bottom,
    remove: node.querySelector('.account-deletion-panel').getBoundingClientRect().top,
  }));
  // Fractional display scales expose float32 rect noise at a shared edge.
  const layoutUnit = (value) => Math.round(value * 64);
  assert.ok(
    layoutUnit(order.import) >= layoutUnit(order.sync) &&
      layoutUnit(order.export) >= layoutUnit(order.importBottom) &&
      layoutUnit(order.remove) >= layoutUnit(order.exportBottom),
    'Migration and export follow cloud backup and precede deletion: ' + JSON.stringify(order),
  );
  // Let the scroll body's ResizeObserver publish its gutter before sampling the edges.
  await settings.locator('.settings-content-body').evaluate(() =>
    new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  const syncAlignment = await settings.locator('.cloud-sync-actions').evaluate((node) => {
    const box = node.getBoundingClientRect();
    const buttons = [...node.querySelectorAll(':scope > button')].map((button) =>
      button.getBoundingClientRect(),
    );
    const first = buttons[0],
      last = buttons.at(-1);
    const body = node.closest('.settings-content-body');
    const panel = body.getBoundingClientRect();
    const switches = [...body.querySelectorAll('.settings-switch')];
    const edge = switches.at(-1).getBoundingClientRect().right;
    // DOMRect float noise can straddle a device-pixel midpoint for one layout edge.
    const deviceEdge = x => Math.round((Math.round(x * 64) / 64) * devicePixelRatio);
    const style = getComputedStyle(body);
    const reservedScrollbar = parseFloat(style.getPropertyValue('--panel-scrollbar-width')) || 0;
    const rightBorder = parseFloat(style.borderRightWidth) || 0;
    return {
      buttons: buttons.length,
      rightGap: box.right - last.right,
      commonRight: last.right - edge,
      buttonGap: last.left - first.right,
      centers: Math.abs(first.top + first.height / 2 - last.top - last.height / 2),
      leftInset: box.left - panel.left,
      rightInset: panel.right - last.right,
      drawnEdges: [deviceEdge(box.left), deviceEdge(last.right)],
      // clientWidth rounds fractional CSS widths before device-pixel conversion.
      // Keep the parent's fractional edge through the same conversion as the child.
      expectedEdges: [deviceEdge(panel.left + body.clientLeft + 24),
        deviceEdge(panel.right - rightBorder - reservedScrollbar - Math.max(0, 24 - reservedScrollbar))],
    };
  });
  assert.equal(syncAlignment.buttons, 2);
  assert.ok(
    layoutUnit(syncAlignment.rightGap) === 0 &&
      layoutUnit(syncAlignment.commonRight) === 0 &&
      layoutUnit(syncAlignment.buttonGap) === layoutUnit(8) &&
      layoutUnit(syncAlignment.centers) === 0 &&
      layoutUnit(syncAlignment.leftInset) === layoutUnit(24) &&
      layoutUnit(syncAlignment.rightInset) === layoutUnit(24),
    'Sync actions share the settings right edge and 24px content insets, with one aligned row and an 8px gap: ' +
      JSON.stringify(syncAlignment),
  );
  assert.deepEqual(syncAlignment.drawnEdges, syncAlignment.expectedEdges,
    'The two content edges must fall on the exact device pixels for 24px insets: ' + JSON.stringify(syncAlignment));
  for (const dark of [false, true]) {
    await main.evaluate((v) => document.documentElement.classList.toggle('dark', v), dark);
    await captureAccount(main, 'account-sync-' + (dark ? 'dark' : 'light'));
  }
  await settings.getByRole('button', { name: '删除账号', exact: true }).scrollIntoViewIfNeeded();
  await captureAccount(main, 'account-delete-section');
  await uiClick(settings.getByRole('button', { name: '删除账号', exact: true }));
  const modal = main.getByRole('dialog', { name: '删除 VoxCue 账号', exact: true }),
    confirm = modal.getByRole('button', { name: '永久删除账号', exact: true });
  assert.equal(await confirm.isDisabled(), true);
  assert.equal(await modal.getByText(/后台仅保留邮箱|其他设备副本/).count(), 0);
  assert.equal(await modal.getByRole('button', { name: '导出资料', exact: true }).count(), 0);
  assert.equal(
    await modal
      .getByRole('button')
      .filter({ has: main.locator('svg') })
      .count(),
    4,
  );
  const alignment = await modal
    .locator('.modal-footer')
    .evaluate((e) => getComputedStyle(e).justifyContent);
  assert.equal(alignment, 'flex-end');
  const footerGeometry = await modal.locator('.modal-footer').evaluate((node) => {
    const dialog = node.closest('dialog');
    const box = dialog.getBoundingClientRect();
    const style = getComputedStyle(dialog),
      footer = getComputedStyle(node);
    const buttons = [...node.querySelectorAll(':scope > button')].map((button) =>
      button.getBoundingClientRect(),
    );
    const first = buttons[0],
      last = buttons.at(-1);
    return {
      rightInset: box.right - parseFloat(style.borderRightWidth) - last.right,
      paddingLeft: parseFloat(footer.paddingLeft),
      paddingRight: parseFloat(footer.paddingRight),
      buttonGap: last.left - first.right,
      centers: Math.abs(first.top + first.height / 2 - last.top - last.height / 2),
    };
  });
  assert.ok(
    layoutUnit(footerGeometry.rightInset) === layoutUnit(24) &&
      layoutUnit(footerGeometry.paddingLeft) === layoutUnit(24) &&
      layoutUnit(footerGeometry.paddingRight) === layoutUnit(24) &&
      layoutUnit(footerGeometry.buttonGap) === layoutUnit(12) &&
      layoutUnit(footerGeometry.centers) === 0,
    'Delete actions remain right-aligned at the shared 24px insets and retain their 12px gap: ' +
      JSON.stringify(footerGeometry),
  );
  const checkAlignment = await modal.locator('.account-delete-ack').evaluate((node) => {
    const a = node.querySelector('input').getBoundingClientRect(),
      b = node.querySelector('span').getBoundingClientRect();
    return Math.abs((a.top + a.bottom) / 2 - (b.top + b.bottom) / 2);
  });
  assert.ok(checkAlignment <= 1, 'Checkbox and label share their center line');
  const titleLayout = await modal.locator('.dialog-title').evaluate((node) => {
    const icon = node.querySelector('.danger-icon').getBoundingClientRect();
    const title = node.querySelector('h2').getBoundingClientRect();
    return {
      gap: title.left - icon.right,
      center: icon.top + icon.height / 2 - title.top - title.height / 2,
    };
  });
  assert.ok(
    Math.abs(titleLayout.gap - 12) <= 1 / 64 && Math.abs(titleLayout.center) <= 1,
    'Delete icon precedes and aligns with its title: ' + JSON.stringify(titleLayout),
  );
  const acknowledgement = modal.getByRole('checkbox');
  await main.emulateMedia({ reducedMotion: 'no-preference' });
  for (const dark of [false, true]) {
    await main.evaluate((dark) => document.documentElement.classList.toggle('dark', dark), dark);
    const motion = await acknowledgement.evaluate(async (node) => {
      const probe = document.createElement('span');
      probe.style.color = 'var(--danger)';
      node.parentElement.append(probe);
      const danger = getComputedStyle(probe).color;
      probe.remove();
      const read = () => {
        const style = getComputedStyle(node, '::before');
        return {
          opacity: Number(style.opacity),
          clip: style.clipPath,
          color: style.maskImage === 'none' ? style.borderBottomColor : style.backgroundColor,
        };
      };
      const directions = [];
      for (let i = 0; i < 2; i++) {
        await Promise.all(
          node
            .getAnimations({ subtree: true })
            .map((animation) => animation.finished.catch(() => {})),
        );
        const from = read();
        node.click();
        getComputedStyle(node).backgroundColor;
        await new Promise(requestAnimationFrame);
        const animations = node.getAnimations({ subtree: true });
        for (const animation of animations) {
          animation.pause();
          const timing = animation.effect.getTiming();
          animation.currentTime = timing.delay + Number(timing.duration) / 2;
        }
        const middle = read();
        for (const animation of animations) animation.finish();
        directions.push({ from, middle, to: read(), animations: animations.length });
      }
      return { danger, directions };
    });
    for (const { from, middle, to, animations } of motion.directions) {
      assert.ok(animations > 0);
      assert.deepEqual([from.opacity, to.opacity].sort(), [0, 1]);
      assert.ok(middle.opacity > 0 && middle.opacity < 1);
      assert.notEqual(middle.clip, from.clip);
      assert.notEqual(middle.clip, to.clip);
      assert.equal(to.color, motion.danger, 'The check mark uses the danger red in both themes');
    }
    await acknowledgement.focus();
    await main.keyboard.press('Space');
    assert.equal(await acknowledgement.isChecked(), true);
    assert.equal(
      await confirm.isDisabled(),
      true,
      'Acknowledgement without a password cannot delete',
    );
    await captureAccount(main, 'account-delete-checked-' + (dark ? 'dark' : 'light'));
    await main.keyboard.press('Space');
    assert.equal(await acknowledgement.isChecked(), false);
  }
  await main.emulateMedia({ reducedMotion: 'reduce' });
  await acknowledgement.focus();
  await main.keyboard.press('Space');
  const reducedMark = await acknowledgement.evaluate((node) => ({
    opacity: getComputedStyle(node, '::before').opacity,
    transition: getComputedStyle(node, '::before').transitionDuration,
  }));
  assert.deepEqual(reducedMark, { opacity: '1', transition: '0s' });
  await main.keyboard.press('Space');
  await main.emulateMedia({ reducedMotion: 'no-preference' });
  await captureAccount(main, 'account-delete-confirm');
  const password = modal.getByLabel('删除账号密码', { exact: true });
  await assertPasswordVisibility(modal, password, 'Synthetic erase pass8!');
  assert.ok(await confirm.isDisabled(), 'A password alone must not authorize account deletion');
  await assertPasswordClearedOnClose(modal, password, () =>
    uiClick(modal.getByRole('button', { name: '取消', exact: true })));
  const exportPanel = settings.getByRole('region', { name: '导出资料', exact: true });
  if (macNativeDialog) {
    const { nativeSaveDialog } = await import('../../../macos/test/scripts/save-dialog.mjs');
    await uiClick(exportPanel.getByRole('button', { name: '导出资料', exact: true }));
    await nativeSaveDialog(app, { cancel: true, target: zip });
    await main.waitForFunction(
      () => !document.querySelector('.account-export-panel button')?.disabled,
    );
    assert.equal(await exportPanel.getByRole('status').count(), 0);
    assert.ok(store.user(user.email));
    await uiClick(exportPanel.getByRole('button', { name: '导出资料', exact: true }));
    await nativeSaveDialog(app, { cancel: false, target: zip });
    await exportPanel.getByRole('status').filter({ hasText: '资料已导出' }).waitFor();
    await uiClick(exportPanel.getByRole('button', { name: '导出资料', exact: true }));
    await nativeSaveDialog(app, { cancel: false, target: zip, overwrite: true });
  } else if (process.platform === 'win32' && !syntheticDialog) {
    await uiClick(exportPanel.getByRole('button', { name: '导出资料', exact: true }));
    await nativeDialog(true);
    await main.waitForFunction(
      () => !document.querySelector('.account-export-panel button')?.disabled,
    );
    assert.equal(await exportPanel.getByRole('status').count(), 0);
    assert.ok(store.user(user.email));
    await uiClick(exportPanel.getByRole('button', { name: '导出资料', exact: true }));
    await nativeDialog(false);
  } else {
    const exportButton = exportPanel.getByRole('button', { name: '导出资料', exact: true });
    if (process.platform === 'darwin' && !syntheticDialog) {
      const { nativeSaveDialog } = await import('../../../macos/test/scripts/save-dialog.mjs');
      await uiClick(exportButton);
      await nativeSaveDialog(app, { cancel: true, target: zip });
    } else {
      await app.evaluate(({ dialog }) => { dialog.showSaveDialog = async () => ({ canceled: true }); });
      await uiClick(exportButton);
    }
    await main.waitForFunction(
      () => !document.querySelector('.account-export-panel button')?.disabled,
    );
    assert.equal(await exportPanel.getByRole('status').count(), 0);
    assert.ok(store.user(user.email));
    await app.evaluate(({ dialog }, filePath) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath });
    }, zip);
    await uiClick(exportButton);
  }
  await exportPanel.getByRole('status').filter({ hasText: '资料已导出' }).waitFor();
  assert.ok((await fs.stat(zip)).size > 100);
  const AdmZip = workspace.platformRequire('adm-zip');
  const z = new AdmZip(zip);
  if (macNativeDialog)
    assert.deepEqual(
      [...new Set(z.getEntries().map((entry) => entry.entryName.split('/')[0]))].sort(),
      ['个人信息', '面试记录', '知识库'].sort(),
      'The native saved ditto ZIP must contain exactly the three requested roots',
    );
  assert.ok(z.readAsText('个人信息/个人信息.txt').includes('合成用户'));
  assert.ok(
    z
      .getEntries()
      .some((e) => e.entryName.endsWith('合成原件.txt') && e.getData().toString() === '原件 bytes'),
  );
  assert.ok(
    z
      .getEntries()
      .some((e) => e.entryName.endsWith('.txt') && e.getData().toString().includes('合成转录')),
  );
  await uiClick(settings.getByRole('button', { name: '删除账号', exact: true }));
  assert.equal(await password.getAttribute('type'), 'password');
  assert.equal(await password.inputValue(), '');
  assert.equal(await modal.getByRole('button', { name: '显示密码', exact: true }).getAttribute('aria-pressed'), 'false');
  assert.ok(await confirm.isDisabled());
  await password.fill('wrong');
  await uiClick(modal.getByRole('checkbox'));
  await uiClick(confirm);
  await modal.getByRole('alert').filter({ hasText: '邮箱或密码不正确。' }).waitFor();
  assert.ok(store.user(user.email));
  const status = await main.waitForFunction(async () => {
    const result = await window.desktop.cloudAccount({ action: 'status' });
    if (!result.ok && result.retryAfterSeconds === 1 &&
        result.error === '账号操作正在进行，请稍后重试。') return false;
    return result;
  }, undefined, { polling: 100 });
  const state = await status.jsonValue();
  await status.dispose();
  assert.equal(state.ok, true, state.error);
  assert.equal(state.state.user.id, user.id);
  await fs.mkdir(path.join(profile, 'component-cache'), { recursive: true });
  await fs.writeFile(path.join(profile, 'component-cache', 'public-synthetic-model'), 'keep');
  const accountFolder = (id) => createHash('sha256').update('account:' + id).digest('hex');
  const removedProfile = path.join(profile, 'account-profiles', accountFolder(user.id));
  const otherProfile = path.join(profile, 'account-profiles', accountFolder(randomUUID()));
  const otherFile = path.join(otherProfile, 'synthetic.txt');
  await fs.mkdir(removedProfile, { recursive: true });
  await fs.writeFile(path.join(removedProfile, 'synthetic.txt'), 'delete');
  await fs.mkdir(otherProfile, { recursive: true });
  await fs.writeFile(otherFile, 'keep');
  await modal.getByLabel('删除账号密码', { exact: true }).fill('Synthetic erase pass8!');
  const exited = once(app.process(), 'exit');
  await uiClick(confirm).catch((e) => {
    if (!/closed/i.test(e.message)) throw e;
  });
  await exited;
  app = undefined;
  assert.equal(store.user(user.email), undefined);
  assert.equal(store.query('SELECT * FROM users WHERE id=?', user.id), undefined);
  assert.equal(
    store.query('SELECT email FROM closed_accounts WHERE id=?', user.id).email,
    user.email,
  );
  for (const target of [
    path.relative(profile, removedProfile),
    'cloud-account',
    'account-erasure.pending',
  ])
    assert.equal(await fs.stat(path.join(profile, target)).catch(() => null), null, target);
  assert.equal(await fs.readFile(otherFile, 'utf8'), 'keep');
  assert.equal(
    await fs.readFile(path.join(profile, 'component-cache', 'public-synthetic-model'), 'utf8'),
    'keep',
  );
  assert.ok((await fs.stat(zip)).size > 100);
  app = await electron.launch({
    args: [await offlineElectronEntry(fixture, { loopbackPort: port })],
    env: {
      ...process.env,
      COPILOT_TEST_USER_DATA: profile,
      VOXCUE_ACCOUNT_API: `http://127.0.0.1:${port}`,
      VOXCUE_ACCOUNT_ALLOW_LOCAL: '1',
      VITE_DEV_SERVER_URL: '',
      ELECTRON_RUN_AS_NODE: undefined,
    },
  });
  const fresh = await app.firstWindow();
  await fresh.getByRole('heading', { name: '登录 VoxCue', exact: true }).waitFor();
  assert.deepEqual(
    await fresh.evaluate(async () => ({
      personal: localStorage.getItem('copilot-personal-info-v1'),
      history: localStorage.getItem('copilot-interview-history-v1'),
      databases: (await indexedDB.databases())
        .map((d) => d.name)
        .filter((name) =>
          [
            'copilot-local-documents',
            'voxcue-preparation-chats',
            'voxcue-original-backups',
            'voxcue-cloud-sync',
          ].includes(name),
        ),
    })),
    { personal: null, history: null, databases: [] },
  );
  assert.deepEqual(errors, []);
  console.log(
    'PASS account renderer/API: account + sync layout, disclosed closure record, ' +
      (syntheticDialog ? 'synthetic save-dialog port' : process.platform === 'darwin' && !macNativeDialog
        ? 'native save cancel, synthetic selected path' : 'native save cancel and selected path') +
      ', exact archive contents, wrong-password protection, confirmed local/cloud erasure, browser data absent after restart and public model preservation.',
  );
} catch (error) {
  console.error('ACCOUNT_ERASURE_FIRST_FAILURE', error);
  console.error(
    'NATIVE_RESULT',
    await fs.readFile(path.join(profile, 'native-save-result'), 'utf8').catch(() => null),
  );
  if (app) {
    for (const page of app.windows())
      console.error(
        'UI_FEEDBACK',
        await page
          .getByRole('alert')
          .allTextContents()
          .catch(() => []),
        await page
          .getByRole('status')
          .allTextContents()
          .catch(() => []),
      );
  }
  throw error;
} finally {
  if (app)
    await closeUiApp(app).catch((error) => {
      console.error('ACCOUNT_ERASURE_TEARDOWN', error);
      process.exitCode = 1;
    });
  await api.close();
  await services.close();
  auth.passwords.pool.close();
  store.close();
}
