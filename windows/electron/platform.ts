import type { DesktopPlatform } from '../../shared/electron/platform/types';
import { accountFetch } from './accountNetwork';
import { captureScreen } from './screenshot';

export const windows: DesktopPlatform = {
  id: 'win32',
  accountFetch,
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
  updateDriverFile: 'windows/electron/updates.js',
  appUserModelId: 'com.voxcue.desktop',
  quitOnAllWindowsClosed: true,
  captureProtectionSupported: true,
  captureScreen,
  credentialEncryptionLabel: 'Windows 凭据加密',
  microphoneSettingsUrl: 'ms-settings:privacy-microphone',
  wasapiHelper: 'VoxCue.Audio.exe',
  speechProcessFile: 'windows/electron/speech/process.js',
};
