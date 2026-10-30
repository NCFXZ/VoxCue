import assert from 'node:assert/strict';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, readdir, chmod } from 'node:fs/promises';
import workspace from '../../../shared/scripts/workspace.mjs';
import { testRoot } from '../../../shared/test/scripts/test-workspace.mjs';
import { requireUnlockedDesktop } from './desktop-session.mjs';

assert.equal(process.platform, 'darwin');
requireUnlockedDesktop();
const { TelemetryQueue } = workspace.platformRequire(
  path.join(workspace.platformRoot, 'dist-electron/shared/electron/backend/telemetry/queue.js'),
);
const root = path.join(testRoot, 'queue');
await mkdir(root);
const file = path.join(root, 'telemetry-queue.json'),
  queue = new TelemetryQueue(file);
const at = Date.now(),
  installationId = randomUUID(),
  runId = randomUUID();
const event = () => ({
  schemaVersion: 2,
  id: randomUUID(),
  installationId,
  runId,
  firstSeenAt: at,
  occurredAt: at,
  version: workspace.platformRequire('./package.json').version,
  platform: 'macos',
  accountMode: 'local',
  data: { type: 'feature', feature: 'history_view' },
});
queue.add(event());
await queue.save();
const original = await readFile(file),
  held = await open(file, 'r');
try {
  assert.equal((await held.stat()).mode & 0o777, 0o600);
  queue.add(event());
  await queue.save();
  assert.deepEqual(
    await held.readFile(),
    original,
    'An open POSIX reader retains the old complete inode',
  );
  assert.equal(JSON.parse(await readFile(file, 'utf8')).events.length, 2);
} finally {
  await held.close();
}
const beforeFailure = await readFile(file);
await chmod(root, 0o500);
try {
  queue.add(event());
  await assert.rejects(queue.save(), (error) => ['EACCES', 'EPERM'].includes(error.code));
  assert.deepEqual(
    await readFile(file),
    beforeFailure,
    'A real filesystem denial preserves committed bytes',
  );
} finally {
  await chmod(root, 0o700);
}
const pending = [queue.save()];
for (let index = 0; index < 100; index++) {
  queue.add(event());
  pending.push(queue.save());
}
assert.equal(new Set(pending).size, 1, 'Concurrent callers share one writer');
await Promise.all(pending);
const saved = JSON.parse(await readFile(file, 'utf8'));
assert.equal(saved.events.length, 103);
assert.equal(new Set(saved.events.map((event) => event.id)).size, 103);
assert.equal((await readdir(root)).filter((name) => name.endsWith('.tmp')).length, 0);
console.log(
  'PASS Mac POSIX atomic replacement with open reader, real write denial preserves bytes, 101 merged saves, retry and temporary-file cleanup',
);
