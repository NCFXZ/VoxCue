import { execFile } from 'node:child_process';
import { X509Certificate } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, mkdtemp, readdir, readFile, rename, rmdir, rm, unlink, writeFile } from 'node:fs/promises';
import { request } from 'node:https';
import { networkInterfaces, tmpdir } from 'node:os';
import path from 'node:path';
import type { TLSSocket } from 'node:tls';
import { promisify } from 'node:util';
import { WebSocket } from 'ws';
import { afterEach, expect, it, vi } from 'vitest';
import { REMOTE_PROTOCOL_VERSION } from '../../../shared/electron/contracts/remoteConnection';
import { RemoteConnectionService, selectPrivateIPv4 } from '../../../shared/electron/backend/remoteConnection/service';
import { remoteListener } from '../../../shared/electron/backend/remoteConnection/tls';
import { decryptRemoteTlsKey } from '../../electron/remoteTlsKey';

const trees: string[] = [];
const services: RemoteConnectionService[] = [];
const sockets: WebSocket[] = [];
afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.terminate();
  await Promise.all(services.splice(0).map(service => service.disconnect()));
  for (const dir of trees.splice(0)) {
    if (path.dirname(dir) !== path.resolve(tmpdir()) || !path.basename(dir).startsWith('voxcue-remote-tls-'))
      throw Error('Unexpected fixture path');
    await rm(dir, { recursive: true, force: true });
  }
});
async function fixture() {
  const root = await mkdtemp(path.join(path.resolve(tmpdir()), 'voxcue-remote-tls-'));
  trees.push(root);
  return { root, directory: path.join(root, 'remote-connection-tls') };
}
const windowsPowerShell = path.join(process.env.SystemRoot ?? '', 'System32/WindowsPowerShell/v1.0/powershell.exe');
// Test-only identity from memory. The PFX stays in this test's temporary directory.
async function provision(root: string, address: string, options: { expired?: boolean; withIssuer?: boolean; listenAddress?: string; lockCurrent?: boolean } = {}) {
  await promisify(execFile)(windowsPowerShell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'RemoteSigned', '-Command', `
    $ErrorActionPreference = 'Stop'
    $rsa = [Security.Cryptography.RSACng]::new(2048)
    $req = [Security.Cryptography.X509Certificates.CertificateRequest]::new('CN=Synthetic VoxCue', $rsa,
        [Security.Cryptography.HashAlgorithmName]::SHA256, [Security.Cryptography.RSASignaturePadding]::Pkcs1)
    $san = [Security.Cryptography.X509Certificates.SubjectAlternativeNameBuilder]::new()
    $san.AddIpAddress([Net.IPAddress]::Parse($env:VOXCUE_FIXTURE_IP))
    $req.CertificateExtensions.Add($san.Build())
    $now = [DateTimeOffset]::UtcNow
    $identities = [Security.Cryptography.X509Certificates.X509Certificate2Collection]::new()
    if ($env:VOXCUE_FIXTURE_CA -eq '1') {
      $caKey = [Security.Cryptography.RSACng]::new(2048)
      $caReq = [Security.Cryptography.X509Certificates.CertificateRequest]::new('CN=Synthetic trusted root', $caKey,
        [Security.Cryptography.HashAlgorithmName]::SHA256, [Security.Cryptography.RSASignaturePadding]::Pkcs1)
      $caReq.CertificateExtensions.Add([Security.Cryptography.X509Certificates.X509BasicConstraintsExtension]::new($true,$false,0,$true))
      $issuer = $caReq.CreateSelfSigned($now.AddDays(-1), $now.AddDays(1))
      $publicLeaf = $req.Create($issuer, $now.AddHours(-2), $now.AddHours(1), [guid]::NewGuid().ToByteArray())
      $cert = [Security.Cryptography.X509Certificates.RSACertificateExtensions]::CopyWithPrivateKey($publicLeaf, $rsa)
      [void]$identities.Add([Security.Cryptography.X509Certificates.X509Certificate2]::new($issuer.RawData))
      $publicLeaf.Dispose()
      $issuer.Dispose()
      $caKey.Dispose()
    } else {
      $cert = $req.CreateSelfSigned($now.AddHours(-2), $now.AddHours([int]$env:VOXCUE_FIXTURE_EXPIRY))
    }
    [void]$identities.Add($cert)
    $pfx = Join-Path $env:VOXCUE_FIXTURE_DIR 'fixture.pfx'
    $password = [Guid]::NewGuid().ToString()
    [IO.File]::WriteAllBytes($pfx, $identities.Export('Pfx', $password))
    $secure = [System.Net.NetworkCredential]::new('', $password).SecurePassword
    $lock = $null
    if ($env:VOXCUE_FIXTURE_LOCK -eq '1') {
      $lock = [IO.File]::Open((Join-Path $env:VOXCUE_FIXTURE_DIR 'remote-connection-tls/private-key.dpapi'), 'Open', 'Read', 'Read')
    }
    try { & $env:VOXCUE_FIXTURE_SCRIPT -PfxPath $pfx -UserDataDirectory $env:VOXCUE_FIXTURE_DIR -Password $secure -ListenAddress $env:VOXCUE_FIXTURE_LISTEN }
    finally { if ($lock) { $lock.Dispose() } }
    foreach ($identity in $identities) { $identity.Dispose() }
    $rsa.Dispose()
  `], { windowsHide: true, timeout: 15000, env: {
    ...process.env, PSModulePath: path.join(path.dirname(windowsPowerShell), 'Modules'),
    VOXCUE_FIXTURE_IP: address, VOXCUE_FIXTURE_DIR: root, VOXCUE_FIXTURE_LISTEN: options.listenAddress ?? address,
    VOXCUE_FIXTURE_EXPIRY: options.expired ? '-1' : '1',
    VOXCUE_FIXTURE_CA: options.withIssuer ? '1' : '0', VOXCUE_FIXTURE_LOCK: options.lockCurrent ? '1' : '0',
    VOXCUE_FIXTURE_SCRIPT: path.resolve('scripts/configure-remote-tls.ps1'),
  } });
}
function service(directory: string) {
  const remote = new RemoteConnectionService({ onState: () => {}, onCommand: vi.fn(),
    tls: { directory, decryptKey: decryptRemoteTlsKey } });
  services.push(remote);
  return remote;
}

it('serves the QR page and authenticated-origin websocket over trusted TLS using the provisioned DPAPI identity', async () => {
  const { root, directory } = await fixture();
  await provision(root, selectPrivateIPv4(networkInterfaces())!, { withIssuer: true });
  const remote = service(directory);
  const state = await remote.start();
  expect(state.status, state.error ?? '').toBe('waiting');
  const pairing = new URL(remote.pairing().url);
  expect(pairing.protocol).toBe('https:');
  const identityFile = path.join(directory, 'private-key.dpapi');
  const identity = await readFile(identityFile);
  const delimiter = identity.indexOf(0);
  const chain = identity.toString('ascii', 0, delimiter).match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g)!;
  expect(chain).toHaveLength(2);
  const ca = Buffer.from(chain[1]);
  const get = (trust: Buffer | []) => new Promise<string>((resolve, reject) => {
    const out = request(pairing.origin, { ca: trust }, res => {
      res.resume();
      resolve(String(res.headers['content-security-policy']));
    });
    out.once('error', reject);
    out.end();
  });
  await expect(get([])).rejects.toThrow();
  expect(await get(ca)).toContain(pairing.origin.replace(/^https/, 'wss'));
  const token = new URLSearchParams(pairing.hash.slice(1)).get('pair');
  const pending = await new Promise<{ id: string; code: string }>((resolve, reject) => {
    const out = request(pairing.origin + '/pair', {
      ca, method: 'POST', headers: { Origin: pairing.origin, 'Content-Type': 'application/json' },
    }, res => {
      const chunks: Buffer[] = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        if (res.statusCode !== 200) reject(Error('HTTPS pairing failed'));
        else resolve(JSON.parse(Buffer.concat(chunks).toString()));
      });
    });
    out.once('error', reject);
    out.end(JSON.stringify({ token, name: 'Temporary phone' }));
  });
  const socket = new WebSocket(pairing.origin.replace(/^https/, 'wss') + '/connect', { ca, origin: pairing.origin });
  sockets.push(socket);
  await once(socket, 'open');
  const confirmation = once(socket, 'message');
  socket.send(JSON.stringify({ type: 'authenticate', protocolVersion: REMOTE_PROTOCOL_VERSION, pendingId: pending.id }));
  expect(JSON.parse((await confirmation)[0].toString())).toMatchObject({ type: 'pending', code: pending.code });
  const approval = once(socket, 'message');
  remote.approve(pending.id);
  expect(JSON.parse((await approval)[0].toString())).toMatchObject({ type: 'paired', token: expect.any(String) });
  await remote.disconnect();
  const onState = vi.fn();
  let entered!: () => void;
  const opening = new Promise<void>(resolve => { entered = resolve; });
  const starting = new RemoteConnectionService({
    onState, onCommand: vi.fn(), tls: { directory, decryptKey: (_ciphertext, signal) => {
      entered();
      return new Promise((_resolve, reject) => signal!.addEventListener('abort', () => reject(Error('fixture stopped'))));
    } },
  });
  services.push(starting);
  const pendingStart = starting.start();
  await opening;
  await starting.disconnect();
  await pendingStart;
  expect(starting.state()).toMatchObject({ status: 'off', addresses: [], error: null });
  expect(onState.mock.calls.every(([state]) => state.status === 'off')).toBe(true);
  await writeFile(identityFile, Buffer.concat([Buffer.from(chain[0]), identity.subarray(delimiter)]));
  expect(await remote.start()).toMatchObject({ status: 'error', addresses: [] });
}, 25000);

it('keeps HTTP for first use and refuses to downgrade after even an incomplete configuration was seen', async () => {
  const { root, directory } = await fixture();
  const remote = service(directory);
  expect((await remote.start()).addresses[0]).toMatch(/^http:\/\//);
  await remote.disconnect();
  await mkdir(directory);
  expect(await remote.start()).toMatchObject({ status: 'error', addresses: [] });
  await rmdir(directory);
  expect(await remote.start()).toMatchObject({ status: 'error', addresses: [] });
});

it('retains the active identity after failed renewals and atomically switches a valid replacement', async () => {
  const { root, directory } = await fixture();
  const address = selectPrivateIPv4(networkInterfaces())!;
  const config = { directory, decryptKey: decryptRemoteTlsKey };
  await provision(root, address);
  const identityFile = path.join(directory, 'private-key.dpapi');
  const first = await readFile(identityFile);
  const remote = service(directory);
  const moved = directory + '.saved';
  await rename(directory, moved);
  expect(await remote.start()).toMatchObject({ status: 'error', addresses: [] });
  await rename(moved, directory);
  await expect(provision(root, address, { expired: true })).rejects.toThrow();
  await expect(provision(root, address, { listenAddress: address === '192.168.56.20' ? '10.0.0.1' : '192.168.56.20' })).rejects.toThrow();
  await expect(provision(root, address, { lockCurrent: true })).rejects.toThrow();
  expect(await readdir(directory)).toEqual(['private-key.dpapi']);
  expect(await readFile(identityFile)).toEqual(first);
  expect((await remote.start()).addresses[0]).toMatch(/^https:\/\//);
  await remote.disconnect();
  await provision(root, address, { withIssuer: true });
  const next = await readFile(identityFile);
  const chain = next.toString('ascii', 0, next.indexOf(0)).match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g)!;
  const fingerprint = new X509Certificate(chain[0]).fingerprint256;
  expect(fingerprint).not.toBe(new X509Certificate(first.subarray(0, first.indexOf(0))).fingerprint256);
  const origin = (await remote.start()).addresses[0];
  const presented = await new Promise<string>((resolve, reject) => {
    const req = request(origin, { ca: chain[1] }, res => {
      resolve((res.socket as TLSSocket).getPeerCertificate().fingerprint256);
      res.resume();
    });
    req.once('error', reject);
    req.end();
  });
  expect(presented).toBe(fingerprint);
  await remote.disconnect();
  const future = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 2 * 24 * 60 * 60 * 1000);
  try {
    await expect(remoteListener(address, () => {}, config)).rejects.toThrow();
  } finally { future.mockRestore(); }
  await expect(remoteListener('127.0.0.1', () => {}, config)).rejects.toThrow();
  await writeFile(identityFile, Buffer.concat([next.subarray(0, next.indexOf(0) + 1), first.subarray(first.indexOf(0) + 1)]));
  const failed = await remote.start();
  expect(failed).toMatchObject({ status: 'error', addresses: [] });
  expect(failed.error).not.toContain(directory);
}, 30000);

it('reads a legacy certificate pair, persists its TLS requirement, and renews it in place', async () => {
  const { root, directory } = await fixture();
  const address = selectPrivateIPv4(networkInterfaces())!;
  await provision(root, address);
  const key = path.join(directory, 'private-key.dpapi');
  const bundle = await readFile(key);
  const delimiter = bundle.indexOf(0);
  await writeFile(path.join(directory, 'certificate.pem'), bundle.subarray(0, delimiter));
  await writeFile(key, bundle.subarray(delimiter + 1));
  await unlink(directory + '.required');
  const remote = service(directory);
  expect((await remote.start()).addresses[0]).toMatch(/^https:\/\//);
  await remote.disconnect();
  const moved = directory + '.saved';
  await rename(directory, moved);
  expect(await remote.start()).toMatchObject({ status: 'error', addresses: [] });
  await rename(moved, directory);
  await provision(root, address);
  expect((await remote.start()).addresses[0]).toMatch(/^https:\/\//);
}, 25000);
