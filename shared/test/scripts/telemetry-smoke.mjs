import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import workspace from '../../scripts/workspace.mjs';
import { testRoot, electron } from './test-workspace.mjs';
import { offlineElectronEntry } from './offline-electron-entry.mjs';
import {
  installUiAccount,
  enterPrimaryUiAccount,
  closeUiApp,
  waitForRestoredMainWindow,
} from './install-ui-account.mjs';

const desktop =
  process.platform === 'darwin'
    ? await import(
        pathToFileURL(path.join(workspace.platformRoot, 'test/scripts/desktop-session.mjs')).href
      )
    : undefined;
const releaseDesktop = desktop?.holdDesktopAwake();
const guard =
  desktop &&
  setInterval(() => {
    try {
      desktop.requireUnlockedDesktop();
    } catch (error) {
      console.error(error.message);
      process.exit(1);
    }
  }, 2000);
const profile = path.join(testRoot, 'telemetry-profile');
await mkdir(profile);
const fixture = path.join(testRoot, 'telemetry-entry.cjs');
await writeFile(
  fixture,
  `
const path = require('node:path');
const {app} = require('electron');
const root = ${JSON.stringify(workspace.platformRoot)};
app.getVersion = () => require(path.join(root, 'package.json')).version;
globalThis.telemetryTime = 0;
globalThis.telemetryPosts = [];
const ttl = 30*86400000;
const grant = (installationId, userId) => {
 const issuedAt = Date.UTC(2026,9,29) + globalThis.telemetryTime, eventUntil=issuedAt+ttl, deliverUntil=eventUntil+ttl;
 const part = v => Buffer.from(JSON.stringify(v)).toString('base64url');
 return {schemaVersion:2,issuedAt,eventUntil,deliverUntil,identityProof:part({alg:'HS256',typ:'voxcue-telemetry+jwt'})+'.'+part({iss:'voxcue-account-server',aud:'voxcue:telemetry-attribution:v2',sub:userId,installationId,iat:issuedAt/1000,nbf:issuedAt/1000-300,exp:deliverUntil/1000,eventUntil})+'.'+'a'.repeat(43)};
};
const modulePath = path.join(root, 'dist-electron/shared/electron/backend/telemetry/service.js');
const original = require(modulePath).Telemetry;
require(modulePath).Telemetry = class extends original {
 constructor(options) {
  super({...options, origin:'https://synthetic.invalid', enabled:true, now:()=>Date.UTC(2026,9,29)+globalThis.telemetryTime,
   monotonic:()=>globalThis.telemetryTime,
   identityProvider:async (installationId,userId)=>grant(installationId,userId),
   fetcher:async (url, init)=>{
    if(url.endsWith('/capabilities'))return Response.json({schemaVersion:2,serverTime:Date.UTC(2026,9,29)+globalThis.telemetryTime,versions:[2],anonymous:true,accountAttribution:'event-time-ticket',receipt:'per-event-terminal-rejections',limits:{batchEvents:50,bodyBytes:131072,pendingEvents:2000,eventProofTtlMs:ttl,deliveryTtlMs:ttl}});
    globalThis.telemetryPosts.push({url, body:JSON.parse(init.body)}); return new Response('',{status:503,headers:{'retry-after':'86400'}}); }});
  globalThis.clientTelemetry = this;
 }
};
require(path.join(root, 'dist-electron/shared/electron/main.js'));
`,
);
const entry = await offlineElectronEntry(fixture);
const launch = () =>
  electron.launch({
    args: [entry],
    env: {
      ...process.env,
      COPILOT_TEST_USER_DATA: profile,
      VITE_DEV_SERVER_URL: '',
      ELECTRON_RUN_AS_NODE: undefined,
    },
  });
let app;
const errors = [];
const snapshot = async () => {
  await app.evaluate(() => globalThis.clientTelemetry.settle());
  return JSON.parse(await readFile(path.join(profile, 'telemetry-queue.json'), 'utf8'));
};
try {
  app = await launch();
  await installUiAccount(app, { speech: true, components: true });
  const login = await app.firstWindow();
  await login.getByRole('heading', { name: '登录 VoxCue', exact: true }).waitFor();
  await assert.rejects(
    () => login.evaluate(() => window.desktop.telemetrySignal({ type: 'ready', text: 'private' })),
    /Invalid telemetry/,
  );
  const opened = app.waitForEvent('window');
  await login.getByRole('button', { name: '跳过登录', exact: true }).click();
  let main = await opened;
  main.on('pageerror', (e) => errors.push(e.message));
  await main.getByRole('textbox', { name: '聊天消息', exact: true }).waitFor();
  await assert.rejects(
    () =>
      main.evaluate(() => window.desktop.telemetrySignal({ type: 'interview_saved', saved: true })),
    /Unauthorized/,
  );
  await main.getByRole('button', { name: '面试记录', exact: true }).click();
  await main.getByRole('button', { name: '新对话', exact: true }).click();
  await main.evaluate(() => window.desktop.signInWithChatGPT());
  await main.reload();
  await main.getByRole('textbox', { name: '聊天消息', exact: true }).waitFor();
  await main
    .locator('input[type=file]')
    .first()
    .setInputFiles({
      name: 'private-synthetic-name.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('Private synthetic file content'),
    });
  await main
    .getByRole('textbox', { name: '聊天消息', exact: true })
    .fill('Private synthetic user message');
  await main.getByRole('button', { name: '发送消息', exact: true }).click();
  await main.getByText('Synthetic interview answer', { exact: true }).waitFor();
  const before = await snapshot();
  assert.equal(before.events.filter((e) => e.data.type === 'app_ready').length, 1);
  assert.ok(
    before.events.some(
      (e) =>
        e.accountMode === 'local' && e.data.type === 'feature' && e.data.feature === 'chat_send',
    ),
  );
  assert.ok(
    before.events.some((e) => e.data.type === 'feature' && e.data.feature === 'file_import'),
  );
  assert.ok(
    before.events.some(
      (e) =>
        e.data.type === 'ai_request' && e.data.context === 'chat' && e.data.outcome === 'success',
    ),
  );
  await main.locator('.interview-start-trigger').click();
  const start = main.getByRole('dialog', { name: '开始面试', exact: true });
  const interviewOpened = app.waitForEvent('window');
  await start.getByRole('button', { name: '确认开始', exact: true }).click();
  const floating = await interviewOpened;
  floating.on('pageerror', (e) => errors.push(e.message));
  await floating.getByRole('textbox', { name: '面试提问', exact: true }).waitFor();
  await floating.waitForFunction(() => !!document.querySelector('[aria-label="发送面试问题"]'));
  await floating
    .getByRole('textbox', { name: '面试提问', exact: true })
    .fill('Private synthetic interview question');
  await floating.getByRole('button', { name: '发送面试问题', exact: true }).click();
  await floating.getByText('Synthetic interview answer', { exact: true }).first().waitFor();
  await app.evaluate(() => {
    globalThis.telemetryTime += 125000;
  });
  await floating.getByRole('button', { name: '结束面试', exact: true }).click();
  const closed = floating.waitForEvent('close');
  await floating.getByRole('button', { name: '确认结束面试', exact: true }).click();
  await closed;
  const interview = (await snapshot()).events.filter((e) => e.data.type === 'interview_ended');
  assert.equal(interview.length, 1);
  assert.equal(interview[0].accountMode, 'local');
  assert.equal(interview[0].data.outcome, 'completed');
  assert.equal(interview[0].data.effective, true);
  assert.equal(interview[0].data.activeMs, 125000);
  assert.ok(interview[0].data.manualQuestionCount >= 1);
  assert.ok(interview[0].data.answerCount >= 1);
  const returned = app.waitForEvent('window');
  await main.evaluate(() => window.desktop.setLocalMode(false));
  const originalLogin = await returned;
  main = await enterPrimaryUiAccount(app, originalLogin);
  await main.getByRole('textbox', { name: '聊天消息', exact: true }).waitFor();
  await main.getByRole('button', { name: '面试记录', exact: true }).click();
  const mixed = await snapshot();
  const localEvent = mixed.events.find(
    (e) => e.accountMode === 'local' && e.data.type === 'feature',
  );
  const accountEvent = mixed.events.find(
    (e) => e.accountMode === 'account' && e.data.type === 'feature',
  );
  assert.ok(localEvent && accountEvent);
  assert.equal(localEvent.installationId, accountEvent.installationId);
  assert.equal(localEvent.userId, undefined);
  assert.equal(typeof accountEvent.identityRef, 'string');
  assert.equal(accountEvent.userId, undefined);
  const encrypted = await readFile(path.join(profile, 'cloud-account', 'telemetry.bin'));
  assert.equal(encrypted.includes(Buffer.from('identityProof')), false);
  assert.equal(encrypted.includes(Buffer.from('voxcue-account-server')), false);
  assert.ok(mixed.events.some((e) => e.data.type === 'account_entry' && e.data.method === 'login'));
  const serialized = JSON.stringify(mixed);
  assert.doesNotMatch(
    serialized,
    /Private synthetic|private-synthetic-name|synthetic@example|Synthetic interview answer|Synthetic interviewer question/,
  );
  assert.equal((await app.evaluate(() => globalThis.telemetryPosts)).length, 1);
  assert.equal(mixed.failures, 1);
  assert.ok(mixed.events.length > 0);
  await closeUiApp(app);
  app = await launch();
  const restored = await waitForRestoredMainWindow(app);
  await restored.getByRole('textbox', { name: '聊天消息', exact: true }).waitFor();
  const restarted = await snapshot();
  assert.equal(restarted.events.filter((e) => e.data.type === 'app_ready').length, 2);
  assert.ok(
    restarted.events.some((e) => e.data.type === 'account_entry' && e.data.method === 'restore'),
  );
  assert.equal(new Set(restarted.events.map((e) => e.installationId)).size, 1);
  assert.equal((await app.evaluate(() => globalThis.telemetryPosts)).length, 0);
  assert.deepEqual(errors, []);
  console.log(
    'PASS client telemetry: real local/login IPC, chat/import activity, synthetic interview completion, no content leakage, stable installation, restore and encrypted v2 attribution and persistent transport backoff',
  );
} finally {
  if (app) await closeUiApp(app);
  if (guard) clearInterval(guard);
  releaseDesktop?.();
}
