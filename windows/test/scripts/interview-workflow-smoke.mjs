import { closeUiApp } from '../../../shared/test/scripts/install-ui-account.mjs';
import { testRoot, electron } from '../../../shared/test/scripts/test-workspace.mjs';
import { offlineElectronEntry } from '../../../shared/test/scripts/offline-electron-entry.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { probe } from './window-probe.mjs';
import { waitForAsync } from '../../../shared/test/scripts/wait-for-async.mjs';
function requireDesktop() {
  assert.equal(
    probe('desktop').interactive,
    true,
    'Native workflow checks require an unlocked desktop',
  );
}
requireDesktop();
const cursorBefore = probe('cursor');

const profile = path.resolve(
  path.join(testRoot, 'test/results'),
  `interview-workflow-${Date.now()}`,
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
const {interviewInstructions} = require(${JSON.stringify(path.resolve('dist-electron/shared/electron/application/interviewContext.js'))});
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
  const summary='**核对资料**\\n\\n先核对公开资料，再组织回答。';
  emit({id:request.id,type:'reasoning-summary',text:summary});
  if(request.instructions.startsWith(interviewInstructions)) {
    const answer=request.turns.at(-1).content.includes('斐波那契')
      ? '以斐波那契为例：dp[i] = dp[i-1] + dp[i-2]，边界 dp[0]=0、dp[1]=1。时间 O(n)，空间可优化到 O(1)。'
      : '动态规划是一种将复杂问题分解为更小子问题的算法思想。核心是：定义状态、找状态转移方程、确定边界条件。';
    emit({id:request.id,type:'delta',text:answer});
    return {answerText:answer,reasoningSummary:summary,usage:null,sources:[]};
  }
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
const app = await electron.launch({ args: [await offlineElectronEntry(fixture)], env });
const checks = [];
const check = (name, detail = true) => checks.push({ name, passed: true, detail });
const bases = [
  { id: 'job-empty', name: '空岗位库 A', createdAt: 1 },
  {
    id: 'job-unindexed',
    name: '后端平台工程师岗位资料—系统设计并发稳定性与跨语言面试题的很长知识库名称',
    createdAt: 2,
  },
];
async function seed(page) {
  await page.evaluate(async (items) => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('copilot-local-documents', 1);
      request.onupgradeneeded = () => {
        const database = request.result;
        database.createObjectStore('bases', { keyPath: 'id' });
        database.createObjectStore('documents', { keyPath: 'id' }).createIndex('baseId', 'baseId');
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise((resolve, reject) => {
      const tx = db.transaction(['bases', 'documents'], 'readwrite');
      for (const base of items) tx.objectStore('bases').put(base);
      const blob = new Blob(['Synthetic job notes for an isolated UI smoke.'], {
        type: 'text/plain',
      });
      tx.objectStore('documents').put({
        id: 'unindexed-synthetic-document',
        baseId: 'job-unindexed',
        name: 'synthetic-job.txt',
        size: blob.size,
        type: 'text/plain',
        createdAt: 2,
        blob,
      });
      tx.oncomplete = resolve;
      tx.onerror = tx.onabort = () => reject(tx.error);
    });
    db.close();
  }, bases);
}
async function size(page, width, height) {
  // Observe the production resize after motion completes. Forcing setSize or
  // viewport emulation here can resize the HWND before its exit animation ends.
  await page.waitForFunction(() => !document.querySelector('.floating-shell').dataset.panelMotion);
  await page
    .waitForFunction(
      (expected) =>
        Math.abs(innerWidth - expected.width) <= 1 && Math.abs(innerHeight - expected.height) <= 1,
      { width, height },
    )
    .catch(async (error) => {
      const viewport = await page.evaluate(() => ({
        width: innerWidth,
        height: innerHeight,
        ratio: devicePixelRatio,
      }));
      const native = await app.evaluate(({ BrowserWindow, screen }, url) => {
        const win = BrowserWindow.getAllWindows().find(
          (window) => window.webContents.getURL() === url,
        );
        return win
          ? {
              bounds: win.getBounds(),
              content: win.getContentSize(),
              workArea: screen.getDisplayMatching(win.getBounds()).workArea,
            }
          : null;
      }, page.url());
      console.error(
        'Interview size mismatch',
        JSON.stringify({ expected: { width, height }, viewport, native }),
      );
      throw error;
    });
  const native = await app.evaluate(
    ({ BrowserWindow }, value) => {
      const window = BrowserWindow.getAllWindows().find(
        (w) => w.webContents.getURL() === value.url,
      );
      if (!window) throw Error('Fixture window disappeared');
      return window.getContentSize();
    },
    { url: page.url(), width, height },
  );
  const viewport = await page.evaluate(() => [innerWidth, innerHeight]);
  assert.ok(
    viewport.every((value, i) => Math.abs(value - native[i]) <= 1),
    JSON.stringify({ native, viewport }),
  );
}
async function end(page) {
  await page.getByRole('button', { name: '结束面试', exact: true }).click();
  await Promise.all([
    page.waitForEvent('close'),
    page.getByRole('button', { name: '确认结束面试', exact: true }).click(),
  ]);
}
try {
  const main = await app.firstWindow();
  main.setDefaultTimeout(15000);
  const errors = [];
  main.on('pageerror', (e) => errors.push(e.message));
  await main
    .getByRole('button', { name: '聊天模型', exact: true })
    .getByText('Test Model', { exact: true })
    .waitFor();
  await seed(main);
  await main.getByRole('button', { name: '用户菜单', exact: true }).click();
  await main.getByRole('menuitem', { name: '设置', exact: true }).click();
  await main
    .getByRole('navigation', { name: '设置分类' })
    .getByRole('button', { name: '通用', exact: true })
    .click();
  await main.getByRole('button', { name: '面试设置', exact: true }).click();
  const settings = main.getByRole('dialog', { name: '设置', exact: true });
  await settings.getByRole('heading', { name: '面试设置', exact: true }).waitFor();
  assert.equal(await settings.getByRole('button', { name: '转写模式', exact: true }).count(), 0);
  assert.equal(
    await settings.getByRole('checkbox', { name: '使用 ChatGPT 回答', exact: true }).count(),
    0,
  );
  assert.equal(
    await settings.getByRole('checkbox', { name: '面试者 · 麦克风', exact: true }).count(),
    0,
  );
  const chooseMic = async (label) => {
    await settings.getByRole('button', { name: '麦克风设备', exact: true }).click();
    await main.getByRole('menuitemradio', { name: label, exact: true }).click();
  };
  await chooseMic('不使用麦克风');
  assert.equal(
    await settings.getByRole('button', { name: '麦克风设备', exact: true }).isDisabled(),
    false,
  );
  assert.equal(await settings.getByRole('button', { name: '测试麦克风', exact: true }).count(), 0);
  await chooseMic('测试麦克风设备');
  await settings.getByRole('button', { name: '关闭设置', exact: true }).click();
  await main.locator('.interview-start-trigger').click();
  const audioCheck = main.getByRole('dialog', { name: '开始面试', exact: true });
  const testStarted = Date.now();
  await audioCheck.getByRole('button', { name: '测试麦克风', exact: true }).click();
  await audioCheck.getByRole('button', { name: '停止麦克风测试', exact: true }).waitFor();
  assert.equal(
    await audioCheck.getByRole('button', { name: '确认开始', exact: true }).isDisabled(),
    true,
  );
  await main.waitForFunction(
    () => Number(document.querySelector('[role="meter"]').getAttribute('aria-valuenow')) > 50,
  );
  const meter = await audioCheck
    .getByRole('meter', { name: '麦克风电平', exact: true })
    .boundingBox();
  assert.ok(meter.width > 0, 'Inline meter is visible');
  await main.screenshot({ animations: 'disabled' });
  const micCalls = await app.evaluate(() => globalThis.speechCalls);
  assert.deepEqual(micCalls.at(-1).options, { sources: ['microphone'], microphone: 'fixture-mic' });
  await audioCheck.getByRole('button', { name: '测试麦克风', exact: true }).waitFor();
  assert.ok(Date.now() - testStarted >= 9000, 'Ten-second self-test is not retired early');
  assert.equal(await app.evaluate(() => globalThis.speechCalls.at(-1).op), 'stop');
  await audioCheck.getByRole('button', { name: '测试麦克风', exact: true }).click();
  await audioCheck.getByRole('button', { name: '停止麦克风测试', exact: true }).waitFor();
  await audioCheck.getByRole('button', { name: '取消', exact: true }).click();
  await waitForAsync(main, async () => {
    const state = await window.desktop.dictation({ op: 'status' });
    return state.state === 'idle';
  });
  assert.equal(await app.evaluate(() => globalThis.speechCalls.at(-1).op), 'stop');
  check('开场行内真实活动电平、十秒上限、测试中禁止确认及关闭释放');
  await app.evaluate(() => {
    globalThis.microphoneDenied = true;
  });
  await main.locator('.interview-start-trigger').click();
  await audioCheck.getByText(/麦克风权限未开启/).waitFor();
  assert.equal(
    await audioCheck.getByRole('button', { name: '确认开始', exact: true }).isDisabled(),
    true,
  );
  await main.screenshot({});
  await audioCheck.getByRole('button', { name: '取消', exact: true }).click();
  await main.getByRole('button', { name: '用户菜单', exact: true }).click();
  await main.getByRole('menuitem', { name: '设置', exact: true }).click();
  await main
    .getByRole('navigation', { name: '设置分类' })
    .getByRole('button', { name: '通用', exact: true })
    .click();
  await settings.getByRole('button', { name: '面试设置', exact: true }).click();
  await settings.getByRole('heading', { name: '面试设置', exact: true }).waitFor();
  await app.evaluate(() => {
    globalThis.microphoneDenied = false;
    globalThis.microphoneMissing = true;
  });
  await main.evaluate(() => window.dispatchEvent(new Event('focus')));
  assert.equal(await settings.getByRole('button', { name: '刷新设备', exact: true }).count(), 0);
  await settings
    .getByRole('button', { name: '麦克风设备', exact: true })
    .getByText('所选麦克风已不可用', { exact: true })
    .waitFor();
  assert.equal(await settings.getByRole('button', { name: '测试麦克风', exact: true }).count(), 0);
  await settings.getByRole('button', { name: '关闭设置', exact: true }).click();
  await main.locator('.interview-start-trigger').click();
  const noMicConfirmation = main.getByRole('dialog', { name: '开始面试', exact: true });
  await noMicConfirmation.getByText('设备不可用', { exact: true }).waitFor();
  await noMicConfirmation
    .getByText('所选麦克风设备不可用，请在面试设置中重新选择。', { exact: true })
    .waitFor();
  assert.equal(
    await noMicConfirmation.getByRole('button', { name: '确认开始', exact: true }).isDisabled(),
    true,
  );
  await main.screenshot({});
  await noMicConfirmation.getByRole('button', { name: '取消', exact: true }).click();
  check('无麦克风与权限错误内联提示，开场阻止缺失设备');
  await app.evaluate(() => {
    globalThis.microphoneMissing = false;
  });
  await main.getByRole('button', { name: '用户菜单', exact: true }).click();
  await main.getByRole('menuitem', { name: '设置', exact: true }).click();
  await main
    .getByRole('navigation', { name: '设置分类' })
    .getByRole('button', { name: '通用', exact: true })
    .click();
  await settings.getByRole('button', { name: '面试设置', exact: true }).click();
  await settings.getByRole('button', { name: '面试回答模型', exact: true }).click();
  const effortSlider = settings.getByRole('slider', { name: '面试回答思考强度', exact: true });
  await effortSlider.press('End');
  assert.equal(await effortSlider.getAttribute('aria-valuetext'), '高');
  await effortSlider.press('Escape');
  await main.screenshot({});
  await settings.getByRole('button', { name: '关闭设置', exact: true }).click();
  check('音频禁用、所选设备自检及释放、设备自动刷新、模型与思考强度设置');
  await main.locator('.interview-start-trigger').click();
  const confirmation = main.getByRole('dialog', { name: '开始面试', exact: true });
  assert.equal(await confirmation.locator('.speech-controls').count(), 0);
  const summary = confirmation.locator('.interview-start-summary');
  await summary.getByText('测试麦克风设备', { exact: true }).waitFor();
  await summary.getByText('测试扬声器', { exact: true }).waitFor();
  await summary.getByText('Test Model', { exact: true }).waitFor();
  await summary.getByText('高', { exact: true }).waitFor();
  assert.equal(await confirmation.getByText(/确认后自动转写，请先取得参与者同意/).count(), 0);
  await confirmation.getByText(/音频仅在本机处理，不保存/).waitFor();
  assert.equal(
    await confirmation.getByRole('button', { name: '前往面试设置', exact: true }).count(),
    0,
  );
  await main.screenshot({});
  const [floating] = await Promise.all([
    app.waitForEvent('window'),
    confirmation.getByRole('button', { name: '确认开始', exact: true }).click(),
  ]);
  floating.setDefaultTimeout(15000);
  floating.on('pageerror', (e) => errors.push(e.message));
  await floating.getByRole('button', { name: '结束面试', exact: true }).waitFor();
  await size(floating, 1060, 682);
  const config = await floating.evaluate(() => window.desktop.interviewState());
  assert.equal(config.configuration.effort, 'high');
  assert.equal(config.configuration.options.microphone, 'fixture-mic');
  assert.equal(
    await floating
      .locator('.floating-toolbar')
      .getByRole('button', { name: '转写面板', exact: true })
      .count(),
    0,
  );
  assert.equal(await floating.getByRole('button', { name: /^(置顶|已置顶)$/ }).count(), 0);
  assert.equal(await floating.locator('.floating-notice').count(), 0);
  assert.equal(await floating.evaluate(() => window.desktop.togglePin()), true);
  const auto = floating.getByRole('button', { name: '静音后自动提交完整问题', exact: true });
  assert.equal(await auto.getAttribute('aria-pressed'), 'true');
  await auto.click();
  assert.equal(await auto.getAttribute('aria-pressed'), 'false');
  await auto.click();
  assert.equal(await auto.getAttribute('aria-pressed'), 'true');
  await auto.click();
  assert.equal(await auto.getAttribute('aria-pressed'), 'false');
  const toolbarWidth = (await floating.locator('.floating-toolbar').boundingBox()).width;
  assert.ok(toolbarWidth < 350, 'Toolbar should fit contents without empty space');
  await floating.getByRole('button', { name: '转写面板', exact: true }).click();
  await floating.waitForFunction(
    () =>
      !document.querySelector('.floating-shell').dataset.panelMotion &&
      [...document.querySelectorAll('.floating-panel')].filter((node) => node.checkVisibility())
        .length === 1,
  );
  assert.equal(await floating.locator('.floating-panel:visible').count(), 1);
  assert.equal(
    await floating.locator('.floating-panel').count(),
    2,
    'Hidden transcript DOM is retained',
  );
  await floating.getByRole('button', { name: '转写面板', exact: true }).click();
  await floating.waitForFunction(
    () =>
      !document.querySelector('.floating-shell').dataset.panelMotion &&
      [...document.querySelectorAll('.floating-panel')].filter((node) => node.checkVisibility())
        .length === 2,
  );
  check('配置锁定、浮窗实时开关与固定置顶、底部说明删除');
  const sendSegment = async (id, text, final, source = 'system') =>
    app.evaluate(
      ({ BrowserWindow }, value) => {
        const win = BrowserWindow.getAllWindows().find((w) =>
          w.webContents.getURL().endsWith('#interview'),
        );
        win.webContents.send('speech:event', {
          type: 'segment',
          segment: { ...value, startMs: Date.now(), endMs: Date.now() + 50, reason: 'silence' },
        });
      },
      { id, text, final, source },
    );
  await sendSegment('system-interim', '实时问题还没有等到静音', false);
  await floating.getByRole('textbox', { name: '面试提问', exact: true }).evaluate(async (node) => {
    for (let i = 0; i < 30 && node.value !== '实时问题还没有等到静音'; i++)
      await new Promise((r) => setTimeout(r, 30));
    assertValue();
    function assertValue() {
      if (node.value !== '实时问题还没有等到静音') throw Error('Interim not mirrored');
    }
  });
  await sendSegment('mic', '面试者回答不可填入问题', true, 'microphone');
  assert.equal(
    await floating.getByRole('textbox', { name: '面试提问', exact: true }).inputValue(),
    '实时问题还没有等到静音',
  );
  await floating.getByRole('textbox', { name: '面试提问', exact: true }).fill('');
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) =>
      w.webContents.getURL().endsWith('#interview'),
    );
    win.webContents.send('speech:event', {
      type: 'gap',
      source: 'microphone',
      message: '合成麦克风间断后恢复',
    });
  });
  await sendSegment('system-interim', '恢复后实时问题仍能回填', false);
  await floating.waitForFunction(
    () => document.querySelector('[aria-label="面试提问"]').value === '恢复后实时问题仍能回填',
  );
  check('手动清空后麦克风恢复，新系统转写继续回填提问框');
  await floating.getByRole('button', { name: '发送面试问题', exact: true }).click();
  await sendSegment('system-interim', '稍后到达的完整终稿', true);
  await floating
    .locator('.answer-text')
    .getByText(/动态规划是一种/)
    .waitFor();
  assert.equal(
    await floating.getByRole('textbox', { name: '面试提问', exact: true }).inputValue(),
    '',
  );
  const request = (await app.evaluate(() => globalThis.interviewRequests))[0];
  assert.equal(request.effort, 'high');
  await floating.getByRole('textbox', { name: '面试提问', exact: true }).fill('举一个斐波那契例子');
  await floating.getByRole('button', { name: '发送面试问题', exact: true }).click();
  await floating
    .locator('.answer-bubble')
    .getByText(/以斐波那契为例/)
    .waitFor();
  assert.equal(await floating.locator('.answer-bubble').count(), 2);
  assert.equal(await floating.locator('.floating-answer-item .duration-toggle').count(), 2);
  assert.equal(
    await floating.locator('.floating-answer-item .duration-toggle[aria-expanded="true"]').count(),
    0,
  );
  assert.equal(await floating.getByText('已完成 5 个步骤', { exact: true }).count(), 0);
  await floating.screenshot({});
  await floating.locator('.floating-answer').screenshot({ animations: 'disabled' });
  check('回答独立圆角气泡、上方摘要默认收起、不编造步骤数');
  await floating.getByRole('textbox', { name: '面试提问', exact: true }).fill('');
  await floating.getByRole('button', { name: '发送面试问题', exact: true }).click();
  await floating
    .locator('.answer-bubble')
    .nth(2)
    .getByText(/动态规划是一种/)
    .waitFor();
  assert.equal(
    await app.evaluate(() => globalThis.interviewRequests[2].turns.at(-1).content.split('\n\n')[0]),
    '稍后到达的完整终稿',
  );
  check('空输入显式发送最新面试官问题');
  check('临时转写可直接发送、麦克风不污染问题、终稿不重复提交、单库与 effort 透传');
  const toolbarPosition = async () => {
    const bounds = await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((w) => w.webContents.getURL().endsWith('#interview'))
        .getContentBounds(),
    );
    const rect = await floating.locator('.floating-toolbar').boundingBox();
    return { center: bounds.x + rect.x + rect.width / 2, top: bounds.y + rect.y, bounds };
  };
  const original = await toolbarPosition();
  await floating.getByRole('button', { name: '收起面试窗口', exact: true }).click();
  await size(floating, 420, 72);
  const collapsed = await toolbarPosition();
  assert.ok(Math.abs(original.center - collapsed.center) <= 1);
  assert.ok(Math.abs(original.top - collapsed.top) <= 1);
  await floating.screenshot({});
  await floating.getByRole('button', { name: '展开面试窗口', exact: true }).click();
  await size(floating, 1060, 682);
  const restored = await toolbarPosition();
  assert.ok(Math.abs(original.center - restored.center) <= 1);
  assert.ok(Math.abs(original.top - restored.top) <= 1);
  assert.equal(
    await floating
      .locator('.floating-drag-handle')
      .evaluate((node) => getComputedStyle(node).webkitAppRegion),
    'no-drag',
  );
  assert.equal(
    await floating
      .locator('.floating-toolbar')
      .evaluate((node) => getComputedStyle(node).webkitAppRegion),
    'no-drag',
  );
  check('品牌整块收起、工具栏绝对中心和顶部位置不跳动、独立拖拽区');
  const handle = floating.getByRole('button', { name: '拖动右下角调整尺寸', exact: true });
  await floating.mouse.move(0, 0);
  await floating.waitForFunction(
    () => getComputedStyle(document.querySelector('.resize-right')).opacity === '0',
  );
  assert.equal(await handle.evaluate((node) => getComputedStyle(node).opacity), '0');
  const hoverBox = await handle.boundingBox();
  requireDesktop();
  const hoverPoint = await app.evaluate(({ BrowserWindow, screen }, box) => {
    const bounds = BrowserWindow.getAllWindows()
      .find((w) => w.webContents.getURL().endsWith('#interview'))
      .getContentBounds();
    return screen.dipToScreenPoint({
      x: Math.round(bounds.x + box.x + box.width / 2),
      y: Math.round(bounds.y + box.y + box.height / 2),
    });
  }, hoverBox);
  await floating.bringToFront();
  await floating.evaluate(() => {
    globalThis.hoverEvents = [];
    window.addEventListener(
      'mousemove',
      (e) => {
        globalThis.hoverEvents.push({
          x: e.clientX,
          y: e.clientY,
          screenX: e.screenX,
          screenY: e.screenY,
          target: e.target?.closest?.('.floating-resize')?.className,
        });
        if (globalThis.hoverEvents.length > 8) globalThis.hoverEvents.shift();
      },
      true,
    );
  });
  probe('move', hoverPoint.x, hoverPoint.y);
  const hoverHandle = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((w) => w.webContents.getURL().endsWith('#interview'))
      .getNativeWindowHandle()
      .readBigUInt64LE()
      .toString(),
  );
  const hitDeadline = performance.now() + 5000;
  while (probe('window', hoverHandle, path.resolve('public/voxcue.ico')).extendedStyle & 32) {
    if (performance.now() > hitDeadline) {
      console.error(
        JSON.stringify({
          hoverBox,
          hoverPoint,
          cursor: probe('cursor'),
          events: await floating.evaluate(() => globalThis.hoverEvents),
        }),
      );
      throw Error('Resize region did not disable native passthrough');
    }
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  // Forwarded movement first unlocks the HWND. A subsequent physical movement
  // supplies ordinary native hover instead of relying on CDP hover synthesis.
  probe('move', hoverPoint.x + 1, hoverPoint.y);
  assert.equal(
    probe('hit', hoverHandle, hoverPoint.x + 1, hoverPoint.y).expected,
    true,
    'Idle resize surface must receive native hit testing',
  );
  await floating.waitForFunction(
    () => getComputedStyle(document.querySelector('.resize-right')).opacity === '1',
  );
  // CDP synthetic pointer events do not move the OS cursor. Only cursor coordinates
  // are a fixture here; the IPC, bounds calculation and native setBounds are real.
  await app.evaluate(({ screen }) => {
    globalThis.originalCursor = screen.getCursorScreenPoint;
    globalThis.fixtureCursor = { x: 800, y: 600 };
    screen.getCursorScreenPoint = () => globalThis.fixtureCursor;
  });
  const box = await handle.boundingBox();
  await floating.mouse.move(box.x + 17, box.y + 17);
  await floating.mouse.down();
  await app.evaluate(() => {
    globalThis.fixtureCursor = { x: 750, y: 560 };
  });
  await floating.mouse.move(box.x - 33, box.y - 23);
  await floating.mouse.up();
  await floating.waitForTimeout(150);
  const resized = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((w) => w.webContents.getURL().endsWith('#interview'))
      .getContentBounds(),
  );
  assert.ok(resized.width < original.bounds.width && resized.height < original.bounds.height);
  const resizedToolbar = await toolbarPosition();
  const anchorDiagnostic = JSON.stringify({ original, resized, resizedToolbar });
  assert.ok(Math.abs(resizedToolbar.center - original.center) <= 1, anchorDiagnostic);
  assert.ok(Math.abs(resizedToolbar.top - original.top) <= 1, anchorDiagnostic);
  await app.evaluate(({ screen }) => {
    screen.getCursorScreenPoint = globalThis.originalCursor;
  });
  await size(floating, resized.width, resized.height);
  await floating.screenshot({});
  await floating.evaluate(() => {
    localStorage.setItem('copilot-theme', 'dark');
    window.dispatchEvent(new Event('storage'));
  });
  await floating.screenshot({ animations: 'disabled' });
  check('悬停缩放图标、拖动尺寸真实 IPC、工具栏中心及顶部固定；系统指针位置使用夹具');
  await floating.getByRole('button', { name: '结束面试', exact: true }).click();
  await floating.getByRole('button', { name: '确认结束面试', exact: true }).waitFor();
  assert.equal(
    await floating.getByRole('button', { name: '取消结束面试', exact: true }).count(),
    0,
  );
  await floating.getByRole('button', { name: '结束面试', exact: true }).waitFor();
  await floating.evaluate(() => window.desktop.windowAction('close'));
  await floating.getByRole('button', { name: '确认结束面试', exact: true }).waitFor();
  await floating.screenshot({});
  await Promise.all([
    floating.waitForEvent('close'),
    floating.getByRole('button', { name: '确认结束面试', exact: true }).click(),
  ]);
  check('确认结束三秒自动收回、无取消按钮、系统关闭同样二次确认');
  await app.evaluate(() => {
    globalThis.delaySummary = true;
  });
  await main.getByRole('textbox', { name: '聊天消息', exact: true }).fill('后台继续回复');
  await main.getByRole('button', { name: '发送消息', exact: true }).click();
  await main.locator('.chat-message.assistant').last().getByRole('status').waitFor();
  assert.equal(await main.locator('.reasoning-summary').count(), 0);
  await app.evaluate(async () => {
    for (let i = 0; i < 50 && typeof globalThis.resumeSummary !== 'function'; i++)
      await new Promise((r) => setTimeout(r, 20));
    globalThis.delaySummary = false;
    globalThis.resumeSummary();
  });
  await main.locator('.reasoning-summary summary').getByText('核对资料', { exact: true }).waitFor();
  assert.equal(await main.locator('.reasoning-summary').getAttribute('open'), null);
  await main.locator('.duration-toggle').click();
  await main.locator('.reasoning-summary summary').click();
  await main.locator('.reasoning-summary .markdown-content').waitFor();
  await main.locator('.reasoning-summary summary').click();
  await main.getByRole('button', { name: '面试记录', exact: true }).click();
  await main.waitForTimeout(350);
  await main.getByRole('button', { name: '知识库', exact: true }).click();
  await main.waitForTimeout(350);
  await main
    .locator('.conversation-row')
    .filter({ hasText: '后台继续回复' })
    .locator('.conversation')
    .click();
  await main
    .locator('.chat-answer')
    .getByText(/第 18 段回答/)
    .waitFor();
  const scroll = main.locator('.chat-scroll');
  await scroll.hover();
  await main.mouse.wheel(0, -2000);
  await main.waitForTimeout(100);
  const top = await scroll.evaluate((node) => node.scrollTop);
  await main.waitForTimeout(350);
  assert.ok(
    Math.abs((await scroll.evaluate((node) => node.scrollTop)) - top) < 5,
    'Streaming pulled reader down',
  );
  await main.getByRole('button', { name: '停止回复', exact: true }).waitFor({ state: 'detached' });
  await main
    .locator('.chat-answer')
    .getByText(/第 27 段回答/)
    .waitFor();
  await main.locator('.reasoning-summary summary').click();
  await main.screenshot({});
  check('切页后台继续、真实活动状态先出现、公开摘要到达后可展开、流式阅读不强制拉底');
  await app.evaluate(() => {
    globalThis.omitSummary = true;
  });
  await main.getByRole('textbox', { name: '聊天消息', exact: true }).fill('没有公开摘要的回答');
  await main.getByRole('button', { name: '发送消息', exact: true }).click();
  await main.getByText('本次没有公开摘要的测试回答', { exact: true }).waitFor();
  assert.equal(
    await main.locator('.chat-message.assistant').last().locator('.reasoning-summary').count(),
    0,
  );
  check('完成后没有公开摘要则不显示空入口，不伪造思考文本');
  assert.deepEqual(errors, []);
  await console.log(JSON.stringify({ checks, errors }, null, 2));
  console.log(JSON.stringify({ passed: checks.length, profile, checks }, null, 2));
} finally {
  probe('up');
  probe('move', cursorBefore.x, cursorBefore.y);
  await app.evaluate(({ BrowserWindow }) => {
    for (const win of BrowserWindow.getAllWindows()) win.destroy();
  });
  await closeUiApp(app);
}
