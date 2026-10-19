import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';

export async function generatedFiles(directory) {
  const root = await fs.lstat(directory).catch((error) => {
    if (error.code !== 'ENOENT') throw error;
  });
  if (!root) return [];
  if (!root.isDirectory() || root.isSymbolicLink()) throw Error(`Invalid output: ${directory}`);
  const files = [];
  async function visit(folder) {
    for (const entry of await fs.readdir(folder, { withFileTypes: true })) {
      const file = path.join(folder, entry.name);
      if (entry.isSymbolicLink()) throw Error(`Refusing redirected build path: ${file}`);
      if (entry.isDirectory()) await visit(file);
      else if (
        entry.isFile() &&
        (/\.(?:js|map|json)$/.test(entry.name) || entry.name === '.DS_Store')
      )
        files.push(path.relative(directory, file));
      else throw Error(`Unexpected non-generated build entry: ${file}`);
    }
  }
  await visit(directory);
  return files.sort();
}

// Preserve directory identity. Moving the entire output tree away and creating
// the same path again can leave numbered empty replicas on managed Mac folders.
// Compile and validate before entering here; keep a rollback copy outside the repo.
export async function replaceGeneratedOutput(stage, output, backup, copy = fs.copyFile) {
  const incoming = await generatedFiles(stage);
  if (!incoming.length) throw Error('Empty Electron build');
  const original = await generatedFiles(output);
  const originals = new Set(original);
  const next = new Set(incoming);
  for (const relative of original) {
    const target = path.join(backup, relative);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(path.join(output, relative), target);
  }
  await fs.mkdir(output, { recursive: true });
  try {
    for (const relative of incoming) {
      const target = path.join(output, relative);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await copy(path.join(stage, relative), target);
    }
    for (const relative of original)
      if (!next.has(relative) && path.basename(relative) !== '.DS_Store')
        await fs.unlink(path.join(output, relative));
  } catch (error) {
    try {
      for (const relative of incoming)
        if (!originals.has(relative))
          await fs.unlink(path.join(output, relative)).catch((failure) => {
            if (failure.code !== 'ENOENT') throw failure;
          });
      for (const relative of original)
        await fs.copyFile(path.join(backup, relative), path.join(output, relative));
    } catch (rollback) {
      throw Object.assign(
        new AggregateError([error, rollback], `Build rollback failed; preserved ${backup}`),
        { preserveBackup: true },
      );
    }
    throw error;
  }
}

export async function lockOutput(output) {
  const key = createHash('sha256').update(path.resolve(output)).digest('hex').slice(0, 24);
  const lock = path.join(await fs.realpath(os.tmpdir()), 'voxcue-electron-lock-' + key);
  const owner = path.join(lock, 'owner.json');
  for (let attempt = 0; ; attempt++) {
    try {
      await fs.mkdir(lock, { mode: 0o700 });
      break;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const info = await fs.lstat(lock);
      if (!info.isDirectory() || info.isSymbolicLink()) throw Error(`Invalid build lock: ${lock}`);
      const ownerInfo = await fs.lstat(owner).catch((failure) => {
        if (failure.code !== 'ENOENT') throw failure;
      });
      if (ownerInfo && (!ownerInfo.isFile() || ownerInfo.isSymbolicLink() || ownerInfo.size > 512))
        throw Error(`Invalid build lock owner: ${owner}`);
      const saved = JSON.parse(ownerInfo ? await fs.readFile(owner, 'utf8') : '{}');
      let abandoned = false;
      if (
        saved.kind === 'voxcue-electron-build' &&
        saved.output === output &&
        Number.isSafeInteger(saved.pid) &&
        saved.pid > 0
      ) {
        try {
          process.kill(saved.pid, 0);
        } catch (failure) {
          abandoned = failure.code === 'ESRCH';
        }
      }
      if (!abandoned || attempt)
        throw Error('Another Electron build owns this output; wait for it to finish.');
      // One recovery owner at a time. Never recursively delete an unknown lock.
      const recovery = path.join(lock, 'recovering');
      await fs.mkdir(recovery);
      try {
        await fs.unlink(owner);
      } finally {
        await fs.rmdir(recovery);
      }
      await fs.rmdir(lock);
    }
  }
  try {
    await fs.writeFile(
      owner,
      JSON.stringify({ kind: 'voxcue-electron-build', output, pid: process.pid }),
    );
  } catch (error) {
    await fs.rm(owner, { force: true });
    await fs.rmdir(lock);
    throw error;
  }
  return async () => {
    await fs.unlink(owner);
    await fs.rmdir(lock);
  };
}
