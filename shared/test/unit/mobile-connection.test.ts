import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type {
  RemoteClientMessage,
  RemoteInterviewSnapshot,
} from '../../electron/contracts/remoteConnection';
import { createMobileConnection, type MobileConnection } from '../../src/mobile/connection';

const pairToken = 'p'.repeat(43),
  pendingId = 'i'.repeat(43),
  resumeToken = 'r'.repeat(43);
const storage = new Map<string, string>();
const controllers: MobileConnection[] = [];
const fetchPair = vi.fn();
const location = { origin: 'http://192.168.1.20:32100', pathname: '/', search: '', hash: '' };
let browser: EventTarget & Record<string, any>;
let autoDraftAck = true;
class Socket {
  static all: Socket[] = [];
  readyState = 0;
  sent: RemoteClientMessage[] = [];
  onopen: ((event?: unknown) => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(readonly url: string) {
    Socket.all.push(this);
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  send(value: string) {
    if (this.readyState !== 1) throw Error('Socket closed');
    this.sent.push(JSON.parse(value));
    const message = this.sent.at(-1)!;
    if (autoDraftAck && message.type === 'command' && message.command.action === 'set-draft') {
      const command = message.command;
      void Promise.resolve().then(() =>
        this.receive({
          type: 'result',
          result: {
            requestId: command.requestId,
            ok: true,
            inputDraftRevision: command.expectedRevision + 1,
          },
        }),
      );
    }
  }
  receive(value: unknown) {
    this.onmessage?.({ data: JSON.stringify(value) });
  }
  close() {
    this.readyState = 3;
    this.onclose?.();
  }
}
const snapshot = (patch: Partial<RemoteInterviewSnapshot> = {}): RemoteInterviewSnapshot => ({
  sessionId: 'session-A',
  sessionEpoch: 1,
  revision: 1,
  status: 'running',
  inputMode: 'remote',
  transcripts: [],
  answers: [],
  pendingQuestion: 'Current transcription',
  pendingQuestionRevision: 2,
  inputDraft: { text: '', revision: 1, manual: false },
  omitted: { transcripts: 0, answers: 0 },
  generating: false,
  aiEnabled: true,
  microphoneMuted: false,
  microphoneToggling: false,
  micRevision: 3,
  autoAnswer: false,
  autoAnswerRevision: 4,
  capabilities: { sendQuestion: true, setMicrophone: true, setAutoAnswer: true, stopAnswer: true },
  ...patch,
});
const create = () => {
  const controller = createMobileConnection();
  controllers.push(controller);
  return controller;
};
const latest = () => Socket.all.at(-1)!;
const paired = (socket: Socket, value: RemoteInterviewSnapshot | null = snapshot(), sequence = 1) =>
  socket.receive({
    type: 'paired',
    protocolVersion: 1,
    token: resumeToken,
    sequence,
    snapshot: value,
  });
async function connect(value: RemoteInterviewSnapshot | null = snapshot()) {
  const controller = create();
  await controller.start();
  const socket = latest();
  socket.open();
  socket.receive({ type: 'pending', id: pendingId, code: '123456' });
  paired(socket, value);
  return { controller, socket };
}
beforeEach(() => {
  vi.useFakeTimers();
  storage.clear();
  Socket.all = [];
  controllers.length = 0;
  autoDraftAck = true;
  location.origin = 'http://192.168.1.20:32100';
  location.hash = '#pair=' + pairToken;
  fetchPair.mockReset();
  fetchPair.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({
      protocolVersion: 1,
      id: pendingId,
      code: '123456',
      expiresAt: Date.now() + 120_000,
    }),
  });
  browser = Object.assign(new EventTarget(), {
    location,
    history: {
      replaceState: vi.fn(() => {
        location.hash = '';
      }),
    },
    navigator: { userAgent: 'Synthetic Android', onLine: true },
    document: Object.assign(new EventTarget(), { visibilityState: 'visible' }),
    sessionStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    },
    crypto: globalThis.crypto,
    fetch: fetchPair,
    WebSocket: Socket,
  });
  vi.stubGlobal('window', browser);
});
afterEach(() => {
  controllers.forEach((controller) => controller.dispose());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('removes the pairing fragment before networking and uses only the current private origin', async () => {
  location.hash += '&endpoint=https%3A%2F%2Fexample.invalid';
  const controller = create();
  expect(location.hash).toBe('');
  expect(fetchPair).not.toHaveBeenCalled();
  expect(controller.getState().hasPairingLink).toBe(true);
  await controller.start();
  expect(fetchPair).toHaveBeenCalledOnce();
  expect(fetchPair.mock.calls[0][0]).toBe(location.origin + '/pair');
  expect(JSON.parse(fetchPair.mock.calls[0][1].body)).toEqual({
    token: pairToken,
    name: 'Android',
  });
  expect(latest().url).toBe('ws://192.168.1.20:32100/connect');
  latest().open();
  latest().receive({ type: 'pending', id: pendingId, code: '123456' });
  expect(controller.getState().status).toBe('approval');
  paired(latest(), null);
  expect(controller.getState().status).toBe('waiting');
  expect([...storage.values()].join('')).not.toContain(pairToken);
});

it('ACKs clear only the exact draft revision that was sent, including edit-away-and-back', async () => {
  const { controller, socket } = await connect();
  controller.setDraft('Original question');
  const request = controller.sendQuestion();
  await vi.advanceTimersByTimeAsync(0);
  const sent = socket.sent.find(
    (entry) => entry.type === 'command' && entry.command.action !== 'set-draft',
  )!;
  expect(sent.type).toBe('command');
  if (sent.type !== 'command') throw Error('Missing command');
  controller.setDraft('Edited question');
  controller.setDraft('Original question');
  socket.receive({
    type: 'result',
    result: { requestId: sent.command.requestId, ok: true, answerId: 'answer-1' },
  });
  await request;
  expect(controller.getState().draft).toBe('Original question');
  expect(controller.getState().pending).toBe(false);
});

it('discards offline edits when the PC snapshot resumes without replaying a command', async () => {
  const { controller, socket } = await connect();
  socket.close();
  controller.setDraft('Offline draft');
  await controller.sendQuestion();
  expect(
    socket.sent.filter((entry) => entry.type === 'command' && entry.command.action !== 'set-draft'),
  ).toHaveLength(0);
  await vi.advanceTimersByTimeAsync(1000);
  const restored = latest();
  restored.open();
  expect(restored.sent[0]).toEqual({ type: 'resume', protocolVersion: 1, token: resumeToken });
  paired(restored, snapshot({ revision: 2 }), 2);
  expect(
    restored.sent.filter(
      (entry) => entry.type === 'command' && entry.command.action !== 'set-draft',
    ),
  ).toHaveLength(0);
  expect(controller.getState().draft).toBe('');
  expect(controller.getState().status).toBe('ready');
});

it('queries the original request after ACK timeout and treats unknown results without retransmission', async () => {
  const { controller, socket } = await connect();
  controller.setDraft('Keep if unknown');
  const request = controller.sendQuestion();
  await vi.advanceTimersByTimeAsync(0);
  const sent = socket.sent.find(
    (entry) => entry.type === 'command' && entry.command.action !== 'set-draft',
  )!;
  if (sent.type !== 'command') throw Error('Missing command');
  await vi.advanceTimersByTimeAsync(5000);
  expect(socket.sent.at(-1)).toEqual({ type: 'query-result', requestId: sent.command.requestId });
  expect(
    socket.sent.filter((entry) => entry.type === 'command' && entry.command.action !== 'set-draft'),
  ).toHaveLength(1);
  socket.receive({
    type: 'result',
    result: { requestId: sent.command.requestId, ok: false, error: 'request-unknown' },
  });
  await request;
  expect(controller.getState().errorCode).toBe('command-result-unknown');
  expect(controller.getState().draft).toBe('Keep if unknown');
  await vi.advanceTimersByTimeAsync(30_000);
  expect(
    socket.sent.filter((entry) => entry.type === 'command' && entry.command.action !== 'set-draft'),
  ).toHaveLength(1);
});

it('resumes with a fresh snapshot and resolves the previous request before unlocking controls', async () => {
  const { controller, socket } = await connect();
  controller.setDraft('One request');
  const request = controller.sendQuestion();
  await vi.advanceTimersByTimeAsync(0);
  const sent = socket.sent.find(
    (entry) => entry.type === 'command' && entry.command.action !== 'set-draft',
  )!;
  if (sent.type !== 'command') throw Error('Missing command');
  const staleReceive = socket.onmessage!;
  socket.close();
  await vi.advanceTimersByTimeAsync(1000);
  const restored = latest();
  restored.open();
  paired(restored, snapshot({ revision: 3 }), 3);
  expect(controller.getState().status).toBe('syncing');
  expect(restored.sent.at(-1)).toEqual({ type: 'query-result', requestId: sent.command.requestId });
  staleReceive({
    data: JSON.stringify({
      type: 'snapshot',
      sequence: 100,
      snapshot: snapshot({ revision: 100, microphoneMuted: true }),
    }),
  });
  expect(controller.getState().snapshot?.microphoneMuted).toBe(false);
  restored.receive({ type: 'result', result: { requestId: sent.command.requestId, ok: true } });
  await request;
  expect(controller.getState().status).toBe('ready');
  expect(controller.getState().draft).toBe('');
  expect(
    restored.sent.filter(
      (entry) => entry.type === 'command' && entry.command.action !== 'set-draft',
    ),
  ).toHaveLength(0);
});

it('restores approval from sessionStorage without issuing the one-use POST again', async () => {
  const first = create();
  await first.start();
  latest().open();
  latest().receive({ type: 'pending', id: pendingId, code: '123456' });
  first.dispose();
  const refreshed = create();
  expect(refreshed.getState().canResume).toBe(true);
  await refreshed.start();
  latest().open();
  expect(latest().sent[0]).toEqual({ type: 'authenticate', protocolVersion: 1, pendingId });
  expect(fetchPair).toHaveBeenCalledOnce();
  latest().receive({ type: 'pending', id: pendingId, code: '123456' });
  await vi.advanceTimersByTimeAsync(120_001);
  expect(refreshed.getState().errorCode).toBe('pairing-expired');
  expect(storage.size).toBe(0);
  const count = Socket.all.length;
  browser.dispatchEvent(new Event('online'));
  await vi.advanceTimersByTimeAsync(20_000);
  expect(Socket.all).toHaveLength(count);
});

it('restores only request metadata after refresh and queries it instead of resending a command body', async () => {
  const { controller, socket } = await connect();
  controller.setDraft('Sensitive synthetic question');
  const request = controller.sendQuestion();
  await vi.advanceTimersByTimeAsync(0);
  const sent = socket.sent.find(
    (entry) => entry.type === 'command' && entry.command.action !== 'set-draft',
  )!;
  if (sent.type !== 'command') throw Error('Missing command');
  expect([...storage.values()].join('')).not.toContain('Sensitive synthetic question');
  controller.dispose();
  await request;
  const refreshed = create();
  await refreshed.start();
  latest().open();
  paired(latest());
  expect(refreshed.getState().status).toBe('syncing');
  expect(latest().sent.at(-1)).toEqual({ type: 'query-result', requestId: sent.command.requestId });
  expect(
    latest().sent.filter(
      (entry) => entry.type === 'command' && entry.command.action !== 'set-draft',
    ),
  ).toHaveLength(0);
  latest().receive({ type: 'result', result: { requestId: sent.command.requestId, ok: true } });
  expect(refreshed.getState().status).toBe('ready');
  expect(fetchPair).toHaveBeenCalledOnce();
});

it('ignores stale sequences and automatically takes the new session PC draft', async () => {
  const { controller, socket } = await connect(snapshot({ revision: 3 }));
  controller.setDraft('Old local input');
  socket.receive({
    type: 'snapshot',
    sequence: 0,
    snapshot: snapshot({ revision: 2, microphoneMuted: true }),
  });
  expect(controller.getState().snapshot?.microphoneMuted).toBe(false);
  socket.receive({
    type: 'snapshot',
    sequence: 2,
    snapshot: snapshot({
      sessionId: 'session-B',
      sessionEpoch: 2,
      inputDraft: { text: 'New PC input', revision: 0, manual: true },
    }),
  });
  expect(controller.getState()).toMatchObject({ draft: 'New PC input', draftDirty: false });
  await vi.advanceTimersByTimeAsync(1000);
  expect(socket.sent.filter((e) => e.type === 'command')).toHaveLength(0);
});

it('uses absolute field CAS and answer ownership without optimistic desktop state changes', async () => {
  const { controller, socket } = await connect(
    snapshot({ answers: [{ id: 'answer-9', question: 'Q', content: 'A', status: 'streaming' }] }),
  );
  const request = controller.setMicrophoneMuted(true);
  const sent = socket.sent.at(-1)!;
  if (sent.type !== 'command') throw Error('Missing command');
  expect(sent.command).toMatchObject({
    action: 'set-microphone',
    muted: true,
    expectedRevision: 3,
  });
  expect(controller.getState().snapshot?.microphoneMuted).toBe(false);
  socket.receive({ type: 'result', result: { requestId: sent.command.requestId, ok: true } });
  await request;
  const stop = controller.stopAnswer();
  const stopped = socket.sent.at(-1)!;
  if (stopped.type !== 'command') throw Error('Missing stop');
  expect(stopped.command).toMatchObject({ action: 'stop-answer', answerId: 'answer-9' });
  socket.receive({ type: 'result', result: { requestId: stopped.command.requestId, ok: true } });
  await stop;
});

it('does not resend a pairing POST after a lost response and clears rejected resume tickets', async () => {
  fetchPair.mockRejectedValueOnce(Error('Synthetic lost response'));
  const controller = create();
  await controller.start();
  expect(controller.getState().errorCode).toBe('pairing-failed');
  browser.dispatchEvent(new Event('online'));
  await vi.advanceTimersByTimeAsync(60_000);
  expect(fetchPair).toHaveBeenCalledOnce();
  expect(Socket.all).toHaveLength(0);
  location.hash = '#pair=' + pairToken;
  const active = await connect();
  active.socket.close();
  await vi.advanceTimersByTimeAsync(1000);
  latest().open();
  latest().receive({ type: 'error', error: '连接认证失败。' });
  expect(active.controller.getState().errorCode).toBe('authentication-failed');
  expect(storage.size).toBe(0);
});

it('disconnects only the phone authorization, clears its ticket and stops reconnection', async () => {
  const { controller, socket } = await connect();
  const close = controller.disconnect();
  expect(socket.sent.at(-1)).toEqual({ type: 'disconnect' });
  socket.receive({ type: 'disconnected' });
  await close;
  expect(controller.getState().status).toBe('disconnected');
  expect(controller.getState().snapshot).toBeNull();
  expect(storage.size).toBe(0);
  const count = Socket.all.length;
  await vi.advanceTimersByTimeAsync(120_000);
  browser.dispatchEvent(new Event('online'));
  expect(Socket.all).toHaveLength(count);
  expect(
    socket.sent.filter((entry) => entry.type === 'command' && entry.command.action !== 'set-draft'),
  ).toHaveLength(0);
});

it('lets a new QR replace stored authorization and refuses public addresses', async () => {
  const { controller } = await connect();
  controller.dispose();
  location.hash = '#pair=' + 'n'.repeat(43);
  const next = create();
  expect(next.getState().hasPairingLink).toBe(true);
  expect(next.getState().canResume).toBe(false);
  expect(storage.size).toBe(0);
  location.origin = 'http://203.0.113.1:32100';
  location.hash = '#pair=' + pairToken;
  const invalid = create();
  const calls = fetchPair.mock.calls.length;
  await invalid.start();
  expect(invalid.getState().errorCode).toBe('invalid-address');
  expect(fetchPair).toHaveBeenCalledTimes(calls);
});

it('takes a replacement QR during same-tab hash navigation without reusing old authorization', async () => {
  const { controller, socket } = await connect();
  controller.setDraft('Keep the local edit');
  const request = controller.sendQuestion();
  await vi.advanceTimersByTimeAsync(0);
  location.hash = '#pair=' + 'n'.repeat(43);
  browser.dispatchEvent(new Event('hashchange'));
  await request;
  expect(location.hash).toBe('');
  expect(controller.getState()).toMatchObject({
    status: 'idle',
    connected: false,
    hasPairingLink: true,
    canResume: false,
    pending: false,
    snapshot: null,
    draft: '',
  });
  expect(storage.size).toBe(0);
  expect(socket.readyState).toBe(3);
  await controller.start();
  expect(fetchPair).toHaveBeenCalledTimes(2);
  expect(JSON.parse(fetchPair.mock.calls[1][1].body).token).toBe('n'.repeat(43));
});

it('confirms foreground liveness with a read-only same-sequence snapshot before returning ready', async () => {
  const { controller, socket } = await connect();
  browser.document.dispatchEvent(new Event('visibilitychange'));
  expect(controller.getState().status).toBe('syncing');
  expect(socket.sent.at(-1)).toEqual({ type: 'sync' });
  socket.receive({ type: 'snapshot', sequence: 0, snapshot: snapshot() });
  expect(controller.getState().status).toBe('syncing');
  socket.receive({ type: 'snapshot', sequence: 1, snapshot: snapshot() });
  expect(controller.getState().status).toBe('ready');
  await vi.advanceTimersByTimeAsync(8001);
  expect(controller.getState().connected).toBe(true);
  expect(
    socket.sent.filter((entry) => entry.type === 'command' && entry.command.action !== 'set-draft'),
  ).toHaveLength(0);
});

it('does not let a command ACK unlock a foreground sync that has not received its snapshot', async () => {
  const { controller, socket } = await connect();
  controller.setDraft('Foreground command');
  const request = controller.sendQuestion();
  await vi.advanceTimersByTimeAsync(0);
  const sent = socket.sent.find(
    (entry) => entry.type === 'command' && entry.command.action !== 'set-draft',
  )!;
  if (sent.type !== 'command') throw Error('Missing command');
  browser.document.dispatchEvent(new Event('visibilitychange'));
  socket.receive({ type: 'result', result: { requestId: sent.command.requestId, ok: true } });
  await request;
  expect(controller.getState().status).toBe('syncing');
  socket.receive({ type: 'snapshot', sequence: 1, snapshot: snapshot() });
  expect(controller.getState().status).toBe('ready');
});

it('recovers a stale foreground socket after the sync deadline without replaying actions', async () => {
  const { controller, socket } = await connect();
  browser.document.dispatchEvent(new Event('visibilitychange'));
  await vi.advanceTimersByTimeAsync(8000);
  expect(controller.getState().status).toBe('reconnecting');
  expect(socket.readyState).toBe(3);
  await vi.advanceTimersByTimeAsync(1000);
  latest().open();
  expect(latest().sent[0]).toEqual({ type: 'resume', protocolVersion: 1, token: resumeToken });
  expect(
    latest().sent.filter(
      (entry) => entry.type === 'command' && entry.command.action !== 'set-draft',
    ),
  ).toHaveLength(0);
});

it('backs off failed sockets and wakes immediately when network connectivity returns', async () => {
  const { socket } = await connect();
  socket.close();
  for (const delay of [1000, 2000, 4000, 8000, 10000]) {
    const count = Socket.all.length;
    await vi.advanceTimersByTimeAsync(delay - 1);
    expect(Socket.all).toHaveLength(count);
    await vi.advanceTimersByTimeAsync(1);
    expect(Socket.all).toHaveLength(count + 1);
    latest().close();
  }
  const count = Socket.all.length;
  browser.dispatchEvent(new Event('online'));
  expect(Socket.all).toHaveLength(count + 1);
  expect(fetchPair).toHaveBeenCalledOnce();
});

it('blocks paused sends and never restores an older transcript after an explicit PC clear', async () => {
  const { controller, socket } = await connect(snapshot({ status: 'paused' }));
  controller.setDraft('Phone input');
  await controller.sendQuestion();
  expect(socket.sent.filter((e) => e.type === 'command')).toHaveLength(0);
  socket.receive({
    type: 'snapshot',
    sequence: 2,
    snapshot: snapshot({ revision: 2, inputDraft: { text: '', revision: 2, manual: true } }),
  });
  await controller.sendQuestion(true);
  expect(socket.sent.filter((e) => e.type === 'command')).toHaveLength(0);
  socket.receive({
    type: 'snapshot',
    sequence: 3,
    snapshot: snapshot({ revision: 3, inputDraft: { text: '', revision: 3, manual: false } }),
  });
  const request = controller.sendQuestion(true),
    sent = socket.sent.at(-1)!;
  if (sent.type !== 'command') throw Error('Missing candidate');
  expect(sent.command).toMatchObject({
    action: 'ask',
    text: 'Current transcription',
    pendingQuestionRevision: 2,
  });
  socket.receive({ type: 'result', result: { requestId: sent.command.requestId, ok: true } });
  await request;
  expect(controller.getState().draft).toBe('');
});

it('adopts PC drafts and debounces phone text including an explicit clear without the business lock', async () => {
  autoDraftAck = false;
  const { controller, socket } = await connect(
    snapshot({ inputDraft: { text: 'PC draft', revision: 5, manual: true } }),
  );
  expect(controller.getState().draft).toBe('PC draft');
  controller.setDraft('Phone first');
  await vi.advanceTimersByTimeAsync(399);
  expect(socket.sent.filter((entry) => entry.type === 'command')).toHaveLength(0);
  controller.setDraft('Phone latest');
  await vi.advanceTimersByTimeAsync(400);
  const write = socket.sent.at(-1)!;
  if (write.type !== 'command') throw Error('Missing draft write');
  expect(write.command).toMatchObject({
    action: 'set-draft',
    text: 'Phone latest',
    expectedRevision: 5,
  });
  expect(controller.getState().pending).toBe(false);
  socket.receive({
    type: 'result',
    result: { requestId: write.command.requestId, ok: true, inputDraftRevision: 6 },
  });
  controller.setDraft('');
  await vi.advanceTimersByTimeAsync(400);
  const clear = socket.sent.at(-1)!;
  if (clear.type !== 'command') throw Error('Missing clear');
  expect(clear.command).toMatchObject({ action: 'set-draft', text: '', expectedRevision: 6 });
  socket.receive({
    type: 'result',
    result: { requestId: clear.command.requestId, ok: true, inputDraftRevision: 7 },
  });
  expect(controller.getState()).toMatchObject({
    draft: '',
    draftDirty: false,
    draftSyncing: false,
  });
});

it('takes PC changes immediately while unrelated same-version snapshots do not swallow typing', async () => {
  const { controller, socket } = await connect(
    snapshot({ inputDraft: { text: 'PC first', revision: 1, manual: true } }),
  );
  controller.setDraft('Phone local');
  socket.receive({
    type: 'snapshot',
    sequence: 2,
    snapshot: snapshot({
      revision: 2,
      inputDraft: { text: 'PC concurrent', revision: 2, manual: true },
    }),
  });
  expect(controller.getState()).toMatchObject({ draft: 'PC concurrent', draftDirty: false });
  await vi.advanceTimersByTimeAsync(1000);
  expect(socket.sent.filter((e) => e.type === 'command')).toHaveLength(0);
  controller.setDraft('Fresh phone input');
  socket.receive({
    type: 'snapshot',
    sequence: 3,
    snapshot: snapshot({
      revision: 3,
      inputDraft: { text: 'PC concurrent', revision: 2, manual: true },
    }),
  });
  expect(controller.getState().draft).toBe('Fresh phone input');
  socket.receive({
    type: 'snapshot',
    sequence: 4,
    snapshot: snapshot({ revision: 4, inputDraft: { text: '', revision: 3, manual: true } }),
  });
  expect(controller.getState()).toMatchObject({ draft: '', draftDirty: false });
  await vi.advanceTimersByTimeAsync(1000);
  expect(socket.sent.filter((e) => e.type === 'command')).toHaveLength(0);
});

it('preserves a PC edit with identical text when an older send ACK finally arrives', async () => {
  const { controller, socket } = await connect(
    snapshot({ inputDraft: { text: 'Same question', revision: 1, manual: true } }),
  );
  const request = controller.sendQuestion();
  await vi.advanceTimersByTimeAsync(0);
  const sent = socket.sent.at(-1)!;
  if (sent.type !== 'command') throw Error('Missing ask');
  expect(sent.command).toMatchObject({ action: 'ask', inputDraftRevision: 1 });
  socket.receive({
    type: 'snapshot',
    sequence: 2,
    snapshot: snapshot({
      revision: 2,
      inputDraft: { text: 'Same question', revision: 3, manual: true },
    }),
  });
  socket.receive({
    type: 'result',
    result: { requestId: sent.command.requestId, ok: true, inputDraftRevision: 2 },
  });
  await request;
  expect(controller.getState().draft).toBe('Same question');
});

it('defers remote draft changes during IME and distinguishes real editing from an untouched composition', async () => {
  const { controller, socket } = await connect(
    snapshot({ inputDraft: { text: 'PC first', revision: 1, manual: true } }),
  );
  controller.setComposing(true);
  socket.receive({
    type: 'snapshot',
    sequence: 2,
    snapshot: snapshot({
      revision: 2,
      inputDraft: { text: 'PC second', revision: 2, manual: true },
    }),
  });
  expect(controller.getState().draft).toBe('PC first');
  controller.setComposing(false);
  expect(controller.getState()).toMatchObject({
    draft: 'PC second',
    draftDirty: false,
  });
  controller.setComposing(true);
  controller.setDraft('中文输入');
  socket.receive({
    type: 'snapshot',
    sequence: 3,
    snapshot: snapshot({
      revision: 3,
      inputDraft: { text: 'PC third', revision: 3, manual: true },
    }),
  });
  await vi.advanceTimersByTimeAsync(1000);
  expect(controller.getState().draft).toBe('中文输入');
  expect(socket.sent.filter((entry) => entry.type === 'command')).toHaveLength(0);
  controller.setComposing(false);
  expect(controller.getState()).toMatchObject({ draft: 'PC third', draftDirty: false });
});

it('takes the reconnect snapshot over an uncertain draft and ignores its late ACK without replay', async () => {
  autoDraftAck = false;
  const { controller, socket } = await connect();
  controller.setDraft('Uncertain write');
  await vi.advanceTimersByTimeAsync(400);
  const sent = socket.sent.at(-1)!;
  if (sent.type !== 'command') throw Error('Missing draft');
  socket.close();
  await vi.advanceTimersByTimeAsync(1000);
  latest().open();
  paired(
    latest(),
    snapshot({ inputDraft: { text: 'PC authoritative', revision: 3, manual: true } }),
    2,
  );
  expect(controller.getState()).toMatchObject({
    draft: 'PC authoritative',
    draftDirty: false,
    draftSyncing: false,
    status: 'ready',
  });
  expect(latest().sent.filter((e) => e.type === 'command')).toHaveLength(0);
  latest().receive({
    type: 'result',
    result: { requestId: sent.command.requestId, ok: true, inputDraftRevision: 2 },
  });
  expect(controller.getState().draft).toBe('PC authoritative');
});

it('retries a definitively rejected IME-busy draft but never sends a question after a draft conflict', async () => {
  autoDraftAck = false;
  const { controller, socket } = await connect();
  controller.setDraft('Phone input');
  await vi.advanceTimersByTimeAsync(400);
  const busy = socket.sent.at(-1)!;
  if (busy.type !== 'command') throw Error('Missing draft');
  socket.receive({
    type: 'result',
    result: {
      requestId: busy.command.requestId,
      ok: false,
      error: 'draft-busy',
      inputDraftRevision: 1,
    },
  });
  await vi.advanceTimersByTimeAsync(800);
  const retry = socket.sent.at(-1)!;
  if (retry.type !== 'command') throw Error('Missing retry');
  expect(retry.command).toMatchObject({ action: 'set-draft', expectedRevision: 1 });
  socket.receive({
    type: 'result',
    result: { requestId: retry.command.requestId, ok: true, inputDraftRevision: 2 },
  });
  controller.setDraft('Another input');
  const send = controller.sendQuestion();
  const conflicted = socket.sent.at(-1)!;
  if (conflicted.type !== 'command') throw Error('Missing draft flush');
  socket.receive({
    type: 'result',
    result: {
      requestId: conflicted.command.requestId,
      ok: false,
      error: 'draft-conflict',
      inputDraftRevision: 3,
    },
  });
  await send;
  expect(
    socket.sent.filter((entry) => entry.type === 'command' && entry.command.action === 'ask'),
  ).toHaveLength(0);
  socket.receive({
    type: 'snapshot',
    sequence: 2,
    snapshot: snapshot({
      revision: 2,
      inputDraft: { text: 'PC canonical', revision: 3, manual: true },
    }),
  });
  expect(controller.getState()).toMatchObject({ draft: 'PC canonical', draftDirty: false });
});

it('drops unsynced old-epoch input even when the session ID is unchanged', async () => {
  const { controller, socket } = await connect();
  controller.setDraft('Old epoch input');
  socket.receive({ type: 'snapshot', sequence: 2, snapshot: snapshot({ sessionEpoch: 2 }) });
  expect(controller.getState()).toMatchObject({ draft: '', draftDirty: false });
  await vi.advanceTimersByTimeAsync(1000);
  expect(socket.sent.filter((e) => e.type === 'command')).toHaveLength(0);
});

it('does not restore residual text into an empty PC draft after scanning a new authorization QR', async () => {
  const { controller } = await connect(
    snapshot({ inputDraft: { text: 'Old accepted input', revision: 1, manual: true } }),
  );
  controller.setComposing(true);
  latest().receive({
    type: 'snapshot',
    sequence: 2,
    snapshot: snapshot({
      revision: 2,
      inputDraft: { text: 'Deferred old authorization', revision: 2, manual: true },
    }),
  });
  location.hash = '#pair=' + 'n'.repeat(43);
  browser.dispatchEvent(new Event('hashchange'));
  await controller.start();
  latest().open();
  latest().receive({ type: 'pending', id: pendingId, code: '123456' });
  paired(latest(), snapshot());
  controller.setComposing(false);
  expect(controller.getState()).toMatchObject({
    draft: '',
    draftDirty: false,
  });
  await vi.advanceTimersByTimeAsync(1000);
  expect(latest().sent.filter((entry) => entry.type === 'command')).toHaveLength(0);
});

it('requires an explicit edit before sending a truncated canonical draft', async () => {
  const { controller, socket } = await connect(
    snapshot({
      inputDraft: { text: 'x'.repeat(6000), revision: 1, manual: false, truncated: true },
    }),
  );
  await controller.sendQuestion();
  expect(controller.getState().errorCode).toBe('draft-too-long');
  expect(socket.sent.filter((entry) => entry.type === 'command')).toHaveLength(0);
  controller.setDraft('Short complete question');
  const send = controller.sendQuestion();
  await vi.advanceTimersByTimeAsync(0);
  const sent = socket.sent.find(
    (entry) => entry.type === 'command' && entry.command.action === 'ask',
  )!;
  if (sent.type !== 'command') throw Error('Missing edited ask');
  expect(sent.command).toMatchObject({ text: 'Short complete question', inputDraftRevision: 2 });
  socket.receive({
    type: 'result',
    result: { requestId: sent.command.requestId, ok: true, inputDraftRevision: 3 },
  });
  await send;
});

it('delivers current-session device scrolling once and drops stale or synchronization-time messages', async () => {
  const { controller, socket } = await connect();
  const scroll = vi.fn();
  const unsubscribe = controller.subscribeScroll(scroll);
  const send = (
    scrollId: number,
    direction: 'up' | 'down',
    sessionId = 'session-A',
    sessionEpoch = 1,
  ) => socket.receive({ type: 'scroll', scrollId, direction, sessionId, sessionEpoch });
  send(1, 'up');
  send(1, 'down');
  send(2, 'down', 'old-session');
  send(2, 'down', 'session-A', 0);
  send(2, 'down');
  expect(scroll.mock.calls).toEqual([['up'], ['down']]);
  browser.document.dispatchEvent(new Event('visibilitychange'));
  send(3, 'up');
  expect(scroll).toHaveBeenCalledTimes(2);
  socket.receive({ type: 'snapshot', sequence: 1, snapshot: snapshot() });
  send(4, 'up');
  expect(scroll).toHaveBeenCalledTimes(3);
  unsubscribe();
  send(5, 'down');
  expect(scroll).toHaveBeenCalledTimes(3);
});
