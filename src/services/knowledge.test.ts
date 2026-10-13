import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { localKnowledge, validateFiles, previewDocument } from './knowledge';
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
  it('同一批次的同名文件只保留最后一份', async () => {
    const id = crypto.randomUUID();
    await localKnowledge.saveBase({ id, name: '同名测试', createdAt: Date.now() });
    await localKnowledge.importDocuments(id, [
      new File(['第一份'], 'same.txt'),
      new File(['第二份'], 'same.txt'),
    ]);
    const docs = await localKnowledge.listDocuments(id);
    expect(docs).toHaveLength(1);
    expect(await docs[0].blob.text()).toBe('第二份');
    await localKnowledge.deleteBase(id);
  });
  it('限制空文件、格式和大小，整批校验后才写入', () => {
    expect(() => validateFiles([{ name: 'empty.txt', size: 0 }])).toThrow('为空');
    expect(() => validateFiles([{ name: 'app.exe', size: 1 }])).toThrow('不支持');
    expect(() => validateFiles([{ name: 'big.pdf', size: 21 * 1024 * 1024 }])).toThrow('超过');
  });
});
