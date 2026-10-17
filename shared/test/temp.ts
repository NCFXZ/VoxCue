import { afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { lstatSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const directories = new Set<string>();
const temporary = realpathSync(tmpdir());
const marker = '.voxcue-unit-owner.json';
for (const name of readdirSync(temporary)) {
  if (!name.startsWith('voxcue-unit-')) continue;
  const directory = path.join(temporary, name);
  try {
    if (lstatSync(directory).isSymbolicLink()) continue;
    const owner = JSON.parse(readFileSync(path.join(directory, marker), 'utf8'));
    if (owner.kind !== 'voxcue-unit-' || !Number.isSafeInteger(owner.pid) || owner.pid <= 0)
      continue;
    try {
      process.kill(owner.pid, 0);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ESRCH')
        rmSync(directory, { recursive: true, force: true });
    }
  } catch {
    /* Unknown/live directories are protected. */
  }
}
export async function temporaryDirectory(label: string) {
  if (!/^[a-z-]+$/.test(label)) throw Error('Invalid temporary test label');
  const directory = await mkdtemp(path.join(temporary, `voxcue-unit-${label}-`));
  writeFileSync(
    path.join(directory, marker),
    JSON.stringify({ kind: 'voxcue-unit-', pid: process.pid }),
  );
  directories.add(directory);
  return directory;
}
afterEach(async () => {
  for (const directory of directories) {
    await rm(directory, { recursive: true, force: true });
    directories.delete(directory);
  }
});
process.once('exit', () => {
  for (const directory of directories) rmSync(directory, { recursive: true, force: true });
});
