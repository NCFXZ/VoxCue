import { createPublicKey, verify } from 'node:crypto';
import { manifestFile, type ReleaseCandidate, type ReleaseTarget } from './releases';
import { platformUpdateInfo, validatePlatformUpdate, type PlatformUpdateInfo } from './cache';

export function windowsUpdatePayload(value: {
  version: string;
  url: string;
  size: number;
  sha512: string;
  minimumSystemVersion?: string;
}) {
  return Buffer.from(
    JSON.stringify([
      'voxcue-windows-update-v1',
      'windows-x64',
      value.version,
      value.url,
      value.size,
      value.sha512,
      value.minimumSystemVersion ?? '',
    ]),
  );
}

export function windowsUpdateKey(base64: string) {
  if (
    !/^[A-Za-z0-9+/]{43}=$/.test(base64) ||
    Buffer.from(base64, 'base64').toString('base64') !== base64
  )
    throw Error('Invalid pinned Windows update key');
  return createPublicKey({
    key: { kty: 'OKP', crv: 'Ed25519', x: Buffer.from(base64, 'base64').toString('base64url') },
    format: 'jwk',
  });
}

interface SignedWindowsInfo extends PlatformUpdateInfo {
  voxcueSignature: string;
}

export function signedWindowsUpdate(
  metadata: unknown,
  candidate: ReleaseCandidate,
  publicKey: string,
): SignedWindowsInfo {
  if (
    candidate.manifest !== 'latest.yml' ||
    !/^VoxCue-Setup-.*-x64\.exe$/.test(candidate.binary.name)
  )
    throw Error('Wrong Windows update platform');
  const selected = manifestFile(metadata, candidate);
  const file = (metadata as { files: Array<Record<string, unknown>> }).files.find(
    (entry) => entry.url === selected.url,
  )!;
  const signature = file.voxcueSignature;
  if (
    typeof signature !== 'string' ||
    !/^[A-Za-z0-9+/]{86}==$/.test(signature) ||
    Buffer.from(signature, 'base64').toString('base64') !== signature
  )
    throw Error('Missing or invalid Windows update signature');
  if (
    !verify(
      null,
      windowsUpdatePayload({ ...selected, version: candidate.version }),
      windowsUpdateKey(publicKey),
      Buffer.from(signature, 'base64'),
    )
  )
    throw Error('Untrusted Windows update manifest');
  return { ...platformUpdateInfo(candidate, metadata), voxcueSignature: signature };
}

/** Cache reads are authenticated again; unsigned pre-migration caches are never trusted. */
export function validateSignedWindowsUpdate(
  value: unknown,
  target: ReleaseTarget,
  publicKey: string,
) {
  if (target !== 'windows-x64') throw Error('Wrong Windows update target');
  const info = validatePlatformUpdate(value, target);
  return signedWindowsUpdate(
    {
      ...info,
      files: info.files.map((file) => ({
        ...file,
        voxcueSignature: (value as Partial<SignedWindowsInfo>).voxcueSignature,
      })),
    },
    info.selectedRelease,
    publicKey,
  );
}
