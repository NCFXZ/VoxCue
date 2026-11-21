export const restoreLimit = 512 * 1024 ** 2;
export const maxRestoreItems = 8192;
export const restoreChunkSize = 1024 ** 2;
export const validRestoreKey = (key: unknown): key is string =>
  typeof key === 'string' &&
  /^(?:profile:main|resume:main|(?:base|file|record|image):[\w-]{1,100})$/.test(key);

export function packCloudItem(key: string, payload: BlobPart, metadata?: unknown): Blob {
  const json = new TextEncoder().encode(
    JSON.stringify({ v: 1, key, ...(metadata ? { metadata } : {}) }),
  );
  const head = new Uint8Array(8);
  head.set([86, 67, 83, 49]);
  new DataView(head.buffer).setUint32(4, json.length);
  return new Blob([head, json, payload]);
}
