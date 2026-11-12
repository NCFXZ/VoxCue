import { describe, expect, it } from 'vitest';
import { generateKeyPairSync, sign } from 'node:crypto';
import {
  signedWindowsUpdate,
  validateSignedWindowsUpdate,
  windowsUpdatePayload,
} from '../../electron/backend/updates/windowsManifest';

const keys = generateKeyPairSync('ed25519');
const publicKey = Buffer.from(keys.publicKey.export({ format: 'jwk' }).x!, 'base64url').toString(
  'base64',
);
const candidate = {
  version: '1.2.3',
  tag: 'v1.2.3',
  publishedAt: 1700000000000,
  manifest: 'latest.yml',
  binary: { name: 'VoxCue-Setup-1.2.3-x64.exe', size: 1234 },
};
const file = {
  url: candidate.binary.name,
  size: 1234,
  sha512: Buffer.alloc(64, 3).toString('base64'),
};
function metadata() {
  return {
    version: candidate.version,
    files: [
      {
        ...file,
        voxcueSignature: sign(
          null,
          windowsUpdatePayload({ ...file, version: candidate.version }),
          keys.privateKey,
        ).toString('base64'),
      },
    ],
  };
}
describe('independent Windows update authentication', () => {
  it('verifies an authenticated update and retains its proof across cache normalization', () => {
    const info = signedWindowsUpdate(metadata(), candidate, publicKey);
    expect(
      validateSignedWindowsUpdate(JSON.parse(JSON.stringify(info)), 'windows-x64', publicKey),
    ).toEqual(info);
    expect(() => validateSignedWindowsUpdate(info, 'macos-arm64', publicKey)).toThrow('target');
  });
  it('rejects missing signatures, wrong keys, and altered signed fields', () => {
    const unsigned = metadata();
    delete (unsigned.files[0] as any).voxcueSignature;
    expect(() => signedWindowsUpdate(unsigned, candidate, publicKey)).toThrow('signature');
    for (const change of [
      (value: any) => (value.files[0].sha512 = Buffer.alloc(64, 9).toString('base64')),
      (value: any) => (value.minimumSystemVersion = '99.0'),
      (value: any) => (value.files[0].voxcueSignature = Buffer.alloc(64).toString('base64')),
    ]) {
      const value = metadata();
      change(value);
      expect(() => signedWindowsUpdate(value, candidate, publicKey)).toThrow();
    }
    const other = generateKeyPairSync('ed25519').publicKey;
    const otherKey = Buffer.from(other.export({ format: 'jwk' }).x!, 'base64url').toString(
      'base64',
    );
    expect(() => signedWindowsUpdate(metadata(), candidate, otherKey)).toThrow('Untrusted');
    const changed = metadata();
    changed.version = '1.2.4';
    changed.files[0].url = 'VoxCue-Setup-1.2.4-x64.exe';
    expect(() =>
      signedWindowsUpdate(
        changed,
        {
          ...candidate,
          version: '1.2.4',
          binary: { ...candidate.binary, name: changed.files[0].url },
        },
        publicKey,
      ),
    ).toThrow('Untrusted');
  });
});
