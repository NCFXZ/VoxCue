import {
  createCipheriv,
  createDecipheriv,
  createPrivateKey,
  createPublicKey,
  randomBytes,
  scryptSync,
} from 'node:crypto';
import { lstat, mkdir, open, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { emitKeypressEvents } from 'node:readline';
import workspace from '../../shared/scripts/workspace.mjs';
import { privatePath, readPrivateFile } from './signing-material.mjs';
import { updateSigningKey, publicKeyFile } from './update-signing.mjs';

const purpose = 'voxcue-macos-update-backup-v1';
const kdf = { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };
function derive(password, salt) {
  if (typeof password !== 'string' || password.length < 20 || password.length > 512)
    throw Error('Use an independent passphrase of 20–512 characters.');
  return scryptSync(password, salt, 32, kdf);
}
function outsideRepository(file) {
  if (!path.isAbsolute(file)) throw Error('Use an absolute backup path outside the repository.');
  const relative = path.relative(workspace.repositoryRoot, file);
  if (!relative || (!relative.startsWith('..' + path.sep) && !path.isAbsolute(relative)))
    throw Error('Signing backups must stay outside the repository.');
}
const aad = (publicKey) => Buffer.from(JSON.stringify([purpose, publicKey]));
function bytes(value, size) {
  if (typeof value !== 'string') throw Error('Invalid encrypted signing backup');
  const decoded = Buffer.from(value, 'base64');
  if (decoded.length !== size || decoded.toString('base64') !== value)
    throw Error('Invalid encrypted signing backup');
  return decoded;
}
export async function backupUpdateKey(file, password, options = {}) {
  outsideRepository(file);
  await privatePath(path.dirname(file), true);
  const salt = randomBytes(32),
    nonce = randomBytes(12),
    derived = derive(password, salt);
  let seed;
  try {
    const { key, publicKey } = await updateSigningKey({ ...options, create: false });
    seed = Buffer.from(key.export({ format: 'jwk' }).d, 'base64url');
    const cipher = createCipheriv('aes-256-gcm', derived, nonce);
    cipher.setAAD(aad(publicKey));
    const ciphertext = Buffer.concat([cipher.update(seed), cipher.final()]);
    const value = {
      purpose,
      publicKey,
      salt: salt.toString('base64'),
      nonce: nonce.toString('base64'),
      ciphertext: ciphertext.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
    };
    const output = await open(file, 'wx', 0o600);
    try {
      await output.writeFile(JSON.stringify(value) + '\n');
      await output.sync();
    } finally {
      await output.close();
    }
  } finally {
    seed?.fill(0);
    derived.fill(0);
  }
}
export async function restoreUpdateKey(file, password, options = {}) {
  outsideRepository(file);
  await privatePath(file);
  if ((await lstat(file)).size > 4096) throw Error('Invalid encrypted signing backup');
  const keyDirectory =
    options.keyDirectory ?? path.join(workspace.platformRoot, '.tools/update-signing');
  const destination = path.join(keyDirectory, 'ed25519.key');
  try {
    await lstat(destination);
    throw Error('Refusing to overwrite an existing private key.');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const pin = JSON.parse(await readFile(options.pinFile ?? publicKeyFile, 'utf8'));
  const value = JSON.parse(await readPrivateFile(file));
  if (pin.protocol !== 1 || value.purpose !== purpose || value.publicKey !== pin.publicKey)
    throw Error('Backup does not match the established public identity.');
  bytes(pin.publicKey, 32);
  const derived = derive(password, bytes(value.salt, 32));
  let seed, encoded;
  try {
    const cipher = createDecipheriv('aes-256-gcm', derived, bytes(value.nonce, 12));
    cipher.setAAD(aad(pin.publicKey));
    cipher.setAuthTag(bytes(value.tag, 16));
    seed = Buffer.concat([cipher.update(bytes(value.ciphertext, 32)), cipher.final()]);
    const key = createPrivateKey({
      key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed]),
      format: 'der',
      type: 'pkcs8',
    });
    if (
      Buffer.from(createPublicKey(key).export({ format: 'jwk' }).x, 'base64url').toString(
        'base64',
      ) !== pin.publicKey
    )
      throw Error('Restored key does not match the established public identity.');
    await mkdir(keyDirectory, { recursive: true, mode: 0o700 });
    await privatePath(keyDirectory, true);
    encoded = Buffer.from(seed.toString('base64') + '\n');
    const output = await open(destination, 'wx', 0o600);
    try {
      await output.writeFile(encoded);
      await output.sync();
    } finally {
      await output.close();
    }
  } finally {
    derived.fill(0);
    seed?.fill(0);
    encoded?.fill(0);
  }
}
async function passphrase(label) {
  if (!process.stdin.isTTY || !process.stdout.isTTY)
    throw Error(
      'Run in a local interactive terminal; do not pass secrets as arguments or environment variables.',
    );
  process.stdout.write(label);
  const previous = process.stdin.isRaw;
  emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  try {
    return await new Promise((resolve, reject) => {
      let value = '';
      const keypress = (text, key) => {
        if (key?.ctrl && key.name === 'c') {
          cleanup();
          reject(Error('Cancelled'));
        } else if (key?.name === 'return') {
          cleanup();
          resolve(value);
        } else if (key?.name === 'backspace') value = value.slice(0, -1);
        else if (text && !key?.ctrl && !key?.meta && value.length < 512) value += text;
      };
      const cleanup = () => process.stdin.removeListener('keypress', keypress);
      process.stdin.on('keypress', keypress);
    });
  } finally {
    process.stdin.setRawMode(previous);
    process.stdin.pause();
    process.stdout.write('\n');
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argument = process.argv[2];
  if (
    process.platform !== 'darwin' ||
    process.argv.length !== 3 ||
    !/^--(?:backup|restore)=\//.test(argument ?? '')
  )
    throw Error(
      'Use --backup=/absolute/offline/path or --restore=/absolute/offline/path on macOS.',
    );
  let password = await passphrase('Independent backup passphrase (hidden): ');
  try {
    if (argument.startsWith('--backup=')) {
      if (password !== (await passphrase('Repeat passphrase (hidden): ')))
        throw Error('Passphrases differ.');
      await backupUpdateKey(argument.slice(9), password);
    } else await restoreUpdateKey(argument.slice(10), password);
    console.log('Completed using the existing public identity; no private material is displayed.');
  } finally {
    password = '';
  }
}
