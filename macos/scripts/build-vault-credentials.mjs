import workspace from '../../shared/scripts/workspace.mjs';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import {
  credentialFile,
  ownedFile,
  readCredentialHelperCache,
  copyCredentialHelper,
  verifyHardenedCredentials,
} from './build-hardened-credentials.mjs';
import { localSigningCertificate } from './development-signing.mjs';

const directory = path.join(workspace.platformRoot, '.tools/credential-helper-v8');
const canonical = path.join(directory, credentialFile);
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
export const productionCredentialFile = 'VoxCue';
export const vaultCredentialIdentifier = 'com.voxcue.credentials.vault';
export async function vaultCredentialSourceHashes() {
  return Object.fromEntries(
    await Promise.all(
      ['Credentials.mm', 'CredentialsHardened.mm', 'CredentialsVaultV8.mm'].map(async (name) => [
        name,
        digest(await readFile(path.join(workspace.platformRoot, 'native', name))),
      ]),
    ),
  );
}
export function verifyVaultCredentials(binary, signing) {
  verifyHardenedCredentials(binary, signing, vaultCredentialIdentifier);
}

export async function verifyFixedVaultCredentials(binary, signing) {
  const { record, bytes } = await readCredentialHelperCache(directory);
  if (
    record.version !== 8 ||
    record.certificate !== signing.sha256 ||
    JSON.stringify(record.sourceHashes) !== JSON.stringify(await vaultCredentialSourceHashes()) ||
    record.binaryHash !== digest(bytes) ||
    record.binaryHash !== digest(await ownedFile(binary))
  )
    throw Error(
      'Credential helper differs from its frozen v8 identity; restore the exact version.',
    );
  verifyVaultCredentials(binary, signing);
}

export async function buildVaultCredentials() {
  const signing = await localSigningCertificate();
  await verifyFixedVaultCredentials(canonical, signing);
  return copyCredentialHelper(
    canonical,
    path.join(workspace.platformRoot, 'native/bin', productionCredentialFile),
  );
}

// The v8 revision is frozen once created. Missing or mismatched material must be
// restored, never compiled or signed again by a normal build.
if (process.argv[1] === new URL(import.meta.url).pathname) {
  if (process.argv.length !== 2)
    throw Error('Frozen v8 helper accepts no initialization or replacement flags');
  await buildVaultCredentials();
  console.log(
    'Prepared fixed v8 credential helper; no user credential Keychain item was accessed.',
  );
}
