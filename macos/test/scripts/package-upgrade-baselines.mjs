import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import workspace from '../../../shared/scripts/workspace.mjs';

// Published, unchanged arm64 ZIPs. These pins authenticate the old bytes before
// staging or extracting them; a rebuilt old version is not an upgrade baseline.
// Sources: NCFXZ/VoxCue-releases v1.1.1 and NCFXZ/VoxCue v1.2.2 / v1.2.3.
const baselines = {
  '1.1.1': {
    size: 608058445,
    sha256: '9b567b8d7311424374dfb00e1a91af2ec109fed28d2da678f52329f99c4c982d',
  },
  '1.2.2': {
    size: 608213832,
    sha256: '718cc42a12ffc688ebaa44c398cbfa29d582f4a01d60ae766f183fc8363c7eeb',
  },
  '1.2.3': {
    size: 608206152,
    sha256: '903aa5de074248562fd9bee33e762306d55bc459d01332771abaa33431e22c99',
  },
};
export const upgradeBaselineVersions = Object.freeze(Object.keys(baselines));

export function upgradeBaselinesFor(args) {
  const choices = args.filter(arg => arg.startsWith('--from='));
  if (!choices.length) return [...upgradeBaselineVersions].reverse();
  const version = choices[0].slice('--from='.length);
  assert.ok(args.includes('--upgrades-only') && choices.length === 1 &&
    Object.hasOwn(baselines, version), 'Select one authenticated baseline with --upgrades-only');
  return [version];
}

export async function verifiedUpgradeArchive(fromVersion) {
  assert.ok(
    typeof fromVersion === 'string' && Object.hasOwn(baselines, fromVersion),
    'Unsupported Mac upgrade baseline',
  );
  const file = path.join(
    workspace.platformRoot,
    'release',
    fromVersion,
    `VoxCue-${fromVersion}-arm64.zip`,
  );
  const info = await lstat(file);
  assert.ok(info.isFile() && !info.isSymbolicLink(), 'Upgrade ZIP must be a regular file');
  assert.equal(await realpath(file), file, 'Upgrade ZIP must not use a redirected path');
  assert.equal(info.size, baselines[fromVersion].size, 'Published upgrade ZIP size changed');
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  assert.equal(hash.digest('hex'), baselines[fromVersion].sha256, 'Published upgrade ZIP changed');
  return file;
}
