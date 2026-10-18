import { lstatSync, mkdirSync, readdirSync, readlinkSync, renameSync, rmdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function inspect(directory: string) {
  try {
    const info = lstatSync(directory);
    if (!info.isDirectory() || info.isSymbolicLink())
      throw Error('应用数据目录不是普通目录，原有内容已保留。请检查后重试。');
    return info;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

function requireClosed(directory: string) {
  const lock = path.join(directory, 'SingletonLock');
  let info;
  try {
    info = lstatSync(lock);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  if (info.isSymbolicLink()) {
    const owner = /^(.*)-(\d+)$/.exec(readlinkSync(lock));
    if (owner && owner[1].toLowerCase() === os.hostname().toLowerCase()) {
      const pid = Number(owner[2]);
      if (Number.isSafeInteger(pid) && pid > 0) {
        try {
          process.kill(pid, 0);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ESRCH') return;
        }
      }
    }
  }
  throw Error('旧版 VoxCue 仍在运行或数据目录被占用。请正常退出旧版后重新打开，原数据已保留。');
}

/** Run before Electron creates sessions. A same-parent rename keeps all bytes and permissions intact. */
export function migrateUserData(appData: string) {
  if (!path.isAbsolute(appData)) throw Error('应用数据根目录无效。');
  const legacy = path.join(appData, 'ai-interview-copilot');
  const destination = path.join(appData, 'VoxCue');
  const source = inspect(legacy);
  const target = inspect(destination);
  if (!source) {
    if (!target) mkdirSync(destination, { recursive: true, mode: 0o700 });
    return destination;
  }
  requireClosed(legacy);
  if (target && readdirSync(destination).length) {
    // An empty leftover has nothing to merge; never merge two Chromium profiles.
    if (!readdirSync(legacy).length) {
      rmdirSync(legacy);
      return destination;
    }
    throw Error(
      'VoxCue 与旧数据目录中都已有内容，已保留两处数据。请先处理目录冲突后重试，不能自动覆盖或合并。',
    );
  }
  try {
    if (target) rmdirSync(destination); // Only succeeds while the target is still empty.
    renameSync(legacy, destination);
  } catch {
    // Another first launch may have completed the same atomic rename.
    if (!inspect(legacy) && inspect(destination)) return destination;
    throw Error('无法迁移应用数据。请正常退出旧版，并检查目录权限后重试；原数据未删除。');
  }
  return destination;
}
