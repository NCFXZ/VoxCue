import { lstat, mkdir, readFile, realpath, unlink } from 'node:fs/promises';
import path from 'node:path';
import { profileDirectory, profileDirectoryName } from '../accountProfilePaths';
import { withinImportItemLimit, type SourceRemovalPlan } from '../contracts/accountData';
import { CLOUD_RECORD_MAX_IMAGES } from '../contracts/cloudSync';
import { profileFields } from '../contracts/profile';
import { recordingRecordId } from '../contracts/recordings';
import { maxRestoreItems, validRestoreKey } from '../contracts/restoreData';
import { atomicFile } from './atomicFile';

const fieldKeys = new Set([...profileFields, 'role'].map(field => 'profile:' + field));
export const validMoveKey = (key: unknown): key is string =>
  typeof key === 'string' &&
  (fieldKeys.has(key) ||
    (validRestoreKey(key) && /^(?:base:|record:|resume:)/.test(key)));
export const validHash = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const validDoc = (id: unknown) => typeof id === 'string' && validRestoreKey('file:' + id);
const invalid = () => Error('本机迁移清理记录无效。');
export function validRemovalPlan(plan: SourceRemovalPlan) {
  if (
    !Array.isArray(plan?.items) ||
    !plan.items.length ||
    !withinImportItemLimit(plan.items, item => item?.key) ||
    new Set(plan.items.map((i) => i?.key)).size !== plan.items.length
  )
    return false;
  const bases = new Set(plan.items.map((i) => i?.key));
  return plan.items.every(
    (i) =>
      i &&
      validHash(i.hash) &&
      ((validRestoreKey(i.key) && i.key.startsWith('file:')) || validMoveKey(i.key)) &&
      (i.key.startsWith('file:')
        ? validDoc(i.baseId) && bases.has('base:' + i.baseId)
        : i.baseId === undefined) &&
      (i.key === 'resume:main' ? validDoc(i.documentId) : i.documentId === undefined) &&
      (i.imageIds === undefined ||
        (i.key.startsWith('record:') &&
          Array.isArray(i.imageIds) &&
          i.imageIds.length <= CLOUD_RECORD_MAX_IMAGES &&
          i.imageIds.every(recordingRecordId) &&
          new Set(i.imageIds).size === i.imageIds.length)),
  );
}
export interface MovedClip {
  recordId: string;
  id: string;
  startedAt: number;
  hash: string;
  sourceHash?: string;
}
export interface MovedImage {
  id: string;
  hash: string;
  previewHash: string | null;
}
export interface ProfileMoveReceipt {
  version: 1;
  target: string;
  source: string;
  plan: SourceRemovalPlan;
  clips: MovedClip[];
  images: MovedImage[];
}
export class ProfileMoveReceipts {
  constructor(private userData: string) {}
  private async file(target: string, source: string, create = false) {
    if (target === source) throw invalid();
    const root = await realpath(this.userData);
    const dir = profileDirectory(root, target);
    if (create) {
      for (const part of [path.dirname(dir), dir]) {
        await mkdir(part, { mode: 0o700 }).catch((e) => {
          if (e.code !== 'EEXIST') throw e;
        });
        if ((await realpath(part)) !== part) throw invalid();
      }
    } else if ((await realpath(dir)) !== dir) throw invalid();
    return path.join(dir, 'move-from-' + profileDirectoryName(source) + '.json');
  }
  async read(target: string, source: string): Promise<ProfileMoveReceipt | undefined> {
    try {
      const file = await this.file(target, source);
      const stat = await lstat(file);
      if (!stat.isFile() || stat.size > 8 * 1024 ** 2) throw invalid();
      const r: ProfileMoveReceipt = JSON.parse(await readFile(file, 'utf8'));
      if (
        r.version !== 1 ||
        r.target !== target ||
        r.source !== source ||
        !validRemovalPlan(r.plan) ||
        !Array.isArray(r.clips) ||
        r.clips.length > maxRestoreItems ||
        !Array.isArray(r.images) ||
        r.images.length > maxRestoreItems
      )
        throw invalid();
      const records = new Set(
        r.plan.items.filter((i) => i.key.startsWith('record:')).map((i) => i.key.slice(7)),
      );
      const images = new Set(r.plan.items.flatMap((i) => i.imageIds ?? []));
      if (
        !r.clips.every(
          (c) =>
            c &&
            records.has(c.recordId) &&
            recordingRecordId(c.recordId) &&
            recordingRecordId(c.id) &&
            Number.isSafeInteger(c.startedAt) &&
            validHash(c.hash) && (c.sourceHash === undefined || validHash(c.sourceHash)),
        ) ||
        !r.images.every(
          (i) =>
            i &&
            images.has(i.id) &&
            validHash(i.hash) &&
            (i.previewHash === null || validHash(i.previewHash)),
        )
      )
        throw invalid();
      return r;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw e;
    }
  }
  async save(receipt: ProfileMoveReceipt) {
    const bytes = JSON.stringify(receipt);
    if (Buffer.byteLength(bytes) > 8 * 1024 ** 2) throw invalid();
    await atomicFile(await this.file(receipt.target, receipt.source, true), bytes);
  }
  async clear(target: string, source: string) {
    await unlink(await this.file(target, source)).catch((e) => {
      if (e.code !== 'ENOENT') throw e;
    });
  }
}
