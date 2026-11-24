import type { AnnouncementService } from '../backend/announcements';
import { handleDesktop } from './handle';

export function registerAnnouncementIpc(
  service: AnnouncementService,
  requireMain: (event: Electron.IpcMainInvokeEvent) => void,
  isSignedIn: () => boolean,
) {
  handleDesktop('announcements:read', (event, ...args: unknown[]) => {
    requireMain(event);
    if (event.senderFrame !== event.sender.mainFrame) throw Error('Unauthorized frame');
    if (args.length) throw Error('Invalid announcement request');
    return service.read(isSignedIn());
  });
}
