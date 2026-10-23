import path from 'node:path';
import type { DesktopPlatform } from './types';

export function selectDesktopPlatform(
  platform: NodeJS.Platform = process.platform,
): DesktopPlatform {
  // Load only the selected installation. Static imports would pull both platforms
  // into TypeScript's emit graph even when the other directory is excluded.
  const directory = platform === 'win32' ? 'windows' : platform === 'darwin' ? 'macos' : undefined;
  if (directory) {
    const module = require(path.join(__dirname, '../../..', directory, 'electron/platform'));
    const selected: DesktopPlatform = module[directory];
    if (selected?.id !== platform)
      throw Error('Desktop platform does not match this installation.');
    return selected;
  }
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

/** Development installs own their runtime; portable weights and PNGs stay shared. */
export function desktopResources(environment: ResourceEnvironment, platform: DesktopPlatform) {
  const { appPath, resourcesPath, packaged } = environment;
  const sharedPath = path.resolve(appPath, '../shared');
  const modelRoot = packaged
    ? path.join(resourcesPath, 'models')
    : path.join(sharedPath, 'local-models');
  return {
    icon: path.join(appPath, platform.iconFile),
    // Browser branding always uses the shared PNG, including Windows whose
    // native window icon is ICO. Vite copies this file into packaged dist/.
    brandLogo: path.join(
      packaged ? appPath : sharedPath,
      packaged ? 'dist' : 'public',
      'voxcue.png',
    ),
    speechModels: path.join(modelRoot, 'speech'),
    presentationBinding: platform.presentationBindingFile
      ? path.join(
          packaged ? resourcesPath : appPath,
          packaged ? 'native' : 'native/bin',
          platform.presentationBindingFile,
        )
      : undefined,
    qwenModels: undefined as string | undefined,
    qwenRuntime: platform.qwenRuntimeFile
      ? path.join(
          packaged ? resourcesPath : appPath,
          packaged ? 'native' : 'native/bin',
          platform.qwenRuntimeFile,
        )
      : undefined,
    ragModel: path.join(modelRoot, 'rag/multilingual-e5-small'),
    screenPermission: platform.screenPermissionFile
      ? path.join(
          packaged ? resourcesPath : appPath,
          packaged ? 'native' : 'native/bin',
          platform.screenPermissionFile,
        )
      : undefined,
    audioHelper:
      (platform.audioHelper ?? platform.wasapiHelper)
        ? path.join(
            packaged ? resourcesPath : appPath,
            packaged ? 'native' : 'native/bin',
            (platform.audioHelper ?? platform.wasapiHelper)!,
          )
        : undefined,
    speechProcess: platform.speechProcessFile
      ? path.join(appPath, 'dist-electron', platform.speechProcessFile)
      : undefined,
  };
}
