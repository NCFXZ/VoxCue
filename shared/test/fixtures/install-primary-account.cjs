// Offline UI fixture only. Real account/storage boundaries are exercised
// by cloud-account-smoke and the cloud unit suites with their actual transports.
module.exports = (root, { secondAccount = false } = {}) => {
  const path = require('node:path');
  const fs = require('node:fs');
  const { app } = require('electron');
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
  const other = { ...user, id: 'b0000000-0000-4000-8000-000000000002', email: 'other@example.test' };
  const login = (email = user.email) => {
    if (secondAccount && ![user.email, other.email].includes(email)) throw Error('Unknown synthetic account');
    fs.mkdirSync(path.dirname(marker()), { recursive: true });
    fs.writeFileSync(marker(), JSON.stringify(secondAccount && email === other.email ? { id: other.id } : {}));
  };
  const logout = () => fs.rmSync(marker(), { force: true });
  globalThis.primaryAccountFixture = { login, logout };
  const state = () => ({
    configured: true,
    user: fs.existsSync(marker())
      ? (secondAccount && JSON.parse(fs.readFileSync(marker(), 'utf8')).id === other.id ? other : user)
      : null,
    verified: fs.existsSync(marker()),
  });
  CloudAccountClient.prototype.snapshot = state;
  CloudAccountClient.prototype.call = async function (input) {
    if (input.action === 'login') {
      login(input.email);
    } else if (input.action === 'logout') logout();
    else if (input.action !== 'status')
      throw Error('Unexpected synthetic account operation: ' + input.action);
    return { ok: true, state: state() };
  };
  CloudAccountClient.prototype.api = async function (route) {
    throw Error('Unexpected synthetic account route: ' + route);
  };
};
