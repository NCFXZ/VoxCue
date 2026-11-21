import { ApiCredentialStore, readApiKeyRecords } from '../../electron/backend/api/credentials';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  maintainCredentialRecords,
  readCredentialRecords,
} from '../../electron/application/credentialMaintenance';
import type { CredentialCleanup } from '../../electron/contracts/credentialMaintenance';
import { storedTelemetryProofs } from '../../electron/backend/telemetry/identity';
import { profileDirectory } from '../../electron/accountProfilePaths';
import {
  migrationPasswordFileName,
  readMigrationPasswordRecords,
} from '../../electron/backend/cloud/migrationPasswordRecords';

const native = vi.hoisted(() => ({ directory: '' }));
vi.mock('electron', () => ({ app: { getPath: () => native.directory }, safeStorage: {} }));
import { createAuthStorage } from '../../electron/backend/auth/storage';
import { createCloudVault, createCredentialVault } from '../../electron/backend/cloud/vault';

beforeEach(async () => {
  native.directory = await mkdtemp(path.join(tmpdir(), 'voxcue-credential-gate-'));
});
afterEach(async () => {
  await rm(native.directory, { recursive: true, force: true });
});

const absentCurrent: CredentialCleanup = {
  cleanup: 'deferred',
  removed: 0,
  retained: null,
  retainedItems: [],
  reason: 'current',
};
const retained: CredentialCleanup = {
  cleanup: 'partial',
  removed: 1,
  retained: 2,
  retainedItems: ['safe-key'],
  reason: 'authorization',
};

function fixture(result: CredentialCleanup) {
  const cleanup = vi.fn(async () => result);
  const decrypt = vi.fn(async () => 'synthetic credential');
  const maintain = vi.fn(
    async (readable: (decode: (value: Buffer) => Promise<string>) => Promise<boolean>) =>
      (await readable(decrypt)) ? cleanup() : undefined,
  );
  return { cleanup, decrypt, maintain };
}

it('does not turn an empty new installation without a current key into an old-item warning', async () => {
  const f = fixture(absentCurrent);
  expect(await maintainCredentialRecords(f.maintain, async () => 'empty')).toBeUndefined();
  expect(f.cleanup).toHaveBeenCalledOnce();
  expect(f.decrypt).not.toHaveBeenCalled();
});

function storedReaders() {
  const origin = 'https://synthetic.example.test';
  const crypto = {
    encrypt: async (value: string) => Buffer.from('synthetic:' + value),
    decrypt: async (value: Buffer) => value.toString().slice('synthetic:'.length),
  };
  const ports = {
    erasingAccount: false,
    authStorage: createAuthStorage('synthetic', crypto),
    cloudVault: createCloudVault(crypto),
    telemetryProofVault: createCredentialVault(
      path.join(native.directory, 'cloud-account/telemetry.bin'),
      crypto,
    ),
    readMigrationPasswords: (decrypt: (value: Buffer) => Promise<string>) =>
      readMigrationPasswordRecords(native.directory, decrypt),
    readApiKeys: (key: (value: Buffer) => Promise<string>) => readApiKeyRecords(native.directory, key),
    accountOrigin: origin,
    validateTelemetryProofs: async (value: unknown) => {
      storedTelemetryProofs(value, origin, '00000000-0000-4000-8000-000000000001');
    },
  };
  return { ports, decrypt: crypto.decrypt };
}

it('classifies an installation with no retained credential records as empty and allows successful cleanup', async () => {
  const { ports, decrypt } = storedReaders();
  const read = () => readCredentialRecords(decrypt, ports);
  expect(await read()).toBe('empty');
  const complete: CredentialCleanup = {
    cleanup: 'complete',
    removed: 0,
    retained: 0,
    retainedItems: [],
    reason: 'none',
  };
  const f = fixture(complete);
  expect(await maintainCredentialRecords(f.maintain, read)).toEqual(complete);
  expect(f.cleanup).toHaveBeenCalledOnce();
});

it.each([
  ['auth-data/credentials.bin', 'null'],
  ['auth-data/credentials.bin', '{broken'],
  ['auth-data/credentials.bin', '{"version":1}'],
  ['cloud-account/session.bin', 'null'],
  ['cloud-account/session.bin', '{broken'],
  ['cloud-account/session.bin', '{}'],
  ['cloud-account/telemetry.bin', 'null'],
  ['cloud-account/telemetry.bin', '{broken'],
  ['cloud-account/telemetry.bin', '{}'],
])(
  'does not treat encrypted invalid data in %s (%s) as an empty installation',
  async (relative, data) => {
    const file = path.join(native.directory, relative);
    await mkdir(path.dirname(file), { recursive: true });
    const bytes = Buffer.from('synthetic:' + data);
    await writeFile(file, bytes);
    const { ports, decrypt } = storedReaders();
    const read = () => readCredentialRecords(decrypt, ports);
    expect(await read()).toBe('unavailable');
    const f = fixture(retained);
    expect(await maintainCredentialRecords(f.maintain, read)).toBeUndefined();
    expect(f.cleanup).not.toHaveBeenCalled();
    expect(await readFile(file)).toEqual(bytes);
  },
);

it('continues to report known retained aliases and counts even when no local records exist', async () => {
  const f = fixture(retained);
  expect(await maintainCredentialRecords(f.maintain, async () => 'empty')).toEqual(retained);
  expect(f.cleanup).toHaveBeenCalledOnce();
});

it('checks every profile migration verifier with the candidate key and retains old keys on a wrong owner, malformed content or inaccessible file', async () => {
  const { ports, decrypt } = storedReaders();
  const ids = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'];
  const stored = ids.map((id, index) => ({
    version: 1,
    id,
    email: `synthetic-${index}@example.test`,
    origin: ports.accountOrigin,
    salt: 'a'.repeat(32),
    digest: 'b'.repeat(64),
    failures: 0,
    retryAt: 0,
  }));
  const files = ids.map((id) =>
    path.join(profileDirectory(native.directory, 'account:' + id), migrationPasswordFileName),
  );
  const encode = (object: unknown) => Buffer.from('synthetic:' + JSON.stringify(object));
  for (const [i, file] of files.entries()) {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, encode(stored[i]));
  }
  const candidate = vi.fn(decrypt);
  expect(await readCredentialRecords(candidate, ports)).toBe('readable');
  expect(candidate).toHaveBeenCalledTimes(2);
  for (const invalid of [
    stored[0],
    { ...stored[1], digest: 'broken' },
    { ...stored[1], origin: 'unsafe' },
    { ...stored[1], id: [ids[1]] },
  ]) {
    await writeFile(files[1], encode(invalid));
    const f = fixture(retained);
    expect(
      await maintainCredentialRecords(f.maintain, () => readCredentialRecords(candidate, ports)),
    ).toBeUndefined();
    expect(f.cleanup).not.toHaveBeenCalled();
    expect(await readFile(files[1])).toEqual(encode(invalid));
  }
  await writeFile(files[1], encode(stored[1]));
  expect(
    await readCredentialRecords(async () => {
      throw Error('candidate cannot decrypt');
    }, ports),
  ).toBe('unavailable');
  const redirected = path.join(native.directory, 'account-profiles', 'c'.repeat(64));
  await symlink(path.dirname(files[0]), redirected, 'junction');
  expect(await readCredentialRecords(candidate, ports)).toBe('unavailable');
});

it.each(['readable', 'unavailable'] as const)(
  'does not classify %s stored credentials as an empty new installation',
  async (state) => {
    const f = fixture(absentCurrent);
    const result = await maintainCredentialRecords(f.maintain, async (decrypt) => {
      await decrypt(Buffer.from('synthetic ciphertext'));
      return state;
    });
    expect(f.decrypt).toHaveBeenCalledOnce();
    if (state === 'readable') {
      expect(result).toEqual(absentCurrent);
      expect(f.cleanup).toHaveBeenCalledOnce();
    } else {
      expect(result).toBeUndefined();
      expect(f.cleanup).not.toHaveBeenCalled();
    }
  },
);

it.each(['failed', 'authorization'] as const)(
  'keeps an unknown %s cleanup outcome visible on an otherwise empty installation',
  async (reason) => {
    const result = { ...absentCurrent, reason };
    const f = fixture(result);
    expect(await maintainCredentialRecords(f.maintain, async () => 'empty')).toEqual(result);
  },
);

it('does not hide native failures or attempt another maintenance request', async () => {
  const maintain = vi.fn(async () => {
    throw Error('synthetic helper failure');
  });
  await expect(maintainCredentialRecords(maintain, async () => 'empty')).rejects.toThrow(
    'helper failure',
  );
  expect(maintain).toHaveBeenCalledOnce();
});

it('keeps historical keys when any account’s API key is unreadable or has a mismatched destination', async () => {
  const { ports, decrypt } = storedReaders();
  const root = profileDirectory(native.directory, 'local');
  const key = new ApiCredentialStore(root, { encrypt: text => Buffer.from('synthetic:' + text), decrypt });
  await key.save('openai', { key: 'synthetic-api-key' });
  expect(await readCredentialRecords(decrypt, ports)).toBe('readable');
  const file = path.join(root, 'auth-data/api-keys/openai.json');
  const envelope = JSON.parse(await readFile(file, 'utf8'));
  envelope.ciphertext = Buffer.from('synthetic:' + JSON.stringify({config: {provider: 'deepseek'}, key: 'test'})).toString('base64');
  await writeFile(file, JSON.stringify(envelope));
  expect(await readCredentialRecords(decrypt, ports)).toBe('unavailable');
  const other = profileDirectory(native.directory, 'demo');
  await mkdir(other);
  await symlink(path.join(root, 'auth-data'), path.join(other, 'auth-data'));
  await key.remove('openai');
  expect(await readCredentialRecords(decrypt, ports)).toBe('unavailable');
});
