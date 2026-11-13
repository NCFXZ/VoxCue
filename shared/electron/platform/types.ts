import type { BrowserWindow, BrowserWindowConstructorOptions, NativeImage } from 'electron';
import type { PresentationCapabilities } from '../contracts/presentation';

/** Native policy only. Business state, IPC and renderer code stay outside this layer. */
export interface DesktopPlatform {
  readonly id: NodeJS.Platform;
  readonly accountFetch?: typeof fetch;
  readonly codexLoginStatus?: (
    executable: string,
    options: { cwd: string; env: NodeJS.ProcessEnv },
    signal: AbortSignal,
  ) => Promise<'signed-in' | 'empty'>;
  readonly iconFile: string;
  readonly mainWindowOptions: Pick<
    BrowserWindowConstructorOptions,
    'backgroundMaterial' | 'vibrancy' | 'visualEffectState'
  >;
  readonly presentation?: PresentationCapabilities;
  readonly presentationFile?: string;
  readonly updateDriverFile?: string;
  readonly audioHelper?: string;
  readonly systemAudioSettingsUrl?: string;
  readonly screenCaptureSettingsUrl?: string;
  readonly screenPermissionFile?: string;
  readonly captureScreen?: (window: BrowserWindow, signal: AbortSignal) => Promise<NativeImage>;
  readonly appUserModelId?: string;
  readonly quitOnAllWindowsClosed: boolean;
  readonly captureProtectionSupported: boolean;
  readonly credentialEncryptionLabel: string;
  readonly credentialEncryptionFile?: string;
  readonly credentialExecutableName?: string;
  readonly microphoneSettingsUrl?: string;
  readonly wasapiHelper?: string;
  readonly speechProcessFile?: string;
  readonly qwenRuntimeFile?: string;
}
