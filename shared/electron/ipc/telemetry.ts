import { validTelemetrySignal } from '../contracts/telemetry';
import type { Telemetry } from '../backend/telemetry/service';
import { handleDesktop } from './handle';

export function registerTelemetryIpc(d: {
  telemetry: Telemetry;
  requireEntry(e: Electron.IpcMainInvokeEvent): void;
  requireMain(e: Electron.IpcMainInvokeEvent): void;
  requireInterview(e: Electron.IpcMainInvokeEvent): void;
}) {
  handleDesktop('telemetry:signal', (event, ...args: unknown[]) => {
    if (event.senderFrame !== event.sender.mainFrame) throw Error('Unauthorized frame');
    if (args.length !== 1 || !validTelemetrySignal(args[0]))
      throw Error('Invalid telemetry signal');
    const signal = args[0];
    if (signal.type === 'ready') {
      d.requireEntry(event);
      d.telemetry.usable();
    } else if (signal.type === 'feature') {
      d.requireMain(event);
      d.telemetry.activity(signal.feature);
    } else {
      d.requireInterview(event);
      if (signal.type === 'manual_question') d.telemetry.manualQuestion();
      else d.telemetry.saved(signal.saved);
    }
  });
}
