import path from 'node:path';
import { windows } from '../../../windows/electron/platform';
import { macos } from '../../../macos/electron/platform';
import type { DesktopPlatform } from './types';

export function selectDesktopPlatform(
  platform: NodeJS.Platform = process.platform,
): DesktopPlatform {
  if (platform === 'win32') return windows;
  if (platform === 'darwin') return macos;
  // Unsupported hosts may run static/shared tests; never claim native support.
  return {
    id: platform,
    iconFile: 'public/voxcue.png',
    mainWindowOptions: {},
    quitOnAllWindowsClosed: true,
    captureProtectionSupported: false,
    credentialEncryptionLabel: '系统凭据加密',
  };
}

interface ResourceEnvironment {
  appPath: string;
  resourcesPath: string;
  packaged: boolean;
}

/** Resolves existing locations without changing userData or moving native assets. */
export function desktopResources(environment: ResourceEnvironment, platform: DesktopPlatform) {
  const { appPath, resourcesPath, packaged } = environment;
  const modelRoot = packaged
    ? path.join(resourcesPath, 'models')
    : path.join(appPath, 'local-models');
  return {
    icon: path.join(appPath, platform.iconFile),
    speechModels: path.join(modelRoot, 'speech'),
    ragModel: path.join(modelRoot, 'rag/multilingual-e5-small'),
    audioHelper: platform.wasapiHelper
      ? path.join(
          packaged ? resourcesPath : appPath,
          packaged ? 'native' : 'native/bin',
          platform.wasapiHelper,
        )
      : undefined,
    speechProcess: platform.speechProcessFile
      ? path.join(appPath, 'dist-electron', platform.speechProcessFile)
      : undefined,
    copilotRuntime:
      packaged && platform.packagedCopilotRuntime
        ? path.join(resourcesPath, platform.packagedCopilotRuntime)
        : undefined,
  };
}
