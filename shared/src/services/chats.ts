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
export type StoredSnapshot = Omit<ChatSnapshot, 'conversations' | 'attachments'> & {
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
export function storedMessage(value: unknown) {
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
export function validateChatSnapshot(saved: unknown): asserts saved is StoredSnapshot {
  if (
    !storedObject(saved) ||
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
}
export const openChatDatabase = () =>
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
type ConversationRow = StoredSnapshot['conversations'][number];
type ChatDirectory = Omit<StoredSnapshot, 'version' | 'conversations'> & {
  version: 2;
  index: { id: string; files: string[] }[];
};
const damagedDirectory = () => Error('本地聊天目录无法读取，原数据已保留。');
function validateDirectory(directory: ChatDirectory) {
  validateChatSnapshot({ ...directory, version: 1, conversations: [] });
  if (!Array.isArray(directory.index) || !directory.index.every(entry =>
    entry && typeof entry.id === 'string' && Array.isArray(entry.files) &&
    entry.files.every(id => typeof id === 'string') && new Set(entry.files).size === entry.files.length))
    throw damagedDirectory();
  if (new Set(directory.index.map(entry => entry.id)).size !== directory.index.length)
    throw damagedDirectory();
}
function result<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function storedBase(store: IDBObjectStore): Promise<StoredSnapshot | undefined> {
  const header = await result(store.get('current')) as ChatDirectory | StoredSnapshot | undefined;
  if (!header) return;
  if (header.version === 1) {
    validateChatSnapshot(header);
    return header;
  }
  if (header.version !== 2) throw damagedDirectory();
  validateDirectory(header);
  const { index, ...settings } = header;
  const conversations = await Promise.all(index.map(({ id }) => result(store.get(['conversation', id]))));
  const saved = { ...settings, version: 1, conversations };
  validateChatSnapshot(saved);
  for (const [i, conversation] of saved.conversations.entries()) {
    const entry = index[i];
    const refs = new Set(conversation.attachments?.map(file => file.id));
    for (const message of conversation.messages)
      for (const file of message.options?.attachments ?? []) refs.add(file.id);
    if (conversation.id !== entry.id || refs.size !== entry.files.length ||
        entry.files.some(id => !refs.has(id))) throw damagedDirectory();
  }
  return saved;
}
const reloadKey = 'reload-checkpoint-v1';
type ReloadRow = Pick<ConversationRow, 'id'> & Partial<ConversationRow>;
type ReloadSnapshot = Omit<StoredSnapshot, 'conversations'> & { conversations: (string | ReloadRow)[] };
async function storedChats(store: IDBObjectStore, onReload?: (reload: ReloadSnapshot) => void) {
  const [saved, reload] = await Promise.all([storedBase(store), result<ReloadSnapshot | undefined>(store.get(reloadKey))]);
  if (!reload) return saved;
  if (!Array.isArray(reload.conversations)) throw damagedDirectory();
  const previous = new Map(saved?.conversations.map(c => [c.id, c]));
  const restored = { ...reload, conversations: reload.conversations.map(row =>
    typeof row === 'string' ? previous.get(row) : { ...previous.get(row.id), ...row }) };
  validateChatSnapshot(restored);
  onReload?.(reload);
  return restored;
}
/** Legacy transfer always sends the complete v1 envelope. Merge and publication share one transaction. */
export async function transferStoredChats(db: IDBDatabase, merge?: (old?: StoredSnapshot) => StoredSnapshot, onReload?: () => void) {
  const tx = db.transaction('state', merge ? 'readwrite' : 'readonly');
  const done = completed(tx);
  void done.catch(() => {});
  try {
    const store = tx.objectStore('state');
    const saved = await storedChats(store, onReload);
    if (merge) {
      const merged = merge(saved);
      for (const key of await result(store.getAllKeys()))
        if (Array.isArray(key) && key[0] === 'conversation') store.delete(key);
      store.put(merged, 'current');
      store.delete(reloadKey);
    }
    await done;
    return saved;
  } catch (error) {
    if (merge) {
      try { tx.abort(); } catch { /* A failed request already aborted the transaction. */ }
    }
    await done.catch(() => {});
    throw error;
  }
}
function chatEncoder() {
  const files = new Map<string, File>();
  const pack = (items: ChatAttachment[] = [], refs?: Set<string>): StoredAttachment[] =>
    items.map(({ file, ...item }) => {
      refs?.add(item.id);
      if (file) files.set(item.id, file);
      return item;
    });
  const packConversation = (conversation: PreparationConversation, refs?: Set<string>): ConversationRow => ({
    ...conversation,
    attachments: pack(conversation.attachments, refs),
    messages: conversation.messages.map(({ profileGeneration: _transient, options, ...message }) => ({
      ...message,
      ...(options ? { options: { ...options, attachments: pack(options.attachments, refs) } } : {}),
    })),
  });
  return { files, pack, packConversation };
}

type ReloadSource = () => { snapshot: ChatSnapshot; previous?: PreparationConversation[]; writing?: boolean } | undefined;
let pageDatabase: IDBDatabase | undefined;
let durableFiles = new Set<string>();
let restoredRows = new Set<string>();
type OriginalRow = { id: string; blob: Blob; lastModified: number };
type Pruning = { db: IDBDatabase; removed: Map<string, OriginalRow>; keep?: (id: string) => boolean };
const pruning = new Set<Pruning>();

function watchReload(db: IDBDatabase, source: ReloadSource) {
  const close = () => {
    window.removeEventListener('pagehide', hide);
    if (pageDatabase === db) pageDatabase = undefined;
    db.close();
  };
  const hide = (event: PageTransitionEvent) => {
    if (event.persisted) return;
    try {
      const latest = source();
      if (!latest) return;
      const { conversations, attachments, ...settings } = latest.snapshot;
      const previous = new Map(latest.previous?.map(row => [row.id, row]));
      const { pack, packConversation, files } = chatEncoder();
      const reload: ReloadSnapshot = { ...settings, version: 1, attachments: pack(attachments),
        conversations: conversations.map(row => {
          const old = previous.get(row.id);
          if (restoredRows.has(row.id)) return packConversation(row);
          if (row === old) return row.id;
          if (row.messages !== old?.messages) return packConversation(row);
          const { messages: _, attachments, ...fields } = row;
          return { ...fields, attachments: pack(attachments) };
        }) };
      // All requests and commit must be issued in the pagehide task, before the document retires.
      const tx = db.transaction(['state', 'files'], 'readwrite');
      try {
        // A queued save can remove a persisted original that the latest page still references.
        // Protect pending deletions and reinsert any originals already removed by that transaction.
        let references: Set<string> | undefined;
        const keep = (id: string) => {
          if (!references) {
            references = new Set(attachments.map(item => item.id));
            for (const row of conversations) {
              for (const item of row.attachments ?? []) references.add(item.id);
              for (const message of row.messages)
                for (const item of message.options?.attachments ?? []) references.add(item.id);
            }
          }
          return references.has(id);
        };
        for (const write of pruning) if (write.db === db) {
          write.keep = keep;
          for (const [id, original] of write.removed)
            if (keep(id)) tx.objectStore('files').put(original);
        }
        for (const [id, file] of files)
          if (latest.writing || !durableFiles.has(id)) tx.objectStore('files').put({ id, blob: file, lastModified: file.lastModified });
        tx.objectStore('state').put(reload, reloadKey);
        tx.commit();
      } catch (error) {
        tx.abort();
        throw error;
      }
    } finally { close(); }
  };
  pageDatabase = db;
  db.onversionchange = close;
  window.addEventListener('pagehide', hide);
}

async function readFiles<T>(read: (files: IDBObjectStore) => Promise<T>) {
  const retained = pageDatabase;
  const db = retained ?? await openChatDatabase();
  try { return await read(db.transaction('files').objectStore('files')); }
  finally { if (!retained) db.close(); }
}
export const localChats = {
  checkFiles(messages: ChatMessage[], attachments: ChatAttachment[]) {
    const ids = new Set<string>();
    for (const item of attachments) if (!item.file) ids.add(item.id);
    for (const message of messages)
      for (const item of message.options?.attachments ?? []) if (!item.file) ids.add(item.id);
    if (!ids.size) return;
    return readFiles(async store => {
      const keys = await Promise.all([...ids].map(id => result(store.getKey(id))));
      if (keys.includes(undefined)) throw Error('聊天附件无法读取，原数据已保留。');
    });
  },
  async readFile(item: ChatAttachment): Promise<File> {
    if (item.file) return item.file;
    const row = await readFiles(store => result(store.get(item.id)));
    if (!(row?.blob instanceof Blob) || !Number.isFinite(row.lastModified))
      throw Error('聊天附件无法读取，原数据已保留。');
    return new File([row.blob], item.name, { type: row.blob.type, lastModified: row.lastModified });
  },
  async read(reloadSource?: ReloadSource): Promise<ChatSnapshot | null> {
    const db = await openChatDatabase();
    let retained = false;
    try {
      const tx = db.transaction('state', 'readonly');
      const done = completed(tx);
      void done.catch(() => {});
      let restored: string[] = [];
      const saved = await storedChats(tx.objectStore('state'), reload => {
        restored = reload.conversations.flatMap(row => typeof row === 'string' ? [] : [row.id]);
      });
      await done;
      if (reloadSource && !pageDatabase && typeof globalThis.window?.addEventListener === 'function') {
        durableFiles = new Set();
        restoredRows = new Set(restored);
        watchReload(db, reloadSource);
        retained = true;
      }
      if (!saved) return null;
      const restore = (items: StoredAttachment[] = []): ChatAttachment[] =>
        items.map(({ id, name, size }) => ({ id, name, size }));
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
      if (!retained) db.close();
    }
  },
  async write(snapshot: ChatSnapshot, previous?: PreparationConversation[]): Promise<void> {
    const { files, pack, packConversation } = chatEncoder();
    const retained = pageDatabase;
    const db = retained ?? await openChatDatabase();
    const prune: Pruning | undefined = retained && { db, removed: new Map() };
    if (prune) pruning.add(prune);
    try {
      const tx = db.transaction(['state', 'files'], 'readwrite');
      const done = completed(tx);
      void done.catch(() => {});
      const state = tx.objectStore('state'), originals = tx.objectStore('files');
      try {
        const [current, reload] = await Promise.all([
          result<ChatDirectory | StoredSnapshot | undefined>(state.get('current')),
          result<ReloadSnapshot | undefined>(state.get(reloadKey)),
        ]);
        if (current?.version === 1) validateChatSnapshot(current);
        else if (current?.version === 2) validateDirectory(current);
        else if (current) throw damagedDirectory();
        const oldIndex = new Map(current?.version === 2 ? current.index.map(entry => [entry.id, entry]) : []);
        const existing = new Set(current?.version === 2 && !reload
          ? [...current.attachments.map(a => a.id), ...current.index.flatMap(entry => entry.files)]
          : (await result(originals.getAllKeys())).map(String));
        const known = new Set(previous);
        const restored = new Set(reload?.conversations.flatMap(row => typeof row === 'string' ? [] : [row.id]));
        const { conversations, attachments, ...settings } = snapshot;
        if (new Set(conversations.map(c => c.id)).size !== conversations.length)
          throw Error('本地会话标识重复。');
        const directory: ChatDirectory = { ...settings, version: 2, attachments: pack(attachments), index: [] };
        const referenced = new Set(attachments.map(a => a.id));
        for (const conversation of conversations) {
          let entry = oldIndex.get(conversation.id);
          if (!entry || !known.has(conversation) || restored.has(conversation.id)) {
            const refs = new Set<string>();
            state.put(packConversation(conversation, refs), ['conversation', conversation.id]);
            entry = { id: conversation.id, files: [...refs] };
          }
          for (const id of entry.files) referenced.add(id);
          directory.index.push(entry);
          oldIndex.delete(conversation.id);
        }
        for (const id of oldIndex.keys()) state.delete(['conversation', id]);
        for (const [id, file] of files)
          if (!existing.has(id)) originals.put({ id, blob: file, lastModified: file.lastModified });
        await Promise.all([...existing].filter(id => !referenced.has(id)).map(async id => {
          if (prune) {
            if (prune.keep?.(id)) return;
            const original: OriginalRow | undefined = await result(originals.get(id));
            if (prune.keep?.(id)) return;
            if (original) prune.removed.set(id, original);
          }
          originals.delete(id);
        }));
        state.put(directory, 'current');
        if (reload) state.delete(reloadKey);
        await done;
        if (retained && pageDatabase === db) {
          durableFiles = referenced;
          restoredRows.clear();
        }
      } catch (error) {
        try { tx.abort(); } catch { /* Request already aborted. */ }
        await done.catch(() => {});
        throw Error('聊天保存失败，请检查本机存储空间后重试。', { cause: error });
      }
    } finally {
      if (prune) pruning.delete(prune);
      if (!retained) db.close();
    }
  },
};
