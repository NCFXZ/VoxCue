import type { ChatMessage } from './preparation';
import type { ChatAttachment, ChatRequestOptions } from './chatOptions';
import { reasoningEfforts, type ReasoningEffort } from '../../electron/contracts/chat';
import {
  validProfile,
  skillSourceIssueReasons,
  profileFields,
  skillProposalEntries,
} from '../../electron/contracts/profile';
import {
  storedObject,
  storedProvider,
  storedActivity,
  storedSources,
  optionalString,
  optionalNumber,
  optionalBoolean,
} from './storedValues';

export interface PreparationConversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  unread?: boolean;
  draft?: string;
  attachments?: ChatAttachment[];
}
export interface ChatSnapshot {
  conversations: PreparationConversation[];
  activeConversation: string | null;
  draft: string;
  attachments: ChatAttachment[];
  modelId: string;
  effort: ReasoningEffort | 'auto';
  webSearch: boolean;
  skillsNeedUpdate?: boolean;
}
type StoredAttachment = Omit<ChatAttachment, 'file'>;
type StoredMessage = Omit<ChatMessage, 'options' | 'profileGeneration'> & {
  options?: Omit<ChatRequestOptions, 'attachments'> & { attachments: StoredAttachment[] };
};
type StoredSnapshot = Omit<ChatSnapshot, 'conversations' | 'attachments'> & {
  version: 1;
  attachments: StoredAttachment[];
  conversations: Array<
    Omit<PreparationConversation, 'messages' | 'attachments'> & {
      messages: StoredMessage[];
      attachments?: StoredAttachment[];
    }
  >;
};
const storedAttachment = (value: unknown): value is StoredAttachment =>
  storedObject(value) &&
  typeof value.id === 'string' &&
  !!value.id &&
  typeof value.name === 'string' &&
  Number.isFinite(value.size) &&
  value.size > 0;
const storedAttachments = (value: unknown) => Array.isArray(value) && value.every(storedAttachment);
function storedMessage(value: unknown) {
  if (
    !storedObject(value) ||
    typeof value.id !== 'string' ||
    !['user', 'assistant'].includes(value.role) ||
    typeof value.content !== 'string'
  )
    return false;
  if (
    !['reasoningSummary', 'error', 'errorCode'].every((key) => optionalString(value[key])) ||
    !['applied', 'dismissed'].every((key) => optionalBoolean(value[key])) ||
    !['startedAt', 'durationMs'].every((key) => optionalNumber(value[key])) ||
    (value.status !== undefined &&
      !['streaming', 'completed', 'stopped', 'failed'].includes(value.status)) ||
    (value.mode !== undefined && !['live', 'mock'].includes(value.mode)) ||
    !storedProvider(value.provider) ||
    !storedActivity(value.activity) ||
    !storedSources(value.sources) ||
    (value.activities !== undefined &&
      (!Array.isArray(value.activities) ||
        !value.activities.every((item) => storedObject(item) && storedActivity(item)))) ||
    (value.profileBase !== undefined && !validProfile(value.profileBase)) ||
    (value.changes !== undefined &&
      (!storedObject(value.changes) ||
        !validProfile({ name: '', background: '', jobDescription: '', ...value.changes })))
  )
    return false;
  if (value.profilePreview !== undefined) {
    if (
      !storedObject(value.profilePreview) ||
      Object.entries(value.profilePreview).some(([key, item]) =>
        key === 'skills'
          ? !Array.isArray(item) ||
            !item.every(
              (skill) =>
                storedObject(skill) &&
                (skill.id === undefined ||
                  (typeof skill.id === 'string' && /^[\w-]{1,64}$/.test(skill.id))) &&
                typeof skill.title === 'string' &&
                typeof skill.content === 'string',
            )
          : typeof item !== 'string',
      )
    )
      return false;
  }
  for (const key of ['selectedProfileFields', 'appliedProfileFields']) {
    const fields = value[key];
    if (fields === undefined) continue;
    if (
      !Array.isArray(fields) ||
      fields.length > profileFields.length ||
      new Set(fields).size !== fields.length ||
      !fields.every(
        (field) => profileFields.includes(field) && value.changes?.[field] !== undefined,
      ) ||
      (key === 'appliedProfileFields' && (!value.applied || !fields.length))
    )
      return false;
  }
  for (const key of ['selectedSkillIds', 'appliedSkillIds']) {
    const ids = value[key];
    if (ids === undefined) continue;
    const entries = skillProposalEntries(
      value.profileBase?.skills ?? [],
      value.changes?.skills ?? [],
    );
    if (
      !Array.isArray(value.changes?.skills) ||
      !Array.isArray(ids) ||
      ids.length > 20 ||
      new Set(ids).size !== ids.length ||
      !ids.every(
        (id) => typeof id === 'string' && entries.some((entry) => entry.skill.id === id),
      ) ||
      (key === 'appliedSkillIds' &&
        (!value.applied || !value.appliedProfileFields?.includes('skills')))
    )
      return false;
  }
  if (
    value.skillSourceIssues !== undefined &&
    (!Array.isArray(value.skillSourceIssues) ||
      value.skillSourceIssues.length > 10 ||
      !value.skillSourceIssues.every(
        (issue) =>
          storedObject(issue) &&
          typeof issue.skillId === 'string' &&
          /^[\w-]{1,64}$/.test(issue.skillId) &&
          value.changes?.skills?.some((skill: { id: string }) => skill.id === issue.skillId) &&
          skillSourceIssueReasons.includes(issue.reason) &&
          Array.isArray(issue.sources) &&
          issue.sources.length <= 10 &&
          storedSources(issue.sources),
      ))
  )
    return false;
  if (
    value.options !== undefined &&
    (!storedObject(value.options) ||
      typeof value.options.modelId !== 'string' ||
      typeof value.options.webSearch !== 'boolean' ||
      !storedAttachments(value.options.attachments) ||
      !optionalString(value.options.modelLabel) ||
      !optionalBoolean(value.options.live) ||
      (value.options.effort !== undefined && !reasoningEfforts.includes(value.options.effort)))
  )
    return false;
  return true;
}
const openDatabase = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('voxcue-preparation-chats', 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('state');
      request.result.createObjectStore('files', { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = request.onblocked = () =>
      reject(Error('无法打开本地聊天存储，现有数据已保留。'));
  });
function completed(tx: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(Error('聊天保存失败，请检查本机存储空间后重试。'));
  });
}
export const localChats = {
  async read(): Promise<ChatSnapshot | null> {
    const db = await openDatabase();
    try {
      const tx = db.transaction(['state', 'files'], 'readonly');
      const done = completed(tx);
      const state = tx.objectStore('state').get('current');
      const files = tx.objectStore('files').getAll();
      await done;
      const saved = state.result as StoredSnapshot | undefined;
      if (!saved) return null;
      if (
        saved.version !== 1 ||
        !Array.isArray(saved.conversations) ||
        !storedAttachments(saved.attachments) ||
        typeof saved.draft !== 'string' ||
        (saved.activeConversation !== null && typeof saved.activeConversation !== 'string') ||
        typeof saved.modelId !== 'string' ||
        (saved.effort !== 'auto' && !reasoningEfforts.includes(saved.effort)) ||
        typeof saved.webSearch !== 'boolean' ||
        !optionalBoolean(saved.skillsNeedUpdate) ||
        !saved.conversations.every(
          (c) =>
            c &&
            typeof c.id === 'string' &&
            typeof c.title === 'string' &&
            optionalString(c.draft) &&
            optionalBoolean(c.unread) &&
            (c.attachments === undefined || storedAttachments(c.attachments)) &&
            Array.isArray(c.messages) &&
            c.messages.every(storedMessage),
        )
      )
        throw Error('本地聊天数据无法读取，原数据已保留，请勿删除应用数据。');
      const originals = new Map<string, { blob: Blob; lastModified: number }>(
        files.result.map((file) => [file.id, file]),
      );
      const restore = (items: StoredAttachment[] = []): ChatAttachment[] =>
        items.map((item) => {
          const original = originals.get(item.id);
          if (!(original?.blob instanceof Blob) || !Number.isFinite(original.lastModified))
            throw Error('聊天附件无法读取，原数据已保留。');
          return {
            ...item,
            file: new File([original.blob], item.name, {
              type: original.blob.type,
              lastModified: original.lastModified,
            }),
          };
        });
      return {
        activeConversation: saved.activeConversation,
        draft: saved.draft,
        modelId: saved.modelId,
        effort: saved.effort,
        webSearch: saved.webSearch,
        skillsNeedUpdate: saved.skillsNeedUpdate,
        attachments: restore(saved.attachments),
        conversations: saved.conversations.map((c) => ({
          ...c,
          attachments: restore(c.attachments),
          messages: c.messages.map((m) => ({
            ...m,
            ...(m.status === 'streaming'
              ? { status: 'stopped' as const, activity: undefined }
              : {}),
            options: m.options
              ? { ...m.options, attachments: restore(m.options.attachments) }
              : undefined,
          })),
        })),
      };
    } finally {
      db.close();
    }
  },
  async write(snapshot: ChatSnapshot): Promise<void> {
    const files = new Map<string, ChatAttachment>();
    const pack = (items: ChatAttachment[] = []): StoredAttachment[] =>
      items.map(({ file, ...item }) => {
        files.set(item.id, { ...item, file });
        return item;
      });
    const saved: StoredSnapshot = {
      ...snapshot,
      version: 1,
      attachments: pack(snapshot.attachments),
      conversations: snapshot.conversations.map((c) => ({
        ...c,
        attachments: pack(c.attachments),
        messages: c.messages.map((m) => {
          const message = { ...m };
          delete message.profileGeneration;
          return {
            ...message,
            ...(message.options
              ? { options: { ...message.options, attachments: pack(message.options.attachments) } }
              : {}),
          };
        }),
      })),
    };
    const db = await openDatabase();
    try {
      const tx = db.transaction(['state', 'files'], 'readwrite');
      const done = completed(tx);
      const store = tx.objectStore('files');
      const existing = store.getAllKeys();
      existing.onsuccess = () => {
        try {
          const keys = new Set(existing.result);
          for (const [id, attachment] of files)
            if (!keys.has(id))
              store.put({ id, blob: attachment.file, lastModified: attachment.file.lastModified });
          for (const id of keys) if (!files.has(String(id))) store.delete(id);
          tx.objectStore('state').put(saved, 'current');
        } catch {
          tx.abort();
        }
      };
      await done;
    } finally {
      db.close();
    }
  },
};
