import { app } from 'electron';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { createUpdateDriver as createStockDriver } from '../../shared/electron/backend/updates/driver';
import { releaseRepository } from '../../shared/electron/backend/updates/releases';
import {
  signedWindowsUpdate,
  validateSignedWindowsUpdate,
  windowsUpdateKey,
} from '../../shared/electron/backend/updates/windowsManifest';

export function createUpdateDriver() {
  if (!app.isPackaged || process.platform !== 'win32' || process.arch !== 'x64')
    throw Error('Unsupported Windows update host');
  if (process.windowsStore || !existsSync(path.join(process.resourcesPath, 'app-update.yml')))
    return undefined;
  const config = JSON.parse(
    readFileSync(
      path.join(app.getAppPath(), 'dist-electron/windows/electron/voxcue-update.json'),
      'utf8',
    ),
  );
  if (config.protocol !== 1 || config.repository !== releaseRepository)
    throw Error('Invalid Windows update configuration');
  windowsUpdateKey(config.publicKey);
  return createStockDriver(true, {
    // Old unsigned caches remain untouched and cannot become trusted by migration.
    cacheDirectory: path.join(app.getPath('userData'), 'updates/windows-ed25519-v1'),
    mapInfo: (candidate, metadata) => signedWindowsUpdate(metadata, candidate, config.publicKey),
    validate: (value, target) => validateSignedWindowsUpdate(value, target, config.publicKey),
  });
}
