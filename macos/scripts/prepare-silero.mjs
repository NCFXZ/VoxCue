import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { sileroLicense, sileroModel, validSileroAsset } from '../../shared/scripts/silero-assets.mjs';

const native = path.resolve(import.meta.dirname, '../native/bin');
const speech = path.resolve(import.meta.dirname, '../../shared/local-models/speech');

async function verifiedCopy(directory, asset) {
  const file = path.join(directory, asset.name);
  try {
    if ((await stat(file)).size === asset.bytes) {
      const bytes = await readFile(file);
      if (validSileroAsset(asset, bytes)) return bytes;
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

async function download(asset) {
  const response = await fetch(asset.url, { signal: AbortSignal.timeout(60000) });
  if (!response.ok || !response.body) throw Error(`Cannot download ${asset.name}: HTTP ${response.status}`);
  const chunks = [];
  let length = 0;
  for await (const chunk of response.body) {
    length += chunk.length;
    if (length > asset.bytes) throw Error('Unexpected Silero file size: ' + asset.name);
    chunks.push(chunk);
  }
  const bytes = Buffer.concat(chunks, length);
  if (!validSileroAsset(asset, bytes)) throw Error('Silero size or SHA-256 mismatch: ' + asset.name);
  return bytes;
}

// Keep the compatibility model alongside the audio helper, independently of installed ASR components.
export async function prepareSilero(modelDirectory = native, licenses = modelDirectory) {
  const pending = [];
  for (const [asset, directory] of [[sileroModel, modelDirectory], [sileroLicense, licenses]]) {
    if (await verifiedCopy(directory, asset)) continue;
    let bytes;
    for (const cache of [native, process.env.VOXCUE_SILERO_CACHE, speech]) {
      if (cache && cache !== directory) bytes = await verifiedCopy(cache, asset);
      if (bytes) break;
    }
    pending.push({ asset, directory, bytes: bytes ?? await download(asset) });
  }
  for (const { asset, directory, bytes } of pending) {
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
}
