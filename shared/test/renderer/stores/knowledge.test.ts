import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  listBases: vi.fn(),
  listDocuments: vi.fn(),
  saveBase: vi.fn(),
  deleteBase: vi.fn(),
  importDocuments: vi.fn(),
  deleteDocument: vi.fn(),
  validateFiles: vi.fn(),
}));
vi.mock('../../../../shared/src/services/knowledge', () => ({
  localKnowledge: mocks,
  validateFiles: mocks.validateFiles,
}));
import { useKnowledge } from '../../../../shared/src/stores/knowledge';
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((r, fail) => {
    resolve = r;
    reject = fail;
  });
  return { promise, resolve, reject };
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.listBases.mockResolvedValue([]);
  mocks.listDocuments.mockResolvedValue([]);
  useKnowledge.setState({
    bases: [],
    documents: [],
    selectedId: 'base',
    busy: false,
    loading: false,
    error: null,
    errorBaseId: null,
    editorError: null,
  });
});
describe('知识库对抗性状态切换', () => {
  it('创建后的列表读取失败留在编辑器，不覆盖已有提示或误报成功', async () => {
    mocks.listBases.mockRejectedValueOnce(Error('合成列表读取失败'));
    useKnowledge.setState({ error: '已有提示', errorBaseId: null });
    expect(await useKnowledge.getState().create('合成知识库')).toBe(false);
    expect(useKnowledge.getState()).toMatchObject({
      editorError: '合成列表读取失败',
      error: '已有提示',
      selectedId: 'base',
      busy: false,
    });
    expect(mocks.listDocuments).not.toHaveBeenCalled();
  });
  it('重命名期间和成功后保留原导入错误，编辑失败不覆盖原提示', async () => {
    const base = { id: 'base', name: '原名称', createdAt: 1 };
    const error = '不支持的文件格式：archive.zip';
    useKnowledge.setState({ bases: [base], error, errorBaseId: 'base' });
    const pending = deferred<void>();
    mocks.saveBase.mockReturnValueOnce(pending.promise);
    mocks.listBases.mockResolvedValueOnce([{ ...base, name: '新名称' }]);
    const renaming = useKnowledge.getState().rename('新名称');
    expect(useKnowledge.getState()).toMatchObject({
      error,
      errorBaseId: 'base',
      editorError: null,
      busy: true,
    });
    pending.resolve();
    expect(await renaming).toBe(true);
    expect(useKnowledge.getState()).toMatchObject({
      error,
      errorBaseId: 'base',
      editorError: null,
      busy: false,
    });
    mocks.saveBase.mockRejectedValueOnce(Error('合成重命名失败'));
    expect(await useKnowledge.getState().rename('再次更名')).toBe(false);
    expect(useKnowledge.getState()).toMatchObject({
      error,
      errorBaseId: 'base',
      editorError: '合成重命名失败',
    });
    useKnowledge.getState().dismissEditorError();
    expect(useKnowledge.getState()).toMatchObject({
      error,
      errorBaseId: 'base',
      editorError: null,
    });
  });
  it('导入错误仅归属当前库，关闭、重开或切换后清除', async () => {
    mocks.validateFiles.mockImplementation(() => {
      throw Error('不支持的文件格式：archive.zip');
    });
    const files = [new File(['unsupported'], 'archive.zip')];
    await useKnowledge.getState().importFiles(files);
    expect(useKnowledge.getState()).toMatchObject({
      error: '不支持的文件格式：archive.zip',
      errorBaseId: 'base',
    });
    await useKnowledge.getState().open(null);
    expect(useKnowledge.getState()).toMatchObject({
      selectedId: null,
      error: null,
      errorBaseId: null,
    });
    await useKnowledge.getState().open('base');
    expect(useKnowledge.getState().error).toBeNull();
    await useKnowledge.getState().importFiles(files);
    await useKnowledge.getState().open('other');
    expect(useKnowledge.getState()).toMatchObject({
      selectedId: 'other',
      error: null,
      errorBaseId: null,
    });
  });
  it('下一批错误替换上一批，手动关闭仅清提示不改变当前文档', async () => {
    mocks.validateFiles
      .mockImplementationOnce(() => {
        throw Error('不支持的文件格式：first.zip、first.jpg');
      })
      .mockImplementationOnce(() => {
        throw Error('不支持的文件格式：second.yaml');
      });
    const document = { id: 'retained' };
    useKnowledge.setState({ documents: [document] as never });
    await useKnowledge.getState().importFiles([new File(['unsupported'], 'first.zip')]);
    expect(useKnowledge.getState().error).toContain('first.jpg');
    await useKnowledge.getState().importFiles([new File(['unsupported'], 'second.yaml')]);
    expect(useKnowledge.getState().error).toBe('不支持的文件格式：second.yaml');
    useKnowledge.getState().dismissError();
    expect(useKnowledge.getState()).toMatchObject({
      error: null,
      errorBaseId: null,
      selectedId: 'base',
      documents: [document],
    });
  });
  it('同一库关闭后重开，旧导入的迟到失败不能重新显示', async () => {
    const pending = deferred<void>();
    mocks.importDocuments.mockReturnValueOnce(pending.promise);
    const old = useKnowledge.getState().importFiles([new File(['text'], 'a.txt')]);
    await useKnowledge.getState().open(null);
    await useKnowledge.getState().open('base');
    pending.reject(Error('old import failure'));
    await old;
    expect(useKnowledge.getState()).toMatchObject({
      selectedId: 'base',
      error: null,
      errorBaseId: null,
    });
  });
  it('删除失败或忙碌时明确返回失败，不让按钮将失败当作成功', async () => {
    mocks.deleteDocument.mockRejectedValueOnce(new Error('合成删除失败'));
    expect(await useKnowledge.getState().removeDocument('doc')).toBe(false);
    expect(useKnowledge.getState().error).toBe('合成删除失败');
    expect(useKnowledge.getState().busy).toBe(false);
    mocks.deleteDocument.mockResolvedValueOnce(undefined);
    expect(await useKnowledge.getState().removeDocument('doc')).toBe(true);
    useKnowledge.setState({ busy: true });
    expect(await useKnowledge.getState().removeDocument('doc')).toBe(false);
    expect(mocks.deleteDocument).toHaveBeenCalledTimes(2);
  });
  it('切换知识库后忽略旧列表失败，列表读取保留操作错误', async () => {
    let reject!: (error: Error) => void;
    mocks.listDocuments.mockReturnValueOnce(
      new Promise((_, r) => {
        reject = r;
      }),
    );
    const old = useKnowledge.getState().open('old');
    await useKnowledge.getState().open('new');
    reject(new Error('old failure'));
    await old;
    expect(useKnowledge.getState().error).toBeNull();
    useKnowledge.setState({ error: '文件超过 20 MB' });
    await useKnowledge.getState().load();
    expect(useKnowledge.getState().error).toBe('文件超过 20 MB');
  });
  it('重复打开同一知识库时仅接受最后一个响应', async () => {
    const old = deferred<unknown[]>();
    mocks.listDocuments.mockReturnValueOnce(old.promise).mockResolvedValueOnce([{ id: 'new' }]);
    const first = useKnowledge.getState().open('base');
    await useKnowledge.getState().open('base');
    old.resolve([{ id: 'old' }]);
    await first;
    expect(useKnowledge.getState().documents).toEqual([{ id: 'new' }]);
  });
  it('云资料刷新期间保留可见文档与操作提示，读取失败仍保留原件', async () => {
    const documents = [{ id: 'reading' }];
    const pending = deferred<unknown[]>();
    mocks.listDocuments.mockResolvedValueOnce(documents).mockReturnValueOnce(pending.promise);
    await useKnowledge.getState().open('base');
    useKnowledge.setState({ error: '文件超过 20 MB', errorBaseId: 'base' });
    const refreshed = useKnowledge.getState().open('base');
    expect(useKnowledge.getState()).toMatchObject({
      documents, loading: false, selectedId: 'base', error: '文件超过 20 MB',
    });
    pending.resolve([...documents, { id: 'downloaded' }]);
    await refreshed;
    const updated = useKnowledge.getState().documents;
    expect(updated.map((doc) => doc.id)).toEqual(['reading', 'downloaded']);
    expect(useKnowledge.getState().error).toBe('文件超过 20 MB');
    mocks.listDocuments.mockRejectedValueOnce(Error('读取失败'));
    await useKnowledge.getState().open('base');
    expect(useKnowledge.getState()).toMatchObject({ documents: updated, loading: false, error: '读取失败' });
  });
  it('同库同步读取不会使进行中的删除失去归属或覆盖删除后的结果', async () => {
    const deletion = deferred<void>();
    const earlierRead = deferred<unknown[]>();
    mocks.listDocuments
      .mockResolvedValueOnce([{ id: 'old' }])
      .mockReturnValueOnce(earlierRead.promise)
      .mockResolvedValueOnce([]);
    mocks.deleteDocument.mockReturnValueOnce(deletion.promise);
    await useKnowledge.getState().open('base');
    const removing = useKnowledge.getState().removeDocument('old');
    const refreshing = useKnowledge.getState().open('base');
    deletion.resolve();
    expect(await removing).toBe(true);
    earlierRead.resolve([{ id: 'old' }]);
    await refreshing;
    expect(useKnowledge.getState()).toMatchObject({ selectedId: 'base', documents: [], busy: false });
  });
  it('重复提交创建不会写入两个知识库', async () => {
    const pending = deferred<void>();
    mocks.saveBase.mockReturnValue(pending.promise);
    const first = useKnowledge.getState().create('重复测试');
    const second = useKnowledge.getState().create('重复测试');
    expect(mocks.saveBase).toHaveBeenCalledTimes(1);
    pending.resolve();
    await Promise.all([first, second]);
    expect(useKnowledge.getState().busy).toBe(false);
  });
  it('取消文件选择静默返回，不读取原件或提交索引', async () => {
    await useKnowledge.getState().importFiles([]);
    expect(useKnowledge.getState().error).toBeNull();
    expect(useKnowledge.getState().busy).toBe(false);
    expect(mocks.validateFiles).not.toHaveBeenCalled();
    expect(mocks.importDocuments).not.toHaveBeenCalled();
    expect(mocks.listDocuments).not.toHaveBeenCalled();
  });
  it.each(['archive.zip', 'photo.jpg'])(
    '不支持格式 %s 显示文件名，不读取或提交索引',
    async (name) => {
      mocks.validateFiles.mockImplementationOnce(() => {
        throw Error(`不支持的文件格式：${name}`);
      });
      await useKnowledge.getState().importFiles([new File(['unsupported'], name)]);
      expect(useKnowledge.getState().error).toBe(`不支持的文件格式：${name}`);
      expect(useKnowledge.getState().busy).toBe(false);
      expect(mocks.importDocuments).not.toHaveBeenCalled();
      expect(mocks.listDocuments).not.toHaveBeenCalled();
    },
  );
  it('混合批次格式校验失败后整批停止，不保存支持项或提交索引', async () => {
    mocks.validateFiles.mockImplementationOnce(() => {
      throw Error('不支持的文件格式：a.PPTX');
    });
    const text = new File(['synthetic text'], 'a.txt');
    const files = [text, new File(['unsupported'], 'a.PPTX')];
    await useKnowledge.getState().importFiles(files);
    expect(mocks.validateFiles).toHaveBeenCalledWith(files);
    expect(mocks.importDocuments).not.toHaveBeenCalled();
    expect(mocks.listDocuments).not.toHaveBeenCalled();
    expect(useKnowledge.getState().error).toBe('不支持的文件格式：a.PPTX');
  });
  it('快速重复导入只提交一批，结束后释放忙碌状态', async () => {
    const pending = deferred<void>();
    mocks.importDocuments.mockReturnValueOnce(pending.promise);
    const files = [new File(['synthetic body'], 'same.txt')];
    const first = useKnowledge.getState().importFiles(files);
    await useKnowledge.getState().importFiles(files);
    expect(mocks.importDocuments).toHaveBeenCalledTimes(1);
    pending.resolve();
    await first;
    expect(useKnowledge.getState().busy).toBe(false);
  });
  it('切换知识库后不将旧导入失败写入新页面', async () => {
    let reject!: (error: Error) => void;
    mocks.importDocuments.mockReturnValueOnce(
      new Promise((_, fail) => {
        reject = fail;
      }),
    );
    const first = useKnowledge.getState().importFiles([new File(['text'], 'a.txt')]);
    await useKnowledge.getState().open('other');
    reject(Error('old import failure'));
    await first;
    expect(useKnowledge.getState().selectedId).toBe('other');
    expect(useKnowledge.getState().error).toBeNull();
    expect(useKnowledge.getState().busy).toBe(false);
  });
  it('删除旧知识库完成时不关闭后来打开的知识库', async () => {
    const pending = deferred<void>();
    mocks.deleteBase.mockReturnValue(pending.promise);
    const first = useKnowledge.getState().removeBase();
    await useKnowledge.getState().open('other');
    pending.resolve();
    await first;
    expect(useKnowledge.getState().selectedId).toBe('other');
  });
});
