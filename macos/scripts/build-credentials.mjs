import workspace from '../../shared/scripts/workspace.mjs';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { localSigningCertificate, verifyLocalApp } from './development-signing.mjs';
import { readCredentialHelperCache } from './build-hardened-credentials.mjs';

export const credentialIdentifier = 'com.voxcue.credentials';
export const credentialFile = 'VoxCue.Credentials';
const digest = (value) => createHash('sha256').update(value).digest('hex');
export async function buildLegacyCredentials() {
  const signing = await localSigningCertificate();
  const source = path.join(workspace.platformRoot, 'native/Credentials.mm');
  const directory = path.join(workspace.platformRoot, '.tools/credential-helper-v1');
  const canonical = path.join(directory, credentialFile);
  const { record, bytes } = await readCredentialHelperCache(directory);
  if (
    record.sourceHash !== digest(await readFile(source)) ||
    record.certificate !== signing.sha256 ||
    record.binaryHash !== digest(bytes)
  )
    throw Error('Fixed v1 credential helper changed; restore its exact recovery material.');
  verifyLocalApp(canonical, signing, credentialIdentifier);
  // Deprecated formal baseline only; never rebuild or replace the current helper.
  return canonical;
}
if (process.argv[1] === new URL(import.meta.url).pathname) {
  await buildLegacyCredentials();
  console.log('Verified fixed v1 recovery helper; no Keychain item was accessed.');
}
