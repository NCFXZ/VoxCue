import { t, uiLocale } from '../i18n';
import { historyRepository } from './history';
import { localKnowledge, readKnowledgeDocumentNames } from './knowledge';

const categories: Record<string, string> = {
  profile: '个人信息', resume: '简历原件', record: '面试记录',
  image: '截图', base: '知识库', file: '知识库文件',
};
const idOf = (key: string) => key.slice(key.indexOf(':') + 1);
const categoryOf = (kind: string) => Object.hasOwn(categories, kind) ? categories[kind] : '同步条目';
const describe = (kind: string, name: string) => t(categories[kind]) + ' · ' + name;

export function fallbackSyncItemName(key: string): string {
  const kind = key.split(':', 1)[0];
  if (key === 'profile:main' || key === 'resume:main') return t(categories[kind]);
  return t(categoryOf(kind)) + ' · ' + idOf(key).slice(-8);
}

export async function loadSyncItemNames(keys: readonly string[]): Promise<Record<string, string>> {
  const requested = new Set(keys);
  const names = new Map(Array.from(requested, key => [key, fallbackSyncItemName(key)]));
  const fileIds = Array.from(requested).filter(key => key.startsWith('file:')).map(idOf);
  const has = (prefix: string) => keys.some(key => key.startsWith(prefix));
  const includeImages = has('image:');
  const [history, bases, documents, resume] = await Promise.all([
    has('record:') || includeImages ? historyRepository.summaries().catch(() => []) : [],
    has('base:') || fileIds.length ? localKnowledge.listBases().catch(() => []) : [],
    fileIds.length ? readKnowledgeDocumentNames(fileIds).catch(() => []) : [],
    requested.has('resume:main') ? localKnowledge.listDocuments('personal-resume').catch(() => []) : [],
  ]);
  if (resume[0]?.name) names.set('resume:main', describe('resume', resume[0].name));
  const baseNames = new Map(bases.map(base => [base.id, base.name]));
  for (const { id, name } of bases) {
    if (requested.has('base:' + id) && name) names.set('base:' + id, name);
  }
  for (const { id, baseId, name } of documents) {
    const library = baseNames.get(baseId);
    if (name) names.set('file:' + id, describe('file', library ? library + ' / ' + name : name));
  }
  const foundImages = new Set<string>();
  for (const record of history) {
    const recordKey = 'record:' + record.id;
    if (!requested.has(recordKey) && (!includeImages || !record.imageIds.length)) continue;
    const title = record.title.trim() || new Date(record.startedAt).toLocaleString(uiLocale(), {
      dateStyle: 'short', timeStyle: 'short',
    });
    if (requested.has(recordKey)) names.set(recordKey, title);
    if (!includeImages) continue;
    for (const [index, id] of record.imageIds.entries()) {
      const key = 'image:' + id;
      if (requested.has(key) && !foundImages.has(id)) {
        const number = record.imageIds.length > 1 ? ' · ' + (index + 1) : '';
        names.set(key, describe('image', title + number));
        foundImages.add(id);
      }
    }
  }
  // Documents and interviews may share names. Deleted local items may even
  // share the same short ID. Keep every selectable row distinguishable.
  const duplicates = new Map<string, string[]>();
  for (const [key, name] of names) {
    const group = duplicates.get(name);
    if (group) group.push(key);
    else duplicates.set(name, [key]);
  }
  for (const [name, group] of duplicates) {
    if (group.length < 2) continue;
    const short = new Set(group.map(key => idOf(key).slice(-8))).size === group.length;
    for (const key of group) {
      const id = idOf(key);
      const label = name === fallbackSyncItemName(key) ? t(categoryOf(key.split(':', 1)[0])) : name;
      names.set(key, label + ' · ' + (short ? id.slice(-8) : id));
    }
  }
  return Object.fromEntries(names);
}
