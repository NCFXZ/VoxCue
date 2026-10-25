import { testRoot, electron } from './test-workspace.mjs';
import { offlineElectronEntry } from './offline-electron-entry.mjs';
import { closeUiApp, installUiAccount } from './install-ui-account.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const profile = path.join(testRoot, 'profile');
for (const directory of [profile, path.join(testRoot, 'home'), path.join(testRoot, 'tmp')])
  await mkdir(directory, { recursive: true });
const fixture = path.join(testRoot, 'copilot-login.cjs');
await writeFile(
  fixture,
  `
const {app,shell}=require('electron');
const root=process.cwd();
app.setAppPath(root);
const {CopilotRuntime}=require(root+'/dist-electron/shared/electron/backend/copilot/runtime.js');
const state=globalThis.copilotLoginFixture={cancelled:0,logout:0,quotaWaiters:[]};
const accounts={
  get:async()=>({kind:'activeAccount',authInfo:{type:'user',host:'https://github.com',login:'Synthetic'}}),
  set:async()=>{state.logout++;return {ok:true};},
  login:{
    begin:async()=>{state.complete=null;state.begun=(state.begun??0)+1;return {flowId:'synthetic-flow',step:{kind:'open-url',url:'https://github.com/login/oauth/authorize?client_id=synthetic&state=synthetic&code_challenge=synthetic&code_challenge_method=S256&redirect_uri=http%3A%2F%2F127.0.0.1%3A12345%2Fcallback'}};},
    advance:()=>new Promise(resolve=>{state.complete=()=>resolve({kind:'completed',result:{status:'completed',host:'https://github.com',login:'Synthetic'}});}),
    cancel:async()=>{state.cancelled++;}
  }
};
const quota={refresh:async()=>{
  if(state.holdQuota)await new Promise(resolve=>state.quotaWaiters.push(resolve));
  if(state.quotaMode==='failed')throw Error('credential=synthetic-private');
  if(state.quotaMode==='missing')return {planTier:'free',snapshots:{}};
  return {planTier:'free',providerQuotas:[{
    provider:{kind:'copilot',id:'synthetic-account',label:'Synthetic'},
    observationKind:'account_snapshot',acquisitionStatus:'succeeded',quotaId:'ai_credits',unit:'ai_credits',
    quantityKind:'authoritative_budget',accessState:'allowed',capacityState:state.quotaMode==='exhausted'?'exhausted':'available',
    budgetMetadata:{entitlement:100,consumed:state.quotaMode==='exhausted'?100:25,remainingPercentage:state.quotaMode==='exhausted'?0:75,
      unlimited:false,resetAtEpochMs:Date.now()+7*86400000,usageAllowedWhenExhausted:false,overageAllowedWhenExhausted:false}
  }]};
}};
CopilotRuntime.prototype.control=async()=>({rpc:{accounts,quota}});
CopilotRuntime.prototype.client=async()=>({rpc:{models:{list:async()=>({models:[{id:'synthetic-copilot',name:'Synthetic Copilot',vendor:'Synthetic Vendor'}]})}}});
shell.openExternal=async url=>{state.url=url;};
require(root+'/dist-electron/shared/electron/main.js');
`,
);
const env = {
  ...process.env,
  COPILOT_TEST_USER_DATA: profile,
  CFFIXED_USER_HOME: path.join(testRoot, 'home'),
  TMPDIR: path.join(testRoot, 'tmp'),
  VITE_DEV_SERVER_URL: '',
};
delete env.ELECTRON_RUN_AS_NODE;
const entry = await offlineElectronEntry(fixture);
let app;
try {
  app = await electron.launch({ args: [entry], env });
  let page = await app.firstWindow();
  const copilot = page.getByRole('button', { name: '使用 GitHub Copilot 继续', exact: true });
  const chatGPT = page.getByRole('button', { name: '使用 ChatGPT 继续', exact: true });
  await copilot.waitFor();
  assert.equal(await page.locator('.service-login').count(), 2);
  await copilot.click();
  await page.getByRole('button', { name: '等待浏览器授权…', exact: true }).waitFor();
  assert.equal(await chatGPT.isDisabled(), true);
  await page.getByRole('button', { name: '取消登录', exact: true }).click();
  await page.getByRole('alert').getByText('登录已取消', { exact: false }).waitFor();
  assert.equal(await copilot.isEnabled(), true);
  assert.equal(await page.evaluate(() => window.desktop.authSession()), null);
  assert.ok(await app.evaluate(() => globalThis.copilotLoginFixture.cancelled > 0));
  await copilot.click();
  await page.waitForFunction(() => document.querySelector('.login-actions button')?.disabled);
  const mainOpened = app.waitForEvent('window');
  await app.evaluate(async () => {
    const deadline = Date.now() + 5000;
    while (globalThis.copilotLoginFixture.begun !== 2 || !globalThis.copilotLoginFixture.complete) {
      if (Date.now() > deadline) throw Error('Synthetic authorization did not begin');
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    globalThis.copilotLoginFixture.complete();
  });
  const main = await mainOpened;
  await main.getByRole('button', { name: '开始面试', exact: true }).waitFor();
  assert.equal((await main.evaluate(() => window.desktop.authSession())).mode, 'copilot');
  const models = await main.evaluate(() => window.desktop.chatModels(true));
  assert.ok(models.ok);
  assert.equal(models.models[0].provider.id, 'copilot');
  assert.equal(models.models[0].id, 'synthetic-copilot');
  // Menu tracking is outside this test; select Settings through its existing action.
  await main.getByRole('button', { name: '用户菜单', exact: true }).click();
  const settingsMenu = main.getByRole('menuitem', { name: '设置', exact: true });
  await settingsMenu.click();
  const settings = main.getByRole('dialog', { name: '设置', exact: true });
  await settings.waitFor();
  await app.evaluate(() => {
    globalThis.copilotLoginFixture.holdQuota = true;
  });
  await settings.getByRole('button', { name: '账户与用量', exact: true }).click();
  const account = settings.getByRole('region', { name: '账户额度', exact: true });
  const loading = account.getByRole('status', { name: '正在读取账户额度', exact: true });
  const releaseQuota = () =>
    app.evaluate(() => {
      const fixture = globalThis.copilotLoginFixture;
      fixture.holdQuota = false;
      fixture.quotaWaiters.splice(0).forEach((resolve) => resolve());
    });
  await loading.waitFor();
  assert.equal(await account.getAttribute('aria-busy'), 'true');
  assert.equal(
    await account.getByRole('progressbar').count(),
    0,
    'Loading cannot imply a quota percentage',
  );
  await releaseQuota();
  await account.getByText('剩余 75%', { exact: true }).waitFor();
  await loading.waitFor({ state: 'hidden' });
  assert.equal(await account.getByRole('button', { name: '重置用量', exact: true }).count(), 0);
  assert.equal(await account.getByText('Copilot Free', { exact: true }).count(), 1);
  assert.equal(await account.getByText('100 AI Credits', { exact: true }).count(), 0);
  assert.equal(
    await account.locator('.account-quota-reset').count(),
    1,
    'Official reset replaces numeric details',
  );
  const officialUsage = account.getByRole('link', { name: '查看官方用量', exact: true });
  assert.equal(await officialUsage.getAttribute('href'), 'https://github.com/settings/copilot');
  await officialUsage.click();
  assert.equal(
    await app.evaluate(() => globalThis.copilotLoginFixture.url),
    'https://github.com/settings/copilot',
  );
  assert.equal(await settings.isVisible(), true, 'External link keeps the current settings page');
  const refresh = account.getByRole('button', { name: '刷新账户额度', exact: true });
  for (const [mode, text] of [
    ['exhausted', '剩余 0%'],
    ['missing', '账户额度暂不可用，请刷新或查看 GitHub 官方用量。'],
    ['failed', '账户额度暂不可用，请稍后刷新或查看 GitHub 官方用量。'],
  ]) {
    await app.evaluate((_electron, mode) => {
      globalThis.copilotLoginFixture.quotaMode = mode;
    }, mode);
    await refresh.click();
    await account.getByText(text, { exact: true }).waitFor();
    if (mode !== 'exhausted') assert.equal(await account.getByRole('progressbar').count(), 0);
    assert.ok(!(await account.innerText()).includes('synthetic-private'));
  }
  await app.evaluate(() => {
    globalThis.copilotLoginFixture.quotaMode = 'ready';
  });
  const mainWindow = await app.browserWindow(main);
  const skeletonColors = [];
  for (const theme of ['light', 'dark']) {
    await app.evaluate(({ nativeTheme }, theme) => {
      nativeTheme.themeSource = theme;
    }, theme);
    await main.emulateMedia({ colorScheme: theme });
    await refresh.click();
    await account.getByText('剩余 75%', { exact: true }).waitFor();
    for (const [width, height] of [
      [1280, 800],
      [960, 680],
    ]) {
      // Windows fractional DPI rounds content bounds to physical pixels. Wait
      // for the actual native content width, preserving exact renderer agreement.
      const contentWidth = await mainWindow.evaluate(
        (win, size) => {
          win.setContentSize(...size);
          return win.getContentSize()[0];
        },
        [width, height],
      );
      await main.waitForFunction((width) => window.innerWidth === width, contentWidth);
      await app.evaluate(() => {
        globalThis.copilotLoginFixture.holdQuota = true;
      });
      await refresh.click();
      await loading.waitFor();
      assert.equal(await refresh.isDisabled(), true);
      assert.equal(await account.getByRole('progressbar').count(), 0);
      assert.ok(
        !(await account.innerText()).includes('剩余 75%'),
        'Refresh does not present stale quota values',
      );
      const skeleton = await account.locator('.account-quota-skeleton').evaluate((card) => {
        const line = card.querySelector('.quota-skeleton-line');
        const metrics = [...card.querySelectorAll('.account-quota-details > div')];
        return {
          hidden: card.closest('[aria-hidden="true"]') !== null,
          width: card.getBoundingClientRect().width,
          height: card.getBoundingClientRect().height,
          reset: !!card.querySelector('.account-quota-reset'),
          panelWidth: card.closest('.usage-panel').getBoundingClientRect().width,
          metrics: metrics.map((node) => node.getBoundingClientRect().y),
          color: getComputedStyle(line, '::before').backgroundColor,
          animation: getComputedStyle(line, '::after').animationName,
          transform: getComputedStyle(line, '::after').transform,
        };
      });
      assert.ok(skeleton.hidden, 'Decorative skeleton has no fake accessible values');
      assert.ok(Math.abs(skeleton.width - skeleton.panelWidth) < 1);
      assert.equal(
        skeleton.metrics.length,
        0,
        'Known reset replaces numeric details in the skeleton',
      );
      assert.equal(skeleton.animation, 'quota-skeleton-sweep');
      await main.waitForFunction((previous) => {
        const line = document.querySelector('.account-quota-skeleton .quota-skeleton-line');
        return line && getComputedStyle(line, '::after').transform !== previous;
      }, skeleton.transform);
      await main.screenshot();
      if (width === 1280) skeletonColors.push(skeleton.color);
      await main.emulateMedia({ reducedMotion: 'reduce' });
      assert.equal(
        await account
          .locator('.account-quota-skeleton .quota-skeleton-line')
          .first()
          .evaluate((line) => getComputedStyle(line, '::after').animationName),
        'none',
      );
      await main.emulateMedia({ reducedMotion: 'no-preference' });
      await releaseQuota();
      await account.getByText('剩余 75%', { exact: true }).waitFor();
      await loading.waitFor({ state: 'hidden' });
      const layout = await account.evaluate((panel) => {
        const card = panel.querySelector('.account-quota');
        const metrics = [...card.querySelectorAll('.account-quota-details > div')];
        const reset = card.querySelector('.account-quota-reset').getBoundingClientRect();
        const remaining = card.querySelector('.account-quota-remaining').getBoundingClientRect();
        const resetStyle = getComputedStyle(card.querySelector('.account-quota-reset'));
        const remainingStyle = getComputedStyle(card.querySelector('.account-quota-remaining'));
        const content = panel.closest('.settings-content');
        const link = panel.querySelector('.account-usage-link');
        const style = getComputedStyle(link);
        return {
          panelWidth: panel.getBoundingClientRect().width,
          cardWidth: card.getBoundingClientRect().width,
          cardHeight: card.getBoundingClientRect().height,
          metrics: metrics.map((node) => ({
            y: node.getBoundingClientRect().y,
            labelY: node.querySelector('dt').getBoundingClientRect().y,
            valueY: node.querySelector('dd').getBoundingClientRect().y,
            valueX: node.querySelector('dd').getBoundingClientRect().x,
            labelRight: node.querySelector('dt').getBoundingClientRect().right,
          })),
          alignedSummary: Math.abs(reset.y - remaining.y) < 1,
          matchingSummaryStyle: [
            'fontSize',
            'fontWeight',
            'fontFamily',
            'lineHeight',
            'color',
          ].every((property) => resetStyle[property] === remainingStyle[property]),
          fits:
            content.scrollWidth <= content.clientWidth &&
            content.scrollHeight <= content.clientHeight,
          linkDecoration: style.textDecorationLine,
          linkBackground: style.backgroundColor,
          linkBorder: style.borderTopWidth,
          nativeLink: link.classList.contains('macos-content-native'),
        };
      });
      assert.ok(
        Math.abs(layout.cardWidth - layout.panelWidth) < 1,
        'Quota card fills the content width',
      );
      assert.ok(
        Math.abs(layout.cardHeight - skeleton.height) < 1,
        'Skeleton and final card share their height',
      );
      assert.equal(skeleton.reset, true);
      assert.equal(layout.metrics.length, 0, 'Known reset replaces used and remaining quantities');
      assert.ok(layout.alignedSummary, 'Reset and remaining percentage share a row');
      assert.ok(layout.matchingSummaryStyle, 'Reset and remaining use the same font and color');
      assert.ok(layout.fits, 'Account content fits without overflow or unnecessary scrolling');
      assert.ok(layout.linkDecoration.includes('underline'));
      assert.equal(layout.linkBackground, 'rgba(0, 0, 0, 0)');
      assert.equal(layout.linkBorder, '0px');
      assert.equal(layout.nativeLink, false, 'Text link does not acquire a native button');
      await officialUsage.focus();
      await officialUsage.press('Enter');
      assert.equal(
        await app.evaluate(() => globalThis.copilotLoginFixture.url),
        'https://github.com/settings/copilot',
      );
      await main.screenshot();
    }
  }
  assert.notEqual(
    skeletonColors[0],
    skeletonColors[1],
    'Skeleton colors follow the appearance theme',
  );
  await settings.getByRole('button', { name: '关闭设置', exact: true }).click();
  // The saved service and identity must restore without running OAuth again.
  await closeUiApp(app);
  app = undefined;
  app = await electron.launch({ args: [entry], env });
  page = await app.firstWindow();
  await page.getByRole('button', { name: '开始面试', exact: true }).waitFor();
  assert.equal((await page.evaluate(() => window.desktop.authSession())).mode, 'copilot');
  const loginOpened = app.waitForEvent('window');
  await page.evaluate(() => window.desktop.signOut());
  page = await loginOpened;
  await page.getByRole('button', { name: '使用 GitHub Copilot 继续', exact: true }).waitFor();
  assert.equal(await app.evaluate(() => globalThis.copilotLoginFixture.logout), 1);
  assert.equal(await page.evaluate(() => window.desktop.authSession()), null);
  await installUiAccount(app);
  const chatGPTOpened = app.waitForEvent('window');
  await page.getByRole('button', { name: '使用 ChatGPT 继续', exact: true }).click();
  page = await chatGPTOpened;
  await page.getByRole('button', { name: '开始面试', exact: true }).waitFor();
  assert.equal((await page.evaluate(() => window.desktop.authSession())).mode, 'chatgpt');
  const switched = await page.evaluate(() => window.desktop.chatModels(true));
  assert.ok(switched.ok);
  assert.equal(switched.models[0].provider.id, 'chatgpt');
  await page.getByRole('button', { name: '用户菜单', exact: true }).click();
  await page.getByRole('menuitem', { name: '设置', exact: true }).click();
  const chatGPTSettings = page.getByRole('dialog', { name: '设置', exact: true });
  await chatGPTSettings.getByRole('button', { name: '账户与用量', exact: true }).click();
  await app.evaluate(({ app }) => {
    const require = process
      .getBuiltinModule('module')
      .createRequire(app.getAppPath() + '/package.json');
    const { CodexUsageRuntime } = require(
      app.getAppPath() + '/dist-electron/shared/electron/backend/chat/codexUsage.js',
    );
    const { ChatGPTAuthService } = require(
      app.getAppPath() + '/dist-electron/shared/electron/backend/auth/service.js',
    );
    const f = (globalThis.chatGPTUsageFixture = { mode: 'both', waiters: [] });
    ChatGPTAuthService.prototype.usageIdentity = async () => ({
      account: 'synthetic-account',
      email: 'synthetic@example.test',
    });
    CodexUsageRuntime.prototype.account = async () => ({
      email: 'synthetic@example.test',
      planType: f.mode === 'weekly' ? 'pro' : 'plus',
    });
    CodexUsageRuntime.prototype.limits = async () => {
      if (f.hold) await new Promise((resolve) => f.waiters.push(resolve));
      if (f.mode === 'failed') throw Error('synthetic-private-quota');
      return {
        rateLimitsByLimitId: {
          codex: {
            planType: f.mode === 'weekly' ? 'pro' : 'plus',
            primary:
              f.mode === 'weekly'
                ? null
                : {
                    usedPercent: 25,
                    windowDurationMins: 300,
                    resetsAt: Math.floor(Date.now() / 1000) + 4 * 3600 + 900,
                  },
            secondary: {
              usedPercent: f.mode === 'weekly' ? 10 : 40,
              windowDurationMins: 10080,
              resetsAt: Math.floor(Date.now() / 1000) + 6 * 86400 + 7 * 3600 + 1800,
            },
          },
        },
      };
    };
  });
  const chatAccount = chatGPTSettings.getByRole('region', { name: '账户额度', exact: true });
  await chatAccount.getByRole('button', { name: '刷新账户额度', exact: true }).click();
  assert.equal(
    await chatAccount.getByRole('button', { name: '连接 ChatGPT 用量', exact: true }).count(),
    0,
  );
  await chatAccount.getByText('5小时额度', { exact: true }).waitFor();
  assert.equal(await chatAccount.getByText('每周额度', { exact: true }).count(), 1);
  assert.equal(await chatAccount.getByRole('progressbar').count(), 2);
  assert.equal(await chatAccount.locator('.account-quota-details').count(), 0);
  assert.equal(await chatAccount.getByText('4小时15分钟后重置', { exact: true }).count(), 1);
  assert.equal(await chatAccount.getByText('6天7小时后重置', { exact: true }).count(), 1);
  const cardGeometry = () =>
    chatAccount.locator('.account-quota').evaluateAll((cards) =>
      cards.map((card) => ({
        height: card.getBoundingClientRect().height,
        progress:
          card
            .querySelector('.account-quota-progress,.quota-skeleton-progress')
            .getBoundingClientRect().y - card.getBoundingClientRect().y,
        reset:
          card.querySelector('.account-quota-reset').getBoundingClientRect().y -
          card.getBoundingClientRect().y,
        remaining:
          card.querySelector('.account-quota-remaining').getBoundingClientRect().y -
          card.getBoundingClientRect().y,
        titleGap:
          card.querySelector('.account-quota-summary').getBoundingClientRect().top -
          card.querySelector('header').getBoundingClientRect().bottom,
        rowGap: getComputedStyle(card).rowGap,
        barGap:
          card
            .querySelector('.account-quota-progress,.quota-skeleton-progress')
            .getBoundingClientRect().top -
          card.querySelector('.account-quota-summary').getBoundingClientRect().bottom,
        resetFont: ['fontSize', 'fontWeight', 'fontFamily', 'lineHeight'].map(
          (property) => getComputedStyle(card.querySelector('.account-quota-reset'))[property],
        ),
        remainingFont: ['fontSize', 'fontWeight', 'fontFamily', 'lineHeight'].map(
          (property) => getComputedStyle(card.querySelector('.account-quota-remaining'))[property],
        ),
        resetColor: getComputedStyle(card.querySelector('.account-quota-reset')).color,
        remainingColor: getComputedStyle(card.querySelector('.account-quota-remaining')).color,
      })),
    );
  const finalGeometry = await cardGeometry();
  for (const geometry of finalGeometry) {
    assert.ok(Math.abs(geometry.reset - geometry.remaining) < 1);
    assert.deepEqual(geometry.resetFont, geometry.remainingFont);
    assert.equal(geometry.resetColor, geometry.remainingColor);
    assert.equal(geometry.rowGap, '4px');
    // Normalize DOMRect float representation to Chromium's 1/64 CSS-pixel
    // layout unit; fractional Windows DPI otherwise produces 3.99999046.
    assert.equal(Math.round(geometry.titleGap * 64), 4 * 64);
    assert.equal(Math.round(geometry.barGap * 64), 4 * 64, 'Both quota windows have 4px row gaps');
  }
  await app.evaluate(() => {
    globalThis.chatGPTUsageFixture.hold = true;
  });
  await chatAccount.getByRole('button', { name: '刷新账户额度', exact: true }).click();
  await chatAccount.getByRole('status', { name: '正在读取账户额度', exact: true }).waitFor();
  assert.equal(await chatAccount.locator('.account-quota-skeleton').count(), 2);
  assert.deepEqual(
    await cardGeometry(),
    finalGeometry,
    'Both window skeletons align with final title/bar/reset geometry',
  );
  assert.equal(await chatAccount.getByRole('progressbar').count(), 0);
  await app.evaluate(() => {
    const f = globalThis.chatGPTUsageFixture;
    f.hold = false;
    f.waiters.splice(0).forEach((resolve) => resolve());
  });
  await chatAccount.getByText('5小时额度', { exact: true }).waitFor();
  for (const theme of ['light', 'dark']) {
    await app.evaluate(({ nativeTheme }, theme) => {
      nativeTheme.themeSource = theme;
    }, theme);
    await page.emulateMedia({ colorScheme: theme });
    await app.evaluate(() => {
      globalThis.chatGPTUsageFixture.mode = 'weekly';
    });
    await chatAccount.getByRole('button', { name: '刷新账户额度', exact: true }).click();
    await chatAccount.getByText('剩余 90%', { exact: true }).waitFor();
    assert.equal(await chatAccount.getByText('5小时额度', { exact: true }).count(), 0);
    assert.equal(await chatAccount.getByRole('progressbar').count(), 1);
    assert.equal(await chatAccount.getByText('ChatGPT Pro', { exact: true }).count(), 1);
    await page.screenshot();
  }
  await app.evaluate(() => {
    globalThis.chatGPTUsageFixture.mode = 'failed';
  });
  await chatAccount.getByRole('button', { name: '刷新账户额度', exact: true }).click();
  await chatAccount
    .getByRole('alert')
    .getByText('ChatGPT 账户额度暂不可用，请刷新或查看官方用量。', { exact: true })
    .waitFor();
  assert.equal(await chatAccount.getByRole('progressbar').count(), 0);
  assert.ok(!(await chatAccount.innerText()).includes('synthetic-private'));
  const chatGPTUsage = chatGPTSettings.getByRole('link', { name: '查看官方用量', exact: true });
  assert.equal(await chatGPTUsage.getAttribute('href'), 'https://chatgpt.com/settings/usage');
  await chatGPTUsage.click();
  assert.equal(
    await app.evaluate(() => globalThis.copilotLoginFixture.url),
    'https://chatgpt.com/settings/usage',
  );
  console.log(
    'PASS: Copilot login, account quota (available/exhausted/missing/failed), compact metrics, loading skeleton and reduced motion, light/dark settings, cancellation/retry, model routing, restart restore, logout and switching to ChatGPT (offline synthetic accounts).',
  );
} finally {
  if (app) await closeUiApp(app);
}
