import { describe, it, expect, vi, afterEach } from 'vitest';
import { useKnowledgeIndex } from '../../../shared/src/stores/knowledgeIndex';
import { knowledgeStatusLabel } from '../../../shared/src/services/knowledgeIndex';
import type { KnowledgeState, KnowledgeStatus } from '../../../shared/electron/contracts/knowledge';
const state: KnowledgeState = {
  documents: [],
  tasks: [],
  modelReady: true,
};
afterEach(() => vi.unstubAllGlobals());
describe('索引状态生命周期', () => {
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
