import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  maintainCredentialRecords,
  readCredentialRecords,
} from '../../electron/application/credentialMaintenance';
import type { CredentialCleanup } from '../../electron/contracts/credentialMaintenance';
import { storedTelemetryProofs } from '../../electron/backend/telemetry/identity';

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
    accountOrigin: origin,
    validateTelemetryProofs: async (value: unknown) => {
      storedTelemetryProofs(value, origin, '00000000-0000-4000-8000-000000000001');
    },
  };
  return { ports, decrypt: crypto.decrypt };
}

it('classifies only three genuinely missing credential files as empty and still allows successful cleanup', async () => {
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
