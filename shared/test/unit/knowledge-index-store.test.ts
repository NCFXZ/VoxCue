import { describe, it, expect, vi, afterEach } from 'vitest';
import { useKnowledgeIndex } from '../../../shared/src/stores/knowledgeIndex';
import type { KnowledgeState, KnowledgeStatus } from '../../../shared/electron/contracts/knowledge';
const state: KnowledgeState = {
  documents: [],
  tasks: [],
  mode: 'local',
  modelReady: true,
  functionCalling: { supported: null, reason: 'test' },
};
afterEach(() => vi.unstubAllGlobals());
describe('索引状态生命周期', () => {
  it('页面/设置共享一次订阅，迟到快照不覆盖更新事件，最后退出才解除订阅', async () => {
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
  it('新的检索完成后，旧请求迟到结果不会替换它', async () => {
    let resolve!: (value: unknown) => void;
    const old = new Promise((r) => {
      resolve = r;
    });
    vi.stubGlobal('window', {
      desktop: {
        knowledge: vi.fn(async (call) =>
          call.query === 'old' ? old : { ok: true, value: [{ itemId: 'new' }] },
        ),
      },
    });
    const first = useKnowledgeIndex.getState().search('old', 'base');
    await useKnowledgeIndex.getState().search('new', 'base');
    resolve({ ok: true, value: [{ itemId: 'old' }] });
    await first;
    expect(useKnowledgeIndex.getState().hits.map((hit) => hit.itemId)).toEqual(['new']);
  });
});
