import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { isCloudProfileOwner } from '../../accountProfilePaths';
import {
  normalizeCloudPassword,
  validCloudEmail,
  type CloudUser,
} from '../../contracts/cloudAccount';

type Identity = Pick<CloudUser, 'id' | 'email'>;
type Verifier = {
  id: string;
  email: string;
  origin: string;
  salt: string;
  digest: string;
  failures: number;
  retryAt: number;
} & ({ version: 1 } | { version: 2; verifiedAt: number });
type Vault = {
  read(): Promise<unknown>;
  write(value: Verifier): Promise<void>;
  clear(): Promise<void>;
};

export function validMigrationVerifier(value: unknown): value is Verifier {
  const v = value as Partial<Verifier> | null;
  return (
    !!v &&
    (v.version === 1 || (v.version === 2 && Number.isSafeInteger(v.verifiedAt) && v.verifiedAt! > 0)) &&
    isCloudProfileOwner('account:' + v.id) &&
    validCloudEmail(v.email) &&
    typeof v.origin === 'string' &&
    !!v.origin &&
    typeof v.salt === 'string' &&
    /^[a-f0-9]{32}$/.test(v.salt) &&
    typeof v.digest === 'string' &&
    /^[a-f0-9]{64}$/.test(v.digest) &&
    Number.isSafeInteger(v.failures) &&
    v.failures! >= 0 &&
    v.failures! <= 10 &&
    Number.isSafeInteger(v.retryAt) &&
    v.retryAt! >= 0
  );
}

function derive(password: string, salt: string) {
  if (!password || normalizeCloudPassword(password) === undefined)
    throw Error('请输入资料所属账号的密码。');
  return new Promise<Buffer>((resolve, reject) =>
    scrypt(
      password,
      Buffer.from(salt, 'hex'),
      32,
      { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 },
      (error, key) => (error ? reject(error) : resolve(key)),
    ),
  );
}

/** Each encrypted file belongs to one local profile. Logout retains it for migrating that profile. */
export class MigrationPasswords {
  private pending: Promise<unknown> = Promise.resolve();
  constructor(private vault: (id: string) => Vault) {}
  private run<T>(id: string, work: (vault: Vault) => Promise<T>) {
    if (!isCloudProfileOwner('account:' + id)) throw Error('账号资料归属无效。');
    const next = this.pending.then(() => work(this.vault(id)));
    this.pending = next.catch(() => {});
    return next;
  }
  remember(user: Identity, password: string, origin: string) {
    return this.run(user.id, async (vault) => {
      const salt = randomBytes(16).toString('hex');
      const digest = await derive(password, salt);
      try {
        await vault.write({
          version: 2,
          verifiedAt: Date.now(),
          id: user.id,
          email: user.email.toLowerCase(),
          origin,
          salt,
          digest: digest.toString('hex'),
          failures: 0,
          retryAt: 0,
        });
      } catch (error) {
        // An older password must not survive a failed replacement.
        await vault.clear();
        throw error;
      } finally {
        digest.fill(0);
      }
    });
  }
  forget(id: string) {
    return this.run(id, (vault) => vault.clear());
  }
  forgetIfRejected(user: Identity, password: string, origin: string) {
    return this.run(user.id, async (vault) => {
      const value = await vault.read();
      if (
        !validMigrationVerifier(value) ||
        value.id !== user.id ||
        value.email !== user.email.toLowerCase() ||
        value.origin !== origin
      )
        return;
      const key = await derive(password, value.salt);
      try {
        if (timingSafeEqual(key, Buffer.from(value.digest, 'hex'))) await vault.clear();
      } finally {
        key.fill(0);
      }
    });
  }
  verify(user: Identity, password: string, origin: string, signal: AbortSignal) {
    return this.run(user.id, async (vault) => {
      signal.throwIfAborted();
      const value = await vault.read();
      if (
        !validMigrationVerifier(value) ||
        value.id !== user.id ||
        value.email !== user.email.toLowerCase() ||
        value.origin !== origin
      )
        throw Error('此账号尚未在本机设置离线迁移。请联网并使用密码登录来源账号一次。');
      // Local data remains recoverable if the account service permanently shuts down.
      if (value.retryAt > Date.now()) throw Error('密码尝试过于频繁，请稍后重试。');
      const key = await derive(password, value.salt);
      const matches = timingSafeEqual(key, Buffer.from(value.digest, 'hex'));
      key.fill(0);
      signal.throwIfAborted();
      if (!matches) {
        const failures = Math.min(value.failures + 1, 10);
        const delay = failures < 5 ? 0 : Math.min(900_000, 30_000 * 2 ** (failures - 5));
        await vault.write({ ...value, failures, retryAt: Date.now() + delay });
        throw Error('来源账号的离线迁移密码不正确。');
      }
      if (value.failures) await vault.write({ ...value, failures: 0, retryAt: 0 });
      signal.throwIfAborted();
    });
  }
}
