import { downloadCloudBlob, downloadManifest, downloadPart } from './cloudDownload';
import { SyncYield } from './cloudLifecycle';
import { HistorySyncGroups } from './historySyncGroups';
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
  decodeCloudItem,
  digestCloudBlob,
  type LocalSyncItem,
} from './cloudData';
import { projectMovedProfile, type movedCloudItems } from './migrationSyncProtection';

export type SyncStatus =
  'unsynced' | 'checking' | 'synced' | 'syncing' | 'deleting' | 'pausing' | 'conflict' | 'paused' | 'error';
export interface SyncMark {
  status: SyncStatus;
  resolving?: boolean;
  parentKey?: string;
  groupVersion?: string;
  groupName?: string;
  groupPresence?: { local: boolean; cloud: boolean };
  /** The parent's own state when its visible badge also represents children. */
  itemStatus?: SyncStatus;
  conflictVersion?: string;
  error?: string;
  cloudPresent?: boolean;
}
export interface SyncChoice {
  key: string;
  side: 'cloud' | 'local';
  version: string;
}
const conflictVersion = (hash: string | undefined, remote: CloudResource | undefined) =>
  JSON.stringify([hash, remote?.id, remote?.revision, remote?.headVersion, remote?.sha256]);
interface GroupMember {
  key: string;
  local?: string;
  cloud?: string;
  version: string;
  storedLocal?: string;
  storedCloud?: string;
  localOwners?: string[];
  cloudOwners?: string[];
}
interface GroupSnapshot { version: string; members: GroupMember[]; name?: string; head?: string | null }
interface HistoryBatch {
  reviewed: Map<string, { side: SyncChoice['side']; snapshot: GroupSnapshot }>;
  written: Map<string, { before: string; after: string }>;
  completed: Set<string>;
}
// Recheck the account inventory periodically during long transfers. Each image
// still uses its reviewed hash/revision and the local transaction's owner guard.
const historyReviewWindowMs = 2_000;
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
  /** A partially applied whole-library decision must not be auto-merged on restart. */
  pendingLibraries?: string[];
  /** Screenshots previously attached to a partially applied record may now be orphaned. */
  pendingGroups?: Record<string, Record<string, string | null>>;
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
const groupRootKey = (key: string) => key === 'profile:main' || key.startsWith('base:') || key.startsWith('record:');
export function syncItemsWithStatus(marks: SyncView['marks'], status: 'conflict' | 'error') {
  return Object.entries(marks).flatMap(([key, mark]): [string, SyncMark][] => {
    if (mark.resolving) return [];
    if (status === 'conflict')
      return groupRootKey(key) && mark.groupVersion
        ? [[key, { ...mark, conflictVersion: mark.groupVersion }]] : [];
    return (mark.itemStatus ?? mark.status) === status ? [[key, mark]] : [];
  });
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
    (saved.pendingGroups !== undefined && (!saved.pendingGroups || typeof saved.pendingGroups !== 'object' ||
      Object.keys(saved.pendingGroups).length > maxBaselines || !Object.entries(saved.pendingGroups).every(([key, items]) =>
        keyValid(key) && (key === 'profile:main' || key.startsWith('record:')) && items && typeof items === 'object' &&
        !Array.isArray(items) && Object.keys(items).length <= CLOUD_MAX_ITEMS &&
        Object.entries(items).every(([item, hash]) => item.startsWith('image:') && keyValid(item) && (hash === null || shaValid(hash)))))) ||
    (saved.pendingLibraries !== undefined && (!Array.isArray(saved.pendingLibraries) ||
      saved.pendingLibraries.length > maxBaselines || !saved.pendingLibraries.every(key => typeof key === 'string' && key.startsWith('base:') && keyValid(key)))) ||
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
  const pendingLibraries = [...new Set([...(source.pendingLibraries ?? []), ...(current?.pendingLibraries ?? [])])];
  const pendingGroups = { ...source.pendingGroups, ...current?.pendingGroups };
  const merged: SyncSaved = { ...source, baselines, uploads, ...(pendingLibraries.length ? { pendingLibraries } : {}),
    ...(Object.keys(pendingGroups).length ? { pendingGroups } : {}) };
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
  private remoteParents = new Map<string, { head: string; parent: string }>();
  private historyGroups = new HistorySyncGroups();
  private groups = new Map<string, GroupSnapshot>();
  private historyBodies = new Map<string, { head: string; blob: Blob }>();
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
  private resolving = new Map<string, string>();
  private resolutionTail?: Promise<void>;
  private deleting = new Set<string>();
  private pausing = new Set<string>();
  private storageDirty = false;
  private storageReadAfter = 0;
  private pending = false;
  private failed = new Map<string, { hash?: string; until: number }>();
  private error?: string;
  private blockedUntil = 0;
  private disableEpoch: Record<SyncKind, number> = { profile: 0, history: 0, knowledgebase: 0 };
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
      removeLocal(key: string, expectedHash: string, guard: () => void, root: string): Promise<void>;
      removeLocalLibrary(root: string, revisions: ReadonlyMap<string, string | null>, keys: string[],
        recheckCloud: () => Promise<void>, guard: () => void): Promise<void>;
      apply(
        key: string,
        blob: Blob,
        expectedHash: string | undefined,
        guard: () => void,
        readMissingImage?: (id: string) => Promise<Blob | undefined>,
        groupKey?: string,
        reviewedImageOwners?: readonly string[],
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
  private syncEnabled(kind: SyncKind, epoch: number) {
    return this.saved.preferences.enabled[kind] && epoch === this.disableEpoch[kind];
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
    for (const root of this.groups.keys()) keys.add(root);
    const childrenByParent = new Map<string, string[]>();
    for (const key of keys) {
      const parent = this.parentKey(key);
      if (!parent) continue;
      if (marks[key]) marks[key].parentKey = parent;
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
      const library = this.groups.get(key);
      const states = [
        this.marks[key]?.status || 'unsynced',
        ...(library ? ['conflict' as const] : []),
        ...children.map((k) => this.marks[k]?.status || 'unsynced'),
        ...(this.activeBase === key ? ['syncing' as const] : []),
      ];
      const status = severity.find((s) => states.includes(s))!;
      const itemStatus = this.marks[key]?.status ?? 'unsynced';
      marks[key] = {
        ...marks[key],
        itemStatus,
        status,
        ...(library ? {
          groupVersion: library.version,
          groupName: library.name,
          groupPresence: key === 'profile:main'
            ? { local: library.members.some(item => !!item.local), cloud: library.members.some(item => !!item.cloud) }
            : { local: this.sources.has(key), cloud: !!this.remote.get(key)?.headVersion },
        } : {}),
        cloudPresent: this.remote.has(key) || children.some((key) => this.remote.has(key)),
      };
    }
    if (this.resolving.size) {
      const scopes = new Set(this.resolving.values());
      for (const [key, mark] of Object.entries(marks)) {
        if (scopes.has(key) || (mark.parentKey && this.resolving.has(mark.parentKey)) || this.resolving.has(key))
          marks[key] = { ...mark, status: 'syncing', resolving: true };
      }
    }
    this.options.emit({
      preferences: structuredClone(this.saved.preferences),
      marks,
      storage: this.storage,
      busy: !this.stopped && (!!this.running || this.resolving.size > 0),
      error: this.error,
    });
  }
  private mark(key: string, status: SyncStatus, error?: string, version?: string) {
    this.marks[key] = { status, ...(error ? { error } : {}), ...(version ? { conflictVersion: version } : {}) };
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
    for (const kind of syncKinds)
      if (this.saved.preferences.enabled[kind] && !next.preferences.enabled[kind]) this.disableEpoch[kind]++;
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
    this.resolving.clear();
    for (const [key, mark] of Object.entries(this.marks))
      if (['syncing', 'deleting', 'pausing'].includes(mark.status))
        this.marks[key] = { ...mark, status: 'unsynced' };
    this.emitPending = true;
    this.publish(true);
  }
  /** Wait for the current worker and publish its latest view before returning. */
  async idle() {
    if (this.resolutionTail) await this.resolutionTail;
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
    for (const [key, cached] of this.remoteParents)
      if (remote.get(key)?.headVersion !== cached.head) this.remoteParents.delete(key);
    this.storageDirty = false;
    this.storageReadAfter = Date.now() + 1000;
    this.emit();
  }
  private async refreshUsage(force = false) {
    if (!force && (!this.storageDirty || Date.now() < this.storageReadAfter)) return;
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
    if (!syncKinds.some(k => this.saved.preferences.enabled[k])) {
      if (!this.storage) await this.refreshUsage(true);
      return;
    }
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
        ...(kind === 'knowledgebase' ? this.saved.pendingLibraries ?? [] : []),
        ...Object.keys(this.saved.pendingGroups ?? {}).filter(key => syncKindForKey(key) === kind),
      ]);
      try {
        const frozen = new Set<string>();
        if (kind === 'knowledgebase') {
          await this.discoverParents(keys);
          for (const key of keys) {
            const parents = this.crossedParents(key);
            if (parents) {
              const error = '文件标识已用于其他资料，已保留两端版本。';
              for (const parent of parents) {
                frozen.add(parent);
                this.mark(parent, 'error', error);
              }
              this.mark(key, 'error', error);
            } else if (key.startsWith('file:') && this.marks[key]?.status === 'error' &&
                       this.remote.get(key)?.headVersion && !this.cloudParent(key)) {
              const parent = this.parentKey(key);
              if (parent) frozen.add(parent);
            }
          }
        }
        const oneWayHistory = kind === 'history' && await this.oneWayHistory(keys, items);
        const groups = oneWayHistory ? new Map<string, Set<string>>() : await this.collectGroups(kind, keys);
        for (const [root, members] of groups) {
            try {
              const snapshot = await this.inspectGroup(root, members);
              const pendingGroup = this.saved.pendingGroups?.[root];
              const canFinish = this.saved.pendingLibraries?.includes(root) || (pendingGroup &&
                (root === 'profile:main' || (kind === 'history' && members.size === 1 && Object.keys(pendingGroup).length === 0)));
              if (snapshot && canFinish &&
                  snapshot.members.every(member => member.local === member.cloud && (!member.key.startsWith('image:') || member.local ||
                    (!member.storedLocal && !member.storedCloud)))) await this.finishGroup(root);
              else if (snapshot) for (const member of members) frozen.add(member);
            } catch (error) {
              this.guard();
              frozen.add(root);
              for (const member of members) frozen.add(member);
              this.mark(root, 'error', error instanceof Error ? error.message : '同步失败。');
            }
          }
        for (const root of this.groups.keys()) if (syncKindForKey(root) === kind && !groups.has(root)) this.groups.delete(root);
        const ordered = this.orderedKeys(kind, keys);
        // A missing local reference can still be moving into a later cloud record.
        const imageDeletes = new Set(kind === 'history' ? ordered.filter(key =>
          key.startsWith('image:') && !this.sources.has(key) &&
          decideSync(undefined, this.remote.get(key)?.sha256 ?? undefined, this.saved.baselines[key]) === 'delete') : []);
        let recordsSettled = true;
        for (const key of imageDeletes.size ? [...ordered.filter(k => !imageDeletes.has(k)), ...imageDeletes] : ordered) {
          if (Date.now() < this.blockedUntil) return;
          if (!this.saved.preferences.enabled[kind]) break;
          if (frozen.has(key) || frozen.has(this.parentKey(key) ?? '')) continue;
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
        this.historyBodies.clear();
        this.emit();
      }
    }
    if (syncKinds.some(k => this.saved.preferences.enabled[k])) await this.refresh();
  }
  private allKeys() {
    return new Set([
      ...this.sources.keys(),
      ...this.remote.keys(),
      ...Object.keys(this.saved.baselines),
      ...(this.saved.pendingLibraries ?? []),
      ...Object.keys(this.saved.pendingGroups ?? {}),
    ]);
  }
  private parentKey(key: string) {
    if (key === 'resume:main') return 'profile:main';
    return (
      this.sources.get(key)?.parent || this.saved.baselines[key]?.parent || this.parents.get(key)
    );
  }
  private cloudParent(key: string) {
    const remote = this.remote.get(key), baseline = this.saved.baselines[key];
    if (!remote?.headVersion) return;
    return this.remoteParents.get(key)?.parent ?? (baseline?.hash === remote.sha256 ? baseline?.parent : undefined);
  }
  private crossedParents(key: string) {
    if (!key.startsWith('file:')) return;
    const cloud = this.cloudParent(key), local = this.sources.get(key)?.parent ?? this.saved.baselines[key]?.parent;
    if (local && cloud && local !== cloud) return [local, cloud];
  }
  private async downloadBlob(remote: CloudResource, check?: () => void) {
    const body = this.historyBodies.get(remote.name);
    if (body && body.head === remote.headVersion) return body.blob;
    const prepared = this.prepared.get(remote.name);
    this.prepared.delete(remote.name);
    return downloadCloudBlob(remote, async call => {
      if (call.action === 'read' && remote.kind !== 'profile') await this.profileFirst();
      check?.();
      return this.call(call);
    }, prepared?.version === remote.headVersion ? prepared : undefined);
  }
  private async discoverParents(keys: Set<string>, verifyScope = false) {
    // Older cloud lists have no parent field. Read only verified envelope headers
    // before ordering a cold restore; retain at most four MiB of first chunks.
    let retained = [...this.prepared.values()].reduce((sum, entry) => sum + entry.first.byteLength, 0);
    for (const key of keys) {
      const remote = this.remote.get(key);
      if (
        !key.startsWith('file:') ||
        !remote?.headVersion ||
        this.cloudParent(key) ||
        (!verifyScope && (this.saved.baselines[key]?.suppressed || (this.sources.has(key) && !this.parentKey(key))))
      )
        continue;
      const failed = this.failed.get(key);
      if (!verifyScope && failed && failed.until > Date.now()) continue;
      this.guard();
      try {
        const manifest = await downloadManifest(remote, call => this.call(call));
        await this.profileFirst();
        const first = await downloadPart(remote, manifest, 0, call => this.call(call));
        const parent = await cloudFileParent(key, new Blob([first]));
        this.remoteParents.set(key, { head: remote.headVersion, parent });
        this.parents.set(key, parent);
        if (retained + first.byteLength <= 4 * CLOUD_CHUNK_BYTES) {
          this.prepared.set(key, { version: remote.headVersion, manifest, first });
          retained += first.byteLength;
        }
      } catch (error) {
        if (verifyScope) throw error;
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
  private libraryGroups(keys: Set<string>) {
    const groups = new Map<string, Set<string>>();
    for (const key of keys) {
      if (!key.startsWith('file:') && !key.startsWith('base:')) continue;
      const root = key.startsWith('base:') ? key : this.parentKey(key);
      if (!root?.startsWith('base:')) continue;
      if (!groups.has(root)) groups.set(root, new Set([root]));
      groups.get(root)!.add(key);
    }
    return groups;
  }
  private async collectGroups(kind: SyncKind, keys: Set<string>) {
    if (kind === 'knowledgebase') return this.libraryGroups(keys);
    if (kind === 'profile') return new Map([['profile:main', new Set(['profile:main', 'resume:main'])]]);
    let retained = [...this.historyBodies.values()].reduce((n, entry) => n + entry.blob.size, 0);
    return this.historyGroups.refresh(keys, this.sources, this.remote, this.saved.pendingGroups,
      async source => (await this.readLocal(source)).hash, async resource => {
        const blob = await this.downloadBlob(resource);
        if (retained + blob.size <= 4 * CLOUD_CHUNK_BYTES) {
          this.historyBodies.set(resource.name, { head: resource.headVersion!, blob });
          retained += blob.size;
        }
        return blob;
      });
  }
  private async oneWayHistory(keys: Set<string>, local: LocalSyncItem[]) {
    if (Object.keys(this.saved.pendingGroups ?? {}).some(key => key.startsWith('record:')) ||
        [...this.groups.keys()].some(key => key.startsWith('record:'))) return false;
    const ids = [...keys];
    if (ids.every(key => (this.remote.get(key)?.sha256 ?? undefined) === this.saved.baselines[key]?.hash)) return true;
    // A new device, or one only receiving new records, can restore directly.
    // No ownership discovery should download the same large record first.
    if (ids.some(key => this.saved.baselines[key] && (!this.sources.has(key) ||
        this.remote.get(key)?.sha256 !== this.saved.baselines[key].hash))) return false;
    for (const item of local) {
      const baseline = this.saved.baselines[item.key];
      if (!baseline || (await this.readLocal(item)).hash !== baseline.hash) return false;
    }
    return true;
  }
  private async readLocal(source: LocalSyncItem | undefined): Promise<{ hash?: string; blob?: Blob }> {
    if (!source) return {};
    if (source.digest) return { hash: await source.digest() };
    // Metadata fallback revisions on old documents do not guarantee identical bytes.
    const revision = source.localRevision;
    const cached = this.localDigests.get(source.key);
    if (uuidValid(revision) && cached?.revision === revision) return { hash: cached.hash };
    const blob = await source.blob();
    const hash = await digestCloudBlob(blob);
    if (uuidValid(revision)) this.localDigests.set(source.key, { hash, revision });
    return { hash, blob };
  }
  private async inspectGroup(root: string, keys: Set<string>, reviewed = false) {
    const pending = !!this.saved.pendingLibraries?.includes(root) || !!this.saved.pendingGroups?.[root];
    const protectedKey = (key: string) => this.saved.baselines[key]?.suppressed || this.options.moved?.keys.has(key);
    // With no cloud-side edit, normal one-way uploads require no extra local reads.
    if (protectedKey(root) || (!reviewed && !pending && !this.groups.has(root) && ![...keys].some(key =>
      !protectedKey(key) && (this.remote.get(key)?.sha256 ?? undefined) !== this.saved.baselines[key]?.hash))) {
      this.groups.delete(root);
      return;
    }
    let localChanged = false, cloudChanged = false;
    const members: GroupMember[] = [];
    for (const key of [...keys].sort()) {
      this.guard();
      const remote = this.remote.get(key), baseline = this.saved.baselines[key];
      const { hash: storedLocal, blob } = await this.readLocal(this.sources.get(key));
      const storedCloud = remote?.headVersion ? remote.sha256! : undefined;
      const image = key.startsWith('image:');
      let local = !image || this.historyGroups.owners(key, 'local')?.has(root) ? storedLocal : undefined;
      const cloud = !image || this.historyGroups.owners(key, 'cloud')?.has(root) ? storedCloud : undefined;
      const moved = this.options.moved;
      const matched = key === 'profile:main' ? moved?.getProfileHashes() : undefined;
      if (key === 'profile:main' && local && moved?.fields.size && remote?.headVersion) {
        if (this.movedProfileCloud?.version !== remote.headVersion)
          this.movedProfileCloud = { version: remote.headVersion, blob: await this.downloadBlob(remote) };
        const projected = await projectMovedProfile(blob ?? await this.sources.get(key)!.blob(), this.movedProfileCloud.blob, moved.fields);
        local = await digestCloudBlob(projected.upload);
      }
      if (local !== cloud && !protectedKey(key)) {
        if (!image || local) localChanged ||= local !== baseline?.hash && !(matched && matched.local === storedLocal && matched.remote === baseline?.hash);
        if (!image || cloud) cloudChanged ||= cloud !== baseline?.hash;
      }
      members.push({ key, local, cloud, storedLocal, storedCloud, version: conflictVersion(storedLocal, remote),
        ...(image ? { localOwners: [...this.historyGroups.owners(key, 'local') ?? []].sort(),
          cloudOwners: [...this.historyGroups.owners(key, 'cloud') ?? []].sort() } : {}) });
    }
    this.guard();
    if (!(localChanged && cloudChanged) && !pending && !reviewed) {
      this.groups.delete(root);
      return;
    }
    const version = await digestCloudBlob(new Blob([JSON.stringify(members.map(item => [item.key, item.version, item.localOwners, item.cloudOwners]))]));
    for (const member of members) {
      const { key, local, cloud } = member;
      if (protectedKey(key)) continue;
      const conflict = decideSync(local, cloud, this.saved.baselines[key]) === 'conflict';
      const previous = this.marks[key];
      if (conflict && previous?.conflictVersion !== member.version)
        this.marks[key] = { status: 'conflict', conflictVersion: member.version };
      else if (!conflict && previous?.status !== 'error')
        this.marks[key] = { status: local === cloud ? 'synced' : 'unsynced' };
    }
    // A locally deleted library still needs a recognizable name in the chooser.
    const remote = this.remote.get(root);
    const previous = this.groups.get(root);
    let name = this.historyGroups.title(root, remote?.headVersion) ??
      (previous?.head === remote?.headVersion ? previous?.name : undefined);
    if (!name && !this.sources.has(root) && remote?.headVersion && remote.bytes <= CLOUD_CHUNK_BYTES) {
      try {
        const data = await decodeCloudItem(root, await this.downloadBlob(remote));
        if (data.type === 'base') name = data.base.name;
        if (data.type === 'record') name = data.record.title;
      } catch (error) {
        if (this.stopped || error instanceof SyncYield) throw error;
        // The ID still identifies this choice if its optional display name is unavailable.
      }
    }
    const snapshot = { version, members, head: remote?.headVersion, name };
    if (pending || (localChanged && cloudChanged)) this.groups.set(root, snapshot);
    else this.groups.delete(root);
    this.emit();
    return snapshot;
  }
  private async profileFirst() {
    if (!this.saved.preferences.enabled.profile) return;
    if (this.profileVersion !== undefined && this.sourceEpoch.profile === this.dataEpoch.profile &&
        this.profileVersion === this.options.profileVersion?.()) return;
    const item = (await this.loadSources('profile')).find((i) => i.key === 'profile:main');
    if (item && !(await this.inspectGroup('profile:main', new Set(['profile:main', 'resume:main'])))) {
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
  private async cleanVersions(key: string, remote: CloudResource, guardWrite: () => void) {
    const versions = await this.call({ action: 'versions', id: remote.id });
    if (!Array.isArray(versions.items) || versions.items.length > 20 ||
        versions.items.some((version: { id?: unknown; revision?: unknown } | null) =>
          !uuidValid(version?.id) || !number(version?.revision))) throw Error('云端版本响应无效。');
    for (const version of versions.items) {
      if (version.id === remote.headVersion || version.revision >= remote.revision) continue;
      try {
        guardWrite();
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
  private async one(key: string, selection?: SyncChoice, groupRoot?: string, reviewedImageOwners?: readonly string[]) {
    this.guard();
    const choice = selection?.side, expectedVersion = selection?.version;
    const kind = syncKindForKey(key), started = this.disableEpoch[kind];
    const disabled = () => !this.syncEnabled(kind, started);
    const guardWrite = () => {
      this.guard();
      if (disabled()) throw Error('该类同步已关闭。');
    };
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
    let version: string | undefined;
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
      ({ hash, blob } = await this.readLocal(source));
      const localHash = hash;
      version = conflictVersion(localHash, remote);
      if (expectedVersion !== undefined && expectedVersion !== version) {
        this.mark(key, 'conflict', '资料已变化，请重新选择要保留的版本。', version);
        return;
      }
      let projected: Awaited<ReturnType<typeof projectMovedProfile>> | undefined;
      if (key === 'profile:main' && moved?.fields.size && remote?.headVersion) {
        if (this.movedProfileCloud?.version !== remote.headVersion)
          this.movedProfileCloud = { version: remote.headVersion, blob: await this.downloadBlob(remote, guardWrite) };
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
        await this.cleanVersions(key, remote, guardWrite);
      let action = decideSync(hash, remote?.headVersion ? remote.sha256! : undefined, baseline);
      // Hidden fields come from the latest remote head, so its upload projection is not
      // evidence of a local edit. Compare the visible bytes with the last matched pair.
      const matched = projected && moved?.getProfileHashes();
      if (action === 'conflict' && matched && matched.remote === baseline?.hash && matched.local === localHash)
        action = 'pull';
      if (choice === 'local') action = source ? 'push' : 'delete';
      if (choice === 'cloud') action = remote?.headVersion ? 'pull' : 'pause';
      if (groupRoot && choice === 'cloud' && !remote?.headVersion && localHash) {
        guardWrite();
        await this.options.removeLocal(key, localHash, guardWrite, groupRoot);
        this.guard();
        this.sources.delete(key);
        this.localDigests.delete(key);
        action = 'delete';
      }
      if (groupRoot && localHash === (remote?.sha256 ?? undefined)) action = 'same';
      if (projected && !source) action = projected.hasVisibleRemote ? 'pull' : 'same';
      if (action === 'conflict') {
        this.mark(key, 'conflict', undefined, version);
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
        guardWrite();
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
        guardWrite();
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
          guardWrite();
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
            guardWrite();
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
            guardWrite();
            await this.call({ action: 'put', id: upload!.id, index, bytes });
            await this.refreshUsage();
          }
          guardWrite();
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
          await this.cleanVersions(key, updated, guardWrite);
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
        const download = projected?.download ?? await this.downloadBlob(remote, guardWrite);
        const visibleHash = projected ? await digestCloudBlob(download) : undefined;
        const kind = syncKindForKey(key);
        const current = await this.options.get(kind, key);
        const currentHash = current?.digest ? await current.digest() :
          current ? await digestCloudBlob(await current.blob()) : undefined;
        if (currentHash !== localHash) {
          this.mark(key, 'conflict', undefined, conflictVersion(currentHash, remote));
          return;
        }
        this.guard();
        guardWrite();
        await this.options.apply(key, download, localHash, guardWrite, key.startsWith('record:') ? async id => {
          const imageKey = 'image:' + id, image = this.remote.get(imageKey);
          this.guard();
          if (!image?.headVersion || this.saved.baselines[imageKey]?.suppressed ||
              this.options.moved?.keys.has(imageKey)) return undefined;
          return this.downloadBlob(image, guardWrite);
        } : undefined, groupRoot, reviewedImageOwners);
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
      if (disabled()) {
        this.mark(key, expectedVersion ? 'conflict' : 'unsynced', undefined, expectedVersion);
        return;
      }
      const failure = error instanceof Error ? error : Error('同步失败。');
      this.failed.set(key, {
        hash,
        until: Date.now() + Math.max(60, error instanceof SyncFailure ? error.retry : 0) * 1000,
      });
      const conflict = expectedVersion !== undefined || error instanceof CloudDataConflict ||
        (error instanceof SyncFailure && error.status === 409);
      this.mark(
        key,
        conflict ? 'conflict' : 'error',
        failure.message,
        conflict ? version ?? expectedVersion ?? conflictVersion('unverified', remote) : undefined,
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
  private async checkedGroupKeys(root: string) {
    const keys = this.allKeys();
    const kind = syncKindForKey(root);
    if (kind !== 'knowledgebase') return (await this.collectGroups(kind, keys)).get(root) ?? new Set([root]);
    await this.discoverParents(keys, true);
    for (const key of keys)
      if (this.crossedParents(key)?.includes(root))
        throw Error('云端文件所属知识库无效。');
    return this.libraryGroups(keys).get(root) ?? new Set([root]);
  }
  private async checkedGroup(root: string, reviewed = false) {
    return this.inspectGroup(root, await this.checkedGroupKeys(root), reviewed);
  }
  private cloudHeads(keys: Iterable<string>) {
    return JSON.stringify([...keys].sort().flatMap(key => {
      const remote = this.remote.get(key);
      return remote ? [[key, remote.id, remote.revision, remote.headVersion, remote.sha256]] : [];
    }));
  }
  private async removeLocalLibraryMembers(root: string, current: GroupSnapshot, keys: string[], cloudHeads: string,
    check: () => void) {
    const revisions = new Map(current.members.filter(entry => entry.local)
      .map(entry => [entry.key, this.sources.get(entry.key)?.localRevision ?? null]));
    const changed = () => new CloudDataConflict('资料已变化，请重新选择要保留的版本。');
    const guard = () => {
      check();
      if (this.sourceEpoch.knowledgebase !== this.dataEpoch.knowledgebase) throw changed();
    };
    // One final cloud snapshot guards one atomic local commit, after slow native index cleanup.
    try {
      await this.options.removeLocalLibrary(root, revisions, keys, async () => {
        guard();
        await this.refresh();
        if (this.cloudHeads(await this.checkedGroupKeys(root)) !== cloudHeads) throw changed();
      }, guard);
    } catch (error) {
      if (error instanceof CloudDataConflict) return false;
      throw error;
    }
    for (const entry of current.members) {
      if (entry.cloud) continue;
      guard();
      const remote = this.remote.get(entry.key);
      if (entry.local && remote && !remote.headVersion) {
        await this.call({ action: 'remove', id: remote.id, revision: remote.revision });
        this.remote.delete(entry.key);
      }
      this.sources.delete(entry.key);
      this.localDigests.delete(entry.key);
      delete this.saved.baselines[entry.key];
      delete this.marks[entry.key];
    }
    await this.persist();
    return true;
  }
  private async finishGroup(root: string) {
    delete this.saved.pendingGroups?.[root];
    if (!Object.keys(this.saved.pendingGroups ?? {}).length) delete this.saved.pendingGroups;
    this.saved.pendingLibraries = this.saved.pendingLibraries?.filter(key => key !== root);
    if (!this.saved.pendingLibraries?.length) delete this.saved.pendingLibraries;
    await this.persist();
    this.groups.delete(root);
    if (!this.sources.has(root) && !this.remote.has(root)) delete this.marks[root];
  }
  private async applyMember(item: GroupMember, choice: SyncChoice, check: () => void, owners?: readonly string[]) {
    const kind = syncKindForKey(choice.key);
    if (this.sourceEpoch[kind] !== this.dataEpoch[kind]) return false;
    const current = await this.options.get(kind, item.key);
    check();
    if (current) this.sources.set(item.key, current);
    else this.sources.delete(item.key);
    await this.one(item.key, { key: item.key, version: item.version, side: choice.side }, choice.key, owners);
    this.guard();
    return !this.marks[item.key] || this.marks[item.key].status === 'synced';
  }
  private reviewedHistory(root: string, current: GroupSnapshot, batch: HistoryBatch) {
    const review = batch.reviewed.get(root)?.snapshot;
    if (!review || review.members.length !== current.members.length) return false;
    const old = new Map(review.members.map(member => [member.key, member]));
    return current.members.every(member => {
      const initial = old.get(member.key);
      if (!initial) return false;
      const written = batch.written.get(member.key);
      if (initial.version !== member.version && !(written?.before === initial.version && written.after === member.version)) return false;
      for (const side of ['localOwners', 'cloudOwners'] as const) {
        const before = initial[side] ?? [], after = member[side] ?? [];
        if (before.some(key => !after.includes(key) && !batch.completed.has(key)) ||
            after.some(key => !before.includes(key) && !batch.completed.has(key))) return false;
      }
      return true;
    });
  }
  private async resolveHistory(choice: SyncChoice, members: GroupMember[], batch: HistoryBatch, check: () => void) {
    const root = choice.key, from = choice.side, to = from === 'cloud' ? 'local' : 'cloud';
    const rootMember = members.find(item => item.key === root)!;
    const images = members.filter(item => item.key !== root);
    const matchesWinners = (snapshot: GroupSnapshot | undefined) => {
      if (!snapshot) return false;
      const winners = new Map(members.filter(item => item[from]).map(item => [item.key, item[from]]));
      for (const item of snapshot.members) {
        if (item.local !== winners.get(item.key) || item.cloud !== winners.get(item.key)) return false;
        winners.delete(item.key);
      }
      return !winners.size;
    };
    const stillShared = (key: string) => [...this.historyGroups.owners(key, to) ?? []].some(owner => owner !== root);
    const original = (item: GroupMember) => to === 'local' ? item.storedLocal : item.storedCloud;
    for (const image of images) {
      if (this.historyGroups.owners(image.key, from)?.has(root) && !image[from])
        throw Error('此记录的截图尚未全部恢复，本地记录已保留。');
      if (image[from] && image[from] !== original(image) && [...this.historyGroups.owners(image.key, to) ?? []]
        .some(owner => owner !== root && batch.reviewed.get(owner)?.side !== from)) throw Error('此截图也用于其他面试记录，已保留两端版本。');
    }
    let ownerGroups: Map<string, Set<string>> | undefined;
    const checkedOwners = new Set<string>();
    let ownersValidUntil = 0;
    for (const image of images.filter(item => item[from])) {
      let owners: string[] | undefined;
      if (image[from] !== original(image)) {
        if (!ownerGroups || performance.now() >= ownersValidUntil) {
          await this.refresh();
          await this.loadSources('history');
          ownerGroups = await this.collectGroups('history', this.allKeys());
          checkedOwners.clear();
          ownersValidUntil = performance.now() + historyReviewWindowMs;
        }
        owners = [...this.historyGroups.owners(image.key, to) ?? []];
        for (const owner of owners) {
          if (owner === root || checkedOwners.has(owner)) continue;
          const group = await this.inspectGroup(owner, ownerGroups.get(owner)!);
          if (batch.reviewed.get(owner)?.side !== from || !group || !this.reviewedHistory(owner, group, batch))
            throw Error('此截图也用于其他面试记录，已保留两端版本。');
          checkedOwners.add(owner);
        }
      }
      if (!(await this.applyMember(image, choice, check, owners))) return false;
      if (owners) {
        const fresh = await this.options.get('history', image.key);
        const after = conflictVersion((await this.readLocal(fresh)).hash, this.remote.get(image.key));
        batch.written.set(image.key, { before: batch.written.get(image.key)?.before ?? image.version, after });
      }
    }
    if (!(await this.applyMember(rootMember, choice, check))) return false;
    // Commit the reviewed record first. Its guarded transaction releases its old
    // references, so no surviving record ever points at an original removed here.
    let removalsValidUntil = 0;
    for (const previous of images.filter(item => !item[from])) {
      if (performance.now() >= removalsValidUntil) {
        await this.refresh();
        await this.loadSources('history');
        if (!matchesWinners(await this.checkedGroup(root))) return false;
        removalsValidUntil = performance.now() + historyReviewWindowMs;
      }
      if (this.historyGroups.owners(previous.key, from)?.has(root) || this.historyGroups.owners(previous.key, to)?.has(root)) return false;
      if (stillShared(previous.key)) continue;
      const remote = this.remote.get(previous.key);
      check();
      if (to === 'cloud' && remote?.headVersion) {
        if (conflictVersion(previous.storedLocal, remote) !== previous.version) return false;
        await this.call({ action: 'remove', id: remote.id, revision: remote.revision });
        this.remote.delete(previous.key);
      } else if (to === 'local') {
        if (conflictVersion(previous.storedLocal, remote) !== previous.version) return false;
        const hash = previous.storedLocal ?? this.saved.pendingGroups?.[root]?.[previous.key];
        if (hash) await this.options.removeLocal(previous.key, hash, check, root);
      }
      if (!this.historyGroups.owners(previous.key, from)?.size) {
        delete this.saved.baselines[previous.key];
        delete this.marks[previous.key];
        await this.persist();
      }
    }
    await this.refresh();
    await this.loadSources('history');
    const actual = await this.checkedGroup(root);
    check();
    if (!matchesWinners(actual)) return false;
    await this.finishGroup(root);
    batch.completed.add(root);
    return true;
  }
  private async resolveGroup(choice: SyncChoice, batch: HistoryBatch, check: () => void) {
    const root = choice.key;
    const kind = syncKindForKey(root);
    const snapshot = await this.checkedGroup(root, batch.reviewed.has(root));
    check();
    if (!snapshot || (snapshot.version !== choice.version && (kind !== 'history' || !this.reviewedHistory(root, snapshot, batch)))) return false;
    if (snapshot.members.some(({ key }) => this.saved.baselines[key]?.suppressed || this.options.moved?.keys.has(key)))
      throw Error('该类同步已关闭。');
    const winning = (item: GroupMember) => choice.side === 'local' ? item.local : item.cloud;
    const base = snapshot.members.find(item => item.key === root)!;
    if (kind !== 'profile' && !winning(base) && snapshot.members.some(item => winning(item))) throw Error('同步条目无效。');
    if (kind !== 'knowledgebase') {
      const previous = this.saved.pendingGroups?.[root];
      (this.saved.pendingGroups ??= {})[root] = Object.fromEntries(snapshot.members.filter(item => item.key.startsWith('image:'))
        .map(item => [item.key, item.storedLocal ?? previous?.[item.key] ?? null]));
      await this.persist();
    } else if (!this.saved.pendingLibraries?.includes(root)) {
      (this.saved.pendingLibraries ??= []).push(root);
      await this.persist();
    }
    if (kind === 'history') {
      try {
        return await this.resolveHistory(choice, snapshot.members, batch, check);
      } finally {
        if (!this.stopped && this.saved.pendingGroups?.[root]) {
          await this.refresh();
          await this.loadSources(kind);
          await this.checkedGroup(root);
        }
      }
    }
    // Restore/create the winning folder and files before removing losing-only files.
    // An absent winning folder is removed last, after each child was independently checked.
    const ordered = [
      ...(winning(base) ? [base] : []),
      ...snapshot.members.filter(item => item.key !== root && winning(item)),
      ...snapshot.members.filter(item => item.key !== root && !winning(item)),
      ...(!winning(base) ? [base] : []),
    ];
    let complete = true, checkedRemovals = false;
    let cloudBeforeRemovals: string | undefined;
    const reviewed = new Map(snapshot.members.map(item => [item.key, item]));
    for (const item of ordered) {
      check();
      if (!winning(item) && !checkedRemovals) {
        // Transfers above can take minutes. Re-list both sides before the destructive phase.
        checkedRemovals = true;
        await this.refresh();
        await this.loadSources(kind);
        const current = await this.checkedGroup(root);
        if (!current || current.members.length !== reviewed.size || current.members.some(entry => {
          const old = reviewed.get(entry.key);
          if (!old) return true;
          const winner = winning(old);
          return winner ? entry.local !== winner || entry.cloud !== winner : old.version !== entry.version;
        })) {
          complete = false;
          break;
        }
        if (choice.side === 'cloud') {
          cloudBeforeRemovals = this.cloudHeads(current.members.map(entry => entry.key));
          const keys = current.members.filter(entry => !entry.cloud && entry.local).map(entry => entry.key);
          if (kind === 'knowledgebase' && keys.length > 1) {
            complete = await this.removeLocalLibraryMembers(root, current, keys, cloudBeforeRemovals, check);
            break;
          }
        }
      } else if (!winning(item) && item.local && cloudBeforeRemovals !== undefined) {
        // Cloud absence has no compare-and-delete token. Check every later local
        // removal against a fresh cloud listing without rehashing other local originals.
        await this.refresh();
        const currentKeys = await this.checkedGroupKeys(root);
        if (this.cloudHeads(currentKeys) !== cloudBeforeRemovals) {
          complete = false;
          break;
        }
      }
      if (!(await this.applyMember(item, choice, check))) {
        complete = false;
        break;
      }
    }
    await this.refresh();
    await this.loadSources(kind);
    const actual = await this.checkedGroup(root);
    const target = new Map(snapshot.members.filter(item => winning(item)).map(item => [item.key, winning(item)]));
    for (const item of actual?.members ?? []) {
      if (item.local !== target.get(item.key) || item.cloud !== target.get(item.key)) complete = false;
      target.delete(item.key);
    }
    if (!actual || target.size) complete = false;
    check();
    if (complete) await this.finishGroup(root);
    return complete;
  }
  submitResolutions(choices: readonly SyncChoice[]): boolean {
    if (this.stopped || !choices.length || (this.controlPending && !this.resolutionTail)) return false;
    const pendingKeys = new Set(this.resolving.keys());
    const scopes = new Set(this.resolving.values());
    const accepted = choices.map(choice => ({ ...choice }));
    const epochs = { ...this.disableEpoch };
    const locks = new Map<string, string>();
    for (const { key, side, version } of accepted) {
      const group = groupRootKey(key);
      const scope = group ? key : this.parentKey(key) ?? key;
      const current = group ? this.groups.get(key)?.version :
        key.startsWith('file:') && this.marks[key]?.status === 'conflict' ? this.marks[key].conflictVersion : undefined;
      if (!version || current !== version || !this.saved.preferences.enabled[syncKindForKey(key)] ||
          (side !== 'local' && side !== 'cloud') || pendingKeys.has(key) || pendingKeys.has(scope) ||
          (group && scopes.has(key))) return false;
      pendingKeys.add(key);
      scopes.add(scope);
      locks.set(key, scope);
    }
    for (const [key, scope] of locks) this.resolving.set(key, scope);
    const run = async () => {
      if (this.stopped) return;
      try {
        await this.resolveSelected(accepted, (key, complete) => {
          locks.delete(key);
          this.resolving.delete(key);
          if (!complete && !this.stopped && !this.marks[key]?.error && (this.groups.has(key) || this.marks[key]?.status === 'conflict')) {
            this.marks[key] = { ...this.marks[key], status: this.marks[key]?.status ?? 'conflict',
              error: '部分资料未能处理，请核对后重试。' };
          }
          this.emit();
        }, epochs);
      } catch (error) {
        if (!this.stopped) {
          this.error = error instanceof Error ? error.message : '同步失败。';
          for (const key of locks.keys()) {
            if (this.marks[key])
              this.marks[key] = { ...this.marks[key], error: this.error };
          }
        }
      } finally {
        for (const key of locks.keys()) this.resolving.delete(key);
        this.emit(true);
      }
    };
    const tail = this.resolutionTail ? this.resolutionTail.then(run) : run();
    this.resolutionTail = tail;
    void tail.then(() => { if (this.resolutionTail === tail) this.resolutionTail = undefined; });
    this.emit(true);
    return true;
  }
  private async resolveChoice(choice: SyncChoice, batch: HistoryBatch, epoch: number) {
    const { key, version } = choice;
    const kind = syncKindForKey(key);
    if (!this.syncEnabled(kind, epoch) || !version) return false;
    const check = () => {
      this.guard();
      if (!this.syncEnabled(kind, epoch)) throw Error('该类同步已关闭。');
    };
    if (groupRootKey(key)) {
      if (kind === 'history' ? !batch.reviewed.has(key) : this.groups.get(key)?.version !== version) return false;
      try {
        return await this.resolveGroup(choice, batch, check);
      } catch (error) {
        this.guard();
        this.marks[key] = { ...this.marks[key], status: this.marks[key]?.status ?? 'error',
          error: error instanceof Error ? error.message : '同步失败。' };
        return false;
      }
    }
    const mark = this.marks[key];
    if (!key.startsWith('file:') || mark?.status !== 'conflict' || mark.conflictVersion !== version) return false;
    try {
      await this.discoverParents(new Set([key]), true);
      check();
      if (this.crossedParents(key)) throw Error('文件标识已用于其他资料，已保留两端版本。');
    } catch (error) {
      this.guard();
      this.mark(key, 'conflict', error instanceof Error ? error.message : '同步失败。', version);
      return false;
    }
    await this.one(key, choice);
    this.guard();
    const result = this.marks[key]?.status;
    const root = this.parentKey(key);
    if (root && this.groups.has(root)) await this.inspectGroup(root, this.groupKeys(root));
    return !result || result === 'synced' || result === 'paused';
  }
  async resolveSelected(choices: readonly SyncChoice[], settled?: (key: string, complete: boolean) => void,
    epochs = { ...this.disableEpoch }) {
    const selected = new Map(choices.map(choice => [choice.key, choice]));
    let complete = true;
    await this.exclusive(async () => {
      await this.refresh();
      for (const kind of syncKinds) {
        const keys = new Set([...selected.keys()].filter(key => syncKindForKey(key) === kind));
        if (!keys.size) continue;
        await this.loadSources(kind);
        const batch: HistoryBatch = { reviewed: new Map(), written: new Map(), completed: new Set() };
        if (kind === 'history' && this.saved.preferences.enabled.history) {
          const groups = await this.collectGroups(kind, this.allKeys());
          for (const key of keys) {
            const choice = selected.get(key)!;
            const members = groups.get(key);
            const snapshot = members && await this.inspectGroup(key, members);
            if (snapshot && snapshot.version === choice.version) batch.reviewed.set(key, { side: choice.side, snapshot });
          }
        }
        for (const key of this.orderedKeys(kind, keys)) {
          this.guard();
          const done = await this.resolveChoice(selected.get(key)!, batch, epochs[kind]);
          if (!done) complete = false;
          settled?.(key, done);
        }
      }
    });
    return complete;
  }
  async refreshStorage() {
    await this.exclusive(async () => {
      this.error = undefined;
      await this.refreshUsage(true);
    });
  }
  private async recordControlKeys(root: string) {
    const keys = await this.checkedGroupKeys(root);
    // A failed removal can leave cloud-only images after their record is gone.
    for (const [key, baseline] of Object.entries(this.saved.baselines))
      if (key.startsWith('image:') && baseline.suppressed && baseline.parent === root) keys.add(key);
    for (const key of keys) {
      if (!key.startsWith('image:')) continue;
      const owners = [...this.historyGroups.owners(key, 'local') ?? [], ...this.historyGroups.owners(key, 'cloud') ?? []];
      if (!owners.some(owner => owner !== root)) continue;
      keys.delete(key);
      const previous = this.saved.baselines[key];
      if (previous?.suppressed && previous.parent === root) {
        // This suppression belonged to the removed record. Rediscover the image
        // against both surviving sides rather than inferring a local deletion.
        delete this.saved.baselines[key];
        this.mark(key, 'unsynced');
      }
    }
    return keys;
  }
  private async suspendGroup(key: string, remove: boolean) {
    if (!keyValid(key)) throw Error('同步条目无效。');
    await this.exclusive(async () => {
      await this.refresh();
      await this.loadSources(syncKindForKey(key));
      const record = key.startsWith('record:');
      const keys = record ? await this.recordControlKeys(key) :
        key.startsWith('base:') ? await this.checkedGroupKeys(key) : this.groupKeys(key);
      const reviewed = this.remote;
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
        const children = [...keys].filter(target => target !== key);
        // Keep all screenshots intact until the reviewed record is removed.
        const order = remove && record ? [key, ...children] : [...children, key];
        for (const target of order) {
          if (!keys.has(target)) continue;
          const remote = reviewed.get(target);
          if (remove) {
            const current = this.remote.get(target);
            if (current && (current.id !== remote?.id || current.revision !== remote.revision))
              throw Error('资料已变化，请重新选择要保留的版本。');
            if (current && remote)
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
          if (remove && record && target === key && children.length) {
            await this.refresh();
            await this.loadSources('history');
            const remaining = await this.recordControlKeys(key);
            await this.persist();
            if (this.remote.has(key)) throw Error('资料已变化，请重新选择要保留的版本。');
            for (const child of children) if (!remaining.has(child)) keys.delete(child);
          }
        }
        await this.persist();
        await this.refresh();
        if (remove && key.startsWith('base:')) {
          const remaining = await this.checkedGroupKeys(key);
          if ([...remaining].some(member => this.remote.get(member)?.headVersion))
            throw Error('资料已变化，请重新选择要保留的版本。');
        }
      } catch (error) {
        active.clear();
        this.mark(key, 'paused', error instanceof Error ? error.message : '删除失败。');
        throw error;
      }
      active.clear();
      this.mark(key, 'paused');
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
