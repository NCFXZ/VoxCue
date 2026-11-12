import { generateKeyPairSync, createPrivateKey, createPublicKey } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import workspace from '../../shared/scripts/workspace.mjs';
import { privatePath, readPrivateFile } from './signing-material.mjs';

const directory = path.join(workspace.platformRoot, '.tools/update-signing');
export const privateKeyFile = path.join(directory, 'ed25519.key');
export const publicKeyFile = path.join(workspace.platformRoot, 'update-public-key.json');
export async function updateSigningKey({
  create = false,
  keyDirectory = directory,
  pinFile = publicKeyFile,
} = {}) {
  const privateKeyFile = path.join(keyDirectory, 'ed25519.key');
  const saved = await readFile(pinFile, 'utf8')
    .then(JSON.parse)
    .catch((error) => {
      if (error.code !== 'ENOENT') throw error;
      return undefined;
    });
  if (!saved && !create)
    throw Error(
      'The established update public key is required; restore it rather than initializing a new identity.',
    );
  if (create) await mkdir(keyDirectory, { recursive: true, mode: 0o700 });
  await privatePath(keyDirectory, true);
  let encoded = await readPrivateFile(privateKeyFile).catch((error) => {
    if (error.code !== 'ENOENT') throw error;
    return undefined;
  });
  if (!encoded) {
    if (!create || saved)
      throw Error('The existing update private key is required; refusing to rotate it.');
    const { privateKey } = generateKeyPairSync('ed25519');
    encoded = Buffer.from(privateKey.export({ format: 'jwk' }).d, 'base64url').toString('base64');
    await writeFile(privateKeyFile, encoded + '\n', { mode: 0o600, flag: 'wx' });
  }
  await privatePath(privateKeyFile);
  const seed = Buffer.from(encoded.trim(), 'base64');
  if (seed.length !== 32 || seed.toString('base64') !== encoded.trim())
    throw Error('Invalid local update signing seed');
  const der = Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed]);
  let key;
  try {
    key = createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
  } finally {
    seed.fill(0);
    der.fill(0);
  }
  const publicKey = Buffer.from(
    createPublicKey(key).export({ format: 'jwk' }).x,
    'base64url',
  ).toString('base64');
  if (saved && (saved.protocol !== 1 || saved.publicKey !== publicKey))
    throw Error('Signing key does not match the pinned public key');
  if (!saved)
    await writeFile(pinFile, JSON.stringify({ protocol: 1, publicKey }, null, 2) + '\n', {
      flag: 'wx',
    });
  return { key, publicKey, privateKeyFile };
}
