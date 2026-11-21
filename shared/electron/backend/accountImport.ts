import { createHash, randomUUID } from 'node:crypto';
import { isCloudProfileOwner } from '../accountProfilePaths';
import type {
  AccountDataCall,
  AccountDataResult,
  AccountExportCall,
  AccountImportCall,
  AccountImportItem,
  AccountImportSource,
  SourceRemovalPlan,
  SourceRemovalResult,
} from '../contracts/accountData';
import { validImagePreview } from '../contracts/interviewImages';
import { validImportDocument, validImportEnvelopeSize, validImportItemSize, validImportRecordTitle, withinImportItemLimit } from '../contracts/accountData';
import { recordingRecordId } from '../contracts/recordings';
import { normalizeCloudPassword, validLocalImportRevision } from '../contracts/cloudAccount';
import {
  validRestoreKey,
  maxRestoreItems,
  restoreLimit,
  restoreChunkSize,
} from '../contracts/restoreData';
import type { AccountArchive } from './accountArchive';
import {
  validMoveKey,
  validRemovalPlan,
  type MovedClip,
  type MovedImage,
  type ProfileMoveReceipt,
  type ProfileMoveReceipts,
} from './profileMoveReceipt';

type Rollback = () => Promise<void>;
export interface ProfileImportReader {
  items: AccountImportItem[];
  imageSize?(key: string): Promise<number>;
  recordSize?(key: string): Promise<number>;
  itemDigest?(key: string): Promise<string>;
  read(key: string, offset: number): Promise<Uint8Array>;
  planRemoval(keys: string[]): Promise<SourceRemovalPlan>;
  removeSelected(plan: SourceRemovalPlan): Promise<SourceRemovalResult>;
  savedPreviewHash(id: string): Promise<string | null>;
  close(): Promise<void> | void;
}
type Active = {
  token: string;
  caller: string;
  target: string;
  source: AccountImportSource;
  reader?: ProfileImportReader;
  readerController?: AbortController;
  timer: ReturnType<typeof setTimeout>;
  items: Map<string, AccountImportItem>;
  totalBytes: number;
  images: Map<string, Rollback>;
  movedImages: MovedImage[];
  undoRecordings?: Rollback & { copied: MovedClip[] };
  removal?: SourceRemovalPlan;
  recovered?: { localRevision: string | null };
  preparing?: boolean;
  committing?: boolean;
};
const invalid = () => Error('迁移已取消或账号已变化。');
const badData = () => Error('来源账号的本机资料无效或不完整。');
const sourceChanged = (error: unknown) =>
  error instanceof Error && error.message === '来源资料已改变，请重新选择。';
const cleanupFailure = (error: unknown) => sourceChanged(error)
  ? error
  : Error('目标资料已保存，来源资料清理未完成。请重新选择此来源后重试。');
const allowedFields = {
  listImportSources: [],
  openImport: ['sourceId'],
  unlockImport: ['token', 'password'],
  readImport: ['token', 'key', 'offset'],
  digestImportItem: ['token', 'key'],
  prepareImportCommit: ['token', 'keys', 'recordIds', 'imageIds'],
  closeImport: ['token', 'committed'],
} satisfies Record<AccountImportCall['action'], string[]>;

function importAction(action: unknown): action is AccountImportCall['action'] {
  return typeof action === 'string' && Object.hasOwn(allowedFields, action);
}
function uniqueIds(value: unknown, validate: (id: unknown) => boolean): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= maxRestoreItems &&
    new Set(value).size === value.length &&
    Array.from(value).every(validate)
  );
}
function validRequest(call: AccountImportCall) {
  if (!call || typeof call !== 'object' || Array.isArray(call) || !importAction(call.action))
    return false;
  const fields: readonly string[] = allowedFields[call.action];
  if (Object.keys(call).some((k) => k !== 'action' && !fields.includes(k))) return false;
  if (call.action === 'listImportSources') return true;
  if (call.action === 'openImport')
    return call.sourceId === 'local' || isCloudProfileOwner(call.sourceId);
  if (!recordingRecordId(call.token)) return false;
  switch (call.action) {
    case 'unlockImport':
      return call.password === undefined || normalizeCloudPassword(call.password) !== undefined;
    case 'readImport':
      return (
        validRestoreKey(call.key) &&
        Number.isSafeInteger(call.offset) &&
        call.offset >= 0 &&
        call.offset < 64 * 1024 ** 2
      );
    case 'digestImportItem':
      return validRestoreKey(call.key) && (call.key === 'resume:main' || /^(file|record):/.test(call.key));
    case 'prepareImportCommit':
      return (
        Array.isArray(call.keys) &&
        withinImportItemLimit(call.keys, key => key) &&
        Array.from(call.keys).every(validMoveKey) &&
        new Set(call.keys).size === call.keys.length &&
        call.keys.length > 0 &&
        uniqueIds(
          call.recordIds,
          (id) => typeof id === 'string' && validRestoreKey('record:' + id),
        ) &&
        uniqueIds(call.imageIds, recordingRecordId)
      );
    case 'closeImport':
      return call.committed === undefined || typeof call.committed === 'boolean';
  }
}
function validateItems(items: AccountImportItem[]) {
  if (!Array.isArray(items) || items.length > maxRestoreItems) throw badData();
  const manifest = new Map<string, AccountImportItem>();
  let total = 0;
  for (const item of items) {
    if (
      !item ||
      !validRestoreKey(item.key) ||
      manifest.has(item.key) ||
      (item.document !== undefined && (!validImportDocument(item.key, item.document) || item.document.size >= item.size)) ||
      ((item.recordTitle !== undefined || item.recordLibraryName !== undefined) &&
        !validImportRecordTitle(item.key, item.recordTitle, item.recordLibraryName)) ||
      (item.imageIds !== undefined &&
        (!item.key.startsWith('record:') || !uniqueIds(item.imageIds, id => typeof id === 'string' && validRestoreKey('image:' + id)))) ||
      !validImportItemSize(item.key, item.size, item.recordTitle, item.recordLibraryName) ||
      (total += item.size) > restoreLimit
    )
      throw badData();
    manifest.set(item.key, item);
  }
  for (const item of manifest.values())
    if (item.imageIds?.some(id => !manifest.has('image:' + id) ||
      (!recordingRecordId(id) && manifest.get('image:' + id)!.size !== 0))) throw badData();
  return { manifest, total };
}
export class AccountImport {
  private active?: Active;
  private operation?: AbortController;
  private pending: Promise<unknown> = Promise.resolve();
  private cancellation?: Promise<void>;
  constructor(
    private ports: {
      owner(): string | undefined;
      sources(target: string): Promise<AccountImportSource[]>;
      localRevision(): string | undefined;
      verify(
        source: AccountImportSource,
        password: string | undefined,
        signal: AbortSignal,
      ): Promise<void>;
      open(source: string, signal: AbortSignal): Promise<ProfileImportReader>;
      image(id: string, preview: string, bytes: Buffer): Promise<Rollback>;
      recordings(
        source: string,
        target: string,
        recordIds: string[],
        signal: AbortSignal,
      ): Promise<Rollback & { copied: MovedClip[] }>;
      receipts: Pick<ProfileMoveReceipts, 'read' | 'save' | 'clear'>;
      checkSource(receipt: ProfileMoveReceipt, signal: AbortSignal): Promise<void>;
      cleanSource(
        receipt: ProfileMoveReceipt,
        removed: SourceRemovalResult,
        signal: AbortSignal,
      ): Promise<void>;
    },
  ) {}
  hasWork() {
    return !!this.operation || !!this.active || !!this.cancellation;
  }
  async cancel() {
    if (this.cancellation) return this.cancellation;
    this.operation?.abort();
    this.active?.readerController?.abort();
    this.cancellation = this.pending
      .catch(() => {})
      .then(() => this.close(!!this.active?.committing));
    try {
      await this.cancellation;
    } finally {
      this.cancellation = undefined;
    }
  }
  private async close(committed: boolean) {
    const a = this.active;
    if (!a) return;
    this.active = undefined;
    clearTimeout(a.timer);
    try {
      if (!committed) {
        const undo = [...a.images.values()];
        if (a.undoRecordings) undo.push(a.undoRecordings);
        const results = await Promise.allSettled(undo.map((fn) => fn()));
        const failed = results.find((r) => r.status === 'rejected');
        if (failed) throw failed.reason;
      }
    } finally {
      await a.reader?.close();
    }
  }
  async call(caller: string, call: AccountImportCall): Promise<AccountDataResult> {
    if (!validRequest(call)) return { ok: false, error: '迁移资料无效。' };
    if (
      this.operation &&
      call.action === 'closeImport' &&
      !call.committed &&
      this.active &&
      !this.active.committing &&
      this.active.caller === caller &&
      this.active.token === call.token &&
      this.active.target === this.ports.owner()
    ) {
      try {
        await this.cancel();
        return { ok: true };
      } catch {
        return { ok: false, error: '资料迁移失败，请重试。' };
      }
    }
    if (this.operation || this.cancellation)
      return { ok: false, error: '资料操作正在进行，请稍候。' };
    const controller = (this.operation = new AbortController());
    const work = (this.pending = this.run(caller, call, controller.signal));
    try {
      return await work;
    } catch (e) {
      const error = controller.signal.aborted
        ? invalid().message
        : e instanceof SyntaxError
          ? badData().message
          : e instanceof Error && !('code' in e)
            ? e.message
            : '资料迁移失败，请重试。';
      return { ok: false, error };
    } finally {
      this.operation = undefined;
    }
  }
  private async run(
    caller: string,
    call: AccountImportCall,
    signal: AbortSignal,
  ): Promise<AccountDataResult> {
    const target = this.ports.owner();
    if (!target || !caller) throw invalid();
    const guard = () => {
      signal.throwIfAborted();
      if (this.ports.owner() !== target) throw invalid();
    };
    if (call.action === 'listImportSources' || call.action === 'openImport') {
      if (this.active) throw Error('已有资料正在迁移。');
      let sources = await this.ports.sources(target);
      // Clearing the last local revision may succeed before the receipt is retired.
      if (isCloudProfileOwner(target) && !sources.some(s => s.id === 'local') &&
          await this.ports.receipts.read(target, 'local'))
        sources = [{ id: 'local' }, ...sources];
      guard();
      if (call.action === 'listImportSources') return { ok: true, sources };
      const source = sources.find((item) => item.id === call.sourceId && item.id !== target);
      if (!source) throw Error('这个账户在本机没有可迁移的资料。');
      const token = randomUUID();
      this.active = {
        caller,
        target,
        source,
        token,
        items: new Map(),
        totalBytes: 0,
        images: new Map(),
        movedImages: [],
        timer: setTimeout(() => void this.cancel().catch(() => {}), 15 * 60_000).unref(),
      };
      return {
        ok: true,
        token,
        requiresPassword: source.id !== 'local',
        sourceEmail: source.email,
        ...(source.id === 'local' ? { localRevision: this.ports.localRevision() } : {}),
      };
    }
    const a = this.active;
    if (!a && call.action === 'closeImport' && !call.committed) return { ok: true };
    if (!a || a.caller !== caller || a.target !== target || a.token !== call.token) throw invalid();
    a.timer.refresh();
    if (call.action === 'closeImport') {
      if (call.committed && !a.committing) throw invalid();
      if (!call.committed) {
        await this.close(false);
        return { ok: true };
      }
      try {
        const receipt: ProfileMoveReceipt = {
          version: 1,
          source: a.source.id,
          target,
          plan: a.removal!,
          images: a.movedImages,
          clips: a.undoRecordings?.copied ?? [],
        };
        await this.ports.receipts.save(receipt);
        guard();
        const result = await this.finishMove(receipt, a.reader!, signal);
        return {
          ok: true,
          ...(result.localRevision ? { localRevision: result.localRevision } : {}),
        };
      } catch (error) {
        throw cleanupFailure(error);
      } finally {
        // A positive acknowledgement confirms the destination transaction, even if cleanup failed.
        await this.close(true);
      }
    }
    if (a.preparing) throw invalid();
    if (call.action === 'unlockImport') {
      if (!a.reader) {
        if (a.source.id !== 'local') await this.ports.verify(a.source, call.password, signal);
        guard();
        a.readerController = new AbortController();
        const readerSignal = AbortSignal.any([signal, a.readerController.signal]);
        const receipt = await this.ports.receipts.read(target, a.source.id);
        guard();
        let reader: ProfileImportReader | undefined;
        try {
          reader = await this.ports.open(a.source.id, readerSignal);
          guard();
          if (receipt) {
            const { localRevision } = await this.finishMove(receipt, reader, signal);
            a.recovered = { localRevision };
            await reader.close();
            reader = undefined;
            guard();
            reader = await this.ports.open(a.source.id, readerSignal);
            guard();
          }
          const { manifest, total } = validateItems(reader.items);
          a.items = manifest;
          a.totalBytes = total;
          a.reader = reader;
        } catch (e) {
          await reader?.close();
          if (receipt && !a.recovered) throw cleanupFailure(e);
          throw e;
        }
      }
      return { ok: true, items: [...a.items.values()],
        ...(a.recovered && { recoveredMove: true, ...(a.recovered.localRevision && { localRevision: a.recovered.localRevision }) }) };
    }
    const reader = a.reader;
    if (!reader) throw invalid();
    const resolveRecordSize = async (item: AccountImportItem) => {
      const size = await reader.recordSize?.(item.key);
      guard();
      if (!validImportEnvelopeSize(size) || a.totalBytes + size > restoreLimit) throw badData();
      a.totalBytes += size;
      a.items.set(item.key, { ...item, size });
    };
    const read = async (key: string, offset: number) => {
      const item = a.items.get(key);
      if (!item || !Number.isSafeInteger(offset) || offset < 0 || offset >= item.size)
        throw badData();
      const bytes = await reader.read(key, offset);
      guard();
      if (
        !(bytes instanceof Uint8Array) ||
        !bytes.length ||
        bytes.length > Math.min(restoreChunkSize, item.size - offset)
      )
        throw badData();
      return bytes;
    };
    if (call.action === 'readImport') {
      const item = a.items.get(call.key);
      if (call.offset === 0 && item?.size === 0 && item.recordTitle !== undefined)
        await resolveRecordSize(item);
      const bytes = await read(call.key, call.offset);
      return { ok: true, bytes, ...(call.offset === 0 && { size: a.items.get(call.key)!.size }) };
    }
    if (call.action === 'digestImportItem') {
      const item = a.items.get(call.key);
      if (!item || (!item.document && item.recordTitle === undefined) || !reader.itemDigest) throw badData();
      const digest = await reader.itemDigest(call.key);
      guard();
      if (typeof digest !== 'string' || !/^[a-f0-9]{64}$/.test(digest)) throw badData();
      return { ok: true, digest };
    }
    if (call.action !== 'prepareImportCommit') throw invalid();
    const selected = new Set(call.keys);
    if (
      call.keys.some((key) => !a.items.has(key.startsWith('profile:') ? 'profile:main' : key)) ||
      selected.size !== call.keys.length ||
      call.keys.filter((key) => key.startsWith('record:')).length !== call.recordIds.length ||
      call.recordIds.some((id) => !selected.has('record:' + id))
    )
      throw badData();
    const images = new Set<string>();
    for (const id of call.recordIds) {
      const record = a.items.get('record:' + id);
      if (!record) throw badData();
      if (record.size === 0) await resolveRecordSize(record);
      for (const image of record.imageIds ?? []) images.add(image);
    }
    if (images.size !== call.imageIds.length || call.imageIds.some((id) => !images.has(id)))
      throw badData();
    a.preparing = true;
    const plan = await reader.planRemoval(call.keys);
    guard();
    if (!validRemovalPlan(plan)) throw badData();
    const leaves = plan.items.filter((i) => !i.key.startsWith('file:'));
    if (
      leaves.length !== selected.size ||
      leaves.some((i) => !selected.has(i.key)) ||
      plan.items.some((i) => i.key.startsWith('file:') && !a.items.has(i.key))
    )
      throw badData();
    for (const row of leaves.filter((i) => i.key.startsWith('record:'))) {
      const references = new Set(a.items.get(row.key)?.imageIds ?? []);
      if (
        (row.imageIds?.length ?? 0) !== references.size ||
        row.imageIds?.some((id) => !references.has(id))
      )
        throw badData();
    }
    a.removal = plan;
    for (const id of images) {
      guard();
      const key = 'image:' + id, item = a.items.get(key)!;
      if (item.size === 0) {
        const size = await reader.imageSize?.(key);
        if (size === undefined || !Number.isSafeInteger(size) || size < 8 ||
            size > 8 * 1024 ** 2 + 132 * 1024 + 8 || a.totalBytes + size > restoreLimit) throw badData();
        guard();
        a.totalBytes += size;
        a.items.set(key, { ...item, size });
      }
      await this.restoreImage(a, id, read, guard);
    }
    const recordIds = call.recordIds.filter(recordingRecordId);
    if (recordIds.length)
      a.undoRecordings = await this.ports.recordings(a.source.id, a.target, recordIds, signal);
    guard();
    a.committing = true;
    return { ok: true };
  }
  private async finishMove(
    receipt: ProfileMoveReceipt,
    reader: ProfileImportReader,
    signal: AbortSignal,
  ) {
    let removed: SourceRemovalResult;
    try {
      signal.throwIfAborted();
      await this.ports.checkSource(receipt, signal);
      signal.throwIfAborted();
      removed = await reader.removeSelected(receipt.plan);
    } catch (error) {
      // The source renderer checks all selected content before deleting anything.
      if (sourceChanged(error))
        await this.ports.receipts.clear(receipt.target, receipt.source);
      throw error;
    }
    const planned = new Set(receipt.plan.items.map((i) => i.key));
    const images = new Set(receipt.images.map((i) => i.id));
    const resume = receipt.plan.items.find((i) => i.key === 'resume:main')?.documentId;
    if (
      !removed ||
      !uniqueIds(removed.imageIds, (id) => typeof id === 'string' && images.has(id)) ||
      !uniqueIds(
        removed.recordIds,
        (id) => typeof id === 'string' && planned.has('record:' + id),
      ) ||
      !uniqueIds(
        removed.documentIds,
        (id) => typeof id === 'string' && (id === resume || planned.has('file:' + id)),
      ) ||
      !(
        removed.localRevision === null ||
        (receipt.source === 'local' && validLocalImportRevision(removed.localRevision))
      )
    )
      throw badData();
    signal.throwIfAborted();
    await this.ports.cleanSource(receipt, removed, signal);
    await this.ports.receipts.clear(receipt.target, receipt.source);
    return removed;
  }
  private async restoreImage(
    a: Active,
    id: string,
    read: (key: string, offset: number) => Promise<Uint8Array>,
    guard: () => void,
  ) {
    const imageKey = 'image:' + id;
    const size = a.items.get(imageKey)!.size;
    if (size > 8 * 1024 ** 2 + 132 * 1024 + 8) throw badData();
    if (!a.images.has(id)) {
      const chunks: Uint8Array[] = [];
      for (let offset = 0; offset < size;) {
        const bytes = await read(imageKey, offset);
        chunks.push(bytes);
        offset += bytes.length;
      }
      const data = Buffer.concat(chunks),
        length = data.readUInt32BE(4);
      if (
        data.toString('ascii', 0, 4) !== 'VCS1' ||
        length > 132 * 1024 ||
        8 + length >= data.length
      )
        throw badData();
      const { v, key, metadata } = JSON.parse(data.toString('utf8', 8, 8 + length));
      if (
        v !== 1 ||
        key !== imageKey ||
        metadata?.id !== id ||
        !validImagePreview(metadata.preview)
      )
        throw badData();
      a.images.set(id, await this.ports.image(id, metadata.preview, data.subarray(8 + length)));
      a.movedImages.push({
        id,
        hash: createHash('sha256')
          .update(data.subarray(8 + length))
          .digest('hex'),
        previewHash: await a.reader!.savedPreviewHash(id),
      });
    }
    guard();
  }
}

/** File exports and same-device transfers cannot interleave with each other. */
export class AccountDataTransfers {
  private closed = false;
  constructor(
    private archive: AccountArchive,
    private importer: AccountImport,
  ) {}
  hasWork() {
    return this.archive.hasWork() || this.importer.hasWork();
  }
  async cancel() {
    await Promise.all([this.archive.cancel(), this.importer.cancel()]);
  }
  async dispose() {
    this.closed = true;
    await Promise.all([this.archive.dispose(), this.importer.cancel()]);
  }
  call(caller: string, call: AccountDataCall): Promise<AccountDataResult> {
    const importing = call && importAction(call.action);
    if (this.closed || (importing ? this.archive.hasWork() : this.importer.hasWork()))
      return Promise.resolve({ ok: false, error: '资料操作正在进行，请稍候。' });
    return importing
      ? this.importer.call(caller, call as AccountImportCall)
      : this.archive.call(caller, call as AccountExportCall);
  }
}
