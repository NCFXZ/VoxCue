import type { DesktopPlatform } from '../../shared/electron/platform/types';

// Preserve the frameless shared UI. Native materials/audio/runtime packaging
// require a later Mac implementation and hardware validation.
export const macos: DesktopPlatform = {
  id: 'darwin',
  iconFile: 'public/voxcue.png',
  mainWindowOptions: {},
  quitOnAllWindowsClosed: false,
  captureProtectionSupported: false,
  credentialEncryptionLabel: 'macOS 钥匙串',
};
