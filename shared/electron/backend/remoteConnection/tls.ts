import { X509Certificate } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { createServer as httpServer, type RequestListener } from 'node:http';
import { createServer as httpsServer } from 'node:https';
import path from 'node:path';

export interface RemoteTlsConfiguration {
  directory: string;
  decryptKey?: (ciphertext: Buffer, signal?: AbortSignal) => Promise<{ certificateHashes: string[]; pfx: Buffer }>;
}
export const tlsConfigurationError = '设备连接证书配置无效，请检查证书、私钥和当前局域网地址。';

async function fixedFile(directory: string, name: string, limit = 128 * 1024) {
  const file = path.join(directory, name);
  const original = await lstat(file);
  if (!original.isFile() || await realpath(file) !== file) throw Error(tlsConfigurationError);
  const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.dev !== original.dev || stat.ino !== original.ino ||
        stat.size <= 0 || stat.size > limit) throw Error(tlsConfigurationError);
    const bytes = Buffer.alloc(stat.size + 1);
    let length = 0;
    while (length < bytes.length) {
      const { bytesRead } = await handle.read(bytes, length, bytes.length - length, length);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length !== stat.size || await realpath(file) !== file) throw Error(tlsConfigurationError);
    return bytes.subarray(0, length);
  } finally { await handle.close(); }
}

export async function remoteListener(address: string, listener: RequestListener, config?: RemoteTlsConfiguration, signal?: AbortSignal) {
  if (!config) return { scheme: 'http', server: httpServer(listener) };
  const directory = path.join(await realpath(path.dirname(config.directory)), path.basename(config.directory));
  const missing = (error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  };
  const marker = directory + '.required';
  const folder = await lstat(directory).catch(missing);
  if (!folder) {
    if (await lstat(marker).catch(missing)) throw Error(tlsConfigurationError);
    return { scheme: 'http', server: httpServer(listener) };
  }
  if (!config.decryptKey) throw Error(tlsConfigurationError);
  // Remember even an incomplete legacy installation before looking inside it.
  const existing = await lstat(marker).catch(missing);
  if (existing && !existing.isFile()) throw Error(tlsConfigurationError);
  if (!existing) {
    const handle = await open(marker, 'wx', 0o600).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'EEXIST') throw error;
    });
    if (handle) await handle.close();
    if (!(await lstat(marker)).isFile()) throw Error(tlsConfigurationError);
  }
  if (!folder.isDirectory() || await realpath(directory) !== directory)
    throw Error(tlsConfigurationError);
  // New installations publish PEM, a NUL delimiter and DPAPI bytes as one atomic file.
  // Old installations have a raw DPAPI file and a detached PEM.
  const identity = await fixedFile(directory, 'private-key.dpapi', 256 * 1024);
  const bundled = identity[0] === 0x2d;
  const split = bundled ? identity.indexOf(0) : -1;
  if (bundled && (split < 1 || split >= 128 * 1024 || split === identity.length - 1)) throw Error(tlsConfigurationError);
  const pem = (bundled ? identity.subarray(0, split) : await fixedFile(directory, 'certificate.pem')).toString('ascii').trim();
  const blocks = pem.match(/-----BEGIN CERTIFICATE-----[A-Za-z0-9+/=\s]+-----END CERTIFICATE-----/g);
  if (!blocks || blocks.join('').replace(/\s/g, '') !== pem.replace(/\s/g, '')) throw Error(tlsConfigurationError);
  const chain = blocks.map(block => new X509Certificate(block));
  const leaf = chain[0];
  const now = Date.now();
  if (leaf.checkIP(address) !== address || chain.some((certificate, i) =>
      Date.parse(certificate.validFrom) > now || Date.parse(certificate.validTo) <= now ||
      (i > 0 && (!chain[i - 1].checkIssued(certificate) || !chain[i - 1].verify(certificate.publicKey)))))
    throw Error(tlsConfigurationError);
  signal?.throwIfAborted();
  const { certificateHashes, pfx } = await config.decryptKey(identity.subarray(split + 1), signal);
  try {
    signal?.throwIfAborted();
    const hashes = chain.map(cert => cert.fingerprint256.replaceAll(':', '').toLowerCase());
    if (certificateHashes[0] !== hashes[0] || certificateHashes.length !== hashes.length ||
        new Set(hashes).size !== hashes.length || !hashes.every(hash => certificateHashes.includes(hash)) ||
        !pfx.length || pfx.length > 64 * 1024) throw Error(tlsConfigurationError);
    return { scheme: 'https', server: httpsServer({ pfx, passphrase: '', minVersion: 'TLSv1.2', handshakeTimeout: 5000 }, listener) };
  } finally { pfx.fill(0); }
}
