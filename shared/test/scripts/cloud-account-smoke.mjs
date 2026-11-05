import { testRoot, electron } from './test-workspace.mjs';
import workspace from '../../scripts/workspace.mjs';
import { closeUiApp } from './install-ui-account.mjs';
import { assertLoadingIcon } from './assert-loading-icon.mjs';
import { captureRequested } from './capture-requested.mjs';
import { offlineElectronEntry } from './offline-electron-entry.mjs';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import {
  Store,
  Auth,
  loadConfig,
  createApi,
  Outbox,
  Services,
  routes,
} from './server-reference.mjs';

// Only this synthetic mailbox transport sees verification codes; production has no such route.
const directory = path.join(testRoot, 'cloud-account');
const loginCheck =
  process.argv.includes('--login-preview') || process.argv.includes('--login-check');
const scrollbarCheck = process.argv.includes('--scrollbars');
await mkdir(directory, { recursive: true });
if (process.argv.includes('--preview')) console.log('VISUAL_DIRECTORY=' + directory);
const config = loadConfig({
  AUTH_KEY: 'cd'.repeat(32),
  FEATURE_BACKUPS: '1',
  DATABASE_FILE: path.join(directory, 'test.sqlite'),
});
const store = new Store(config.database);
const auth = new Auth(store, config, true);
const messages = [];
const outbox = new Outbox(auth, {
  enabled: true,
  async send(message) {
    messages.push(message);
  },
});
const services = new Services(auth);
await services.start();
const api = createApi(auth, () => {}, routes(services));
api.server.listen(0, '127.0.0.1');
await once(api.server, 'listening');
outbox.start();
const port = api.server.address().port;
const profile = path.join(directory, 'profile');
const fixture = path.join(directory, 'entry.cjs');
await writeFile(
  fixture,
  `
const {app,safeStorage}=require('electron');
app.commandLine.appendSwitch('use-mock-keychain');
const path=require('node:path');
const root=${JSON.stringify(workspace.platformRoot)};app.setAppPath(root);
const base=path.join(root,'dist-electron/shared/electron');
if(process.platform==='darwin'){
  const cryptoPort=require(path.join(root,'dist-electron/macos/electron/credentials.js'));
  cryptoPort.createCredentialEncryption=()=>({encrypt:value=>safeStorage.encryptString(value),decrypt:value=>safeStorage.decryptString(value)});
  const childProcess=require('node:child_process');
  const spawn=childProcess.spawn;
  childProcess.spawn=function(executable,...args){
    if(String(executable).endsWith('/VoxCue.Credentials'))throw new Error('Cloud fixture must never launch the production credential helper');
    return spawn.call(this,executable,...args);
  };
}
const {ComponentService}=require(path.join(base,'backend/components/service.js'));
const componentState=ComponentService.prototype.state;
ComponentService.prototype.state=function(){const state=componentState.call(this);return {...state,phase:'ready',error:null,items:state.items.map(item=>({...item,phase:'ready',received:item.bytes}))};};
ComponentService.prototype.status=async function(){return this.state();};
ComponentService.prototype.ready=()=>true;
for(const [module,name,mode] of [['backend/auth/service.js','ChatGPTAuthService','chatgpt'],['backend/copilot/auth.js','CopilotAuthService','copilot']]){
  const Service=require(path.join(base,module))[name];let account=null;
  Service.prototype.session=async()=>account;
  Service.prototype.signIn=async()=>account={mode,user:{id:'synthetic-'+mode,name:'Synthetic AI',email:mode+'@example.test'},expiresAt:null};
  Service.prototype.signOut=async()=>{account=null;return {warning:null};};
}
for(const [module,name] of [['backend/chat/service.js','ChatGPTService'],['backend/copilot/service.js','CopilotChatService']]){
  const Service=require(path.join(base,module))[name];
  Service.prototype.models=async()=>[{id:'synthetic-model',label:'Synthetic model',description:''}];
  Service.prototype.accountUsage=async()=>null;
}
require(path.join(base,'main.js'));
`,
);
const env = {
  ...process.env,
  COPILOT_TEST_USER_DATA: profile,
  VITE_DEV_SERVER_URL: '',
  VOXCUE_ACCOUNT_API: 'http://127.0.0.1:' + port,
  VOXCUE_ACCOUNT_ALLOW_LOCAL: '1',
};
delete env.ELECTRON_RUN_AS_NODE;
let app;
try {
  app = await electron.launch({
    args: [await offlineElectronEntry(fixture, { loopbackPort: port })],
    env,
  });
  const page = await app.firstWindow();
  page.setDefaultTimeout(20000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  assert.equal(
    await page.getByRole('button', { name: /使用 ChatGPT|使用 GitHub Copilot/ }).count(),
    0,
  );
  const panel = page.getByRole('region', { name: 'VoxCue 账号' });
  await panel.locator('form').waitFor();
  assert.equal(
    await app.evaluate(({ ipcMain }) => ipcMain._invokeHandlers.has('cloud:usage')),
    false,
    'Retired interview licensing IPC must not be registered',
  );
  assert.deepEqual(
    await app.evaluate(async ({ ipcMain, BrowserWindow }) => {
      // Invoke the actual registered guards with foreign frame identities.
      // This is a deterministic main-process guard probe, not an iframe UI test.
      const sender = BrowserWindow.getAllWindows()[0].webContents;
      const results = [];
      for (const [channel, call] of [
        ['cloud:account', { action: 'status' }],
        ['cloud:sync', { action: 'list', userId: 'a0000000-0000-4000-8000-000000000001' }],
      ])
        for (const senderFrame of [null, {}]) {
          try {
            await ipcMain._invokeHandlers.get(channel)({ sender, senderFrame }, call);
            results.push(false);
          } catch (error) {
            results.push(/Unauthorized/.test(String(error)));
          }
        }
      return results;
    }),
    Array(4).fill(true),
  );
  assert.deepEqual(
    await page.evaluate(async () => {
      const denied = (work) =>
        work.then(
          () => false,
          () => true,
        );
      return Promise.all([
        denied(
          window.desktop.cloudSync({
            action: 'list',
            userId: 'a0000000-0000-4000-8000-000000000001',
          }),
        ),
      ]);
    }),
    [true],
    'The login window cannot access sync IPC',
  );
  if (loginCheck)
    console.log(
      'LOGIN_GEOMETRY=' +
        JSON.stringify(
          await page.evaluate(() =>
            [
              '.login-card',
              '.login-form',
              '.login-auth-content',
              '.cloud-account-panel',
              '.cloud-account-form',
            ].map((selector) => {
              const element = document.querySelector(selector),
                s = getComputedStyle(element),
                r = element.getBoundingClientRect();
              return {
                selector,
                x: r.x,
                width: r.width,
                display: s.display,
                columns: s.gridTemplateColumns,
                computedWidth: s.width,
                align: s.justifySelf,
              };
            }),
          ),
        ),
    );
  if (process.argv.includes('--preview') || loginCheck) {
    await page.screenshot({ path: path.join(directory, 'login-light.png') });
    await captureRequested(page, 'login-light');
    await page.evaluate(() => document.documentElement.classList.add('dark'));
    await page.screenshot({ path: path.join(directory, 'login-dark.png') });
    await captureRequested(page, 'login-dark');
    await page.evaluate(() => document.documentElement.classList.remove('dark'));
  }
  if (loginCheck) {
    const rects = [];
    async function resizeLogin(size) {
      const content = await app.evaluate(({ BrowserWindow }, size) => {
        const window = BrowserWindow.getAllWindows().find((window) => window.isVisible());
        window.setSize(...size);
        return {
          size: window.getContentSize(),
          zoom: window.webContents.getZoomFactor(),
        };
      }, size);
      await page.waitForFunction(
        ({ size, zoom }) =>
          Math.abs(innerWidth - size[0] / zoom) <= 1 && Math.abs(innerHeight - size[1] / zoom) <= 1,
        content,
      );
    }
    async function assertCodeLayoutMatrix(state) {
      const original = await page.evaluate(() => ({
        language: document.documentElement.lang,
        dark: document.documentElement.classList.contains('dark'),
      }));
      const size = await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()
          .find((window) => window.isVisible())
          .getSize(),
      );
      const language = async (value) => {
        await page.evaluate((value) => {
          localStorage.setItem('voxcue-language-v1', value);
          window.dispatchEvent(new StorageEvent('storage', { key: 'voxcue-language-v1' }));
        }, value);
        await page.waitForFunction((value) => document.documentElement.lang === value, value);
      };
      await page.evaluate(() => document.activeElement?.blur());
      await page.waitForFunction(() =>
        [...document.querySelectorAll('.cloud-code-inputs input')].every(
          (node) => getComputedStyle(node).transform === 'none',
        ),
      );
      try {
        for (const locale of ['zh-CN', 'en']) {
          await language(locale);
          let wide;
          for (const dimensions of [
            [1000, 660],
            [860, 580],
          ]) {
            await resizeLogin(dimensions);
            for (const dark of [false, true]) {
              await page.evaluate(
                (value) => document.documentElement.classList.toggle('dark', value),
                dark,
              );
              const layout = await page.locator('.cloud-code-row').evaluate((row) => {
                const grid = row.querySelector('.cloud-code-inputs');
                const button = row.querySelector(':scope > button');
                const rowBox = row.getBoundingClientRect();
                const gridBox = grid.getBoundingClientRect();
                const buttonBox = button.getBoundingClientRect();
                const cells = [...grid.querySelectorAll('input')].map((node) =>
                  node.getBoundingClientRect().toJSON(),
                );
                const feedback = row.parentElement.querySelector('.cloud-field-feedback');
                const range = document.createRange();
                range.selectNodeContents(button);
                const style = getComputedStyle(button);
                const gridStyle = getComputedStyle(grid);
                return {
                  cells,
                  grid: gridBox.toJSON(),
                  tracks: gridStyle.gridTemplateColumns.split(/\s+/).map(parseFloat),
                  cellGap: parseFloat(gridStyle.columnGap),
                  scale: devicePixelRatio,
                  button: buttonBox.toJSON(),
                  leftGap: gridBox.left - rowBox.left,
                  rightGap: rowBox.right - buttonBox.right,
                  gap: buttonBox.left - gridBox.right,
                  expectedGap: parseFloat(getComputedStyle(row).columnGap),
                  naturalButtonWidth:
                    range.getBoundingClientRect().width +
                    parseFloat(style.paddingLeft) +
                    parseFloat(style.paddingRight) +
                    parseFloat(style.borderLeftWidth) +
                    parseFloat(style.borderRightWidth),
                  nowrap: style.whiteSpace === 'nowrap',
                  feedbackBelow: !feedback || feedback.getBoundingClientRect().top >= rowBox.bottom,
                };
              });
              const unit = (value) => Math.round(value * 64 * layout.scale);
              const description = `${state}/${locale}/${dimensions.join('x')}/${dark ? 'dark' : 'light'} ${JSON.stringify(layout)}`;
              assert.equal(layout.cells.length, 6, description);
              assert.equal(layout.tracks.length, 6, description);
              // Fractional fr tracks are individually quantized by Chromium.
              // Compare against their resolved boundaries, including the small
              // remainder the browser may leave at the end of the grid box.
              let trackStart = layout.grid.left;
              for (const [index, cell] of layout.cells.entries()) {
                const trackEnd = trackStart + layout.tracks[index];
                assert.equal(unit(cell.left), unit(trackStart), description);
                assert.equal(unit(cell.right), unit(trackEnd), description);
                trackStart = trackEnd + layout.cellGap;
              }
              const trailing = unit(layout.grid.right) - unit(layout.cells.at(-1).right);
              assert.ok(trailing >= 0 && trailing < layout.tracks.length, description);
              assert.ok(
                unit(layout.leftGap) === 0 &&
                  unit(layout.rightGap) === 0 &&
                  unit(layout.gap) === unit(layout.expectedGap) &&
                  layout.cells.every(
                    (cell) =>
                      cell.width > 0 &&
                      unit(cell.top + cell.height / 2) ===
                        unit(layout.button.top + layout.button.height / 2),
                  ) &&
                  layout.nowrap &&
                  layout.feedbackBelow &&
                  unit(layout.button.width) >= unit(layout.naturalButtonWidth),
                `All six OTP cells and the natural-width action stay on one row: ${description}`,
              );
              if (dimensions[0] === 1000) wide = layout;
              else
                assert.ok(
                  layout.grid.width < wide.grid.width &&
                    layout.cells.every((cell, index) => cell.width < wide.cells[index].width),
                  `Narrow space must shrink the six cells before moving the action: ${description}`,
                );
            }
          }
        }
      } finally {
        await language(original.language);
        await page.evaluate(
          (value) => document.documentElement.classList.toggle('dark', value),
          original.dark,
        );
        await resizeLogin(size);
      }
    }
    async function assertInlineFeedback(input, text, danger) {
      const actual = await input.evaluate((node, danger) => {
        const feedback = document.getElementById(node.getAttribute('aria-describedby'));
        const field = node.closest('.cloud-account-field,.cloud-verification');
        const reference = document.createElement('span');
        reference.style.color = danger ? 'var(--danger)' : 'var(--muted)';
        field.append(reference);
        const expectedColor = getComputedStyle(reference).color;
        reference.remove();
        const range = document.createRange();
        range.selectNodeContents(feedback);
        const inputStyle = getComputedStyle(node);
        return {
          text: feedback.textContent,
          beneath: feedback.getBoundingClientRect().top >= node.getBoundingClientRect().bottom,
          belongs: field.contains(feedback),
          color: getComputedStyle(feedback).color,
          expectedColor,
          textLeft: range.getClientRects()[0].left,
          inputTextLeft:
            node.getBoundingClientRect().left +
            parseFloat(inputStyle.borderLeftWidth) +
            parseFloat(inputStyle.paddingLeft),
          textField: field.classList.contains('cloud-account-field'),
        };
      }, danger);
      assert.ok(actual.text.includes(text));
      assert.equal(actual.beneath, true, 'Feedback must sit beneath its input');
      assert.equal(actual.belongs, true, 'Feedback must belong to its input field');
      assert.equal(actual.color, actual.expectedColor, 'Validation color follows severity');
      if (actual.textField)
        assert.ok(
          Math.abs(actual.textLeft - actual.inputTextLeft) < 1,
          'Feedback text must align with the text inside its input',
        );
    }
    const geometry = async () => {
      await page.evaluate(() => document.activeElement?.blur());
      await page.waitForFunction(() =>
        [...document.querySelectorAll('.cloud-account-form input')].every(
          (node) => getComputedStyle(node).transform === 'none',
        ),
      );
      return page.evaluate(() => {
        const box = (s) => {
          const r = document.querySelector(s).getBoundingClientRect();
          return { x: r.x, y: r.y, width: r.width };
        };
        return {
          heading: box('.login-copy'),
          email: box('input[name="email"]'),
          password: box('input[name="password"]'),
          footer: box('.login-footer'),
          form: box('.login-auth-content'),
          submit: box('button[type="submit"]'),
        };
      });
    };
    async function clickNavigationOnce(label, heading) {
      const email = panel.getByLabel('邮箱', { exact: true });
      await email.fill('invalid');
      assert.equal(await email.evaluate((node) => node === document.activeElement), true);
      assert.equal(await panel.getByRole('alert').count(), 0, 'Begin without existing feedback');
      const navigation = panel.getByRole('button', { name: label, exact: true });
      const point = await navigation.evaluate((button) => {
        const rect = button.getBoundingClientRect();
        const x = rect.x + rect.width / 2,
          y = rect.y + rect.height / 2;
        return { x, y, hits: button.contains(document.elementFromPoint(x, y)) };
      });
      assert.equal(point.hits, true, `${label}: the original center must hit the navigation`);
      // Fix the coordinates before blur. One real press/release must activate
      // navigation even when the invalid email would otherwise add feedback.
      await page.mouse.click(point.x, point.y);
      await page.getByRole('heading', { name: heading, exact: true }).waitFor();
      assert.equal(await panel.getByRole('alert').count(), 0);
    }
    for (const [label, heading] of [
      ['注册', '创建账号'],
      ['找回密码', '重置密码'],
    ]) {
      await clickNavigationOnce(label, heading);
      await clickNavigationOnce('返回登录', '登录 VoxCue');
    }
    const email = panel.getByLabel('邮箱', { exact: true });
    await email.fill('invalid');
    await email.press('Tab');
    assert.equal(
      await panel
        .getByLabel('密码', { exact: true })
        .evaluate((node) => node === document.activeElement),
      true,
    );
    await panel.getByRole('alert').filter({ hasText: '邮箱格式不正确' }).waitFor();
    await assertInlineFeedback(email, '邮箱格式不正确', true);
    await email.fill('');
    rects.push(await geometry());
    assert.equal(await panel.locator('form').getAttribute('novalidate'), '');
    await panel.getByRole('button', { name: '登录', exact: true }).click();
    await panel.getByRole('alert').filter({ hasText: '邮箱格式不正确' }).waitFor();
    await assertInlineFeedback(panel.getByLabel('邮箱', { exact: true }), '邮箱格式不正确', true);
    await captureRequested(page, 'login-email-error');
    await panel.getByLabel('邮箱', { exact: true }).fill('synthetic@example.test');
    await panel.getByRole('button', { name: '登录', exact: true }).click();
    await panel.getByRole('alert').filter({ hasText: '密码不正确' }).waitFor();
    await assertInlineFeedback(panel.getByLabel('密码', { exact: true }), '密码不正确', true);
    await panel.getByRole('button', { name: '注册', exact: true }).click();
    rects.push(await geometry());
    assert.equal(
      await panel.getByLabel('密码', { exact: true }).getAttribute('placeholder'),
      '输入密码',
    );
    await panel.getByText('不少于8个字符', { exact: true }).waitFor();
    await assertInlineFeedback(panel.getByLabel('密码', { exact: true }), '不少于8个字符', false);
    assert.equal(await panel.getByLabel('密码', { exact: true }).getAttribute('minlength'), '8');
    assert.equal(await panel.getByLabel('密码', { exact: true }).getAttribute('maxlength'), '1024');
    for (const value of ['1', 'a@b', 'a..b@example.test', 'a@-bad.test']) {
      await panel.getByLabel('邮箱', { exact: true }).fill(value);
      assert.equal(
        await panel.getByRole('button', { name: '获取验证码', exact: true }).isDisabled(),
        true,
      );
    }
    await panel.getByLabel('邮箱', { exact: true }).fill('synthetic@example.test');
    await panel.getByLabel('密码', { exact: true }).fill('a'.repeat(15));
    await assertCodeLayoutMatrix('register-send');
    await panel.getByRole('button', { name: '获取验证码', exact: true }).click();
    await panel.getByRole('button', { name: /秒后重发/ }).waitFor();
    const resend = Number(
      (await panel.getByRole('button', { name: /秒后重发/ }).innerText()).match(/\d+/)[0],
    );
    assert.ok(
      resend > 0 && resend <= 60,
      'A new 60-second resend deadline must never display 61 seconds',
    );
    await assertCodeLayoutMatrix('register-resend');
    await outbox.runOnce();
    const codeCells = panel.locator('.cloud-code-inputs input');
    assert.equal(await codeCells.count(), 6);
    await codeCells.first().pressSequentially('123456');
    assert.deepEqual(await codeCells.evaluateAll((nodes) => nodes.map((node) => node.value)), [
      '1',
      '2',
      '3',
      '4',
      '5',
      '6',
    ]);
    assert.equal(await codeCells.last().evaluate((node) => node === document.activeElement), true);
    await codeCells.last().press('Backspace');
    assert.equal(await codeCells.last().inputValue(), '');
    await codeCells.last().press('Backspace');
    assert.equal(await codeCells.nth(4).inputValue(), '');
    await codeCells.first().evaluate((node) => {
      const clipboardData = new DataTransfer();
      clipboardData.setData('text/plain', '98 76 54');
      node.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true }));
    });
    assert.deepEqual(await codeCells.evaluateAll((nodes) => nodes.map((node) => node.value)), [
      '9',
      '8',
      '7',
      '6',
      '5',
      '4',
    ]);
    await codeCells.last().press('Home');
    assert.equal(await codeCells.first().evaluate((node) => node === document.activeElement), true);
    await codeCells.first().press('ArrowRight');
    assert.equal(await codeCells.nth(1).evaluate((node) => node === document.activeElement), true);
    await panel.getByLabel('邮箱验证码', { exact: true }).fill(messages.at(-1).code);
    await panel.getByLabel('密码', { exact: true }).fill('a'.repeat(7));
    await panel.getByRole('button', { name: '创建账号', exact: true }).click();
    assert.equal(
      await panel
        .getByLabel('密码', { exact: true })
        .evaluate((node) => node === document.activeElement),
      true,
    );
    assert.equal(await panel.getByRole('alert').count(), 0);
    await panel.getByText('不少于8个字符', { exact: true }).waitFor();
    await panel.getByLabel('密码', { exact: true }).fill('a'.repeat(15));
    await panel.getByLabel('邮箱验证码', { exact: true }).fill('123');
    await panel.getByRole('button', { name: '创建账号', exact: true }).click();
    await panel.getByRole('alert').filter({ hasText: '验证码不正确' }).waitFor();
    assert.deepEqual(await codeCells.evaluateAll((nodes) => nodes.map((node) => node.value)), [
      '1',
      '2',
      '3',
      '',
      '',
      '',
    ]);
    await assertInlineFeedback(codeCells.first(), '验证码不正确', true);
    await panel.getByLabel('邮箱验证码', { exact: true }).fill(messages.at(-1).code);
    await panel.getByRole('button', { name: '创建账号', exact: true }).click();
    await panel.getByRole('alert').filter({ hasText: '过于常见' }).waitFor();
    async function assertFeedbackBounds() {
      const box = await page.evaluate(() => {
        const rect = (s) => {
          const r = document.querySelector(s).getBoundingClientRect();
          return { top: r.top, bottom: r.bottom };
        };
        return {
          error: rect('[role="alert"]'),
          footer: rect('.login-footer'),
          action: rect('button[type="submit"]'),
          content: rect('.login-auth-content'),
          link: rect('.login-form-links'),
          scrollable: [
            ...document.querySelectorAll('.login-page,.login-card,.login-form,.login-auth-content'),
          ].some((e) => ['auto', 'scroll'].includes(getComputedStyle(e).overflowY)),
        };
      });
      assert.ok(box.error.bottom <= box.action.top, 'Feedback must precede the primary action');
      assert.ok(box.content.bottom <= box.footer.top, 'Content must reserve the fixed footer');
      assert.ok(
        box.link.bottom <= box.footer.top,
        'Return link must remain visible above the footer',
      );
      assert.equal(box.scrollable, false, 'Account pages must never add scrollbars');
    }
    async function captureRegister(size) {
      if (!process.argv.some((arg) => arg.startsWith('--screenshots='))) return;
      for (const dark of [false, true]) {
        await page.evaluate(
          (dark) => document.documentElement.classList.toggle('dark', dark),
          dark,
        );
        await assertFeedbackBounds();
        await captureRequested(page, 'register-' + size + '-' + (dark ? 'dark' : 'light'));
      }
      await page.evaluate(() => document.documentElement.classList.remove('dark'));
    }
    await assertFeedbackBounds();
    await captureRegister('normal');
    await resizeLogin([860, 580]);
    await assertFeedbackBounds();
    await captureRegister('minimum');
    await resizeLogin([1000, 660]);
    await panel.getByLabel('密码', { exact: true }).focus();
    await page.waitForFunction(
      () =>
        new DOMMatrix(getComputedStyle(document.querySelector('input[name="password"]')).transform)
          .m42 < -1.9,
    );
    assert.equal(
      await panel
        .getByLabel('密码', { exact: true })
        .evaluate((e) => getComputedStyle(e).outlineStyle),
      'none',
    );
    assert.notEqual(
      await panel
        .getByLabel('密码', { exact: true })
        .evaluate((e) => getComputedStyle(e).boxShadow),
      'none',
    );
    await page.screenshot({ path: path.join(directory, 'register-light.png') });
    await captureRequested(page, 'register-light');
    await panel.getByRole('button', { name: '返回登录', exact: true }).click();
    await panel.getByRole('button', { name: '找回密码', exact: true }).click();
    rects.push(await geometry());
    await assertCodeLayoutMatrix('reset-send');
    await page.screenshot({ path: path.join(directory, 'reset-light.png') });
    await captureRequested(page, 'reset-light');
    console.log('VISUAL_DIRECTORY=' + directory);
    for (const r of rects) {
      for (const key of ['heading', 'email', 'password', 'footer']) {
        assert.ok(Math.abs(r[key].x - rects[0][key].x) < 1);
        assert.ok(Math.abs(r[key].y - rects[0][key].y) < 1);
      }
      assert.ok(Math.abs(r.form.width - r.email.width) < 1);
      assert.ok(Math.abs(r.form.width - r.submit.width) < 1);
    }
    assert.equal(
      await page
        .getByText(
          /登录主账号，管理资料与云同步|同步默认关闭，可在|ChatGPT、Copilot 可在登录后|密码需为12至128/,
        )
        .count(),
      0,
    );
    console.log(
      'Login geometry: invalid emails disabled; inline feedback clears the fixed footer; top alignment, full-width fields, 8–128 policy and focus shadow verified.',
    );
    if (process.argv.includes('--login-preview'))
      await new Promise((resolve) => setTimeout(resolve, 45000));
  } else {
    await panel.getByRole('button', { name: '注册', exact: true }).click();
    await panel.getByLabel('邮箱', { exact: true }).fill('synthetic@example.test');
    await panel.getByLabel('密码', { exact: true }).fill('synthetic password 123');
    await panel.getByRole('button', { name: '获取验证码', exact: true }).click();
    await panel.getByRole('button', { name: /秒后重发/ }).waitFor();
    await outbox.runOnce();
    assert.equal(messages.length, 1);
    await panel.getByLabel('邮箱验证码', { exact: true }).fill(messages[0].code);
    const opened = app.waitForEvent('window');
    await panel.getByRole('button', { name: '创建账号', exact: true }).click();
    const main = await opened;
    main.setDefaultTimeout(20000);
    main.on('pageerror', (e) => errors.push(e.message));
    await main.getByRole('navigation', { name: '主导航' }).waitFor();
    const vault = await readFile(path.join(profile, 'cloud-account/session.bin'));
    assert.ok(!vault.includes(Buffer.from('synthetic@example.test')));
    const exposed = await main.evaluate(() => window.desktop.cloudAccount({ action: 'status' }));
    assert.equal(exposed.state.verified, true);
    assert.ok(!JSON.stringify(exposed).includes('accessToken'));
    if (scrollbarCheck) {
      const { checkManagementScrollbars } = await import('./management-scrollbar-checks.mjs');
      await checkManagementScrollbars({
        app,
        main,
        directory,
      });
      assert.deepEqual(errors, []);
    } else {
      await main.evaluate(() => {
        localStorage.setItem(
          'copilot-personal-info-v1',
          JSON.stringify({
            name: '合成用户',
            jobDescription: 'Synthetic JD',
            background: 'Synthetic profile',
          }),
        );
        localStorage.setItem(
          'copilot-interview-history-v1',
          JSON.stringify([
            {
              id: 'synthetic-record',
              title: '合成面试记录',
              startedAt: 1,
              endedAt: 1001,
              status: 'ended',
              transcripts: Array.from({ length: 100 }, (_, i) => ({
                id: `t-${i}`,
                text: `合成问题 ${i}：请说明项目中的接口设计、错误处理与测试方法。`,
                time: '00:01',
                final: true,
                source: 'system',
              })),
              answers: Array.from({ length: 24 }, (_, i) => ({
                id: `a-${i}`,
                question: `合成问题 ${i}`,
                content:
                  '合成回答：按职责分离模块，限制并发和队列，检查失败路径并验证恢复。'.repeat(4),
                status: 'completed',
                sourceTranscriptIds: [`t-${i}`],
                createdAt: i + 1,
              })),
              mock: false,
              titleStatus: 'ready',
              titleSource: 'manual',
            },
          ]),
        );
        window.dispatchEvent(new CustomEvent('voxcue-sync-applied', { detail: 'profile' }));
      });
      await main.getByRole('button', { name: '知识库', exact: true }).click();
      await main.getByRole('button', { name: '创建知识库', exact: true }).first().click();
      const knowledgeEditor = main.getByRole('dialog', { name: '创建知识库', exact: true });
      await knowledgeEditor.getByLabel('知识库名称', { exact: true }).fill('合成知识库');
      await knowledgeEditor.getByRole('button', { name: '保存', exact: true }).click();
      const seeded = main.getByRole('dialog', { name: '合成知识库', exact: true });
      const reference = path.join(directory, 'reference.txt');
      await writeFile(reference, 'Synthetic reference source');
      await seeded.getByLabel('导入知识库文档').setInputFiles(reference);
      await seeded.getByText('reference.txt', { exact: true }).waitFor();
      await seeded.getByRole('button', { name: '关闭对话框', exact: true }).click();
      await main.getByRole('button', { name: '用户菜单', exact: true }).click();
      await main.getByRole('menuitem', { name: '设置', exact: true }).click();
      const settings = main.getByRole('dialog', { name: '设置', exact: true });
      await settings.getByRole('heading', { name: 'VoxCue 账号', exact: true }).waitFor();
      assert.deepEqual(
        await settings
          .getByRole('navigation', { name: '设置分类' })
          .locator('button')
          .allTextContents(),
        ['VoxCue 账号', 'AI 服务', '本地组件', '面试设置', '通用', '关于与更新'],
      );
      await settings.getByRole('button', { name: 'AI 服务', exact: true }).click();
      assert.equal(await settings.getByRole('button', { name: '连接', exact: true }).count(), 2);
      for (const label of ['ChatGPT', 'GitHub Copilot']) {
        const row = settings.locator('.settings-entry').filter({ hasText: label });
        await row.getByRole('button', { name: '连接', exact: true }).click();
        await row.getByRole('button', { name: '断开连接', exact: true }).waitFor();
        assert.equal(
          (await main.evaluate(() => window.desktop.cloudAccount({ action: 'status' }))).state.user
            .email,
          'synthetic@example.test',
        );
      }
      await settings.getByRole('button', { name: '断开连接', exact: true }).click();
      await main.getByRole('navigation', { name: '主导航' }).waitFor();
      assert.equal(await main.evaluate(() => window.desktop.authSession()), null);
      assert.equal(await settings.getByText('synthetic@example.test', { exact: true }).count(), 0);
      await settings.getByRole('button', { name: 'VoxCue 账号', exact: true }).click();
      const foreignOwner = 'a0000000-0000-4000-8000-000000000002';
      await main.evaluate(
        (owner) => localStorage.setItem('voxcue-sync-owner', owner),
        foreignOwner,
      );
      await settings.getByRole('switch', { name: '同步个人信息', exact: true }).click();
      await settings
        .getByText('本机资料已绑定其他 VoxCue 账号，请切回原账号后同步。', { exact: true })
        .waitFor();
      const warningLayout = await settings
        .getByRole('alert')
        .filter({
          hasText: '本机资料已绑定其他 VoxCue 账号，请切回原账号后同步。',
        })
        .evaluate((message) => {
          const actions = message.closest('.cloud-sync-actions');
          if (!actions) return null;
          const text = message.getBoundingClientRect(),
            row = actions.getBoundingClientRect();
          const buttons = [...actions.querySelectorAll(':scope > button')].map((button) =>
            button.getBoundingClientRect(),
          );
          return {
            buttons: buttons.length,
            textBefore: text.right <= buttons[0].left - 7,
            left: text.left - row.left,
            right: row.right - buttons.at(-1).right,
            centers: buttons.map(
              (button) => button.top + button.height / 2 - text.top - text.height / 2,
            ),
            overflow: actions.scrollWidth > actions.clientWidth + 1,
          };
        });
      assert.ok(warningLayout, 'Cloud backup warning belongs to the existing action row');
      assert.equal(warningLayout.buttons, 2);
      assert.equal(warningLayout.textBefore, true, JSON.stringify(warningLayout));
      assert.ok(
        Math.abs(warningLayout.left) < 1 && Math.abs(warningLayout.right) < 1,
        JSON.stringify(warningLayout),
      );
      assert.ok(
        warningLayout.centers.every((offset) => Math.abs(offset) < 1),
        'Backup warning and both action buttons stay vertically centered: ' +
          JSON.stringify(warningLayout),
      );
      assert.equal(warningLayout.overflow, false);
      assert.equal(
        await settings
          .getByRole('switch', { name: '同步个人信息', exact: true })
          .getAttribute('aria-checked'),
        'false',
      );
      assert.equal(
        await main.evaluate(() => localStorage.getItem('voxcue-sync-owner')),
        foreignOwner,
      );
      await main.evaluate(() => localStorage.removeItem('voxcue-sync-owner'));
      for (const label of ['个人信息', '面试记录', '知识库'])
        await settings.getByRole('switch', { name: '同步' + label, exact: true }).click();
      await main.waitForFunction(
        () =>
          document.querySelector('[aria-label="同步知识库"]')?.getAttribute('aria-checked') ===
          'true',
      );
      await settings.getByRole('button', { name: '立即同步', exact: true }).click();
      await main.waitForFunction(
        () =>
          document.querySelector('[aria-label="同步知识库"]')?.getAttribute('aria-checked') ===
            'true' && !document.querySelector('.cloud-sync-actions > button')?.disabled,
      );
      await new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(Error('Synthetic cloud snapshots did not settle')),
          20000,
        );
        const check = () => {
          if (store.query('SELECT count(*) n FROM backup_versions').n >= 4) {
            clearTimeout(timer);
            resolve();
          } else setTimeout(check, 100);
        };
        check();
      });
      if (process.argv.includes('--preview'))
        await main.screenshot({ path: path.join(directory, 'sync-settings.png') });
      const storage = services.backups.storage(exposed.state.user.id);
      const counts = storage.currentBytes;
      assert.equal(storage.capacityBytes, 100000000);
      await settings.getByRole('img', { name: /总容量 100000000 字节/ }).waitFor();
      assert.ok(counts.profile > 0 && counts.history > 0 && counts.knowledgebase > 0);
      await settings.getByRole('button', { name: 'VoxCue 账号', exact: true }).click();
      await settings.getByRole('heading', { name: 'VoxCue 账号', exact: true }).waitFor();
      assert.equal(
        await settings.getByRole('button', { name: '登录设备', exact: true }).count(),
        0,
      );
      assert.equal(
        await settings.getByRole('button', { name: '刷新状态', exact: true }).count(),
        0,
      );
      for (const dark of [false, true]) {
        await settings.getByRole('button', { name: '通用', exact: true }).click();
        await settings.getByRole('button', { name: '外观主题', exact: true }).click();
        await settings
          .getByRole('menuitemradio', { name: dark ? '深色' : '浅色', exact: true })
          .click();
        await settings.getByRole('button', { name: 'VoxCue 账号', exact: true }).click();
        await settings.getByRole('heading', { name: 'VoxCue 账号', exact: true }).hover();
        await main.waitForTimeout(300);
        assert.equal(
          await settings.evaluate((element) => {
            const r = element.getBoundingClientRect();
            return (
              r.left >= 0 && r.top >= 0 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1
            );
          }),
          true,
        );
        if (process.argv.includes('--preview'))
          await main.screenshot({
            path: path.join(directory, dark ? 'account-dark.png' : 'account-light.png'),
          });
        await captureRequested(main, dark ? 'account-dark' : 'account-light');
      }
      await settings.getByRole('button', { name: '关闭设置', exact: true }).click();
      // Fill the total quota, then exercise exempt profile updates through the actual UI.
      const owner = exposed.state.user.id,
        b = services.backups,
        reservations = [];
      let remaining =
        storage.capacityBytes - Object.values(storage.storedBytes).reduce((a, b) => a + b, 0);
      for (const name of ['synthetic-reservation-a', 'synthetic-reservation-b']) {
        const { randomUUID } = await import('node:crypto');
        const id = randomUUID();
        const bytes = Math.min(50000000, remaining);
        remaining -= bytes;
        b.create(owner, { id, kind: 'knowledgebase', name });
        reservations.push(
          b.begin(owner, id, {
            requestId: randomUUID(),
            bytes,
            sha256: 'ab'.repeat(32),
            baseRevision: 0,
          }).id,
        );
      }
      await main.getByRole('button', { name: '新对话', exact: true }).click();
      await main.getByRole('button', { name: '个人信息', exact: true }).click();
      const info = main.locator('#personal-info-panel');
      const jd = info.locator('details[aria-label="职位描述摘要"]');
      await jd.locator('summary').click();
      const revision = () => b.list(owner).items.find((i) => i.name === 'profile:main').revision;
      const waitRevision = async (previous) =>
        new Promise((resolve, reject) => {
          const deadline = Date.now() + 20000;
          const check = () => {
            if (revision() > previous) resolve();
            else if (Date.now() > deadline) reject(Error('JD revision did not advance'));
            else setTimeout(check, 50);
          };
          check();
        });
      let before = revision();
      await jd.getByRole('button', { name: '删除：职位描述摘要', exact: true }).click();
      await jd.getByRole('button', { name: '确认删除：职位描述摘要', exact: true }).click();
      await waitRevision(before);
      await info.getByRole('button', { name: '个人信息：已同步', exact: true }).waitFor();
      const readProfile = async () => {
        const resource = b.list(owner).items.find((i) => i.name === 'profile:main');
        const download = await b.download(owner, resource.id, resource.headVersion, undefined);
        const chunks = [];
        for await (const chunk of download.content) chunks.push(chunk);
        const value = Buffer.concat(chunks);
        return JSON.parse(value.subarray(8 + value.readUInt32BE(4)).toString());
      };
      assert.equal((await readProfile()).jobDescription, '');
      await jd.getByRole('button', { name: '编辑', exact: true }).click();
      const editor = main.getByRole('dialog', { name: '编辑职位描述摘要', exact: true });
      await editor
        .getByRole('textbox', { name: '内容', exact: true })
        .fill('JD after full knowledge quota');
      before = revision();
      await editor.getByRole('button', { name: '保存', exact: true }).click();
      await waitRevision(before);
      await info.getByRole('button', { name: '个人信息：已同步', exact: true }).waitFor();
      assert.equal((await readProfile()).jobDescription, 'JD after full knowledge quota');
      assert.ok(
        Object.values(b.storage(owner).storedBytes).reduce((a, b) => a + b, 0) >
          storage.capacityBytes,
      );
      await main.getByRole('button', { name: '用户菜单', exact: true }).click();
      await main.getByRole('menuitem', { name: '设置', exact: true }).click();
      await settings.getByRole('button', { name: 'VoxCue 账号', exact: true }).click();
      await settings.getByRole('button', { name: '刷新容量', exact: true }).click();
      const usageLabel = await settings
        .getByRole('img', { name: /总容量 100000000 字节/ })
        .getAttribute('aria-label');
      assert.ok(Number(usageLabel.match(/已用 (\d+) 字节/)[1]) > 100000000);
      await settings.getByText('可用 0.00 MB ·', { exact: false }).waitFor();
      assert.equal(await settings.locator('.cloud-storage-details strong').count(), 0);
      assert.ok(!/KB|云端当前数据|待完成上传|含旧版本实际占用/.test(await settings.innerText()));
      await settings.getByRole('button', { name: '关闭设置', exact: true }).click();
      for (const id of reservations) b.abort(owner, id);
      await main.getByRole('button', { name: '面试记录', exact: true }).click();
      await main.getByRole('button', { name: '合成面试记录：已同步', exact: true }).waitFor();
      await main.getByRole('button', { name: '知识库', exact: true }).click();
      await main.getByRole('button', { name: '合成知识库：已同步', exact: true }).waitFor();
      const cardAlignment = await main
        .locator('.knowledge-card-wrap')
        .filter({ hasText: '合成知识库' })
        .evaluate((e) => {
          const a = e.querySelector('.knowledge-icon').getBoundingClientRect(),
            b = e.querySelector('.sync-indicator-button').getBoundingClientRect();
          return Math.abs(a.y + a.height / 2 - b.y - b.height / 2);
        });
      assert.ok(
        cardAlignment < 1,
        'Knowledge card cloud and library icons must share their center line',
      );
      await main.locator('.knowledge-card').filter({ hasText: '合成知识库' }).click();
      const detail = main.getByRole('dialog', { name: '合成知识库', exact: true });
      const iconGeometry = await detail.evaluate((e) =>
        [...e.querySelectorAll('.dialog-heading .action-icon-button')].map((button) => {
          const b = button.getBoundingClientRect(),
            s = button.querySelector('svg').getBoundingClientRect();
          return {
            x: b.x,
            y: b.y,
            width: b.width,
            height: b.height,
            iconWidth: s.width,
            iconHeight: s.height,
          };
        }),
      );
      assert.equal(iconGeometry.length, 2);
      assert.ok(iconGeometry[0].x < iconGeometry[1].x);
      for (const field of ['width', 'height', 'iconWidth', 'iconHeight', 'y'])
        assert.ok(
          Math.abs(iconGeometry[0][field] - iconGeometry[1][field]) < 1,
          `Edit/sync ${field} must match`,
        );
      const badge = detail.getByRole('button', { name: 'reference.txt：已同步', exact: true });
      await badge.hover();
      const popup = detail.getByRole('group', { name: 'reference.txt同步状态', exact: true });
      await popup.waitFor();
      if (process.argv.includes('--preview'))
        await main.screenshot({ path: path.join(directory, 'synced-file.png') });
      const remove = popup.getByRole('button', { name: /从云端删除/ });
      assert.ok((await popup.boundingBox()).width < 225, 'The sync popup should fit its contents.');
      assert.ok((await remove.locator('.confirm-delete-idle').innerText()).includes('从云端删除'));
      await remove.focus();
      await main.mouse.move(0, 0);
      await main.waitForTimeout(200);
      assert.equal(await popup.isVisible(), true, 'Internal keyboard focus keeps the popup open');
      await remove.press('Escape');
      await popup.waitFor({ state: 'detached' });
      assert.equal(await badge.evaluate((node) => node === document.activeElement), true);
      assert.equal(await badge.getAttribute('aria-expanded'), 'false');
      await badge.press('Space');
      await popup.waitFor();
      await remove.click();
      await popup.getByRole('button', { name: /确认删除/ }).click();
      await detail
        .getByRole('button', { name: 'reference.txt：已暂停同步', exact: true })
        .waitFor();
      assert.equal(await detail.getByText('reference.txt', { exact: true }).count(), 1);
      assert.equal(
        services.backups.list(exposed.state.user.id).items.filter((i) => i.name.startsWith('file:'))
          .length,
        0,
      );
      await detail.getByRole('button', { name: 'reference.txt：已暂停同步', exact: true }).hover();
      await popup.getByRole('button', { name: '自动同步', exact: true }).click();
      await detail.getByRole('button', { name: 'reference.txt：已同步', exact: true }).waitFor();
      const libraryBadge = detail.getByRole('button', { name: '合成知识库：已同步', exact: true });
      await libraryBadge.hover();
      const libraryPopup = detail.getByRole('group', { name: '合成知识库同步状态', exact: true });
      await libraryPopup.getByRole('button', { name: /从云端删除/ }).click();
      await libraryPopup.getByRole('button', { name: /确认删除/ }).click();
      await detail.getByRole('button', { name: '合成知识库：已暂停同步', exact: true }).waitFor();
      assert.equal(
        services.backups
          .list(exposed.state.user.id)
          .items.filter((item) => /^(base|file):/.test(item.name)).length,
        0,
        'Deleting a library must also remove every file from its cloud copy.',
      );
      assert.equal(await detail.getByText('reference.txt', { exact: true }).count(), 1);
      await detail.getByRole('button', { name: '合成知识库：已暂停同步', exact: true }).hover();
      await libraryPopup.getByRole('button', { name: '自动同步', exact: true }).click();
      await detail.getByRole('button', { name: '合成知识库：已同步', exact: true }).waitFor();
      const originalPut = services.backups.put.bind(services.backups);
      let releasePart, partStarted, releaseSecond, secondStarted;
      const partGate = new Promise((resolve) => {
        releasePart = resolve;
      });
      const partEntered = new Promise((resolve) => {
        partStarted = resolve;
      });
      const secondGate = new Promise((resolve) => {
        releaseSecond = resolve;
      });
      const secondEntered = new Promise((resolve) => {
        secondStarted = resolve;
      });
      let held = false,
        heldSecond = false;
      services.backups.put = async (...args) => {
        if (!held && services.backups.status(args[0], args[1]).bytes > 1048576) {
          held = true;
          partStarted();
          await partGate;
        } else if (
          !heldSecond &&
          args[2] === 1 &&
          services.backups.status(args[0], args[1]).bytes > 1048576
        ) {
          heldSecond = true;
          secondStarted();
          await secondGate;
        }
        return originalPut(...args);
      };
      try {
        const large = path.join(directory, 'large.txt');
        await writeFile(large, 'x'.repeat(2 * 1048576));
        await detail.getByLabel('导入知识库文档').setInputFiles(large);
        await detail.getByText('large.txt', { exact: true }).waitFor();
        await partEntered;
        await detail.getByRole('button', { name: '关闭对话框', exact: true }).click();
        await main.getByRole('button', { name: '新对话', exact: true }).click();
        const personal = main.locator('#personal-info-panel');
        if ((await personal.getAttribute('data-open')) !== 'true')
          await main.getByRole('button', { name: '个人信息', exact: true }).click();
        await personal.getByRole('button', { name: '个人信息：已同步', exact: true }).hover();
        const personalPopup = main.getByRole('group', { name: '个人信息同步状态', exact: true });
        const deleting = personalPopup.getByRole('button', { name: /从云端删除/ });
        assert.equal(
          await deleting.isEnabled(),
          true,
          'Cloud deletion must stay enabled while a knowledge upload is active.',
        );
        await deleting.click();
        await personalPopup.getByRole('button', { name: /确认删除/ }).click();
        releasePart();
        await personal.getByRole('button', { name: '个人信息：已暂停同步', exact: true }).waitFor();
        assert.equal(services.backups.storage(owner).currentBytes.profile, 0);
        await secondEntered;
        await main.getByRole('button', { name: '知识库', exact: true }).click();
        await main.locator('.knowledge-card').filter({ hasText: '合成知识库' }).click();
        await detail.getByRole('button', { name: '合成知识库：正在同步', exact: true }).hover();
        assert.equal(
          await libraryPopup.getByRole('button').count(),
          1,
          'An active sync exposes only cancellation.',
        );
        assert.equal(await libraryPopup.getByRole('button', { name: /从云端删除/ }).count(), 0);
        await libraryPopup.getByRole('button', { name: '取消同步', exact: true }).click();
        releaseSecond();
        await detail.getByRole('button', { name: '合成知识库：已暂停同步', exact: true }).waitFor();
        assert.equal(services.backups.storage(owner).reservedBytes.knowledgebase, 0);
        assert.ok(services.backups.storage(owner).currentBytes.knowledgebase > 0);
        await detail.getByRole('button', { name: '关闭对话框', exact: true }).click();
        await main.getByRole('button', { name: '新对话', exact: true }).click();
        if ((await personal.getAttribute('data-open')) !== 'true')
          await main.getByRole('button', { name: '个人信息', exact: true }).click();
        await personal.getByRole('button', { name: '个人信息：已暂停同步', exact: true }).hover();
        await personalPopup.getByRole('button', { name: '自动同步', exact: true }).click();
        await personal.getByRole('button', { name: '个人信息：已同步', exact: true }).waitFor();
        assert.equal((await readProfile()).jobDescription, 'JD after full knowledge quota');
        if (process.argv.includes('--preview'))
          await main.screenshot({ path: path.join(directory, 'personal-sync-actions.png') });
        await main.getByRole('button', { name: '个人信息', exact: true }).click();
        await main.getByRole('button', { name: '知识库', exact: true }).click();
        await main.locator('.knowledge-card').filter({ hasText: '合成知识库' }).click();
        await detail.getByRole('button', { name: '合成知识库：已暂停同步', exact: true }).hover();
        await libraryPopup.getByRole('button', { name: '自动同步', exact: true }).click();
        await detail.getByRole('button', { name: '合成知识库：已同步', exact: true }).waitFor();
        await detail.getByRole('button', { name: '关闭对话框', exact: true }).click();
        await main.getByRole('button', { name: '新对话', exact: true }).click();
      } finally {
        releasePart();
        releaseSecond();
        services.backups.put = originalPut;
      }
      await main.getByRole('button', { name: '用户菜单', exact: true }).click();
      await main.getByRole('menuitem', { name: '设置', exact: true }).click();
      await settings.getByRole('heading', { name: 'VoxCue 账号', exact: true }).waitFor();
      assert.equal(/\d+\s*秒/.test(await settings.innerText()), false);
      const components = await main.evaluate(() => window.desktop.components({ op: 'status' }));
      await app.evaluate(({ BrowserWindow }, state) => {
        BrowserWindow.getAllWindows()
          .find((win) => win.isVisible())
          .webContents.send('components:event', {
            ...state,
            revision: state.revision + 1000,
            phase: 'downloading',
            items: state.items.map((item, index) =>
              index
                ? item
                : { ...item, phase: 'downloading', received: Math.floor(item.bytes * 0.99) },
            ),
          });
      }, components);
      await settings.getByRole('button', { name: '本地组件', exact: true }).click();
      const download = settings.locator('.download-button:not(.is-icon-only)').first();
      await download.waitFor();
      await main.waitForTimeout(1100);
      await download.hover();
      await main.waitForTimeout(100);
      const transition = await download.locator('.download-button-cancel').evaluate((element) => ({
        opacity: Number(getComputedStyle(element).opacity),
        duration: getComputedStyle(element).transitionDuration,
      }));
      assert.ok(transition.opacity > 0 && transition.opacity < 1);
      assert.ok(transition.duration.includes('0.22s'));
      await main.waitForTimeout(180);
      if (process.argv.includes('--preview'))
        await main.screenshot({ path: path.join(directory, 'component-download-cancel.png') });
      await main.emulateMedia({ reducedMotion: 'reduce' });
      assert.equal(
        await download.evaluate((element) => getComputedStyle(element).transitionDuration),
        '0s',
      );
      await main.emulateMedia({ reducedMotion: 'no-preference' });
      await app.evaluate(({ BrowserWindow }, state) => {
        BrowserWindow.getAllWindows()
          .find((win) => win.isVisible())
          .webContents.send('components:event', {
            ...state,
            revision: state.revision + 1001,
            phase: 'removing',
            items: state.items.map((item, index) =>
              index ? item : { ...item, phase: 'removing' },
            ),
          });
      }, components);
      const loader = settings.locator('svg.ui-loader').first();
      await loader.waitFor();
      if (process.platform === 'darwin') {
        assert.equal(
          await loader.evaluate((element) => getComputedStyle(element).transform),
          'none',
        );
        await assertLoadingIcon(main, loader.locator('..'));
      } else {
        const firstRotation = await loader.evaluate(
          (element) => getComputedStyle(element).transform,
        );
        await main.waitForTimeout(140);
        assert.notEqual(
          await loader.evaluate((element) => getComputedStyle(element).transform),
          firstRotation,
          'Loader artwork must rotate on Windows.',
        );
        await main.emulateMedia({ reducedMotion: 'reduce' });
        assert.equal(
          await loader.evaluate((element) => getComputedStyle(element).animationName),
          'none',
        );
        await main.emulateMedia({ reducedMotion: 'no-preference' });
      }
      await settings.getByRole('button', { name: '关闭设置', exact: true }).click();
      const prompt = main.locator('.preparation-guide');
      if (await prompt.count()) {
        const position = await prompt.evaluate((element) => {
          const box = element.getBoundingClientRect(),
            parent = element.parentElement.getBoundingClientRect();
          return {
            offset: (box.left + box.right - parent.left - parent.right) / 2,
            font: getComputedStyle(element).fontSize,
            expected: getComputedStyle(document.documentElement)
              .getPropertyValue('--type-body')
              .trim(),
          };
        });
        assert.ok(Math.abs(position.offset) < 1);
        assert.equal(position.font, position.expected);
      }
      const apiKeys = await main.evaluate(() => Object.keys(window.desktop));
      assert.ok(!apiKeys.includes('api'));
      assert.deepEqual(errors, []);
      if (process.argv.includes('--preview')) {
        await main.getByRole('button', { name: '面试记录', exact: true }).click();
        const rowGeometry = await main
          .locator('.history-row')
          .first()
          .evaluate((e) => {
            const a = e.querySelector('.neutral-badge').getBoundingClientRect(),
              b = e.querySelector('.sync-indicator-button').getBoundingClientRect();
            return {
              center: Math.abs(a.y + a.height / 2 - b.y - b.height / 2),
              after: b.x >= a.right,
            };
          });
        assert.ok(rowGeometry.center < 1 && rowGeometry.after);
        await main.screenshot({ path: path.join(directory, 'history-list.png') });
        await main.getByRole('button', { name: '查看面试记录：合成面试记录', exact: true }).click();
        const recordButtons = await main.locator('.record-heading-title').evaluate((e) =>
          [...e.querySelectorAll('.action-icon-button')].map((button) => {
            const a = button.getBoundingClientRect(),
              b = button.querySelector('svg').getBoundingClientRect();
            return { width: a.width, height: a.height, iconWidth: b.width, iconHeight: b.height };
          }),
        );
        assert.equal(recordButtons.length, 2);
        assert.deepEqual(recordButtons[0], recordButtons[1]);
        const transcript = main.locator('.record-transcript-scroll');
        const borderNormal = await transcript.evaluate(
          (element) => getComputedStyle(element, '::-webkit-scrollbar-thumb').borderLeftWidth,
        );
        await main.getByRole('button', { name: 'AI 回答面板', exact: true }).click();
        await main.waitForTimeout(80);
        const answerWidth = await main
          .locator('.record-answer-panel > header')
          .evaluate((element) => element.getBoundingClientRect().width);
        await main.waitForTimeout(200);
        assert.ok(
          Math.abs(
            answerWidth -
              (await main
                .locator('.record-answer-panel > header')
                .evaluate((element) => element.getBoundingClientRect().width)),
          ) < 1,
        );
        assert.notEqual(
          await transcript.evaluate(
            (element) => getComputedStyle(element, '::-webkit-scrollbar-thumb').borderLeftWidth,
          ),
          borderNormal,
        );
        await main.locator('.record-answer-scroll').evaluate((element) => {
          element.scrollTop = 450;
        });
        await transcript.evaluate((element) => {
          element.scrollTop = 600;
        });
        await main.waitForTimeout(150);
        const answerChrome = await main.locator('.record-answer-panel').evaluate((panel) => {
          const header = panel.querySelector('header'),
            scroll = panel.querySelector('.record-answer-scroll');
          return {
            opacity: Number(getComputedStyle(header, '::before').opacity),
            filter: getComputedStyle(header, '::before').backdropFilter,
            track: parseFloat(getComputedStyle(scroll, '::-webkit-scrollbar-track').marginTop),
            height: header.getBoundingClientRect().height,
            clear:
              header.getBoundingClientRect().right <=
              scroll.getBoundingClientRect().left + scroll.clientWidth + 1,
          };
        });
        assert.ok(
          answerChrome.opacity > 0.9 &&
            answerChrome.filter.includes('24px') &&
            answerChrome.track >= answerChrome.height - 1 &&
            answerChrome.clear,
          JSON.stringify(answerChrome),
        );
        await main.screenshot({ path: path.join(directory, 'history-detail.png') });
        await main.getByRole('button', { name: '新对话', exact: true }).click();
        await main.getByRole('button', { name: '个人信息', exact: true }).click();
        await main.waitForTimeout(250);
        const personalWidth = await main
          .locator('.personal-panel-scroll')
          .evaluate((element) => element.getBoundingClientRect().width);
        await main.getByRole('button', { name: '个人信息', exact: true }).click();
        await main.waitForTimeout(250);
        await main.getByRole('button', { name: '个人信息', exact: true }).click();
        await main.waitForTimeout(80);
        assert.ok(
          Math.abs(
            personalWidth -
              (await main
                .locator('.personal-panel-scroll')
                .evaluate((element) => element.getBoundingClientRect().width)),
          ) < 1,
        );
        await main.waitForTimeout(180);
        await main.locator('.personal-panel-scroll').evaluate((element) => {
          element.scrollTop = 400;
        });
        await main.waitForTimeout(100);
        await main.getByRole('button', { name: '收起侧栏', exact: true }).click();
        await main.waitForTimeout(230);
        await main.getByRole('button', { name: '展开侧栏', exact: true }).click();
        await main.waitForTimeout(80);
        assert.ok(
          Math.abs(
            (await main
              .locator('.sidebar nav')
              .evaluate((element) => element.getBoundingClientRect().width)) - 210,
          ) < 0.1,
        );
        await main.waitForTimeout(160);
        const infoButton = await main
          .locator('#personal-info-panel > header .sync-indicator-button')
          .boundingBox();
        assert.ok(
          Math.abs(infoButton.width - recordButtons[0].width) < 1 &&
            Math.abs(infoButton.height - recordButtons[0].height) < 1,
        );
        await main.screenshot({ path: path.join(directory, 'personal-info.png') });
        await main.getByRole('button', { name: '个人信息', exact: true }).click();
        await main.getByRole('button', { name: '用户菜单', exact: true }).click();
        await main.getByRole('menuitem', { name: '设置', exact: true }).click();
        for (const width of [1280, 960]) {
          await app.evaluate(
            ({ BrowserWindow }, width) =>
              BrowserWindow.getAllWindows()
                .find((w) => w.isVisible())
                .setSize(width, width === 960 ? 680 : 800),
            width,
          );
          for (const dark of [false, true]) {
            await settings.getByRole('button', { name: '通用', exact: true }).click();
            await settings.getByRole('button', { name: '外观主题', exact: true }).click();
            await settings
              .getByRole('menuitemradio', { name: dark ? '深色' : '浅色', exact: true })
              .click();
            for (const category of ['VoxCue 账号', 'AI 服务', '面试设置', '关于与更新']) {
              await settings.getByRole('button', { name: category, exact: true }).click();
              await settings.getByRole('heading', { name: category, exact: true }).hover();
              await main.waitForTimeout(300);
              assert.ok(
                await settings.evaluate((e) => {
                  const r = e.getBoundingClientRect();
                  return (
                    r.left >= 0 &&
                    r.top >= 0 &&
                    r.right <= innerWidth + 1 &&
                    r.bottom <= innerHeight + 1
                  );
                }),
              );
              if (category === '关于与更新') {
                assert.equal(await settings.getByText('平台', { exact: true }).count(), 0);
                assert.equal(await settings.getByText('本地文件存储', { exact: true }).count(), 0);
                assert.equal(await settings.getByText('当前版本', { exact: true }).count(), 0);
              }
              if (category === '面试设置') {
                const headingTop = await settings
                  .locator('.settings-content-heading')
                  .evaluate((element) => element.getBoundingClientRect().top);
                await settings.locator('.settings-content-body').evaluate((element) => {
                  element.scrollTop = 450;
                });
                await main.waitForTimeout(100);
                const chrome = await settings
                  .locator('.settings-content-heading')
                  .evaluate((element) => ({
                    top: element.getBoundingClientRect().top,
                    filter: getComputedStyle(element, '::before').backdropFilter,
                    opacity: Number(getComputedStyle(element, '::before').opacity),
                  }));
                assert.ok(
                  Math.abs(headingTop - chrome.top) < 1 &&
                    chrome.filter.includes('24px') &&
                    chrome.opacity > 0.9,
                  JSON.stringify({ headingTop, ...chrome }),
                );
              }
              await main.screenshot({
                path: path.join(
                  directory,
                  `settings-${width}-${dark ? 'dark' : 'light'}-${category}.png`,
                ),
              });
            }
          }
        }
        await settings.getByRole('button', { name: '关闭设置', exact: true }).click();
        await app.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()
            .find((win) => win.isVisible())
            .setSize(960, 600),
        );
        await main.getByRole('button', { name: '知识库', exact: true }).click();
        await main.locator('.knowledge-card').filter({ hasText: '合成知识库' }).click();
        const knowledgeTop = await detail
          .locator(':scope > .dialog-heading')
          .evaluate((element) => element.getBoundingClientRect().top);
        await detail.locator(':scope > .dialog-scroll').evaluate((element) => {
          element.scrollTop = element.scrollHeight;
        });
        await main.waitForTimeout(150);
        const knowledgeChrome = await detail.evaluate((dialog) => {
          const heading = dialog.querySelector(':scope > .dialog-heading'),
            scroll = dialog.querySelector(':scope > .dialog-scroll');
          return {
            top: heading.getBoundingClientRect().top,
            opacity: Number(getComputedStyle(heading, '::before').opacity),
            filter: getComputedStyle(heading, '::before').backdropFilter,
            track: parseFloat(getComputedStyle(scroll, '::-webkit-scrollbar-track').marginTop),
            height: heading.getBoundingClientRect().height,
            clear:
              heading.getBoundingClientRect().right <=
              scroll.getBoundingClientRect().left + scroll.clientWidth + 1,
          };
        });
        assert.ok(
          Math.abs(knowledgeTop - knowledgeChrome.top) < 1 &&
            knowledgeChrome.opacity > 0.9 &&
            knowledgeChrome.filter.includes('24px') &&
            knowledgeChrome.track >= knowledgeChrome.height - 1 &&
            knowledgeChrome.clear,
          JSON.stringify(knowledgeChrome),
        );
        await main.screenshot({ path: path.join(directory, 'knowledge-header-scroll.png') });
        console.log('VISUAL_DIRECTORY=' + directory);
        await new Promise((resolve) => setTimeout(resolve, 45000));
      }
      console.log(
        `Cloud client ${process.platform} smoke: primary registration, encrypted credentials, independent AI settings, three sync categories, exact counts, 100 MB shared quota with profile priority, matched cloud icons, light/dark geometry and cloud-only file deletion passed.`,
      );
    }
  }
} finally {
  if (app) await closeUiApp(app);
  await Promise.all([api.close(), outbox.stop(), services.close()]);
  store.close();
}
