import { describe, it, expect, vi } from 'vitest';
import { temporaryDirectory } from '../temp';
import {
  KnowledgeCoordinator,
  validateKnowledge,
} from '../../../shared/electron/application/knowledge';
import type { KnowledgeCall, OldIndexDeletion } from '../../electron/contracts/knowledge';
import type { KnowledgePort } from '../../../shared/electron/backend/knowledge/types';
describe('知识库一致性快照', () => {
  it('replays the current removal scope to subscribers while status is pending and clears it on completion', async () => {
    const listed = Promise.withResolvers<[]>();
    const emit = vi.fn();
    const coordinator = new KnowledgeCoordinator({ listDocuments: () => listed.promise } as unknown as KnowledgePort, '', emit);
    const first: OldIndexDeletion = { type: 'old-index-deletion', active: true, documentIds: ['first', 'second'] };
    const next: OldIndexDeletion = { type: 'old-index-deletion', active: true, documentIds: ['remaining'] };
    const done = { type: 'old-index-deletion', active: false } as const;
    const opening = coordinator.call({ op: 'status' });
    coordinator.progress(first);
    const reconnect = coordinator.call({ op: 'status' });
    coordinator.progress(next);
    const changed = coordinator.call({ op: 'status' });
    coordinator.progress(done);
    coordinator.progress(done);
    listed.resolve([]);
    await Promise.all([opening, reconnect, changed]);
    await coordinator.call({ op: 'status' });
    expect(emit.mock.calls.flat()).toEqual([first, first, next, next, done]);
  });
  it('bounds the batch manifest and binds every stage and final publish to its original members', async () => {
    const open = { op: 'begin-index-batch', requestId: 'batch', baseId: 'base', documentIds: ['one', 'two'] } as const;
    const finish = { op: 'finish-index-batch', requestId: 'end', batchId: 'batch', commit: true } as const;
    for (const documentIds of [[], ['one'], ['one', 'one'], ['one', '../outside'], Array.from({ length: 21 }, (_, i) => 'd' + i)])
      expect(() => validateKnowledge({ ...open, documentIds })).toThrow();
    expect(() => validateKnowledge({ ...open, baseId: 'personal-resume' })).toThrow();
    expect(() => validateKnowledge({ ...finish, commit: 1 })).toThrow();
    const finishIndexBatch = vi.fn(async () => {});
    const coordinator = new KnowledgeCoordinator({
      beginIndexBatch: async () => {}, finishIndexBatch, indexDocument: async () => ({}),
    } as unknown as KnowledgePort, '', () => {});
    const entry = (id: string): KnowledgeCall => ({ op: 'import', requestId: 'request-' + id, documentId: id,
      baseId: 'base', batchId: 'batch', name: 'test.md', bytes: new Uint8Array(1) });
    await coordinator.call(validateKnowledge(open));
    await expect(coordinator.call(entry('unlisted'))).rejects.toThrow();
    await expect(coordinator.call({ ...entry('one'), baseId: 'other' } as KnowledgeCall)).rejects.toThrow();
    await coordinator.call(entry('one'));
    await expect(coordinator.call(entry('one'))).rejects.toThrow();
    await expect(coordinator.call(finish)).rejects.toThrow();
    expect(finishIndexBatch).not.toHaveBeenCalled();
    await coordinator.call(entry('two'));
    await coordinator.call(finish);
    expect(finishIndexBatch).toHaveBeenCalledExactlyOnceWith('batch', true, expect.any(AbortSignal));
    await expect(coordinator.call(finish)).rejects.toThrow();
    expect(coordinator.busy).toBe(false);
  });
  it('withdraws imports from a deleted library while preserving other libraries and rejecting an unspecified target', async () => {
    const remove = { op: 'remove-base', requestId: 'delete', baseId: 'target' } as const;
    for (const baseId of [undefined, '', '../elsewhere', 'personal-resume'])
      expect(() => validateKnowledge({ ...remove, baseId })).toThrow();
    expect(validateKnowledge(remove)).toEqual(remove);
    const pending = Promise.withResolvers<null>();
    const signals = new Map<string, AbortSignal>();
    const indexDocument = vi.fn(async (input, signal) => {
      signals.set(input.baseId, signal);
      await pending.promise;
      signal.throwIfAborted();
    });
    const removeBase = vi.fn(() => pending.promise);
    const coordinator = new KnowledgeCoordinator({ indexDocument, removeBase, listDocuments: async () => [] } as unknown as KnowledgePort, '', vi.fn());
    const input = (id: string, baseId: string): KnowledgeCall => ({
      op: 'import', requestId: id, documentId: id, baseId, name: 'a.txt', bytes: new Uint8Array([1]),
    });
    const target = coordinator.call(input('one', 'target'));
    const rejected = expect(target).rejects.toMatchObject({ name: 'AbortError' });
    const keep = coordinator.call(input('two', 'keep'));
    const purging = coordinator.call(remove);
    expect(signals.get('target')?.aborted).toBe(true);
    expect(signals.get('keep')?.aborted).toBe(false);
    await expect(coordinator.call(input('late', 'target'))).rejects.toThrow();
    expect(removeBase).toHaveBeenCalledOnce();
    pending.resolve(null);
    await Promise.all([rejected, keep, purging]);
    expect(await coordinator.call({ op: 'status' })).toMatchObject({ tasks: [{ documentId: 'two' }] });
  });
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
