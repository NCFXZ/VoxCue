import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  localKnowledge,
  openDocumentsDatabase,
  documentAccept,
  validateFiles,
  previewDocument,
  type LocalDocument,
} from '../../../../shared/src/services/knowledge';
async function legacyBackups(seed: LocalDocument[] = []) {
  const db = await new Promise<IDBDatabase>((resolve) => {
    const request = indexedDB.open('voxcue-original-backups');
    request.onupgradeneeded = () =>
      request.result.createObjectStore('versions', { keyPath: 'backupId' });
    request.onsuccess = () => resolve(request.result);
  });
  const values = await new Promise<any[]>((resolve, reject) => {
    const tx = db.transaction('versions', 'readwrite');
    const store = tx.objectStore('versions');
    for (const doc of seed)
      store.add({ ...doc, backupId: crypto.randomUUID(), backedUpAt: Date.now() });
    const request = store.getAll();
    tx.oncomplete = () => resolve(request.result);
    tx.onerror = tx.onabort = () => reject(tx.error);
  });
  db.close();
  return values;
}
afterEach(() => vi.unstubAllGlobals());
describe('本地知识库', () => {
  it('文档保存、文本预览和删除独立于桌面服务，Office 原件保留', async () => {
    vi.stubGlobal('window', {});
    const id = crypto.randomUUID();
    await localKnowledge.saveBase({ id, name: '原件', createdAt: Date.now() });
    await localKnowledge.importDocuments(id, [
      new File(['文本内容'], 'note.md'),
      new File(['pdf bytes'], 'document.pdf'),
    ]);
    const docs = await localKnowledge.listDocuments(id);
    expect(await previewDocument(docs.find((d) => d.name === 'note.md')!)).toBe('文本内容');
    const pdf = docs.find((d) => d.name === 'document.pdf')!;
    expect(await pdf.blob.text()).toBe('pdf bytes');
    expect(await previewDocument(pdf)).toContain('仅支持 TXT');
    await localKnowledge.deleteDocument(pdf.id);
    expect(await localKnowledge.listDocuments(id)).toHaveLength(1);
    await localKnowledge.deleteBase(id);
  });
  it('保存与重命名、导入替换同名文件、跨实例读取，删除知识库级联删除文档', async () => {
    const base = { id: crypto.randomUUID(), name: '项目经历', createdAt: Date.now() };
    await localKnowledge.saveBase(base);
    await localKnowledge.importDocuments(base.id, [new File(['项目内容'], 'project.txt')]);
    await localKnowledge.importDocuments(base.id, [new File(['更新内容'], 'project.txt')]);
    const docs = await localKnowledge.listDocuments(base.id);
    expect(docs).toHaveLength(1);
    expect(await docs[0].blob.text()).toBe('更新内容');
    await localKnowledge.saveBase({ ...base, name: '更新的项目' });
    expect((await localKnowledge.listBases()).find((b) => b.id === base.id)?.name).toBe(
      '更新的项目',
    );
    await localKnowledge.deleteBase(base.id);
    expect(await localKnowledge.listDocuments(base.id)).toEqual([]);
    expect((await localKnowledge.listBases()).find((b) => b.id === base.id)).toBeUndefined();
  });
  it('不允许写入不存在的知识库', async () => {
    await expect(
      localKnowledge.importDocuments('missing', [new File(['text'], 'test.txt')]),
    ).rejects.toThrow();
    expect(await localKnowledge.listDocuments('missing')).toEqual([]);
  });
  it('同一批次的同名文件整批拒绝且不覆盖现有原件', async () => {
    const id = crypto.randomUUID();
    await localKnowledge.saveBase({ id, name: '同名测试', createdAt: Date.now() });
    await localKnowledge.importDocuments(id, [new File(['现有原件'], 'same.txt')]);
    const list = vi.spyOn(localKnowledge, 'listDocuments');
    await expect(
      localKnowledge.importDocuments(id, [
        new File(['第一份'], 'same.txt'),
        new File(['第二份'], 'same.txt'),
      ]),
    ).rejects.toThrow('同一批次包含同名文件，请分批导入。');
    expect(list).not.toHaveBeenCalled();
    list.mockRestore();
    const docs = await localKnowledge.listDocuments(id);
    expect(docs).toHaveLength(1);
    expect(await docs[0].blob.text()).toBe('现有原件');
    await localKnowledge.deleteBase(id);
  });
  it('限制空文件、格式和大小，整批校验后才写入', () => {
    expect(() => validateFiles([{ name: 'empty.txt', size: 0 }])).toThrow('为空');
    expect(() => validateFiles([{ name: 'app.exe', size: 1 }])).toThrow(
      '不支持的文件格式：app.exe',
    );
    expect(() => validateFiles([{ name: 'big.pdf', size: 21 * 1024 * 1024 }])).toThrow('超过');
    expect(() =>
      validateFiles(Array.from({ length: 21 }, () => ({ name: 'a.txt', size: 1 }))),
    ).toThrow('最多导入 20');
  });
  it('同一批列出全部不支持格式，按文件名去重并保留选择顺序', () => {
    expect(() =>
      validateFiles([
        { name: 'empty.txt', size: 0 },
        { name: 'slides.pptx', size: 1 },
        { name: 'sheet.xlsx', size: 1 },
        { name: 'slides.pptx', size: 2 },
        { name: 'archive.zip', size: 1 },
      ]),
    ).toThrow('不支持的文件格式：slides.pptx, sheet.xlsx, archive.zip');
    expect(() =>
      validateFiles([
        { name: '保留、原名.pptx', size: 1 },
        { name: 'keep, original.xlsx', size: 1 },
        { name: '保留、原名.pptx', size: 2 },
      ]),
    ).toThrow('不支持的文件格式：保留、原名.pptx, keep, original.xlsx');
    const names = Array.from({ length: 20 }, (_, index) => 'long'.repeat(100) + index + '.bin');
    let message = '';
    try {
      validateFiles(names.map((name) => ({ name, size: 1 })));
    } catch (error) {
      message = (error as Error).message;
    }
    const displayed = message.slice('不支持的文件格式：'.length).split(', ');
    expect(displayed).toHaveLength(20);
    expect(displayed.every((name) => name.length <= 240)).toBe(true);
    expect(displayed[0]).toContain('…');
    expect(displayed[0]).toMatch(/0\.bin$/);
    expect(displayed[19]).toMatch(/19\.bin$/);
  });
  it('多个不支持文件整批拒绝前不读取字节、读取原件、备份或停用索引', async () => {
    const desktop = vi.fn();
    vi.stubGlobal('window', { desktop: { knowledge: desktop } });
    const list = vi.spyOn(localKnowledge, 'listDocuments');
    const bytes = vi.spyOn(Blob.prototype, 'arrayBuffer');
    try {
      await expect(
        localKnowledge.importDocuments('unused', [
          new File(['valid'], 'same.txt'),
          new File(['slide'], 'slides.pptx'),
          new File(['sheet'], 'sheet.xlsx'),
          new File(['duplicate'], 'slides.pptx'),
        ]),
      ).rejects.toThrow('不支持的文件格式：slides.pptx, sheet.xlsx');
      expect(list).not.toHaveBeenCalled();
      expect(bytes).not.toHaveBeenCalled();
      expect(desktop).not.toHaveBeenCalled();
    } finally {
      list.mockRestore();
      bytes.mockRestore();
    }
  });
  it('选择器仅列可索引格式，混合导入遇其他格式整批拒绝且保留旧原件', async () => {
    expect(documentAccept).toBe('.pdf,.doc,.docx,.txt,.md');
    for (const name of ['a.PDF', 'a.doc', 'a.DOCX', 'a.txt', 'a.MD'])
      expect(() => validateFiles([{ name, size: 20 * 1024 * 1024 }])).not.toThrow();
    for (const name of ['a.ppt', 'a.PPTX', 'a.xls', 'a.XLSX', 'a.rtf', 'a.html', 'a.zip', 'a.jpg'])
      expect(() => validateFiles([{ name, size: 1 }])).toThrow(`不支持的文件格式：${name}`);
    vi.stubGlobal('window', {});
    const id = crypto.randomUUID();
    await localKnowledge.saveBase({ id, name: '忽略格式', createdAt: Date.now() });
    await localKnowledge.importDocuments(id, [new File(['old original'], 'same.txt')]);
    const db = await openDocumentsDatabase(true);
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('documents', 'readwrite');
      for (const name of ['slides.pptx', 'sheet.xls'])
        tx.objectStore('documents').put({
          id: crypto.randomUUID(),
          baseId: id,
          name,
          size: 3,
          type: '',
          createdAt: Date.now(),
          blob: new Blob(['old']),
        });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    await expect(
      localKnowledge.importDocuments(id, [
        new File(['replacement'], 'same.txt'),
        new File(['unsupported'], 'slides.pptx'),
      ]),
    ).rejects.toThrow('不支持的文件格式：slides.pptx');
    const documents = await localKnowledge.listDocuments(id);
    expect(documents).toHaveLength(3);
    expect(await documents.find((doc) => doc.name === 'same.txt')!.blob.text()).toBe(
      'old original',
    );
    expect(await documents.find((doc) => doc.name === 'slides.pptx')!.blob.text()).toBe('old');
    expect(await documents.find((doc) => doc.name === 'sheet.xls')!.blob.text()).toBe('old');
    await localKnowledge.deleteBase(id);
  });
  it('不支持格式校验失败前不读取原件，空选择直接无操作', async () => {
    const list = vi.spyOn(localKnowledge, 'listDocuments');
    try {
      for (const name of ['archive.zip', 'photo.jpg'])
        await expect(
          localKnowledge.importDocuments('unused', [new File(['unsupported'], name)]),
        ).rejects.toThrow(`不支持的文件格式：${name}`);
      await expect(localKnowledge.importDocuments('unused', [])).resolves.toBeUndefined();
      expect(list).not.toHaveBeenCalled();
    } finally {
      list.mockRestore();
    }
  });
  it('同一时间仅保存一批原件，拒绝并发导入且完成后可再次导入', async () => {
    vi.stubGlobal('window', {});
    const id = crypto.randomUUID();
    await localKnowledge.saveBase({ id, name: '串行导入', createdAt: Date.now() });
    await localKnowledge.importDocuments(id, [new File(['old'], 'same.txt')]);
    let complete!: (value: { ok: true; value: undefined }) => void;
    const knowledge = vi.fn(
      () =>
        new Promise<{ ok: true; value: undefined }>((resolve) => {
          complete = resolve;
        }),
    );
    vi.stubGlobal('window', { desktop: { knowledge } });
    const first = localKnowledge.importDocuments(id, [new File(['new'], 'same.txt')]);
    await vi.waitFor(() => expect(knowledge).toHaveBeenCalledTimes(1));
    await expect(
      localKnowledge.importDocuments(id, [new File(['later'], 'later.md')]),
    ).rejects.toThrow('资料处理中，请稍后重试。');
    complete({ ok: true, value: undefined });
    await first;
    vi.stubGlobal('window', {});
    await localKnowledge.importDocuments(id, [new File(['later'], 'later.md')]);
    const documents = await localKnowledge.listDocuments(id);
    expect(documents).toHaveLength(2);
    expect(await documents.find((doc) => doc.name === 'same.txt')!.blob.text()).toBe('new');
    await localKnowledge.deleteBase(id);
  });
  it('同名替换不新增隐藏备份，原生索引停用失败时不覆盖原件', async () => {
    const id = crypto.randomUUID();
    await localKnowledge.saveBase({ id, name: '备份', createdAt: Date.now() });
    await localKnowledge.importDocuments(id, [new File(['original-private-test'], 'same.txt')]);
    vi.stubGlobal('window', {
      desktop: { knowledge: vi.fn(async () => ({ ok: false, error: '索引停用失败' })) },
    });
    await expect(
      localKnowledge.importDocuments(id, [new File(['replacement'], 'same.txt')]),
    ).rejects.toThrow('停用失败');
    expect(await (await localKnowledge.listDocuments(id))[0].blob.text()).toBe(
      'original-private-test',
    );
    vi.stubGlobal('window', {});
    await localKnowledge.importDocuments(id, [new File(['replacement'], 'same.txt')]);
    expect((await legacyBackups()).filter((value) => value.baseId === id)).toEqual([]);
    expect(await (await localKnowledge.listDocuments(id))[0].blob.text()).toBe('replacement');
    await localKnowledge.deleteBase(id);
  });
  it('简历替换事务失败保留旧原件，成功后仅保留当前一份', async () => {
    vi.stubGlobal('window', {});
    await localKnowledge.importDocuments('personal-resume', [new File(['old resume'], 'old.txt')]);
    const previous = (await localKnowledge.listDocuments('personal-resume'))[0];
    const put = IDBObjectStore.prototype.put;
    const writes = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
      this: IDBObjectStore,
      value,
      key,
    ) {
      const result = put.call(this, value, key);
      if (this.name === 'documents' && value.name === 'replacement.txt')
        queueMicrotask(() => this.transaction.abort());
      return result;
    });
    try {
      await expect(
        localKnowledge.importDocuments('personal-resume', [
          new File(['new resume'], 'replacement.txt'),
        ]),
      ).rejects.toThrow('本地保存失败');
    } finally {
      writes.mockRestore();
    }
    const retained = await localKnowledge.listDocuments('personal-resume');
    expect(retained).toHaveLength(1);
    expect(retained[0].id).toBe(previous.id);
    expect(await retained[0].blob.text()).toBe('old resume');
    await localKnowledge.importDocuments('personal-resume', [
      new File(['new resume'], 'replacement.txt'),
    ]);
    const current = await localKnowledge.listDocuments('personal-resume');
    expect(current).toHaveLength(1);
    expect(current[0].name).toBe('replacement.txt');
    expect(await current[0].blob.text()).toBe('new resume');
    expect((await legacyBackups()).some((value) => value.baseId === 'personal-resume')).toBe(false);
    await expect(
      localKnowledge.importDocuments('personal-resume', [
        new File(['one'], 'one.txt'),
        new File(['two'], 'two.txt'),
      ]),
    ).rejects.toThrow('每次只能导入一份简历');
    expect(await localKnowledge.listDocuments('personal-resume')).toHaveLength(1);
    await legacyBackups([previous]);
    await localKnowledge.deleteDocument(current[0].id);
    expect(await localKnowledge.listDocuments('personal-resume')).toEqual([]);
    expect((await legacyBackups()).some((value) => value.baseId === 'personal-resume')).toBe(false);
  });
  it('显式删除仅清除对应原件或知识库的备份', async () => {
    vi.stubGlobal('window', {});
    const first = crypto.randomUUID(),
      second = crypto.randomUUID();
    for (const id of [first, second]) {
      await localKnowledge.saveBase({ id, name: '合成备份归属', createdAt: Date.now() });
      await localKnowledge.importDocuments(id, [new File(['current'], 'same.txt')]);
      await legacyBackups(await localKnowledge.listDocuments(id));
    }
    const doc = (await localKnowledge.listDocuments(first))[0];
    expect((await legacyBackups()).some((value) => value.id === doc.id)).toBe(true);
    await localKnowledge.deleteDocument(doc.id);
    expect((await legacyBackups()).some((value) => value.id === doc.id)).toBe(false);
    expect((await legacyBackups()).some((value) => value.baseId === second)).toBe(true);
    await localKnowledge.deleteBase(second);
    expect((await legacyBackups()).some((value) => value.baseId === second)).toBe(false);
    await localKnowledge.deleteBase(first);
  });
  it('升级旧备份库后只按所选文档或知识库的主键删除，旧窗口占用时可以重试', async () => {
    vi.stubGlobal('indexedDB', new IDBFactory());
    vi.stubGlobal('window', {});
    const base = { id: 'selected', name: 'Synthetic', createdAt: 1 };
    await localKnowledge.saveBase(base);
    await localKnowledge.importDocuments(base.id, [new File(['one'], 'one.txt'), new File(['two'], 'two.txt')]);
    const [one, two] = await localKnowledge.listDocuments(base.id);
    await legacyBackups([one, one, two, ...Array.from({ length: 997 }, (_, index) => ({
      ...two, id: 'other-' + index, baseId: 'unrelated',
    }))]);
    const old = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('voxcue-original-backups', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      await expect(localKnowledge.deleteDocument(one.id)).rejects.toThrow('原件备份删除失败');
      expect(await localKnowledge.listDocuments(base.id)).toHaveLength(2);
    } finally { old.close(); }
    const step = IDBCursor.prototype.continue;
    const visited: string[] = [];
    const cursor = vi.spyOn(IDBCursor.prototype, 'continue').mockImplementation(function (this: IDBCursor, key) {
      const source = this.source;
      if (source instanceof IDBIndex && source.objectStore.name === 'versions') {
        expect(this).not.toBeInstanceOf(IDBCursorWithValue);
        visited.push(source.name);
      } else if (source instanceof IDBObjectStore && source.name === 'versions') throw Error('全表扫描');
      return step.call(this, key);
    });
    try {
      await localKnowledge.deleteDocument(one.id);
      expect(visited).toEqual(['id', 'id']);
      await localKnowledge.deleteBase(base.id);
      expect(visited).toEqual(['id', 'id', 'baseId']);
    } finally { cursor.mockRestore(); }
    const remaining = await legacyBackups();
    expect(remaining).toHaveLength(997);
    expect(remaining.every(doc => doc.baseId === 'unrelated')).toBe(true);
    expect(await remaining[0].blob.text()).toBe(await two.blob.text());
  });
});
