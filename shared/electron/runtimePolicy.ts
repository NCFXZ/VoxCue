import type { Session } from 'electron';
import { pathToFileURL } from 'node:url';

export function runtimeEnvironment(packaged: boolean, env: NodeJS.ProcessEnv) {
  if (packaged) return { accountOrigin: 'https://accounts.voxcue.com.cn' };
  const devServerUrl = env.VITE_DEV_SERVER_URL || undefined;
  if (devServerUrl) {
    const url = new URL(devServerUrl);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw Error('Development pages require a loopback server');
  }
  return {
    devServerUrl,
    userData: env.COPILOT_TEST_USER_DATA || undefined,
    accountOrigin: env.VOXCUE_ACCOUNT_API ?? 'https://accounts.voxcue.com.cn',
    allowLocalAccount: env.VOXCUE_ACCOUNT_ALLOW_LOCAL === '1',
  };
}

export function trustedDesktopPage(value: string, indexFile: string, devServerUrl?: string) {
  try {
    const url = new URL(value);
    url.hash = '';
    if (url.search || url.username || url.password) return false;
    return url.href === new URL(devServerUrl || pathToFileURL(indexFile).href).href;
  } catch {
    return false;
  }
}

/** Audio and screenshots use controlled native ports, never Chromium capture. */
export function restrictSessionPermissions(target: Session, indexFile: string, devUrl?: string) {
  target.setPermissionCheckHandler(
    (contents, permission, _origin, details) =>
      permission === 'clipboard-sanitized-write' &&
      !!contents &&
      details.isMainFrame === true &&
      trustedDesktopPage(contents.getURL(), indexFile, devUrl) &&
      trustedDesktopPage(details.requestingUrl ?? '', indexFile, devUrl),
  );
  target.setPermissionRequestHandler((contents, permission, callback, details) => {
    callback(
      permission === 'clipboard-sanitized-write' &&
        details.isMainFrame === true &&
        trustedDesktopPage(contents.getURL(), indexFile, devUrl) &&
        trustedDesktopPage(details.requestingUrl ?? '', indexFile, devUrl),
    );
  });
}
