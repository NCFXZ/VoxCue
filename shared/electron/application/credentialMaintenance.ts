import type { CredentialCleanup } from '../contracts/credentialMaintenance';
import { storedCloudCredentials } from '../backend/cloud/client';

type DecryptCredential = (value: Buffer) => Promise<string>;
type StoredCredentials = 'readable' | 'empty' | 'unavailable';
type CredentialReader = { read(decrypt: DecryptCredential): Promise<unknown | null> };

export async function readCredentialRecords(
  decrypt: DecryptCredential,
  ports: {
    erasingAccount: boolean;
    authStorage: CredentialReader;
    cloudVault: CredentialReader;
    telemetryProofVault: CredentialReader;
    accountOrigin: string | undefined;
    validateTelemetryProofs?: (value: unknown) => Promise<void>;
  },
): Promise<StoredCredentials> {
  if (ports.erasingAccount) return 'unavailable';
  try {
    const credentials = await ports.authStorage.read(decrypt);
    const session = await ports.cloudVault.read(decrypt);
    const proofs = await ports.telemetryProofVault.read(decrypt);
    if (session !== null) {
      if (!ports.accountOrigin) return 'unavailable';
      storedCloudCredentials(session, ports.accountOrigin);
    }
    if (proofs !== null) {
      if (!ports.validateTelemetryProofs) return 'unavailable';
      await ports.validateTelemetryProofs(proofs);
    }
    return credentials === null && session === null && proofs === null ? 'empty' : 'readable';
  } catch {
    return 'unavailable';
  }
}

export async function maintainCredentialRecords(
  maintain: (
    readable: (decrypt: DecryptCredential) => Promise<boolean>,
  ) => Promise<CredentialCleanup | undefined>,
  readRecords: (decrypt: DecryptCredential) => Promise<StoredCredentials>,
): Promise<CredentialCleanup | undefined> {
  let empty = false;
  const result = await maintain(async (decrypt) => {
    const records = await readRecords(decrypt);
    empty = records === 'empty';
    return records !== 'unavailable';
  });
  // An empty install has no key yet. The native cleanup correctly declines to
  // create one, but that is not evidence that any historical copies remain.
  if (
    empty &&
    result?.cleanup === 'deferred' &&
    result.reason === 'current' &&
    result.retained === null
  )
    return undefined;
  return result;
}
