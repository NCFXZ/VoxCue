import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { emptyUsage, type AppUsage, type TokenUsage } from '../../contracts/chat';
type ResponseId = string | { sha256: string };

function boundedId(id: ResponseId): ResponseId {
  return typeof id === 'string' && id.length > 200
    ? { sha256: createHash('sha256').update(id, 'utf16le').digest('hex') }
    : id;
}

export class UsageLedger {
  private queue: Promise<unknown> = Promise.resolve();
  private closed = false;
  constructor(private directory: string) {}
  private file(account: string) {
    return path.join(this.directory, `${createHash('sha256').update(account).digest('hex')}.json`);
  }
  private async read(account: string): Promise<{ usage: AppUsage; ids: ResponseId[] }> {
    try {
      const record = JSON.parse(await readFile(this.file(account), 'utf8'));
      if (
        !record ||
        !Array.isArray(record.ids) ||
        !record.ids.every((id: unknown) => typeof id === 'string' ||
          (id !== null && typeof id === 'object' && 'sha256' in id &&
            typeof id.sha256 === 'string' && /^[a-f0-9]{64}$/.test(id.sha256))) ||
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
  private async write(account: string, usage: AppUsage, ids: ResponseId[]) {
    await mkdir(this.directory, { recursive: true });
    const file = this.file(account);
    const temporary = file + '.' + randomUUID() + '.tmp';
    await writeFile(temporary, JSON.stringify({ usage, ids: ids.slice(-1000).map(boundedId) }));
    await rename(temporary, file);
  }
  async get(account: string) {
    if (this.closed) throw Error('Usage ledger is closed');
    await this.queue;
    return (await this.read(account)).usage;
  }
  async dispose() {
    this.closed = true;
    await this.queue;
  }
  reset(account: string) {
    if (this.closed) return Promise.reject(Error('Usage ledger is closed'));
    const operation = this.queue.then(async () => {
      const record = await this.read(account);
      const usage = emptyUsage();
      // Keep response IDs so late duplicates cannot restore pre-reset totals.
      await this.write(account, usage, record.ids);
      return usage;
    });
    this.queue = operation.catch(() => {});
    return operation;
  }
  add(account: string, id: string, tokens: TokenUsage) {
    if (this.closed) return Promise.reject(Error('Usage ledger is closed'));
    const operation = this.queue.then(async () => {
      const record = await this.read(account);
      const key = boundedId(id);
      if (record.ids.some(stored => typeof stored === 'string' ? stored === id
        : typeof key !== 'string' && stored.sha256 === key.sha256)) {
        if (record.ids.some(stored => typeof stored === 'string' && stored.length > 200))
          await this.write(account, record.usage, record.ids);
        return;
      }
      const usage: AppUsage = {
        inputTokens: record.usage.inputTokens + tokens.inputTokens,
        outputTokens: record.usage.outputTokens + tokens.outputTokens,
        totalTokens: record.usage.totalTokens + tokens.totalTokens,
        requests: record.usage.requests + 1,
        updatedAt: Date.now(),
      };
      await this.write(account, usage, [...record.ids, key]);
    });
    this.queue = operation.catch(() => {});
    return operation;
  }
}
