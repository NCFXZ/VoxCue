// Offline UI fixture only. Real account/storage/lease boundaries are exercised
// by cloud-account-smoke and the cloud unit suites with their actual transports.
module.exports = (root) => {
  const path = require('node:path');
  const fs = require('node:fs');
  const { app, BrowserWindow } = require('electron');
  const { ChatGPTAuthService } = require(
    path.join(root, 'dist-electron/shared/electron/backend/auth/service.js'),
  );
  const originalSession = ChatGPTAuthService.prototype.session;
  const { CloudAccountClient } = require(
    path.join(root, 'dist-electron/shared/electron/backend/cloud/client.js'),
  );
  const marker = () => {
    const profile = path.resolve(app.getPath('userData'));
    let parent = profile;
    while (path.dirname(parent) !== parent) {
      if (
        path.basename(parent).startsWith('voxcue-test-run-') &&
        fs.existsSync(path.join(parent, '.voxcue-test-owner.json'))
      )
        return path.join(profile, 'synthetic-primary.json');
      parent = path.dirname(parent);
    }
    throw Error('Synthetic primary account requires an owned temporary profile');
  };
  const user = {
    id: 'a0000000-0000-4000-8000-000000000001',
    email: 'synthetic@example.test',
    createdAt: 1,
  };
  const login = () => {
    fs.mkdirSync(path.dirname(marker()), { recursive: true });
    fs.writeFileSync(marker(), '{}');
  };
  globalThis.primaryAccountFixture = { login };
  const state = () => ({
    configured: true,
    user: fs.existsSync(marker()) ? user : null,
    verified: fs.existsSync(marker()),
  });
  CloudAccountClient.prototype.snapshot = state;
  CloudAccountClient.prototype.call = async function (input) {
    if (
      input.action === 'status' &&
      !BrowserWindow.getAllWindows().length &&
      ChatGPTAuthService.prototype.session !== originalSession &&
      (await ChatGPTAuthService.prototype.session.call({}))
    )
      login();
    if (input.action === 'login') {
      login();
    } else if (input.action === 'logout') fs.rmSync(marker(), { force: true });
    else if (input.action !== 'status')
      throw Error('Unexpected synthetic account operation: ' + input.action);
    return { ok: true, state: state() };
  };
  CloudAccountClient.prototype.api = async function (route, method, body) {
    if (route === '/v1/entitlements')
      return {
        permanent: true,
        remainingSeconds: null,
        zeroSince: null,
        cloudDeleteAfter: null,
        cloudPurgePending: false,
      };
    if (route.startsWith('/v1/usage/sessions'))
      return {
        id: 'b0000000-0000-4000-8000-000000000001',
        sequence: body?.sequence ?? 0,
        state: route.endsWith('/stop') ? 'stopped' : 'active',
        leaseRemainingMs: 120000,
        canContinue: !route.endsWith('/stop'),
        permanent: true,
        remainingSeconds: null,
      };
    throw Error('Unexpected synthetic account route: ' + route);
  };
};
