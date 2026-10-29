import { readFile, writeFile, rename, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

// A local preference only; it never creates a cloud identity or grants cloud access.
export class LocalMode {
  active = false;
  private saving = false;
  constructor(private file: string) {}
  async load() {
    try {
      const value: unknown = JSON.parse(await readFile(this.file, 'utf8'));
      if (typeof value !== 'boolean') throw Error('本地账户设置无效，请重新选择。');
      this.active = value;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  async set(enabled: boolean) {
    if (typeof enabled !== 'boolean') throw Error('Invalid local mode');
    if (this.saving) throw Error('使用模式正在切换，请稍候。');
    this.saving = true;
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify(enabled), { mode: 0o600 });
      await rename(temporary, this.file);
      this.active = enabled;
    } finally {
      this.saving = false;
      await rm(temporary, { force: true });
    }
  }
}
