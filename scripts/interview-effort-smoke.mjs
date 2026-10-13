import { _electron as electron } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const profile = path.resolve('test-results', `interview-effort-${Date.now()}`);
await mkdir(profile, { recursive: true });
const fixture = path.join(profile, 'main.cjs');
// Isolated test service boundaries only. The built UI, preload, main IPC,
// configuration coordinator and answer pipeline remain real; no account/audio used.
await writeFile(
  fixture,
  `
const {app} = require('electron');
app.setAppPath(${JSON.stringify(process.cwd())});
const {ChatGPTAuthService} = require(${JSON.stringify(path.resolve('dist-electron/backend/auth/service.js'))});
const {ChatGPTService} = require(${JSON.stringify(path.resolve('dist-electron/backend/chat/service.js'))});
const {SpeechHost} = require(${JSON.stringify(path.resolve('dist-electron/backend/speech/host.js'))});
require(${JSON.stringify(path.resolve('scripts/interview-access-fixture.cjs'))})(${JSON.stringify(path.resolve('dist-electron/backend/speech/access.js'))});
ChatGPTAuthService.prototype.session = async () => ({mode:'chatgpt', user:{id:'fixture',name:'Test',email:''},expiresAt:Date.now()+3600000});
ChatGPTService.prototype.models = async () => [
  {id:'test-model',label:'Test Model',description:'',reasoningEfforts:['low','medium','high']},
  {id:'restricted-model',label:'Restricted Model',description:'',reasoningEfforts:['medium']},
  {id:'unknown-model',label:'Unknown Model',description:''}
];
ChatGPTService.prototype.usage = async () => ({requests:0,inputTokens:0,outputTokens:0,totalTokens:0,updatedAt:null});
globalThis.interviewRequests = [];
ChatGPTService.prototype.stream = async (request) => {
  if (request.id.startsWith('history-title-')) return {answerText:'合成面试标题',usage:null,sources:[]};
  globalThis.interviewRequests.push(request);
  return {answerText:'Fixture answer '+globalThis.interviewRequests.length,usage:null,sources:[]};
};
SpeechHost.prototype.call = async (call) => ({state:call.op==='start'?'running':'idle',model:'Test only',devices:[]});
SpeechHost.prototype.stop = () => {};
require(${JSON.stringify(path.resolve('dist-electron/main.js'))});
`,
);
const app = await electron.launch({
  args: [fixture],
  env: { ...process.env, COPILOT_TEST_USER_DATA: profile, VITE_DEV_SERVER_URL: '' },
});
try {
  const main = await app.firstWindow();
  main.setDefaultTimeout(15000);
  await main
    .getByRole('button', { name: '聊天模型', exact: true })
    .getByText('Test Model', { exact: true })
    .waitFor();
  const openSettings = async () => {
    await main.getByRole('button', { name: '用户菜单', exact: true }).click();
    await main.getByRole('menuitem', { name: '设置', exact: true }).click();
    await main.getByRole('button', { name: '面试设置', exact: true }).click();
  };
  await openSettings();
  const dialog = main.getByRole('dialog', { name: '设置', exact: true });
  const effort = dialog.getByRole('button', { name: '面试回答思考强度', exact: true });
  assert.match(await effort.innerText(), /轻度/);
  const selectEffort = async (label) => {
    await effort.click();
    await dialog.getByRole('menuitemradio', { name: label, exact: true }).click();
  };
  const selectModel = async (label) => {
    await dialog.getByRole('button', { name: '面试回答模型', exact: true }).click();
    await dialog.getByRole('menuitemradio', { name: label, exact: true }).click();
  };
  await selectEffort('高');
  await selectModel('Restricted Model');
  assert.match(await effort.innerText(), /自动/);
  await effort.click();
  assert.equal(await dialog.getByRole('menuitemradio', { name: '高', exact: true }).count(), 0);
  await dialog.getByRole('menuitemradio', { name: '自动', exact: true }).click();
  await selectModel('Unknown Model');
  assert.equal(await effort.isDisabled(), true);
  assert.match(await effort.innerText(), /自动/);
  await selectModel('Test Model');
  await selectEffort('高');
  assert.equal(await dialog.evaluate((e) => e.scrollWidth > e.clientWidth), false);
  await dialog.screenshot({ path: path.join(profile, 'start-light.png'), animations: 'disabled' });
  await main.evaluate(() => document.documentElement.classList.add('dark'));
  await dialog.screenshot({ path: path.join(profile, 'start-dark.png'), animations: 'disabled' });
  await dialog.getByRole('button', { name: '关闭设置', exact: true }).click();
  await main.getByRole('button', { name: '开始面试', exact: true }).click();
  const confirmation = main.getByRole('dialog', { name: '开始面试', exact: true });
  const [floating] = await Promise.all([
    app.waitForEvent('window'),
    confirmation.getByRole('button', { name: '确认开始', exact: true }).click(),
  ]);
  floating.setDefaultTimeout(15000);
  const confirmed = await floating.evaluate(
    async () => (await window.desktop.interviewState()).configuration,
  );
  assert.equal(confirmed.effort, 'high');
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
    'high',
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
  assert.equal(request.effort, 'high');
  assert.equal(request.modelId, 'test-model');
  await floating.getByRole('button', { name: '结束面试', exact: true }).click();
  await Promise.all([
    floating.waitForEvent('close'),
    floating.getByRole('button', { name: '确认结束面试', exact: true }).click(),
  ]);
  await openSettings();
  await selectEffort('自动');
  await dialog.getByRole('button', { name: '关闭设置', exact: true }).click();
  await main.getByRole('button', { name: '开始面试', exact: true }).click();
  const [automatic] = await Promise.all([
    app.waitForEvent('window'),
    confirmation.getByRole('button', { name: '确认开始', exact: true }).click(),
  ]);
  await automatic
    .getByRole('textbox', { name: '面试提问', exact: true })
    .fill('Explain automatic effort');
  await automatic.getByRole('button', { name: '发送面试问题', exact: true }).click();
  await automatic.getByText('Fixture answer 2', { exact: true }).waitFor();
  assert.equal(await app.evaluate(() => 'effort' in globalThis.interviewRequests[1]), false);
  console.log(
    `PASS: model-supported effort/default low/unknown auto, locked configuration after reload, tamper rejection and UI→IPC→AI request effort. Screenshots: ${profile}`,
  );
} finally {
  await app.evaluate(({ BrowserWindow }) => {
    for (const win of BrowserWindow.getAllWindows()) win.destroy();
  });
  await app.close();
}
