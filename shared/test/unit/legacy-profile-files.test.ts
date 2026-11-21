import { expect, it } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { temporaryDirectory } from '../temp';
import { profileDirectory, profileDirectoryName } from '../../electron/accountProfilePaths';
import {
  eraseLegacyProfileFiles,
  hasLegacyProfileFiles,
  migrateLegacyProfileFiles,
} from '../../electron/backend/legacyProfileFiles';
import { InterviewImageStore } from '../../electron/backend/interview/images';
import { KnowledgeService } from '../../electron/backend/knowledge/service';
import { UsageLedger } from '../../electron/backend/chat/usage';
import { readShortcuts, writeShortcuts } from '../../electron/backend/shortcutPreferences';
import { readAutoDownload, saveAutoDownload } from '../../electron/backend/updates/preferences';
import { defaultShortcuts } from '../../electron/contracts/shortcuts';
import type { Embedder } from '../../electron/backend/knowledge/types';

const owner = 'account:' + randomUUID();
const signal = () => new AbortController().signal;
const exists = async (file: string) => !!(await fs.lstat(file).catch(() => undefined));
async function put(file: string, bytes: string | Buffer) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, bytes);
}
const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1]);
const preview = 'data:image/png;base64,iVBORw0KGgoB';

it('claims only existing business files and preferences, leaving credentials and other owners’ recordings out of the account', async () => {
  const root = await temporaryDirectory('legacy-native');
  const destination = profileDirectory(root, owner);
  const foreignWav = path.join(
    root,
    'interview-recordings-v1',
    profileDirectoryName('local'),
    randomUUID(),
    Date.now() + '-' + randomUUID() + '.wav',
  );
  await put(foreignWav, 'synthetic');
  await put(path.join(root, 'auth-data', 'credentials.bin'), 'not a credential');
  await put(path.join(root, 'auth-data', 'copilot-session.json'), '{"fixture":true}');
  await put(path.join(root, 'chatgpt-usage', 'fixture.txt'), 'synthetic');
  await put(path.join(root, 'copilot-runtime', 'fixture.txt'), 'synthetic');
  expect(await hasLegacyProfileFiles(root)).toBe(false);
  const shortcuts = { ...defaultShortcuts(), screenshot: 'Control+Shift+Z' };
  await writeShortcuts(path.join(root, 'shortcut-settings.json'), shortcuts);
  saveAutoDownload(path.join(root, 'update-settings.json'), false);
  await put(path.join(root, 'auth-data', 'service.json'), JSON.stringify('copilot'));
  const ledger = new UsageLedger(path.join(root, 'chat-usage'));
  await ledger.add('synthetic-service', 'request-one', {
    inputTokens: 2,
    outputTokens: 3,
    totalTokens: 5,
  });
  await ledger.dispose();
  const id = randomUUID(),
    oldImages = new InterviewImageStore(path.join(root, 'interview-images-v1'));
  await oldImages.save([{ id, preview, file: { name: 'fixture.png', bytes: png } }]);
  await oldImages.dispose();
  expect(await hasLegacyProfileFiles(root)).toBe(true);
  await migrateLegacyProfileFiles(root, owner, signal());
  expect(
    (await readShortcuts(path.join(destination, 'shortcut-settings.json'), false)).bindings,
  ).toEqual(shortcuts);
  expect(readAutoDownload(path.join(destination, 'update-settings.json'))).toBe(false);
  expect(
    JSON.parse(await fs.readFile(path.join(destination, 'auth-data', 'service.json'), 'utf8')),
  ).toEqual({
    version: 2,
    service: 'copilot',
    connected: false,
  });
  const usage = new UsageLedger(path.join(destination, 'chat-usage'));
  expect(await usage.get('synthetic-service')).toMatchObject({ totalTokens: 5, requests: 1 });
  await usage.dispose();
  const images = new InterviewImageStore(path.join(destination, 'interview-images-v1'));
  expect((await images.original(id)).bytes).toEqual(png);
  expect(await images.preview(id)).toBe(preview);
  await images.dispose();
  expect(await fs.readFile(foreignWav, 'utf8')).toBe('synthetic');
  expect(await fs.readdir(path.join(destination, 'auth-data'))).toEqual(['service.json']);
  expect(await fs.readdir(path.join(root, 'interview-recordings-v1'))).toEqual([
    profileDirectoryName('local'),
  ]);
  expect(await exists(path.join(destination, 'copilot-runtime'))).toBe(false);
  expect(await exists(path.join(destination, 'chatgpt-usage'))).toBe(false);
  expect(await exists(path.join(root, 'interview-images-v1', id + '.image'))).toBe(true);
});

it('resumes losslessly, retaining existing settings, ledgers and paired images on collision', async () => {
  const root = await temporaryDirectory('legacy-merge'),
    to = profileDirectory(root, owner);
  const old = path.join(root, 'interview-images-v1'),
    current = path.join(to, 'interview-images-v1');
  const conflict = randomUUID(),
    resumed = randomUUID(),
    thumbnailOnly = randomUUID();
  for (const id of [conflict, resumed]) {
    await put(path.join(old, id + '.image'), png);
    await put(path.join(old, id + '.preview'), preview);
  }
  const newOriginal = Buffer.from(png);
  newOriginal[8] = 2;
  await put(path.join(current, conflict + '.image'), newOriginal);
  await put(path.join(current, resumed + '.image'), png);
  await put(path.join(old, thumbnailOnly + '.preview'), preview);
  await put(path.join(root, 'shortcut-settings.json'), 'old settings');
  await put(path.join(to, 'shortcut-settings.json'), 'current settings');
  await put(
    path.join(root, 'auth-data', 'service.json'),
    JSON.stringify({ version: 2, service: 'copilot', connected: true }),
  );
  await put(
    path.join(to, 'auth-data', 'service.json'),
    JSON.stringify({ version: 2, service: 'chatgpt', connected: true }),
  );
  const name = createHash('sha256').update('same service').digest('hex') + '.json';
  await put(path.join(root, 'chat-usage', name), 'old ledger');
  await put(path.join(to, 'chat-usage', name), 'current ledger');
  await put(path.join(root, 'knowledge-v1', 'catalog.json'), 'old index');
  await migrateLegacyProfileFiles(root, owner, signal(), true);
  expect(await exists(path.join(to, 'knowledge-v1'))).toBe(false);
  await put(path.join(to, 'knowledge-v1', 'catalog.json'), 'current index');
  await migrateLegacyProfileFiles(root, owner, signal());
  expect(await fs.readFile(path.join(to, 'knowledge-v1', 'catalog.json'), 'utf8')).toBe(
    'current index',
  );
  expect(await fs.readFile(path.join(current, conflict + '.image'))).toEqual(newOriginal);
  expect(await exists(path.join(current, conflict + '.preview'))).toBe(false);
  expect(await fs.readFile(path.join(current, resumed + '.preview'), 'utf8')).toBe(preview);
  expect(await fs.readFile(path.join(current, thumbnailOnly + '.preview'), 'utf8')).toBe(preview);
  expect(await fs.readFile(path.join(to, 'chat-usage', name), 'utf8')).toBe('current ledger');
  expect(await fs.readFile(path.join(to, 'shortcut-settings.json'), 'utf8')).toBe(
    'current settings',
  );
  expect(JSON.parse(await fs.readFile(path.join(to, 'auth-data', 'service.json'), 'utf8'))).toEqual(
    { version: 2, service: 'chatgpt', connected: true },
  );
});

it('opens the migrated catalog at its original LanceDB revision without requiring a model download', async () => {
  const root = await temporaryDirectory('legacy-index');
  const encoder: Embedder = {
    initialize: async () => {},
    count: (text) => text.length,
    encode: async (texts) =>
      texts.map(() => Array.from({ length: 384 }, (_, i) => (i === 0 ? 1 : 0))),
    close: async () => {},
  };
  const source = new KnowledgeService(path.join(root, 'knowledge-v1'), encoder);
  const doc = {
    documentId: 'synthetic-id',
    baseId: 'base-a',
    name: 'fixture.md',
    bytes: new TextEncoder().encode('# Upgrade\n\nPreserve the public synthetic record.'),
  };
  try {
    await source.indexDocument(doc, signal());
  } finally {
    await source.close();
  }
  await migrateLegacyProfileFiles(root, 'local', signal());
  const copied = new KnowledgeService(
    path.join(profileDirectory(root, 'local'), 'knowledge-v1'),
    encoder,
  );
  try {
    expect(await copied.listDocuments()).toMatchObject([{ documentId: doc.documentId }]);
    const hit = await copied.search('Preserve', 3, 'keyword', signal(), doc.baseId);
    expect(hit[0].documentId).toBe(doc.documentId);
  } finally {
    await copied.close();
  }
});

it('rejects a redirected business directory and invalid owners, and stops an aborted migration before publication', async () => {
  const root = await temporaryDirectory('legacy-links'),
    outside = await temporaryDirectory('legacy-outside');
  await put(path.join(outside, randomUUID() + '.image'), png);
  await fs.symlink(outside, path.join(root, 'interview-images-v1'), 'junction');
  await expect(hasLegacyProfileFiles(root)).rejects.toThrow('路径');
  await expect(migrateLegacyProfileFiles(root, owner, signal())).rejects.toThrow('路径');
  await expect(migrateLegacyProfileFiles(root, 'demo', signal())).rejects.toThrow('路径');
  const aborted = new AbortController();
  aborted.abort();
  await expect(migrateLegacyProfileFiles(root, owner, aborted.signal)).rejects.toThrow();
  expect(await exists(profileDirectory(root, owner))).toBe(false);
});

it('erases only the claimed legacy business files and preferences, including the index snapshot and its recoverable revisions', async () => {
  const root = await temporaryDirectory('legacy-erase'),
    id = randomUUID();
  const erased = [
    'shortcut-settings.json',
    'update-settings.json',
    'auth-data/service.json',
    'interview-images-v1/' + id + '.image',
    'interview-images-v1/' + id + '.preview',
    'chat-usage/' + 'a'.repeat(64) + '.json',
    'knowledge-v1/catalog.json',
    'knowledge-v1/catalog-backup-' + id + '.json',
    'knowledge-v1/revisions/rev-' + id + '.json',
    'knowledge-v1/lance/chunks.lance/segment',
  ];
  const preserved = [
    'auth-data/credentials.bin',
    'auth-data/host-id',
    'auth-data/copilot-session.json',
    'chatgpt-usage/fixture',
    'copilot-runtime/fixture',
    'component-cache/fixture',
    'knowledge-v1/unknown-content',
    'interview-recordings-v1/' + profileDirectoryName('local') + '/owned.wav',
    'account-profiles/' + profileDirectoryName('local') + '/knowledge-v1/catalog.json',
  ];
  for (const name of erased)
    await put(
      path.join(root, name),
      name.endsWith('service.json') ? JSON.stringify('chatgpt') : 'synthetic',
    );
  for (const name of preserved) await put(path.join(root, name), 'preserve');
  await eraseLegacyProfileFiles(root);
  await eraseLegacyProfileFiles(root);
  for (const name of erased) expect(await exists(path.join(root, name))).toBe(false);
  for (const name of preserved)
    expect(await fs.readFile(path.join(root, name), 'utf8')).toBe('preserve');
  expect(await hasLegacyProfileFiles(root)).toBe(false);
});
