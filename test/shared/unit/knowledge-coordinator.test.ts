import { describe, it, expect, vi } from 'vitest';
import { mkdtemp, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { KnowledgeCoordinator } from '../../../shared/electron/application/knowledge';
import type { KnowledgePort } from '../../../shared/electron/backend/knowledge/types';
describe('知识库一致性快照', () => {
  it('索引状态在列表读取期间改变时，状态快照重新读取文档，避免隐藏新检索结果', async () => {
    await mkdir('test/results', { recursive: true });
    const dir = await mkdtemp(path.resolve('test/results/rag-coordinator-'));
    let resolve!: (value: unknown) => void;
    const old = new Promise((r) => {
      resolve = r;
    });
    const list = vi
      .fn()
      .mockReturnValueOnce(old)
      .mockResolvedValue([{ documentId: 'new-document' }]);
    const coordinator = new KnowledgeCoordinator(
      { listDocuments: list } as unknown as KnowledgePort,
      dir,
      dir,
      vi.fn(),
    );
    const pending = coordinator.call({ op: 'status' });
    await vi.waitFor(() => expect(list).toHaveBeenCalledOnce());
    coordinator.progress({ documentId: 'new-document', phase: 'ready', completed: 1, total: 1 });
    resolve([]);
    expect(await pending).toMatchObject({
      documents: [{ documentId: 'new-document' }],
      tasks: [{ phase: 'ready' }],
    });
    expect(list).toHaveBeenCalledTimes(2);
  });
});
