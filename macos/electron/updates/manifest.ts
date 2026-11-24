import { createPublicKey, verify } from 'node:crypto';
import {
  macDeltaFile,
  manifestFile,
  type MacDeltaFile,
  type ReleaseCandidate,
} from '../../../shared/electron/backend/updates/releases';

export function macUpdatePayload(value: {
  version: string;
  url: string;
  size: number;
  sha512: string;
  edSignature: string;
  minimumSystemVersion: string;
}) {
  return Buffer.from(
    JSON.stringify([
      'voxcue-macos-update-v1',
      value.version,
      value.url,
      value.size,
      value.sha512,
      value.edSignature,
      value.minimumSystemVersion,
    ]),
  );
}

export function macDeltaPayload(
  archive: { version: string; url: string; size: number; sha512: string },
  delta: Omit<MacDeltaFile, 'signature'>,
) {
  return Buffer.from(JSON.stringify([
    'voxcue-macos-delta-v1',
    archive.version, archive.url, archive.size, archive.sha512,
    delta.base.version, delta.base.size, delta.base.sha512,
    delta.url, delta.size, delta.sha512,
  ]));
}

export function publicUpdateKey(base64: string) {
  if (!/^[A-Za-z0-9+/]{43}=$/.test(base64) || Buffer.from(base64, 'base64').length !== 32)
    throw Error('Invalid pinned update key');
  return createPublicKey({
    key: { kty: 'OKP', crv: 'Ed25519', x: Buffer.from(base64, 'base64').toString('base64url') },
    format: 'jwk',
  });
}

export function signedMacUpdate(metadata: unknown, candidate: ReleaseCandidate, publicKey: string) {
  if (candidate.manifest !== 'latest-mac.yml') throw Error('Wrong platform update');
  const selected = manifestFile(metadata, candidate);
  const raw = (metadata as { files: Array<Record<string, unknown>> }).files.find(
    (file) => file.url === selected.url,
  )!;
  for (const key of ['edSignature', 'voxcueSignature'])
    if (typeof raw[key] !== 'string' || !/^[A-Za-z0-9+/]{86}==$/.test(raw[key] as string))
      throw Error('Missing or invalid Mac update signature');
  const result = {
    ...selected,
    version: candidate.version,
    minimumSystemVersion: selected.minimumSystemVersion ?? '14.2',
    edSignature: raw.edSignature as string,
  };
  const key = publicUpdateKey(publicKey);
  if (
    !verify(
      null,
      macUpdatePayload(result),
      key,
      Buffer.from(raw.voxcueSignature as string, 'base64'),
    )
  )
    throw Error('Untrusted Mac update manifest');
  // Keep the v1 ZIP envelope readable by previous clients. The optional
  // delta has its own signature binding it to that exact ZIP and baseline.
  let delta: MacDeltaFile | undefined;
  try {
    const supplemental = macDeltaFile(metadata, candidate);
    if (supplemental && verify(null, macDeltaPayload(result, supplemental), key,
        Buffer.from(supplemental.signature, 'base64')))
      delta = supplemental;
  } catch {
    // Older releases and broken mirrors still offer the authenticated ZIP.
  }
  return { ...result, ...(delta ? { delta } : {}) };
}
export type SignedMacUpdate = ReturnType<typeof signedMacUpdate>;
