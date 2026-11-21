import { testRoot, electron } from '../../../shared/test/scripts/test-workspace.mjs';
import {
  connectUiAccount,
  installUiAccount,
  closeUiApp,
} from '../../../shared/test/scripts/install-ui-account.mjs';
import { holdDesktopAwake, requireUnlockedDesktop } from './desktop-session.mjs';
import path from 'node:path';
import { writeFile, readFile, stat } from 'node:fs/promises';
import assert from 'node:assert/strict';

const releaseDesktop = holdDesktopAwake();
const destination = path.join(testRoot, 'existing.zip');
await writeFile(destination, 'preserve');
const app = await electron.launch({
  args: ['.'],
  env: {
    ...process.env,
    COPILOT_TEST_USER_DATA: path.join(testRoot, 'profile'),
    VITE_DEV_SERVER_URL: '',
  },
});
const until = async (predicate, label) => {
  const deadline = Date.now() + 10000;
  while (!(await predicate())) {
    requireUnlockedDesktop();
    assert.ok(Date.now() < deadline, label);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
};
try {
  await installUiAccount(app);
  let main = await connectUiAccount(app, await app.firstWindow());
  await app.evaluate(({ app, dialog }, destination) => {
    const require = process
      .getBuiltinModule('module')
      .createRequire(app.getAppPath() + '/package.json');
    const Archive = require(
      app.getAppPath() + '/dist-electron/shared/electron/backend/accountArchive.js',
    ).AccountArchive;
    const call = Archive.prototype.call;
    Archive.prototype.call = async function (...args) {
      const result = await call.apply(this, args);
      if (result.token) globalThis.archiveLifecycleRoot = this.active.root;
      return result;
    };
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: destination });
    const Client = require(
      app.getAppPath() + '/dist-electron/shared/electron/backend/cloud/client.js',
    ).CloudAccountClient;
    const account = Client.prototype.call;
    Client.prototype.call = async function (input) {
      if (input.action === 'logout') {
        globalThis.archiveLogoutWaiting = true;
        await new Promise((resolve) => {
          globalThis.releaseArchiveLogout = resolve;
        });
      }
      return account.call(this, input);
    };
  }, destination);
  const begin = async () => {
    const result = await main.evaluate(() =>
      window.desktop.accountData({ action: 'begin', files: 1 }),
    );
    assert.equal(result.ok, true);
    assert.ok(result.token);
    return { token: result.token, root: await app.evaluate(() => globalThis.archiveLifecycleRoot) };
  };
  let task = await begin();
  await main.reload();
  await main.getByRole('button', { name: '用户菜单', exact: true }).waitFor();
  await until(
    async () => !(await stat(task.root).catch(() => null)),
    'Reload must remove unfinished archive',
  );
  assert.equal(
    (
      await main.evaluate(
        (token) => window.desktop.accountData({ action: 'finish', token }),
        task.token,
      )
    ).ok,
    false,
  );
  task = await begin();
  const closed = main.waitForEvent('close');
  await (await app.browserWindow(main)).evaluate((win) => win.close());
  await closed;
  await until(
    async () => !(await stat(task.root).catch(() => null)),
    'Window close must remove unfinished archive',
  );
  const reopened = app.waitForEvent('window');
  await app.evaluate(({ app }) => app.emit('activate'));
  main = await reopened;
  await main.getByRole('button', { name: '用户菜单', exact: true }).waitFor();
  task = await begin();
  await main.evaluate(() => {
    void window.desktop.cloudAccount({ action: 'logout' });
  });
  await until(
    () => app.evaluate(() => globalThis.archiveLogoutWaiting === true),
    'Logout must reach held account port',
  );
  assert.equal(await stat(task.root).catch(() => null), null);
  await assert.rejects(
    main.evaluate(() => window.desktop.accountData({ action: 'begin', files: 1 })),
    /Error invoking remote method 'account:data': Error: Unauthorized window/,
    'The main-window ownership guard rejects archive IPC during logout',
  );
  const login = app.waitForEvent('window');
  await app.evaluate(() => globalThis.releaseArchiveLogout());
  await (await login).getByRole('heading', { name: '登录 VoxCue', exact: true }).waitFor();
  assert.equal(await readFile(destination, 'utf8'), 'preserve');
  console.log(
    'PASS actual Main archive lifecycle: reload, Mac window close, logout cleanup, rejected late token and rejected new archive during held logout; existing destination preserved.',
  );
} finally {
  await closeUiApp(app);
  releaseDesktop();
}
