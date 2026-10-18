import { mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

export function readAutoDownload(file: string): boolean {
  try {
    if (statSync(file).size > 1024) return false;
    const value = JSON.parse(readFileSync(file, 'utf8'));
    return value?.schemaVersion === 1 && value.autoDownload === true;
  } catch (error) {
    // Preserve the existing default for new installations; unreadable settings
    // must never override an earlier opt-out by enabling downloads.
    return (error as NodeJS.ErrnoException).code === 'ENOENT';
  }
}

export function saveAutoDownload(file: string, enabled: boolean) {
  mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, JSON.stringify({ schemaVersion: 1, autoDownload: enabled }), {
      mode: 0o600,
      flag: 'wx',
    });
    renameSync(temporary, file);
  } finally {
    try {
      unlinkSync(temporary);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
}
