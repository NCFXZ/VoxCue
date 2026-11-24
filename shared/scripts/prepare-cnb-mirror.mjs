import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import path from 'node:path';
import workspace from './workspace.mjs';

// Preparation only. Upload the generated public workflow to the release-only
// CNB repository; its official attachments plugin uses CNB's own CI identity.
const require = workspace.platformRequire;
const compiled = path.join(workspace.platformRoot, 'dist-electron/shared/electron/backend');
const { packagesFor } = require(path.join(compiled, 'components/catalog.js'));
const { releaseCandidates, compareVersions } = require(path.join(compiled, 'updates/releases.js'));
const { downloadUrl, readPublicText } = require(path.join(compiled, 'downloads.js'));
const yaml = createRequire(require.resolve('electron-updater/package.json'))('js-yaml');
const components = process.argv.includes('--components');
const tag = components
  ? 'models-v1.0.0'
  : process.argv.find((arg) => arg.startsWith('--tag='))?.slice(6);
assert.ok(
  tag && /^[A-Za-z0-9][A-Za-z0-9._+-]{0,199}$/.test(tag),
  'Use --components or --tag=v<stable version>',
);
const assets = new Map();
if (components) {
  for (const [platform, arch] of [
    ['win32', 'x64'],
    ['darwin', 'arm64'],
  ])
    for (const pkg of packagesFor(platform, arch))
      for (const part of pkg.parts ?? [pkg]) {
        assert.equal(part.tag, tag, 'Split separate component tags into separate mirror jobs');
        assets.set(part.asset, {
          name: part.asset,
          bytes: part.bytes,
          algorithm: 'sha256',
          digest: part.sha256,
        });
      }
} else {
  const release = JSON.parse(
    await readPublicText(
      fetch,
      new URL(`https://api.github.com/repos/NCFXZ/VoxCue/releases/tags/${encodeURIComponent(tag)}`),
      AbortSignal.timeout(45000),
      8 * 1024 * 1024,
    ),
  );
  for (const target of ['windows-x64', 'macos-arm64']) {
    for (const candidate of releaseCandidates([release], target)) {
      assert.ok(
        compareVersions(candidate.version, '1.3.3') >= 0,
        'Formal CNB installers start at 1.3.3',
      );
      const raw = await readPublicText(
        fetch,
        downloadUrl('github', tag, candidate.manifest),
        AbortSignal.timeout(45000),
        128 * 1024,
      );
      const info = yaml.load(raw);
      const { manifestFile } = require(path.join(compiled, 'updates/releases.js'));
      const file = manifestFile(info, candidate);
      assets.set(candidate.manifest, {
        name: candidate.manifest,
        bytes: Buffer.byteLength(raw),
        algorithm: 'sha256',
        digest: createHash('sha256').update(raw).digest('hex'),
      });
      assets.set(file.url, {
        name: file.url,
        bytes: file.size,
        algorithm: 'sha512',
        digest: Buffer.from(file.sha512, 'base64').toString('hex'),
      });
      for (const asset of release.assets.filter((asset) =>
        target === 'windows-x64'
          ? asset.name === file.url + '.blockmap'
          : asset.name === `VoxCue-${candidate.version}-arm64.dmg`,
      )) {
        let digest = asset.digest?.match(/^sha256:([a-f0-9]{64})$/)?.[1];
        if (!digest && asset.size < 2 * 1024 * 1024) {
          const response = await fetch(downloadUrl('github', tag, asset.name), {
            credentials: 'omit',
            signal: AbortSignal.timeout(45000),
          });
          assert.ok(response.ok);
          const bytes = Buffer.from(await response.arrayBuffer());
          assert.equal(bytes.length, asset.size);
          digest = createHash('sha256').update(bytes).digest('hex');
        }
        assert.ok(digest, `Missing trusted public digest for ${asset.name}`);
        assets.set(asset.name, {
          name: asset.name,
          bytes: asset.size,
          algorithm: 'sha256',
          digest,
        });
      }
    }
  }
}
assert.ok(assets.size, 'No complete stable platform release');
for (const asset of assets.values()) downloadUrl('github', tag, asset.name);
const program = `
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
const assets = ${JSON.stringify([...assets.values()])};
await mkdir('artifacts', { recursive: true });
for (const asset of assets) {
  console.log('Fetching ' + asset.name);
  const controller = new AbortController();
  let timer;
  const advancing = () => { clearTimeout(timer); timer = setTimeout(() => controller.abort(Error('Public artifact download stalled')), 45000); };
  advancing();
  try {
  const url = ${JSON.stringify(`https://github.com/NCFXZ/VoxCue/releases/download/${encodeURIComponent(tag)}/`)} + encodeURIComponent(asset.name);
  const response = await fetch(url, { credentials: 'omit', signal: controller.signal });
  if (!response.ok || !response.body) throw Error('Public source unavailable: ' + asset.name);
  const hash = createHash(asset.algorithm); let bytes = 0, checkpoint = 0;
  await pipeline(Readable.fromWeb(response.body), new Transform({ transform(chunk, _, done) {
    advancing(); bytes += chunk.length; hash.update(chunk);
    if (bytes - checkpoint >= 32 * 1024 ** 2) { checkpoint = bytes; console.log(asset.name + ': ' + bytes + '/' + asset.bytes); }
    done(bytes > asset.bytes ? Error('Oversized public artifact') : null, chunk);
  }}), createWriteStream('artifacts/' + asset.name, { flags: 'wx' }));
  if (bytes !== asset.bytes || hash.digest('hex') !== asset.digest) throw Error('Artifact checksum mismatch: ' + asset.name);
  console.log('Verified ' + asset.name + ' (' + bytes + ' bytes)');
  } finally { clearTimeout(timer); }
}
`;
// CNB's command runner need not provide stdin; one shell-quoted command avoids
// depending on a persistent shell's here-document handling.
const script =
  "node --input-type=module -e '" + program.replaceAll('\n', ' ').replaceAll("'", "'\\''") + "'";
const workflow = {
  main: {
    push: [
      {
        docker: { image: 'node:24' },
        runner: { cpus: 1 },
        stages: [
          { name: 'Download and verify original public artifacts', script },
          {
            name: 'Upload original artifacts to CNB',
            image: 'cnbcool/attachments:latest',
            settings: { tag, attachments: [...assets.keys()].map((name) => 'artifacts/' + name) },
          },
        ],
      },
    ],
  },
};
const directory = await mkdtemp(path.join(tmpdir(), 'voxcue-cnb-publish-'));
const file = path.join(directory, '.cnb.yml');
await writeFile(file, JSON.stringify(workflow, null, 2) + '\n', { flag: 'wx' });
console.log(
  JSON.stringify({
    file,
    tag,
    files: assets.size,
    bytes: [...assets.values()].reduce((sum, asset) => sum + asset.bytes, 0),
  }),
);
