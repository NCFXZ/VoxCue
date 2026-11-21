import type { AccountDataCall } from '../../electron/contracts/accountData';
import { validImportDocument } from '../../electron/contracts/accountData';
import {
  maxRestoreItems,
  restoreChunkSize,
  restoreLimit,
  validRestoreKey,
} from '../../electron/contracts/restoreData';
import { decodeCloudItem } from './cloudData';
import { stopCloudWork } from './cloudLifecycle';
import { commitWithHistoryImages } from './historyImageRemoval';
import { recoverLocalHistoryImages } from './history';
import { markLocalImportHandled } from './localImportNotice';
import { useCloudAccount } from '../stores/cloudAccount';
import {
  buildImportPlan,
  prepareImportWrites,
  type ImportPayload,
  type ImportPlan,
} from './accountImportPlan';
export type { ImportPreviewEntry } from './accountImportPlan';

async function request(call: AccountDataCall) {
  if (!window.desktop?.accountData) throw Error('请在桌面应用中迁移资料。');
  const result = await window.desktop.accountData(call);
  if (!result.ok) throw Error(result.error);
  return result;
}
function owner() {
  const { user, localMode } = useCloudAccount.getState().state;
  return user?.id ?? (localMode ? 'local' : null);
}
function currentTarget() {
  const id = owner();
  if (!id) throw Error('请登录 VoxCue 或选择本地账户后迁移。');
  return id;
}
function sourceIdFor(ownerId: string) {
  return ownerId === 'local' ? 'local' : 'account:' + ownerId;
}
export async function listAccountImportSources() {
  const target = currentTarget();
  const result = await request({ action: 'listImportSources' });
  if (owner() !== target) throw Error('迁移已取消或账号已变化。');
  if (!result.sources) throw Error('迁移资料无效。');
  return result.sources.filter((source) => source.id !== sourceIdFor(target));
}
export async function openAccountImport(sourceId: string) {
  const target = currentTarget();
  if (sourceId === sourceIdFor(target)) throw Error('请选择其他来源账号。');
  const result = await request({ action: 'openImport', sourceId });
  if (!result.token) throw Error('迁移资料无效。');
  if (owner() !== target || result.requiresPassword !== (sourceId !== 'local')) {
    await closeAccountImport(result.token);
    throw Error(owner() !== target ? '迁移已取消或账号已变化。' : '迁移资料无效。');
  }
  const selection = Object.freeze({
    token: result.token,
    target,
    ...(sourceId === 'local' && result.localRevision
      ? { localRevision: result.localRevision }
      : {}),
    requiresPassword: sourceId !== 'local',
  });
  session = { selection };
  return selection;
}
export type AccountImport = Awaited<ReturnType<typeof openAccountImport>>;
let session: { selection: AccountImport; plan?: ImportPlan; busy?: boolean } | undefined;
const canceled = () => Error('迁移已取消或账号已变化。');
const invalid = () => Error('迁移资料无效。');
function guardSession(selection: AccountImport, active: () => boolean) {
  if (!active() || owner() !== selection.target || !session || session.selection !== selection)
    throw canceled();
  return session;
}
export async function closeAccountImport(token: string, committed = false) {
  if (session?.selection.token === token) session = undefined;
  return request({ action: 'closeImport', token, committed });
}
async function readItem(token: string, key: string, size: number, guard: () => void) {
  if (!Number.isSafeInteger(size) || size < 8 || size > 64 * 1024 ** 2)
    throw Error('迁移资料无效。');
  const chunks: Blob[] = [];
  for (let offset = 0; offset < size;) {
    guard();
    const { bytes } = await request({ action: 'readImport', token, key, offset });
    guard();
    if (
      !ArrayBuffer.isView(bytes) ||
      bytes.BYTES_PER_ELEMENT !== 1 ||
      !bytes.length ||
      bytes.length > Math.min(restoreChunkSize, size - offset)
    )
      throw Error('迁移资料无效。');
    chunks.push(new Blob([new Uint8Array(bytes)]));
    offset += bytes.length;
  }
  return decodeCloudItem(key, new Blob(chunks));
}

export async function previewAccountImport(
  selection: AccountImport,
  password: string | undefined,
  active: () => boolean,
) {
  const guard = () => guardSession(selection, active);
  const state = guard();
  if (state.busy) throw Error('资料操作正在进行，请稍候。');
  state.busy = true;
  state.plan = undefined;
  try {
    const plan = await loadPlan(selection, password, guard);
    guard();
    state.plan = plan;
    return plan.entries.map((entry) => ({ ...entry }));
  } finally {
    state.busy = false;
  }
}
async function loadPlan(selection: AccountImport, password: string | undefined, guard: () => void) {
  const { items } = await request({ action: 'unlockImport', token: selection.token, password });
  guard();
  if (!Array.isArray(items) || items.length > maxRestoreItems) throw invalid();
  const keys = new Set<string>(),
    images = new Set<string>(),
    references = new Set<string>();
  const source: ImportPayload[] = [];
  let total = 0;
  for (const { key, size, document, recordTitle, imageIds } of items) {
    if (
      !validRestoreKey(key) ||
      keys.has(key) ||
      !Number.isSafeInteger(size) ||
      (size < 8 && !(key.startsWith('image:') && size === 0)) ||
      size > 64 * 1024 ** 2 ||
      (total += size) > restoreLimit
    )
      throw invalid();
    keys.add(key);
    if (key.startsWith('image:')) {
      images.add(key.slice(6));
      continue;
    }
    const digest = async () => {
      guard();
      const result = await request({ action: 'digestImportItem', token: selection.token, key });
      guard();
      if (!result.digest || !/^[0-9a-f]{64}$/.test(result.digest)) throw invalid();
      return result.digest;
    };
    if (document) {
      if (!validImportDocument(key, document) || document.size >= size) throw invalid();
      source.push({
        type: 'original', key, document, digest,
        read: async () => {
          const item = await readItem(selection.token, key, size, guard);
          if ((item.type !== 'file' && item.type !== 'resume') ||
              item.document.id !== document.id || item.document.baseId !== document.baseId ||
              item.document.name !== document.name || item.document.type !== document.type ||
              item.document.size !== document.size || item.document.createdAt !== document.createdAt) throw invalid();
          return item.document.blob;
        },
      });
      continue;
    }
    if (recordTitle !== undefined) {
      if (!key.startsWith('record:') || typeof recordTitle !== 'string' || recordTitle.length > 80) throw invalid();
      const ids = imageIds ?? [];
      ids.forEach(id => references.add(id));
      source.push({
        type: 'recordPreview', id: key.slice(7), title: recordTitle, images: ids, digest,
        read: async () => {
          const item = await readItem(selection.token, key, size, guard);
          if (item.type !== 'record' || item.record.title !== recordTitle ||
              item.images.length !== ids.length || item.images.some(id => !ids.includes(id))) throw invalid();
          return item.record;
        },
      });
      continue;
    }
    const item = await readItem(selection.token, key, size, guard);
    if (item.type === 'image') throw invalid();
    if (item.type === 'record') item.images.forEach((id) => references.add(id));
    source.push(item);
  }
  if (images.size !== references.size || [...references].some((id) => !images.has(id)))
    throw Error('迁移资料中的面试截图不完整。');
  return buildImportPlan(source, guard);
}

export async function restoreAccountImport(
  selection: AccountImport,
  keys: readonly string[],
  confirmedConflicts: readonly string[],
  active: () => boolean,
) {
  const guard = () => guardSession(selection, active);
  const state = guard();
  if (state.busy) throw Error('资料操作正在进行，请稍候。');
  state.busy = true;
  const plan = state.plan;
  let remainingLocalRevision: string | undefined;
  let committed = false,
    suspended = false;
  try {
    if (
      !plan ||
      !Array.isArray(keys) ||
      !keys.length ||
      keys.length > plan.entries.length ||
      new Set(keys).size !== keys.length ||
      keys.some((key) => !plan.choices.has(key)) ||
      !Array.isArray(confirmedConflicts) ||
      confirmedConflicts.length > keys.length
    )
      throw invalid();
    const selected = new Set(keys);
    const conflicts = new Set(
      plan.entries
        .filter((entry) => entry.conflict && selected.has(entry.key))
        .map((entry) => entry.key),
    );
    if (
      confirmedConflicts.length !== conflicts.size ||
      new Set(confirmedConflicts).size !== conflicts.size ||
      Array.from(confirmedConflicts).some((key) => !conflicts.has(key))
    )
      throw Error('请确认覆盖所有选中的冲突项。');
    // Only this click may consume the verified snapshot, including its target conflict decisions.
    state.plan = undefined;
    suspended = true;
    await stopCloudWork();
    const writes = await prepareImportWrites(plan, [...selected], guard);
    const commit = async () => {
      guard();
      await request({
        action: 'prepareImportCommit',
        token: selection.token,
        keys: [...selected],
        recordIds: writes.recordIds,
        imageIds: writes.imageIds,
      });
      guard();
      await writes.commit();
      committed = true;
    };
    if (writes.recordIds.length) await commitWithHistoryImages(commit);
    else await commit();
    const types = new Set([...selected].map((key) => key.split(':')[0]));
    if (types.has('base')) types.add('file');
    if (writes.imageIds.length) types.add('image');
    for (const type of types)
      window.dispatchEvent(new CustomEvent('voxcue-sync-applied', { detail: type }));
  } finally {
    try {
      const closed = await closeAccountImport(selection.token, committed);
      remainingLocalRevision = closed.localRevision;
    } finally {
      if (suspended && owner() === selection.target)
        useCloudAccount.setState((state) => ({ revision: state.revision + 1 }));
    }
  }
  if (selection.localRevision && owner() === selection.target) {
    if (remainingLocalRevision) markLocalImportHandled(remainingLocalRevision);
    useCloudAccount.setState(({ state }) => state.localImportRevision === selection.localRevision
      ? { state: { ...state, localImportRevision: remainingLocalRevision } }
      : {});
  }
  if (owner() === selection.target && keys.some(key => key.startsWith('record:'))) {
    // The import is durable. Any failed removals remain in the target's journal for retry.
    await recoverLocalHistoryImages(() => {
      if (owner() !== selection.target) throw Error('迁移已取消或账号已变化。');
    }).catch(() => {});
  }
}
