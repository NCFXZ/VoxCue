import type { DesktopPlatform } from '../../shared/electron/platform/types';

export const windows: DesktopPlatform = {
  id: 'win32',
  iconFile: 'public/voxcue.ico',
  mainWindowOptions: { backgroundMaterial: 'acrylic' },
  presentation: {
    frostedTransparency: true,
    nativeTheme: true,
    screenCapturePermission: true,
    interviewMousePassthrough: true,
    interviewIconVisibility: true,
  },
  presentationFile: 'windows/electron/presentation.js',
  appUserModelId: 'com.voxcue.desktop',
  quitOnAllWindowsClosed: true,
  captureProtectionSupported: true,
  credentialEncryptionLabel: 'Windows 凭据加密',
  microphoneSettingsUrl: 'ms-settings:privacy-microphone',
  wasapiHelper: 'VoxCue.Audio.exe',
  speechProcessFile: 'windows/electron/speech/process.js',
};
