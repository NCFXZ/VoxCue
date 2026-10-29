import type { TelemetryFeature, TelemetrySignal } from '../../electron/contracts/telemetry';

// Product actions never await statistics or expose identity/transport controls to a page.
export function signalTelemetry(signal: TelemetrySignal) {
  if (typeof window !== 'undefined') void window.desktop?.telemetrySignal?.(signal).catch(() => {});
}
export function recordFeature(feature: TelemetryFeature) {
  signalTelemetry({ type: 'feature', feature });
}
