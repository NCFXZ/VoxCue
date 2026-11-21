import { openChatDatabase, transferStoredChats, validateChatSnapshot, type StoredSnapshot } from './chats';
import { openDocumentsDatabase } from './knowledge';
import { openOriginalBackups, originalBackupsDatabase as backupDB } from './originalBackups';
import { assertLibrariesWritable } from './knowledgeIndex';
import type { LocalDocument } from './knowledgeTypes';
import { historyRepository, historyStorageKey, readExistingHistory, readHistorySnapshot } from './history';
import { legacyProfileModificationKey, profileStorageKey, readStoredProfile, storedObject } from './storedValues';
import { mergeLegacySyncSaved, type SyncSaved } from './cloudSync';
import { validProfile } from '../../electron/contracts/profile';
import { knowledgeFileNameLimit } from '../../electron/contracts/knowledge';

const preferences = [
  'copilot-theme',
  'voxcue-language-v1',
  'copilot-interview-settings-v1',
  'copilot-interview-input-mode-v1',
  'voxcue-interview-font-size-v1',
  'voxcue-interview-background-transparency-v1',
  'copilot-interview-knowledge-base-v1',
] as const;
const chatDB = 'voxcue-preparation-chats';
const docsDB = 'copilot-local-documents';
const syncDB = 'voxcue-cloud-sync';
const chunkSize = 1024 * 1024;
const invalid = () => Error('旧版资料格式无效，原数据已保留。');
type Entry = 'setting' | 'chat' | 'file' | 'base' | 'document' | 'backup' | 'sync';
type Header = {
  entry: Entry;
  size: number;
  key?: string;
  metadata?: Record<string, unknown>;
  mime: string;
};
type Packet = { begin: Header } | { chunk: ArrayBuffer } | 'end' | 'done';
type Backup = LocalDocument & { backupId: string; backedUpAt: number };
type ChatFile = { id: string; blob: Blob; lastModified: number };
const json = (value: unknown) => new Blob([JSON.stringify(value)], { type: 'application/json' });

async function sameAttachment(existing: ChatFile, blob: Blob, modified: number) {
  if (existing.lastModified !== modified || existing.blob.size !== blob.size || existing.blob.type !== blob.type)
    return false;
  for (let offset = 0; offset < blob.size; offset += chunkSize) {
    const [a, b] = await Promise.all([existing.blob, blob].map(async (part) =>
      new Uint8Array(await part.slice(offset, offset + chunkSize).arrayBuffer()),
    ));
    if (!a.every((byte, index) => byte === b[index])) return false;
  }
  return true;
}

function userId(owner: string) {
  if (owner === 'local') return null;
  if (!/^account:[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(owner)) throw invalid();
  return owner.slice('account:'.length);
}
function auxiliary(name: typeof syncDB | typeof backupDB) {
  if (name === backupDB) return openOriginalBackups('indexed', invalid);
  return new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(name, 1);
    req.onupgradeneeded = () => req.result.createObjectStore('accounts');
    req.onsuccess = () => resolve(req.result);
    req.onerror = req.onblocked = () => reject(invalid());
  });
}
function read<T>(db: IDBDatabase, store: string, key?: IDBValidKey): Promise<T> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const object = tx.objectStore(store);
    const request = key === undefined ? object.getAll() : object.get(key);
    tx.oncomplete = () => resolve(request.result);
    tx.onerror = tx.onabort = () => reject(tx.error ?? invalid());
  });
}
function update<T>(
  db: IDBDatabase,
  store: string,
  key: IDBValidKey,
  merge: (old: T | undefined) => T | undefined,
) {
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    const object = tx.objectStore(store);
    const request = object.get(key);
    let failure: unknown;
    request.onsuccess = () => {
      try {
        const value = merge(request.result);
        if (value !== undefined) {
          if (object.keyPath === null) object.put(value, key);
          else object.put(value);
        }
      } catch (cause) {
        failure = cause;
        tx.abort();
      }
    };
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(failure ?? tx.error ?? invalid());
  });
}

/** Each ACK follows the consumer's read or durable write. Only one chunk is in flight. */
export async function sendLegacyBrowserData(port: MessagePort, owner: string): Promise<void> {
  const account = userId(owner);
  const send = (packet: Packet) =>
    new Promise<void>((resolve, reject) => {
      port.onmessage = ({ data }) => (data === 'ack' ? resolve() : reject(invalid()));
      port.onmessageerror = () => reject(invalid());
      port.postMessage(
        packet,
        typeof packet === 'object' && 'chunk' in packet ? [packet.chunk] : [],
      );
    });
  const emit = async (
    entry: Entry,
    blob: Blob,
    key?: string,
    metadata?: Record<string, unknown>,
  ) => {
    await send({ begin: { entry, size: blob.size, mime: blob.type, key, metadata } });
    for (let offset = 0; offset < blob.size; offset += chunkSize)
      await send({ chunk: await blob.slice(offset, offset + chunkSize).arrayBuffer() });
    await send('end');
  };
  const documents = async (entry: 'document' | 'backup', docs: LocalDocument[]) => {
    for (const { blob, ...meta } of docs) {
      if (!(blob instanceof Blob) || meta.size !== blob.size) throw invalid();
      await emit(entry, blob, undefined, meta);
    }
  };
  try {
    const databases = new Set((await indexedDB.databases()).map((db) => db.name));
    if (databases.has(docsDB)) {
      const db = await openDocumentsDatabase(true);
      try {
        for (const value of await read<unknown[]>(db, 'bases')) await emit('base', json(value));
        await documents('document', await read<LocalDocument[]>(db, 'documents'));
      } finally {
        db.close();
      }
    }
    if (databases.has(backupDB)) {
      const db = await openOriginalBackups('source', invalid);
      try {
        await documents('backup', await read<Backup[]>(db, 'versions'));
      } finally {
        db.close();
      }
    }
    if (databases.has(chatDB)) {
      const db = await openChatDatabase();
      try {
        let checkpoint = false;
        const state = await transferStoredChats(db, undefined, () => { checkpoint = true; });
        if (state !== undefined) {
          // Pending reloads can remove a reference before the next chat save reclaims its blob.
          // Without a checkpoint, preserve the legacy import's original file recovery behavior.
          const referenced = checkpoint ? new Set(state.attachments.map(file => file.id)) : undefined;
          if (referenced) for (const conversation of state.conversations) {
            for (const file of conversation.attachments ?? []) referenced.add(file.id);
            for (const message of conversation.messages)
              for (const file of message.options?.attachments ?? []) referenced.add(file.id);
          }
          for (const file of await read<ChatFile[]>(db, 'files')) {
            if (referenced && !referenced.delete(file.id)) continue;
            if (!(file.blob instanceof Blob)) throw invalid();
            await emit('file', file.blob, file.id, { lastModified: file.lastModified });
          }
          if (referenced?.size) throw invalid();
          await emit('chat', json(state));
        }
      } finally {
        db.close();
      }
    }
    for (const record of await readExistingHistory())
      await emit('setting', json([record]), historyStorageKey);
    for (const key of [profileStorageKey, ...preferences]) {
      const raw = localStorage.getItem(key);
      if (raw !== null) await emit('setting', new Blob([raw]), key);
    }
    if (account && databases.has(syncDB)) {
      const db = await auxiliary(syncDB);
      try {
        const saved = await read<SyncSaved | undefined>(db, 'accounts', account);
        if (saved !== undefined) await emit('sync', json(saved), account);
      } finally {
        db.close();
      }
    }
    await send('done');
  } catch (cause) {
    port.postMessage('failed');
    throw cause;
  } finally {
    port.onmessage = port.onmessageerror = null;
  }
}

/** Remove only the retired app stores assigned to this account. Keep other users' sync rows. */
export async function eraseLegacyBrowserData(owner: string) {
  const account = userId(owner);
  const databases = new Set((await indexedDB.databases()).map((db) => db.name));
  if (account && databases.has(syncDB)) {
    const db = await auxiliary(syncDB);
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('accounts', 'readwrite');
        tx.objectStore('accounts').delete(account);
        tx.oncomplete = () => resolve();
        tx.onabort = tx.onerror = () => reject(tx.error ?? invalid());
      });
    } finally {
      db.close();
    }
  }
  for (const name of [chatDB, docsDB, backupDB]) {
    if (!databases.has(name)) continue;
    await new Promise<void>((resolve, reject) => {
      const deletion = indexedDB.deleteDatabase(name);
      deletion.onsuccess = () => resolve();
      deletion.onblocked = deletion.onerror = () => reject(invalid());
    });
  }
  for (const key of [profileStorageKey, legacyProfileModificationKey, historyStorageKey, ...preferences])
    localStorage.removeItem(key);
  if (account && localStorage.getItem('voxcue-sync-owner') === account)
    localStorage.removeItem('voxcue-sync-owner');
  return true;
}

async function mergeSetting(key: string | undefined, raw: string) {
  if (!key) throw invalid();
  if (preferences.some((name) => key === name)) {
    localStorage.setItem(key, raw);
    return;
  }
  if (key !== profileStorageKey && key !== historyStorageKey) throw invalid();
  const old = localStorage.getItem(key);
  if (key === profileStorageKey) {
    const incoming = readStoredProfile(raw);
    if (!old) {
      localStorage.setItem(key, raw);
      return;
    }
    const current = readStoredProfile(old);
    for (const field of [
      'name',
      'role',
      'language',
      'background',
      'jobDescription',
      'customInstructions',
    ] as const) {
      if (
        !current[field]?.trim() &&
        incoming[field] &&
        validProfile({ ...current, [field]: incoming[field] })
      )
        current[field] = incoming[field]!;
    }
    for (const skill of incoming.skills ?? []) {
      const skills = [...(current.skills ?? []), skill];
      if (validProfile({ ...current, skills })) current.skills = skills;
    }
    localStorage.setItem(key, JSON.stringify(current));
  } else if (key === historyStorageKey) {
    await historyRepository.mergeMissing(readHistorySnapshot(raw));
  }
}

type StoredConversation = StoredSnapshot['conversations'][number];
function mergeMessages(
  source: StoredConversation['messages'],
  current: StoredConversation['messages'],
) {
  const existing = new Set(current.map((message) => message.id));
  const before = new Map<string, typeof source>();
  let unmatched: typeof source = [];
  for (const message of source) {
    if (existing.has(message.id)) {
      before.set(message.id, unmatched);
      unmatched = [];
    } else unmatched.push(message);
  }
  return [
    ...current.flatMap((message) => [...(before.get(message.id) ?? []), message]),
    ...unmatched,
  ];
}
function mergeChats(incoming: StoredSnapshot, current?: StoredSnapshot): StoredSnapshot {
  if (!current) return incoming;
  validateChatSnapshot(current);
  const byId = new Map(incoming.conversations.map((c) => [c.id, c]));
  const conversations = current.conversations.map((c) => {
    const source = byId.get(c.id);
    if (!source) return c;
    byId.delete(c.id);
    return {
      ...c,
      ...(!c.draft &&
        !c.attachments?.length && { draft: source.draft, attachments: source.attachments }),
      messages: mergeMessages(source.messages, c.messages),
    };
  });
  conversations.push(...byId.values());
  const merged = {
    ...current,
    modelId: incoming.modelId,
    effort: incoming.effort,
    webSearch: incoming.webSearch,
    skillsNeedUpdate: current.skillsNeedUpdate || incoming.skillsNeedUpdate,
    conversations,
  };
  if (!current.activeConversation && !current.draft && !current.attachments.length) {
    merged.activeConversation = incoming.activeConversation;
    merged.draft = incoming.draft;
    merged.attachments = incoming.attachments;
  } else if (
    !incoming.activeConversation &&
    (incoming.draft || incoming.attachments.length) &&
    (current.activeConversation ||
      current.draft !== incoming.draft ||
      JSON.stringify(current.attachments) !== JSON.stringify(incoming.attachments))
  ) {
    const id = 'legacy-preparation-standalone-draft';
    if (!conversations.some((c) => c.id === id))
      conversations.push({
        id,
        title: incoming.draft.trim().slice(0, 60) || '草稿',
        draft: incoming.draft,
        attachments: incoming.attachments,
        messages: [],
      });
  }
  return merged;
}

/** Fixed stores only. Individual entries commit before acknowledgement and can be replayed. */
export async function receiveLegacyBrowserData(port: MessagePort, owner: string): Promise<void> {
  const account = userId(owner);
  const databases = new Map<string, IDBDatabase>();
  const database = async (
    name: typeof chatDB | typeof docsDB | typeof syncDB | typeof backupDB,
  ) => {
    let db = databases.get(name);
    if (!db) {
      db = await (name === chatDB
        ? openChatDatabase()
        : name === docsDB
          ? openDocumentsDatabase()
          : auxiliary(name));
      databases.set(name, db);
    }
    return db;
  };
  let existingDocs: { ids: Set<string>; names: Set<string> } | undefined;
  const fileAliases = new Map<string, string>();
  const write = async ({ entry, key, metadata }: Header, blob: Blob) => {
    if (entry === 'setting') return mergeSetting(key, await blob.text());
    if (entry === 'chat') {
      const value: unknown = JSON.parse(await blob.text());
      validateChatSnapshot(value);
      if (fileAliases.size) {
        const restoreIds = (files: StoredSnapshot['attachments'] = []) => {
          for (const file of files) file.id = fileAliases.get(file.id) ?? file.id;
        };
        restoreIds(value.attachments);
        for (const chat of value.conversations) {
          restoreIds(chat.attachments);
          for (const message of chat.messages) restoreIds(message.options?.attachments);
        }
      }
      await transferStoredChats(await database(chatDB), (old) =>
        mergeChats(value, old),
      );
      return;
    }
    if (entry === 'sync') {
      if (!account || key !== account) throw invalid();
      const value = JSON.parse(await blob.text());
      await update<SyncSaved>(await database(syncDB), 'accounts', account, (old) =>
        mergeLegacySyncSaved(value, old),
      );
      localStorage.setItem('voxcue-sync-owner', account);
      return;
    }
    if (entry === 'base') {
      const base = JSON.parse(await blob.text());
      if (!storedObject(base) || typeof base.id !== 'string' || typeof base.name !== 'string')
        throw invalid();
      const baseId = base.id;
      return update(await database(docsDB), 'bases', baseId, old => {
        assertLibrariesWritable([baseId]);
        return old ? undefined : base;
      });
    }
    if (entry === 'file') {
      if (!key || typeof metadata?.lastModified !== 'number') throw invalid();
      const db = await database(chatDB);
      let id = key, suffix = 0;
      for (;;) {
        const existing = await read<ChatFile | undefined>(db, 'files', id);
        if (!existing) {
          await update(db, 'files', id, (old) => old ? undefined : { id, blob, lastModified: metadata.lastModified });
          break;
        }
        if (await sameAttachment(existing, blob, metadata.lastModified)) break;
        id = 'legacy-file-' + key + '-' + ++suffix;
      }
      if (id !== key) fileAliases.set(key, id);
      return;
    }
    if (entry !== 'document' && entry !== 'backup') throw invalid();
    if (
      !metadata ||
      typeof metadata.id !== 'string' ||
      typeof metadata.baseId !== 'string' ||
      typeof metadata.name !== 'string' ||
      metadata.size !== blob.size
    )
      throw invalid();
    const baseId = metadata.baseId;
    assertLibrariesWritable([baseId]);
    if (entry === 'backup') {
      if (typeof metadata.backupId !== 'string') throw invalid();
      return update(await database(backupDB), 'versions', metadata.backupId, old => {
        assertLibrariesWritable([baseId]);
        return old ? undefined : { ...metadata, blob };
      });
    }
    const db = await database(docsDB);
    const docName = (base: string, name: string) =>
      JSON.stringify([base, base === 'personal-resume' ? '' : name]);
    if (!existingDocs) {
      const docs = await read<LocalDocument[]>(db, 'documents');
      existingDocs = {
        ids: new Set(docs.map((d) => d.id)),
        names: new Set(docs.map((d) => docName(d.baseId, d.name))),
      };
    }
    if (existingDocs.ids.has(metadata.id)) return;
    let name = metadata.name;
    if (existingDocs.names.has(docName(metadata.baseId, name))) {
      if (metadata.baseId === 'personal-resume') {
        const backupId = 'legacy-resume-' + metadata.id;
        await update(await database(backupDB), 'versions', backupId, (old) =>
          old ? undefined : { ...metadata, blob, backupId, backedUpAt: metadata.createdAt },
        );
        return;
      }
      const split = name.lastIndexOf('.');
      const stem = split > 0 ? name.slice(0, split) : name;
      const extension = split > 0 ? name.slice(split) : '';
      let number = 2;
      do {
        const suffix = ' (' + number++ + ')' + extension;
        const limit = knowledgeFileNameLimit - suffix.length;
        if (limit < 0) throw invalid();
        name = stem.slice(0, limit).replace(/[\uD800-\uDBFF]$/, '') + suffix;
      } while (existingDocs.names.has(docName(metadata.baseId, name)));
    }
    await update(db, 'documents', metadata.id, old => {
      assertLibrariesWritable([baseId]);
      return old ? undefined : { ...metadata, name, blob };
    });
    existingDocs.ids.add(metadata.id);
    existingDocs.names.add(docName(metadata.baseId, name));
  };
  try {
    await new Promise<void>((resolve, reject) => {
      let header: Header | null = null;
      let chunks: ArrayBuffer[] = [];
      let length = 0,
        busy = false;
      const fail = (reason: unknown) => {
        port.postMessage('failed');
        reject(reason);
      };
      port.onmessageerror = () => fail(invalid());
      port.onmessage = async ({ data }) => {
        try {
          if (busy) throw invalid();
          busy = true;
          if (data === 'done' && !header) {
            port.postMessage('ack');
            resolve();
            return;
          }
          if (typeof data === 'object' && data?.begin && !header) {
            if (
              !Number.isSafeInteger(data.begin.size) ||
              data.begin.size < 0 ||
              typeof data.begin.mime !== 'string'
            )
              throw invalid();
            header = data.begin;
            chunks = [];
            length = 0;
          } else if (
            header &&
            data?.chunk instanceof ArrayBuffer &&
            data.chunk.byteLength > 0 &&
            data.chunk.byteLength <= chunkSize &&
            length + data.chunk.byteLength <= header.size
          ) {
            chunks.push(data.chunk);
            length += data.chunk.byteLength;
          } else if (data === 'end' && header && length === header.size) {
            await write(header, new Blob(chunks, { type: header.mime }));
            header = null;
            chunks = [];
          } else throw invalid();
          port.postMessage('ack');
        } catch (cause) {
          fail(cause);
        } finally {
          busy = false;
        }
      };
      port.start();
    });
  } finally {
    port.onmessage = port.onmessageerror = null;
    for (const db of databases.values()) db.close();
  }
}
