import type { BrowserWindow, BrowserWindowConstructorOptions, NativeImage } from 'electron';
import type { ApiKeyField, ApiKeyPromptCommand, PresentationCapabilities } from '../contracts/presentation';
import type { PrepareKnowledgeDatabase } from '../backend/knowledge/types';
export type { PrepareKnowledgeDatabase };

/** Native policy only. Business state, IPC and renderer code stay outside this layer. */
export interface DesktopPlatform {
  readonly id: NodeJS.Platform;
  readonly prepareKnowledgeDatabase?: PrepareKnowledgeDatabase;
  readonly accountFetch?: typeof fetch;
  readonly decryptRemoteTlsKey?: (ciphertext: Buffer, signal?: AbortSignal) => Promise<{ certificateHashes: string[]; pfx: Buffer }>;
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
  readonly prepareWindowFade?: (window: BrowserWindow) => Promise<void>;
  readonly promptApiKey?: (
    owner: BrowserWindow, serviceName: string, language: string, signal: AbortSignal,
    field: ApiKeyField, tab?: (backwards: boolean) => void,
  ) => Promise<string | null>;
  readonly controlApiKey?: (owner: BrowserWindow, command: ApiKeyPromptCommand) => void;
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
