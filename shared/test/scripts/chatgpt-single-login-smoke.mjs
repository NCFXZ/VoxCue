import { testRoot, electron } from './test-workspace.mjs';
import { offlineElectronEntry } from './offline-electron-entry.mjs';
import { closeUiApp } from './install-ui-account.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

for (const name of ['profile', 'home', 'tmp']) await mkdir(path.join(testRoot, name));
const fixture = path.join(testRoot, 'single-login.cjs');
await writeFile(
  fixture,
  `
const {app,shell,ipcMain}=require('electron');
const fs=require('node:fs');const path=require('node:path');const root=process.cwd();
const file=path.join(process.env.COPILOT_TEST_USER_DATA,'synthetic-session.json');
const state=globalThis.singleLoginFixture=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):{active:false,opens:0,quotaReads:0,chatCalls:0};
const save=()=>fs.writeFileSync(file,JSON.stringify(state));
const {CodexUsageRuntime}=require(root+'/dist-electron/shared/electron/backend/chat/codexUsage.js');
CodexUsageRuntime.prototype.account=async()=>state.active?{email:'synthetic@example.test',planType:'plus'}:null;
CodexUsageRuntime.prototype.access=async()=>{
  if(!state.active)throw Error('not signed in');
  return{token:'synthetic-private',account:'synthetic:workspace',chatgptAccountId:'workspace',email:'synthetic@example.test',name:'Synthetic',expiresAt:Date.now()+3600000};
};
shell.openExternal=async(url)=>{if(url.startsWith('https://auth.openai.com/')){state.opens++;save();}};
CodexUsageRuntime.prototype.login=async(open,signal)=>{signal.throwIfAborted();await open('https://auth.openai.com/authorize?state=synthetic');state.active=true;save();};
CodexUsageRuntime.prototype.logout=async()=>{state.active=false;save();};
CodexUsageRuntime.prototype.limits=async()=>{if(!state.active)throw Error('not signed in');state.quotaReads++;save();return{accountId:'workspace',rateLimits:{planType:'plus',primary:{usedPercent:25,windowDurationMins:300},secondary:{usedPercent:40,windowDurationMins:10080}}};};
const previousFetch=globalThis.fetch;
globalThis.fetch=async(url,options)=>{
  if(!String(url).startsWith('https://chatgpt.com/backend-api/codex/'))return previousFetch(url,options);
  if(options.headers.authorization!=='Bearer synthetic-private'||options.headers['ChatGPT-Account-Id']!=='workspace')throw Error('Wrong session');
  if(String(url).includes('/models?'))return Response.json({models:[{slug:'synthetic-single',display_name:'Synthetic single',visibility:'list'}]});
  if(!String(url).endsWith('/responses'))throw Error('Unexpected request');
  state.chatCalls++;save();
  const request=JSON.parse(options.body);
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
try {
  app = await electron.launch({ args: [entry], env });
  let page = await app.firstWindow();
  const opened = app.waitForEvent('window');
  await page.getByRole('button', { name: '使用 ChatGPT 继续', exact: true }).click();
  page = await opened;
  await page.getByRole('button', { name: '开始面试', exact: true }).waitFor();
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
  await page.getByRole('button', { name: '用户菜单', exact: true }).click();
  await page.getByRole('menuitem', { name: '设置', exact: true }).click();
  const settings = page.getByRole('dialog', { name: '设置', exact: true });
  await settings.getByRole('button', { name: '账户与用量', exact: true }).click();
  await settings.getByText('5小时额度', { exact: true }).waitFor();
  await settings.getByText('每周额度', { exact: true }).waitFor();
  assert.equal(
    await settings.getByRole('button', { name: '连接 ChatGPT 用量', exact: true }).count(),
    0,
  );
  await settings.getByRole('button', { name: '刷新账户额度', exact: true }).click();
  await settings.getByText('剩余 75%', { exact: true }).waitFor();
  assert.equal(await app.evaluate(() => globalThis.singleLoginFixture.opens), 1);
  await settings.getByRole('button', { name: '关闭设置', exact: true }).click();
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
  await closeUiApp(app);
  app = undefined;
  app = await electron.launch({ args: [entry], env });
  page = await app.firstWindow();
  await page.getByRole('button', { name: '开始面试', exact: true }).waitFor();
  assert.equal((await page.evaluate(() => window.desktop.authSession())).user.id, session.user.id);
  assert.equal(await app.evaluate(() => globalThis.singleLoginFixture.opens), 1);
  const loginOpened = app.waitForEvent('window');
  await page.evaluate(() => window.desktop.signOut());
  page = await loginOpened;
  await page.getByRole('button', { name: '使用 ChatGPT 继续', exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.desktop.authSession()), null);
  console.log(
    'PASS: one shared ChatGPT login, immediate five-hour/weekly usage, chat with the same session, refresh without OAuth, restart restore and logout (offline synthetic account).',
  );
} finally {
  if (app) await closeUiApp(app);
}
