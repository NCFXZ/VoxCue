import { open, readFile, rename, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

/** Publish only fully written data; callers serialize writes to the same destination. */
export async function atomicFile(file: string, value: string | Buffer) {
  const temporary = file + '.' + randomUUID() + '.tmp';
  try {
    const handle = await open(temporary, 'wx', 0o600);
    try {
      await handle.writeFile(value);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, file);
    if (process.platform !== 'win32') {
      const directory = await open(path.dirname(file), 'r');
      try {
        await directory.sync();
      } finally {
        await directory.close();
      }
    }
  } finally {
    await rm(temporary, { force: true });
  }
}

/** Keep the encrypted original before an explicit recovery replaces unreadable data. */
export async function preserveEncryptedFile(file: string) {
  const bytes = await readFile(file).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  });
  if (bytes) await atomicFile(file + '.' + randomUUID() + '.recovery', bytes);
}
