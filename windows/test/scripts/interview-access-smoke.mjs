import { closeUiApp } from '../../../shared/test/scripts/install-ui-account.mjs';
import { testRoot, electron } from '../../../shared/test/scripts/test-workspace.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const profile = path.resolve(path.join(testRoot, 'test/results'), `interview-access-${Date.now()}`);
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
require(${JSON.stringify(path.resolve('test/fixtures/interview-access-fixture.cjs'))})(${JSON.stringify(path.resolve('dist-electron/windows/electron/speech/access.js'))});
ChatGPTAuthService.prototype.session = async () => ({mode:'chatgpt',user:{id:'knowledge-fixture',name:'Test',email:''},expiresAt:Date.now()+3600000});
ChatGPTService.prototype.models = async () => [{id:'test-model',label:'Test Model',description:'',reasoningEfforts:['low','high']}];
ChatGPTService.prototype.usage = async () => ({requests:0,inputTokens:0,outputTokens:0,totalTokens:0,updatedAt:null});
globalThis.interviewRequests = [];
globalThis.speechCalls = [];
globalThis.microphoneMissing = false;
globalThis.microphoneDenied = false;
ChatGPTService.prototype.stream = async (request, emit, signal) => {
  globalThis.interviewRequests.push(request);
  emit({id:request.id,type:'activity',activity:{phase:'thinking'}});
  if(globalThis.delaySummary) await new Promise(resolve=>{globalThis.resumeSummary=resolve;});
  if(globalThis.omitSummary) return {answerText:'本次没有公开摘要的测试回答',usage:null,sources:[]};
  const summary='先核对公开资料，再组织回答。';
  emit({id:request.id,type:'reasoning-summary',text:summary});
  let answer='';
  for(let i=0;i<28;i++) {
    await new Promise(r=>setTimeout(r,90));
    if(signal.aborted) throw new DOMException('Stopped','AbortError');
    const text='第 '+i+' 段回答：用于检查后台继续生成及读者滚动位置。\\n\\n';
    answer+=text;emit({id:request.id,type:'delta',text});
  }
  return {answerText:answer,reasoningSummary:summary,usage:null,sources:[]};
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
  const dialog = page.getByRole('dialog', { name: '开始面试', exact: true });
  const count = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
  const start = () => page.getByRole('button', { name: '开始面试', exact: true }).click();
  const blocked = async () =>
    assert.equal(
      await dialog.getByRole('button', { name: '确认开始', exact: true }).isDisabled(),
      true,
    );
  await app.evaluate(() => {
    globalThis.delayAccess = true;
    globalThis.microphoneDenied = true;
  });
  await start();
  await dialog.getByText('正在检查权限与音频设备…', { exact: true }).waitFor();
  await blocked();
  await app.evaluate(async () => {
    for (let i = 0; i < 100 && !globalThis.resumeAccess; i++)
      await new Promise((r) => setTimeout(r, 20));
    globalThis.delayAccess = false;
    globalThis.resumeAccess();
  });
  await dialog.getByText(/麦克风权限未开启/).waitFor();
  await blocked();
  assert.equal(await count(), 1);
  await page.screenshot({});
  const bypass = await page.evaluate(async () => {
    try {
      await window.desktop.openInterview({
        mode: 'local',
        options: { sources: ['system', 'microphone'] },
        aiEnabled: true,
        modelId: 'test-model',
        effort: 'low',
        autoAnswer: true,
      });
      return false;
    } catch {
      return true;
    }
  });
  assert.equal(bypass, true);
  assert.equal(await count(), 1);
  await app.evaluate(() => {
    globalThis.microphoneDenied = false;
  });
  await dialog.getByRole('button', { name: '重新检查', exact: true }).click();
  await dialog.getByRole('button', { name: '测试麦克风', exact: true }).waitFor();
  assert.equal(
    await dialog.getByRole('button', { name: '测试麦克风', exact: true }).isEnabled(),
    true,
  );
  assert.equal(
    await dialog.getByRole('button', { name: '确认开始', exact: true }).isEnabled(),
    true,
  );
  await app.evaluate(() => {
    globalThis.systemDenied = true;
  });
  await dialog.getByRole('button', { name: '确认开始', exact: true }).click();
  await dialog
    .getByRole('alert')
    .getByText(/系统音频访问被拒绝/)
    .waitFor();
  assert.equal(await count(), 1);
  await blocked();
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await app.evaluate(() => {
    globalThis.systemDenied = false;
    globalThis.microphoneMissing = true;
  });
  await start();
  await dialog.getByText('设备不可用', { exact: true }).waitFor();
  await dialog
    .locator('.interview-access-detail')
    .getByText('默认麦克风设备不可用，请在面试设置中重新选择。', { exact: true })
    .waitFor();
  await blocked();
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('button', { name: '用户菜单', exact: true }).click();
  await page.getByRole('menuitem', { name: '设置', exact: true }).click();
  await page
    .getByRole('navigation', { name: '设置分类' })
    .getByRole('button', { name: '个性化', exact: true })
    .click();
  const settings = page.getByRole('dialog', { name: '设置', exact: true });
  await settings.getByRole('button', { name: '面试设置', exact: true }).click();
  await settings.getByRole('button', { name: '麦克风设备', exact: true }).click();
  await settings.getByRole('menuitemradio', { name: '不使用麦克风', exact: true }).click();
  await settings.getByRole('button', { name: '关闭设置', exact: true }).click();
  await app.evaluate(() => {
    globalThis.microphoneDenied = true;
  });
  await start();
  await dialog.getByRole('button', { name: '测试系统声音', exact: true }).waitFor();
  assert.equal(
    await dialog.getByRole('button', { name: '测试系统声音', exact: true }).isEnabled(),
    true,
  );
  assert.equal(
    await dialog.getByRole('button', { name: '确认开始', exact: true }).isEnabled(),
    true,
  );
  await page.screenshot({});
  const [floating] = await Promise.all([
    app.waitForEvent('window'),
    dialog.getByRole('button', { name: '确认开始', exact: true }).click(),
  ]);
  await floating.getByRole('button', { name: '结束面试', exact: true }).waitFor();
  const config = await floating.evaluate(() => window.desktop.interviewState());
  assert.deepEqual(config.configuration.options.sources, ['system']);
  assert.equal(/mock|模拟/i.test(await floating.locator('body').innerText()), false);
  await floating.getByRole('button', { name: '结束面试', exact: true }).click();
  await Promise.all([
    floating.waitForEvent('close'),
    floating.getByRole('button', { name: '确认结束面试', exact: true }).click(),
  ]);
  await page.evaluate(() => {
    const rows = JSON.parse(localStorage.getItem('copilot-interview-history-v1') || '[]');
    rows.push({
      id: 'legacy-demo',
      title: 'LEGACY_DEMO_SENTINEL',
      startedAt: 1,
      endedAt: 2,
      status: 'ended',
      transcripts: [],
      answers: [],
      mock: true,
    });
    localStorage.setItem('copilot-interview-history-v1', JSON.stringify(rows));
  });
  await page.getByRole('button', { name: '面试记录', exact: true }).click();
  assert.equal(await page.getByText('LEGACY_DEMO_SENTINEL', { exact: true }).count(), 0);
  assert.equal(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem('copilot-interview-history-v1')).some(
        (row) => row.id === 'legacy-demo',
      ),
    ),
    true,
  );
  assert.equal(/mock|模拟/i.test(await page.locator('body').innerText()), false);
  await page.getByRole('button', { name: '用户菜单', exact: true }).click();
  await page.getByRole('menuitem', { name: '设置', exact: true }).click();
  await page
    .getByRole('navigation', { name: '设置分类' })
    .getByRole('button', { name: '个性化', exact: true })
    .click();
  for (const name of ['VoxCue 账号', 'AI 服务', '本地组件', '面试设置', '个性化', '关于与更新']) {
    await settings.getByRole('button', { name, exact: true }).click();
    assert.equal(/mock|模拟/i.test(await settings.innerText()), false);
  }
  assert.deepEqual(errors, []);
  await console.log(
    JSON.stringify(
      {
        passed: 7,
        checks: [
          '检查中不可开始',
          '拒绝权限阻止 UI 和直接 IPC',
          '确认开始重新检查权限',
          '缺失麦克风不自动降级',
          '禁用麦克风仅检查系统并可开始',
          '正式主界面和浮窗无 Mock 内容',
          '旧 Mock 记录隐藏且不删除',
        ],
        errors,
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ passed: 7, profile }));
} finally {
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().forEach((win) => win.destroy()),
  );
  await closeUiApp(app);
}
