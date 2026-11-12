import { describe, expect, it, vi } from 'vitest';
import {
  runtimeEnvironment,
  restrictSessionPermissions,
  trustedDesktopPage,
} from '../../electron/runtimePolicy';

describe('packaged runtime and Chromium privileges', () => {
  it('ignores every development override in packaged applications', () => {
    expect(
      runtimeEnvironment(true, {
        VITE_DEV_SERVER_URL: 'https://attacker.example',
        VOXCUE_ACCOUNT_API: 'https://attacker.example',
        VOXCUE_ACCOUNT_ALLOW_LOCAL: '1',
        COPILOT_TEST_USER_DATA: 'untrusted-profile',
      }),
    ).toEqual({ accountOrigin: 'https://accounts.voxcue.com.cn' });
  });
  it('allows isolated development inputs and only loopback page servers', () => {
    expect(
      runtimeEnvironment(false, {
        VITE_DEV_SERVER_URL: 'http://127.0.0.1:5173',
        COPILOT_TEST_USER_DATA: 'owned-profile',
        VOXCUE_ACCOUNT_ALLOW_LOCAL: '1',
      }),
    ).toMatchObject({
      devServerUrl: 'http://127.0.0.1:5173',
      userData: 'owned-profile',
      allowLocalAccount: true,
    });
    for (const value of [
      'https://attacker.example',
      'file:///tmp/page',
      'http://x@127.0.0.1',
      'http://127.0.0.1/?x',
    ])
      expect(() => runtimeEnvironment(false, { VITE_DEV_SERVER_URL: value })).toThrow();
  });
  it('only permits clipboard writes from its own main frame, never capture or remote pages', () => {
    let check: any, request: any;
    const session = {
      setPermissionCheckHandler: (handler: any) => (check = handler),
      setPermissionRequestHandler: (handler: any) => (request = handler),
    };
    const index = process.platform === 'win32' ? 'C:\\owned\\index.html' : '/owned/index.html';
    const own = new URL(
      process.platform === 'win32' ? 'file:///C:/owned/index.html' : 'file:///owned/index.html',
    ).href;
    restrictSessionPermissions(session as any, index);
    const contents = { getURL: () => own + '#interview' };
    const details = { isMainFrame: true, requestingUrl: own };
    expect(check(contents, 'clipboard-sanitized-write', 'null', details)).toBe(true);
    for (const permission of [
      'media',
      'display-capture',
      'notifications',
      'clipboard-read',
      'geolocation',
    ]) {
      expect(check(contents, permission, 'null', details)).toBe(false);
      const callback = vi.fn();
      request(contents, permission, callback, details);
      expect(callback).toHaveBeenCalledWith(false);
    }
    expect(
      check(contents, 'clipboard-sanitized-write', 'null', { ...details, isMainFrame: false }),
    ).toBe(false);
    expect(
      check(contents, 'clipboard-sanitized-write', 'null', {
        ...details,
        requestingUrl: 'https://attacker.example/',
      }),
    ).toBe(false);
    expect(trustedDesktopPage(own + '?x', index)).toBe(false);
    expect(trustedDesktopPage(own + '.extra', index)).toBe(false);
  });
});
