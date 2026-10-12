import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { emptyUsage, type AppUsage, type TokenUsage } from '../../contracts/chat';
export class UsageLedger {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private directory: string) {}
  private file(account: string) {
    return path.join(this.directory, `${createHash('sha256').update(account).digest('hex')}.json`);
  }
  private async read(account: string): Promise<{ usage: AppUsage; ids: string[] }> {
    try {
      const record = JSON.parse(await readFile(this.file(account), 'utf8'));
      if (
        !record ||
        !Array.isArray(record.ids) ||
        !record.usage ||
        !['inputTokens', 'outputTokens', 'totalTokens', 'requests'].every(
          (key) => Number.isSafeInteger(record.usage[key]) && record.usage[key] >= 0,
        )
      )
        throw new Error('本应用用量记录损坏，请检查应用数据。');
      return record;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        return { usage: emptyUsage(), ids: [] };
      throw error;
    }
  }
  async get(account: string) {
    await this.queue;
    return (await this.read(account)).usage;
  }
  add(account: string, id: string, tokens: TokenUsage) {
    const operation = this.queue.then(async () => {
      const record = await this.read(account);
      if (record.ids.includes(id)) return;
      const usage: AppUsage = {
        inputTokens: record.usage.inputTokens + tokens.inputTokens,
        outputTokens: record.usage.outputTokens + tokens.outputTokens,
        totalTokens: record.usage.totalTokens + tokens.totalTokens,
        requests: record.usage.requests + 1,
        updatedAt: Date.now(),
      };
      await mkdir(this.directory, { recursive: true });
      const file = this.file(account),
        temporary = `${file}.${randomUUID()}.tmp`;
      await writeFile(temporary, JSON.stringify({ usage, ids: [...record.ids, id].slice(-1000) }));
      await rename(temporary, file);
    });
    this.queue = operation.catch(() => {});
    return operation;
  }
}
