import { afterEach, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import {
  receiveLegacyBrowserData,
  sendLegacyBrowserData,
} from '../../src/services/legacyBrowserData';
import { localChats, openChatDatabase, type ChatSnapshot } from '../../src/services/chats';
import { localKnowledge } from '../../src/services/knowledge';
import { markBaseRemoval } from '../../src/services/knowledgeIndex';
import { historyRepository, historyStorageKey } from '../../src/services/history';
import { profileStorageKey } from '../../src/services/storedValues';
import { readSyncSaved } from '../../src/services/cloudSync';
import { decodeCloudItem, localCloudItem } from '../../src/services/cloudData';

const first = '8b3d86c5-c334-4e57-8f59-5b578115ea8f';
const other = '79efb682-9f57-4b59-a20c-e148200ec710';
const owner = 'account:' + first;
function partition() {
  const values = new Map<string, string>();
  return { db: new IDBFactory(), values };
}
function usePartition(p: ReturnType<typeof partition>) {
  vi.stubGlobal('indexedDB', p.db);
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => p.values.get(k) ?? null,
    setItem: (k: string, v: string) => p.values.set(k, v),
    removeItem: (k: string) => p.values.delete(k),
  });
}
afterEach(() => vi.unstubAllGlobals());

async function syncAccount(id: string, saved?: unknown): Promise<any> {
  const db = await new Promise<IDBDatabase>((resolve) => {
    const req = indexedDB.open('voxcue-cloud-sync', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('accounts');
    req.onsuccess = () => resolve(req.result);
  });
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('accounts', saved ? 'readwrite' : 'readonly');
      const store = tx.objectStore('accounts');
      const req = saved ? store.put(saved, id) : store.get(id);
      tx.oncomplete = () => resolve(req.result);
      tx.onabort = tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
// Capture and replay native structured-clone messages in independent synthetic storage partitions.
async function capture(owner: string) {
  const channel = new MessageChannel();
  const packets: unknown[] = [];
  channel.port2.onmessage = ({ data }) => {
    packets.push(data);
    channel.port2.postMessage('ack');
  };
  try {
    await sendLegacyBrowserData(channel.port1, owner);
  } finally {
    channel.port1.close();
    channel.port2.close();
  }
  return packets;
}
async function replay(packets: unknown[], owner: string) {
  const channel = new MessageChannel();
  let next = 0;
  const advance = () => {
    if (next < packets.length) channel.port2.postMessage(packets[next++]);
  };
  channel.port2.onmessage = ({ data }) => {
    if (data === 'ack') advance();
  };
  try {
    const receiving = receiveLegacyBrowserData(channel.port1, owner);
    advance();
    await receiving;
  } finally {
    channel.port1.close();
    channel.port2.close();
  }
}
const preferences = {
  enabled: { profile: true, history: false, knowledgebase: true },
  knowledgeLimitBytes: 30000000,
};
it('keeps the full extension and collision number when merging duplicate native-length names', async () => {
  const source = partition(), target = partition();
  const base = { id: 'names', name: 'Names', createdAt: 1 };
  const prefix = 'a'.repeat(246), name = prefix + '🧪xxx.txt';
  usePartition(source);
  await localKnowledge.saveBase(base);
  await localKnowledge.importDocuments(base.id, [new File(['from source'], name)]);
  const packets = await capture('local');
  usePartition(target);
  await localKnowledge.saveBase(base);
  await localKnowledge.importDocuments(base.id, [new File(['existing'], name), new File(['2'], prefix + ' (2).txt')]);
  await replay(packets, 'local');
  const docs = await localKnowledge.listDocuments(base.id);
  const migrated = docs.find(doc => doc.name === prefix + ' (3).txt')!;
  expect(docs).toHaveLength(3);
  expect(await migrated.blob.text()).toBe('from source');
  const item = (await localCloudItem('knowledgebase', 'file:' + migrated.id))!;
  expect(await decodeCloudItem(item.key, await item.blob())).toMatchObject({ document: { name: migrated.name } });
});
it('does not acknowledge an old library being removed from the target partition', async () => {
  const source = partition(), target = partition();
  usePartition(source);
  await localKnowledge.saveBase({ id: 'during-removal', name: 'Synthetic', createdAt: 1 });
  await localKnowledge.importDocuments('during-removal', [new File(['new'], 'old.txt')]);
  const packets = await capture('local');
  usePartition(target);
  markBaseRemoval('during-removal', true);
  await expect(replay(packets, 'local')).rejects.toThrow('正在删除');
  expect(await localKnowledge.listDocuments('during-removal')).toEqual([]);
  usePartition(source);
  expect(await localKnowledge.listDocuments('during-removal')).toHaveLength(1);
});
const revision = (n: number) => ({ id: first, revision: n, hash: 'a'.repeat(64) });
const upload = { hash: 'b'.repeat(64), bytes: 4, requestId: other, revision: 2 };
const chat = (draft: string): ChatSnapshot => ({
  conversations: [],
  activeConversation: null,
  draft,
  attachments: [],
  modelId: 'saved-model',
  effort: 'high',
  webSearch: true,
});
const record = (id: string, title: string) => ({
  id,
  title,
  startedAt: 1,
  endedAt: 2,
  status: 'ended',
  transcripts: [],
  answers: [],
  mock: false,
});

it('exports only attachments still referenced after an immediate reload, including drafts and prior messages', async () => {
  usePartition(partition());
  const view = new EventTarget();
  vi.stubGlobal('window', view);
  const attachment = (id: string) => {
    const file = new File([id], id + '.txt');
    return { id, name: file.name, size: file.size, file };
  };
  const removed = attachment('removed'), top = attachment('top'), other = attachment('other'), sent = attachment('sent');
  const old = chat('draft');
  old.attachments = [removed, top];
  old.conversations = [{ id: 'c', title: 'C', attachments: [other], messages: [{
    id: 'm', role: 'user', content: 'hello', options: { modelId: 'm', webSearch: false, attachments: [sent] },
  }] }];
  await localChats.write(old);
  const legacyDb = await openChatDatabase();
  const insert = legacyDb.transaction('files', 'readwrite');
  insert.objectStore('files').put({ id: 'legacy-original', blob: new Blob(['original']), lastModified: 1 });
  await new Promise<void>((resolve, reject) => {
    insert.oncomplete = () => resolve();
    insert.onabort = () => reject(insert.error);
  });
  legacyDb.close();
  const fileKeys = (packets: unknown[]) => packets.flatMap(packet => {
    const header = (packet as { begin?: { entry: string; key: string } })?.begin;
    return header?.entry === 'file' ? [header.key] : [];
  }).sort();
  expect(fileKeys(await capture('local'))).toContain('legacy-original');
  let previous: ChatSnapshot | null;
  previous = await localChats.read(() => ({ snapshot: { ...old, attachments: [top] }, previous: previous?.conversations }));
  view.dispatchEvent(new Event('pagehide'));
  expect(fileKeys(await capture('local'))).toEqual(['other', 'sent', 'top']);
});

it('restores mixed sync switches and user preferences, merges private data once, and streams chat attachments across partitions', async () => {
  const source = partition(),
    target = partition();
  usePartition(source);
  source.values.set('copilot-theme', 'dark');
  source.values.set('voxcue-language-v1', 'en');
  source.values.set('copilot-interview-settings-v1', '{"microphone":"old mic"}');
  source.values.set('voxcue-interview-font-size-v1', '19');
  source.values.set('voxcue-sync-owner', other);
  source.values.set('unrelated-secret', 'do not copy');
  source.values.set(
    profileStorageKey,
    JSON.stringify({ name: 'Old name', background: 'Old résumé', jobDescription: '' }),
  );
  source.values.set(
    historyStorageKey,
    JSON.stringify([record('a', 'old A'), record('b', 'old B')]),
  );
  await syncAccount(first, {
    preferences,
    baselines: { 'record:a': revision(2), 'record:b': revision(4) },
    uploads: { 'file:d': upload },
  });
  await syncAccount(other, { preferences, baselines: { 'record:foreign': revision(7) } });
  const bytes = new Uint8Array(1024 * 1024 + 37).fill(21);
  const file = new File([bytes], '原始附件.txt', { type: 'text/plain', lastModified: 24 });
  const saved = chat('旧版草稿');
  saved.attachments = [{ id: 'attachment', name: file.name, size: file.size, file }];
  saved.conversations = [
    { id: 'source-chat', title: 'Source', messages: [{ id: 'm', role: 'user', content: 'hello' }] },
  ];
  await localChats.write(saved);
  await localKnowledge.saveBase({ id: 'base', name: 'Existing legacy library', createdAt: 1 });
  await localKnowledge.importDocuments('base', [file]);
  await localKnowledge.importDocuments('personal-resume', [new File(['legacy résumé'], 'old.txt')]);
  const packets = await capture(owner);
  usePartition(target);
  target.values.set('copilot-theme', 'system');
  target.values.set(
    profileStorageKey,
    JSON.stringify({ name: 'Current name', background: '', jobDescription: 'Current job' }),
  );
  target.values.set(historyStorageKey, JSON.stringify([record('a', 'updated A')]));
  await syncAccount(first, {
    preferences: {
      ...preferences,
      enabled: { profile: false, history: false, knowledgebase: false },
    },
    baselines: { 'record:a': revision(8) },
    uploads: { 'file:e': { ...upload, requestId: first } },
  });
  const current = chat('当前草稿');
  const existingFile = new File(['target'], file.name, { type: file.type, lastModified: 24 });
  await localKnowledge.saveBase({ id: 'base', name: 'Current library', createdAt: 2 });
  await localKnowledge.importDocuments('base', [existingFile]);
  await localKnowledge.importDocuments('personal-resume', [
    new File(['current résumé'], 'new.txt'),
  ]);
  current.attachments = [
    { id: 'attachment', name: existingFile.name, size: existingFile.size, file: existingFile },
  ];
  await localChats.write(current);
  const chatAt = packets.findIndex(
    (packet) => (packet as { begin?: { entry: string } })?.begin?.entry === 'chat',
  );
  await expect(replay([...packets.slice(0, chatAt), 'failed'], owner)).rejects.toThrow();
  for (let attempt = 0; attempt < 2; attempt++) await replay(packets, owner);
  expect(target.values.get('copilot-theme')).toBe('dark');
  expect(target.values.get('voxcue-language-v1')).toBe('en');
  expect(target.values.get('copilot-interview-settings-v1')).toBe('{"microphone":"old mic"}');
  expect(target.values.get('voxcue-interview-font-size-v1')).toBe('19');
  expect(target.values.get('voxcue-sync-owner')).toBe(first);
  expect(target.values.has('unrelated-secret')).toBe(false);
  expect(JSON.parse(target.values.get(profileStorageKey)!)).toEqual({
    name: 'Current name',
    background: 'Old résumé',
    jobDescription: 'Current job',
  });
  expect(
    (await historyRepository.list()).map(r => r.title),
  ).toEqual(['updated A', 'old B']);
  const sync = readSyncSaved(await syncAccount(first));
  expect(sync.preferences).toEqual(preferences);
  expect(sync.baselines).toEqual({ 'record:a': revision(8), 'record:b': revision(4) });
  expect(Object.keys(sync.uploads!)).toEqual(['file:d', 'file:e']);
  expect(await syncAccount(other)).toBeUndefined();
  const migrated = await localChats.read();
  expect(migrated?.draft).toBe('当前草稿');
  expect(await (await localChats.readFile(migrated!.attachments[0])).text()).toBe('target');
  expect(migrated?.conversations).toHaveLength(2);
  const copied = await localChats.readFile(migrated!.conversations.find((c) => c.draft === '旧版草稿')!.attachments![0]);
  expect(copied?.name).toBe(file.name);
  expect(copied?.type).toBe(file.type);
  expect(copied?.lastModified).toBe(24);
  expect(new Uint8Array(await copied!.arrayBuffer()).every((value) => value === 21)).toBe(true);
  expect((await localKnowledge.listBases()).find((b) => b.id === 'base')?.name).toBe(
    'Current library',
  );
  const originals = await localKnowledge.listDocuments('base');
  expect(originals.map((d) => d.name).sort()).toEqual(['原始附件 (2).txt', file.name]);
  expect(originals.find((d) => d.name !== file.name)?.blob.size).toBe(file.size);
  expect(await originals.find((d) => d.name === file.name)?.blob.text()).toBe('target');
  const resumes = await localKnowledge.listDocuments('personal-resume');
  expect(resumes.map((d) => d.name)).toEqual(['new.txt']);
  const backups = await new Promise<{ name: string; blob: Blob }[]>((resolve, reject) => {
    const req = indexedDB.open('voxcue-original-backups');
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction('versions');
      const versions = tx.objectStore('versions').getAll();
      tx.oncomplete = () => {
        db.close();
        resolve(versions.result);
      };
      tx.onerror = tx.onabort = () => {
        db.close();
        reject(tx.error);
      };
    };
    req.onerror = () => reject(req.error);
  });
  expect(backups.map((b) => b.name)).toEqual(['old.txt']);
  expect(await backups[0].blob.text()).toBe('legacy résumé');
  expect(source.values.get('voxcue-sync-owner')).toBe(other);
});

it('retains target edits and legacy-only messages in a shared conversation without duplicating a restored draft', async () => {
  const source = partition(),
    target = partition();
  const conversation = (ids: string[], content: string) => ({
    id: 'same-chat',
    title: content,
    messages: ids.map((id) => ({ id, role: 'user' as const, content })),
  });
  usePartition(source);
  await localChats.write({
    ...chat('draft'),
    conversations: [conversation(['older', 'shared', 'later'], 'legacy')],
  });
  const packets = await capture(owner);
  usePartition(target);
  await localChats.write({
    ...chat(''),
    conversations: [conversation(['shared', 'current'], 'target')],
  });
  await replay(packets, owner);
  await replay(packets, owner);
  const merged = await localChats.read();
  expect(merged?.draft).toBe('draft');
  expect(merged?.conversations).toHaveLength(1);
  expect(merged!.conversations[0].messages.map((m) => [m.id, m.content])).toEqual([
    ['older', 'legacy'],
    ['shared', 'target'],
    ['current', 'target'],
    ['later', 'legacy'],
  ]);
});

it('copies legacy v1 original backups into the indexed target and leaves the source at v1', async () => {
  const source = partition(), target = partition(), name = 'voxcue-original-backups';
  usePartition(source);
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const open = indexedDB.open(name, 1);
    open.onupgradeneeded = () => open.result.createObjectStore('versions', { keyPath: 'backupId' });
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
  });
  const blob = new Blob(['retained original']);
  const tx = db.transaction('versions', 'readwrite');
  tx.objectStore('versions').put({
    backupId: 'old', id: 'doc', baseId: 'library', name: 'old.txt', size: blob.size, blob,
  });
  await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); });
  db.close();
  const packets = await capture('local');
  expect(await indexedDB.databases()).toEqual([{ name, version: 1 }]);
  usePartition(target);
  await replay(packets, 'local');
  expect(await indexedDB.databases()).toEqual([{ name, version: 2 }]);
  const roundTrip = await capture('local');
  expect(roundTrip).toEqual(packets);
});

it('does not claim another person’s sync settings or create absent source databases', async () => {
  const source = partition(),
    target = partition();
  usePartition(source);
  source.values.set('voxcue-sync-owner', other);
  await syncAccount(other, { preferences, baselines: {} });
  for (const account of [owner, 'local']) {
    usePartition(source);
    const packets = await capture(account);
    expect((await indexedDB.databases()).map((database) => database.name)).toEqual([
      'voxcue-cloud-sync',
    ]);
    usePartition(target);
    await replay(packets, account);
    expect(await indexedDB.databases()).toEqual([]);
    expect(target.values.has('voxcue-sync-owner')).toBe(false);
  }
});

it('retains every pending upload if both partitions held four different requests', async () => {
  const source = partition(),
    target = partition();
  const pending = (prefix: string) =>
    Object.fromEntries(Array.from({ length: 4 }, (_, i) => [`file:${prefix}${i}`, upload]));
  usePartition(source);
  await syncAccount(first, { preferences, baselines: {}, uploads: pending('old') });
  const packets = await capture(owner);
  usePartition(target);
  await syncAccount(first, { preferences, baselines: {}, uploads: pending('current') });
  await replay(packets, owner);
  const saved = readSyncSaved(await syncAccount(first));
  expect(saved.preferences).toEqual(preferences);
  expect(saved.uploads).toEqual({ ...pending('current'), ...pending('old') });
});
