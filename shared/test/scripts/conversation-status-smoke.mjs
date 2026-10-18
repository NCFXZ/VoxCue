import { testRoot, electron } from './test-workspace.mjs';
import { closeUiApp } from './install-ui-account.mjs';

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const profile = path.resolve(
  path.join(testRoot, 'test/results'),
  `conversation-status-${Date.now()}`,
);
await mkdir(profile, { recursive: true });
const fixture = path.join(profile, 'main.cjs');
// Only external/native service ports are fixtures. Main IPC, preload, IDB,
// confirmation, configuration lock, application scope and built UI remain real.
// The profile is independent; no account, audio, model or user data is used.
await writeFile(
  fixture,
  `
const {app} = require('electron');
app.setAppPath(${JSON.stringify(process.cwd())});
const {ChatGPTAuthService} = require(${JSON.stringify(path.resolve('dist-electron/shared/electron/backend/auth/service.js'))});
const {ChatGPTService} = require(${JSON.stringify(path.resolve('dist-electron/shared/electron/backend/chat/service.js'))});
const {SpeechHost} = require(${JSON.stringify(path.resolve('dist-electron/shared/electron/backend/speech/host.js'))});
ChatGPTAuthService.prototype.session = async () => ({mode:'chatgpt',user:{id:'knowledge-fixture',name:'Test',email:''},expiresAt:Date.now()+3600000});
ChatGPTService.prototype.models = async () => [{id:'test-model',label:'Test Model',description:'',reasoningEfforts:['low','high']}];
ChatGPTService.prototype.usage = async () => ({requests:0,inputTokens:0,outputTokens:0,totalTokens:0,updatedAt:null});
globalThis.interviewRequests = [];
globalThis.speechCalls = [];
globalThis.microphoneMissing = false;
globalThis.microphoneDenied = false;
ChatGPTService.prototype.stream = async (request, emit, signal) => {
  emit({id:request.id,type:'activity',activity:{phase:'thinking'}});
  await new Promise((resolve,reject)=>{
    globalThis.finishReply=resolve;
    signal.addEventListener('abort',()=>reject(new DOMException('Stopped','AbortError')),{once:true});
  });
  return {answerText:'Synthetic completed answer',usage:null,sources:[]};
};
SpeechHost.prototype.call = async function(call) {
  globalThis.speechCalls.push(call);
  if(call.op==='start' && call.options.sources.includes('microphone') && globalThis.microphoneDenied) throw Error('麦克风访问被拒绝，请检查 Windows 麦克风权限。');
  if(call.op==='start') {const emit=this.emit;setTimeout(()=>emit({type:'activity',source:'microphone',speaking:true,level:0.03}),100);}
  return {state:call.op==='start'?'running':'idle',model:'Synthetic speech port',devices:[{id:'fixture-system',name:'测试扬声器',source:'system',default:true},...(globalThis.microphoneMissing?[]:[{id:'fixture-mic',name:'测试麦克风设备',source:'microphone',default:false}])]};
};
SpeechHost.prototype.stop = () => {};
require(${JSON.stringify(path.resolve('dist-electron/shared/electron/main.js'))});
`,
);
const env = { ...process.env, COPILOT_TEST_USER_DATA: profile, VITE_DEV_SERVER_URL: '' };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: [fixture], env });

try {
  const page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page
    .getByRole('button', { name: '聊天模型', exact: true })
    .getByText('Test Model', { exact: true })
    .waitFor();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].focus());
  await page.bringToFront();
  const send = async (title) => {
    await page.getByRole('textbox', { name: '聊天消息', exact: true }).fill(title);
    await page.getByRole('button', { name: '发送消息', exact: true }).click();
    await page.locator('.conversation-spinner').waitFor();
  };
  const finish = async () => {
    await app.evaluate(async () => {
      for (let i = 0; i < 100 && typeof globalThis.finishReply !== 'function'; i++)
        await new Promise((r) => setTimeout(r, 20));
      globalThis.finishReply();
      globalThis.finishReply = undefined;
    });
    await page.locator('.conversation-spinner').waitFor({ state: 'detached' });
  };
  await send('后台回复状态');
  const row = page.locator('.conversation-row').filter({ hasText: '后台回复状态' });
  const slot = await row.locator('.conversation-indicator').boundingBox();
  assert.ok(Math.abs(slot.width - 14) < 0.01, 'Status slot width remains 14 CSS pixels');
  assert.ok(Math.abs(slot.height - 14) < 0.01, 'Status slot height remains 14 CSS pixels');
  assert.notEqual(
    await row
      .locator('.conversation-spinner')
      .evaluate((node) => getComputedStyle(node).animationName),
    'none',
  );
  await page.screenshot({});
  await page.getByRole('button', { name: '知识库', exact: true }).click();
  await finish();
  await row.locator('.conversation-dot.is-unread').waitFor();
  assert.equal(
    await row
      .locator('.conversation-dot.is-unread')
      .evaluate((node) => getComputedStyle(node).backgroundColor),
    await page.evaluate(() => {
      const probe = document.createElement('span');
      probe.style.color = 'var(--system-accent)';
      document.body.append(probe);
      const value = getComputedStyle(probe).color;
      probe.remove();
      return value;
    }),
  );
  await page.screenshot({});
  assert.match(await row.locator('.conversation').getAttribute('aria-label'), /回复完成，尚未查看/);
  await row.locator('.conversation').click();
  await row.locator('.conversation-dot.is-unread').waitFor({ state: 'detached' });
  await page.getByText('Synthetic completed answer', { exact: true }).waitFor();
  await send('前台正在查看');
  await finish();
  assert.equal(await page.locator('.conversation-dot.is-unread').count(), 0);
  await send('手动停止');
  await page.getByRole('button', { name: '停止回复', exact: true }).click();
  await page.locator('.conversation-spinner').waitFor({ state: 'detached' });
  assert.equal(await page.locator('.conversation-dot.is-unread').count(), 0);
  await page.screenshot({});
  assert.deepEqual(errors, []);
  const result = {
    passed: 4,
    profile,
    checks: [
      '运行旋转图标与固定对齐',
      '后台完成显示主题色未读点',
      '查看后清除及前台完成不标记',
      '停止清除旋转且不误标未读',
    ],
  };
  await console.log(JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally {
  await app.evaluate(({ BrowserWindow }) => {
    for (const win of BrowserWindow.getAllWindows()) win.destroy();
  });
  await closeUiApp(app);
}
