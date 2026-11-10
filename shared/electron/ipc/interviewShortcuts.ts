import type { IpcMainInvokeEvent } from 'electron';
import type { InterviewShortcutsState } from '../contracts/desktop';
import { handleDesktop } from './handle';
import {
  validateShortcutCall,
  type ShortcutSettingsCall,
  type ShortcutSettingsResult,
} from '../contracts/shortcuts';

export function registerShortcutSettingsIpc({
  mac = false,
  authorize,
  call,
}: {
  mac?: boolean;
  authorize(event: IpcMainInvokeEvent, write: boolean): void;
  call(value: ShortcutSettingsCall, event: IpcMainInvokeEvent): Promise<ShortcutSettingsResult>;
}) {
  handleDesktop('shortcuts:settings', (event, ...args: unknown[]) => {
    authorize(event, false);
    if (args.length !== 1) throw Error('Invalid shortcut request');
    const value = validateShortcutCall(args[0], mac);
    if (value.op !== 'status') authorize(event, true);
    return call(value, event);
  });
}

export function registerInterviewShortcutsIpc({
  requireWindow,
  state,
  setOpen,
  ready,
}: {
  requireWindow(event: IpcMainInvokeEvent): 'owner' | 'help';
  state(role: 'owner' | 'help'): InterviewShortcutsState;
  setOpen(open: boolean): boolean;
  ready(role: 'owner' | 'help'): void;
}) {
  handleDesktop('interview:shortcuts-state', (event, ...args: unknown[]) => {
    const role = requireWindow(event);
    if (args.length) throw Error('Invalid request');
    return state(role);
  });
  handleDesktop('interview:shortcuts-open', (event, ...args: unknown[]) => {
    const role = requireWindow(event);
    if (args.length !== 1 || typeof args[0] !== 'boolean' || (role === 'help' && args[0]))
      throw Error('Invalid request');
    return setOpen(args[0]);
  });
  handleDesktop('interview:renderer-ready', (event, ...args: unknown[]) => {
    const role = requireWindow(event);
    if (
      args.length !== 1 ||
      !Number.isSafeInteger(args[0]) ||
      (args[0] as number) <= 0 ||
      args[0] !== state(role).rendererRevision
    )
      throw Error('Invalid request');
    ready(role);
  });
}
