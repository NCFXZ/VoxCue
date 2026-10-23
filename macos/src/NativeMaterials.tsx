import './sidebarGlass';

export function installPlatformMaterials() {
  if (window.desktop?.presentation?.liquidGlass !== true)
    throw Error('VoxCue for Mac requires macOS 26 or later and its Liquid Glass binding.');
  // Each native adapter owns its observer cleanup and HMR lifecycle.
  return () => {};
}
