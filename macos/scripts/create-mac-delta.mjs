import { createHash, sign } from 'node:crypto';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import workspace from '../../shared/scripts/workspace.mjs';

const require = workspace.platformRequire;
const AdmZip = require('adm-zip');
const yaml = createRequire(require.resolve('electron-updater/package.json'))('js-yaml');
const compiled = path.join(workspace.platformRoot, 'dist-electron');
const { macArchiveByteLimit, macDeltaCopyLimit, macDeltaName, manifestByteLimit, compareVersions } = require(
  path.join(compiled, 'shared/electron/backend/updates/releases.js'),
);
const { signedMacUpdate, macDeltaPayload } = require(path.join(compiled, 'macos/electron/updates/manifest.js'));
const { verifyDownload } = require(path.join(compiled, 'macos/electron/updates/download.js'));

const minimumCopyBytes = 128 * 1024;

// ZIP local headers can change timestamps. A binary's new code signature may
// also change its compressed tail while most compressed bytes remain identical.
async function payloads(file) {
  if ((await stat(file)).size > macArchiveByteLimit) throw Error('Mac update archive is too large');
  const bytes = await readFile(file);
  const entries = new AdmZip(bytes).getEntries();
  return entries.flatMap(({ header, entryName }) => {
    const size = header.compressedSize;
    // Small entries are cheaper to fetch with adjacent headers than as more ranges.
    if (size < minimumCopyBytes) return [];
    header.loadLocalHeaderFromBinary(bytes);
    const offset = header.realDataOffset;
    if (!Number.isSafeInteger(offset) || offset < 0 || offset + size > bytes.length)
      throw Error('ZIP payload exceeds the archive');
    return [{ name: entryName, offset, data: bytes.subarray(offset, offset + size) }];
  });
}

function commonPrefix(base, target) {
  const length = Math.min(base.length, target.length);
  let start = 0;
  while (start < length) {
    const end = Math.min(start + minimumCopyBytes, length);
    if (!base.subarray(start, end).equals(target.subarray(start, end))) {
      while (start < end && base[start] === target[start]) start++;
      return start;
    }
    start = end;
  }
  return start;
}

export async function macDeltaPlan(baseArchive, targetArchive) {
  const byName = new Map((await payloads(baseArchive)).map(entry => [entry.name, entry]));
  const copies = (await payloads(targetArchive)).flatMap(entry => {
    const base = byName.get(entry.name);
    if (!base) return [];
    const length = commonPrefix(base.data, entry.data);
    return length >= minimumCopyBytes ? [[entry.offset, base.offset, length]] : [];
  });
  // Prefer the largest savings over issuing a request for every small gap.
  const plan = copies.sort((a, b) => b[2] - a[2]).slice(0, macDeltaCopyLimit).sort((a, b) => a[0] - b[0]);
  const bytes = Buffer.from(JSON.stringify(plan) + '\n');
  const savings = plan.reduce((total, copy) => total + copy[2], 0);
  if (bytes.length > manifestByteLimit || savings <= bytes.length)
    throw Error('No usable Mac differential between these ZIPs');
  return bytes;
}

export async function createMacDelta(baseDirectory, targetArchive, target, key, publicKey) {
  const metadata = yaml.load(await readFile(path.join(baseDirectory, 'latest-mac.yml'), 'utf8'));
  const version = metadata?.version;
  if (typeof version !== 'string' || compareVersions(version, target.version) >= 0)
    throw Error('The Mac differential baseline must be an earlier stable release');
  const name = `VoxCue-${version}-arm64.zip`;
  const baseline = path.join(baseDirectory, name);
  const size = (await stat(baseline)).size;
  if (size > macArchiveByteLimit) throw Error('Mac differential baseline is too large');
  const old = signedMacUpdate(metadata, { version, manifest: 'latest-mac.yml', binary: { name, size } }, publicKey);
  await verifyDownload(baseline, old);
  const plan = await macDeltaPlan(baseline, targetArchive);
  const delta = {
    url: macDeltaName(target.url),
    size: plan.length,
    sha512: createHash('sha512').update(plan).digest('base64'),
    base: { version, size, sha512: old.sha512 },
  };
  await writeFile(path.join(path.dirname(targetArchive), delta.url), plan, { flag: 'wx' });
  return { ...delta, signature: sign(null, macDeltaPayload(target, delta), key).toString('base64') };
}
