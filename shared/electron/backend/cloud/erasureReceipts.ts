import { createHash, randomBytes } from 'node:crypto';
import { lstat, mkdir, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { isCloudProfileOwner } from '../../accountProfilePaths';
import { boundedJson } from '../boundedJson';

export interface ErasureReceipt {
  userId: string;
  origin: string;
  proof?: string;
  committed: boolean;
}

interface ReceiptVault {
  read(decrypt?: (value: Buffer) => Promise<string>): Promise<unknown>;
  write(value: ErasureReceipt): Promise<void>;
  clear(): Promise<void>;
}

const invalid = () => Error('本机账号删除记录无效，请检查资料后重试。');
const validId = (id: string) => isCloudProfileOwner('account:' + id);
export const receiptHash = (proof: string) => createHash('sha256').update(proof).digest('hex');

/** Each owner has a separate encrypted intent. A lookup proof cannot delete an account. */
export class AccountErasureReceipts {
  constructor(
    private root: string,
    private origin: string | undefined,
    private vault: (file: string) => ReceiptVault,
    private fetcher: typeof fetch = fetch,
  ) {}

  private async directory(create = false) {
    const dir = path.join(await realpath(this.root), 'account-erasure-intents');
    if (create) await mkdir(dir, { recursive: true, mode: 0o700 });
    try {
      if (await realpath(dir) !== dir || !(await lstat(dir)).isDirectory()) throw invalid();
    } catch (error) {
      if (!create && (error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
    return dir;
  }

  private async file(userId: string) {
    if (!validId(userId)) throw invalid();
    const file = path.join((await this.directory(true))!, userId + '.bin');
    const stat = await lstat(file).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
    });
    if (stat && (!stat.isFile() || stat.isSymbolicLink())) throw invalid();
    return this.vault(file);
  }

  private async read(userId: string, decrypt?: (value: Buffer) => Promise<string>) {
    const stored = await (await this.file(userId)).read(decrypt);
    if (stored === null) return;
    const row = stored as Partial<ErasureReceipt>;
    if (!row || row.userId !== userId || typeof row.origin !== 'string' ||
        typeof row.committed !== 'boolean' ||
        (row.proof !== undefined && (typeof row.proof !== 'string' || !/^[\w-]{43}$/.test(row.proof))))
      throw invalid();
    return row as ErasureReceipt;
  }

  async prepare(userId: string, supported: boolean) {
    if (!this.origin) throw invalid();
    const old = await this.read(userId);
    if (old && old.origin !== this.origin) throw invalid();
    const entry: ErasureReceipt = old ?? { userId, origin: this.origin, committed: false };
    const addProof = supported && !entry.proof;
    if (addProof) entry.proof = randomBytes(32).toString('base64url');
    if (!old || addProof) await (await this.file(userId)).write(entry);
    return { entry, fresh: !old };
  }

  async commit(entry: ErasureReceipt) {
    if (!entry.committed) await (await this.file(entry.userId)).write({ ...entry, committed: true });
  }

  async forget(userId: string) {
    await (await this.file(userId)).clear();
  }

  async confirmed(entry: ErasureReceipt, signal = AbortSignal.timeout(3500)) {
    if (entry.origin !== this.origin) return false;
    if (entry.committed) return true;
    if (!entry.proof || signal.aborted) return false;
    try {
      const response = await this.fetcher(entry.origin + '/v1/account/deletion-status', {
        method: 'POST', redirect: 'error', signal, headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userId: entry.userId, proof: entry.proof }),
      });
      if (response.status !== 200) {
        void response.body?.cancel().catch(() => {});
        return false;
      }
      const body = await boundedJson(response, 1024, signal) as Record<string, unknown>;
      return body?.deleted === true && body.userId === entry.userId;
    } catch { return false; }
  }

  private async owners() {
    const dir = await this.directory();
    if (!dir) return [];
    return (await readdir(dir, { withFileTypes: true }))
      .filter(item => (item.isFile() || item.isSymbolicLink()) && item.name.endsWith('.bin'))
      .map(item => item.name.slice(0, -4)).filter(validId);
  }

  async checkRecords(decrypt: (value: Buffer) => Promise<string>) {
    const owners = await this.owners();
    for (const id of owners) await this.read(id, decrypt);
    return owners.length > 0;
  }

  async recover(erase: (userId: string) => Promise<void>) {
    const owners = (await this.owners()).values();
    const ready: ErasureReceipt[] = [];
    const blocked = new Set<string>();
    const check = async () => {
      for (const userId of owners) {
        try {
          const entry = await this.read(userId);
          if (entry && await this.confirmed(entry)) ready.push(entry);
        } catch { blocked.add(userId); }
      }
    };
    await Promise.all([check(), check()]);
    for (const entry of ready) {
      try {
        await this.commit(entry);
        await erase(entry.userId);
        await this.forget(entry.userId);
      } catch { blocked.add(entry.userId); }
    }
    return blocked;
  }
}
