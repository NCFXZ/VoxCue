import { testRoot } from '../../../shared/test/scripts/test-workspace.mjs';
import workspace from '../../../shared/scripts/workspace.mjs';
import { buildMacIcons } from '../../scripts/build-icons.mjs';
import { mkdir, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';

const sharp = workspace.platformRequire('sharp');
await buildMacIcons();
const directory = path.join(testRoot, 'app-icon');
const iconset = path.join(directory, 'fixture.iconset');
await mkdir(iconset, { recursive: true });
const source = path.join(directory, 'transparent-artwork.png');
// A transparent fixture detects any extra white plate or corner mask.
await sharp(
  Buffer.from(
    '<svg width="1024" height="1024"><rect x="476" y="308" width="72" height="420" rx="36" fill="black"/></svg>',
  ),
)
  .png()
  .toFile(source);
const output = path.join(directory, 'icon.png');
const run = spawnSync(
  path.join(workspace.platformRoot, '.tools/icon-builder'),
  [source, output, iconset],
  { encoding: 'utf8' },
);
assert.equal(run.status, 0, run.stderr);

async function pixels(file) {
  const { data, info } = await sharp(file)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return {
    info,
    at: (x, y) => [...data.subarray((y * info.width + x) * 4, (y * info.width + x) * 4 + 4)],
  };
}
const fixture = await pixels(output);
assert.equal(fixture.info.width, 1024);
assert.equal(fixture.info.height, 1024);
for (const [x, y] of [
  [0, 512],
  [95, 512],
  [96, 96],
  [96, 256],
  [512, 96],
  [96, 512],
  [128, 216],
  [212, 128],
  [400, 400],
  [512, 928],
])
  assert.equal(fixture.at(x, y)[3], 0, `Expected original transparency at ${x},${y}`);
for (const [x, y] of [
  [512, 400],
  [512, 512],
  [512, 650],
])
  assert.deepEqual(fixture.at(x, y), [0, 0, 0, 255], `Expected original artwork at ${x},${y}`);
for (const size of [16, 32, 128, 256, 512]) {
  for (const scale of [1, 2]) {
    const file = path.join(iconset, `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`);
    const image = await pixels(file);
    assert.equal(image.info.width, size * scale);
    assert.equal(image.info.height, size * scale);
    assert.equal(image.at(0, 0)[3], 0);
    assert.ok(image.at(Math.floor((size * scale) / 2), Math.floor((size * scale) / 2))[3] > 0);
  }
}
const actual = await pixels(path.join(workspace.platformRoot, 'public/voxcue.png'));
assert.equal(actual.at(512, 512)[3], 255);
assert.equal(actual.at(96, 96)[3], 0);
const sourceBytes = await readFile(path.join(workspace.sharedRoot, 'public/voxcue-source.png'));
assert.equal(
  createHash('sha256').update(sourceBytes).digest('hex'),
  '00dad880a587b123f225be5978eac719591025d128f30bdb9b39b460000da0ef',
);
const icns = await readFile(path.join(workspace.platformRoot, 'public/voxcue.icns'));
assert.equal(icns.subarray(0, 4).toString(), 'icns');
assert.equal(icns.readUInt32BE(4), icns.length);
console.log(
  'PASS: supplied contour/alpha preserved without an added plate or mask, transparent margins, ten icon representations and ICNS; temporary fixtures cleaned at exit.',
);
