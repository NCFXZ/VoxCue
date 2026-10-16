import type { DesktopPlatform } from '../../shared/electron/platform/types';

export const windows: DesktopPlatform = {
  id: 'win32',
  iconFile: 'public/voxcue.ico',
  mainWindowOptions: { backgroundMaterial: 'acrylic' },
  appUserModelId: 'com.voxcue.desktop',
  quitOnAllWindowsClosed: true,
  captureProtectionSupported: true,
  credentialEncryptionLabel: 'Windows 凭据加密',
  microphoneSettingsUrl: 'ms-settings:privacy-microphone',
  wasapiHelper: 'VoxCue.Audio.exe',
  speechProcessFile: 'windows/electron/speech/process.js',
  packagedCopilotRuntime:
    'app.asar.unpacked/node_modules/@github/copilot-sdk-win32-x64/prebuilds/win32-x64/copilot-runtime.exe',
};
