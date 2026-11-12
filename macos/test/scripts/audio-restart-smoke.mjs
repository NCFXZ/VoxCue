import { testRoot } from '../../../shared/test/scripts/test-workspace.mjs';
import workspace from '../../../shared/scripts/workspace.mjs';
import { holdDesktopAwake, requireUnlockedDesktop } from './desktop-session.mjs';
import { mkdir, writeFile, readFile, chmod } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import assert from 'node:assert/strict';

// Consume current production controller/capture sources with an explicit owned
// synthetic Worker and child. No recognition model, Electron product or device
// is opened; all process/Worker retirement is real.
const releaseAwake = holdDesktopAwake();
const root = path.join(testRoot, 'restart-fixture');
const repository = path.dirname(workspace.sharedRoot);
const ts = workspace.platformRequire('typescript');
for (const file of [
  'macos/electron/speech/controller.ts',
  'macos/electron/speech/capture.ts',
  'shared/electron/backend/speech/controller.ts',
  'shared/electron/backend/speech/buffer.ts',
  'shared/electron/backend/cancellable.ts',
  'shared/electron/contracts/speechSettings.ts',
  'shared/electron/contracts/components.ts',
]) {
  const target = path.join(root, file.replace(/\.ts$/, '.js'));
  await mkdir(path.dirname(target), { recursive: true });
  const source = await readFile(path.join(repository, file), 'utf8');
  await writeFile(
    target,
    ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
    }).outputText,
  );
}
await writeFile(
  path.join(root, 'shared/electron/backend/speech/worker.js'),
  `
const {parentPort}=require('node:worker_threads');
parentPort.on('message', m=>{
 if(m.op==='init')parentPort.postMessage({ready:true});
 if(m.op==='prepare')parentPort.postMessage({prepared:m.id});
 if(m.op==='audio')parentPort.postMessage({ack:m.sequence});
 if(m.op==='flush')parentPort.postMessage({flushed:m.id});
 if(m.op==='close')parentPort.postMessage({closed:m.id});
});
`,
);
const marker = path.join(testRoot, 'restart-once-marker');
const helper = path.join(testRoot, 'restart-audio.cjs');
await writeFile(
  helper,
  `#!${process.execPath}
const fs=require('node:fs');
if(process.argv[2]==='devices'){
 console.log(JSON.stringify(['once','every','permission'].map(id=>({id,name:'Synthetic',source:'system',default:id==='once'}))));
 process.exit(0);
}
const mode=Buffer.from(process.argv[3]||'','base64').toString();
const first=mode==='once'&&!fs.existsSync(${JSON.stringify(marker)});
if(first)fs.writeFileSync(${JSON.stringify(marker)},'owned',{flag:'wx',mode:0o600});
let sequence=0;
const packet=()=>{
 const b=Buffer.alloc(4+17+160*4);b.writeUInt32LE(b.length-4);b[4]=1;b.writeUInt32LE(16000,5);b.writeDoubleLE(sequence++*10,9);b.writeUInt32LE(0,17);
 process.stdout.write(b);
};
process.stderr.write('{"type":"started"}\\n');
const timer=setInterval(packet,10);
let failure;
if(first||mode==='every')failure=setTimeout(()=>process.exit(1),120);
if(mode==='permission')failure=setTimeout(()=>{
 process.stderr.write('{"type":"error","code":"permission-denied"}\\n');
 clearInterval(timer);
},120);
process.stdin.resume();process.stdin.on('end',()=>{clearInterval(timer);clearTimeout(failure);});
`,
);
await chmod(helper, 0o700);
const require = createRequire(path.join(root, 'owned.cjs'));
const { SpeechController } = require('./macos/electron/speech/controller.js');
const controllers = [];
const workerReferences = [];
const captureReferences = [];
const childPids = new Set();
const waitFor = async (condition, message, timeout = 8000) => {
  const deadline = performance.now() + timeout;
  while (!condition()) {
    if (performance.now() >= deadline) throw Error(message);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};
const remember = (controller) => {
  if (controller.worker && !workerReferences.includes(controller.worker))
    workerReferences.push(controller.worker);
  for (const capture of controller.captures.values()) {
    if (!captureReferences.includes(capture)) captureReferences.push(capture);
    if (capture.child?.pid) childPids.add(capture.child.pid);
  }
};
function fixture() {
  const events = [];
  const controller = new SpeechController('owned-synthetic-model', helper, (event) =>
    events.push(event),
  );
  controllers.push(controller);
  return { controller, events };
}
try {
  requireUnlockedDesktop();
  const f = fixture();
  assert.equal(
    (await f.controller.call({ op: 'start', options: { sources: ['system'], system: 'once' } }))
      .state,
    'running',
  );
  remember(f.controller);
  const firstWorker = f.controller.worker;
  const firstPid = [...childPids][0];
  await waitFor(
    () => f.events.some((event) => event.status?.error === '音频已中断，正在自动重新连接…'),
    'No visible automatic recovery',
  );
  assert.equal(firstWorker.threadId, -1, 'Original Worker must actually exit before backoff');
  assert.throws(() => process.kill(firstPid, 0), { code: 'ESRCH' });
  await waitFor(
    () => f.controller.status.state === 'running',
    'Automatic replacement did not start',
  );
  remember(f.controller);
  assert.notEqual(f.controller.worker, firstWorker);
  assert.equal(f.events.filter((event) => event.status?.state === 'running').length, 2);
  assert.ok(
    f.events.some((event) => event.type === 'gap'),
    'Automatic recovery clears incomplete question continuity',
  );
  await f.controller.close();

  requireUnlockedDesktop();
  const cancelled = fixture();
  await cancelled.controller.call({
    op: 'start',
    options: { sources: ['system'], system: 'every' },
  });
  remember(cancelled.controller);
  await waitFor(
    () => cancelled.controller.restartTimer !== undefined,
    'No pending restart to cancel',
  );
  await cancelled.controller.call({ op: 'pause' });
  await new Promise((resolve) => setTimeout(resolve, 1200));
  assert.equal(cancelled.controller.status.state, 'paused');
  assert.equal(cancelled.events.filter((event) => event.status?.state === 'running').length, 1);
  await cancelled.controller.close();

  requireUnlockedDesktop();
  const denied = fixture();
  await denied.controller.call({
    op: 'start',
    options: { sources: ['system'], system: 'permission' },
  });
  remember(denied.controller);
  await waitFor(
    () => denied.controller.status.state === 'error' && denied.controller.captures.size === 0,
    'Permission failure did not retire capture',
  );
  await new Promise((resolve) => setTimeout(resolve, 1200));
  assert.equal(denied.events.filter((event) => event.status?.state === 'running').length, 1);
  assert.equal(denied.controller.restartTimer, undefined);
  await denied.controller.close();
  console.log(
    'PASS: actual Mac controller/capture + real Worker/owned child; unexpected exit recovers only after retirement, visible state/gap, manual pause cancels, permission error never retries. No hardware/model access.',
  );
} finally {
  try {
    const results = await Promise.allSettled(controllers.map((controller) => controller.close()));
    assert.ok(
      results.every((result) => result.status === 'fulfilled'),
      'All controllers must close',
    );
    for (const capture of captureReferences) assert.equal(capture.retiring, false);
    for (const worker of workerReferences)
      assert.equal(worker.threadId, -1, 'No active synthetic Worker');
    for (const pid of childPids) assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
  } finally {
    releaseAwake();
  }
}
