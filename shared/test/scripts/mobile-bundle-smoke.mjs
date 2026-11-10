import assert from 'node:assert/strict';
import { request } from 'node:http';
import path from 'node:path';
import workspace from '../../scripts/workspace.mjs';

const { platformRoot, platformRequire } = workspace;
const { createMobileAssets } = platformRequire(
  path.join(platformRoot, 'dist-electron/shared/electron/backend/remoteConnection/assets.js'),
);
const { RemoteConnectionService } = platformRequire(
  path.join(platformRoot, 'dist-electron/shared/electron/backend/remoteConnection/service.js'),
);
const assets = createMobileAssets(path.join(platformRoot, 'dist'));
const entry = await assets.read('/');
assert.ok(entry, 'Build the bundled mobile entry first');
assert.match(entry.contentType, /^text\/html/);
const html = entry.body.toString('utf8');
assert.match(html, /name="viewport"/);
assert.ok(!/尚未提供|尚未构建|connect\.voxcue\.com\.cn/.test(html));
const references = [...html.matchAll(/\b(?:src|href)=["']([^"']+)["']/g)]
  .map((match) => '/' + match[1].replace(/^\.\//, ''));
assert.ok(references.some((value) => value.endsWith('.js')));
assert.ok(references.some((value) => value.endsWith('.css')));
for (const reference of references) assert.ok(await assets.read(reference), reference);
for (const denied of ['/index.html', '/mobile.html', '/.vite/manifest.json', '/package.json'])
  assert.equal(await assets.read(denied), null, denied);

const service = new RemoteConnectionService({
  mobileAssets: assets,
  onState() {},
  onCommand: async (command) => ({ requestId: command.requestId, ok: false, error: 'not-an-interview' }),
});
const get = (origin, pathname, method = 'GET', headers = {}) => new Promise((resolve, reject) => {
  const pending = request(origin + pathname, { method, headers }, (response) => {
    const chunks = [];
    response.on('data', (chunk) => chunks.push(chunk));
    response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks) }));
  });
  pending.on('error', reject);
  pending.setTimeout(5000, () => pending.destroy(Error('Mobile bundle request timed out')));
  pending.end();
});
try {
  const state = await service.start();
  assert.equal(state.status, 'waiting', state.error ?? 'No private interface');
  const origin = state.addresses[0];
  const page = await get(origin, '/');
  assert.equal(page.status, 200);
  assert.equal(page.body.toString(), html);
  assert.match(page.headers['content-security-policy'], /script-src 'self'/);
  assert.match(page.headers['content-security-policy'], /style-src 'self'/);
  assert.ok(page.headers['content-security-policy'].includes(origin.replace('http:', 'ws:')));
  assert.ok(!page.headers['content-security-policy'].includes('unsafe-inline'));
  assert.equal(page.headers['referrer-policy'], 'no-referrer');
  assert.equal(page.headers['cache-control'], 'no-store');
  assert.equal((await get(origin, '/', 'HEAD')).body.length, 0);
  for (const reference of references) {
    const response = await get(origin, reference);
    assert.equal(response.status, 200, reference);
    assert.equal(response.headers['x-content-type-options'], 'nosniff');
  }
  for (const denied of ['/index.html', '/.vite/manifest.json', '/package.json', '/assets/%2e%2e/package.json'])
    assert.equal((await get(origin, denied)).status, 404, denied);
  assert.equal((await get(origin, '/', 'GET', { Origin: 'https://example.invalid' })).status, 403);
  assert.equal(service.state().status, 'waiting', 'Loading the page must not bypass phone approval');
  console.log('PASS: built mobile HTML and assets are served locally with strict CSP; desktop files stay private; page loading does not bypass pairing.');
} finally {
  await service.disconnect();
}
