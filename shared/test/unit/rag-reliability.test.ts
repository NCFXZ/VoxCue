import { describe, it, expect, vi } from 'vitest';
import { Hash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { temporaryDirectory } from '../temp';
import { RagChatService } from '../../electron/application/rag';
import { KnowledgeCoordinator, validateKnowledge } from '../../electron/application/knowledge';
import { retryableChatError } from '../../electron/application/chatRetry';
import { ChatServiceError } from '../../electron/backend/chat/errors';
import { copilotFailure } from '../../electron/backend/copilot/errors';
import { KnowledgeError } from '../../electron/backend/knowledge/errors';
import type { KnowledgePort } from '../../electron/backend/knowledge/types';
import type { AIChatService } from '../../electron/backend/chat/ports';

const request = {
  id: 'one',
  modelId: 'model',
  knowledgeBaseId: 'base',
  webSearch: false,
  instructions: '',
  turns: [{ role: 'user' as const, content: 'PID sensor' }],
};
function fixture() {
  let version = 'a'.repeat(64);
  const item = {
    itemId: 'doc:root',
    documentId: 'doc',
    title: 'PID sensor',
    content: 'PID sensor evidence',
    kind: 'qa' as const,
    followUpIds: [],
    section: '',
    source: {
      name: 'test.md',
      format: 'md',
      updatedAt: 1,
      contentHash: 'hash',
      modelVersion: 'fixed',
      baseId: 'base',
      revision: 'a'.repeat(64),
    },
  };
  const knowledge: KnowledgePort = {
    initialize: vi.fn(),
    indexDocument: vi.fn(),
    updateDocument: vi.fn(),
    invalidateDocument: vi.fn(),
    removeDocument: vi.fn(),
    removeBase: vi.fn(),
    listDocuments: vi.fn(async () => []),
    close: vi.fn(),
    version: vi.fn(async () => version),
    search: vi.fn(async () => [
      {
        itemId: item.itemId,
        documentId: 'doc',
        chunkId: 'chunk',
        baseId: 'base',
        title: item.title,
        excerpt: 'PID sensor',
        name: 'test.md',
        score: 1,
        mode: 'hybrid' as const,
        section: '',
      },
    ]),
    getItem: vi.fn(async () => item),
  };
  const provider: AIChatService = {
    models: vi.fn(),
    usage: vi.fn(),
    resetUsage: vi.fn(),
    stream: vi.fn(async () => ({ usage: null, sources: [], answerText: 'Answer' })),
  };
  const diagnostics = vi.fn();
  const rag = new RagChatService(provider, knowledge, undefined, diagnostics);
  return {
    knowledge,
    provider,
    rag,
    diagnostics,
    setVersion: (v: string) => {
      version = v;
    },
  };
}
const signal = () => new AbortController().signal;
describe('Local RAG reliability', () => {
  it('hashes attachment bytes only for versioned retries, and detects changed bytes', async () => {
    const f = fixture();
    const bytes = new Uint8Array([1, 2]);
    const input = { ...request, turns: [{ ...request.turns[0], files: [{ name: 'sample.png', bytes }] }] };
    const update = vi.spyOn(Hash.prototype, 'update');
    const scope = f.rag.beginRequest();
    try {
      await f.rag.stream(input, vi.fn(), signal());
      expect(update.mock.calls.some(([data]) => data === bytes)).toBe(false);
      await scope.stream(input, vi.fn(), signal());
      expect(update.mock.calls.some(([data]) => data === bytes)).toBe(true);
      await scope.stream(input, vi.fn(), signal());
      expect(f.knowledge.search).toHaveBeenCalledTimes(2);
      bytes[0]++;
      await scope.stream(input, vi.fn(), signal());
      expect(f.knowledge.search).toHaveBeenCalledTimes(3);
    } finally {
      update.mockRestore();
      scope.dispose();
    }
  });
  it.each([undefined, null])(
    'missing base %s skips every knowledge and model access',
    async (base) => {
      const f = fixture(),
        requireModel = vi.fn();
      await new RagChatService(f.provider, f.knowledge, requireModel).stream(
        { ...request, knowledgeBaseId: base },
        vi.fn(),
        signal(),
      );
      for (const fn of [f.knowledge.search, f.knowledge.getItem, f.knowledge.version, requireModel])
        expect(fn).not.toHaveBeenCalled();
      expect(f.provider.stream).toHaveBeenCalledOnce();
    },
  );
  it('reuses complete evidence only inside the request scope; disposal/new scope clears it', async () => {
    const f = fixture(),
      scope = f.rag.beginRequest();
    vi.mocked(f.provider.stream).mockRejectedValueOnce(
      new ChatServiceError({ status: 503, message: 'temporary' }),
    );
    await expect(scope.stream(request, vi.fn(), signal())).rejects.toBeInstanceOf(ChatServiceError);
    await scope.stream(request, vi.fn(), signal());
    expect(f.knowledge.search).toHaveBeenCalledOnce();
    expect(f.knowledge.getItem).toHaveBeenCalledOnce();
    expect(f.diagnostics.mock.calls[1][0].reused).toBe(true);
    scope.dispose();
    await expect(scope.stream(request, vi.fn(), signal())).rejects.toMatchObject({
      name: 'AbortError',
    });
    await f.rag.beginRequest().stream(request, vi.fn(), signal());
    expect(f.knowledge.search).toHaveBeenCalledTimes(2);
  });
  it('changed version, request identity or model cannot reuse evidence', async () => {
    const f = fixture(),
      scope = f.rag.beginRequest();
    await scope.stream(request, vi.fn(), signal());
    f.setVersion('b'.repeat(64));
    await scope.stream(request, vi.fn(), signal());
    await scope.stream({ ...request, id: 'two' }, vi.fn(), signal());
    await scope.stream({ ...request, id: 'two', modelId: 'another' }, vi.fn(), signal());
    expect(f.knowledge.search).toHaveBeenCalledTimes(4);
    scope.dispose();
  });
  it('partial/unavailable evidence never enters reuse; integrity errors remain fatal', async () => {
    const f = fixture(),
      scope = f.rag.beginRequest();
    vi.mocked(f.knowledge.getItem).mockResolvedValue(null);
    await scope.stream(request, vi.fn(), signal());
    await scope.stream(request, vi.fn(), signal());
    expect(f.knowledge.search).toHaveBeenCalledTimes(2);
    vi.mocked(f.knowledge.version!).mockRejectedValueOnce(
      new KnowledgeError('integrity', 'synthetic'),
    );
    await expect(scope.stream(request, vi.fn(), signal())).rejects.toMatchObject({
      code: 'integrity',
    });
    scope.dispose();
  });
  it('diagnostics contain controlled identities only and classify actual evidence', async () => {
    const f = fixture();
    await f.rag.stream(request, vi.fn(), signal());
    const trace = f.diagnostics.mock.calls[0][0];
    expect(trace).toMatchObject({
      state: 'complete',
      decisions: [{ itemId: 'doc:root', reason: 'used_as_evidence' }],
    });
    expect(JSON.stringify(trace)).not.toMatch(/PID|sensor evidence|test\.md/);
  });
  it.each(['{"mode":"function"}', '{broken', null])(
    'old settings are ignored without rewriting: %s',
    async (content) => {
      const dir = await temporaryDirectory('rag-legacy'),
        file = path.join(dir, 'settings.json');
      if (content === null) await mkdir(file);
      else await writeFile(file, content);
      const f = fixture(),
        coordinator = new KnowledgeCoordinator(f.knowledge, dir, vi.fn());
      await expect(coordinator.call({ op: 'status' })).resolves.toMatchObject({ documents: [] });
      expect(() => validateKnowledge({ op: 'settings', mode: 'function' })).toThrow('未知');
      if (content !== null) expect(await readFile(file, 'utf8')).toBe(content);
    },
  );
  it('main/service gate stops new indexing during interview and rejects KB startup while queued', async () => {
    const dir = await temporaryDirectory('rag-gate'),
      f = fixture();
    let live = true;
    const coordinator = new KnowledgeCoordinator(f.knowledge, dir, vi.fn(), () => live);
    const call = {
      op: 'import' as const,
      requestId: 'index',
      documentId: 'doc',
      baseId: 'base',
      name: 'a.md',
      bytes: new Uint8Array([1]),
    };
    await expect(coordinator.call(call)).rejects.toThrow('面试中无法索引，请结束后重试。');
    expect(f.knowledge.indexDocument).not.toHaveBeenCalled();
    live = false;
    let finish!: () => void;
    vi.mocked(f.knowledge.indexDocument).mockImplementation(
      () =>
        new Promise((r) => {
          finish = () => r({} as never);
        }),
    );
    const pending = coordinator.call(call);
    await expect(coordinator.assertInterviewReady('base')).rejects.toThrow('索引');
    vi.mocked(f.knowledge.listDocuments).mockResolvedValue([{ baseId: 'base', available: true } as never]);
    await expect(coordinator.assertInterviewReady('base')).resolves.toBeUndefined();
    await expect(coordinator.assertInterviewReady(null)).resolves.toBeUndefined();
    finish();
    await pending;
    await expect(coordinator.assertInterviewReady('base')).resolves.toBeUndefined();
  });
});
describe('bounded classified generation retries', () => {
  it.each([400, 401, 403, 404, 408, 409, 429, 500, 501])('does not retry HTTP %s', (status) =>
    expect(
      retryableChatError(new ChatServiceError({ status, message: '503 network temporary' })),
    ).toBe(false),
  );
  it.each([502, 503, 504])('retries explicitly transient HTTP %s', (status) =>
    expect(retryableChatError(new ChatServiceError({ status, message: 'safe' }))).toBe(true),
  );
  it.each([
    'network_error',
    'response_idle_timeout',
    'response_headers_timeout',
    'connection_closed',
    'empty_response',
  ])('retries controlled %s', (code) =>
    expect(retryableChatError(new ChatServiceError({ code, message: 'safe' }))).toBe(true),
  );
  it('unknown errors, aborts, local integrity and quotas never retry based on text', () => {
    for (const error of [
      Error('503 network'),
      new DOMException('timeout', 'AbortError'),
      new KnowledgeError('integrity', 'network'),
      new ChatServiceError({ code: 'quota_exceeded', status: 503, message: 'safe' }),
    ])
      expect(retryableChatError(error)).toBe(false);
    expect(retryableChatError(copilotFailure({ errorType: 'quota', statusCode: 503 }))).toBe(false);
    expect(retryableChatError(copilotFailure({ errorType: 'service', statusCode: 503 }))).toBe(
      true,
    );
    expect(
      copilotFailure({ errorType: 'authentication', providerCallId: 'secret raw text' }).detail,
    ).toMatchObject({ status: 401, requestId: undefined });
  });
});
