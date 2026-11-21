import { downloadCloudBlob, downloadManifest, downloadPart } from './cloudDownload';
import { SyncYield } from './cloudLifecycle';
import {
  CLOUD_CHUNK_BYTES,
  CLOUD_ITEM_MAX_BYTES,
  CLOUD_MAX_ITEMS,
  KNOWLEDGE_MAX_BYTES,
  syncKinds,
  type CloudManifest,
  type CloudResource,
  type CloudResourceList,
  type CloudStorage,
  type CloudSyncCall,
  type CloudSyncResult,
  type SyncKind,
} from '../../electron/contracts/cloudSync';
import {
  CloudDataConflict,
  cloudFileParent,
  digestCloudBlob,
  type LocalSyncItem,
} from './cloudData';
import { projectMovedProfile, type movedCloudItems } from './migrationSyncProtection';

export type SyncStatus =
  'unsynced' | 'checking' | 'synced' | 'syncing' | 'deleting' | 'pausing' | 'conflict' | 'paused' | 'error';
export interface SyncMark {
  status: SyncStatus;
  error?: string;
  cloudPresent?: boolean;
}
export interface SyncBaseline {
  id: string;
  revision: number;
  hash: string;
  suppressed?: boolean;
  parent?: string;
  unrestored?: boolean;
  cleanupPending?: true;
}
export interface SyncPreferences {
  enabled: Record<SyncKind, boolean>;
  knowledgeLimitBytes: number;
}
interface PendingUpload {
  requestId: string;
  id?: string;
  hash: string;
  bytes: number;
  revision: number;
}
export interface SyncSaved {
  preferences: SyncPreferences;
  baselines: Record<string, SyncBaseline>;
  uploads?: Record<string, PendingUpload>;
  mergedLegacyState?: true;
}
export interface SyncView {
  preferences: SyncPreferences;
  marks: Record<string, SyncMark>;
  storage?: CloudStorage;
  busy: boolean;
  error?: string;
}
export const defaultSyncPreferences = (): SyncPreferences => ({
  enabled: { profile: false, history: false, knowledgebase: false },
  knowledgeLimitBytes: KNOWLEDGE_MAX_BYTES,
});
export function syncKindForKey(key: string): SyncKind {
  return /^(profile|resume):/.test(key)
    ? 'profile'
    : /^(record|image):/.test(key)
      ? 'history'
      : 'knowledgebase';
}
const keyValid = (key: string) =>
  /^(?:profile|resume|base|file|record|image):[\w-]{1,100}$/.test(key);
const shaValid = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const uuidValid = (v: unknown): v is string =>
  typeof v === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v);
const number = (v: unknown): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
class SyncFailure extends Error {
  constructor(
    message: string,
    readonly status = 0,
    readonly retry = 0,
  ) {
    super(message);
  }
}

const maxBaselines = 8192;
const maxPendingUploads = 4;
function validSyncSaved(value: unknown): value is SyncSaved {
  // An upgrade may combine two existing snapshots. New uploads still use the four-request limit.
  if (!value || typeof value !== 'object') return false;
  const saved = value as SyncSaved;
  const capacity = saved.mergedLegacyState === true ? 2 : 1;
  if (
    !saved.preferences ||
    !saved.preferences.enabled ||
    !syncKinds.every((k) => typeof saved.preferences.enabled[k] === 'boolean') ||
    !number(saved.preferences.knowledgeLimitBytes) ||
    saved.preferences.knowledgeLimitBytes < 1_000_000 ||
    saved.preferences.knowledgeLimitBytes > KNOWLEDGE_MAX_BYTES ||
    !saved.baselines ||
    Object.keys(saved.baselines).length > maxBaselines * capacity ||
    !Object.entries(saved.baselines).every(
      ([key, b]) =>
        keyValid(key) &&
        b &&
        uuidValid(b.id) &&
        number(b.revision) &&
        shaValid(b.hash) &&
        (b.suppressed === undefined || typeof b.suppressed === 'boolean') &&
        (b.unrestored === undefined || typeof b.unrestored === 'boolean') &&
        (b.cleanupPending === undefined || b.cleanupPending === true) &&
        (!b.parent || keyValid(b.parent)),
    )
  )
    return false;
  if (
    saved.uploads &&
    (Object.keys(saved.uploads).length > maxPendingUploads * capacity ||
      !Object.entries(saved.uploads).every(
        ([key, p]) =>
          keyValid(key) &&
          p &&
          uuidValid(p.requestId) &&
          (!p.id || uuidValid(p.id)) &&
          shaValid(p.hash) &&
          number(p.bytes) &&
          p.bytes <= CLOUD_ITEM_MAX_BYTES &&
          number(p.revision),
      ))
  )
    return false;
  return true;
}
export function readSyncSaved(value: unknown): SyncSaved {
  return validSyncSaved(value)
    ? structuredClone(value)
    : { preferences: defaultSyncPreferences(), baselines: {} };
}
export function mergeLegacySyncSaved(source: unknown, current?: SyncSaved): SyncSaved {
  const invalid = () => Error('旧版资料格式无效，原数据已保留。');
  if (!validSyncSaved(source) || (current !== undefined && !validSyncSaved(current))) throw invalid();
  const baselines = { ...source.baselines, ...current?.baselines };
  const uploads = { ...source.uploads, ...current?.uploads };
  const merged: SyncSaved = { ...source, baselines, uploads };
  if (Object.keys(baselines).length > maxBaselines || Object.keys(uploads).length > maxPendingUploads)
    merged.mergedLegacyState = true;
  if (!validSyncSaved(merged)) throw invalid();
  return merged;
}
export function decideSync(
  localHash: string | undefined,
  remoteHash: string | undefined,
  baseline?: SyncBaseline,
): 'push' | 'pull' | 'same' | 'conflict' | 'pause' | 'delete' {
  if (baseline?.suppressed) return 'pause';
  if (!remoteHash) return baseline ? (localHash ? 'pause' : 'same') : localHash ? 'push' : 'same';
  if (!localHash) return baseline ? (remoteHash === baseline.hash ? 'delete' : 'conflict') : 'pull';
  if (localHash === remoteHash) return 'same';
  if (!baseline) return 'conflict';
  if (localHash === baseline.hash) return 'pull';
  return remoteHash === baseline.hash ? 'push' : 'conflict';
}

/** One worker, one chunk in flight, one coalesced rerun. Profile edits preempt bulk transfers. */
export class CloudSyncEngine {
  private saved: SyncSaved;
  private marks: Record<string, SyncMark> = {};
  private remote = new Map<string, CloudResource>();
  private sources = new Map<string, LocalSyncItem>();
  private localDigests = new Map<string, { revision: string; hash: string }>();
  private profileVersion: unknown;
  private retryPersist = false;
  private parents = new Map<string, string>();
  private activeBase?: string;
  private prepared = new Map<
    string,
    { version: string; manifest: CloudManifest; first: Uint8Array<ArrayBuffer> }
  >();
  private storage?: CloudStorage;
  private movedProfileCloud?: { version: string; blob: Blob };
  private stopped = false;
  private emitTimer?: ReturnType<typeof setTimeout>;
  private emitPending = false;
  private running?: Promise<void>;
  private controlPending = false;
  private controlActive = false;
  private deleting = new Set<string>();
  private pausing = new Set<string>();
  private storageDirty = false;
  private storageReadAfter = 0;
  private pending = false;
  private failed = new Map<string, { hash?: string; until: number }>();
  private error?: string;
  private blockedUntil = 0;
  private dataEpoch: Record<SyncKind, number> = { profile: 0, history: 0, knowledgebase: 0 };
  private sourceEpoch: Record<SyncKind, number> = { profile: 0, history: 0, knowledgebase: 0 };
  constructor(
    private options: {
      userId: string;
      saved?: unknown;
      moved?: ReturnType<typeof movedCloudItems>;
      request(call: CloudSyncCall): Promise<CloudSyncResult>;
      list(kind: SyncKind): Promise<LocalSyncItem[]>;
      get(kind: SyncKind, key: string): Promise<LocalSyncItem | undefined>;
      /** Cheap identity of the stored profile, including changes made in another window. */
      profileVersion?(): unknown;
      apply(
        key: string,
        blob: Blob,
        expectedHash: string | undefined,
        guard: () => void,
        readMissingImage?: (id: string) => Promise<Blob | undefined>,
      ): Promise<void>;
      persist(value: SyncSaved): Promise<void>;
      emit(view: SyncView): void;
    },
  ) {
    this.saved = readSyncSaved(options.saved);
    for (const [key, baseline] of Object.entries(this.saved.baselines)) {
      if (baseline.suppressed) this.marks[key] = { status: 'paused' };
      else if (this.saved.preferences.enabled[syncKindForKey(key)])
        this.marks[key] = { status: 'checking' };
    }
  }
  private guard() {
    if (this.stopped) throw new SyncFailure('同步已停止。');
    if (this.controlPending && !this.controlActive) throw new SyncYield();
  }
  private emit(immediate = false) {
    if (this.stopped) return;
    this.emitPending = true;
    if (immediate) this.publish();
    else this.emitTimer ??= setTimeout(() => this.publish(), 16);
  }
  private publish(stopping = false) {
    clearTimeout(this.emitTimer);
    this.emitTimer = undefined;
    if (!this.emitPending || (this.stopped && !stopping)) return;
    this.emitPending = false;
    const marks = Object.fromEntries(
      Object.entries(this.marks).map(([key, mark]) => [
        key,
        { ...mark, cloudPresent: this.remote.has(key) },
      ]),
    );
    // Keep active group controls available; reveal terminal failures when work ends.
    const severity: SyncStatus[] = [
      'deleting',
      'pausing',
      'syncing',
      'conflict',
      'error',
      'unsynced',
      'checking',
      'paused',
      'synced',
    ];
    const keys = this.allKeys();
    const childrenByParent = new Map<string, string[]>();
    for (const key of keys) {
      const parent = this.parentKey(key);
      if (!parent) continue;
      const children = childrenByParent.get(parent);
      if (children) children.push(key);
      else childrenByParent.set(parent, [key]);
    }
    for (const key of keys) {
      if (this.saved.baselines[key]?.suppressed) {
        marks[key] = {
          ...marks[key],
          status: this.deleting.has(key)
            ? 'deleting'
            : this.pausing.has(key)
              ? 'pausing'
              : 'paused',
        };
        continue;
      }
      if (!key.startsWith('base:') && key !== 'profile:main' && !key.startsWith('record:'))
        continue;
      const children = [
        ...(childrenByParent.get(key) ?? []),
        ...(this.sources.get(key)?.dependencies ?? []),
      ];
      const states = [
        this.marks[key]?.status || 'unsynced',
        ...children.map((k) => this.marks[k]?.status || 'unsynced'),
        ...(this.activeBase === key ? ['syncing' as const] : []),
      ];
      const status = severity.find((s) => states.includes(s))!;
      marks[key] = {
        ...marks[key],
        status,
        cloudPresent: this.remote.has(key) || children.some((key) => this.remote.has(key)),
      };
    }
    this.options.emit({
      preferences: structuredClone(this.saved.preferences),
      marks,
      storage: this.storage,
      busy: !this.stopped && !!this.running,
      error: this.error,
    });
  }
  private mark(key: string, status: SyncStatus, error?: string) {
    this.marks[key] = { status, ...(error ? { error } : {}) };
    this.emit(status === 'error' || status === 'conflict' || !!error);
  }
  private async persist() {
    this.guard();
    try {
      await this.options.persist(structuredClone(this.saved));
      this.retryPersist = false;
    } catch (error) {
      this.retryPersist = true;
      throw error;
    }
    this.guard();
  }
  async configure(preferences: SyncPreferences) {
    const next = readSyncSaved({
      preferences,
      baselines: this.saved.baselines,
      mergedLegacyState: this.saved.mergedLegacyState,
    });
    if (JSON.stringify(next.preferences) !== JSON.stringify(preferences))
      throw Error('同步设置无效。');
    this.saved.preferences = next.preferences;
    // Controls must see the new preferences before another same-frame edit merges them.
    this.emit(true);
    await this.persist();
    this.emit(true);
    void this.request();
  }
  stop() {
    if (this.stopped) return;
    this.stopped = true;
    this.movedProfileCloud = undefined;
    this.pending = false;
    this.activeBase = undefined;
    this.deleting.clear();
    this.pausing.clear();
    for (const [key, mark] of Object.entries(this.marks))
      if (['syncing', 'deleting', 'pausing'].includes(mark.status))
        this.marks[key] = { ...mark, status: 'unsynced' };
    this.emitPending = true;
    this.publish(true);
  }
  /** Wait for the current worker and publish its latest view before returning. */
  async idle() {
    await this.running;
    this.publish();
  }
  dirty(kind: SyncKind, keys?: readonly string[]) {
    this.dataEpoch[kind]++;
    if (this.running && this.saved.preferences.enabled[kind]) this.pending = true;
    for (const key of keys ?? Object.keys(this.marks)) {
      const mark = this.marks[key];
      if (mark && syncKindForKey(key) === kind && ['synced', 'syncing', 'unsynced', 'checking'].includes(mark.status))
        this.marks[key] = { status: 'unsynced' };
    }
    this.emit();
  }
  /** Coalesced worker promises settle after their terminal view is published. */
  request(force = false): Promise<void> {
    if (this.stopped) return Promise.resolve();
    if (force) this.failed.clear();
    this.pending = true;
    if (this.controlPending) return this.running ?? Promise.resolve();
    if (!this.running) {
      this.running = Promise.resolve()
        .then(async () => {
          while (this.pending && !this.stopped && !this.controlPending) {
            this.pending = false;
            try {
              this.error = undefined;
              await this.cycle();
            } catch (error) {
              if (!this.stopped && !(error instanceof SyncYield)) {
                this.error = error instanceof Error ? error.message : '同步失败。';
                this.emit(true);
              }
            }
          }
        })
        .finally(() => {
          this.running = undefined;
          this.emit(true);
        });
      this.emit(true);
    }
    return this.running;
  }
  private async call(call: Omit<CloudSyncCall, 'userId'> | Record<string, unknown>): Promise<any> {
    this.guard();
    if (Date.now() < this.blockedUntil)
      throw new SyncFailure(
        '服务繁忙，已暂停请求并等待重试。',
        429,
        Math.ceil((this.blockedUntil - Date.now()) / 1000),
      );
    const result = await this.options.request({
      ...call,
      userId: this.options.userId,
    } as CloudSyncCall);
    this.guard();
    if (!result.ok) {
      if (result.deferred === 'interview') throw new SyncYield(result.error);
      if (result.status === 401) this.stop();
      if (result.status === 429 || result.status === 503)
        this.blockedUntil = Date.now() + Math.max(1, result.retryAfterSeconds || 5) * 1000;
      throw new SyncFailure(result.error, result.status, result.retryAfterSeconds);
    }
    return result.value;
  }
  private async refresh() {
    this.profileVersion = undefined;
    const remote = new Map<string, CloudResource>();
    const cursors = new Set<string>();
    let cursor = '';
    do {
      const value = (await this.call({ action: 'list', cursor })) as CloudResourceList;
      if (
        !value ||
        !Array.isArray(value.items) ||
        value.items.length > 50 ||
        !value.storage ||
        !['currentBytes', 'reservedBytes', 'storedBytes'].every((field) =>
          syncKinds.every((k) => number((value.storage as any)[field]?.[k])),
        ) ||
        !number(value.storage.knowledgeCapacityBytes) ||
        !number(value.storage.capacityBytes)
      )
        throw Error('云端容量响应无效。');
      this.storage = value.storage;
      for (const item of value.items) {
        if (
          !uuidValid(item.id) ||
          !syncKinds.includes(item.kind) ||
          !number(item.revision) ||
          !number(item.bytes) ||
          (item.headVersion !== null && (!uuidValid(item.headVersion) || !shaValid(item.sha256)))
        )
          throw Error('云端条目响应无效。');
        if (!keyValid(item.name)) continue; // Preserve snapshots from older/manual tools.
        if (syncKindForKey(item.name) !== item.kind) throw Error('云端条目分类无效。');
        if (remote.has(item.name)) throw Error('云端存在重名同步条目，请先核对。');
        remote.set(item.name, item);
      }
      if (value.nextCursor !== null && !uuidValid(value.nextCursor)) throw Error('云端分页无效。');
      cursor = value.nextCursor || '';
      if ((cursor && cursors.has(cursor)) || remote.size > CLOUD_MAX_ITEMS || cursors.size > 82)
        throw Error('云端分页超过保护上限。');
      cursors.add(cursor);
    } while (cursor);
    this.remote = remote;
    this.storageDirty = false;
    this.storageReadAfter = Date.now() + 1000;
    this.emit();
  }
  private async refreshUsage() {
    if (!this.storageDirty || Date.now() < this.storageReadAfter) return;
    const value = (await this.call({ action: 'list', cursor: '' })) as CloudResourceList;
    const storage = value.storage;
    if (
      !storage ||
      !['currentBytes', 'reservedBytes', 'storedBytes'].every((field) =>
        syncKinds.every((kind) => number((storage as any)[field]?.[kind])),
      ) ||
      !number(storage.capacityBytes) ||
      !number(storage.knowledgeCapacityBytes)
    )
      throw Error('云端容量响应无效。');
    this.storage = storage;
    this.storageDirty = false;
    this.storageReadAfter = Date.now() + 1000;
    this.emit();
  }
  private async loadSources(kind: SyncKind) {
    const epoch = this.dataEpoch[kind];
    const profileVersion = kind === 'profile' ? this.options.profileVersion?.() : undefined;
    const items = await this.options.list(kind);
    this.guard();
    if (items.length > CLOUD_MAX_ITEMS || items.some((i) => !keyValid(i.key) || i.kind !== kind))
      throw Error('本地同步条目超过保护上限。');
    const keys = new Set(items.map((item) => item.key));
    for (const [key, source] of this.sources) {
      if (source.kind !== kind || keys.has(key)) continue;
      this.sources.delete(key);
      this.localDigests.delete(key);
    }
    for (const item of items) this.sources.set(item.key, item);
    this.sourceEpoch[kind] = epoch;
    if (kind === 'profile') this.profileVersion = profileVersion;
    return items;
  }
  private async cycle() {
    if (this.retryPersist) await this.persist();
    await this.refresh();
    if (!syncKinds.some((k) => this.saved.preferences.enabled[k])) return;
    await this.retireDeletedUploads();
    for (const kind of syncKinds) {
      if (!this.saved.preferences.enabled[kind]) continue;
      const items = await this.loadSources(kind);
      const keys = new Set([
        ...items.map((i) => i.key),
        ...[...this.remote].filter(([, r]) => r.kind === kind).map(([key]) => key),
        ...Object.keys(this.saved.baselines).filter((key) => syncKindForKey(key) === kind),
      ]);
      try {
        if (kind === 'knowledgebase') await this.discoverParents(keys);
        const ordered = this.orderedKeys(kind, keys);
        // A missing local reference can still be moving into a later cloud record.
        const imageDeletes = new Set(kind === 'history' ? ordered.filter(key =>
          key.startsWith('image:') && !this.sources.has(key) &&
          decideSync(undefined, this.remote.get(key)?.sha256 ?? undefined, this.saved.baselines[key]) === 'delete') : []);
        let recordsSettled = true;
        for (const key of imageDeletes.size ? [...ordered.filter(k => !imageDeletes.has(k)), ...imageDeletes] : ordered) {
          if (Date.now() < this.blockedUntil) return;
          if (!this.saved.preferences.enabled[kind]) break;
          if (!recordsSettled && imageDeletes.has(key)) continue;
          if (this.activeBase && this.activeBase !== key && this.activeBase !== this.parentKey(key)) {
            this.activeBase = undefined;
            this.emit();
          }
          if (kind !== 'profile') await this.profileFirst();
          await this.one(key);
          if (imageDeletes.size && key.startsWith('record:') && this.remote.get(key)?.headVersion &&
              this.marks[key]?.status !== 'synced') recordsSettled = false;
        }
      } finally {
        this.activeBase = undefined;
        this.prepared.clear();
        this.emit();
      }
    }
    await this.refresh();
  }
  private allKeys() {
    return new Set([
      ...this.sources.keys(),
      ...this.remote.keys(),
      ...Object.keys(this.saved.baselines),
    ]);
  }
  private parentKey(key: string) {
    return (
      this.sources.get(key)?.parent || this.saved.baselines[key]?.parent || this.parents.get(key)
    );
  }
  private async downloadBlob(remote: CloudResource) {
    const prepared = this.prepared.get(remote.name);
    this.prepared.delete(remote.name);
    return downloadCloudBlob(remote, async call => {
      if (call.action === 'read' && remote.kind !== 'profile') await this.profileFirst();
      return this.call(call);
    }, prepared?.version === remote.headVersion ? prepared : undefined);
  }
  private async discoverParents(keys: Set<string>) {
    // Older cloud lists have no parent field. Read only verified envelope headers
    // before ordering a cold restore; retain at most four MiB of first chunks.
    let retained = 0;
    for (const key of keys) {
      const remote = this.remote.get(key);
      if (
        !key.startsWith('file:') ||
        this.sources.has(key) ||
        this.parentKey(key) ||
        !remote?.headVersion ||
        this.saved.baselines[key]?.suppressed
      )
        continue;
      const failed = this.failed.get(key);
      if (failed && failed.until > Date.now()) continue;
      this.guard();
      try {
        const manifest = await downloadManifest(remote, call => this.call(call));
        await this.profileFirst();
        const first = await downloadPart(remote, manifest, 0, call => this.call(call));
        const parent = await cloudFileParent(key, new Blob([first]));
        this.parents.set(key, parent);
        if (retained + first.byteLength <= 4 * CLOUD_CHUNK_BYTES) {
          this.prepared.set(key, { version: remote.headVersion, manifest, first });
          retained += first.byteLength;
        }
      } catch (error) {
        if (this.stopped || error instanceof SyncYield) throw error;
        this.failed.set(key, { until: Date.now() + 60_000 });
        this.mark(key, 'error', error instanceof Error ? error.message : '云端文件归属读取失败。');
        if (Date.now() < this.blockedUntil) break;
      }
    }
    this.emit();
  }
  private orderedKeys(kind: SyncKind, keys: Set<string>) {
    const ordered = new Set<string>();
    const add = (key: string) => {
      if (keys.has(key)) ordered.add(key);
    };
    if (kind === 'knowledgebase') {
      const children = new Map<string, string[]>();
      for (const key of keys) {
        const parent = this.parentKey(key);
        if (parent) {
          const siblings = children.get(parent) ?? [];
          siblings.push(key);
          children.set(parent, siblings);
        }
      }
      for (const root of keys)
        if (root.startsWith('base:')) {
          add(root);
          for (const child of children.get(root) ?? []) add(child);
        }
    } else if (kind === 'history') {
      for (const key of keys)
        if (key.startsWith('record:') && this.sources.has(key)) {
          for (const dependency of this.sources.get(key)?.dependencies ?? []) add(dependency);
          add(key);
        }
      // Cold restores need images before records whose local metadata is not available yet.
      for (const key of keys) if (key.startsWith('image:')) add(key);
    }
    for (const key of keys) add(key);
    return [...ordered];
  }
  private groupKeys(key: string) {
    const keys = new Set([key]);
    for (const child of this.allKeys()) if (this.parentKey(child) === key) keys.add(child);
    for (const dependency of this.sources.get(key)?.dependencies ?? [])
      if (
        ![...this.sources.values()].some(
          (source) => source.key !== key && source.dependencies?.includes(dependency),
        )
      )
        keys.add(dependency);
    if (keys.size > CLOUD_MAX_ITEMS) throw Error('同步条目超过保护上限。');
    return keys;
  }
  private async profileFirst() {
    if (!this.saved.preferences.enabled.profile) return;
    if (this.profileVersion !== undefined && this.sourceEpoch.profile === this.dataEpoch.profile &&
        this.profileVersion === this.options.profileVersion?.()) return;
    const item = (await this.loadSources('profile')).find((i) => i.key === 'profile:main');
    if (item) {
      await this.one(item.key);
    }
  }
  private async id(key: string) {
    const raw = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(this.options.userId + '\n' + key),
    );
    const h = Array.from(new Uint8Array(raw).slice(0, 16), (n) =>
      n.toString(16).padStart(2, '0'),
    ).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }
  private async abortUpload(pending: PendingUpload, remote?: CloudResource) {
    try {
      let id = pending.id;
      // The server may have accepted begin before its reply reached this device.
      if (!id && remote) {
        const upload = await this.call({
          action: 'begin', id: remote.id, requestId: pending.requestId,
          bytes: pending.bytes, sha256: pending.hash, revision: pending.revision,
        });
        id = upload.id;
      }
      if (id) await this.call({ action: 'abort', id });
    } catch (error) {
      if (!(error instanceof SyncFailure) || ![404, 409, 410].includes(error.status)) throw error;
    }
  }
  private async retireDeletedUploads() {
    const uploads = this.saved.uploads;
    if (!uploads) return;
    const keys = Object.keys(uploads);
    for (const kind of new Set(keys.map((key) => syncKindForKey(key)))) {
      await this.loadSources(kind);
      for (const key of keys) {
        if (syncKindForKey(key) !== kind || this.sources.has(key) ||
            this.sourceEpoch[kind] !== this.dataEpoch[kind]) continue;
        const remote = this.remote.get(key);
        // one() reconciles a completed upload whose acknowledgement was lost.
        if (remote?.headVersion && remote.sha256 === uploads[key].hash) continue;
        try {
          await this.abortUpload(uploads[key], remote);
          delete uploads[key];
          this.storageDirty = true;
          await this.persist();
        } catch (error) {
          if (this.stopped || error instanceof SyncYield) throw error;
          this.mark(key, 'error', error instanceof Error ? error.message : '同步失败。');
        }
      }
    }
  }
  private async cleanVersions(key: string, remote: CloudResource) {
    const versions = await this.call({ action: 'versions', id: remote.id });
    if (!Array.isArray(versions.items) || versions.items.length > 20 ||
        versions.items.some((version: { id?: unknown; revision?: unknown } | null) =>
          !uuidValid(version?.id) || !number(version?.revision))) throw Error('云端版本响应无效。');
    for (const version of versions.items) {
      if (version.id === remote.headVersion || version.revision >= remote.revision) continue;
      try {
        await this.call({ action: 'prune', id: remote.id, version: version.id });
      } catch (error) {
        if (!(error instanceof SyncFailure && error.status === 404)) throw error;
      }
    }
    delete this.saved.baselines[key].cleanupPending;
    await this.persist();
    this.storageDirty = true;
    await this.refreshUsage();
  }
  private async one(key: string, choice?: 'local' | 'cloud') {
    this.guard();
    const epoch = this.sourceEpoch[syncKindForKey(key)];
    // A later item must not label an earlier snapshot as current, or infer a
    // deletion from an absence that was invalidated while it waited in the batch.
    if (epoch !== this.dataEpoch[syncKindForKey(key)]) {
      this.pending = true;
      return;
    }
    const source = this.sources.get(key),
      remote = this.remote.get(key);
    let baseline = this.saved.baselines[key];
    const parent = this.parentKey(key);
    if ((baseline?.suppressed || (parent && this.saved.baselines[parent]?.suppressed)) && !choice) {
      this.mark(key, 'paused', this.marks[key]?.error);
      return;
    }
    let hash: string | undefined;
    try {
      const moved = this.options.moved;
      if (moved?.keys.has(key) || (parent && moved?.keys.has(parent))) {
        if (!source && !choice) {
          this.mark(key, 'paused');
          return;
        }
        if (source && moved.keys.delete(key)) moved.save();
      }
      const committed = this.saved.uploads?.[key];
      if (committed && remote?.headVersion && committed.hash === remote.sha256) {
        baseline = this.saved.baselines[key] = {
          id: remote.id,
          revision: remote.revision,
          hash: committed.hash,
          cleanupPending: true,
          ...(parent ? { parent } : {}),
        };
        delete this.saved.uploads![key];
        await this.persist();
      }
      let blob: Blob | undefined;
      this.guard();
      if (source?.digest) hash = await source.digest();
      else if (source) {
        // Only generated revisions certify the bytes. Old documents use metadata as a
        // fallback revision for transactions; two different blobs can share that metadata.
        const revision = source.localRevision;
        const cached = this.localDigests.get(key);
        if (uuidValid(revision) && cached?.revision === revision) hash = cached.hash;
        else {
          blob = await source.blob();
          hash = await digestCloudBlob(blob);
          if (uuidValid(revision)) this.localDigests.set(key, { revision, hash });
        }
      }
      const localHash = hash;
      let projected: Awaited<ReturnType<typeof projectMovedProfile>> | undefined;
      if (key === 'profile:main' && moved?.fields.size && remote?.headVersion) {
        if (this.movedProfileCloud?.version !== remote.headVersion)
          this.movedProfileCloud = { version: remote.headVersion, blob: await this.downloadBlob(remote) };
        projected = await projectMovedProfile(blob ?? await source?.blob(), this.movedProfileCloud.blob, moved.fields);
        if (source) {
          blob = projected.upload;
          hash = await digestCloudBlob(blob);
        }
      }
      this.guard();
      if (epoch !== this.dataEpoch[syncKindForKey(key)]) {
        this.pending = true;
        return;
      }
      if (moved && projected?.restored.length) {
        for (const field of projected.restored) moved.fields.delete(field);
        moved.save();
      }
      const failed = this.failed.get(key);
      if (!choice && failed && failed.hash === hash && failed.until > Date.now()) return;
      // Only retire predecessors of the exact locally verified head. Another device
      // can publish an unverified version while cleanup of our upload is pending.
      if (baseline?.cleanupPending && remote?.headVersion && baseline.id === remote.id &&
          baseline.revision === remote.revision && baseline.hash === remote.sha256 && hash === remote.sha256)
        await this.cleanVersions(key, remote);
      let action = decideSync(hash, remote?.headVersion ? remote.sha256! : undefined, baseline);
      // Hidden fields come from the latest remote head, so its upload projection is not
      // evidence of a local edit. Compare the visible bytes with the last matched pair.
      const matched = projected && moved?.getProfileHashes();
      if (action === 'conflict' && matched && matched.remote === baseline?.hash && matched.local === localHash)
        action = 'pull';
      if (choice === 'local') action = source ? 'push' : 'delete';
      if (choice === 'cloud') action = remote?.headVersion ? 'pull' : 'pause';
      if (projected && !source) action = projected.hasVisibleRemote ? 'pull' : 'same';
      if (action === 'conflict') {
        this.mark(key, 'conflict');
        return;
      }
      if (action === 'pause') {
        if (baseline) {
          baseline.suppressed = true;
          await this.persist();
        }
        this.mark(key, 'paused');
        return;
      }
      if (action === 'same') {
        if (remote?.headVersion && hash) {
          const mark = this.marks[key];
          if (!baseline || baseline.id !== remote.id || baseline.revision !== remote.revision ||
              baseline.hash !== hash || baseline.parent !== parent || baseline.suppressed || baseline.unrestored) {
            this.saved.baselines[key] = {
              id: remote.id, revision: remote.revision, hash, ...(parent ? { parent } : {}),
            };
            await this.persist();
          }
          if (projected && localHash) moved?.rememberProfile(hash, localHash);
          if (epoch === this.dataEpoch[syncKindForKey(key)] || (mark && mark === this.marks[key]))
            this.mark(key, 'synced');
        } else {
          if (baseline) {
            delete this.saved.baselines[key];
            await this.persist();
          }
          delete this.marks[key];
        }
        return;
      }
      if (!choice && syncKindForKey(key) === 'knowledgebase')
        this.activeBase = key.startsWith('base:') ? key : parent;
      this.mark(key, 'syncing');
      const transferMark = this.marks[key];
      if (action === 'delete') {
        if (remote) await this.call({ action: 'remove', id: remote.id, revision: remote.revision });
        this.remote.delete(key);
        delete this.saved.baselines[key];
        await this.persist();
        delete this.marks[key];
        return;
      }
      if (action === 'push' && source && !blob) {
        blob = await source.blob();
        if (await digestCloudBlob(blob) !== hash)
          throw new CloudDataConflict('同步期间本地数据已有修改，已保留两端版本。');
        this.guard();
      }
      if (action === 'push' && blob && hash) {
        if (source?.dependencies?.some((key) => this.marks[key]?.status !== 'synced'))
          throw Error('此记录的截图尚未全部同步，已保留本地完整记录。');
        // The server atomically reserves the shared account budget before any chunks
        // are sent, including old versions and resumable uploads already held there.
        const id = remote?.id || (await this.id(key));
        if (!remote) await this.call({ action: 'create', id, kind: syncKindForKey(key), key });
        let upload: CloudManifest | undefined;
        try {
          this.saved.uploads ??= {};
          let pending: PendingUpload | undefined = this.saved.uploads[key];
          if (
            pending &&
            (pending.hash !== hash ||
              pending.bytes !== blob.size ||
              pending.revision !== (remote?.revision ?? 0))
          ) {
            if (pending.id)
              await this.call({ action: 'abort', id: pending.id }).catch((error) => {
                if (!(error instanceof SyncFailure) || ![404, 409, 410].includes(error.status))
                  throw error;
              });
            delete this.saved.uploads[key];
            pending = undefined;
            await this.persist();
          }
          if (!pending) {
            if (Object.keys(this.saved.uploads).length >= maxPendingUploads)
              throw Error('未完成上传已达上限，请先重试未完成项。');
            pending = this.saved.uploads[key] = {
              requestId: crypto.randomUUID(),
              hash,
              bytes: blob.size,
              revision: remote?.revision ?? 0,
            };
            await this.persist();
          }
          upload = await this.call({
            action: 'begin',
            id,
            requestId: pending.requestId,
            bytes: blob.size,
            sha256: hash,
            revision: pending.revision,
          });
          this.storageDirty = true;
          await this.refreshUsage();
          if (
            upload!.chunkBytes !== CLOUD_CHUNK_BYTES ||
            upload!.partCount !== Math.ceil(blob.size / CLOUD_CHUNK_BYTES) ||
            !uuidValid(upload!.id)
          )
            throw Error('上传分块响应无效。');
          pending.id = upload!.id;
          await this.persist();
          for (let index = 0; index < upload!.partCount; index++) {
            if (syncKindForKey(key) !== 'profile') await this.profileFirst();
            if (!this.saved.preferences.enabled[syncKindForKey(key)]) throw Error('该类同步已关闭。');
            const bytes = new Uint8Array(
              await blob
                .slice(index * CLOUD_CHUNK_BYTES, (index + 1) * CLOUD_CHUNK_BYTES)
                .arrayBuffer(),
            );
            const prior = upload!.parts?.find((p) => p.index === index);
            if (
              prior &&
              prior.bytes === bytes.byteLength &&
              prior.sha256 === (await digestCloudBlob(new Blob([bytes])))
            )
              continue;
            await this.call({ action: 'put', id: upload!.id, index, bytes });
            await this.refreshUsage();
          }
          const done = (await this.call({ action: 'complete', id: upload!.id })) as CloudManifest;
          if (
            !uuidValid(done.versionId) ||
            !number(done.revision) ||
            done.sha256 !== hash ||
            done.bytes !== blob.size
          )
            throw Error('上传完成响应无效。');
          const updated = {
            ...(remote ?? { kind: syncKindForKey(key), name: key, createdAt: Date.now() }),
            id,
            revision: done.revision,
            headVersion: done.versionId,
            bytes: blob.size,
            sha256: hash,
          };
          this.remote.set(key, updated);
          this.saved.baselines[key] = {
            id,
            revision: done.revision,
            hash,
            cleanupPending: true,
            ...(parent ? { parent } : {}),
          };
          if (projected && localHash) moved?.rememberProfile(hash, localHash);
          await this.persist();
          delete this.saved.uploads[key];
          await this.persist();
          // Retire old transport versions after the new head is durable. Never delete the current head first.
          await this.cleanVersions(key, updated);
        } catch (error) {
          if (
            !this.stopped &&
            error instanceof SyncFailure &&
            [400, 409, 410, 413, 422].includes(error.status)
          ) {
            const pendingId = upload?.id || this.saved.uploads?.[key]?.id;
            if (pendingId) await this.call({ action: 'abort', id: pendingId }).catch(() => {});
            delete this.saved.uploads?.[key];
            await this.persist();
          }
          throw error;
        }
      } else if (action === 'pull' && remote?.headVersion) {
        const download = projected?.download ?? await this.downloadBlob(remote);
        const visibleHash = projected ? await digestCloudBlob(download) : undefined;
        const kind = syncKindForKey(key);
        const current = await this.options.get(kind, key);
        const currentHash = current?.digest ? await current.digest() :
          current ? await digestCloudBlob(await current.blob()) : undefined;
        if (currentHash !== localHash) {
          this.mark(key, 'conflict');
          return;
        }
        this.guard();
        await this.options.apply(key, download, localHash, () => this.guard(), key.startsWith('record:') ? async id => {
          const imageKey = 'image:' + id, image = this.remote.get(imageKey);
          this.guard();
          if (!image?.headVersion || this.saved.baselines[imageKey]?.suppressed ||
              this.options.moved?.keys.has(imageKey)) return undefined;
          return this.downloadBlob(image);
        } : undefined);
        this.guard();
        if (visibleHash) moved?.rememberProfile(remote.sha256!, visibleHash);
        if (kind !== 'profile') {
          const restored = await this.options.get(kind, key);
          this.guard();
          if (restored) this.sources.set(key, restored);
          else this.sources.delete(key);
          // Screenshots can be shared across records. Refresh affected references
          // against the committed history, including references the download removed.
          if (key.startsWith('record:')) {
            for (const image of new Set([...(source?.dependencies ?? []), ...(restored?.dependencies ?? [])])) {
              const entry = await this.options.get(kind, image);
              this.guard();
              if (entry) this.sources.set(image, entry);
              else this.sources.delete(image);
            }
          }
        } else await this.loadSources(kind);
        const restoredParent = this.parentKey(key);
        this.saved.baselines[key] = {
          id: remote.id,
          revision: remote.revision,
          hash: remote.sha256!,
          ...(restoredParent ? { parent: restoredParent } : {}),
        };
        await this.persist();
      }
      this.failed.delete(key);
      if (epoch !== this.dataEpoch[syncKindForKey(key)] && this.marks[key] !== transferMark) {
        this.pending = true;
        this.mark(key, 'unsynced');
      } else this.mark(key, 'synced');
    } catch (error) {
      if (error instanceof SyncYield) {
        if (this.marks[key]?.status === 'syncing') this.mark(key, 'checking');
        throw error;
      }
      if (this.stopped) return;
      const failure = error instanceof Error ? error : Error('同步失败。');
      this.failed.set(key, {
        hash,
        until: Date.now() + Math.max(60, error instanceof SyncFailure ? error.retry : 0) * 1000,
      });
      this.mark(
        key,
        error instanceof CloudDataConflict || (error instanceof SyncFailure && error.status === 409)
          ? 'conflict'
          : 'error',
        failure.message,
      );
    }
  }
  private async exclusive(work: () => Promise<void>) {
    if (this.stopped) throw Error('同步已停止。');
    if (this.controlPending) throw Error('正在处理另一项同步操作，请稍后重试。');
    this.controlPending = true;
    try {
      if (this.running) {
        this.pending = true;
        await this.running;
      }
      if (this.stopped) throw Error('同步已停止。');
      this.controlActive = true;
      this.running = Promise.resolve().then(work);
      this.emit();
      await this.running;
    } finally {
      this.controlActive = false;
      this.controlPending = false;
      this.running = undefined;
      this.emit(true);
      if (this.pending && !this.stopped) void this.request();
    }
  }
  async resolve(key: string, choice: 'local' | 'cloud') {
    if (!keyValid(key)) throw Error('同步条目无效。');
    await this.exclusive(async () => {
      await this.refresh();
      await this.loadSources(syncKindForKey(key));
      await this.one(key, choice);
      this.emit();
    });
  }
  async refreshStorage() {
    await this.exclusive(async () => {
      this.error = undefined;
      await this.refresh();
    });
  }
  private async suspendGroup(key: string, remove: boolean) {
    if (!keyValid(key)) throw Error('同步条目无效。');
    await this.exclusive(async () => {
      await this.refresh();
      await this.loadSources(syncKindForKey(key));
      const keys = this.groupKeys(key);
      for (const target of keys) {
        const remote = this.remote.get(target);
        const unrestored =
          this.saved.baselines[target]?.unrestored ||
          (!this.sources.has(target) && !this.saved.baselines[target]);
        this.saved.baselines[target] = {
          id: remote?.id || (await this.id(target)),
          revision: remote?.revision || 0,
          hash: remote?.sha256 || '0'.repeat(64),
          suppressed: true,
          ...(unrestored ? { unrestored: true } : {}),
          ...(target !== key ? { parent: key } : {}),
        };
      }
      await this.persist(); // Suppress first: a disconnect cannot cause accidental re-upload.
      const active = remove ? this.deleting : this.pausing;
      for (const target of keys) {
        active.add(target);
        this.mark(target, remove ? 'deleting' : 'pausing');
      }
      try {
        // Children first; revisions prevent deleting a newer snapshot from another device.
        for (const target of [...keys].filter((target) => target !== key).concat(key)) {
          const remote = this.remote.get(target);
          if (remove) {
            if (remote)
              await this.call({ action: 'remove', id: remote.id, revision: remote.revision });
            this.remote.delete(target);
          } else {
            const pending = this.saved.uploads?.[target];
            if (pending) await this.abortUpload(pending, remote);
          }
          this.storageDirty = true;
          delete this.saved.uploads?.[target];
          this.mark(target, 'paused');
          await this.refreshUsage();
        }
        await this.persist();
      } catch (error) {
        active.clear();
        this.mark(key, 'paused', error instanceof Error ? error.message : '删除失败。');
        throw error;
      }
      active.clear();
      this.mark(key, 'paused');
      await this.refresh();
    });
  }
  removeCloud(key: string) {
    return this.suspendGroup(key, true);
  }
  pause(key: string) {
    return this.suspendGroup(key, false);
  }
  async resume(key: string) {
    if (!keyValid(key)) throw Error('同步条目无效。');
    await this.exclusive(async () => {
      if (!this.saved.preferences.enabled[syncKindForKey(key)])
        throw Error('请先在「设置 → VoxCue 账号」中开启对应同步。');
      await this.refresh();
      const sources = await this.loadSources(syncKindForKey(key));
      const parent =
        sources.find((source) => source.key === key)?.parent || this.saved.baselines[key]?.parent;
      if (parent && this.saved.baselines[parent]?.suppressed)
        throw Error(
          `请先恢复所属${parent.startsWith('base:') ? '知识库' : '个人信息'}的自动同步。`,
        );
      for (const target of this.groupKeys(key)) {
        if (this.saved.baselines[target]?.unrestored) {
          const parent = this.parentKey(target);
          if (parent) this.parents.set(target, parent);
          delete this.saved.baselines[target];
        } else if (this.remote.get(target)?.headVersion && this.saved.baselines[target])
          this.saved.baselines[target].suppressed = false;
        else delete this.saved.baselines[target];
      }
      this.failed.clear();
      await this.persist();
    });
    await this.request(true);
  }
}
