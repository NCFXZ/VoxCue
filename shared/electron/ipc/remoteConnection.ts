import type { IpcMainInvokeEvent } from 'electron';
import type { RemoteConnectionService } from '../backend/remoteConnection/service';
import type { RemoteConnectionState } from '../contracts/remoteConnection';
import {
  RemoteInterviewCoordinator,
  validateRemoteConnectionCall,
  validateRemoteResult,
  validateRemoteSnapshot,
} from '../application/remoteConnection';
import { handleDesktop } from './handle';

export function registerRemoteConnectionIpc(options: {
  service: RemoteConnectionService;
  coordinator: RemoteInterviewCoordinator;
  requireOwner(event: IpcMainInvokeEvent): void;
  requireInterview(event: IpcMainInvokeEvent): void;
  viewState(state: RemoteConnectionState): RemoteConnectionState;
}) {
  const { service, coordinator, requireOwner, requireInterview, viewState } = options;
  handleDesktop('remote:connection', async (event, ...args: unknown[]) => {
    requireOwner(event);
    if (args.length !== 1) throw Error('Invalid remote request');
    const call = validateRemoteConnectionCall(args[0]);
    if (call.op === 'start') {
      const state = await service.start();
      if (state.status === 'error') return { state: viewState(state) };
    } else if (call.op === 'disconnect') await service.disconnect();
    else if (call.op === 'approve') service.approve(call.id);
    else if (call.op === 'reject') service.reject(call.id);
    const pairing = call.op === 'start' || call.op === 'pair' ? service.pairing() : undefined;
    return { state: viewState(service.state()), ...(pairing ? { pairing } : {}) };
  });
  handleDesktop('remote:ready', (event, ...args: unknown[]) => {
    requireInterview(event);
    if (args.length) throw Error('Invalid remote request');
    return service.waitForSnapshotSlot();
  });
  handleDesktop('remote:publish', (event, ...args: unknown[]) => {
    requireInterview(event);
    if (args.length !== 1) throw Error('Invalid remote snapshot');
    const { snapshot, serialized } = validateRemoteSnapshot(args[0]);
    if (coordinator.publish(snapshot)) service.updateSnapshot(snapshot, serialized);
  });
  handleDesktop('remote:complete', (event, ...args: unknown[]) => {
    requireInterview(event);
    if (args.length !== 1) throw Error('Invalid remote result');
    coordinator.complete(validateRemoteResult(args[0]));
  });
}
