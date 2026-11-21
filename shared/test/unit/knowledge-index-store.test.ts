import { describe, it, expect, vi, afterEach } from 'vitest';
import { useKnowledgeIndex } from '../../../shared/src/stores/knowledgeIndex';
import { knowledgeStatusLabel, documentIndexLabel } from '../../../shared/src/services/knowledgeIndex';
import { KNOWLEDGE_INDEX_VERSION, type KnowledgeEvent, type KnowledgeState, type KnowledgeStatus } from '../../../shared/electron/contracts/knowledge';
const state: KnowledgeState = {
  documents: [],
  tasks: [],
  modelReady: true,
};
afterEach(() => vi.unstubAllGlobals());
describe('索引状态生命周期', () => {
  it('shows only the current index while a completed legacy document is being upgraded', () => {
    const legacy = { indexVersion: 'qa-linked-v2' };
    const ready: KnowledgeStatus = { documentId: 'doc', phase: 'ready', completed: 4, total: 4 };
    expect(documentIndexLabel(legacy, ready)).toBe('尚未索引');
    expect(documentIndexLabel({}, undefined)).toBe('尚未索引');
    expect(documentIndexLabel(legacy, { ...ready, phase: 'parsing', completed: 0, total: 0 })).toBe('索引中 0%');
    expect(documentIndexLabel(legacy, { ...ready, phase: 'embedding', completed: 1 })).toBe('索引中 25%');
    expect(documentIndexLabel(legacy, { ...ready, phase: 'failed' })).toBe('索引失败');
    const current = { ...ready, requestId: 'this-import', indexVersion: KNOWLEDGE_INDEX_VERSION };
    expect(documentIndexLabel(undefined, current)).toBe('尚未索引');
    expect(documentIndexLabel(legacy, current, { requestId: 'other-import' })).toBe('尚未索引');
    expect(documentIndexLabel(undefined, current, { requestId: 'this-import' })).toBe('索引完成');
    expect(documentIndexLabel({ indexVersion: KNOWLEDGE_INDEX_VERSION })).toBe('索引完成');
  });
  it('updates only the affected file rows and keeps the current catalog for other files', async () => {
    let emit!: (event: KnowledgeEvent) => void;
    vi.stubGlobal('window', { desktop: {
      knowledge: async () => ({ ok: true, value: state }),
      onKnowledgeEvent: (listener: typeof emit) => { emit = listener; return () => {}; },
    } });
    const close = useKnowledgeIndex.getState().connect();
    try {
      await useKnowledgeIndex.getState().refresh();
      const tasks = useKnowledgeIndex.getState().tasks;
      const docIds = ['old-a', 'old-b'];
      emit({ type: 'old-index-deletion', active: true, documentIds: docIds });
      const affected = useKnowledgeIndex.getState().deletingDocumentIds;
      expect(affected).toEqual(new Set(docIds));
      expect(useKnowledgeIndex.getState().state).toBe(state);
      const rowLabel = (id: string, version?: string) => documentIndexLabel(
        version ? { indexVersion: version } : undefined, undefined, { deleting: affected?.has(id) });
      expect(docIds.map(id => rowLabel(id, 'qa-linked-v2'))).toEqual(['正在删除旧索引…', '正在删除旧索引…']);
      expect(rowLabel('current', KNOWLEDGE_INDEX_VERSION)).toBe('索引完成');
      expect(rowLabel('new')).toBe('尚未索引');
      expect(useKnowledgeIndex.getState().tasks).toBe(tasks);
      await useKnowledgeIndex.getState().refresh();
      expect(useKnowledgeIndex.getState().deletingDocumentIds).toBe(affected);
      emit({ type: 'old-index-deletion', active: true, documentIds: ['old-c'] });
      expect(useKnowledgeIndex.getState().deletingDocumentIds).toEqual(new Set(['old-c']));
      emit({ type: 'old-index-deletion', active: true, documentIds: [] });
      expect(useKnowledgeIndex.getState().deletingDocumentIds).toEqual(new Set());
      emit({ type: 'old-index-deletion', active: false });
      expect(useKnowledgeIndex.getState().deletingDocumentIds).toBeNull();
      emit({ type: 'old-index-deletion', active: true, documentIds: docIds });
    } finally { close(); }
    expect(useKnowledgeIndex.getState().deletingDocumentIds).toBeNull();
    expect(useKnowledgeIndex.getState().state).toBeNull();
  });
  it('重连时立即回放删除提示，上一轮未返回的状态请求不覆盖当前订阅', async () => {
    let emit!: (event: KnowledgeEvent) => void;
    let deleting = false;
    const pending: Array<(snapshot: KnowledgeState) => void> = [];
    const knowledge = vi.fn(() => {
      if (deleting) emit({ type: 'old-index-deletion', active: true, documentIds: ['old-a', 'old-b'] });
      return new Promise(resolve => pending.push(value => resolve({ ok: true, value })));
    });
    vi.stubGlobal('window', { desktop: {
      knowledge,
      onKnowledgeEvent: (listener: typeof emit) => { emit = listener; return () => {}; },
    } });
    const index = useKnowledgeIndex.getState;
    const close = index().connect();
    const old = index().refresh();
    const oldListener = emit;
    deleting = true;
    emit({ type: 'old-index-deletion', active: true, documentIds: ['old-a'] });
    close();
    const reconnect = index().connect();
    try {
      expect(knowledge).toHaveBeenCalledTimes(2);
      const affected = index().deletingDocumentIds;
      expect(affected).toEqual(new Set(['old-a', 'old-b']));
      expect(index().state).toBeNull();
      const coldRow = (id: string) => documentIndexLabel(undefined, undefined, {
        deleting: affected?.has(id), hasSnapshot: !!index().state,
      });
      expect(coldRow('old-b')).toBe('正在删除旧索引…');
      expect(coldRow('unrelated')).toBeUndefined();
      oldListener({ type: 'old-index-deletion', active: false });
      expect(index().deletingDocumentIds).toBe(affected);
      const current = index().refresh();
      pending[0]({ ...state, modelReady: false });
      await old;
      expect(index().refresh()).toBe(current);
      expect(knowledge).toHaveBeenCalledTimes(2);
      deleting = false;
      emit({ type: 'old-index-deletion', active: false });
      pending[1](state);
      await current;
      expect(index().deletingDocumentIds).toBeNull();
      expect(index().state).toEqual(state);
    } finally { reconnect(); }
  });
  it('关闭提示或切换资料视图后，旧刷新失败不重现，新刷新仍可报错', async () => {
    let fail!: (error: Error) => void;
    const knowledge = vi.fn().mockReturnValueOnce(
      new Promise((_, reject) => {
        fail = reject;
      }),
    );
    vi.stubGlobal('window', { desktop: { knowledge } });
    useKnowledgeIndex.setState({ error: null });
    const old = useKnowledgeIndex.getState().refresh();
    useKnowledgeIndex.getState().dismissError();
    fail(Error('old snapshot failure'));
    await old;
    expect(useKnowledgeIndex.getState().error).toBeNull();
    knowledge.mockResolvedValueOnce({ ok: false, error: '当前刷新失败' });
    await useKnowledgeIndex.getState().refresh();
    expect(useKnowledgeIndex.getState().error).toBe('当前刷新失败');
    useKnowledgeIndex.getState().dismissError();
  });
  it('既有不支持格式的原件不再排入解析，也不产生格式错误提示', async () => {
    const knowledge = vi.fn();
    vi.stubGlobal('window', { desktop: { knowledge } });
    const before = useKnowledgeIndex.getState();
    await useKnowledgeIndex.getState().index({
      id: 'old-ppt',
      baseId: 'base',
      name: 'old.ppt',
      size: 8,
      type: 'application/vnd.ms-powerpoint',
      createdAt: 1,
      blob: {
        arrayBuffer: () => {
          throw Error('Original bytes must not be read');
        },
      } as Blob,
    });
    expect(knowledge).not.toHaveBeenCalled();
    expect(useKnowledgeIndex.getState()).toBe(before);
  });
  it('完成向量计数后显示独立写入阶段，迟到快照不回退完成状态，新任务仍从零开始', async () => {
    let listener!: (status: KnowledgeStatus) => void;
    let snapshot = state;
    const knowledge = vi.fn(async () => ({ ok: true, value: snapshot }));
    vi.stubGlobal('window', {
      desktop: {
        knowledge,
        onKnowledgeEvent: (callback: typeof listener) => {
          listener = callback;
          return () => {};
        },
      },
    });
    useKnowledgeIndex.setState({ state: null, tasks: {}, requests: {}, error: null });
    const close = useKnowledgeIndex.getState().connect();
    const label = () => knowledgeStatusLabel(useKnowledgeIndex.getState().tasks.doc);
    const emit = (
      phase: KnowledgeStatus['phase'],
      completed: number,
      total: number,
      requestId = 'first',
      error?: string,
    ) => {
      const status = { documentId: 'doc', requestId, phase, completed, total, error };
      snapshot = { ...state, tasks: [status] };
      listener(status);
      return label();
    };
    try {
      await useKnowledgeIndex.getState().refresh();
      expect([
        emit('queued', 0, 0),
        emit('parsing', 0, 0),
        emit('embedding', 0, 8),
        emit('embedding', 4, 8),
        emit('embedding', 8, 8),
        emit('indexing', 0, 8),
      ]).toEqual([
        '索引中 0%',
        '索引中 0%',
        '索引中 0%',
        '索引中 50%',
        '索引中 100%',
        '正在写入索引…',
      ]);
      const committing = snapshot;
      let resolve!: (value: { ok: true; value: KnowledgeState }) => void;
      knowledge.mockImplementationOnce(
        () =>
          new Promise((done) => {
            resolve = done;
          }),
      );
      const pending = useKnowledgeIndex.getState().refresh();
      expect(emit('ready', 8, 8)).toBe('索引完成');
      resolve({ ok: true, value: committing });
      await pending;
      expect(label()).toBe('索引完成');
      expect(useKnowledgeIndex.getState().requests.doc).toBeUndefined();
      await useKnowledgeIndex.getState().refresh();
      expect(label()).toBe('索引完成');

      expect(emit('queued', 0, 0, 'second')).toBe('索引中 0%');
      expect(useKnowledgeIndex.getState().requests.doc).toBe('second');
      expect(emit('embedding', 0, 4, 'second')).toBe('索引中 0%');
      expect(emit('failed', 0, 0, 'second', '合成写入失败')).toBe('索引失败');
      await useKnowledgeIndex.getState().refresh();
      expect(useKnowledgeIndex.getState().tasks.doc.error).toBe('合成写入失败');
      expect(useKnowledgeIndex.getState().requests.doc).toBeUndefined();

      expect(emit('queued', 0, 0, 'third')).toBe('索引中 0%');
      expect(emit('cancelled', 0, 0, 'third', '已取消，可重新索引。')).toBe('已取消');
      await useKnowledgeIndex.getState().refresh();
      expect(label()).toBe('已取消');
      expect(useKnowledgeIndex.getState().tasks.doc.error).toBe('已取消，可重新索引。');
      expect(useKnowledgeIndex.getState().requests.doc).toBeUndefined();
    } finally {
      close();
    }
  });

  it('页面消费者共享一次订阅，迟到快照不覆盖更新事件，最后退出才解除订阅', async () => {
    let listener!: (status: KnowledgeStatus) => void, resolve!: (value: unknown) => void;
    const old = new Promise((r) => {
        resolve = r;
      }),
      remove = vi.fn();
    let reads = 0;
    const on = vi.fn((callback) => {
      listener = callback;
      return remove;
    });
    vi.stubGlobal('window', {
      desktop: {
        onKnowledgeEvent: on,
        knowledge: vi.fn(async () =>
          reads++ === 0
            ? old
            : {
                ok: true,
                value: {
                  ...state,
                  tasks: [
                    {
                      documentId: 'doc',
                      requestId: 'request-new',
                      phase: 'embedding',
                      completed: 1,
                      total: 2,
                    },
                  ],
                },
              },
        ),
      },
    });
    useKnowledgeIndex.setState({ state: null, tasks: {}, requests: {}, error: null });
    const a = useKnowledgeIndex.getState().connect();
    await Promise.resolve();
    listener({
      documentId: 'doc',
      requestId: 'request-new',
      phase: 'embedding',
      completed: 1,
      total: 2,
    });
    resolve({ ok: true, value: state });
    await vi.waitFor(() => expect(useKnowledgeIndex.getState().state).toEqual(state));
    await vi.waitFor(() => expect(useKnowledgeIndex.getState().requests.doc).toBe('request-new'));
    const b = useKnowledgeIndex.getState().connect();
    expect(on).toHaveBeenCalledOnce();
    a();
    expect(remove).not.toHaveBeenCalled();
    b();
    b();
    expect(remove).toHaveBeenCalledOnce();
  });
});
