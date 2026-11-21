import {
  profileFields,
  profileLabels,
  validProfile,
  type PersonalInfo,
  type ProfileField,
} from '../../electron/contracts/profile';
import { useKnowledgeIndex } from '../stores/knowledgeIndex';
import { digestCloudBlob, digestImportRecord, type decodeCloudItem } from './cloudData';
import { historyRepository, type HistorySummary, type InterviewRecord } from './history';
import { sameValue } from './storedEqual';
import {
  documentRevision,
  hasDocumentsDatabase,
  mergeImportedOriginals,
  syncKnowledgeSnapshot,
} from './knowledge';
import { assertLibrariesWritable, deactivateOriginal, holdOriginalReplacements } from './knowledgeIndex';
import type { KnowledgeBase, LocalDocument } from './knowledgeTypes';
import { profileStorageKey, readStoredProfile } from './storedValues';
import type { ImportDocumentInfo } from '../../electron/contracts/accountData';

type DeferredOriginal = { type: 'original'; key: string; document: ImportDocumentInfo; digest(): Promise<string>; read(): Promise<Blob> };
type DeferredRecord = { type: 'recordPreview'; id: string; title: string; images: string[]; digest(): Promise<string>; read(): Promise<InterviewRecord> };
export type ImportPayload = Exclude<Awaited<ReturnType<typeof decodeCloudItem>>, { type: 'image' }> | DeferredOriginal | DeferredRecord;
export interface ImportPreviewEntry {
  key: string;
  group: 'profile' | 'interviews' | 'knowledge';
  title: string;
  conflict: boolean;
}
type Field = ProfileField | 'role';
type Original = {
  next: ImportDocumentInfo;
  read(): Promise<Blob>;
  previous?: LocalDocument;
  changed: boolean;
  nameCollision: boolean;
};
type Choice =
  | { type: 'field'; field: Field; source: PersonalInfo; previous: PersonalInfo }
  | { type: 'recordPreview'; summary: DeferredRecord; previous?: HistorySummary }
  | { type: 'base'; source: KnowledgeBase; previous?: KnowledgeBase; files: Original[] }
  | { type: 'resume'; file: Original };
type PreparedChoice = Exclude<Choice, { type: 'recordPreview' }> |
  { type: 'record'; source: InterviewRecord; previous?: InterviewRecord; images: string[] };
export interface ImportPlan {
  entries: ImportPreviewEntry[];
  choices: ReadonlyMap<string, Choice>;
}
type KnowledgeSnapshot = Awaited<ReturnType<typeof syncKnowledgeSnapshot>>;
const resumeBase = 'personal-resume';
const invalid = () => Error('迁移资料无效。');
const stale = () => Error('迁移期间本地资料已更改，请重试。');

function currentProfile(): PersonalInfo {
  const raw = localStorage.getItem(profileStorageKey);
  return raw ? readStoredProfile(raw) : { name: '', background: '', jobDescription: '' };
}

function fieldValue(profile: PersonalInfo, field: Field) {
  if (field === 'skills')
    return (
      profile.skills?.map(({ title, content, sources }) => ({ title, content, sources })) ?? []
    );
  return profile[field] ?? '';
}
function hasField(profile: PersonalInfo, field: Field) {
  const value = fieldValue(profile, field);
  return typeof value === 'string' ? value.trim().length > 0 : value.length > 0;
}
function fileNameKey(doc: ImportDocumentInfo) {
  return JSON.stringify([doc.baseId, doc.baseId === resumeBase ? '' : doc.name]);
}
function indexKnowledge(snapshot: KnowledgeSnapshot) {
  const byName = new Map<string, LocalDocument>(),
    duplicateNames = new Set<string>();
  for (const doc of snapshot.documents) {
    const key = fileNameKey(doc);
    if (byName.has(key)) duplicateNames.add(key);
    byName.set(key, doc);
  }
  return {
    bases: new Map(snapshot.bases.map((base) => [base.id, base])),
    byId: new Map(snapshot.documents.map((doc) => [doc.id, doc])),
    byName,
    duplicateNames,
  };
}
async function planOriginal(
  source: ImportDocumentInfo,
  target: ReturnType<typeof indexKnowledge>,
  read: () => Promise<Blob>,
  digest: () => Promise<string>,
): Promise<Original> {
  const byId = target.byId.get(source.id);
  const byName = target.byName.get(fileNameKey(source));
  const previous = byId?.baseId === source.baseId ? byId : byName;
  // A name collision within one library is a replacement, as it is for a local file import.
  // Keep its target ID. A matching source ID in an unrelated library belongs to that library.
  const id = previous?.id ?? (byId ? crypto.randomUUID() : source.id);
  const identical =
    previous &&
    previous.name === source.name &&
    previous.size === source.size &&
    (await digestCloudBlob(previous.blob)) === (await digest());
  return {
    // Match the wire field order of a newly imported local document.
    next: {
      id, baseId: source.baseId, name: source.name,
      size: source.size, type: source.type, createdAt: source.createdAt,
    },
    read,
    previous,
    changed: !identical,
    nameCollision:
      target.duplicateNames.has(fileNameKey(source)) ||
      !!(previous && byName && previous.id !== byName.id),
  };
}

export async function buildImportPlan(
  payloads: readonly ImportPayload[],
  guard: () => void,
): Promise<ImportPlan> {
  guard();
  const hasOriginals = payloads.some(
    (item) => item.type === 'base' || item.type === 'resume' || item.type === 'file' || item.type === 'original',
  );
  const target = indexKnowledge(
    hasOriginals && (await hasDocumentsDatabase())
      ? await syncKnowledgeSnapshot()
      : { bases: [], documents: [] },
  );
  const records = new Map(
    (payloads.some((item) => item.type === 'record' || item.type === 'recordPreview') ? await historyRepository.summaries() : []).map((record) => [
      record.id,
      record,
    ]),
  );
  const entries: ImportPreviewEntry[] = [];
  const choices = new Map<string, Choice>();
  const add = (entry: ImportPreviewEntry, choice: Choice) => {
    if (choices.has(entry.key)) throw Error('迁移资料包含重复条目。');
    entries.push(entry);
    choices.set(entry.key, choice);
  };
  const files = new Map<string, Original[]>();
  const ids = new Set<string>(),
    names = new Set<string>();
  for (const item of payloads) {
    if (item.type !== 'file' && item.type !== 'resume' && item.type !== 'original') continue;
    guard();
    const doc = item.document,
      name = fileNameKey(doc);
    if (ids.has(doc.id) || names.has(name)) throw Error('迁移资料包含重复条目。');
    ids.add(doc.id);
    names.add(name);
    const read = item.type === 'original' ? item.read : async () => item.document.blob;
    const original = await planOriginal(doc, target, read, item.type === 'original' ? item.digest : async () => digestCloudBlob(await read()));
    if (item.type === 'resume' || (item.type === 'original' && item.key === 'resume:main')) {
      add(
        {
          key: 'resume:main',
          group: 'profile',
          title: '简历原件',
          conflict: !!original.previous && original.changed,
        },
        { type: 'resume', file: original },
      );
    } else {
      const list = files.get(doc.baseId) ?? [];
      list.push(original);
      files.set(doc.baseId, list);
    }
  }
  for (const item of payloads) {
    if (item.type === 'profile') {
      const profile = currentProfile();
      for (const field of [...profileFields, 'role'] as const) {
        if (!hasField(item.profile, field)) continue;
        const conflict =
          hasField(profile, field) &&
          !sameValue(fieldValue(profile, field), fieldValue(item.profile, field));
        add(
          {
            key: 'profile:' + field,
            group: 'profile',
            title: field === 'role' ? '目标岗位' : profileLabels[field],
            conflict,
          },
          { type: 'field', field, source: item.profile, previous: profile },
        );
      }
    } else if (item.type === 'recordPreview' || item.type === 'record') {
      const summary: DeferredRecord = item.type === 'recordPreview' ? item : {
        type: 'recordPreview', id: item.record.id, title: item.record.title, images: item.images,
        digest: () => digestImportRecord(item.record), read: async () => item.record,
      };
      const previous = records.get(summary.id);
      let conflict = !!previous;
      if (previous && previous.title === summary.title) {
        const record = await historyRepository.get(previous.id, previous.revision);
        if (!record) throw stale();
        conflict = await digestImportRecord(record) !== await summary.digest();
      }
      add({ key: 'record:' + summary.id, group: 'interviews', title: summary.title, conflict },
        { type: 'recordPreview', summary, previous });
    } else if (item.type === 'base') {
      if (item.base.id === resumeBase) throw invalid();
      const previous = target.bases.get(item.base.id);
      const originals = files.get(item.base.id) ?? [];
      files.delete(item.base.id);
      const conflict =
        (!!previous && previous.name !== item.base.name) ||
        originals.some((file) => file.previous && file.changed);
      add(
        { key: 'base:' + item.base.id, group: 'knowledge', title: item.base.name, conflict },
        { type: 'base', source: item.base, previous, files: originals },
      );
    }
  }
  if (files.size) throw Error('迁移文件缺少所属知识库。');
  guard();
  return { entries, choices };
}

/** The previous localStorage values remain available until the IndexedDB transaction commits. */
function publishText(choices: PreparedChoice[]) {
  const writes = new Map<string, string>();
  const fields = choices.filter((choice) => choice.type === 'field');
  if (fields.length) {
    const profile = currentProfile();
    let changed = false;
    for (const { field, source, previous } of fields) {
      if (!sameValue(fieldValue(previous, field), fieldValue(profile, field))) throw stale();
      if (!sameValue(fieldValue(profile, field), fieldValue(source, field))) {
        Object.assign(profile, { [field]: source[field] });
        changed = true;
      }
    }
    if (changed) {
      if (!validProfile(profile)) throw Error('合并后的个人信息超出容量限制，请减少选择后重试。');
      writes.set(profileStorageKey, JSON.stringify(profile));
    }
  }
  const before = new Map<string, string | null>();
  const rollback = () => {
    for (const [key, value] of before) {
      if (localStorage.getItem(key) !== writes.get(key)) continue;
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    }
  };
  try {
    for (const [key, value] of writes) {
      before.set(key, localStorage.getItem(key));
      localStorage.setItem(key, value);
    }
    return rollback;
  } catch (error) {
    rollback();
    throw error;
  }
}

export async function prepareImportWrites(
  plan: ImportPlan,
  keys: readonly string[],
  guard: () => void,
) {
  guard();
  if (!keys.length || keys.length !== new Set(keys).size) throw invalid();
  const selected: PreparedChoice[] = [];
  for (const key of keys) {
    const item = plan.choices.get(key);
    if (!item) throw invalid();
    if (item.type === 'recordPreview') {
      const previous = item.previous && await historyRepository.get(item.previous.id, item.previous.revision);
      if (item.previous && !previous) throw stale();
      const record = await item.summary.read();
      guard();
      selected.push({ type: 'record', source: record, previous, images: item.summary.images });
    } else selected.push(item);
  }
  const records = selected.filter((choice) => choice.type === 'record');
  const libraries = selected.filter((choice) => choice.type === 'base');
  const files = selected.flatMap((choice) =>
    choice.type === 'base' ? choice.files : choice.type === 'resume' ? [choice.file] : [],
  );
  if (
    files.some((file) => file.nameCollision) ||
    new Set(files.map((file) => file.next.id)).size !== files.length
  )
    throw Error('知识库已有同名的其他文档，请重命名后再迁移。');
  const changed = files.filter((file) => file.changed);
  const targetLibraries = new Set([...libraries.map(choice => choice.source.id), ...files.map(file => file.next.baseId)]);
  const guardWrites = () => {
    guard();
    assertLibrariesWritable(targetLibraries);
  };
  guardWrites();
  const originals: LocalDocument[] = [];
  for (const file of changed) {
    const blob = await file.read();
    guard();
    originals.push({ ...file.next, blob });
  }
  const verify = (snapshot: KnowledgeSnapshot) => {
    const current = indexKnowledge(snapshot);
    for (const { previous, source } of libraries)
      if (documentRevision(current.bases.get(source.id)) !== documentRevision(previous))
        throw stale();
    for (const { next, previous } of files) {
      const nameMatch = current.byName.get(fileNameKey(next));
      if (
        (nameMatch && nameMatch.id !== previous?.id) ||
        current.duplicateNames.has(fileNameKey(next)) ||
        documentRevision(current.byId.get(next.id)) !== documentRevision(previous)
      )
        throw stale();
    }
  };
  return {
    recordIds: records.map((choice) => choice.source.id),
    imageIds: [...new Set(records.flatMap((choice) => choice.images))],
    async commit() {
      guardWrites();
      if (!files.length && !libraries.length && !records.length) {
        publishText(selected);
        return;
      }
      const invalidated: string[] = [];
      const release = holdOriginalReplacements(changed.flatMap(({ previous }) => previous ? [previous.id] : []));
      try {
        for (const { previous } of changed) {
          if (!previous) continue;
          guard();
          await deactivateOriginal(previous.id);
          invalidated.push(previous.id);
        }
        guard();
        const bases = libraries
          .filter(({ source, previous }) => previous?.name !== source.name)
          .map(({ source, previous }) => ({
            ...source,
            createdAt: previous?.createdAt ?? source.createdAt,
          }));
        const added = await mergeImportedOriginals(
          bases,
          originals,
          verify,
          () => publishText(selected),
          guardWrites,
          records.length ? { changes: records.map(({ source, previous }) => ({ id: source.id, previous, next: source })) } : undefined,
          !!(libraries.length || files.length),
        );
        // The originals are already committed. A closed account must not enqueue index work in its successor.
        try {
          guard();
        } catch {
          return;
        }
        void useKnowledgeIndex.getState().indexSelection(added, true);
      } catch (error) {
        if (invalidated.length) {
          guard();
          const current = indexKnowledge(await syncKnowledgeSnapshot());
          guard();
          void useKnowledgeIndex.getState().indexSelection(invalidated.flatMap(id => current.byId.get(id) ?? []), true);
        }
        throw error;
      } finally { release(); }
    },
  };
}
