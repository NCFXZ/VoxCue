import { withinImportItemLimit, type SourceRemovalPlan, type SourceRemovalResult } from '../../electron/contracts/accountData';
import { profileFields, type PersonalInfo } from '../../electron/contracts/profile';
import { validRestoreKey } from '../../electron/contracts/restoreData';
import { digestCloudBlob } from './cloudData';
import { recoverInterviewDrafts } from './interviewDraft';
import { documentRevision, removeMovedOriginals } from './knowledge';
import { localRevision } from './localImportRevision';
import { movedProfileHash, recordMovedCloudItems } from './migrationSyncProtection';
import type { captureImportSource } from './profileImportReader';
import { profileStorageKey, readStoredProfile } from './storedValues';

type Source = Awaited<ReturnType<typeof captureImportSource>>;
type Row = SourceRemovalPlan['items'][number];
type Field = keyof PersonalInfo;
const fields: readonly string[] = [...profileFields, 'role'];
const invalid = () => Error('迁移资料无效。');
const stale = () => Error('来源资料已改变，请重新选择。');
const resume = 'personal-resume';
const selectedBaseKey = 'copilot-interview-knowledge-base-v1';

/** Fingerprint the authorized snapshot, including the membership and originals of selected libraries. */
export async function planSourceRemoval(
  source: Source,
  keys: string[],
  allowAbsent = false,
): Promise<SourceRemovalPlan> {
  if (
    !Array.isArray(keys) ||
    !keys.length ||
    !withinImportItemLimit(keys, key => key) ||
    new Set(keys).size !== keys.length
  )
    throw invalid();
  const selected = new Set(keys);
  const profile = source.profile ? readStoredProfile(source.profile) : undefined;
  const entries = new Map(source.entries.map((entry) => [entry.key, entry]));
  const resumeDoc = source.snapshot.documents.find((doc) => doc.baseId === resume);
  const items: Row[] = [];
  for (const key of selected) {
    if (typeof key !== 'string') throw invalid();
    if (key.startsWith('profile:')) {
      const field = key.slice(8) as Field;
      if (!fields.includes(field)) throw invalid();
      const value = profile?.[field];
      if (typeof value === 'string' ? value.trim() : value?.length) {
        items.push({ key, hash: await digestCloudBlob(new Blob([JSON.stringify(value)])) });
      } else if (!allowAbsent) throw invalid();
      continue;
    }
    if (!validRestoreKey(key) || !(key === 'resume:main' || /^(?:record|base):/.test(key)))
      throw invalid();
    const entry = entries.get(key);
    if (!entry) {
      if (!allowAbsent) throw invalid();
      continue;
    }
    const row: Row = { key, hash: await digestCloudBlob(await source.blobFor(entry)) };
    if (key === 'resume:main') {
      if (!resumeDoc) throw invalid();
      row.documentId = resumeDoc.id;
    }
    if (entry.imageIds?.length) row.imageIds = entry.imageIds;
    items.push(row);
  }
  for (const entry of source.entries) {
    if (!entry.key.startsWith('file:') || !entry.parent || !selected.has(entry.parent)) continue;
    items.push({
      key: entry.key,
      baseId: entry.parent.slice(5),
      hash: await digestCloudBlob(entry.blob!),
    });
  }
  if (!withinImportItemLimit(items, row => row.key)) throw invalid();
  return { items };
}

export async function removeSourceSelection(
  source: Source,
  plan: SourceRemovalPlan,
  owner: string,
): Promise<SourceRemovalResult> {
  if (owner !== 'local' && !/^account:[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(owner))
    throw invalid();
  const rows = new Map<string, Row>();
  if (!Array.isArray(plan?.items) || !withinImportItemLimit(plan.items, row => row?.key))
    throw invalid();
  for (const row of plan.items) {
    if (
      !row ||
      typeof row.key !== 'string' ||
      rows.has(row.key) ||
      !/^[a-f0-9]{64}$/.test(row.hash)
    )
      throw invalid();
    rows.set(row.key, row);
  }
  const keys = [...rows.keys()].filter((key) => !key.startsWith('file:'));
  const current = await planSourceRemoval(source, keys, true);
  // A missing original may already have been cleared before the last process stopped.
  // A new file in a selected library or a replacement with the same ID must survive.
  for (const row of current.items) {
    const before = rows.get(row.key);
    if (
      !before ||
      before.hash !== row.hash ||
      before.documentId !== row.documentId ||
      before.baseId !== row.baseId ||
      JSON.stringify(before.imageIds ?? []) !== JSON.stringify(row.imageIds ?? [])
    )
      throw stale();
  }
  const baseIds = new Set<string>(),
    recordIds = new Set<string>(),
    docIds = new Set<string>();
  const movedFields: Field[] = [];
  const images = new Set<string>();
  const byDocument = new Map(source.snapshot.documents.map((doc) => [doc.id, doc]));
  for (const row of rows.values()) {
    const { key } = row;
    if (key.startsWith('profile:')) movedFields.push(key.slice(8) as Field);
    if (key.startsWith('base:')) baseIds.add(key.slice(5));
    if (key.startsWith('record:')) {
      recordIds.add(key.slice(7));
      for (const id of row.imageIds ?? []) images.add(id);
    }
    if (key === 'resume:main' || key.startsWith('file:')) {
      const id = key === 'resume:main' ? row.documentId : key.slice(5);
      const base = key === 'resume:main' ? resume : row.baseId;
      if (
        !id ||
        !validRestoreKey('file:' + id) ||
        !base ||
        (key !== 'resume:main' && (!validRestoreKey(key) || !rows.has('base:' + base)))
      )
        throw invalid();
      const doc = byDocument.get(id);
      if (doc && doc.baseId !== base) throw stale();
      docIds.add(id);
    }
  }
  if (recordIds.size) await recoverInterviewDrafts(recordIds);
  const changes = [];
  for (const summary of source.history.rows) {
    if (recordIds.has(summary.id)) changes.push({ id: summary.id, previous: await source.history.read(summary) });
    else for (const id of summary.imageIds) images.delete(id);
  }
  const writes = new Map<string, string>();

  if (source.profile && movedFields.length) {
    // Preserve the stored representation of unselected fields, including legacy formats.
    const profile = JSON.parse(source.profile);
    for (const field of movedFields) {
      if (['name', 'background', 'jobDescription'].includes(field)) profile[field] = '';
      else delete profile[field];
    }
    writes.set(profileStorageKey, JSON.stringify(profile));
  }
  const cloudKeys = [...rows.keys()].filter((key) => !key.startsWith('profile:'));
  for (const id of images) cloudKeys.push('image:' + id);
  const nextProfile = writes.get(profileStorageKey);
  const profileChange = owner !== 'local' && source.profile && nextProfile && nextProfile !== source.profile
    ? { before: await movedProfileHash(source.profile), after: await movedProfileHash(nextProfile) }
    : undefined;
  const publish = () => {
    if (
      source.profile !== localStorage.getItem(profileStorageKey)
    )
      throw stale();
    const selectedBase = localStorage.getItem(selectedBaseKey);
    if (selectedBase && [...baseIds].some((id) => JSON.stringify(id) === selectedBase))
      writes.set(selectedBaseKey, 'null');
    const undoCloud =
      owner === 'local' ? undefined : recordMovedCloudItems(owner, cloudKeys, movedFields, profileChange);
    const before = new Map<string, string | null>();
    const rollback = () => {
      for (const [key, value] of before) {
        if (localStorage.getItem(key) !== writes.get(key)) continue;
        if (value === null) localStorage.removeItem(key);
        else localStorage.setItem(key, value);
      }
      undoCloud?.();
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
  };
  const revisions = (snapshot: Source['snapshot']) =>
    JSON.stringify([
      snapshot.bases
        .filter((base) => baseIds.has(base.id))
        .map((base) => [base.id, documentRevision(base)]),
      snapshot.documents
        .filter(
          (doc) =>
            docIds.has(doc.id) ||
            baseIds.has(doc.baseId) ||
            (rows.has('resume:main') && doc.baseId === resume),
        )
        .map((doc) => [doc.id, doc.baseId, documentRevision(doc)]),
    ]);
  const expected = revisions(source.snapshot);
  await removeMovedOriginals(
    baseIds,
    docIds,
    (snapshot) => {
      if (revisions(snapshot) !== expected) throw stale();
    },
    publish,
    recordIds.size ? {
      expectedDirectory: source.history.rows,
      changes,
    } : undefined,
  );
  return {
    imageIds: [...images],
    recordIds: [...recordIds],
    documentIds: [...docIds],
    localRevision: owner === 'local' ? await localRevision() : null,
  };
}
