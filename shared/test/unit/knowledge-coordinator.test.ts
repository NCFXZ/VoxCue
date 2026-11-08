import { describe, it, expect, vi } from 'vitest';
import { temporaryDirectory } from '../temp';
import {
  KnowledgeCoordinator,
  validateKnowledge,
} from '../../../shared/electron/application/knowledge';
import type { KnowledgeCall } from '../../electron/contracts/knowledge';
import type { KnowledgePort } from '../../../shared/electron/backend/knowledge/types';
describe('知识库一致性快照', () => {
  it('只接受可索引文件，后台在最多两个导入后背压，完成后释放容量', async () => {
    const dir = await temporaryDirectory('rag-coordinator');
    const input = (i: number, name = 'a.txt'): Extract<KnowledgeCall, { op: 'import' }> => ({
      op: 'import',
      requestId: `request-${i}`,
      documentId: `document-${i}`,
      baseId: 'base',
      name,
      bytes: new Uint8Array([1]),
    });
    for (const name of ['a.ppt', 'a.pptx', 'a.xls', 'a.xlsx', 'a.exe'])
      expect(() => validateKnowledge(input(0, name))).toThrow(
        '仅支持 PDF、Word、TXT 和 Markdown。',
      );
    for (const name of ['a.pdf', 'a.doc', 'a.docx', 'a.txt', 'a.md', 'a.DOC'])
      expect(validateKnowledge(input(0, name))).toMatchObject({ name });
    const releases: (() => void)[] = [];
    const indexDocument = vi.fn(() => new Promise<void>((resolve) => releases.push(resolve)));
    const coordinator = new KnowledgeCoordinator(
      { indexDocument } as unknown as KnowledgePort,
      dir,
      vi.fn(),
    );
    const first = coordinator.call(input(1));
    const second = coordinator.call(input(2));
    await expect(coordinator.call(input(3))).rejects.toThrow('资料处理中，请稍后重试。');
    expect(indexDocument).toHaveBeenCalledTimes(2);
    releases.shift()!();
    await first;
    const third = coordinator.call(input(3));
    expect(indexDocument).toHaveBeenCalledTimes(3);
    for (const release of releases) release();
    await Promise.all([second, third]);
    expect(coordinator.busy).toBe(false);
  });
  it('索引状态在列表读取期间改变时，状态快照重新读取文档，避免隐藏新检索结果', async () => {
    const dir = await temporaryDirectory('rag-coordinator');
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
      vi.fn(),
    );
    const pending = coordinator.call({ op: 'status' });
    expect(coordinator.busy).toBe(true);
    await vi.waitFor(() => expect(list).toHaveBeenCalledOnce());
    coordinator.progress({ documentId: 'new-document', phase: 'ready', completed: 1, total: 1 });
    resolve([]);
    expect(await pending).toMatchObject({
      documents: [{ documentId: 'new-document' }],
      tasks: [{ phase: 'ready' }],
    });
    expect(list).toHaveBeenCalledTimes(2);
    expect(coordinator.busy).toBe(false);
  });
  it('取消后仍保留导入预算，直到后台任务退休才允许后续导入', async () => {
    const releases: (() => void)[] = [];
    const signals: AbortSignal[] = [];
    const indexDocument = vi.fn((_input, signal: AbortSignal) => {
      signals.push(signal);
      return new Promise<void>((resolve) => releases.push(resolve));
    });
    const coordinator = new KnowledgeCoordinator(
      { indexDocument } as unknown as KnowledgePort,
      '/synthetic/models',
      vi.fn(),
    );
    const bytes = new Uint8Array(20 * 1024 * 1024);
    const input = (i: number): Extract<KnowledgeCall, { op: 'import' }> => ({
      op: 'import',
      requestId: `request-${i}`,
      documentId: `document-${i}`,
      baseId: 'base',
      name: 'a.doc',
      bytes,
    });
    const first = coordinator.call(input(1));
    const cancelled = expect(first).rejects.toMatchObject({ name: 'AbortError' });
    const second = coordinator.call(input(2));
    await coordinator.call({ op: 'cancel', requestId: 'request-1' });
    expect(signals[0].aborted).toBe(true);
    expect(coordinator.indexing).toBe(true);
    await expect(coordinator.call(input(3))).rejects.toThrow('资料处理中，请稍后重试。');
    expect(indexDocument).toHaveBeenCalledTimes(2);
    releases.shift()!();
    await cancelled;
    const third = coordinator.call(input(3));
    expect(indexDocument).toHaveBeenCalledTimes(3);
    for (const release of releases) release();
    await Promise.all([second, third]);
    expect(coordinator.busy).toBe(false);
  });
});
