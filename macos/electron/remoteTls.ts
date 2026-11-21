import { dialog, type BrowserWindow } from 'electron';
import { spawn } from 'node:child_process';
import { createPrivateKey, X509Certificate } from 'node:crypto';
import { lstat, mkdir, realpath } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import path from 'node:path';
import { createSecureContext } from 'node:tls';
import type { CredentialEncryption } from '../../shared/electron/backend/auth/storage';
import { atomicFile } from '../../shared/electron/backend/atomicFile';
import { isPrivateIPv4, selectPrivateIPv4 } from '../../shared/electron/backend/remoteConnection/protocol';
import { readTlsFile, requireRemoteTls, tlsConfigurationError } from '../../shared/electron/backend/remoteConnection/tls';
import { nativeInput } from './apiKeyPrompt';

const invalid = () => Error(tlsConfigurationError);
const filename = 'identity.keychain';
const maxPfx = 64 * 1024;
const missing = (error: NodeJS.ErrnoException) => {
  if (error.code !== 'ENOENT') throw error;
};

// LibreSSL reads both inputs from anonymous pipes. Neither the password nor the private
// key enters a command line, log, environment variable or temporary plaintext file.
async function pkcs12(pfx: Buffer, password: string, signal?: AbortSignal): Promise<Buffer> {
  if (!pfx.length || pfx.length > maxPfx || /[\0\r\n]/.test(password) || Buffer.byteLength(password) > 1024)
    throw invalid();
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn('/usr/bin/openssl', ['pkcs12', '-nodes', '-passin', 'fd:3'], {
      stdio: ['pipe', 'pipe', 'ignore', 'pipe'], env: { PATH: '/usr/bin:/bin' }, signal,
    });
    const output: Buffer[] = [];
    let length = 0;
    const stop = () => child.kill('SIGKILL');
    const timer = setTimeout(stop, 10_000);
    child.on('error', () => reject(invalid()));
    child.stdout!.on('data', (chunk: Buffer) => {
      length += chunk.length;
      if (length <= 256 * 1024) output.push(chunk);
      else { chunk.fill(0); stop(); }
    });
    child.once('close', code => {
      clearTimeout(timer);
      if (code === 0 && length && length <= 256 * 1024 && !signal?.aborted)
        resolve(Buffer.concat(output));
      else reject(invalid());
      for (const chunk of output) chunk.fill(0);
    });
    const pass = child.stdio[3] as NodeJS.WritableStream;
    pass.on('error', () => {});
    child.stdin!.on('error', () => {});
    pass.end(password + '\n');
    child.stdin!.end(pfx);
  });
}

async function identity(pfx: Buffer, password: string, address?: string, signal?: AbortSignal) {
  const decoded = await pkcs12(pfx, password, signal);
  try {
    const pem = decoded.toString('ascii');
    const keys = pem.match(/-----BEGIN (?:RSA |EC |DSA )?PRIVATE KEY-----[\s\S]+?-----END (?:RSA |EC |DSA )?PRIVATE KEY-----/g);
    const blocks = pem.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g);
    if (keys?.length !== 1 || !blocks?.length || blocks.length > 16) throw invalid();
    const key = createPrivateKey(keys[0]);
    const certificates = blocks.map(block => new X509Certificate(block));
    const leaves = certificates.filter(cert => cert.checkPrivateKey(key));
    if (leaves.length !== 1 || leaves[0].ca) throw invalid();
    const chain = [leaves[0]];
    const unused = new Set(certificates.filter(cert => cert !== leaves[0]));
    while (unused.size) {
      const child = chain[chain.length - 1];
      const parents = [...unused].filter(parent => parent.ca && child.checkIssued(parent) && child.verify(parent.publicKey));
      if (parents.length !== 1) throw invalid();
      chain.push(parents[0]);
      unused.delete(parents[0]);
    }
    const hashes = chain.map(cert => cert.fingerprint256);
    const last = chain[chain.length - 1];
    if (new Set(hashes).size !== hashes.length || (last.subject === last.issuer && !last.verify(last.publicKey))) throw invalid();
    const leaf = chain[0];
    if (leaf.keyUsage && !leaf.keyUsage.includes('1.3.6.1.5.5.7.3.1') && !leaf.keyUsage.includes('2.5.29.37.0'))
      throw invalid();
    if (address !== undefined && (!isPrivateIPv4(address) || leaf.checkIP(address) !== address || chain.some(cert =>
      Date.parse(cert.validFrom) > Date.now() || Date.parse(cert.validTo) <= Date.now()))) throw invalid();
    const cert = chain.map(item => item.toString()).join('\n');
    createSecureContext({ cert, key: keys[0], minVersion: 'TLSv1.2' });
    return { hashes, cert, key: Buffer.from(keys[0]) };
  } finally { decoded.fill(0); }
}

async function decode(encrypted: Buffer, decrypt: (bytes: Buffer) => string | Promise<string>, address?: string, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const record = JSON.parse(await decrypt(encrypted));
  if (record?.version !== 1 || typeof record.password !== 'string' || typeof record.pfx !== 'string' ||
      record.pfx.length > Math.ceil(maxPfx / 3) * 4 || !Array.isArray(record.hashes)) throw invalid();
  const bytes = Buffer.from(record.pfx, 'base64');
  try {
    if (bytes.toString('base64') !== record.pfx) throw invalid();
    const value = await identity(bytes, record.password, address, signal);
    if (JSON.stringify(record.hashes) === JSON.stringify(value.hashes)) return value;
    value.key.fill(0);
    throw invalid();
  } finally { bytes.fill(0); }
}

export function createRemoteTls(directory: string, encryption: CredentialEncryption) {
  const configuration = {
    directory,
    loadIdentity: (bytes: Buffer, address: string, signal?: AbortSignal) =>
      decode(bytes, value => encryption.decrypt(value), address, signal),
  };
  async function canonicalDirectory() {
    return path.join(await realpath(path.dirname(directory)), path.basename(directory));
  }
  return {
    configuration,
    async checkRecords(decrypt: (value: Buffer) => Promise<string>) {
      const folder = await canonicalDirectory();
      const stat = await lstat(folder).catch(missing);
      if (!stat) {
        if (await lstat(folder + '.required').catch(missing)) throw invalid();
        return false;
      }
      if (!stat.isDirectory() || await realpath(folder) !== folder) throw invalid();
      const value = await decode(await readTlsFile(folder, filename, 256 * 1024), decrypt);
      value.key.fill(0);
      return true;
    },
    async provision(pfx: Buffer, password: string, address: string, checkOwner: () => void) {
      checkOwner();
      const candidate = await identity(pfx, password, address);
      candidate.key.fill(0);
      checkOwner();
      const encrypted = await encryption.encrypt(JSON.stringify({
        version: 1, pfx: pfx.toString('base64'), password, hashes: candidate.hashes,
      }));
      // Validate the complete encrypted replacement with the same loader before publishing.
      const verified = await configuration.loadIdentity(encrypted, address);
      verified.key.fill(0);
      const folder = await canonicalDirectory();
      const previous = await lstat(folder).catch(missing);
      if (previous && (!previous.isDirectory() || await realpath(folder) !== folder)) throw invalid();
      const target = path.join(folder, filename);
      const old = await lstat(target).catch(missing);
      if (old && (!old.isFile() || await realpath(target) !== target)) throw invalid();
      checkOwner();
      await requireRemoteTls(folder + '.required');
      await mkdir(folder, { recursive: true, mode: 0o700 });
      if (await realpath(folder) !== folder) throw invalid();
      checkOwner();
      await atomicFile(target, encrypted);
    },
    async configure(owner: BrowserWindow, english: boolean, checkOwner: () => void) {
      const address = selectPrivateIPv4(networkInterfaces());
      if (!address) throw invalid();
      const selected = await dialog.showOpenDialog(owner, {
        properties: ['openFile'], filters: [{ name: 'PKCS#12', extensions: ['pfx', 'p12'] }],
      });
      if (selected.canceled || selected.filePaths.length !== 1) return false;
      checkOwner();
      const file = selected.filePaths[0];
      const parent = await realpath(path.dirname(file));
      const pfx = await readTlsFile(parent, path.basename(file), maxPfx);
      try {
        const password = await new Promise<string | null>((resolve, reject) => {
          checkOwner();
          const closed = () => reject(invalid());
          owner.once('closed', closed);
          try {
            nativeInput().certificatePassword(owner.getNativeWindowHandle(), english, value => {
              owner.off('closed', closed);
              resolve(value);
            });
          } catch (error) { owner.off('closed', closed); reject(error); }
        });
        if (password === null) return false;
        await this.provision(pfx, password, address, checkOwner);
        return true;
      } finally { pfx.fill(0); }
    },
  };
}
