import { afterEach, expect, it } from 'vitest';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync,
  rmdirSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { prepareKnowledgeDatabase } from '../../electron/knowledgePath';

const owned: string[] = [];
const leases: NonNullable<ReturnType<typeof prepareKnowledgeDatabase>>[] = [];
function fixture() {
  const holder = mkdtempSync(path.join(tmpdir(), 'voxcue-knowledge-path-'));
  owned.push(holder);
  const target = path.join(holder, 'account-profiles', 'b'.repeat(64), 'knowledge-v1', 'lance');
  const prepare = () => {
    const lease = prepareKnowledgeDatabase(target)!;
    leases.push(lease);
    return lease;
  };
  return { holder, target, prepare };
}
afterEach(() => {
  for (const lease of leases.splice(0)) lease.release();
  for (const folder of owned.splice(0)) rmSync(folder, { recursive: true, force: true });
});

it('independent reader and writer links reopen the same existing physical account data', () => {
  const { target, prepare } = fixture();
  mkdirSync(target, { recursive: true });
  writeFileSync(path.join(target, 'existing'), 'previous version');
  const writer = prepare(), reader = prepare();
  expect(writer.path.length).toBeLessThan(target.length);
  expect(reader.path).not.toBe(writer.path);
  expect(realpathSync.native(writer.path)).toBe(realpathSync.native(target));
  writer.spawned(process.pid);
  writer.release();
  expect(existsSync(path.dirname(writer.path))).toBe(false);
  expect(readFileSync(path.join(reader.path, 'existing'), 'utf8')).toBe('previous version');
  reader.release();
  const reopened = prepare();
  expect(reopened.path).not.toBe(reader.path);
  expect(readFileSync(path.join(reopened.path, 'existing'), 'utf8')).toBe('previous version');
});

it('refuses an existing target junction and leaves a replaced temporary link untouched', () => {
  const { target, holder, prepare } = fixture();
  const foreign = path.join(holder, 'other');
  mkdirSync(foreign);
  writeFileSync(path.join(foreign, 'original'), 'retain');
  mkdirSync(path.dirname(target), { recursive: true });
  symlinkSync(foreign, target, 'junction');
  expect(prepare).toThrow();
  unlinkSync(target);
  const lease = prepare();
  const folder = path.dirname(lease.path);
  unlinkSync(lease.path);
  symlinkSync(foreign, lease.path, 'junction');
  try {
    lease.release();
    expect(lstatSync(lease.path).isSymbolicLink()).toBe(true);
    expect(readFileSync(path.join(foreign, 'original'), 'utf8')).toBe('retain');
  } finally {
    unlinkSync(lease.path);
    unlinkSync(path.join(folder, 'owner.json'));
    rmdirSync(folder);
  }
});
