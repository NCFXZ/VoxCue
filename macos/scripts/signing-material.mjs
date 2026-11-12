import { constants } from 'node:fs';
import { lstat, realpath, open } from 'node:fs/promises';
import path from 'node:path';

function check(info, file, directory) {
  if (
    info.isSymbolicLink() ||
    (directory ? !info.isDirectory() : !info.isFile()) ||
    info.uid !== process.getuid() ||
    (info.mode & 0o777) !== (directory ? 0o700 : 0o600) ||
    (!directory && info.nlink !== 1)
  )
    throw Error('Signing material must be owned, unredirected and private: ' + file);
}
export async function privatePath(file, directory = false) {
  check(await lstat(file), file, directory);
  if ((await realpath(file)) !== path.resolve(file))
    throw Error('Redirected signing material: ' + file);
}
export async function readPrivateFile(file, encoding = 'utf8') {
  await privatePath(path.dirname(file), true);
  await privatePath(file);
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    check(await handle.stat(), file, false);
    return await handle.readFile(encoding ? { encoding } : undefined);
  } finally {
    await handle.close();
  }
}
