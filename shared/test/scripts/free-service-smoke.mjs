import assert from 'node:assert/strict';
import path from 'node:path';
import { testRoot, electron } from './test-workspace.mjs';
import { offlineElectronEntry } from './offline-electron-entry.mjs';
import { installUiAccount, connectUiAccount, closeUiApp } from './install-ui-account.mjs';
import { captureRequested } from './capture-requested.mjs';

const app = await electron.launch({
  args: [await offlineElectronEntry()],
  env: {
    ...process.env,
    COPILOT_TEST_USER_DATA: path.join(testRoot, 'free-service'),
    VITE_DEV_SERVER_URL: '',
    ELECTRON_RUN_AS_NODE: undefined,
  },
});
const errors = [];
try {
  await installUiAccount(app, { speech: true, components: true });
  await app.evaluate(({ app }) => {
    const require = process
      .getBuiltinModule('module')
      .createRequire(app.getAppPath() + '/package.json');
    const base = app.getAppPath() + '/dist-electron/shared/electron/';
    const { CodexUsageRuntime } = require(base + 'backend/chat/codexUsage.js');
    globalThis.freeUsage = {
      rateLimits: {
        primary: { usedPercent: 29, windowDurationMins: 10080 },
        secondary: { usedPercent: 78, windowDurationMins: 300 },
      },
    };
    CodexUsageRuntime.prototype.limits = async () => {
      if (globalThis.holdFreeUsage)
        await new Promise((resolve) => {
          globalThis.finishFreeUsage = resolve;
        });
      return globalThis.freeUsage;
    };
    const { CloudAccountClient } = require(base + 'backend/cloud/client.js');
    const original = CloudAccountClient.prototype.api;
    globalThis.paidCalls = [];
    CloudAccountClient.prototype.api = function (route, ...args) {
      if (/entitlements|activation|usage\/sessions|payments|orders/.test(route))
        globalThis.paidCalls.push(route);
      return original.call(this, route, ...args);
    };
  });
  const main = await connectUiAccount(app, await app.firstWindow());
  main.on('pageerror', (e) => errors.push(e.message));
  await main.locator('.user-info small').getByText('ChatGPT 剩余 22%', { exact: true }).waitFor();
  assert.equal(await main.evaluate(() => 'cloudUsage' in window.desktop), false);
  await main.getByRole('button', { name: '用户菜单', exact: true }).click();
  await main.getByRole('menuitem', { name: '设置', exact: true }).click();
  const settings = main.getByRole('dialog', { name: '设置', exact: true });
  await settings.getByRole('button', { name: 'VoxCue 账号', exact: true }).click();
  assert.equal(await settings.getByText(/面试额度|激活码|兑换|云端数据保留至/).count(), 0);
  await settings.getByRole('button', { name: 'AI 服务', exact: true }).click();
  const headingSize = await settings
    .locator('.settings-usage > header strong')
    .evaluate((e) => getComputedStyle(e).fontSize);
  const serviceSize = await settings
    .locator('.ai-service-label strong')
    .first()
    .evaluate((e) => getComputedStyle(e).fontSize);
  assert.equal(
    headingSize,
    serviceSize,
    'Account quota and provider headings share the same font size',
  );
  await app.evaluate(() => {
    globalThis.holdFreeUsage = true;
  });
  await settings.getByRole('button', { name: '刷新账户额度', exact: true }).click();
  await main
    .locator('.user-info small')
    .getByText('正在读取 AI 服务用量…', { exact: true })
    .waitFor();
  await app.evaluate(() => {
    globalThis.holdFreeUsage = false;
    globalThis.finishFreeUsage();
  });
  await main.locator('.user-info small').getByText('ChatGPT 剩余 22%', { exact: true }).waitFor();

  for (const [weekly, five, expected] of [
    [29, 100, '0%'],
    [29, null, '71%'],
  ]) {
    await app.evaluate(
      (_, values) => {
        globalThis.freeUsage = {
          rateLimits: {
            primary: { usedPercent: values.weekly, windowDurationMins: 10080 },
            ...(values.five === null
              ? {}
              : { secondary: { usedPercent: values.five, windowDurationMins: 300 } }),
          },
        };
      },
      { weekly, five },
    );
    await settings.getByRole('button', { name: '刷新账户额度', exact: true }).click();
    await main
      .locator('.user-info small')
      .getByText('ChatGPT 剩余 ' + expected, { exact: true })
      .waitFor();
    for (const dark of [false, true]) {
      await main.evaluate(
        (value) => document.documentElement.classList.toggle('dark', value),
        dark,
      );
      const neutral = await main.locator('.user-info small').evaluate((node) => {
        const probe = document.createElement('span');
        probe.style.color = 'var(--danger)';
        document.body.append(probe);
        const danger = getComputedStyle(probe).color;
        probe.remove();
        return (
          getComputedStyle(node).color !== danger && !node.classList.contains('interview-quota-low')
        );
      });
      assert.equal(neutral, true);
      await captureRequested(main, `free-${expected}-${dark ? 'dark' : 'light'}`);
    }
  }
  await settings.getByRole('button', { name: '关闭设置', exact: true }).click();
  await main.locator('.interview-start-trigger').click();
  const start = main.getByRole('dialog', { name: '开始面试', exact: true });
  await start.getByText('AI 服务剩余用量', { exact: true }).waitFor();
  assert.equal(await start.getByText(/剩余面试时长|面试额度|兑换/).count(), 0);
  await captureRequested(main, 'free-interview-start');
  const opened = app.waitForEvent('window');
  await start.getByRole('button', { name: '确认开始', exact: true }).click();
  const floating = await opened;
  await floating.getByRole('textbox', { name: '面试提问', exact: true }).waitFor();
  assert.equal(await floating.getByText(/面试额度|剩余面试时长/).count(), 0);
  await floating.getByRole('button', { name: '结束面试', exact: true }).click();
  const closed = floating.waitForEvent('close');
  await floating.getByRole('button', { name: '确认结束面试', exact: true }).click();
  await closed;
  await main.getByRole('button', { name: '用户菜单', exact: true }).click();
  await main.getByRole('menuitem', { name: '设置', exact: true }).click();
  await settings.getByRole('button', { name: 'AI 服务', exact: true }).click();
  await app.evaluate(() => {
    globalThis.freeUsage = {};
  });
  await settings.getByRole('button', { name: '刷新账户额度', exact: true }).click();
  await main
    .locator('.user-info small')
    .getByText('AI 服务用量暂不可用', { exact: true })
    .waitFor();
  await settings.getByRole('button', { name: '断开连接', exact: true }).click();
  await main.locator('.user-info small').getByText('未连接 AI 服务', { exact: true }).waitFor();
  assert.deepEqual(await app.evaluate(() => globalThis.paidCalls), []);
  assert.deepEqual(errors, []);
  console.log(
    'PASS free client UI: five-hour priority including 0%, weekly fallback, neutral light/dark avatar, no exchange/time UI or IPC, actual interview start/end without billing requests; synthetic accounts/audio only.',
  );
} finally {
  await closeUiApp(app);
}
