import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sileroModel, sileroLicense, validSileroAsset } from '../../shared/scripts/silero-assets.mjs';

const development = path.resolve(import.meta.dirname, '../native/bin');
const localSpeech = path.resolve(import.meta.dirname, '../../shared/local-models/speech');

async function cached(directory, asset) {
  const file = path.join(directory, asset.name);
  try {
    if ((await stat(file)).size !== asset.bytes) return;
    const bytes = await readFile(file);
    if (validSileroAsset(asset, bytes)) return bytes;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

async function download(asset, timeoutMs) {
  const response = await fetch(asset.url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok || !response.body) throw Error(`Cannot download ${asset.name}: HTTP ${response.status}`);
  let length = 0;
  const chunks = [];
  for await (const chunk of response.body) {
    length += chunk.length;
    if (length > asset.bytes) throw Error('Unexpected download size: ' + asset.name);
    chunks.push(chunk);
  }
  const bytes = Buffer.concat(chunks, length);
  if (!validSileroAsset(asset, bytes)) throw Error('Silero asset size or SHA-256 mismatch: ' + asset.name);
  return bytes;
}

/** Prepare both verified files before publishing either. A valid existing install works offline. */
export async function prepareSilero(
  nativeDirectory = development, licenseDirectory = nativeDirectory,
  sources = [process.env.VOXCUE_SILERO_CACHE, localSpeech].filter(Boolean),
  mode = 'required',
) {
  const assets = [];
  for (const [asset, directory] of [[sileroModel, nativeDirectory], [sileroLicense, licenseDirectory]]) {
    if (await cached(directory, asset)) continue;
    let bytes;
    for (const source of sources) {
      bytes = await cached(source, asset);
      if (bytes) break;
    }
    if (!bytes && mode === 'cache-only') return;
    assets.push({ asset, directory, bytes: bytes ?? await download(asset, mode === 'optional' ? 10000 : 60000) });
  }
  for (const { asset, directory, bytes } of assets) {
    await mkdir(directory, { recursive: true });
    const file = path.join(directory, asset.name);
    const temporary = file + '.' + randomUUID() + '.part';
    try {
      await writeFile(temporary, bytes, { flag: 'wx' });
      await rename(temporary, file);
    } finally {
      await rm(temporary, { force: true });
    }
  }
  return nativeDirectory;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const optional = process.argv.includes('--optional-download');
  const cacheOnly = process.argv.includes('--cache-only') || (optional && process.env.npm_config_offline === 'true');
  if (cacheOnly || optional) {
    // Other development capabilities remain available. Legacy Qwen checks its model on selection.
    await prepareSilero(undefined, undefined, undefined, cacheOnly ? 'cache-only' : 'optional').catch(() => {});
  } else await prepareSilero();
}
