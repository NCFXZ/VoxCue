import { validLocalImportRevision } from '../../electron/contracts/cloudAccount';
import { profileFields, profileValue } from '../../electron/contracts/profile';
import { historyStorageKey, historyRepository, subscribeHistoryChanges } from './history';
import { documentRevision, hasDocumentsDatabase, syncKnowledgeSnapshot } from './knowledge';
import { hasSavedProfile, profileStorageKey, readStoredProfile } from './storedValues';

const markerKey = 'voxcue-local-import-marker-v1';
const categories = ['profile', 'history', 'knowledgebase'] as const;
type Category = (typeof categories)[number];

async function readCategory(category: Category): Promise<unknown[]> {
  if (category === 'history') return (await historyRepository.summaries()).map(({ id, revision }) => [id, revision]);
  if (category === 'profile') {
    const raw = localStorage.getItem(profileStorageKey);
    const info = raw ? readStoredProfile(raw) : undefined;
    return info && hasSavedProfile(info)
      ? [info.role ?? '', ...profileFields.map((field) => profileValue(info, field))]
      : [];
  }
  const snapshot = await hasDocumentsDatabase()
    ? await syncKnowledgeSnapshot()
    : { bases: [], documents: [] };
  const bases = snapshot.bases.filter((base) => base.id !== 'personal-resume');
  const baseIds = new Set(bases.map((base) => base.id));
  const documents = snapshot.documents.filter(
    (doc) => doc.blob?.size && (doc.baseId === 'personal-resume' || baseIds.has(doc.baseId)),
  );
  // IndexedDB returns the stored Blob handles. Use each original's committed revision without reading its bytes.
  return !bases.length && !documents.length ? [] : [
    bases.map((base) => [base.id, base.name, base.createdAt]),
    documents.map((doc) => [doc.id, doc.baseId, documentRevision(doc)]),
  ];
}

async function digest(value: unknown[]) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function updateRevision(changed: readonly Category[]): Promise<string | null> {
  const stored = localStorage.getItem(markerKey);
  const [previous, revision] = (stored ?? '').split(':');
  const valid = validLocalImportRevision(revision);
  const cached = previous.split('.');
  const reusable = valid && cached.length === categories.length &&
    cached.every((part, index) => part === '-' || /^[0-9a-f]{64}$/.test(part) || (index === 1 && /^v2-[0-9a-f]{64}$/.test(part)));
  const legacy = valid && /^[0-9a-f]{64}$/.test(previous);
  const values: unknown[][] = [];
  let priorHistoryMatches = false;
  const hashes = await Promise.all(categories.map(async (category, index) => {
    if (reusable && !changed.includes(category)) return cached[index];
    const value = await readCategory(category);
    if (category === 'history' && (legacy || (reusable && /^[0-9a-f]{64}$/.test(cached[index])))) {
      const records = await historyRepository.list();
      if (legacy) values[index] = records;
      else priorHistoryMatches = cached[index] === await digest(records);
    } else if (legacy) values[index] = value;
    if (!value.length) return '-';
    const hash = await digest(value);
    return category === 'history' ? 'v2-' + hash : hash;
  }));
  const fingerprint = hashes.join('.');
  // One-time upgrade: keep a dismissed reminder dismissed when the old snapshot still matches.
  const matchesLegacy = legacy && previous === await digest([
    values[0].length ? values[0] : null, values[1], ...(values[2].length ? values[2] : [[], []]),
  ]);
  if (localStorage.getItem(markerKey) !== stored) return localRevision();
  if (hashes.every(part => part === '-')) {
    if (stored !== null) localStorage.removeItem(markerKey);
    return null;
  }
  if (valid && previous === fingerprint) return revision;
  const onlyHistoryFormatChanged = priorHistoryMatches && cached[0] === hashes[0] && cached[2] === hashes[2];
  const next = matchesLegacy || onlyHistoryFormatChanged ? revision : crypto.randomUUID();
  localStorage.setItem(markerKey, fingerprint + ':' + next);
  return next;
}

/** Startup, explicit flushes and the authorized migration source verify every category. */
export function localRevision() {
  return updateRevision(categories);
}

let pending: Promise<void> | undefined;
const dirty = new Set<Category>();
export function refreshLocalImportRevision(changed: readonly Category[] = categories): Promise<void> {
  if (!window.desktop?.setLocalImportRevision) return Promise.resolve();
  for (const category of changed) dirty.add(category);
  return (pending ??= (async () => {
    while (dirty.size) {
      const work = [...dirty];
      dirty.clear();
      try {
        const revision = await updateRevision(work);
        if (!dirty.size) await window.desktop!.setLocalImportRevision(revision);
      } catch (error) {
        for (const category of work) dirty.add(category);
        throw error;
      }
    }
  })().finally(() => {
    pending = undefined;
  }));
}

export function observeLocalImportRevision(onError: () => void) {
  let timer: ReturnType<typeof setTimeout>;
  let active = true;
  const changed = new Set<Category>(categories);
  const refresh = () => {
    const work = [...changed];
    changed.clear();
    void refreshLocalImportRevision(work).catch(() => {
      if (active) onError();
    });
  };
  const schedule = (parts: readonly Category[]) => {
    for (const part of parts) changed.add(part);
    clearTimeout(timer);
    timer = setTimeout(refresh, 150);
  };
  const localChange = (event: Event) => {
    const detail = (event as CustomEvent).detail;
    if (detail?.kind === 'profile') {
      const keys = detail.keys;
      if (Array.isArray(keys) && keys.length && keys.every(key => key === 'resume:main' || key === 'profile:main')) {
        schedule(keys.map(key => key === 'resume:main' ? 'knowledgebase' : 'profile'));
        return;
      }
    } else if (detail?.kind === 'history' || detail?.kind === 'knowledgebase') {
      schedule([detail.kind]);
      return;
    }
    schedule(categories);
  };
  const applied = (event: Event) => {
    switch ((event as CustomEvent).detail) {
      case 'profile': return schedule(['profile']);
      case 'record': return schedule(['history']);
      case 'base': case 'file': case 'resume': return schedule(['knowledgebase']);
      case 'image': return; // The marker includes record image references; the image payload is separate.
      default: return schedule(categories);
    }
  };
  const otherWindow = (event: StorageEvent) => {
    if (event.key === null) schedule(categories);
    if (event.key === profileStorageKey) schedule(['profile']);
    if (event.key === historyStorageKey) schedule(['history']);
  };
  refresh();
  window.addEventListener('voxcue-local-change', localChange);
  window.addEventListener('voxcue-sync-applied', applied);
  window.addEventListener('storage', otherWindow);
  const stopHistory = subscribeHistoryChanges(() => schedule(['history']));
  return () => {
    active = false;
    stopHistory();
    clearTimeout(timer);
    window.removeEventListener('voxcue-local-change', localChange);
    window.removeEventListener('voxcue-sync-applied', applied);
    window.removeEventListener('storage', otherWindow);
  };
}
