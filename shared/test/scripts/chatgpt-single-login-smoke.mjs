import { closeUiApp, enterPrimaryUiAccount, openModelMenu, returnToUiLogin, waitForRestoredMainWindow } from './install-ui-account.mjs';
import { testRoot, electron } from './test-workspace.mjs';
import { offlineElectronEntry } from './offline-electron-entry.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

for (const name of ['profile', 'home', 'tmp']) await mkdir(path.join(testRoot, name));
const fixture = path.join(testRoot, 'single-login.cjs');
await writeFile(
  fixture,
  `
const {shell}=require('electron');
const fs=require('node:fs');const path=require('node:path');const root=process.cwd();
const file=path.join(process.env.COPILOT_TEST_USER_DATA,'synthetic-session.json');
const state=globalThis.singleLoginFixture=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):{active:false,opens:0,quotaReads:0,chatCalls:0};
const save=()=>fs.writeFileSync(file,JSON.stringify(state));
const reads=globalThis.providerReads={chatgpt:0,copilot:0};
const copilotStorage=require(root+'/dist-electron/shared/electron/backend/copilot/storage.js');
const createCopilotStorage=copilotStorage.createCopilotLoginStorage;
copilotStorage.createCopilotLoginStorage=(profileRoot)=>{
  const port=createCopilotStorage(profileRoot);
  return {...port, read:()=>{reads.copilot++;return port.read();}};
};
const {CopilotRuntime}=require(root+'/dist-electron/shared/electron/backend/copilot/runtime.js');
CopilotRuntime.prototype.client=CopilotRuntime.prototype.control=async()=>{
  reads.copilot++;
  throw Error('Unexpected Copilot runtime access in ChatGPT fixture');
};
const codexModule=root+'/dist-electron/shared/electron/backend/chat/codexUsage.js';
// The ordinary offline entry stubs account(). Exercise the real request gate
// for the denial case and replace start() before it can launch the SDK.
if(process.env.VOXCUE_TEST_CHATGPT_DENIED==='1') delete require.cache[require.resolve(codexModule)];
const {CodexUsageRuntime}=require(codexModule);
const {ProviderCredentialUnavailable}=require(root+'/dist-electron/shared/electron/backend/auth/providerCredentialAccess.js');
const realAccount=CodexUsageRuntime.prototype.account;
CodexUsageRuntime.prototype.account=async function(){
  if (process.env.VOXCUE_TEST_CHATGPT_DENIED === '1') return realAccount.call(this);
  reads.chatgpt++;
  if (globalThis.fixtureAccessFailure) throw new ProviderCredentialUnavailable('chatgpt', globalThis.fixtureAccessFailure);
  return state.active?{email:'synthetic@example.test',planType:'plus'}:null;
};
if (process.env.VOXCUE_TEST_CHATGPT_DENIED === '1') {
  CodexUsageRuntime.prototype.start=async()=>{
    reads.chatgpt++;
    throw Object.assign(Error('Synthetic keychain: errSecUserCanceled'), {code:'errSecUserCanceled'});
  };
}
CodexUsageRuntime.prototype.access=async()=>{
  reads.chatgpt++;
  if(!state.active)throw Error('not signed in');
  return{token:'synthetic-private',account:'synthetic:workspace',chatgptAccountId:'workspace',email:'synthetic@example.test',name:'Synthetic',expiresAt:Date.now()+3600000};
};
shell.openExternal=async(url)=>{if(url.startsWith('https://auth.openai.com/')){state.opens++;save();}};
CodexUsageRuntime.prototype.login=async(open,signal)=>{
  signal.throwIfAborted();
  await open('https://auth.openai.com/authorize?state=synthetic');
  if(globalThis.failReconnect) throw Error('ChatGPT 登录未完成，请重试。');
  state.active=true;save();
};
CodexUsageRuntime.prototype.logout=async()=>{state.active=false;save();};
CodexUsageRuntime.prototype.limits=async()=>{reads.chatgpt++;if(!state.active)throw Error('not signed in');state.quotaReads++;save();return{accountId:'workspace',rateLimits:{planType:'plus',primary:{usedPercent:24.754,windowDurationMins:300},secondary:{usedPercent:81,windowDurationMins:10080}}};};
const previousFetch=globalThis.fetch;
globalThis.fetch=async(url,options)=>{
  if(!String(url).startsWith('https://chatgpt.com/backend-api/codex/'))return previousFetch(url,options);
  if(options.headers.authorization!=='Bearer synthetic-private'||options.headers['ChatGPT-Account-Id']!=='workspace')throw Error('Wrong session');
  if(String(url).includes('/models?')){
    state.modelReads=(state.modelReads??0)+1;
    return Response.json({models:[
      ...(state.futureModels?[{slug:'future-model-unknown',display_name:'Future fixture',visibility:'list'}]:[]),
      {slug:'synthetic-single',display_name:'Synthetic single',visibility:'list',supported_reasoning_levels:['low','high'],web_search_tool_type:'text'}
    ]});
  }
  if(!String(url).endsWith('/responses'))throw Error('Unexpected request');
  state.chatCalls++;save();
  const request=JSON.parse(options.body);
  state.lastModel=request.model;state.lastEffort=request.reasoning?.effort;save();
  const answer=request.text?.format?.schema?JSON.stringify({answer:'Synthetic single-login answer',changes:Object.fromEntries(Object.keys(request.text.format.schema.properties.changes.properties).map(key=>[key,null]))}):'Synthetic single-login answer';
  return new Response('data: '+JSON.stringify({type:'response.completed',response:{id:'synthetic-response-'+state.chatCalls,output:[{type:'message',content:[{type:'output_text',text:answer}]}]}})+String.fromCharCode(10,10),{headers:{'content-type':'text/event-stream'}});
};
require(root+'/dist-electron/shared/electron/main.js');
`,
);
const entry = await offlineElectronEntry(fixture);
const env = {
  ...process.env,
  COPILOT_TEST_USER_DATA: path.join(testRoot, 'profile'),
  CFFIXED_USER_HOME: path.join(testRoot, 'home'),
  TMPDIR: path.join(testRoot, 'tmp'),
  VITE_DEV_SERVER_URL: '',
};
delete env.ELECTRON_RUN_AS_NODE;
let app;
const assertNoProviderReads = async () => {
  assert.deepEqual(await app.evaluate(() => globalThis.providerReads), { chatgpt: 0, copilot: 0 });
};
async function openAISettings(page) {
  await page.getByRole('button', { name: '用户菜单', exact: true }).click();
  await page.getByRole('menuitem', { name: '设置', exact: true }).click();
  const settings = page.getByRole('dialog', { name: '设置', exact: true });
  await settings.getByRole('button', { name: 'AI 服务', exact: true }).click();
  await settings.locator('.ai-service-row').filter({ hasText: 'ChatGPT' }).waitFor();
  return settings;
}
async function measureFooter(text, footerSelector) {
  return text.evaluate(async (element, selector) => {
    await Promise.all(document.getAnimations()
      .filter((animation) => Number.isFinite(animation.effect?.getComputedTiming().endTime))
      .map((animation) => animation.finished.catch(() => {})));
    const footer = element.closest(selector);
    const divider = selector === '.settings-error'
      ? footer.closest('.ai-services-panel > .interview-reveal[data-open="true"]')
        ?.previousElementSibling?.querySelector(':scope > .ai-service-row[data-settings-target="copilot"]:last-child')
      : footer.previousElementSibling;
    if (!divider?.matches('.settings-entry') ||
        !parseFloat(getComputedStyle(divider).borderBottomWidth))
      throw Error('Expected a settings row divider above the footer');
    const row = divider.getBoundingClientRect();
    const box = footer.getBoundingClientRect();
    const extent = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    // DOMRect subtraction can leave floating-point noise below one Chromium layout unit.
    const layoutPixels = (value) => Math.round(value * 64) / 64;
    return {
      color: style.color,
      parentColor: getComputedStyle(footer.parentElement).color,
      layout: {
        fontSize: style.fontSize,
        lineHeight: style.lineHeight,
        fontWeight: style.fontWeight,
        dividerGap: layoutPixels(extent.top - row.bottom),
        textInset: layoutPixels(extent.left - row.left),
        footerRightInset: layoutPixels(row.right - box.right),
        bottomMargin: getComputedStyle(footer).marginBottom,
      },
    };
  }, footerSelector);
}
try {
  app = await electron.launch({ args: [entry], env });
  let page = await app.firstWindow();
  await page.getByRole('heading', { name: '登录 VoxCue', exact: true }).waitFor();
  await assertNoProviderReads();
  await page.getByRole('button', {name:'跳过登录', exact:true}).click();
  const local = await waitForRestoredMainWindow(app);
  await local.locator('.sidebar .user-info small').getByText('未连接 AI 服务', {exact:true}).waitFor();
  const localSettings = await openAISettings(local);
  assert.equal(await localSettings.locator('.ai-service-row').getByText('未连接', {exact:true}).count(), 2);
  await assertNoProviderReads();
  await localSettings.getByRole('button', { name: '关闭设置', exact: true }).click();
  page = await returnToUiLogin(app, local, '返回登录');
  page = await enterPrimaryUiAccount(app, page);
  await page.locator('.interview-start-trigger').waitFor();
  await assertNoProviderReads();
  const settings = await openAISettings(page);
  await assertNoProviderReads();
  const connectChatGPT = settings.locator('.ai-service-row').filter({ hasText: 'ChatGPT' })
    .getByRole('button', { name: '连接', exact: true });
  for (const [reason, notice] of [
    ['denied', 'ChatGPT 连接被拒绝，请重启 VoxCue 后重试。'],
    ['unavailable', 'ChatGPT 连接失败，请重启 VoxCue 后重试。'],
  ]) {
    await app.evaluate((_, reason) => { globalThis.fixtureAccessFailure = reason; }, reason);
    await connectChatGPT.click();
    await settings.getByRole('alert').getByText(notice, { exact: true }).waitFor();
  }
  assert.equal(await app.evaluate(() => globalThis.singleLoginFixture.opens), 0);
  // Use the normal offline development state, whose About footer shows only the preservation note.
  const update = await page.evaluate(() => window.desktop.updates({ op: 'status' }));
  assert.equal(update.phase, 'unavailable');
  assert.equal(update.message, '开发版本不检查线上更新，请使用 VoxCue 安装版。');
  for (const language of ['en', 'zh-CN']) {
    const english = language === 'en';
    await page.evaluate((value) => {
      localStorage.setItem('voxcue-language-v1', value);
      dispatchEvent(new StorageEvent('storage', { key: 'voxcue-language-v1' }));
    }, language);
    const dialog = page.getByRole('dialog', { name: english ? 'Settings' : '设置', exact: true });
    const alert = dialog.getByRole('alert').filter({
      hasText: english
        ? 'Couldn’t connect to ChatGPT. Restart VoxCue and try again.'
        : 'ChatGPT 连接失败，请重启 VoxCue 后重试。',
    });
    const aboutTab = dialog.getByRole('button', { name: english ? 'About & updates' : '关于与更新', exact: true });
    const aiTab = dialog.getByRole('button', { name: english ? 'AI services' : 'AI 服务', exact: true });
    const preservationNote = dialog.getByText(
      english ? 'Updates keep your local chats, attachments, profile and interview history.'
        : '更新会保留本机聊天、附件、个人资料和面试记录。', { exact: true },
    );
    for (const theme of ['light', 'dark']) {
      await page.evaluate((dark) => document.documentElement.classList.toggle('dark', dark), theme === 'dark');
      await alert.waitFor();
      const ai = await measureFooter(alert, '.settings-error');
      await aboutTab.click();
      await preservationNote.waitFor();
      await dialog.locator('.updates-notes').getByRole('status').waitFor({ state: 'detached' });
      assert.ok(await preservationNote.evaluate((note) =>
        note.matches('.updates-notes > p:only-child')));
      const about = await measureFooter(preservationNote, '.updates-footer');
      assert.deepEqual(ai.layout, about.layout, language + '/' + theme + ': footer alignment and typography');
      assert.equal(ai.layout.dividerGap, 16);
      assert.equal(ai.layout.textInset, 0);
      assert.equal(ai.layout.footerRightInset, 0);
      assert.equal(ai.color, ai.parentColor);
      assert.equal(about.color, theme === 'light' ? 'rgb(96, 106, 112)' : 'rgb(150, 159, 165)');
      assert.notEqual(ai.color, about.color);
      if (theme === 'light') console.log('Settings footer measurements', { language, theme, ai, about });
      await aiTab.click();
      await alert.waitFor();
    }
  }
  await app.evaluate(() => { delete globalThis.fixtureAccessFailure; });
  await connectChatGPT.click();
  await app.evaluate(async () => {
    const deadline = Date.now() + 5000;
    while (!globalThis.singleLoginFixture.quotaReads) {
      if (Date.now() > deadline) throw Error('Login did not load usage automatically');
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  });
  assert.equal(await app.evaluate(() => globalThis.singleLoginFixture.opens), 1);
  const session = await page.evaluate(() => window.desktop.authSession());
  assert.equal(session.mode, 'chatgpt');
  assert.ok(!JSON.stringify(session).includes('synthetic-private'));
  await settings.getByText('5小时额度', { exact: true }).waitFor();
  await settings.getByText('每周额度', { exact: true }).waitFor();
  assert.equal(
    await settings.getByRole('button', { name: '连接 ChatGPT 用量', exact: true }).count(),
    0,
  );
  await settings.getByRole('button', { name: '刷新账户额度', exact: true }).click();
  await settings.locator('.account-quota-remaining').getByText('剩余 75%', { exact: true }).waitFor();
  await settings.locator('.account-quota-remaining').getByText('剩余 19%', { exact: true }).waitFor();
  assert.equal(await app.evaluate(() => globalThis.singleLoginFixture.opens), 1);
  await settings.getByRole('button', { name: '关闭设置', exact: true }).click();
  await settings.waitFor({ state: 'hidden' });
  const models = await openModelMenu(page);
  const modelReads = await app.evaluate(() => {
    globalThis.singleLoginFixture.futureModels = true;
    return globalThis.singleLoginFixture.modelReads;
  });
  await models.getByRole('menuitem', { name: '刷新模型列表', exact: true }).click();
  await app.evaluate(async (before) => {
    const deadline = Date.now() + 5000;
    while (globalThis.singleLoginFixture.modelReads <= before) {
      if (Date.now() >= deadline) throw Error('The model refresh did not reach the catalog');
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }, modelReads);
  // Refresh keeps the modal catalog open. Its background trigger is outside the accessibility tree.
  await models.getByRole('menuitem', { name: '刷新模型列表', exact: true }).waitFor();
  const future = models.getByRole('menuitemradio', { name: 'Future fixture', exact: true });
  await future.waitFor();
  assert.equal(
    await models.getByRole('menuitemradio', { name: 'Synthetic single', exact: true }).getAttribute('aria-checked'),
    'true',
  );
  await future.click();
  await models.getByRole('button', { name: '选择模型', exact: true }).waitFor();
  assert.equal(await models.getByRole('slider').count(), 0);
  await page.keyboard.press('Escape');
  const composer = page;
  await composer
    .getByRole('textbox', { name: '聊天消息', exact: true })
    .fill('Synthetic single login question');
  await composer.getByRole('button', { name: '发送消息', exact: true }).click();
  await page
    .locator('.chat-message.assistant')
    .getByText('Synthetic single-login answer', { exact: true })
    .waitFor();
  assert.equal(await app.evaluate(() => globalThis.singleLoginFixture.opens), 1);
  assert.ok(await app.evaluate(() => globalThis.singleLoginFixture.chatCalls > 0));
  assert.deepEqual(await app.evaluate(() => ({
    model: globalThis.singleLoginFixture.lastModel,
    effort: globalThis.singleLoginFixture.lastEffort ?? null,
  })), { model: 'future-model-unknown', effort: null });
  const effortControl = await openModelMenu(page);
  await effortControl.getByRole('menuitemradio', { name: 'Synthetic single', exact: true }).click();
  const slider = effortControl.getByRole('slider', { name: '思考强度' });
  await slider.press('End');
  await page.keyboard.press('Escape');
  await composer.getByRole('textbox', { name: '聊天消息', exact: true }).fill('Explicit effort');
  await composer.getByRole('button', { name: '发送消息', exact: true }).click();
  await page.locator('.chat-message.assistant')
    .getByText('Synthetic single-login answer', { exact: true }).nth(1).waitFor();
  assert.deepEqual(await app.evaluate(() => ({
    model: globalThis.singleLoginFixture.lastModel,
    effort: globalThis.singleLoginFixture.lastEffort,
  })), { model: 'synthetic-single', effort: 'high' });
  assert.equal(await app.evaluate(() => globalThis.providerReads.copilot), 0);
  await closeUiApp(app);
  app = undefined;
  // With remembered authorization, a refusal stops the first credential read
  // before usage or login. Further session requests go through the same gate.
  app = await electron.launch({ args: [entry], env: { ...env, VOXCUE_TEST_CHATGPT_DENIED: '1' } });
  page = await waitForRestoredMainWindow(app);
  const deniedSettings = await openAISettings(page);
  await deniedSettings.getByRole('alert').getByText('ChatGPT 连接被拒绝，请重启 VoxCue 后重试。', { exact: true }).waitFor();
  for (let i = 0; i < 2; i++)
    await assert.rejects(() => page.evaluate(() => window.desktop.authSession('chatgpt')), /ChatGPT 连接被拒绝/);
  assert.deepEqual(await app.evaluate(() => globalThis.providerReads), { chatgpt: 1, copilot: 0 });
  assert.equal(await app.evaluate(() => globalThis.singleLoginFixture.opens), 1);
  await closeUiApp(app);
  app = undefined;
  app = await electron.launch({ args: [entry], env });
  page = await waitForRestoredMainWindow(app);
  const sidebarQuota = page.locator('.sidebar .user-info .account-usage-summary');
  await sidebarQuota.getByText('ChatGPT 用量', { exact: true }).waitFor();
  await sidebarQuota.getByText('5小时 75%', { exact: true }).waitFor();
  await sidebarQuota.getByText('每周 19%', { exact: true }).waitFor();
  assert.ok(await app.evaluate(() => globalThis.providerReads.chatgpt > 0));
  assert.equal(await app.evaluate(() => globalThis.providerReads.copilot), 0);
  assert.equal(await app.evaluate(() => globalThis.singleLoginFixture.opens), 1);
  const restoredSettings = await openAISettings(page);
  await restoredSettings.locator('.ai-service-row').filter({ hasText: 'ChatGPT' })
    .getByRole('button', { name: '断开连接', exact: true }).waitFor();
  await restoredSettings.getByRole('button', { name: '关闭设置', exact: true }).click();
  const calls = await app.evaluate(() => globalThis.singleLoginFixture.chatCalls);
  await page.getByRole('textbox', { name: '聊天消息', exact: true }).fill('Question after restart');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await app.evaluate(async (previous) => {
    const deadline = Date.now() + 5000;
    while (globalThis.singleLoginFixture.chatCalls <= previous) {
      if (Date.now() >= deadline) throw Error('First send did not reach the restored ChatGPT session');
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }, calls);
  assert.ok(await app.evaluate(() => globalThis.providerReads.chatgpt > 0));
  assert.equal(await app.evaluate(() => globalThis.providerReads.copilot), 0);
  assert.equal((await page.evaluate(() => window.desktop.authSession())).user.id, session.user.id);
  assert.equal(await app.evaluate(() => globalThis.singleLoginFixture.opens), 1);
  const disconnectSettings = await openAISettings(page);
  const chatgptRow = disconnectSettings.locator('.ai-service-row').filter({ hasText: 'ChatGPT' });
  await chatgptRow.getByRole('button', { name: '断开连接', exact: true }).click();
  const reconnect = chatgptRow.getByRole('button', { name: '连接', exact: true });
  await app.evaluate(() => { globalThis.failReconnect = true; });
  await reconnect.click();
  await disconnectSettings.getByRole('alert').getByText('ChatGPT 登录未完成，请重试。', {exact:true}).waitFor();
  assert.equal(await app.evaluate(() => globalThis.singleLoginFixture.opens), 2);
  await closeUiApp(app);
  app = undefined;
  app = await electron.launch({ args: [entry], env });
  page = await waitForRestoredMainWindow(app);
  await page.locator('.sidebar .user-info small').getByText('未连接 AI 服务', { exact: true }).waitFor();
  await assertNoProviderReads();
  assert.equal(await app.evaluate(() => globalThis.singleLoginFixture.opens), 2);
  const reconnectSettings = await openAISettings(page);
  const retryRow = reconnectSettings.locator('.ai-service-row').filter({ hasText: 'ChatGPT' });
  await retryRow.getByRole('button', {name:'连接',exact:true}).click();
  await retryRow.getByRole('button', {name:'断开连接',exact:true}).waitFor();
  assert.equal(await app.evaluate(() => globalThis.singleLoginFixture.opens), 3);
  await closeUiApp(app);
  app = undefined;
  // An existing shortcut with the retired switch must restore the same Codex session.
  app = await electron.launch({ args: [entry, '--voxcue-chatgpt-plan'], env });
  page = await waitForRestoredMainWindow(app);
  await page.locator('.sidebar .user-info .account-usage-summary').getByText('5小时 75%', {exact:true}).waitFor();
  assert.equal(await app.evaluate(() => globalThis.singleLoginFixture.opens), 3);
  assert.equal(await app.evaluate(() => globalThis.providerReads.copilot), 0);
  const cleanupSettings = await openAISettings(page);
  const cleanupRow = cleanupSettings.locator('.ai-service-row').filter({hasText:'ChatGPT'});
  await cleanupRow.getByRole('button', {name:'断开连接',exact:true}).click();
  await cleanupRow.getByRole('button', {name:'连接',exact:true}).waitFor();
  await cleanupSettings.getByRole('button', {name:'关闭设置',exact:true}).click();
  assert.equal(await page.getByRole('button', { name: '用户菜单', exact: true }).isVisible(), true);
  page = await returnToUiLogin(app, page, '退出登录');
  assert.equal(await page.evaluate(() => window.desktop.authSession()), null);
  console.log(
    'PASS: fresh and local profiles leave both AIs idle; remembered ChatGPT verifies at startup, shows quota and sends without OAuth. Denial latches, failed reconnection stays disconnected, and successful reconnection restores on restart.',
  );
} finally {
  if (app) await closeUiApp(app);
}
