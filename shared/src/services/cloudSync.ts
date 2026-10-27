import {
  CLOUD_CHUNK_BYTES,
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
import { CloudDataConflict, digestCloudBlob, type LocalSyncItem } from './cloudData';

export type SyncStatus =
  'unsynced' | 'synced' | 'syncing' | 'deleting' | 'pausing' | 'conflict' | 'paused' | 'error';
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
class SyncYield extends Error {}

export function readSyncSaved(value: unknown): SyncSaved {
  const empty = { preferences: defaultSyncPreferences(), baselines: {} };
  if (!value || typeof value !== 'object') return empty;
  const saved = value as SyncSaved;
  if (
    !saved.preferences ||
    !saved.preferences.enabled ||
    !syncKinds.every((k) => typeof saved.preferences.enabled[k] === 'boolean') ||
    !number(saved.preferences.knowledgeLimitBytes) ||
    saved.preferences.knowledgeLimitBytes < 1_000_000 ||
    saved.preferences.knowledgeLimitBytes > KNOWLEDGE_MAX_BYTES ||
    !saved.baselines ||
    Object.keys(saved.baselines).length > 8192 ||
    !Object.entries(saved.baselines).every(
      ([key, b]) =>
        keyValid(key) &&
        b &&
        uuidValid(b.id) &&
        number(b.revision) &&
        shaValid(b.hash) &&
        (b.suppressed === undefined || typeof b.suppressed === 'boolean') &&
        (!b.parent || keyValid(b.parent)),
    )
  )
    return empty;
  if (
    saved.uploads &&
    (Object.keys(saved.uploads).length > 4 ||
      !Object.entries(saved.uploads).every(
        ([key, p]) =>
          keyValid(key) &&
          p &&
          uuidValid(p.requestId) &&
          (!p.id || uuidValid(p.id)) &&
          shaValid(p.hash) &&
          number(p.bytes) &&
          p.bytes <= 64 * 1024 ** 2 &&
          number(p.revision),
      ))
  )
    return empty;
  return structuredClone(saved);
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
  private storage?: CloudStorage;
  private stopped = false;
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
  constructor(
    private options: {
      userId: string;
      saved?: unknown;
      request(call: CloudSyncCall): Promise<CloudSyncResult>;
      list(kind: SyncKind): Promise<LocalSyncItem[]>;
      apply(
        key: string,
        blob: Blob,
        expectedHash: string | undefined,
        guard: () => void,
      ): Promise<void>;
      persist(value: SyncSaved): Promise<void>;
      emit(view: SyncView): void;
    },
  ) {
    this.saved = readSyncSaved(options.saved);
    for (const [key, baseline] of Object.entries(this.saved.baselines))
      if (baseline.suppressed) this.marks[key] = { status: 'paused' };
  }
  private guard() {
    if (this.stopped) throw new SyncFailure('同步已停止。');
    if (this.controlPending && !this.controlActive) throw new SyncYield();
  }
  private emit() {
    if (this.stopped) return;
    const marks = Object.fromEntries(
      Object.entries(this.marks).map(([key, mark]) => [
        key,
        { ...mark, cloudPresent: this.remote.has(key) },
      ]),
    );
    const severity: SyncStatus[] = [
      'conflict',
      'error',
      'deleting',
      'pausing',
      'syncing',
      'unsynced',
      'paused',
      'synced',
    ];
    for (const item of this.sources.values()) {
      if (this.saved.baselines[item.key]?.suppressed) {
        marks[item.key] = {
          ...marks[item.key],
          status: this.deleting.has(item.key)
            ? 'deleting'
            : this.pausing.has(item.key)
              ? 'pausing'
              : 'paused',
        };
        continue;
      }
      if (
        !item.key.startsWith('base:') &&
        item.key !== 'profile:main' &&
        !item.key.startsWith('record:')
      )
        continue;
      const children = [...this.sources.values()]
        .filter((i) => i.parent === item.key)
        .map((i) => i.key);
      children.push(...(item.dependencies ?? []));
      const states = [
        this.marks[item.key]?.status || 'unsynced',
        ...children.map((k) => this.marks[k]?.status || 'unsynced'),
      ];
      const status = severity.find((s) => states.includes(s))!;
      marks[item.key] = {
        ...marks[item.key],
        status,
        cloudPresent: this.remote.has(item.key) || children.some((key) => this.remote.has(key)),
      };
    }
    this.options.emit({
      preferences: structuredClone(this.saved.preferences),
      marks,
      storage: this.storage,
      busy: !!this.running,
      error: this.error,
    });
  }
  private mark(key: string, status: SyncStatus, error?: string) {
    this.marks[key] = { status, ...(error ? { error } : {}) };
    this.emit();
  }
  private async persist() {
    this.guard();
    await this.options.persist(structuredClone(this.saved));
    this.guard();
  }
  async configure(preferences: SyncPreferences) {
    const next = readSyncSaved({ preferences, baselines: this.saved.baselines });
    if (JSON.stringify(next.preferences) !== JSON.stringify(preferences))
      throw Error('同步设置无效。');
    this.saved.preferences = next.preferences;
    this.emit();
    await this.persist();
    this.emit();
    void this.request();
  }
  stop() {
    this.stopped = true;
    this.pending = false;
  }
  async idle() {
    await this.running;
  }
  dirty(kind: SyncKind) {
    this.dataEpoch[kind]++;
    for (const [key, mark] of Object.entries(this.marks))
      if (this.keyKind(key) === kind && mark.status !== 'paused')
        this.marks[key] = { status: 'unsynced' };
    this.emit();
  }
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
              if (!this.stopped && !(error instanceof SyncYield))
                this.error = error instanceof Error ? error.message : '同步失败。';
            }
          }
        })
        .finally(() => {
          this.running = undefined;
          this.emit();
        });
      this.emit();
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
      if (result.status === 401) this.stop();
      if (result.status === 429 || result.status === 503)
        this.blockedUntil = Date.now() + Math.max(1, result.retryAfterSeconds || 5) * 1000;
      throw new SyncFailure(result.error, result.status, result.retryAfterSeconds);
    }
    return result.value;
  }
  private async refresh() {
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
        if (this.keyKind(item.name) !== item.kind) throw Error('云端条目分类无效。');
        if (remote.has(item.name)) throw Error('云端存在重名同步条目，请先核对。');
        remote.set(item.name, item);
      }
      if (value.nextCursor !== null && !uuidValid(value.nextCursor)) throw Error('云端分页无效。');
      cursor = value.nextCursor || '';
      if ((cursor && cursors.has(cursor)) || remote.size > 4096 || cursors.size > 82)
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
    const items = await this.options.list(kind);
    this.guard();
    if (items.length > 4096 || items.some((i) => !keyValid(i.key) || i.kind !== kind))
      throw Error('本地同步条目超过保护上限。');
    for (const [key, source] of this.sources) if (source.kind === kind) this.sources.delete(key);
    for (const item of items) this.sources.set(item.key, item);
    return items;
  }
  private async cycle() {
    await this.refresh();
    if (!syncKinds.some((k) => this.saved.preferences.enabled[k])) return;
    for (const kind of syncKinds) {
      if (!this.saved.preferences.enabled[kind]) continue;
      const items = await this.loadSources(kind);
      const keys = new Set([
        ...items.map((i) => i.key),
        ...[...this.remote].filter(([, r]) => r.kind === kind).map(([key]) => key),
        ...Object.keys(this.saved.baselines).filter((key) => this.keyKind(key) === kind),
      ]);
      const ordered = this.orderedKeys(kind, keys);
      for (const key of ordered) {
        if (Date.now() < this.blockedUntil) return;
        if (!this.saved.preferences.enabled[kind]) break;
        if (kind !== 'profile') await this.profileFirst();
        await this.one(key);
      }
    }
    await this.refresh();
  }
  private orderedKeys(kind: SyncKind, keys: Set<string>) {
    const ordered = new Set<string>();
    const add = (key: string) => {
      if (keys.has(key)) ordered.add(key);
    };
    if (kind === 'knowledgebase') {
      const children = new Map<string, string[]>();
      for (const key of keys) {
        const parent = this.sources.get(key)?.parent || this.saved.baselines[key]?.parent;
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
    for (const [child, source] of this.sources) if (source.parent === key) keys.add(child);
    for (const [child, baseline] of Object.entries(this.saved.baselines))
      if (!this.sources.has(child) && baseline.parent === key) keys.add(child);
    for (const dependency of this.sources.get(key)?.dependencies ?? [])
      if (
        ![...this.sources.values()].some(
          (source) => source.key !== key && source.dependencies?.includes(dependency),
        )
      )
        keys.add(dependency);
    if (keys.size > 4096) throw Error('同步条目超过保护上限。');
    return keys;
  }
  private keyKind(key: string): SyncKind {
    return /^(profile|resume):/.test(key)
      ? 'profile'
      : /^(record|image):/.test(key)
        ? 'history'
        : 'knowledgebase';
  }
  private async profileFirst() {
    if (!this.saved.preferences.enabled.profile) return;
    const item = (await this.options.list('profile')).find((i) => i.key === 'profile:main');
    this.guard();
    if (item) {
      this.sources.set(item.key, item);
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
  private async one(key: string, choice?: 'local' | 'cloud') {
    this.guard();
    const epoch = this.dataEpoch[this.keyKind(key)];
    const source = this.sources.get(key),
      remote = this.remote.get(key);
    let baseline = this.saved.baselines[key];
    const parent = source?.parent || baseline?.parent;
    if ((baseline?.suppressed || (parent && this.saved.baselines[parent]?.suppressed)) && !choice) {
      this.mark(key, 'paused', this.marks[key]?.error);
      return;
    }
    let hash: string | undefined;
    try {
      const committed = this.saved.uploads?.[key];
      if (committed && remote?.headVersion && committed.hash === remote.sha256) {
        baseline = this.saved.baselines[key] = {
          id: remote.id,
          revision: remote.revision,
          hash: committed.hash,
          ...(source?.parent ? { parent: source.parent } : {}),
        };
        delete this.saved.uploads![key];
        await this.persist();
      }
      const blob = source ? await source.blob() : undefined;
      this.guard();
      hash = blob ? await digestCloudBlob(blob) : undefined;
      this.guard();
      const failed = this.failed.get(key);
      if (!choice && failed && failed.hash === hash && failed.until > Date.now()) return;
      let action = decideSync(hash, remote?.headVersion ? remote.sha256! : undefined, baseline);
      if (choice === 'local') action = blob ? 'push' : 'delete';
      if (choice === 'cloud') action = remote?.headVersion ? 'pull' : 'pause';
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
          this.saved.baselines[key] = {
            id: remote.id,
            revision: remote.revision,
            hash,
            ...(source?.parent ? { parent: source.parent } : {}),
          };
          await this.persist();
          if (epoch !== this.dataEpoch[this.keyKind(key)]) {
            this.pending = true;
            this.mark(key, 'unsynced');
          } else this.mark(key, 'synced');
        } else {
          delete this.saved.baselines[key];
          await this.persist();
          delete this.marks[key];
        }
        return;
      }
      this.mark(key, 'syncing');
      if (action === 'delete') {
        if (remote) await this.call({ action: 'remove', id: remote.id, revision: remote.revision });
        this.remote.delete(key);
        delete this.saved.baselines[key];
        await this.persist();
        delete this.marks[key];
        return;
      }
      if (action === 'push' && blob && hash) {
        if (source?.dependencies?.some((key) => this.marks[key]?.status !== 'synced'))
          throw Error('此记录的截图尚未全部同步，已保留本地完整记录。');
        // The server atomically reserves the shared account budget before any chunks
        // are sent, including old versions and resumable uploads already held there.
        const id = remote?.id || (await this.id(key));
        if (!remote) await this.call({ action: 'create', id, kind: this.keyKind(key), key });
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
            if (Object.keys(this.saved.uploads).length >= 4)
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
            if (this.keyKind(key) !== 'profile') await this.profileFirst();
            if (!this.saved.preferences.enabled[this.keyKind(key)]) throw Error('该类同步已关闭。');
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
            ...(remote ?? { kind: this.keyKind(key), name: key, createdAt: Date.now() }),
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
            ...(source?.parent ? { parent: source.parent } : {}),
          };
          await this.persist();
          delete this.saved.uploads[key];
          await this.persist();
          // Retire old transport versions after the new head is durable. Never delete the current head first.
          const versions = await this.call({ action: 'versions', id });
          if (!Array.isArray(versions.items) || versions.items.length > 20)
            throw Error('云端版本响应无效。');
          for (const version of versions.items)
            if (uuidValid(version.id) && version.id !== done.versionId)
              await this.call({ action: 'prune', id, version: version.id });
          this.storageDirty = true;
          await this.refreshUsage();
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
        const manifest = (await this.call({
          action: 'manifest',
          id: remote.id,
          version: remote.headVersion,
        })) as CloudManifest;
        if (
          manifest.bytes !== remote.bytes ||
          manifest.sha256 !== remote.sha256 ||
          manifest.chunkBytes !== CLOUD_CHUNK_BYTES ||
          !number(manifest.bytes) ||
          manifest.bytes > 64 * 1024 ** 2 ||
          !Array.isArray(manifest.parts) ||
          manifest.parts.length !== Math.ceil(manifest.bytes / CLOUD_CHUNK_BYTES)
        )
          throw Error('云端清单无效。');
        const chunks: BlobPart[] = [];
        for (let index = 0; index < manifest.parts.length; index++) {
          if (this.keyKind(key) !== 'profile') await this.profileFirst();
          const bytes = await this.call({
            action: 'read',
            id: remote.id,
            version: remote.headVersion,
            index,
          });
          if (
            !(bytes instanceof Uint8Array) ||
            bytes.byteLength !==
              Math.min(CLOUD_CHUNK_BYTES, manifest.bytes - index * CLOUD_CHUNK_BYTES) ||
            manifest.parts[index].index !== index ||
            (await digestCloudBlob(new Blob([new Uint8Array(bytes)]))) !==
              manifest.parts[index].sha256
          )
            throw Error('云端分块校验失败，本地数据已保留。');
          chunks.push(new Uint8Array(bytes));
        }
        const download = new Blob(chunks);
        if ((await digestCloudBlob(download)) !== manifest.sha256)
          throw Error('云端数据完整性校验失败。');
        const current = (await this.options.list(this.keyKind(key))).find((i) => i.key === key);
        if ((current ? await digestCloudBlob(await current.blob()) : undefined) !== hash) {
          this.mark(key, 'conflict');
          return;
        }
        this.guard();
        await this.options.apply(key, download, hash, () => this.guard());
        this.guard();
        this.saved.baselines[key] = {
          id: remote.id,
          revision: remote.revision,
          hash: manifest.sha256,
        };
        await this.persist();
      }
      this.failed.delete(key);
      if (epoch !== this.dataEpoch[this.keyKind(key)]) {
        this.pending = true;
        this.mark(key, 'unsynced');
      } else this.mark(key, 'synced');
    } catch (error) {
      if (error instanceof SyncYield) throw error;
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
      this.emit();
      if (this.pending && !this.stopped) void this.request();
    }
  }
  async resolve(key: string, choice: 'local' | 'cloud') {
    if (!keyValid(key)) throw Error('同步条目无效。');
    await this.exclusive(async () => {
      await this.refresh();
      await this.loadSources(this.keyKind(key));
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
      await this.loadSources(this.keyKind(key));
      const keys = this.groupKeys(key);
      for (const target of keys) {
        const remote = this.remote.get(target);
        this.saved.baselines[target] = {
          id: remote?.id || (await this.id(target)),
          revision: remote?.revision || 0,
          hash: remote?.sha256 || '0'.repeat(64),
          suppressed: true,
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
            if (pending && remote) {
              try {
                const upload = pending.id
                  ? { id: pending.id }
                  : await this.call({
                      action: 'begin',
                      id: remote.id,
                      requestId: pending.requestId,
                      bytes: pending.bytes,
                      sha256: pending.hash,
                      revision: pending.revision,
                    });
                await this.call({ action: 'abort', id: upload.id });
              } catch (error) {
                if (!(error instanceof SyncFailure) || ![404, 409, 410].includes(error.status))
                  throw error;
              }
            }
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
      if (!this.saved.preferences.enabled[this.keyKind(key)])
        throw Error('请先在「设置 → 云同步」中开启对应同步。');
      await this.refresh();
      const sources = await this.loadSources(this.keyKind(key));
      const parent =
        sources.find((source) => source.key === key)?.parent || this.saved.baselines[key]?.parent;
      if (parent && this.saved.baselines[parent]?.suppressed)
        throw Error(
          `请先恢复所属${parent.startsWith('base:') ? '知识库' : '个人信息'}的自动同步。`,
        );
      for (const target of this.groupKeys(key)) {
        if (this.remote.get(target)?.headVersion && this.saved.baselines[target])
          this.saved.baselines[target].suppressed = false;
        else delete this.saved.baselines[target];
      }
      this.failed.clear();
      await this.persist();
    });
    await this.request(true);
  }
}
