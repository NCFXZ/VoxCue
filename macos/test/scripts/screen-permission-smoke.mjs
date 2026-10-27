import { testRoot, electron } from '../../../shared/test/scripts/test-workspace.mjs';
import { mkdir, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {
  connectUiAccount,
  installUiAccount,
  closeUiApp,
} from '../../../shared/test/scripts/install-ui-account.mjs';

await mkdir(path.join(testRoot, 'test/results'), { recursive: true });
const output = await mkdtemp(path.resolve(path.join(testRoot, 'test/results/screen-permission-')));
const env = { ...process.env, COPILOT_TEST_USER_DATA: output, VITE_DEV_SERVER_URL: '' };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: ['.'], env });
const processHandle = app.process();
const checks = [],
  errors = [];
try {
  const login = await app.firstWindow();
  await login.getByRole('heading', { name: '登录 VoxCue', exact: true }).waitFor();
  const unauthorized = await login.evaluate(async () => {
    try {
      await window.desktop.screenCapturePermission('request');
      return '';
    } catch (error) {
      return String(error);
    }
  });
  assert.match(unauthorized, /Unauthorized window/);
  const native = await app.evaluate(async ({ app, systemPreferences }) => {
    const require = process
      .getBuiltinModule('module')
      .createRequire(app.getAppPath() + '/package.json');
    const binding = require(app.getAppPath() + '/native/bin/VoxCue.ScreenPermission.node');
    const granted = binding.preflight();
    if (typeof granted !== 'boolean') throw Error('Invalid native preflight');
    // Do not open a real OS prompt or change TCC during an automated test.
    const requestResult = granted ? await binding.request() : null;
    return {
      granted,
      electronStatus: systemPreferences.getMediaAccessStatus('screen'),
      requestExercisedWithoutNewAuthorization: granted,
      requestResult,
      napi: process.versions.napi,
    };
  });
  if (native.granted) assert.equal(native.requestResult, true);
  checks.push('实际 arm64 Node-API 在 Electron 主进程读取屏幕授权；未授权时不自动请求');
  await installUiAccount(app, { speech: true, components: true });
  await app.evaluate(({ app, desktopCapturer }) => {
    if (!app.getPath('userData').includes('/test/results/screen-permission-'))
      throw Error('Non-test profile');
    const require = process
      .getBuiltinModule('module')
      .createRequire(app.getAppPath() + '/package.json');
    const root = app.getAppPath() + '/dist-electron/';
    const inventory = [
      { id: 'output', name: 'Synthetic output', source: 'system', default: true },
      { id: 'input', name: 'Synthetic microphone', source: 'microphone', default: true },
    ];
    globalThis.screenFixture = {
      granted: false,
      notRequired: false,
      grantOnRequest: true,
      requests: 0,
      settings: 0,
      captures: 0,
    };
    const { ScreenPermission } = require(root + 'macos/electron/screenPermission.js');
    const original = ScreenPermission.prototype.call;
    ScreenPermission.prototype.call = function (action) {
      if (globalThis.screenFixture.notRequired) {
        if (action !== 'check') throw Error('Permission request is not required');
        return { status: 'not-required', message: '当前捕获方式无需单独申请权限。' };
      }
      this.dependencies = {
        binding: () => ({
          preflight: () => globalThis.screenFixture.granted,
          request: async () => {
            globalThis.screenFixture.requests++;
            globalThis.screenFixture.granted = globalThis.screenFixture.grantOnRequest;
            return globalThis.screenFixture.granted;
          },
        }),
        mediaStatus: () => (globalThis.screenFixture.granted ? 'granted' : 'denied'),
        openSettings: async () => {
          globalThis.screenFixture.settings++;
        },
      };
      return original.call(this, action);
    };
    require(root + 'macos/electron/speech/access.js').InterviewAccess.prototype.check = async (
      options,
    ) => ({
      ready: !globalThis.screenFixture.audioDenied,
      devices: inventory,
      checks: options.sources.map((source) => ({
        source,
        status:
          globalThis.screenFixture.audioDenied && source === 'microphone' ? 'denied' : 'granted',
        message:
          globalThis.screenFixture.audioDenied && source === 'microphone'
            ? '所选合成麦克风未获授权，请检查音频权限设置。'.repeat(5)
            : source === 'system'
              ? '系统音频可用'
              : '麦克风可用',
      })),
    });
    require(root + 'shared/electron/backend/speech/host.js').SpeechHost.prototype.call = async (
      call,
    ) => ({
      state: call.op === 'start' ? 'running' : 'idle',
      model: 'Synthetic',
      ...(call.op === 'devices' ? { devices: inventory } : {}),
    });
    desktopCapturer.getSources = async () => {
      globalThis.screenFixture.captures++;
      throw Error('Permission flows must not capture images');
    };
  });
  const page = await connectUiAccount(app, login);
  page.on('pageerror', (error) => errors.push(error.message));
  await page.getByRole('textbox', { name: '聊天消息', exact: true }).waitFor();
  const start = () => page.getByRole('button', { name: '开始面试', exact: true }).click();
  await start();
  const dialog = page.getByRole('dialog', { name: '开始面试' });
  await dialog
    .getByLabel('屏幕捕获权限检查', { exact: true })
    .getByText('可继续纯语音面试', { exact: false })
    .waitFor();
  assert.equal(
    await dialog.getByRole('button', { name: '确认开始', exact: true }).isEnabled(),
    true,
  );
  assert.equal(await app.evaluate(() => globalThis.screenFixture.requests), 0);
  const preview = await dialog.screenshot({ animations: 'disabled', type: 'jpeg', quality: 75 });
  if (process.argv.includes('--preview'))
    console.log('VOXCUE_ACCESS_PREVIEW:' + preview.toString('base64'));
  const interviewOpened = app.waitForEvent('window');
  await dialog.getByRole('button', { name: '确认开始', exact: true }).click();
  const interview = await interviewOpened;
  await interview.waitForFunction(() => !!window.desktop);
  const closed = interview.waitForEvent('close');
  await interview.evaluate(() => window.desktop.confirmInterviewEnd());
  await closed;
  checks.push('屏幕权限单独显示；未授权仍可通过真实主进程打开纯语音浮窗，不截图');
  await start();
  assert.equal(await dialog.getByRole('button', { name: '前往面试设置', exact: true }).count(), 0);
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('button', { name: '用户菜单', exact: true }).click();
  await page.getByRole('menuitem', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: '面试设置', exact: true }).click();
  const panel = page.getByRole('region', { name: '屏幕捕获权限', exact: true });
  assert.equal(await page.getByRole('button', { name: '刷新设备', exact: true }).count(), 0);
  assert.equal(
    (await page.getByRole('button', { name: '麦克风设备', exact: true }).boundingBox()).height,
    36,
  );
  await panel
    .getByRole('status', { name: '屏幕捕获权限状态' })
    .filter({ hasText: '未允许' })
    .waitFor();
  assert.equal(await app.evaluate(() => globalThis.screenFixture.requests), 0);
  await panel.screenshot({ animations: 'disabled' });
  await panel.getByRole('button', { name: '申请权限', exact: true }).click();
  await panel
    .getByRole('status', { name: '屏幕捕获权限状态' })
    .filter({ hasText: '已允许' })
    .waitFor();
  assert.equal(await app.evaluate(() => globalThis.screenFixture.requests), 1);
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.waitForFunction(() => document.documentElement.classList.contains('dark'));
  await panel.screenshot({ animations: 'disabled' });
  checks.push('面试设置只有点击申请才发起请求；查询结果驱动状态，浅深主题可见（合成状态）');
  await app.evaluate(() => {
    globalThis.screenFixture.granted = false;
    globalThis.screenFixture.grantOnRequest = false;
  });
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await panel
    .getByRole('status', { name: '屏幕捕获权限状态' })
    .filter({ hasText: '未允许' })
    .waitFor();
  await panel.getByRole('button', { name: '申请权限', exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector('.screen-capture-settings button')?.disabled === false,
  );
  assert.equal(await app.evaluate(() => globalThis.screenFixture.settings), 1);
  for (const value of [{ url: 'https://example.com' }, 'grant', null]) {
    const message = await page.evaluate(async (action) => {
      try {
        await window.desktop.screenCapturePermission(action);
        return '';
      } catch (error) {
        return String(error);
      }
    }, value);
    assert.match(message, /Invalid request/);
  }
  const fixture = await app.evaluate(() => globalThis.screenFixture);
  assert.equal(fixture.requests, 2);
  assert.equal(fixture.captures, 0);
  await app.evaluate(() => {
    globalThis.screenFixture.notRequired = true;
  });
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await panel
    .getByRole('status', { name: '屏幕捕获权限状态' })
    .filter({ hasText: '无需单独授权' })
    .waitFor();
  assert.equal(await panel.getByRole('button').count(), 0);
  await panel.getByRole('heading', { name: '屏幕捕获', exact: true }).waitFor();
  await panel.getByText('当前捕获方式无需单独申请权限。', { exact: false }).waitFor();
  await page.getByRole('button', { name: '关闭设置', exact: true }).click();
  // Settings now opens from the user menu; starting again rechecks permissions.
  await start();
  await dialog.waitFor();
  const screenStatus = dialog.getByLabel('屏幕捕获权限检查', { exact: true });
  await screenStatus.getByText('无需单独授权', { exact: true }).waitFor();
  assert.equal(await screenStatus.getByText('截图需授权', { exact: false }).count(), 0);
  assert.equal(
    await dialog.getByRole('button', { name: '确认开始', exact: true }).isEnabled(),
    true,
  );
  assert.equal(await app.evaluate(() => globalThis.screenFixture.requests), 2);
  assert.equal(await app.evaluate(() => globalThis.screenFixture.captures), 0);
  await app.evaluate(({ BrowserWindow }) => {
    globalThis.screenFixture.audioDenied = true;
    BrowserWindow.getAllWindows()
      .find((window) => window.isVisible())
      .setContentSize(960, 680);
  });
  await dialog.getByRole('button', { name: '重新检查', exact: true }).click();
  await dialog
    .getByText('所选合成麦克风未获授权，请检查音频权限设置。'.repeat(5), { exact: true })
    .waitFor();
  assert.equal(
    await dialog.getByRole('button', { name: '确认开始', exact: true }).isDisabled(),
    true,
  );
  assert.equal(
    await dialog.locator('.interview-access').evaluate(
      (section) =>
        section.scrollWidth <= section.clientWidth &&
        [...section.querySelectorAll('.interview-access-row')].every((row) => {
          const [label, status] = row.children;
          return label.getBoundingClientRect().right + 12 <= status.getBoundingClientRect().left;
        }),
    ),
    true,
  );
  assert.deepEqual(errors, []);
  checks.push('返回后刷新/撤销可见，未生效可打开固定设置；非法 IPC 被拒绝，无屏幕捕获');
  checks.push(
    '合成 not-required 状态不显示申请按钮或错误授权提示，开场仍可继续；不替代 Windows 原生验收',
  );
  await closeUiApp(app);
  const report = {
    status: 'passed',
    native,
    checks,
    fixture,
    errors,
    actualScreenPixelsStored: false,
  };
  await console.log(JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ status: 'passed', output, checks, native }));
} catch (error) {
  await console.log(
    JSON.stringify({ status: 'failed', error: String(error), checks, errors }, null, 2),
  );
  throw error;
} finally {
  if (processHandle.exitCode === null) processHandle.kill();
}
