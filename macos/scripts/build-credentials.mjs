import workspace from '../../shared/scripts/workspace.mjs';
import { readFile, mkdir, mkdtemp, writeFile, copyFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { loadDevelopmentSigning, signLocalCode, verifyLocalApp } from './development-signing.mjs';

export const credentialIdentifier = 'com.voxcue.credentials';
export const credentialFile = 'VoxCue.Credentials';
const digest = (value) => createHash('sha256').update(value).digest('hex');
export async function buildLegacyCredentials() {
  const signing = await loadDevelopmentSigning();
  const source = path.join(workspace.platformRoot, 'native/Credentials.mm');
  const directory = path.join(workspace.platformRoot, '.tools/credential-helper-v1');
  const canonical = path.join(directory, credentialFile);
  const recordFile = path.join(directory, 'build.json');
  const sourceHash = digest(await readFile(source));
  const record = await readFile(recordFile, 'utf8')
    .then(JSON.parse)
    .catch((error) => {
      if (error.code !== 'ENOENT') throw error;
    });
  if (record) {
    if (
      record.sourceHash !== sourceHash ||
      record.certificate !== signing.sha256 ||
      record.binaryHash !== digest(await readFile(canonical))
    )
      throw Error(
        'Fixed credential helper changed. Restore it or implement an explicit credential migration; never silently rebuild its Keychain identity.',
      );
  } else {
    // No app version, Info.plist, resource seal or build timestamp enters this
    // executable. Once built, subsequent releases copy these exact signed bytes.
    const stage = await mkdtemp(path.join(os.tmpdir(), 'voxcue-credentials-build-'));
    try {
      const binary = path.join(stage, credentialFile);
      const result = spawnSync(
        '/usr/bin/xcrun',
        [
          'clang++',
          '-std=c++17',
          '-fobjc-arc',
          '-Wno-deprecated-declarations',
          '-arch',
          'arm64',
          '-mmacosx-version-min=14.2',
          '-O2',
          '-DVOXCUE_SIGNING_SHA1="' + signing.sha1.toLowerCase() + '"',
          source,
          '-framework',
          'Foundation',
          '-framework',
          'Security',
          '-o',
          binary,
        ],
        { encoding: 'utf8' },
      );
      if (result.error || result.status) throw result.error ?? Error(result.stderr);
      signLocalCode(binary, signing, credentialIdentifier, { preserveMetadata: false });
      verifyLocalApp(binary, signing, credentialIdentifier);
      await mkdir(directory, { recursive: true });
      await copyFile(binary, canonical);
      await writeFile(
        recordFile,
        JSON.stringify({
          sourceHash,
          certificate: signing.sha256,
          binaryHash: digest(await readFile(canonical)),
        }) + '\n',
        { flag: 'wx' },
      );
    } finally {
      await rm(stage, { recursive: true, force: true });
    }
  }
  verifyLocalApp(canonical, signing, credentialIdentifier);
  // This frozen identity remains a recovery/compatibility baseline. It must not
  // overwrite the production v2 helper in native/bin.
  return canonical;
}
if (process.argv[1] === new URL(import.meta.url).pathname) {
  await buildLegacyCredentials();
  console.log(
    'Prepared fixed standalone credential helper; existing Keychain items were not accessed.',
  );
}
