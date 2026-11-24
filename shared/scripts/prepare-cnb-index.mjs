import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import path from 'node:path';
import workspace from './workspace.mjs';

// No credentials or mutations: publish this file only after the mirror job
// succeeds. Existing platform entries remain until their replacement is complete.
const require = workspace.platformRequire;
const backend = path.join(workspace.platformRoot, 'dist-electron/shared/electron/backend');
const { releaseCandidates, compareVersions, manifestFile, macDeltaFile } = require(
  path.join(backend, 'updates/releases.js'),
);
const { cnbReleaseIndex, downloadUrl, readPublicText } = require(
  path.join(backend, 'downloads.js'),
);
const yaml = createRequire(require.resolve('electron-updater/package.json'))('js-yaml');
const tag = process.argv.find((arg) => arg.startsWith('--tag='))?.slice(6);
assert.ok(
  tag && /^[A-Za-z0-9][A-Za-z0-9._+-]{0,199}$/.test(tag),
  'Required: --tag=v<stable version>',
);
const signal = AbortSignal.timeout(60 * 60 * 1000);
const text = (url, limit) => readPublicText(fetch, new URL(url), signal, limit);
const indexResponse = await fetch(cnbReleaseIndex, {
  credentials: 'omit',
  cache: 'no-store',
  signal,
});
assert.ok(
  indexResponse.ok || indexResponse.status === 404,
  'Cannot read the current public CNB index',
);
let index = { schemaVersion: 1, releases: [] };
if (indexResponse.ok) {
  // Re-read with the same bounded reader used by the client.
  void indexResponse.body?.cancel();
  index = JSON.parse(await text(cnbReleaseIndex, 2 * 1024 * 1024));
} else void indexResponse.body?.cancel();
assert.ok(
  index.schemaVersion === 1 && Array.isArray(index.releases) && index.releases.length < 999,
  'Invalid existing index',
);
for (const page of Array.from(
  { length: Math.ceil(index.releases.length / 100) },
  (_, page) => page,
))
  for (const target of ['windows-x64', 'macos-arm64'])
    releaseCandidates(index.releases.slice(page * 100, page * 100 + 100), target);
const release = JSON.parse(
  await text(
    `https://api.github.com/repos/NCFXZ/VoxCue/releases/tags/${encodeURIComponent(tag)}`,
    8 * 1024 * 1024,
  ),
);
const ready = new Map();
for (const target of ['windows-x64', 'macos-arm64']) {
  const candidates = releaseCandidates([release], target);
  assert.ok(candidates.length <= 1, 'Ambiguous platform release');
  if (!candidates.length) continue;
  const candidate = candidates[0];
  assert.ok(
    compareVersions(candidate.version, '1.3.3') >= 0,
    'Formal CNB installers start at 1.3.3',
  );
  const raw = await text(downloadUrl('github', tag, candidate.manifest), 128 * 1024);
  assert.equal(
    await text(downloadUrl('cnb', tag, candidate.manifest), 128 * 1024),
    raw,
    'Mirror manifest differs from GitHub',
  );
  const info = yaml.load(raw);
  const selected = manifestFile(info, candidate);
  const delta = macDeltaFile(info, candidate);
  const response = await fetch(downloadUrl('cnb', tag, selected.url), {
    credentials: 'omit',
    signal,
  });
  assert.ok(response.ok && response.body, 'Mirror installer missing');
  let bytes = 0;
  const hash = createHash('sha512');
  for await (const chunk of response.body) {
    bytes += chunk.length;
    assert.ok(bytes <= selected.size, 'Oversized mirror installer');
    hash.update(chunk);
  }
  assert.equal(bytes, selected.size);
  assert.equal(hash.digest('base64'), selected.sha512, 'Mirror installer checksum differs');
  const names = [candidate.manifest, selected.url];
  if (delta) {
    for (const source of ['github', 'cnb']) {
      const plan = await text(downloadUrl(source, tag, delta.url), delta.size);
      assert.equal(Buffer.byteLength(plan), delta.size);
      assert.equal(createHash('sha512').update(plan).digest('base64'), delta.sha512,
        'Differential plan differs from the manifest');
    }
    names.push(delta.url);
  }
  if (target === 'windows-x64') {
    const name = selected.url + '.blockmap';
    const maps = await Promise.all(
      ['github', 'cnb'].map(async (source) => {
        const result = await fetch(downloadUrl(source, tag, name), { credentials: 'omit', signal });
        assert.ok(
          result.ok &&
            result.body &&
            Number(result.headers.get('content-length')) <= 2 * 1024 * 1024,
          'Missing/oversized blockmap',
        );
        const chunks = [];
        let bytes = 0;
        for await (const chunk of result.body) {
          bytes += chunk.length;
          assert.ok(bytes <= 2 * 1024 * 1024);
          chunks.push(chunk);
        }
        return Buffer.concat(chunks);
      }),
    );
    assert.deepEqual(maps[0], maps[1], 'Mirror blockmap differs from GitHub');
    names.push(name);
  }
  for (const name of names)
    ready.set(
      name,
      release.assets.find((asset) => asset.name === name),
    );
  console.log(`Verified complete ${target} ${candidate.version}`);
}
assert.ok(ready.size, 'No complete stable platform release');
const entry = {
  draft: false,
  prerelease: false,
  tag_name: tag,
  published_at: release.published_at,
  assets: [...ready.values()].map(({ name, size }) => ({ name, size, state: 'uploaded' })),
};
index.releases = [...index.releases.filter((release) => release.tag_name !== tag), entry];
const directory = await mkdtemp(path.join(tmpdir(), 'voxcue-cnb-index-'));
const file = path.join(directory, 'releases.json');
await writeFile(file, JSON.stringify(index, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ file, tag, releases: index.releases.length }));
