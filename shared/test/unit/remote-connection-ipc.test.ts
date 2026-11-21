import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  RemoteInterviewCoordinator,
  validateRemoteConnectionCall,
  validateRemoteResult,
  validateRemoteSnapshot,
} from '../../electron/application/remoteConnection';
import type {
  RemoteCommand,
  RemoteInterviewSnapshot,
} from '../../electron/contracts/remoteConnection';
import { registerRemoteConnectionIpc } from '../../electron/ipc/remoteConnection';
import type { RemoteConnectionService } from '../../electron/backend/remoteConnection/service';

const bridge = vi.hoisted(() => ({ handlers: new Map<string, (...args: any[]) => any>() }));
vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: any[]) => any) =>
      bridge.handlers.set(channel, handler),
  },
}));

const snapshot = (): RemoteInterviewSnapshot => ({
  sessionId: 'owned-session',
  sessionEpoch: 1,
  revision: 1,
  status: 'running',
  inputMode: 'remote',
  transcripts: [],
  answers: [],
  pendingQuestion: '',
  pendingQuestionRevision: 1,
  inputDraft: { text: '', revision: 0, manual: false },
  generating: false,
  aiEnabled: true,
  microphoneMuted: false,
  microphoneToggling: false,
  micRevision: 1,
  autoAnswer: true,
  autoAnswerRevision: 1,
  capabilities: { sendQuestion: true, setMicrophone: true, setAutoAnswer: true, stopAnswer: false },
  omitted: { transcripts: 0, answers: 0 },
});
const command = (): RemoteCommand => ({
  requestId: 'request-123',
  sessionId: 'owned-session',
  sessionEpoch: 1,
  action: 'set-microphone',
  muted: true,
  expectedRevision: 1,
});

beforeEach(() => bridge.handlers.clear());

describe('remote renderer boundary', () => {
  it('accepts only fixed management actions and bounded content projections', () => {
    expect(validateRemoteConnectionCall({ op: 'pair' })).toEqual({ op: 'pair' });
    for (const value of [
      { op: 'start', host: '0.0.0.0' },
      { op: 'approve' },
      { op: 'execute', command: 'x' },
    ])
      expect(() => validateRemoteConnectionCall(value)).toThrow('Invalid remote');
    expect(validateRemoteSnapshot(snapshot())).toEqual({ snapshot: snapshot(), serialized: JSON.stringify(snapshot()) });
    for (const truncated of [true, false]) {
      const value = { ...snapshot(), inputDraft: { ...snapshot().inputDraft, truncated } };
      expect(validateRemoteSnapshot(value).snapshot).toEqual(value);
    }
    for (const value of [
      { ...snapshot(), account: 'private' },
      {
        ...snapshot(),
        transcripts: [{ id: 'one', text: 'text', time: '', final: true, credentials: 'private' }],
      },
      {
        ...snapshot(),
        answers: [{ id: 'one', question: 'q', content: 'a', sources: [{ path: 'private' }] }],
      },
      { ...snapshot(), capabilities: { ...snapshot().capabilities, execute: true } },
      { ...snapshot(), inputDraft: { text: 'x'.repeat(6001), revision: 1, manual: true } },
      { ...snapshot(), inputDraft: { text: '', revision: -1, manual: false } },
      { ...snapshot(), inputDraft: { text: '', revision: 1, manual: false, account: 'private' } },
      { ...snapshot(), inputDraft: { text: '', revision: 1, manual: false, truncated: 'true' } },
      { ...snapshot(), inputDraft: { text: '', revision: 1, manual: false, truncated: 1 } },
      { ...snapshot(), inputDraft: { text: '', revision: 1, manual: false, truncated: null } },
      {
        ...snapshot(),
        transcripts: Array.from({ length: 201 }, () => ({
          id: 'one',
          text: '',
          time: '',
          final: true,
        })),
      },
    ])
      expect(() => validateRemoteSnapshot(value)).toThrow('Invalid remote');
    expect(() =>
      validateRemoteResult({ requestId: 'request-123', ok: true, token: 'private' }),
    ).toThrow();
    expect(() =>
      validateRemoteResult({ requestId: 'request-123', ok: true, inputDraftRevision: 1.5 }),
    ).toThrow();
  });

  it('authorizes management and owner-only publication before calling services', async () => {
    const service = {
      start: vi.fn(async () => ({ status: 'waiting' })),
      disconnect: vi.fn(),
      approve: vi.fn(),
      reject: vi.fn(),
      state: vi.fn(() => ({
        status: 'off',
        revision: 1,
        addresses: [],
        clientName: null,
        pending: null,
        error: null,
      })),
      pairing: vi.fn(() => ({ url: 'http://192.168.1.2:1234/#pair=synthetic', expiresAt: 123 })),
      updateSnapshot: vi.fn(),
      waitForSnapshotSlot: vi.fn(),
    };
    const coordinator = new RemoteInterviewCoordinator(() => true);
    const main = { mainFrame: {} },
      owner = { mainFrame: {} },
      other = { mainFrame: {} };
    const event = (sender: any, frame = sender.mainFrame) => ({ sender, senderFrame: frame });
    registerRemoteConnectionIpc({
      service: service as unknown as RemoteConnectionService,
      coordinator,
      requireOwner(e) {
        if (![main, owner].includes(e.sender as any) || e.senderFrame !== e.sender.mainFrame)
          throw Error('Unauthorized');
      },
      requireInterview(e) {
        if (e.sender !== (owner as any) || e.senderFrame !== e.sender.mainFrame)
          throw Error('Unauthorized');
      },
      viewState: (state) => state,
    });
    const manage = bridge.handlers.get('remote:connection')!;
    await expect(manage(event(other), { op: 'start' })).rejects.toThrow('Unauthorized');
    await expect(manage(event(main, {}), { op: 'start' })).rejects.toThrow('Unauthorized');
    await expect(manage(event(main), { op: 'start', port: 80 })).rejects.toThrow();
    expect(service.start).not.toHaveBeenCalled();
    await manage(event(main), { op: 'start' });
    expect(service.start).toHaveBeenCalledOnce();
    service.start.mockResolvedValueOnce({ status: 'error', error: 'No private network' } as any);
    const beforeFailure = service.pairing.mock.calls.length;
    expect(await manage(event(main), { op: 'start' })).toMatchObject({
      state: { status: 'error', error: 'No private network' },
    });
    expect(service.pairing.mock.calls.length).toBe(beforeFailure);
    const ready = bridge.handlers.get('remote:ready')!;
    expect(() => ready(event(main))).toThrow('Unauthorized');
    expect(() => ready(event(owner), 'extra')).toThrow('Invalid remote request');
    ready(event(owner));
    expect(service.waitForSnapshotSlot).toHaveBeenCalledOnce();
    const publish = bridge.handlers.get('remote:publish')!;
    expect(() => publish(event(main), snapshot())).toThrow('Unauthorized');
    publish(event(owner), snapshot());
    publish(event(owner), snapshot());
    expect(service.updateSnapshot).toHaveBeenCalledOnce();
    expect(() =>
      bridge.handlers.get('remote:complete')!(event(other), { requestId: 'request-123', ok: true }),
    ).toThrow('Unauthorized');
  });
});

describe('remote command ownership', () => {
  it('rejects stale sessions and resolves only an acknowledged request', async () => {
    const send = vi.fn(() => true),
      coordinator = new RemoteInterviewCoordinator(send);
    coordinator.publish(snapshot());
    expect((await coordinator.dispatch({ ...command(), sessionEpoch: 0 })).ok).toBe(false);
    expect(send).not.toHaveBeenCalled();
    const result = coordinator.dispatch(command());
    expect(send).toHaveBeenCalledOnce();
    const dispatched = send.mock.calls[0][0] as RemoteCommand;
    expect(dispatched.requestId).not.toBe(command().requestId);
    coordinator.complete({ requestId: 'other-request', ok: true });
    coordinator.complete({ requestId: dispatched.requestId, ok: true });
    expect(await result).toEqual({ requestId: command().requestId, ok: true });
  });

  it('cancels requests across navigation, new sessions and revoked authorizations', async () => {
    const coordinator = new RemoteInterviewCoordinator(() => true);
    coordinator.publish(snapshot());
    const first = coordinator.dispatch(command());
    coordinator.reset();
    expect((await first).ok).toBe(false);
    coordinator.publish(snapshot());
    const second = coordinator.dispatch(command());
    coordinator.publish({ ...snapshot(), sessionId: 'new-session', sessionEpoch: 2 });
    coordinator.complete({ requestId: command().requestId, ok: true });
    expect((await second).ok).toBe(false);
    const abort = new AbortController();
    const third = coordinator.dispatch(
      { ...command(), sessionId: 'new-session', sessionEpoch: 2 },
      abort.signal,
    );
    abort.abort();
    expect((await third).ok).toBe(false);
  });

  it('bounds an unresponsive renderer without treating a late success as a new request', async () => {
    vi.useFakeTimers();
    try {
      const coordinator = new RemoteInterviewCoordinator(() => true);
      coordinator.publish(snapshot());
      const result = coordinator.dispatch(command());
      await vi.advanceTimersByTimeAsync(10001);
      expect((await result).ok).toBe(false);
      expect(() =>
        coordinator.complete({ requestId: command().requestId, ok: true }),
      ).not.toThrow();
    } finally {
      vi.useRealTimers();
    }
  });

  it('cannot complete a reused phone request ID with an acknowledgement from an earlier authorization', async () => {
    const dispatched: RemoteCommand[] = [];
    const coordinator = new RemoteInterviewCoordinator((value) => {
      dispatched.push(value);
      return true;
    });
    coordinator.publish(snapshot());
    const first = coordinator.dispatch(command());
    coordinator.reset();
    expect((await first).ok).toBe(false);
    coordinator.publish(snapshot());
    const second = coordinator.dispatch(command());
    expect(dispatched[1].requestId).not.toBe(dispatched[0].requestId);
    coordinator.complete({ requestId: dispatched[0].requestId, ok: true, answerId: 'old-answer' });
    coordinator.complete({ requestId: dispatched[1].requestId, ok: true, answerId: 'new-answer' });
    expect(await second).toEqual({
      requestId: command().requestId,
      ok: true,
      answerId: 'new-answer',
    });
  });
});
