import type { DesktopPlatform } from '../../shared/electron/platform/types';
import { accountFetch } from './accountNetwork';

// Apple Silicon native and packaged resource strategy.
export const macos: DesktopPlatform = {
  id: 'darwin',
  accountFetch,
  qwenRuntimeFile: 'qwen/voxcue-qwen',
  updateDriverFile: 'macos/electron/updates/driver.js',
  iconFile: 'public/voxcue.png',
  mainWindowOptions: { vibrancy: 'sidebar', visualEffectState: 'followWindow' },
  presentation: {
    frostedTransparency: true,
    nativeTheme: true,
    screenCapturePermission: true,
    interviewMousePassthrough: true,
    interviewIconVisibility: true,
  },
  presentationFile: 'macos/electron/presentation.js',
  audioHelper: 'VoxCue.Audio',
  speechProcessFile: 'macos/electron/speech/process.js',
  microphoneSettingsUrl:
    'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone',
  systemAudioSettingsUrl:
    'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
  screenCaptureSettingsUrl:
    'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
  screenPermissionFile: 'VoxCue.ScreenPermission.node',
  quitOnAllWindowsClosed: false,
  captureProtectionSupported: false,
  credentialEncryptionLabel: 'macOS 钥匙串',
  credentialEncryptionFile: 'macos/electron/credentials.js',
  credentialExecutableName: 'VoxCue',
};
