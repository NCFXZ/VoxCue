import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import workspace from '../../../shared/scripts/workspace.mjs';

// Published, unchanged arm64 ZIPs. These pins authenticate the old bytes before
// staging or extracting them; a rebuilt old version is not an upgrade baseline.
// Sources: NCFXZ/VoxCue-releases v1.1.1 and NCFXZ/VoxCue v1.2.2 through v1.3.3.
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
  '1.3.1': {
    size: 609184237,
    sha256: 'd6069b37461bbac30085580d00471cf9c312182e4604c8f1fb59d8cc63bc549e',
  },
  '1.3.2': {
    size: 625430056,
    sha256: '339d9486fe052630a38fc31225f9b02956b06cad7468c2dc9d00a36b81002e00',
  },
  '1.3.3': {
    size: 625462195,
    sha256: 'ea80725bb940314b1696e88c0953621dd269938afe4215fc7360a6ca6477b9a6',
  },
};
export const upgradeBaselineVersions = Object.freeze(Object.keys(baselines));

export function upgradeBaselinesFor(args) {
  const choices = args.filter(arg => arg.startsWith('--from='));
  if (!choices.length) return [...upgradeBaselineVersions].reverse();
  const versions = choices.map(choice => choice.slice('--from='.length));
  assert.ok(new Set(versions).size === versions.length &&
    versions.every(version => Object.hasOwn(baselines, version)), 'Select distinct authenticated upgrade baselines');
  return versions;
}

export async function verifiedUpgradeArchive(fromVersion) {
  assert.ok(
    typeof fromVersion === 'string' && Object.hasOwn(baselines, fromVersion),
    'Unsupported Mac upgrade baseline',
  );
  const archives = process.env.VOXCUE_TEST_UPGRADE_ARCHIVES ?? path.join(workspace.platformRoot, 'release');
  assert.ok(path.isAbsolute(archives), 'Upgrade archive directory must be absolute');
  const file = path.join(
    archives,
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
