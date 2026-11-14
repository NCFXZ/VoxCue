const assert = require('node:assert/strict');
const { once } = require('node:events');
const { execFileSync } = require('node:child_process');
const http = require('node:http');
const https = require('node:https');
const path = require('node:path');
const { app, session } = require('electron');
const { accountFetch } = require('./accountNetwork.cjs');

const profile = path.join(__dirname, 'profile');
app.setPath('userData', profile);
app.setPath('sessionData', profile);
app.commandLine.appendSwitch('disable-background-networking');
app.commandLine.appendSwitch('host-resolver-rules', 'MAP * ~NOTFOUND, EXCLUDE 127.0.0.1');

// Create a new in-memory IP certificate. No Windows certificate store is opened.
function selfSignedPfx() {
  const command = `
    $ErrorActionPreference = 'Stop'
    $rsaKey = [Security.Cryptography.RSA]::Create(2048)
    $request = [Security.Cryptography.X509Certificates.CertificateRequest]::new(
      'CN=127.0.0.1', $rsaKey, [Security.Cryptography.HashAlgorithmName]::SHA256,
      [Security.Cryptography.RSASignaturePadding]::Pkcs1)
    $names = [Security.Cryptography.X509Certificates.SubjectAlternativeNameBuilder]::new()
    $names.AddIpAddress([Net.IPAddress]::Loopback)
    $request.CertificateExtensions.Add($names.Build())
    $now = [DateTimeOffset]::UtcNow
    $certificate = $request.CreateSelfSigned($now.AddHours(-1), $now.AddHours(1))
    [Convert]::ToBase64String($certificate.Export('Pfx', 'synthetic'))
    $certificate.Dispose()
    $rsaKey.Dispose()
  `;
  const powershell = path.join(
    process.env.SystemRoot,
    'System32/WindowsPowerShell/v1.0/powershell.exe',
  );
  return Buffer.from(
    execFileSync(powershell, ['-NoProfile', '-NonInteractive', '-Command', command], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 10000,
    }).trim(),
    'base64',
  );
}

async function listen(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return server.address().port;
}

async function run() {
  assert.equal(app.getPath('sessionData'), profile);
  const browser = session.defaultSession;
  const origin = 'http://account-network.invalid';
  const received = [];
  let pendingRequest;
  const pending = new Promise((resolve) => {
    pendingRequest = resolve;
  });
  const server = http.createServer(async (req, res) => {
    const body = [];
    for await (const part of req) body.push(part);
    received.push({ path: req.url, headers: req.headers, body: Buffer.concat(body).toString() });
    if (req.url === '/wait') return pendingRequest();
    if (req.url === '/redirect') res.writeHead(302, { location: origin + '/redirect-target' });
    else
      res.writeHead(200, {
        'cache-control': 'public, max-age=3600',
        'set-cookie': 'fromResponse=synthetic; Path=/',
      });
    res.end(String(received.length));
  });
  const destination = await listen(server);
  const routed = [];
  const proxy = http.createServer((req, res) => {
    const url = new URL(req.url);
    if (url.origin !== origin) {
      res.writeHead(403).end();
      return;
    }
    routed.push(url.pathname);
    const upstream = http.request(
      {
        hostname: '127.0.0.1',
        port: destination,
        method: req.method,
        path: url.pathname,
        headers: req.headers,
      },
      (reply) => {
        res.writeHead(reply.statusCode, reply.headers);
        reply.pipe(res);
      },
    );
    upstream.on('error', () => res.destroy());
    res.once('close', () => upstream.destroy());
    req.pipe(upstream);
  });
  proxy.on('connect', (_request, socket) => socket.destroy());
  const proxyPort = await listen(proxy);
  let tlsRequests = 0;
  const tlsServer = https.createServer(
    { pfx: selfSignedPfx(), passphrase: 'synthetic' },
    (_req, res) => {
      tlsRequests++;
      res.end();
    },
  );
  const tlsOrigin = 'https://127.0.0.1:' + (await listen(tlsServer));
  try {
    browser.webRequest.onBeforeRequest((details, done) =>
      done({ cancel: ![origin, tlsOrigin].includes(new URL(details.url).origin) }),
    );
    await browser.setProxy({
      mode: 'fixed_servers',
      proxyRules: '127.0.0.1:' + proxyPort,
      proxyBypassRules: '127.0.0.1',
    });
    assert.equal(await browser.resolveProxy(origin), 'PROXY 127.0.0.1:' + proxyPort);
    assert.equal(await browser.resolveProxy(tlsOrigin), 'DIRECT');
    await browser.cookies.set({ url: origin, name: 'browserOnly', value: 'synthetic' });
    const response = await accountFetch(new URL('/identity', origin), {
      method: 'POST',
      headers: { authorization: 'Bearer synthetic' },
      body: 'synthetic-body',
      credentials: 'include',
      cache: 'force-cache',
      referrer: origin + '/private',
      referrerPolicy: 'unsafe-url',
    });
    assert.equal(await response.text(), '1');
    assert.equal(received[0].headers.authorization, 'Bearer synthetic');
    assert.equal(received[0].body, 'synthetic-body');
    assert.equal(received[0].headers.cookie, undefined);
    assert.equal(received[0].headers.referer, undefined);
    assert.deepEqual(
      (await browser.cookies.get({ url: origin })).map((item) => item.name),
      ['browserOnly'],
    );
    for (const value of ['2', '3'])
      assert.equal(await (await accountFetch(origin + '/cache')).text(), value);
    await assert.rejects(
      accountFetch(origin + '/redirect', {
        redirect: 'follow',
        headers: { authorization: 'Bearer synthetic' },
      }),
    );
    const abort = new AbortController();
    const cancelled = accountFetch(origin + '/wait', { signal: abort.signal });
    await pending;
    abort.abort();
    await assert.rejects(cancelled, { name: 'AbortError' });
    assert.deepEqual(routed, ['/identity', '/cache', '/cache', '/redirect', '/wait']);
    assert.deepEqual(
      received.map((item) => item.path),
      routed,
    );
    await assert.rejects(accountFetch(tlsOrigin), /ERR_CERT_AUTHORITY_INVALID/);
    assert.equal(tlsRequests, 0);
    console.log(
      'Windows account transport passed: proxy, explicit authorization, cookie/referrer isolation, cache, redirect, cancellation and untrusted TLS.',
    );
  } finally {
    for (const owned of [server, proxy, tlsServer]) {
      owned.closeAllConnections();
      owned.close();
    }
  }
}

app
  .whenReady()
  .then(run)
  .then(() => app.exit(0))
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
