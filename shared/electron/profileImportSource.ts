import { BrowserWindow } from 'electron';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { isCloudProfileOwner, profileDirectory } from './accountProfilePaths';
import { profilePartition } from './window';
import { InterviewImageStore, validImageId } from './backend/interview/images';
import { validImagePreview } from './contracts/interviewImages';
import type {
  AccountImportItem,
  SourceRemovalPlan,
  SourceRemovalResult,
} from './contracts/accountData';
import { validMoveKey, validRemovalPlan } from './backend/profileMoveReceipt';
import { validImportDocument } from './contracts/accountData';
import {
  maxRestoreItems,
  packCloudItem,
  restoreChunkSize,
  restoreLimit,
  validRestoreKey,
} from './contracts/restoreData';

type Paths = { userData: string; indexFile: string; devServerUrl?: string };
const invalid = () => Error('来源资料无效或已变化。');

/** Called by account import only after the source owner has been authenticated. */
export async function openProfileImportSource(owner: string, signal: AbortSignal, paths: Paths) {
  signal.throwIfAborted();
  if (owner !== 'local' && !isCloudProfileOwner(owner)) throw invalid();
  const images = new InterviewImageStore(
    path.join(profileDirectory(paths.userData, owner), 'interview-images-v1'),
  );
  const win = new BrowserWindow({
    show: false,
    skipTaskbar: true,
    focusable: false,
    webPreferences: {
      partition: profilePartition(owner),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: false,
      devTools: false,
    },
  });
  const contents = win.webContents;
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-navigate', (event) => event.preventDefault());
  contents.on('will-redirect', (event) => event.preventDefault());
  const url = new URL(paths.devServerUrl ?? pathToFileURL(paths.indexFile).href);
  url.hash = 'profile-import-source';
  const lifetime = new AbortController();
  win.once('closed', () => lifetime.abort());
  contents.once('render-process-gone', () => {
    void close();
  });
  async function bounded<T>(operation: Promise<T>, milliseconds = 30_000): Promise<T> {
    let rejectPending!: () => void;
    const interrupted = new Promise<never>((_, reject) => {
      rejectPending = () => reject(Error('来源资料读取已中止。'));
    });
    const timeout = setTimeout(() => {
      void close();
    }, milliseconds).unref();
    lifetime.signal.addEventListener('abort', rejectPending, { once: true });
    if (lifetime.signal.aborted) rejectPending();
    try {
      return await Promise.race([operation, interrupted]);
    } finally {
      clearTimeout(timeout);
      lifetime.signal.removeEventListener('abort', rejectPending);
    }
  }
  const check = () => {
    signal.throwIfAborted();
    if (contents.isDestroyed() || contents.getURL() !== url.href) throw invalid();
  };
  async function inspect(expression: string) {
    check();
    // Methods are fixed here. Arguments are validated primitives or JSON-encoded receipt data.
    const value: unknown = await contents.executeJavaScript(
      'window.voxcueProfileSource.then(source => ' + expression + ')',
    );
    check();
    return value;
  }
  async function imageBlob(key: string, index: number) {
    const id = key.slice(6);
    if (!validImageId(id)) throw invalid();
    const preview = (await inspect('source.preview(' + index + ')')) ?? (await images.preview(id));
    if (!validImagePreview(preview)) throw invalid();
    const { bytes, extension } = await images.original(id);
    try {
      const sharp = (await import('sharp')).default;
      await sharp(bytes, { limitInputPixels: 64 * 1024 ** 2, failOn: 'warning' })
        .resize(1, 1, { fit: 'fill' }).raw().toBuffer();
    } catch {
      throw Error('来源账号的本机资料无效或不完整。');
    }
    check();
    return packCloudItem(key, Uint8Array.from(bytes), {
      id,
      preview,
      type: extension === 'png' ? 'image/png' : 'image/jpeg',
    });
  }
  let currentImage: { index: number; blob: Blob } | undefined;
  const abort = () => {
    void close();
  };
  async function close() {
    signal.removeEventListener('abort', abort);
    lifetime.abort();
    currentImage = undefined;
    if (!win.isDestroyed()) win.destroy();
    await images.dispose();
  }
  signal.addEventListener('abort', abort, { once: true });
  try {
    await bounded(win.loadURL(url.href));
    const rows = await bounded(inspect('source.items'));
    if (!Array.isArray(rows) || rows.length > maxRestoreItems) throw invalid();
    const indexByKey = new Map<string, number>();
    const imageVersions = new Map<string, string>();
    const items: AccountImportItem[] = [];
    let total = 0;
    for (const row of rows) {
      if (!validRestoreKey(row?.key) || indexByKey.has(row.key)) throw invalid();
      const index = items.length;
      const size = row.size;
      if (row.key.startsWith('image:')) {
        const id = row.key.slice(6);
        if (size !== 0) throw invalid();
        // An unavailable original belongs to this interview only. Read its bytes only if selected.
        const version = validImageId(id) ? await bounded(images.importVersion(id).catch(() => undefined)) : undefined;
        if (version) imageVersions.set(row.key, version);
      }
      if (
        !Number.isSafeInteger(size) ||
        (size < 8 && !(row.key.startsWith('image:') && size === 0)) ||
        size > 64 * 1024 ** 2 ||
        (total += size) > restoreLimit
      )
        throw invalid();
      indexByKey.set(row.key, index);
      if (
        row.imageIds !== undefined &&
        (!row.key.startsWith('record:') ||
          !Array.isArray(row.imageIds) ||
          row.imageIds.length > maxRestoreItems ||
          !row.imageIds.every((id: unknown) => typeof id === 'string' && validRestoreKey('image:' + id)) ||
          new Set(row.imageIds).size !== row.imageIds.length)
      )
        throw invalid();
      items.push({
        key: row.key,
        size,
        ...(row.imageIds?.length ? { imageIds: row.imageIds } : {}),
        ...(row.document && validImportDocument(row.key, row.document) ? { document: row.document } : {}),
        ...(row.key.startsWith('record:') && typeof row.recordTitle === 'string' && row.recordTitle.length <= 80 ? { recordTitle: row.recordTitle } : {}),
      });
    }
    async function selectedImage(key: string, index: number) {
      const id = key.slice(6), expected = imageVersions.get(key);
      if (!expected) throw Error('来源账号的本机资料无效或不完整。');
      if (currentImage?.index !== index) {
        if (await bounded(images.importVersion(id)) !== expected) throw invalid();
        const blob = await bounded(imageBlob(key, index));
        if (await bounded(images.importVersion(id)) !== expected) throw invalid();
        currentImage = { index, blob };
      }
      return currentImage.blob;
    }
    return {
      items,
      close,
      async imageSize(key: string) {
        check();
        const index = indexByKey.get(key);
        if (index === undefined || !key.startsWith('image:')) throw invalid();
        return (await selectedImage(key, index)).size;
      },
      async itemDigest(key: string) {
        const index = indexByKey.get(key);
        if (index === undefined || (!items[index].document && items[index].recordTitle === undefined)) throw invalid();
        const hash = await bounded(inspect('source.itemDigest(' + index + ')'));
        if (typeof hash !== 'string' || !/^[0-9a-f]{64}$/.test(hash)) throw invalid();
        return hash;
      },
      async savedPreviewHash(id: string) {
        check();
        if (!indexByKey.has('image:' + id)) throw invalid();
        // Older interview rows can carry a thumbnail independent of the on-disk preview.
        const preview = await images.preview(id).catch((error) => {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
          return null;
        });
        return preview && createHash('sha256').update(preview).digest('hex');
      },
      async planRemoval(keys: string[]) {
        if (!keys.length || keys.length > maxRestoreItems || !keys.every(validMoveKey))
          throw invalid();
        const plan = (await bounded(
          inspect('source.planRemoval(' + JSON.stringify(keys) + ')'),
          120000,
        )) as SourceRemovalPlan;
        if (!validRemovalPlan(plan)) throw invalid();
        return plan;
      },
      async removeSelected(plan: SourceRemovalPlan) {
        if (!validRemovalPlan(plan)) throw invalid();
        // Electron may replace an uncaught page exception with a generic script error.
        const result = await bounded(
          inspect(
            'source.removeSelected(' +
              JSON.stringify(plan) +
              ',' +
              JSON.stringify(owner) +
              ').catch(e => e?.message === "来源资料已改变，请重新选择。" ? "changed" : null)',
          ),
          120000,
        );
        if (result === 'changed') throw Error('来源资料已改变，请重新选择。');
        if (!result || typeof result !== 'object') throw invalid();
        return result as SourceRemovalResult;
      },
      async read(key: string, offset: number): Promise<Uint8Array> {
        check();
        const index = indexByKey.get(key);
        if (
          index === undefined ||
          !Number.isSafeInteger(offset) ||
          offset < 0
        )
          throw invalid();
        if (key.startsWith('image:')) {
          const blob = await selectedImage(key, index);
          if (offset >= blob.size) throw invalid();
          const bytes = await bounded(blob.slice(offset, offset + restoreChunkSize).arrayBuffer());
          check();
          return new Uint8Array(bytes);
        }
        if (offset >= items[index].size) throw invalid();
        const length = Math.min(restoreChunkSize, items[index].size - offset);
        const encoded = await bounded(inspect('source.read(' + index + ',' + offset + ')'));
        if (typeof encoded !== 'string' || encoded.length !== 4 * Math.ceil(length / 3))
          throw invalid();
        const bytes = Buffer.from(encoded, 'base64');
        if (bytes.length !== length) throw invalid();
        return bytes;
      },
    };
  } catch (error) {
    await close();
    throw error;
  }
}
