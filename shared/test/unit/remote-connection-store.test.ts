import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type {
  RemoteConnectionResult,
  RemoteConnectionState,
} from '../../electron/contracts/remoteConnection';
import { useRemoteConnection } from '../../src/stores/remoteConnection';

const state = (
  revision: number,
  status: RemoteConnectionState['status'] = 'waiting',
): RemoteConnectionState => ({
  revision,
  status,
  addresses: ['192.0.2.1'],
  clientName: null,
  pending: null,
  error: null,
});
let receive: (state: RemoteConnectionState) => void;
const call = vi.fn();
beforeEach(() => {
  call.mockReset();
  useRemoteConnection.setState({
    state: null,
    pairing: null,
    loading: false,
    error: null,
    dialogOpen: false,
    interrupted: false,
  });
  vi.stubGlobal('window', {
    desktop: {
      remoteConnection: call,
      onRemoteConnection: (callback) => {
        receive = callback;
        return () => {};
      },
    },
  });
});
afterEach(() => vi.unstubAllGlobals());

it('does not let a late status response replace a newer event or return a stale pairing QR', async () => {
  let resolve!: (result: RemoteConnectionResult) => void;
  call.mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const disconnect = useRemoteConnection.getState().connectEvents();
  receive(state(3, 'connected'));
  resolve({ state: state(1), pairing: { url: 'http://192.0.2.1/#expired', expiresAt: 1000 } });
  await Promise.resolve();
  expect(useRemoteConnection.getState().state?.status).toBe('connected');
  expect(useRemoteConnection.getState().pairing).toBeNull();
  disconnect();
});

it('keeps the QR transient and clears it after connection or explicit disconnection', async () => {
  call.mockResolvedValueOnce({
    state: state(1),
    pairing: { url: 'http://192.0.2.1/#one-use', expiresAt: 1000 },
  });
  await useRemoteConnection.getState().start();
  expect(call).toHaveBeenLastCalledWith({ op: 'start' });
  expect(useRemoteConnection.getState().pairing?.expiresAt).toBe(1000);
  useRemoteConnection.getState().setDialogOpen(true);
  call.mockResolvedValueOnce({ state: state(2, 'off') });
  await useRemoteConnection.getState().disconnect();
  expect(call).toHaveBeenLastCalledWith({ op: 'disconnect' });
  expect(useRemoteConnection.getState().pairing).toBeNull();
  expect(useRemoteConnection.getState().dialogOpen).toBe(false);
});

it('surfaces failures, releases the loading guard and retries with the requested pairing operation', async () => {
  call.mockRejectedValueOnce(Error('Synthetic connection failure'));
  await useRemoteConnection.getState().start();
  expect(useRemoteConnection.getState().error).toBe('Synthetic connection failure');
  expect(useRemoteConnection.getState().loading).toBe(false);
  call.mockResolvedValueOnce({ state: state(1) });
  await useRemoteConnection.getState().refreshPairing();
  expect(call).toHaveBeenLastCalledWith({ op: 'pair' });
  expect(useRemoteConnection.getState().error).toBeNull();
});

it('retains an unexpected interruption through expired resume waiting and clears it after reconnection', async () => {
  call.mockResolvedValue({ state: state(1) });
  const dispose = useRemoteConnection.getState().connectEvents();
  await Promise.resolve();
  expect(useRemoteConnection.getState().interrupted).toBe(false);
  receive(state(2, 'connected'));
  receive(state(3, 'reconnecting'));
  expect(useRemoteConnection.getState().interrupted).toBe(true);
  receive(state(4, 'waiting'));
  expect(useRemoteConnection.getState().interrupted).toBe(true);
  receive(state(5, 'error'));
  expect(useRemoteConnection.getState().interrupted).toBe(true);
  receive(state(6, 'connected'));
  expect(useRemoteConnection.getState().interrupted).toBe(false);
  dispose();
});

it('does not treat first pairing errors or an explicit disconnect as an unexpected interruption', async () => {
  call.mockResolvedValue({ state: state(1, 'error') });
  const dispose = useRemoteConnection.getState().connectEvents();
  await Promise.resolve();
  expect(useRemoteConnection.getState().interrupted).toBe(false);
  receive(state(2, 'reconnecting'));
  expect(useRemoteConnection.getState().interrupted).toBe(true);
  receive(state(3, 'off'));
  expect(useRemoteConnection.getState().interrupted).toBe(false);
  dispose();
});

it('keeps an explicit phone disconnection from connected to waiting silent', async () => {
  call.mockResolvedValue({ state: state(1, 'connected') });
  const dispose = useRemoteConnection.getState().connectEvents();
  await Promise.resolve();
  receive(state(2, 'waiting'));
  expect(useRemoteConnection.getState().interrupted).toBe(false);
  dispose();
});
