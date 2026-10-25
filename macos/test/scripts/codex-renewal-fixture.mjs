import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// Synthetic Mac credentials only. The listener never forwards traffic. This helper
// also runs against the final ASAR's Runtime and actual unpacked executable.
export async function verifyCodexRenewal({ Runtime, spawn, root }) {
  assert.equal(process.platform, 'darwin');
  const sockets = new Set();
  let behavior = 'stall';
  let renewals = 0;
  let renewed;
  const proxy = createServer((socket) => {
    sockets.add(socket);
    socket.on('error', () => {});
    socket.once('close', () => sockets.delete(socket));
    socket.once('data', (bytes) => {
      const line = bytes.toString().split('\r\n')[0];
      const local = /^POST /.test(line) && new URL(line.split(' ')[1], 'http://localhost').pathname;
      if (/^CONNECT auth\.openai\.com:443 /i.test(line) || local === '/token') renewals++;
      // Official startup can make unrelated background discovery requests.
      // Keep those stalled; only our explicit synthetic renewal/revoke routes reply.
      if (behavior === 'stall' || !['/token', '/revoke'].includes(local)) return socket.resume();
      const ok = behavior === 'renew';
      const body = JSON.stringify(
        ok
          ? { access_token: renewed, id_token: renewed, refresh_token: 'synthetic-next' }
          : { error: 'invalid_grant', error_description: 'synthetic revoked credential' },
      );
      socket.end(
        `HTTP/1.1 ${ok ? '200 OK' : '400 Bad Request'}\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`,
      );
    });
  });
  await new Promise((resolve) => proxy.listen(0, '127.0.0.1', resolve));
  const port = proxy.address().port;
  const url = `http://127.0.0.1:${port}`;
  const sandbox = (loopback = true) =>
    `(version 1)(allow default)(deny network*)${loopback ? `(allow network-outbound (remote tcp "localhost:${port}"))` : ''}(deny file-read* (subpath ${JSON.stringify(path.join(os.homedir(), 'Library/Keychains'))}))(deny mach-lookup (global-name "com.apple.securityd"))`;
  const token = (seconds, account = 'synthetic-workspace') => {
    const part = (v) => Buffer.from(JSON.stringify(v)).toString('base64url');
    return `${part({ alg: 'none' })}.${part({ sub: 'synthetic', email: 'synthetic@example.test', exp: Math.floor(Date.now() / 1000) + seconds, 'https://api.openai.com/auth': { chatgpt_account_id: account, chatgpt_plan_type: 'plus' } })}.synthetic`;
  };
  let runtime;
  async function session(
    name,
    credential,
    { forced = false, localRenewal = false, strictOffline = false } = {},
  ) {
    await runtime?.stop();
    const directory = path.join(root, name);
    await mkdir(directory, { recursive: true });
    await writeFile(
      path.join(directory, 'auth.json'),
      JSON.stringify({
        auth_mode: 'chatgpt',
        tokens: {
          id_token: credential,
          access_token: credential,
          refresh_token: 'synthetic-refresh',
          account_id: JSON.parse(Buffer.from(credential.split('.')[1], 'base64url'))[
            'https://api.openai.com/auth'
          ].chatgpt_account_id,
        },
        last_refresh: new Date().toISOString(),
      }),
      { mode: 0o600 },
    );
    runtime = new Runtime(directory, (binary, args, options) => {
      const argv = args.map((v) =>
        v === 'cli_auth_credentials_store="keyring"' ? 'cli_auth_credentials_store="file"' : v,
      );
      const child = spawn(
        '/usr/bin/sandbox-exec',
        ['-p', sandbox(!strictOffline), binary, ...argv],
        {
          ...options,
          env: {
            ...options.env,
            CFFIXED_USER_HOME: root,
            HTTP_PROXY: url,
            HTTPS_PROXY: url,
            ALL_PROXY: url,
            NO_PROXY: '',
            http_proxy: url,
            https_proxy: url,
            all_proxy: url,
            no_proxy: '',
            CODEX_REVOKE_TOKEN_URL_OVERRIDE: `${url}/revoke`,
            ...(localRenewal ? { CODEX_REFRESH_TOKEN_URL_OVERRIDE: `${url}/token` } : {}),
          },
        },
      );
      if (forced) {
        const write = child.stdin.write;
        child.stdin.write = function (bytes, ...rest) {
          const message = JSON.parse(bytes.toString());
          if (message.method === 'getAuthStatus') message.params.refreshToken = true;
          return write.call(this, JSON.stringify(message) + '\n', ...rest);
        };
      }
      return child;
    });
    return runtime;
  }
  async function deadline(promise, ms) {
    let timer;
    try {
      return await Promise.race([
        promise,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(Error('synthetic deadline')), ms);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
  const results = {};
  try {
    // Prove the same profile rejects every other destination before connecting.
    const probe = spawn(
      '/usr/bin/sandbox-exec',
      [
        '-p',
        sandbox(),
        process.execPath,
        '-e',
        `
      const net=require('node:net');let done=0;
      for(const [host,port] of [['192.0.2.1',443],['127.0.0.1',${port === 65535 ? 65534 : port + 1}]]){
        const s=net.connect(port,host);s.on('connect',()=>process.exit(2));
        s.on('error',e=>{if(!['EPERM','EACCES'].includes(e.code))process.exit(3);if(++done===2)process.exit(0);});
      }setTimeout(()=>process.exit(4),1500);
    `,
      ],
      { stdio: 'ignore', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } },
    );
    assert.equal(
      await new Promise((resolve, reject) => {
        probe.once('exit', resolve);
        probe.once('error', reject);
      }),
      0,
      'Only the owned proxy port may be reached',
    );
    const valid = token(3600);
    await session('valid', valid);
    let started = performance.now();
    assert.equal((await deadline(runtime.access(), 5000)).token, valid);
    results.onDemandColdMs = Math.round(performance.now() - started);
    for (let i = 0; i < 3; i++) assert.equal((await deadline(runtime.access(), 1000)).token, valid);
    assert.equal(renewals, 0, 'Valid and repeated reads never request token renewal');
    await session('strict-offline', valid, { strictOffline: true });
    started = performance.now();
    assert.equal((await deadline(runtime.access(), 5000)).token, valid);
    results.strictOfflineMs = Math.round(performance.now() - started);
    assert.equal(renewals, 0, 'Strictly offline validity is checked separately from proxy latency');
    await session('forced', valid, { forced: true });
    started = performance.now();
    await assert.rejects(deadline(runtime.access(), 5500), /synthetic deadline/);
    results.forcedStillWaitingMs = Math.round(performance.now() - started);
    assert.ok(renewals > 0, 'The old forced path actually reached the stalled renewal endpoint');
    await runtime.stop();

    behavior = 'renew';
    renewed = token(7200);
    for (const [name, expiry] of [
      ['near-expiry', 120],
      ['expired', -60],
    ]) {
      const before = renewals;
      await session(name, token(expiry), { localRenewal: true });
      assert.equal((await deadline(runtime.access(), 5000)).token, renewed);
      assert.equal(renewals, before + 1, `${name} renews through the official runtime`);
      assert.equal((await runtime.access()).token, renewed);
      assert.equal(renewals, before + 1, 'A fresh read reuses the official renewed credential');
    }
    behavior = 'reject';
    for (const [name, expiry] of [
      ['revoked-near', 120],
      ['revoked-expired', -60],
    ]) {
      await session(name, token(expiry), { localRenewal: true });
      await assert.rejects(deadline(runtime.access(), 5000), /暂不可用/);
    }

    behavior = 'reject';
    await session('logout', valid);
    assert.equal((await runtime.access()).token, valid);
    await runtime.logout();
    await assert.rejects(runtime.access(), /暂不可用/);
    behavior = 'stall';
    const switched = token(3600, 'synthetic-other-workspace');
    await session('switched', switched);
    assert.equal((await runtime.access()).chatgptAccountId, 'synthetic-other-workspace');
    await session('late', valid, { forced: true });
    const before = renewals;
    const late = runtime.access();
    const rejected = assert.rejects(late, /暂不可用/);
    await deadline(
      (async () => {
        while (renewals === before) await new Promise((r) => setTimeout(r, 10));
      })(),
      3000,
    );
    await runtime.stop();
    await rejected;
    console.log(
      'PASS: Mac official renewal matrix ' +
        JSON.stringify({
          ...results,
          repeatedReads: 3,
          nearExpiry: 'renewed',
          expired: 'renewed',
          revoked: 'rejected',
          logout: 'cleared',
          accountSwitch: 'isolated',
          lateResult: 'rejected',
          externalAndOtherPorts: 'denied',
        }),
    );
    return results;
  } finally {
    await runtime?.stop();
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => proxy.close(resolve));
  }
}
