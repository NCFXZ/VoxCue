import type { BrowserWindowConstructorOptions } from 'electron';

/** Native policy only. Business state, IPC and renderer code stay outside this layer. */
export interface DesktopPlatform {
  readonly id: NodeJS.Platform;
  readonly iconFile: string;
  readonly mainWindowOptions: Pick<BrowserWindowConstructorOptions, 'backgroundMaterial'>;
  readonly appUserModelId?: string;
  readonly quitOnAllWindowsClosed: boolean;
  readonly captureProtectionSupported: boolean;
  readonly credentialEncryptionLabel: string;
  readonly microphoneSettingsUrl?: string;
  readonly wasapiHelper?: string;
  readonly speechProcessFile?: string;
  readonly packagedCopilotRuntime?: string;
}
