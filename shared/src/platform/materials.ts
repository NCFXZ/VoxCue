// Default presentation stays shared for Windows and the generic UI test host.
// Platforms may replace this bounded initialization port at build time.
export { installWebMaterials as installPlatformMaterials } from './webMaterials';
