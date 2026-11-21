import { afterEach, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { EventEmitter } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { profileDirectory } from '../../electron/accountProfilePaths';
import { createProfileImportReader } from '../../src/services/profileImportReader';
import { historyStorageKey } from '../../src/services/history';
import { profileStorageKey } from '../../src/services/storedValues';
import { localKnowledge } from '../../src/services/knowledge';
import { openProfileImportSource } from '../../electron/profileImportSource';
import { profilePartition } from '../../electron/window';
import { InterviewImageStore } from '../../electron/backend/interview/images';

const browser = vi.hoisted(() => ({ construct: vi.fn(), execute: vi.fn(), destroyed: vi.fn() }));
vi.mock('electron', () => ({
  BrowserWindow: class extends EventEmitter {
    private url = '';
    private closed = false;
    webContents = Object.assign(new EventEmitter(), {
      setWindowOpenHandler: vi.fn(),
      isDestroyed: () => this.closed,
      getURL: () => this.url,
      executeJavaScript: browser.execute,
    });
    constructor(options: unknown) {
      super();
      browser.construct(options);
    }
    async loadURL(url: string) {
      this.url = url;
    }
    isDestroyed() {
      return this.closed;
    }
    destroy() {
      this.closed = true;
      this.emit('closed');
      browser.destroyed();
    }
  },
}));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it('reads from a source with no Desktop API and leaves an empty source database absent', async () => {
  const values = new Map<string, string>();
  const db = new IDBFactory();
  vi.stubGlobal('indexedDB', db);
  vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null });
  values.set(
    profileStorageKey,
    JSON.stringify({ name: '', jobDescription: '', background: '', language: '简体中文' }),
  );
  expect((await createProfileImportReader()).items).toEqual([]);
  expect(await db.databases()).toEqual([]);
  values.set(
    profileStorageKey,
    JSON.stringify({ name: 'Synthetic', jobDescription: '', background: '' }),
  );
  values.set(
    historyStorageKey,
    JSON.stringify([
      {
        id: 'record1',
        title: 'Synthetic',
        startedAt: 1,
        endedAt: 2,
        status: 'ended',
        transcripts: [],
        answers: [],
        mock: false,
      },
    ]),
  );
  await localKnowledge.importDocuments('personal-resume', [new File(['sample'], 'resume.txt')]);
  const reader = await createProfileImportReader();
  expect(reader.items.map((item) => item.key)).toEqual([
    'profile:main',
    'resume:main',
    'record:record1',
  ]);
  await expect(reader.read(0, reader.items[0].size)).rejects.toThrow();
});

it('loads only the requested partition without a preload, restricts offsets, and aborts an outstanding read', async () => {
  const owner = 'account:9a701271-24d1-4339-aaef-e3ec9a809e52';
  const signal = new AbortController();
  browser.execute.mockResolvedValueOnce([{ key: 'profile:main', size: 8 }]);
  const reader = await openProfileImportSource(owner, signal.signal, {
    userData: os.tmpdir(),
    indexFile: path.join(os.tmpdir(), 'index.html'),
  });
  const options = browser.construct.mock.calls[0][0];
  expect(options.show).toBe(false);
  expect(options.webPreferences).toMatchObject({
    partition: profilePartition(owner),
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
  });
  expect(options.webPreferences).not.toHaveProperty('preload');
  await expect(reader.read('outside:source', 0)).rejects.toThrow();
  await expect(reader.read('profile:main', -1)).rejects.toThrow();
  expect(browser.execute).toHaveBeenCalledTimes(1);
  browser.execute.mockResolvedValueOnce(Buffer.from('document').toString('base64'));
  expect(Buffer.from(await reader.read('profile:main', 0)).toString()).toBe('document');
  browser.execute.mockImplementationOnce(() => new Promise(() => {}));
  const pending = reader.read('profile:main', 0);
  signal.abort();
  await expect(pending).rejects.toThrow();
  await reader.close();
  expect(browser.destroyed).toHaveBeenCalledTimes(1);
});

it.each(['missing', 'corrupt', 'replaced', 'complete'])('defers a %s screenshot until its interview is selected', async mode => {
  const id = crypto.randomUUID(), key = 'image:' + id;
  const rows = [{ key: 'profile:main', size: 8 }, { key: 'record:r', size: 40, imageIds: [id] }, { key, size: 0 }];
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgaDgAAAHEAUFzHAXEAAAAAElFTkSuQmCC', 'base64');
  const root = await mkdtemp(path.join(os.tmpdir(), 'voxcue-import-image-'));
  const directory = path.join(profileDirectory(root, 'local'), 'interview-images-v1');
  const file = path.join(directory, id + '.image');
  const original = vi.spyOn(InterviewImageStore.prototype, 'original');
  try {
    await mkdir(directory, { recursive: true });
    if (mode !== 'missing') await writeFile(file, mode === 'corrupt' ? png.subarray(0, 18) : png);
    browser.execute.mockResolvedValueOnce(rows).mockImplementation(async expr =>
      expr.includes('source.preview') ? 'data:image/png;base64,' + png.toString('base64') : Buffer.from('document').toString('base64'));
    const reader = await openProfileImportSource('local', new AbortController().signal, {
      userData: root, indexFile: path.join(root, 'index.html'),
    });
    try {
      expect(reader.items.map(i => i.key)).toEqual(rows.map(i => i.key));
      expect(Buffer.from(await reader.read('profile:main', 0)).toString()).toBe('document');
      expect(original).not.toHaveBeenCalled();
      if (mode === 'replaced') {
        const changed = Buffer.from(png);
        changed[changed.length - 1] ^= 1;
        await writeFile(file + '.next', changed);
        await rename(file + '.next', file);
        await expect(reader.read(key, 0)).rejects.toThrow('已变化');
      } else if (mode === 'complete') {
        const size = await reader.imageSize(key);
        const bytes = await reader.read(key, 0);
        expect(bytes.byteLength).toBe(size);
        expect(Buffer.from(bytes).subarray(-png.length)).toEqual(png);
        expect(original).toHaveBeenCalledTimes(1);
      } else await expect(reader.imageSize(key)).rejects.toThrow();
    } finally {
      await reader.close();
    }
  } finally {
    original.mockRestore();
    await rm(root, { recursive: true, force: true });
  }
});
