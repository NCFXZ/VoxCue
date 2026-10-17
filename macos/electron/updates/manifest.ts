import { createPublicKey, verify } from 'node:crypto';
import {
  manifestFile,
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
  if (
    !verify(
      null,
      macUpdatePayload(result),
      publicUpdateKey(publicKey),
      Buffer.from(raw.voxcueSignature as string, 'base64'),
    )
  )
    throw Error('Untrusted Mac update manifest');
  return result;
}
export type SignedMacUpdate = ReturnType<typeof signedMacUpdate>;
