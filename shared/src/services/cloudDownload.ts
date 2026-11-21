import {
  CLOUD_CHUNK_BYTES,
  CLOUD_ITEM_MAX_BYTES,
  type CloudManifest,
  type CloudResource,
  type CloudSyncCall,
} from '../../electron/contracts/cloudSync';
import { digestCloudBlob } from './cloudData';

type ReadCall = Extract<CloudSyncCall, { action: 'read' | 'manifest' }>;
export type DownloadRequest = (
  call:
    | Omit<Extract<ReadCall, { action: 'manifest' }>, 'userId'>
    | Omit<Extract<ReadCall, { action: 'read' }>, 'userId'>,
) => Promise<unknown>;

export async function downloadManifest(remote: CloudResource, call: DownloadRequest) {
  const manifest = (await call({
    action: 'manifest',
    id: remote.id,
    version: remote.headVersion!,
  })) as CloudManifest;
  if (
    !manifest ||
    manifest.bytes !== remote.bytes ||
    manifest.sha256 !== remote.sha256 ||
    manifest.chunkBytes !== CLOUD_CHUNK_BYTES ||
    !Number.isSafeInteger(manifest.bytes) ||
    !manifest.bytes ||
    manifest.bytes > CLOUD_ITEM_MAX_BYTES ||
    !Array.isArray(manifest.parts) ||
    manifest.parts.length !== Math.ceil(manifest.bytes / CLOUD_CHUNK_BYTES)
  )
    throw Error('云端清单无效。');
  return manifest;
}

export async function downloadPart(
  remote: CloudResource,
  manifest: CloudManifest,
  index: number,
  call: DownloadRequest,
) {
  const bytes = await call({
    action: 'read',
    id: remote.id,
    version: remote.headVersion!,
    index,
  });
  if (
    !(bytes instanceof Uint8Array) ||
    bytes.byteLength !== Math.min(CLOUD_CHUNK_BYTES, manifest.bytes - index * CLOUD_CHUNK_BYTES) ||
    manifest.parts[index]?.index !== index ||
    (await digestCloudBlob(new Blob([new Uint8Array(bytes)]))) !== manifest.parts[index].sha256
  )
    throw Error('云端分块校验失败，本地数据已保留。');
  return new Uint8Array(bytes);
}

export async function downloadCloudBlob(
  remote: CloudResource,
  call: DownloadRequest,
  cached?: { manifest: CloudManifest; first: Uint8Array<ArrayBuffer> },
) {
  const manifest = cached?.manifest ?? (await downloadManifest(remote, call));
  const chunks: BlobPart[] = [];
  for (let index = 0; index < manifest.parts.length; index++)
    chunks.push(
      index === 0 && cached ? cached.first : await downloadPart(remote, manifest, index, call),
    );
  const blob = new Blob(chunks);
  if ((await digestCloudBlob(blob)) !== manifest.sha256) throw Error('云端数据完整性校验失败。');
  return blob;
}
