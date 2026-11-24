import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import workspace from '../../scripts/workspace.mjs';
import { testRoot, electron } from './test-workspace.mjs';
import { closeUiApp } from './install-ui-account.mjs';
import { opening, longMarkdown } from '../fixtures/long-markdown.mjs';

// An owned browser host loads the actual built page over the production LAN
// service. Only this fixture's origin is reachable; no desktop account or audio
// implementation is loaded. Store/coordinator integration is covered separately.
const entry = path.join(testRoot, 'offline-electron-entry.cjs');
const profile = path.join(testRoot, 'mobile-profile');
await mkdir(profile);
await writeFile(entry, `
const {app,BrowserWindow,session}=require('electron');
app.setPath('userData',process.env.COPILOT_TEST_USER_DATA);
app.setPath('sessionData',process.env.COPILOT_TEST_USER_DATA);
const {RemoteConnectionService}=require(${JSON.stringify(path.join(workspace.platformRoot, 'dist-electron/shared/electron/backend/remoteConnection/service.js'))});
const {createMobileAssets}=require(${JSON.stringify(path.join(workspace.platformRoot, 'dist-electron/shared/electron/backend/remoteConnection/assets.js'))});
const snapshot={
  sessionId:'synthetic-mobile-ui',sessionEpoch:1,revision:1,status:'running',inputMode:'remote',
  transcripts:[{id:'t1',text:'Synthetic system question',time:'12:00',final:true,source:'system'},
    {id:'t2',text:'Synthetic microphone reply',time:'12:01',final:true,source:'microphone'}],
  answers:[{id:'a1',question:'Synthetic formula question',content:'Inline $x^2$ and display:\\n\\n$$\\\\frac{a}{b}$$',status:'completed'}],
  pendingQuestion:'',pendingQuestionRevision:1,omitted:{transcripts:0,answers:0},
  inputDraft:{text:'Computer draft',revision:1,manual:true},
  generating:false,aiEnabled:true,microphoneMuted:false,microphoneToggling:false,
  micRevision:1,autoAnswer:false,autoAnswerRevision:1,
  capabilities:{sendQuestion:true,setMicrophone:true,setAutoAnswer:true,stopAnswer:false}
};
let origin;
const service=new RemoteConnectionService({
  mobileAssets:createMobileAssets(${JSON.stringify(path.join(workspace.platformRoot, 'dist'))}),
  onState(){},
  async onCommand(command){
    const delay=globalThis.mobileUi.delayedCommand;
    if(delay?.action===command.action)await delay.done;
    const result={requestId:command.requestId,ok:true};
    if(command.action==='set-draft'){
      if(command.expectedRevision!==snapshot.inputDraft.revision)return {...result,ok:false,error:'draft-conflict'};
      snapshot.inputDraft={text:command.text,revision:snapshot.inputDraft.revision+1,manual:true};
      result.inputDraftRevision=snapshot.inputDraft.revision;
    }else if(command.action==='set-microphone'){
      snapshot.microphoneMuted=command.muted;snapshot.micRevision++;
    }else if(command.action==='set-auto-answer'){
      snapshot.autoAnswer=command.enabled;snapshot.autoAnswerRevision++;
    }else if(command.action==='ask'){
      if(command.inputDraftRevision!==snapshot.inputDraft.revision)return {...result,ok:false,error:'draft-conflict'};
      snapshot.answers.push({id:'a2',question:command.text,content:'Synthetic streamed answer',status:'streaming'});
      snapshot.inputDraft={text:'',revision:snapshot.inputDraft.revision+1,manual:false};
      snapshot.generating=true;snapshot.capabilities.stopAnswer=true;snapshot.capabilities.sendQuestion=false;
      result.answerId='a2';result.inputDraftRevision=snapshot.inputDraft.revision;
    }else if(command.action==='stop-answer'){
      snapshot.answers.at(-1).status='stopped';snapshot.generating=false;
      snapshot.capabilities.stopAnswer=false;snapshot.capabilities.sendQuestion=true;
    }
    snapshot.revision++;service.updateSnapshot(structuredClone(snapshot));return result;
  }
});
globalThis.mobileUi={service,snapshot};
app.whenReady().then(async()=>{
  const state=await service.start();
  if(state.status!=='waiting')throw Error(state.error||'Private interface unavailable');
  origin=state.addresses[0];service.updateSnapshot(structuredClone(snapshot));
  session.defaultSession.webRequest.onBeforeRequest(
    {urls:['http://*/*','https://*/*','ws://*/*','wss://*/*']},
    (details,callback)=>{const url=new URL(details.url);callback({cancel:![origin,origin.replace('http:','ws:')].includes(url.origin)});});
  const win=new BrowserWindow({width:390,height:844,useContentSize:true,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  win.webContents.on('will-navigate',(event,url)=>{if(new URL(url).origin!==origin)event.preventDefault();});
  await win.loadURL(service.pairing().url);
});
app.on('window-all-closed',()=>app.quit());
`);
const app = await electron.launch({
  args: [entry],
  env: { ...process.env, COPILOT_TEST_USER_DATA: profile, VITE_DEV_SERVER_URL: '' },
});
try {
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (/Content Security Policy|Refused to/.test(message.text())) errors.push(message.text());
  });
  await page.getByRole('button', { name: /连接电脑|Connect computer/, exact: true }).click();
  await page.locator('.mobile-pairing-code').waitFor();
  const waiting = page.locator('.mobile-waiting[role="status"]');
  await waiting.getByText(/^(等待电脑允许|Waiting for approval)$/).waitFor();
  await waiting.locator('.mobile-spinner[aria-hidden="true"]').waitFor();
  const code = (await page.locator('.mobile-pairing-code').innerText()).replace(/\s/g, '');
  assert.match(code, /^\d{6}$/);
  const desktopCode = await app.evaluate(async () => {
    const deadline = Date.now() + 5000;
    while (!globalThis.mobileUi.service.pending?.socket && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 20));
    const pending = globalThis.mobileUi.service.state().pending;
    globalThis.mobileUi.service.approve(pending.id);
    return pending.code;
  });
  assert.equal(code, desktopCode);
  const input = page.locator('textarea');
  await page.waitForFunction(() => document.querySelector('textarea')?.value === 'Computer draft');
  assert.equal(await page.locator('.mobile-markdown math').count(), 2);
  assert.equal(await page.locator('.katex-error').count(), 0);
  if (process.platform === 'darwin') {
    for (const name of ['more', 'microphone', 'send', 'radio']) {
      const icon = page.locator(`[data-mobile-symbol="${name}"]`).first();
      const mask = await icon.evaluate(element => getComputedStyle(element).maskImage);
      assert.match(mask, /^url\("http:\/\/[^"]+\/assets\/[\w-]+\.png"\)$/);
    }
    assert.equal(await page.locator('button svg').count(), 0);
  }
  const setLanguage = async (language, close) => {
    await page.getByRole('button', { name: /更多|More/, exact: true }).click();
    await page.locator('select').first().selectOption(language);
    await page.getByRole('button', { name: close, exact: true }).click();
  };
  const checkPending = async (action, trigger, pending) => {
    await app.evaluate((_, action) => {
      let release;
      const done = new Promise(resolve => { release = resolve; });
      globalThis.mobileUi.delayedCommand = { action, done, release };
    }, action);
    await trigger.click();
    await pending.locator('.mobile-spinner[aria-hidden="true"]').waitFor();
    assert.equal(await pending.getAttribute('aria-busy'), 'true');
    assert.equal(await pending.isDisabled(), true);
    await app.evaluate(() => {
      globalThis.mobileUi.delayedCommand.release();
      delete globalThis.mobileUi.delayedCommand;
    });
  };
  await setLanguage('zh', '关闭');
  const mute = page.getByRole('switch', { name: '关闭麦克风', exact: true });
  await checkPending('set-microphone', mute, mute);
  const unmute = page.getByRole('switch', { name: '打开麦克风', exact: true });
  await unmute.click();
  await mute.waitFor();
  await setLanguage('en', 'Close');
  assert.doesNotMatch(await page.locator('body').innerText(), /\p{Script=Han}/u);
  await input.fill('Shared synthetic question');
  await app.evaluate(async () => {
    const deadline = Date.now() + 5000;
    while (globalThis.mobileUi.snapshot.inputDraft.text !== 'Shared synthetic question' && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 20));
  });
  assert.equal(await app.evaluate(() => globalThis.mobileUi.snapshot.inputDraft.text), 'Shared synthetic question');
  await page.getByRole('switch', { name: 'Turn microphone off', exact: true }).click();
  await page.getByRole('switch', { name: 'Turn microphone on', exact: true }).waitFor();
  assert.equal(await app.evaluate(() => globalThis.mobileUi.snapshot.microphoneMuted), true);
  const autoAnswerDot = page.locator('.mobile-auto-answer').locator(
    '[data-mobile-symbol^="radio"], .mobile-toggle-dot',
  );
  const assertDotSize = async (label) => {
    const { css, rendered, expected } = await autoAnswerDot.evaluate((element) => {
      const style = getComputedStyle(element);
      const { width, height } = element.getBoundingClientRect();
      const pixels = (value) => Math.round(value * devicePixelRatio);
      return { css: [style.width, style.height], rendered: [pixels(width), pixels(height)], expected: pixels(11) };
    });
    assert.deepEqual(css, ['11px', '11px'], label);
    assert.deepEqual(rendered, [expected, expected], label);
  };
  await assertDotSize('Auto answer off dot size');
  await page.locator('.mobile-auto-answer[aria-checked="false"]').click();
  await page.locator('.mobile-auto-answer[aria-checked="true"]').waitFor();
  await assertDotSize('Auto answer on dot size');
  await checkPending(
    'ask',
    page.getByRole('button', { name: 'Send', exact: true }),
    page.getByRole('button', { name: 'Sending…', exact: true }),
  );
  const stop = page.getByRole('button', { name: 'Stop answer', exact: true });
  await stop.waitFor();
  assert.equal(await input.inputValue(), '');
  await checkPending(
    'stop-answer',
    stop,
    page.getByRole('button', { name: 'Stopping…', exact: true }),
  );
  await page.getByText('Stopped', { exact: true }).waitFor();
  for (const [content, status] of [[opening, 'streaming'], [longMarkdown, 'completed']]) {
    await app.evaluate((_electron, { content, status }) => {
      const { service, snapshot } = globalThis.mobileUi;
      Object.assign(snapshot.answers.at(-1), { content, status });
      snapshot.revision++;
      service.updateSnapshot(structuredClone(snapshot));
    }, { content, status });
  }
  const longReply = page.locator('.mobile-markdown').last();
  await longReply.getByText('All receipts reconciled', { exact: true }).waitFor();
  assert.equal(await longReply.locator('p > strong').count(), 90);
  const answers = page.locator('.mobile-answer-scroll');
  await answers.press('Home');
  await page.getByRole('button', { name: 'Back to latest', exact: true }).waitFor();
  await app.evaluate(() => {
    const { service, snapshot } = globalThis.mobileUi;
    snapshot.answers.at(-1).content += '\n\nSynthetic postscript while reading.';
    snapshot.revision++;
    service.updateSnapshot(structuredClone(snapshot));
  });
  await longReply.getByText('Synthetic postscript while reading.', { exact: true }).waitFor();
  const latest = page.getByRole('button', { name: 'New content', exact: true });
  await latest.locator('[aria-hidden="true"]').waitFor();
  assert.equal(await answers.evaluate(node => node.scrollTop), 0);
  await latest.click();
  const atEnd = () => page.waitForFunction(() => {
    const pane = document.querySelector('.mobile-answer-scroll');
    return pane.scrollHeight - pane.clientHeight - pane.scrollTop <= 1;
  });
  await atEnd();
  await answers.press('Home');
  await page.getByRole('button', { name: 'Back to latest', exact: true }).waitFor();
  await answers.press('End');
  await atEnd();
  await page.getByRole('button', { name: 'Hidden', exact: true }).click();
  assert.equal(await page.locator('.mobile-transcript-scroll').count(), 0);
  await page.getByRole('button', { name: 'Show transcript', exact: true }).click();
  for (const width of [320, 390, 768]) {
    await page.setViewportSize({ width, height: 740 });
    await page.waitForFunction((width) => {
      const app = document.querySelector('.mobile-app');
      return app.clientWidth === width && Math.abs(app.getBoundingClientRect().bottom - innerHeight) < 2;
    }, width);
    const geometry = await page.locator('.mobile-composer').evaluate((composer) => {
      const field = composer.querySelector('textarea').getBoundingClientRect();
      const toolbar = composer.querySelector('.mobile-composer-toolbar').getBoundingClientRect();
      const controls = [...composer.querySelectorAll('button')].map((button) => {
        const box = button.getBoundingClientRect();
        return { width: box.width, height: box.height, right: box.right, left: box.left };
      });
      return { fieldBottom: field.bottom, toolbarTop: toolbar.top, controls, bottom: composer.getBoundingClientRect().bottom, height: innerHeight };
    });
    assert.ok(geometry.fieldBottom <= geometry.toolbarTop);
    assert.ok(Math.abs(geometry.bottom - geometry.height) < 2);
    assert.ok(geometry.controls.every((control) => control.width >= 44 && control.height >= 44 && control.left >= 0 && control.right <= width));
    assert.equal(geometry.controls[1].width, geometry.controls[1].height);
    assert.equal(geometry.controls[2].width, geometry.controls[2].height);
  }
  await app.evaluate(() => {
    const { service, snapshot } = globalThis.mobileUi;
    service.active.terminate();
    snapshot.inputDraft = { text: 'Computer draft after reconnect', revision: snapshot.inputDraft.revision + 1, manual: true };
    snapshot.revision++; service.updateSnapshot(structuredClone(snapshot));
  });
  await page.waitForFunction(() => document.querySelector('textarea')?.value === 'Computer draft after reconnect' && !document.querySelector('textarea').disabled);
  await page.reload();
  await page.getByRole('button', { name: 'Resume connection', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('textarea')?.value === 'Computer draft after reconnect' && !document.querySelector('textarea').disabled);
  assert.deepEqual(errors, []);
  assert.equal(await app.evaluate(() => globalThis.mobileUi.service.state().status), 'connected');
  console.log('PASS: bundled mobile page, LAN pairing, MathML/CSP, bilingual controls and pending feedback, shared draft, mic/auto answer/send/stop, long-answer keyboard navigation, responsive controls and reconnect/reload.');
} finally {
  await app.evaluate(() => {
    globalThis.mobileUi.delayedCommand?.release();
    globalThis.mobileUi.service.disconnect();
  }).catch(() => {});
  await closeUiApp(app);
}
