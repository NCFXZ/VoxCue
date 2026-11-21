import { execFileSync } from 'node:child_process';
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { get } from 'node:https';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { WebSocket, WebSocketServer } from 'ws';
import { remoteListener } from '../../../shared/electron/backend/remoteConnection/tls';
import { createRemoteTls } from '../../electron/remoteTls';

vi.mock('electron', () => ({ dialog: {}, app: {} }));
const trees: string[] = [];
afterEach(async () => {
  for (const tree of trees.splice(0)) await rm(tree, { recursive: true, force: true });
});
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'voxcue-test-tls-'));
  trees.push(root);
  const ca = path.join(root, 'ca.pem'), pfx = path.join(root, 'synthetic.pfx');
  const openssl = (...args: string[]) => execFileSync('/usr/bin/openssl', args, { cwd: root, stdio: 'pipe' });
  await writeFile(path.join(root, 'extensions.cnf'), [
    '[req]', 'distinguished_name = dn', '[dn]', '[issuer]', 'basicConstraints=critical,CA:TRUE',
    'keyUsage=critical,keyCertSign,cRLSign', '[server]', 'basicConstraints=critical,CA:FALSE',
    'extendedKeyUsage=serverAuth', 'subjectAltName=IP:192.168.15.20,IP:127.0.0.1',
  ].join('\n'));
  openssl('req','-x509','-newkey','rsa:2048','-nodes','-keyout','ca-key.pem','-out',ca,
    '-subj','/CN=VoxCue synthetic test CA','-days','1','-config','extensions.cnf','-extensions','issuer');
  openssl('req','-new','-newkey','rsa:2048','-nodes','-keyout','leaf-key.pem','-out','leaf.csr',
    '-subj','/CN=VoxCue synthetic test server');
  openssl('x509','-req','-in','leaf.csr','-CA',ca,'-CAkey','ca-key.pem','-CAcreateserial','-days','1',
    '-extfile','extensions.cnf','-extensions','server','-out','leaf.pem');
  openssl('pkcs12','-export','-inkey','leaf-key.pem','-in','leaf.pem','-certfile',ca,
    '-out',pfx,'-passout','pass:synthetic-fixture');
  const directory = path.join(root, 'remote-connection-tls');
  const osKey = randomBytes(32);
  const encryption = {
    encrypt(text: string) {
      const nonce = randomBytes(12), cipher = createCipheriv('aes-256-gcm', osKey, nonce);
      return Buffer.concat([nonce, cipher.update(text), cipher.final(), cipher.getAuthTag()]);
    },
    async decrypt(bytes: Buffer) {
      const decipher = createDecipheriv('aes-256-gcm', osKey, bytes.subarray(0, 12));
      decipher.setAuthTag(bytes.subarray(-16));
      return Buffer.concat([decipher.update(bytes.subarray(12, -16)), decipher.final()]).toString();
    },
  };
  return { directory, root, adapter: createRemoteTls(directory, encryption), encryption,
    ca: await readFile(ca), pfx: await readFile(pfx) };
}
const address = '192.168.15.20';
it('validates a replacement, binds its encrypted chain and keeps TLS required across restarts', async () => {
  const { root, directory, adapter, encryption, pfx } = await fixture();
  const listen = (ip = address) => remoteListener(ip, () => {}, adapter.configuration);
  expect((await listen()).scheme).toBe('http');
  expect(await adapter.checkRecords(encryption.decrypt)).toBe(false);
  await expect(adapter.provision(pfx, 'wrong', address, () => {})).rejects.toThrow();
  expect((await listen()).scheme).toBe('http');
  await adapter.provision(pfx, 'synthetic-fixture', address, () => {});
  expect(await adapter.checkRecords(encryption.decrypt)).toBe(true);
  const file = path.join(directory, 'identity.keychain');
  const original = await readFile(file);
  expect(original.includes('synthetic-fixture')).toBe(false);
  await expect(adapter.provision(pfx, 'synthetic-fixture', '192.168.15.21', () => {})).rejects.toThrow();
  expect(await readFile(file)).toEqual(original);
  expect((await listen()).scheme).toBe('https');
  await expect(listen('192.168.15.21')).rejects.toThrow();
  const altered = JSON.parse(await encryption.decrypt(original));
  altered.hashes.reverse();
  await writeFile(file, encryption.encrypt(JSON.stringify(altered)));
  await expect(listen()).rejects.toThrow();
  await expect(adapter.checkRecords(encryption.decrypt)).rejects.toThrow();
  await writeFile(file, original);
  await rename(directory, path.join(root, 'original'));
  await expect(listen()).rejects.toThrow();
  await mkdir(directory);
  await symlink(path.join(root, 'original', 'identity.keychain'), file);
  await expect(listen()).rejects.toThrow();
  await expect(adapter.provision(pfx, 'synthetic-fixture', address, () => {})).rejects.toThrow();
});

it('serves HTTPS and WSS with the imported chain trusted by a loopback client', async () => {
  const { adapter, pfx, ca } = await fixture();
  await adapter.provision(pfx, 'synthetic-fixture', address, () => {});
  const { server, scheme } = await remoteListener(address, (_req, res) => res.end('synthetic page'), adapter.configuration);
  expect(scheme).toBe('https');
  const wss = new WebSocketServer({ server });
  let socket: WebSocket | undefined;
  try {
    const ready = once(server, 'listening');
    server.listen(0, '127.0.0.1');
    await ready;
    const endpoint = server.address();
    if (!endpoint || typeof endpoint === 'string') throw Error('Missing fixture endpoint');
    const host = '127.0.0.1:' + endpoint.port;
    const result = await new Promise<string>((resolve, reject) => {
      get('https://' + host, { ca }, res => {
        let text = '';
        res.setEncoding('utf8').on('data', chunk => { text += chunk; }).on('end', () => resolve(text));
      }).on('error', reject);
    });
    expect(result).toBe('synthetic page');
    wss.once('connection', client => client.send('synthetic snapshot'));
    socket = new WebSocket('wss://' + host, { ca });
    const [message] = await once(socket, 'message');
    expect(message.toString()).toBe('synthetic snapshot');
  } finally {
    socket?.terminate();
    wss.close();
    if (server.listening) await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
