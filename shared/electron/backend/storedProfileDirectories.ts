import { lstat, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';

export async function* storedProfileDirectories(userData: string) {
  const root = path.join(await realpath(userData), 'account-profiles');
  const base = await lstat(root).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error;
  });
  if (!base) return;
  if (!base.isDirectory() || (await realpath(root)) !== root) throw Error('账号资料目录无效。');
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!/^[0-9a-f]{64}$/.test(entry.name)) continue;
    const directory = path.join(root, entry.name);
    if (!entry.isDirectory() || (await realpath(directory)) !== directory) throw Error('账号资料目录无效。');
    yield directory;
  }
}
