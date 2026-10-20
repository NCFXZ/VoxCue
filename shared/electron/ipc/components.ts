import { handleDesktop } from './handle';
import type { ComponentService } from '../backend/components/service';
import type { ComponentId } from '../contracts/components';

export function registerComponentIpc(
  service: ComponentService,
  authorize: (event: Electron.IpcMainInvokeEvent) => void,
  authorizeRemove: (event: Electron.IpcMainInvokeEvent) => void = authorize,
) {
  handleDesktop('components:call', (event, ...args: unknown[]) => {
    authorize(event);
    if (event.senderFrame !== event.sender.mainFrame || args.length !== 1)
      throw Error('Unauthorized component request');
    const call = args[0];
    if (!call || typeof call !== 'object' || Array.isArray(call))
      throw Error('Invalid component request');
    const value = call as Record<string, unknown>;
    if (value.op === 'remove') {
      if (
        Object.keys(value).length !== 2 ||
        !Object.hasOwn(value, 'op') ||
        !Object.hasOwn(value, 'id') ||
        !['speech', 'qwen', 'rag'].includes(value.id as string)
      )
        throw Error('Invalid component request');
      authorizeRemove(event);
      return service.remove(value.id as ComponentId);
    }
    if (value.op === 'download') {
      if (
        Object.keys(value).some((key) => !['op', 'id'].includes(key)) ||
        (Object.hasOwn(value, 'id') && !['speech', 'qwen', 'rag'].includes(value.id as string))
      )
        throw Error('Invalid component request');
      return service.download(value.id as ComponentId | undefined);
    }
    if (Object.keys(value).length !== 1) throw Error('Invalid component request');
    if (value.op === 'status') return service.status();
    if (value.op === 'cancel') return service.cancel();
    throw Error('Invalid component operation');
  });
}
