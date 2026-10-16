import type { UpdateService } from '../backend/updates/service';
import { handleDesktop } from './handle';

export function registerUpdateIpc(
  service: UpdateService,
  requireMain: (event: Electron.IpcMainInvokeEvent) => void,
) {
  handleDesktop('updates:call', (event, call: unknown) => {
    requireMain(event);
    if (event.senderFrame !== event.sender.mainFrame) throw Error('Unauthorized frame');
    if (
      !call ||
      typeof call !== 'object' ||
      Array.isArray(call) ||
      Object.keys(call).length !== 1 ||
      !Object.hasOwn(call, 'op')
    )
      throw Error('Invalid update request');
    const op = (call as { op: unknown }).op;
    if (op === 'status') return service.state();
    if (op === 'check') return service.check();
    if (op === 'download') return service.download();
    if (op === 'install') return service.install();
    throw Error('Invalid update operation');
  });
}
