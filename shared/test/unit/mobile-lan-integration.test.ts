import { afterEach, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { WebSocket } from 'ws';
import { RemoteConnectionService } from '../../electron/backend/remoteConnection/service';
import { RemoteInterviewCoordinator } from '../../electron/application/remoteConnection';
import { createMobileConnection, type MobileConnection } from '../../src/mobile/connection';
import { connectRemoteInterview } from '../../src/services/remoteInterview';
import { useInterview } from '../../src/stores/interview';
import { useRemoteConnection } from '../../src/stores/remoteConnection';
import type { RemoteCommand } from '../../electron/contracts/remoteConnection';

let service: RemoteConnectionService | undefined;
let mobile: MobileConnection | undefined;
let releaseBridge: (() => void) | undefined;
let finishProvider: (() => void) | undefined;
const sockets: WebSocket[] = [];
afterEach(async () => {
  mobile?.dispose();
  releaseBridge?.();
  useInterview.getState().reset();
  finishProvider?.();
  sockets.splice(0).forEach((socket) => socket.terminate());
  await service?.disconnect();
  vi.unstubAllGlobals();
});

it('shares versioned drafts over the real LAN bridge, preserves newer edits after a lost ask ACK and controls the existing desktop store', async () => {
  let receiveCommand: ((command: RemoteCommand) => void) | undefined;
  const coordinator = new RemoteInterviewCoordinator((command) => {
    receiveCommand?.(command);
    return !!receiveCommand;
  });
  let loseNextAskReply = true;
  let dropAskReply: (() => void) | undefined;
  const holdAskReply = new Promise<void>((resolve) => {
    dropAskReply = resolve;
  });
  const execute = vi.fn(async (command: RemoteCommand, signal: AbortSignal) => {
    const result = await coordinator.dispatch(command, signal);
    if (loseNextAskReply && command.action === 'ask') {
      loseNextAskReply = false;
      // Draft acknowledgements remain live while only the accepted ask receipt
      // is held and then lost, matching a connection break after acceptance.
      await holdAskReply;
      sockets.at(-1)?.terminate();
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    return result;
  });
  service = new RemoteConnectionService({
    onState: (state) => useRemoteConnection.setState({ state }),
    onCommand: execute,
  });
  const state = await service.start();
  expect(state.status, state.error ?? '').toBe('waiting');
  const origin = state.addresses[0];
  const pairing = service.pairing();
  const location = { origin, pathname: '/', search: '', hash: new URL(pairing.url).hash };
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
  class BrowserSocket extends WebSocket {
    constructor(url: string) {
      super(url, { origin });
      sockets.push(this);
      this.on('error', () => {});
    }
  }
  const browserDocument = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  const browser = Object.assign(new EventTarget(), {
    location,
    history: {
      replaceState: vi.fn(() => {
        location.hash = '';
      }),
    },
    document: browserDocument,
    navigator: { onLine: true, userAgent: 'Synthetic LAN phone' },
    crypto: webcrypto,
    sessionStorage: storage,
    WebSocket: BrowserSocket,
    fetch: (input: string, options: RequestInit) =>
      fetch(input, {
        ...options,
        headers: { ...options.headers, Origin: origin },
      }),
    desktop: {
      speech: vi.fn(async () => ({ state: 'running', model: 'Synthetic' })),
      onSpeechEvent: () => () => {},
      onChatEvent: () => () => {},
      interviewAnswer: vi.fn(
        () =>
          new Promise((resolve) => {
            finishProvider = () =>
              resolve({
                ok: true,
                answerText: 'Synthetic desktop answer',
                sources: [],
                usage: null,
              });
          }),
      ),
      interviewCancel: vi.fn(async () => {}),
      setInterviewInput: vi.fn(async (inputState) => ({
        state: 'running',
        model: 'Synthetic',
        inputState,
      })),
      publishRemoteInterview: vi.fn(async (snapshot) => {
        if (coordinator.publish(snapshot)) service!.updateSnapshot(snapshot);
      }),
      onRemoteCommand: (callback: (command: RemoteCommand) => void) => {
        receiveCommand = callback;
        return () => {
          receiveCommand = undefined;
        };
      },
      finishRemoteCommand: async (result) => coordinator.complete(result),
    },
  });
  vi.stubGlobal('window', browser);
  vi.stubGlobal('localStorage', storage);
  useInterview.getState().reset();
  useInterview.setState({ configurationLocked: false });
  useInterview.getState().configure({
    mode: 'local',
    aiEnabled: true,
    modelId: 'synthetic-model',
    options: { sources: ['microphone', 'system'] },
  });
  useInterview.getState().start();
  await new Promise((resolve) => setTimeout(resolve, 0));
  useInterview.setState({
    speech: { state: 'running', model: 'Synthetic' },
    draftQuestion: 'Desktop transcription candidate',
    autoAnswer: false,
    transcripts: [
      {
        id: 'synthetic-transcript',
        text: 'Synthetic transcript',
        time: '12:00',
        final: true,
        source: 'system',
      },
    ],
  });
  releaseBridge = connectRemoteInterview();
  mobile = createMobileConnection();
  expect(location.hash).toBe('');
  await mobile.start();
  await vi.waitFor(() => expect(mobile!.getState().status).toBe('approval'));
  expect(mobile.getState().snapshot).toBeNull();
  expect(mobile.getState().pairingCode).toBe(service.state().pending?.code);
  await vi.waitFor(() => expect(browser.desktop.publishRemoteInterview).toHaveBeenCalled());
  service.approve(service.state().pending!.id);
  await vi.waitFor(() => expect(mobile!.getState().status).toBe('ready'));
  expect(mobile.getState().snapshot?.transcripts[0].text).toBe('Synthetic transcript');
  expect(mobile.getState().draft).toBe('Desktop transcription candidate');
  const scroll = vi.fn();
  const unsubscribeScroll = mobile.subscribeScroll(scroll);
  expect(service.scroll('up')).toBe(true);
  await vi.waitFor(() => expect(scroll).toHaveBeenCalledWith('up'));
  expect(useInterview.getState().setInputDraft('PC shared draft')).toBe(true);
  await vi.waitFor(() => expect(mobile!.getState().draft).toBe('PC shared draft'));
  expect(mobile.getState().snapshot?.inputDraft).toMatchObject({
    text: 'PC shared draft',
    revision: useInterview.getState().inputDraftRevision,
    manual: true,
  });
  mobile.setDraft('Phone shared question');
  await vi.waitFor(() => expect(useInterview.getState().inputDraft).toBe('Phone shared question'));
  await vi.waitFor(() =>
    expect(mobile!.getState()).toMatchObject({ draftDirty: false, draftSyncing: false }),
  );
  await vi.waitFor(() =>
    expect(mobile!.getState().snapshot?.inputDraft.revision).toBe(
      useInterview.getState().inputDraftRevision,
    ),
  );
  const sent = mobile.sendQuestion();
  await vi.waitFor(() => expect(useInterview.getState().answers).toHaveLength(1));
  expect(useInterview.getState().answers[0].question).toBe('Phone shared question');
  await vi.waitFor(() => expect(mobile!.getState().snapshot?.inputDraft.text).toBe(''));
  expect(mobile.getState().pendingAction).toBe('sendQuestion');
  mobile.setDraft('Next shared phone draft');
  await vi.waitFor(() =>
    expect(useInterview.getState().inputDraft).toBe('Next shared phone draft'),
  );
  await vi.waitFor(() =>
    expect(mobile!.getState()).toMatchObject({ draftDirty: false, draftSyncing: false }),
  );
  const nextDraftRevision = useInterview.getState().inputDraftRevision;
  dropAskReply!();
  await vi.waitFor(() => expect(mobile!.getState().connected).toBe(false));
  await sent;
  expect(execute.mock.calls.filter(([command]) => command.action === 'ask')).toHaveLength(1);
  expect(mobile.getState().draft).toBe('Next shared phone draft');
  expect(useInterview.getState().inputDraft).toBe('Next shared phone draft');
  expect(useInterview.getState().inputDraftRevision).toBe(nextDraftRevision);
  expect(mobile.getState().snapshot?.inputDraft.revision).toBe(nextDraftRevision);
  expect(useInterview.getState().answers).toHaveLength(1);
  finishProvider!();
  await vi.waitFor(() =>
    expect(mobile!.getState().snapshot?.answers[0].content).toBe('Synthetic desktop answer'),
  );
  expect(mobile.getState().pending).toBe(false);
  expect(mobile.getState().connected).toBe(true);

  await mobile.setMicrophoneMuted(true);
  await vi.waitFor(() => expect(mobile!.getState().snapshot?.microphoneMuted).toBe(true));
  expect(useInterview.getState().microphoneMuted).toBe(true);
  await mobile.setAutoAnswer(true);
  await vi.waitFor(() => expect(mobile!.getState().snapshot?.autoAnswer).toBe(true));
  expect(useInterview.getState().autoAnswer).toBe(true);
  expect(execute.mock.calls.filter(([command]) => command.action !== 'set-draft')).toHaveLength(3);

  const draftCalls = execute.mock.calls.filter(
    ([command]) => command.action === 'set-draft',
  ).length;
  browser.navigator.onLine = false;
  browser.dispatchEvent(new Event('offline'));
  await vi.waitFor(() => expect(mobile!.getState().connected).toBe(false));
  mobile.setDraft('Temporary offline input');
  expect(useInterview.getState().setInputDraft('Concurrent PC edit')).toBe(true);
  expect(mobile.getState().draft).toBe('Temporary offline input');
  browser.navigator.onLine = true;
  browser.dispatchEvent(new Event('online'));
  await vi.waitFor(() =>
    expect(mobile!.getState()).toMatchObject({
      connected: true,
      draft: 'Concurrent PC edit',
      draftDirty: false,
    }),
  );
  expect(mobile.getState().draft).toBe('Concurrent PC edit');
  expect(mobile.getState().snapshot?.inputDraft.text).toBe('Concurrent PC edit');
  await new Promise((resolve) => setTimeout(resolve, 500));
  expect(execute.mock.calls.filter(([command]) => command.action === 'set-draft')).toHaveLength(
    draftCalls,
  );
  expect(useInterview.getState().inputDraft).toBe('Concurrent PC edit');
  expect(mobile.getState()).toMatchObject({
    draft: 'Concurrent PC edit',
    draftDirty: false,
  });

  await mobile.disconnect();
  await vi.waitFor(() => expect(service!.state().status).toBe('waiting'));
  expect(service.state().clientName).toBeNull();
  expect(useInterview.getState().microphoneMuted).toBe(true);
  expect(useInterview.getState().autoAnswer).toBe(true);
  expect(useInterview.getState().inputDraft).toBe('Concurrent PC edit');
  expect(mobile.getState().status).toBe('disconnected');
  unsubscribeScroll();
}, 15000);
