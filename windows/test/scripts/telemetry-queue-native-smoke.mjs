import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile, readdir, copyFile } from 'node:fs/promises';
import { once } from 'node:events';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import workspace from '../../../shared/scripts/workspace.mjs';
import { testRoot, spawnTestProcess } from '../../../shared/test/scripts/test-workspace.mjs';
import { probe, probeExecutable, holdExclusiveFiles } from './window-probe.mjs';
assert.equal(probe('desktop').interactive, true);
const { TelemetryQueue } = workspace.platformRequire(
  path.join(
    workspace.platformRoot,
    'dist-electron/shared/electron/backend/telemetry/queue.js',
  ),
);
const file = path.join(testRoot, 'telemetry-queue.json'),
  queue = new TelemetryQueue(file),
  at = Date.now();
const installationId = randomUUID(),
  runId = randomUUID();
const event = () => ({
  schemaVersion: 2,
  id: randomUUID(),
  installationId,
  runId,
  firstSeenAt: at,
  occurredAt: at,
  version: '0.6.3',
  platform: 'windows',
  accountMode: 'local',
  data: { type: 'feature', feature: 'chat_send' },
});
queue.add(event());
await queue.save();
const original = await readFile(file);
const held = spawnTestProcess(probeExecutable, ['hold-file', file], {
  stdio: ['pipe', 'pipe', 'pipe'],
  windowsHide: true,
});
try {
  const [ready] = await once(held.stdout, 'data');
  assert.deepEqual(JSON.parse(ready), { holding: true });
  queue.add(event());
  await assert.rejects(
    queue.save(),
    (error) => ['EPERM', 'EACCES', 'EBUSY'].includes(error.code),
    'Actual Windows exclusive file handle must reject atomic replacement',
  );
} finally {
  const exited = once(held, 'exit');
  held.stdin.end('release\n');
  await exited;
}
assert.deepEqual(
  await readFile(file),
  original,
  'Failed replacement preserves the previous bytes',
);
const pending = [queue.save()];
for (let i = 0; i < 100; i++) {
  queue.add(event());
  pending.push(queue.save());
}
assert.equal(new Set(pending).size, 1, 'Concurrent writes merge into one writer');
await Promise.all(pending);
const saved = JSON.parse(await readFile(file, 'utf8'));
assert.equal(saved.events.length, 102);
assert.equal(new Set(saved.events.map((e) => e.id)).size, 102);
assert.equal((await readdir(testRoot)).filter((name) => name.endsWith('.tmp')).length, 0);
console.log(
  'PASS actual Windows exclusive handle blocks atomic replacement, previous bytes survive, 101 concurrent saves merge without lost events, retry commits and temporary files clear',
);

const isolatedExecutable=path.join(testRoot,'isolated-probe.exe');
await copyFile(probeExecutable,isolatedExecutable);
const executableBytes=await readFile(isolatedExecutable);
const releaseExecutable=await holdExclusiveFiles([isolatedExecutable]);
try {
  await assert.rejects(async()=>{const child=spawnTestProcess(isolatedExecutable,['desktop'],{stdio:'ignore',windowsHide:true});return new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});},error=>['EACCES','EBUSY','EPERM'].includes(error.code),'Exclusive guard must prevent native process creation before credentials could be read');
} finally {await releaseExecutable();}
const releaseBusy = await holdExclusiveFiles([isolatedExecutable]);
try {
  await assert.rejects(
    holdExclusiveFiles([isolatedExecutable]),
    /Exclusive guard cannot lock/,
    'A persistently busy executable must still block UI launch',
  );
  const waiting = holdExclusiveFiles([isolatedExecutable]);
  await new Promise((resolve) => setTimeout(resolve, 100));
  await releaseBusy();
  const releaseAcquired = await waiting;
  try {
    await assert.rejects(
      async () => {
        const child = spawnTestProcess(isolatedExecutable, ['desktop'], {
          stdio: 'ignore',
          windowsHide: true,
        });
        return new Promise((resolve, reject) => {
          child.once('error', reject);
          child.once('exit', resolve);
        });
      },
      (error) => ['EACCES', 'EBUSY', 'EPERM'].includes(error.code),
      'A lock acquired after waiting must still prevent process creation',
    );
  } finally {
    await releaseAcquired();
  }
} finally {
  await releaseBusy();
}
const unlocked=spawnSync(isolatedExecutable,['desktop'],{encoding:'utf8',windowsHide:true});
assert.equal(unlocked.status,0,unlocked.stderr);
assert.equal(JSON.parse(unlocked.stdout).ownerConsole,true);
assert.deepEqual(await readFile(isolatedExecutable),executableBytes);
console.log('PASS native PE creation is denied while the pre-launch exclusive guard is held, then works after release; executable bytes unchanged');
