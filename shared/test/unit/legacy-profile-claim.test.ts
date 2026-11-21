import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import {
  hasChromiumAppStorage,
  LegacyProfileClaim,
  legacyProfileAssignmentFile,
} from '../../electron/backend/legacyProfileClaim';
import { profileDirectoryName } from '../../electron/accountProfilePaths';

const roots: string[] = [];
async function directory() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'voxcue-legacy-claim-'));
  roots.push(root);
  return root;
}
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
const ports = () => ({
  browserPresent: true,
  filesPresent: vi.fn(async () => true),
  migrateFiles: vi.fn(async (_: string, __: AbortSignal) => {}),
  migrateBrowser: vi.fn(async (_: string, __: AbortSignal) => {}),
});

it('persists the first claimant before native work, isolates overlapping logins, and retries unfinished stages only', async () => {
  const root = await directory(),
    a = 'account:' + randomUUID(),
    b = 'account:' + randomUUID();
  const transfer = ports();
  transfer.migrateFiles.mockImplementationOnce(async () => {
    const marker = JSON.parse(await readFile(path.join(root, legacyProfileAssignmentFile), 'utf8'));
    expect(marker.owner).toBe(profileDirectoryName(a));
    expect(marker.files).toBe(true);
  });
  transfer.migrateBrowser.mockRejectedValueOnce(Error('simulated interruption'));
  const claim = new LegacyProfileClaim(root, transfer);
  const first = claim.prepare(a);
  expect(claim.prepare(a)).toBe(first);
  const other = claim.prepare(b);
  await expect(first).rejects.toThrow('原件已保留');
  await other;
  const restart = new LegacyProfileClaim(root, transfer);
  expect(await restart.owns(a)).toBe(true);
  expect(await restart.owns(b)).toBe(false);
  expect(await restart.owns('local')).toBe(false);
  await restart.prepare(b);
  await restart.prepare(a);
  await restart.prepare(a);
  expect(await restart.owns(a)).toBe(true);
  expect(transfer.migrateFiles.mock.calls.map(([owner]) => owner)).toEqual([a]);
  expect(transfer.migrateBrowser.mock.calls.map(([owner]) => owner)).toEqual([a, a]);
});

it('skips transfer windows on a fresh installation and never uses the isolated test demo as claimant', async () => {
  const root = await directory();
  const transfer = { ...ports(), browserPresent: false, filesPresent: vi.fn(async () => false) };
  const claim = new LegacyProfileClaim(root, transfer);
  await expect(claim.prepare('demo')).rejects.toThrow();
  await claim.prepare('local');
  await new LegacyProfileClaim(root, { ...transfer, browserPresent: true }).prepare('local');
  expect(transfer.migrateBrowser).not.toHaveBeenCalled();
  expect(transfer.migrateFiles).not.toHaveBeenCalled();
});

it('detects persisted browser data before Chromium initializes, excluding empty LevelDB scaffolding', async () => {
  const root = await directory();
  const level = path.join(root, 'Local Storage', 'leveldb');
  await mkdir(level, { recursive: true });
  await writeFile(path.join(level, 'CURRENT'), 'MANIFEST-000001');
  await writeFile(path.join(level, '000003.log'), '');
  expect(hasChromiumAppStorage(root)).toBe(false);
  await writeFile(path.join(level, '000003.log'), 'synthetic');
  expect(hasChromiumAppStorage(root)).toBe(true);
  const second = await directory();
  await mkdir(path.join(second, 'IndexedDB', 'file__0.indexeddb.leveldb'), { recursive: true });
  expect(hasChromiumAppStorage(second)).toBe(true);
});
