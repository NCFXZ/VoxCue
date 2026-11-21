import { evaluateHistory } from '../../../shared/test/scripts/stored-history-fixture.mjs';
import { closeUiApp, connectUiAccount, openModelMenu } from '../../../shared/test/scripts/install-ui-account.mjs';
import { testRoot, electron } from '../../../shared/test/scripts/test-workspace.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

async function checkWaveMotion(wave, reduced = false) {
  const frames = await wave.evaluate(async node => {
    const sample = () => [...node.children].map(bar => getComputedStyle(bar).scale);
    const first = sample();
    await new Promise(resolve => setTimeout(resolve, 100));
    return [first, sample()];
  });
  assert.equal(frames[0].length, 3);
  if (reduced) assert.deepEqual(frames, [Array(3).fill('none'), Array(3).fill('none')]);
  else {
    assert.notDeepEqual(frames[0], frames[1]);
    assert.ok(new Set(frames[1]).size > 1, 'The bars move out of phase');
  }
}

async function checkAnswerModelAlignment(page, effortLabel) {
  const popup = await openModelMenu(page, '面试回答模型', effortLabel);
  await popup.getByRole('menuitem', { name: '刷新模型列表', exact: true }).waitFor();
  const geometry = await popup.evaluate(async menu => {
    await Promise.all(menu.getAnimations({subtree: true}).map(animation => animation.finished));
    const settings = menu.closest('.speech-model-settings');
    const answer = settings.querySelector('.effort-model-trigger');
    const speech = settings.querySelector('button[aria-label="语音识别模型"]');
    const list = menu.querySelector('.reasoning-model-list');
    const footer = menu.querySelector('.reasoning-model-refresh');
    const checked = list.querySelector('[aria-checked="true"]');
    const edges = node => [node.firstElementChild.getBoundingClientRect().left,
      node.lastElementChild.getBoundingClientRect().right];
    const rect = menu.getBoundingClientRect();
    const listBox = list.getBoundingClientRect(), footerBox = footer.getBoundingClientRect();
    const frame = getComputedStyle(menu);
    const previousTop = list.scrollTop;
    list.scrollTop = previousTop ? 0 : list.scrollHeight;
    const scrollDistance = Math.abs(list.scrollTop - previousTop);
    const footerMovement = footer.getBoundingClientRect().top - footerBox.top;
    list.scrollTop = previousTop;
    return {
      arrows: [speech, answer].map(button => {
        const {width, height} = button.lastElementChild.getBoundingClientRect();
        return [width, height];
      }),
      edges: [edges(speech), edges(answer), edges(checked)],
      width: rect.width, triggerWidth: answer.getBoundingClientRect().width,
      vertical: [listBox.top - rect.top, rect.bottom - footerBox.bottom],
      frame: [parseFloat(frame.paddingTop) + parseFloat(frame.borderTopWidth),
        parseFloat(frame.paddingBottom) + parseFloat(frame.borderBottomWidth)],
      footerGap: footerBox.top - listBox.bottom, footerMovement, scrollDistance,
    };
  });
  assert.deepEqual(geometry.arrows[0], geometry.arrows[1]);
  assert.ok(geometry.arrows[0].every(size => Math.abs(size - 14) < 1 / 64));
  assert.ok(geometry.scrollDistance > 0 && Math.abs(geometry.footerMovement) < 1 / 64, JSON.stringify(geometry));
  for (const [left, right] of geometry.edges) {
    assert.ok(Math.abs(left - geometry.edges[0][0]) < 1 && Math.abs(right - geometry.edges[0][1]) < 1, JSON.stringify(geometry));
  }
  assert.ok(Math.abs(geometry.width - geometry.triggerWidth) < 1);
  assert.ok(Math.abs(geometry.vertical[0] - geometry.vertical[1]) < 1 &&
    geometry.vertical.every((inset, i) => Math.abs(inset - geometry.frame[i]) < 1) &&
    Math.abs(geometry.footerGap - 6) < 1 / 64, JSON.stringify(geometry));
  await page.keyboard.press('Escape');
}

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
// The isolated profile has no downloaded speech weights. Only model readiness
// is synthetic here; the dialog still runs the real permission checks.
const {ComponentService} = require(${JSON.stringify(path.resolve('dist-electron/shared/electron/backend/components/service.js'))});
const componentState = ComponentService.prototype.state;
ComponentService.prototype.state = function () {
  const state = componentState.call(this);
  return {...state, phase:'ready', error:null, items:state.items.map(item => ({...item, phase:'ready', received:item.bytes}))};
};
ComponentService.prototype.status = async function () { return this.state(); };
ComponentService.prototype.ready = () => true;
require(${JSON.stringify(path.resolve('dist-electron/shared/electron/backend/speech/models.js'))}).speechModelInstalled = () => true;
const {ChatGPTAuthService} = require(${JSON.stringify(path.resolve('dist-electron/shared/electron/backend/auth/service.js'))});
const {ChatGPTService} = require(${JSON.stringify(path.resolve('dist-electron/shared/electron/backend/chat/service.js'))});
const {SpeechHost} = require(${JSON.stringify(path.resolve('dist-electron/shared/electron/backend/speech/host.js'))});
require(${JSON.stringify(path.resolve('test/fixtures/interview-access-fixture.cjs'))})(${JSON.stringify(path.resolve('dist-electron/windows/electron/speech/access.js'))});
ChatGPTAuthService.prototype.session = async () => ({mode:'chatgpt',user:{id:'knowledge-fixture',name:'Test',email:''},expiresAt:Date.now()+3600000});
ChatGPTService.prototype.models = async () => [
  {id:'test-model',label:'Test Model',description:'',reasoningEfforts:['low','high']},
  ...Array.from({length:18}, (_, i) => ({id:'scroll-'+i,label:'Scrolling model '+i,description:'',reasoningEfforts:[]})),
];
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
  if (call.op === 'start') globalThis.audioActivity = (source,level) => this.emit({type:'activity',source,level,speaking:false});
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
  const page = await connectUiAccount(app, await app.firstWindow());
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page
    .getByRole('button', { name: '聊天模型', exact: true })
    .getByText('Test Model', { exact: true })
    .waitFor();
  const dialog = page.getByRole('dialog', { name: '开始面试', exact: true });
  const count = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
  const start = () => page.locator('.interview-start-trigger').click();
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
  const layout = await dialog.evaluate((element) => {
    const section = element.querySelector('.interview-access');
    const rows = [...section.querySelectorAll('.interview-access-row')];
    const reference = element.querySelector('.interview-start-summary-group > div');
    const positions = () => rows.map(row => ({
      labelError: row.children[0].getBoundingClientRect().left - reference.children[0].getBoundingClientRect().left,
      statusError: row.children[1].getBoundingClientRect().left - reference.children[1].getBoundingClientRect().left,
      top: row.getBoundingClientRect().top,
      status: row.children[1].getBoundingClientRect().left,
    }));
    const wide = positions();
    const original = element.style.width;
    try {
      element.style.width = '360px';
      return { wide, narrow: positions(), fits: section.scrollWidth <= section.clientWidth + 1 };
    } finally {
      element.style.width = original;
    }
  });
  for (const rows of [layout.wide, layout.narrow]) {
    assert.equal(rows.length, 5);
    assert.ok(rows.every(row => Math.abs(row.labelError) < 1 && Math.abs(row.statusError) < 1), JSON.stringify(rows));
    assert.ok(rows.every((row, i) => !i || row.top > rows[i - 1].top));
    assert.ok(rows.every(row => Math.abs(row.status - rows[0].status) < 1));
  }
  assert.ok(layout.fits, 'Narrow permission checks and error text fit the dialog');
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
  await dialog.locator('.interview-access[aria-busy="false"] .interview-access-status').first().waitFor();
  assert.equal(await dialog.locator('.interview-access-list button').count(), 0);
  assert.equal(
    await dialog.getByRole('button', { name: '确认开始', exact: true }).isEnabled(),
    true,
  );
  for (const [source, label] of [['microphone', '麦克风'], ['system', '系统音频']]) {
    const row = dialog.locator('.interview-access-row').filter({hasText: label});
    const reduced = source === 'system';
    await page.emulateMedia({ reducedMotion: reduced ? 'reduce' : 'no-preference' });
    await app.evaluate((_, source) => globalThis.audioActivity(source, 0.2), source);
    await checkWaveMotion(row.locator('.interview-readiness-level'), reduced);
    await row.locator('.interview-readiness-level').waitFor({state:'detached'});
  }
  await page.emulateMedia({ reducedMotion: null });
  await app.evaluate(() => {
    globalThis.systemDenied = true;
  });
  await page.evaluate(() => {
    window.syncAvailableAfterFailedStart = false;
    const unsubscribe = window.desktop.onCloudSyncAvailable(() => {
      window.syncAvailableAfterFailedStart = true;
      unsubscribe();
    });
  });
  await dialog.getByRole('button', { name: '确认开始', exact: true }).click();
  await dialog
    .getByRole('alert')
    .getByText(/系统音频访问被拒绝/)
    .waitFor();
  await page.waitForFunction(() => window.syncAvailableAfterFailedStart, null, { timeout: 5000 });
  const checks = dialog.locator('.interview-access[aria-busy="false"] .interview-access-row');
  await checks.filter({ hasText: '系统音频' }).getByText('未授权', { exact: true }).waitFor();
  assert.equal(await checks.count(), 5);
  await checks.filter({ hasText: '麦克风' }).getByText('可用', { exact: true }).waitFor();
  await app.evaluate(() => { globalThis.accessFailure = true; });
  await dialog.getByRole('button', { name: '重新检查', exact: true }).click();
  await dialog.getByRole('alert').filter({ hasText: 'Synthetic access check failure' }).waitFor();
  assert.equal(await checks.count(), 5);
  assert.equal(await checks.getByText('待确认', { exact: true }).count(), 3);
  assert.equal(await count(), 1);
  await blocked();
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await app.evaluate(() => {
    globalThis.accessFailure = false;
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
    .getByRole('button', { name: '通用', exact: true })
    .click();
  const settings = page.getByRole('dialog', { name: '设置', exact: true });
  await settings.getByRole('button', { name: '面试设置', exact: true }).click();
  const displaySliders = settings.locator('.frosted-slider-control input');
  assert.equal(await displaySliders.count(), 2);
  for (const slider of await displaySliders.all()) {
    const fraction = await slider.evaluate(input =>
      (input.valueAsNumber - Number(input.min)) / (Number(input.max) - Number(input.min)));
    const pixels = await slider.screenshot({ scale: 'css' });
    const center = await app.evaluate(({ nativeImage }, { png, fraction }) => {
      const image = nativeImage.createFromBuffer(Buffer.from(png, 'base64'));
      const { width, height } = image.getSize();
      const x = Math.round(14 + (width - 28) * fraction);
      return [...image.crop({ x, y: Math.floor(height / 2), width: 1, height: 1 }).toBitmap()];
    }, { png: pixels.toString('base64'), fraction });
    assert.deepEqual(center, [255, 255, 255, 255], 'Display slider thumb center is pure white');
  }
  await checkAnswerModelAlignment(page, '面试回答思考强度');
  for (const name of ['语音识别模型', '麦克风设备']) {
    const trigger = settings.getByRole('button', { name, exact: true });
    await trigger.click();
    const menu = settings.getByRole('menu');
    await menu.getByRole('menuitemradio', { checked: true }).waitFor();
    await menu.evaluate(async node => {
      await Promise.all(node.getAnimations({ subtree: true }).map(a => a.finished));
    });
    const insets = await menu.evaluate(menu => {
      const button = document.getElementById(menu.getAttribute('aria-labelledby'));
      const items = [...menu.querySelectorAll('[role="menuitemradio"]')];
      const checked = menu.querySelector('[aria-checked="true"]');
      const rect = node => node.getBoundingClientRect();
      return {
        trigger: [rect(button.firstElementChild).left - rect(button).left, rect(button).right - rect(button.lastElementChild).right],
        option: [rect(checked.firstElementChild).left - rect(menu).left, rect(menu).right - rect(checked.lastElementChild).right],
        leftOffset: rect(menu).left - rect(button).left,
        vertical: [rect(items[0]).top - rect(menu).top, rect(menu).bottom - rect(items.at(-1)).bottom],
      };
    });
    const values = [...insets.trigger, ...insets.option];
    assert.ok(Math.max(...values) - Math.min(...values) < 1, JSON.stringify({name, insets}));
    assert.ok(Math.abs(insets.leftOffset) < 1, JSON.stringify(insets));
    assert.ok(Math.abs(insets.vertical[0] - insets.vertical[1]) < 1, JSON.stringify(insets));
    await page.keyboard.press('Escape');
  }
  await settings.getByRole('button', { name: '麦克风设备', exact: true }).click();
  await settings.getByRole('menuitemradio', { name: '不使用麦克风', exact: true }).click();
  await settings.getByRole('button', { name: '关闭设置', exact: true }).click();
  await app.evaluate(() => {
    globalThis.microphoneDenied = true;
  });
  await start();
  await dialog.locator('.interview-access[aria-busy="false"] .interview-access-status').first().waitFor();
  assert.equal(await dialog.locator('.interview-access-list button').count(), 0);
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
  await floating.emulateMedia({ reducedMotion: 'no-preference' });
  await app.evaluate(() => globalThis.audioActivity('system', 0.2));
  await checkWaveMotion(floating.locator('.interview-ready-badge .interview-readiness-level[data-active="true"]'));
  await floating.getByRole('button', { name: '面试设置', exact: true }).click();
  await checkAnswerModelAlignment(floating, '面试思考强度');
  await floating.getByRole('button', { name: '关闭对话框', exact: true }).click();
  const config = await floating.evaluate(() => window.desktop.interviewState());
  assert.deepEqual(config.configuration.options.sources, ['system']);
  assert.equal(/mock|模拟/i.test(await floating.locator('body').innerText()), false);
  await floating.getByRole('button', { name: '结束面试', exact: true }).click();
  await Promise.all([
    floating.waitForEvent('close'),
    floating.getByRole('button', { name: '确认结束面试', exact: true }).click(),
  ]);
  await evaluateHistory(page, async () => {
    const rows = await fixtureHistory.read();
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
    await fixtureHistory.replace(rows);
  });
  await page.getByRole('button', { name: '面试记录', exact: true }).click();
  assert.equal(await page.getByText('LEGACY_DEMO_SENTINEL', { exact: true }).count(), 0);
  assert.equal(
    await evaluateHistory(page, async () =>
      (await fixtureHistory.read()).some(
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
    .getByRole('button', { name: '通用', exact: true })
    .click();
  for (const name of ['VoxCue 账号', 'AI 服务', '本地组件', '面试设置', '通用', '关于与更新']) {
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
