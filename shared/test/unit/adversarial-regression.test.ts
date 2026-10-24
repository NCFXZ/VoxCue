import 'fake-indexeddb/auto';
import { it, expect, vi } from 'vitest';
import { createServer } from 'node:http';
import { localChats } from '../../../shared/src/services/chats';
import { usePreparation } from '../../../shared/src/stores/preparation';
import { createHistoryService } from '../../../shared/src/services/history';
import { readErrorResponse } from '../../../shared/electron/backend/chat/responses';
import { ChatGPTService } from '../../../shared/electron/backend/chat/service';
import { registerChatIpc } from '../../../shared/electron/ipc/chat';
const bridge = vi.hoisted(() => ({ handlers: new Map<string, Function>() }));
vi.mock('electron', () => ({
  ipcMain: { handle: (key: string, fn: Function) => bridge.handlers.set(key, fn) },
}));
const request = {
  id: 'regression',
  modelId: 'test',
  instructions: '',
  webSearch: false,
  turns: [{ role: 'user' as const, content: 'Synthetic question' }],
};

it('HTTP 502 的半截错误正文也触发空闲超时，释放本机连接', async () => {
  let requests = 0;
  const server = createServer((_q, r) => {
    requests++;
    r.writeHead(502, { 'content-type': 'application/json' });
    r.write('{"error":');
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const address = server.address() as { port: number };
  const controller = new AbortController();
  const service = new ChatGPTService({
    access: async () => ({ token: 'synthetic-not-a-credential', account: 'test' }),
    ledger: {} as any,
    idleTimeoutMs: 25,
    responseHeadersTimeoutMs: 1000,
    fetch: async (url, init) =>
      String(url).endsWith('/models')
        ? Response.json({ models: [{ slug: 'test', display_name: 'Test', visibility: 'list' }] })
        : fetch('http://127.0.0.1:' + address.port, init),
  });
  try {
    await expect(service.stream(request, () => {}, controller.signal)).rejects.toMatchObject({
      detail: { code: 'response_idle_timeout' },
    });
    expect(requests).toBe(1);
  } finally {
    controller.abort();
    server.closeAllConnections();
    server.close();
  }
});
it('错误正文限制 64 KiB；手动取消与无效 JSON 均完成清理', async () => {
  await expect(
    readErrorResponse(new Response('x'.repeat(65537)), new AbortController().signal),
  ).rejects.toThrow('过大');
  expect(
    await readErrorResponse(
      new Response('<html>private body</html>'),
      new AbortController().signal,
    ),
  ).toBeNull();
  let canceled = false;
  const body = new Response(
    new ReadableStream({
      start(c) {
        c.enqueue(new TextEncoder().encode('{'));
      },
      cancel() {
        canceled = true;
      },
    }),
  );
  const controller = new AbortController();
  const pending = readErrorResponse(body, controller.signal);
  controller.abort();
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  expect(canceled).toBe(true);
});
it('聊天路由拒绝合法窗口的子 frame 与缺失 frame', async () => {
  const sender = { mainFrame: {}, isDestroyed: () => false, send: vi.fn() };
  const models = vi.fn(async () => []),
    openLink = vi.fn(async () => {});
  registerChatIpc({
    chat: { models } as any,
    requireMain: (e) => {
      if (e.sender !== sender) throw Error('Unauthorized window');
    },
    isDemo: () => false,
    openLink,
  });
  for (const channel of [
    'chat:models',
    'chat:usage',
    'chat:account-usage',

    'chat:usage-reset',
    'chat:send',
    'chat:cancel',
    'chat:open-link',
  ]) {
    for (const senderFrame of [{}, undefined])
      await expect(
        Promise.resolve().then(() =>
          bridge.handlers.get(channel)!({ sender, senderFrame }, request),
        ),
      ).rejects.toThrow('Unauthorized frame');
  }
  expect(models).not.toHaveBeenCalled();
  expect(openLink).not.toHaveBeenCalled();
  expect(
    await bridge.handlers.get('chat:models')!({ sender, senderFrame: sender.mainFrame }, false),
  ).toEqual({ ok: true, models: [] });
});
it('重载取消立即释放聊天槽；忽略取消的旧服务迟到结果不能成功或干扰新请求', async () => {
  const sender = { mainFrame: {}, isDestroyed: () => false, send: vi.fn() };
  const event = { sender, senderFrame: sender.mainFrame };
  let finish!: (result: any) => void, late!: (event: any) => void;
  const stream = vi
    .fn()
    .mockImplementationOnce(async (_r, emit) => {
      late = emit;
      return new Promise((resolve) => {
        finish = resolve;
      });
    })
    .mockResolvedValueOnce({ answerText: 'new', sources: [], usage: null });
  const lifecycle = registerChatIpc({
    chat: { stream } as any,
    requireMain: () => {},
    isDemo: () => false,
    openLink: async () => {},
  });
  const old = bridge.handlers.get('chat:send')!(event, request);
  lifecycle.cancelActive();
  expect(await bridge.handlers.get('chat:send')!(event, { ...request, id: 'new' })).toMatchObject({
    ok: true,
    answerText: 'new',
  });
  late({ id: request.id, type: 'delta', text: 'forbidden' });
  finish({ answerText: 'old', sources: [], usage: null });
  expect(await old).toMatchObject({ ok: false, error: { code: 'cancelled' } });
  expect(sender.send).not.toHaveBeenCalled();
});
it.each([
  { answers: [null] },
  { transcripts: [null] },
  { answers: [{ id: 'a', question: {}, content: 'text' }] },
])('损坏历史内层数据拒绝加载与改写：%j', (patch) => {
  const raw = JSON.stringify([
    {
      id: 'broken',
      title: 'Synthetic record',
      startedAt: 1,
      endedAt: 2,
      status: 'ended',
      mock: false,
      transcripts: [],
      answers: [],
      ...patch,
    },
  ]);
  const setItem = vi.fn();
  const service = createHistoryService({ getItem: () => raw, setItem });
  expect(() => service.list()).toThrow('读取');
  expect(() => service.remove('other')).toThrow('读取');
  expect(setItem).not.toHaveBeenCalled();
});
it('异常持久化顶层字段不能覆盖 Store 动作或运行状态，未知原数据不在读取时改写', async () => {
  await localChats.write({
    conversations: [],
    activeConversation: null,
    draft: '',
    attachments: [],
    modelId: 'test',
    effort: 'low',
    webSearch: false,
  });
  const db = await new Promise<IDBDatabase>((resolve) => {
    const q = indexedDB.open('voxcue-preparation-chats', 1);
    q.onsuccess = () => resolve(q.result);
  });
  const tx = db.transaction('state', 'readwrite');
  const saved = {
    version: 1,
    conversations: [],
    activeConversation: null,
    draft: '',
    attachments: [],
    modelId: 'test',
    effort: 'low',
    webSearch: false,
    send: 'corrupted-string',
    streaming: true,
  };
  tx.objectStore('state').put(saved, 'current');
  await new Promise<void>((resolve) => (tx.oncomplete = () => resolve()));
  expect(await localChats.read()).not.toHaveProperty('send');
  usePreparation.setState({ chatsReady: false });
  await usePreparation.getState().restoreChats();
  expect(typeof usePreparation.getState().send).toBe('function');
  expect(usePreparation.getState().streaming).toBe(false);
  const read = db.transaction('state').objectStore('state').get('current');
  await new Promise<void>((resolve) => (read.onsuccess = () => resolve()));
  expect(read.result).toEqual(saved);
  db.close();
});
