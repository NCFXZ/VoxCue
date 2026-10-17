import type { BrowserWindowConstructorOptions } from 'electron';
import type { PresentationCapabilities } from '../contracts/presentation';

/** Native policy only. Business state, IPC and renderer code stay outside this layer. */
export interface DesktopPlatform {
  readonly id: NodeJS.Platform;
  readonly iconFile: string;
  readonly mainWindowOptions: Pick<
    BrowserWindowConstructorOptions,
    'backgroundMaterial' | 'vibrancy' | 'visualEffectState'
  >;
  readonly nativeWindowControls?: boolean;
  readonly presentation?: PresentationCapabilities;
  readonly presentationFile?: string;
  readonly audioHelper?: string;
  readonly systemAudioSettingsUrl?: string;
  readonly screenCaptureSettingsUrl?: string;
  readonly screenPermissionFile?: string;
  readonly appUserModelId?: string;
  readonly quitOnAllWindowsClosed: boolean;
  readonly captureProtectionSupported: boolean;
  readonly credentialEncryptionLabel: string;
  readonly microphoneSettingsUrl?: string;
  readonly wasapiHelper?: string;
  readonly speechProcessFile?: string;
  readonly packagedCopilotRuntime?: string;
}
