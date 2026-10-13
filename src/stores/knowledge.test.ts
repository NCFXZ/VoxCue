import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  listBases: vi.fn(),
  listDocuments: vi.fn(),
  saveBase: vi.fn(),
  deleteBase: vi.fn(),
  importDocuments: vi.fn(),
  deleteDocument: vi.fn(),
}));
vi.mock('../services/knowledge', () => ({ localKnowledge: mocks }));
import { useKnowledge } from './knowledge';
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
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
  });
});
describe('知识库对抗性状态切换', () => {
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
