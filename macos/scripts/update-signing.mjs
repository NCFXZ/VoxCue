import { generateKeyPairSync, createPrivateKey, createPublicKey } from 'node:crypto';
import { mkdir, readFile, writeFile, lstat } from 'node:fs/promises';
import path from 'node:path';
import workspace from '../../shared/scripts/workspace.mjs';

const directory = path.join(workspace.platformRoot, '.tools/update-signing');
export const privateKeyFile = path.join(directory, 'ed25519.key');
export const publicKeyFile = path.join(workspace.platformRoot, 'update-public-key.json');
export async function updateSigningKey({ create = false } = {}) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  if ((await lstat(directory)).isSymbolicLink()) throw Error('Redirected signing directory');
  let encoded = await readFile(privateKeyFile, 'utf8').catch((error) => {
    if (error.code !== 'ENOENT') throw error;
    return undefined;
  });
  if (!encoded) {
    if (
      !create ||
      (await readFile(publicKeyFile).then(
        () => true,
        (error) => {
          if (error.code !== 'ENOENT') throw error;
          return false;
        },
      ))
    )
      throw Error('The existing update private key is required; refusing to rotate it.');
    const { privateKey } = generateKeyPairSync('ed25519');
    encoded = Buffer.from(privateKey.export({ format: 'jwk' }).d, 'base64url').toString('base64');
    await writeFile(privateKeyFile, encoded + '\n', { mode: 0o600, flag: 'wx' });
  }
  const info = await lstat(privateKeyFile);
  if (!info.isFile() || info.isSymbolicLink() || info.mode & 0o077)
    throw Error('Update key must be a private regular file (0600).');
  const seed = Buffer.from(encoded.trim(), 'base64');
  if (seed.length !== 32) throw Error('Invalid local update signing seed');
  const key = createPrivateKey({
    key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed]),
    format: 'der',
    type: 'pkcs8',
  });
  const publicKey = Buffer.from(
    createPublicKey(key).export({ format: 'jwk' }).x,
    'base64url',
  ).toString('base64');
  const saved = await readFile(publicKeyFile, 'utf8')
    .then(JSON.parse)
    .catch((error) => {
      if (error.code !== 'ENOENT') throw error;
      return undefined;
    });
  if (saved && (saved.protocol !== 1 || saved.publicKey !== publicKey))
    throw Error('Signing key does not match the pinned public key');
  if (!saved)
    await writeFile(publicKeyFile, JSON.stringify({ protocol: 1, publicKey }, null, 2) + '\n', {
      flag: 'wx',
    });
  return { key, publicKey, privateKeyFile };
}
