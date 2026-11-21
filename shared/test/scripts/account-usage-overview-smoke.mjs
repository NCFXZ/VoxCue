import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdir, writeFile } from 'node:fs/promises';
import workspace from '../../scripts/workspace.mjs';
import { testRoot, electron } from './test-workspace.mjs';
import { offlineElectronEntry } from './offline-electron-entry.mjs';
import { installUiAccount, connectUiAccount, closeUiApp } from './install-ui-account.mjs';
import { captureRequested } from './capture-requested.mjs';

const base = path.join(workspace.platformRoot, 'dist-electron/shared/electron');
const { chatGPTAccountUsage } = workspace.platformRequire(path.join(base, 'backend/chat/quota.js'));
const { copilotAccountUsage } = workspace.platformRequire(
  path.join(base, 'backend/copilot/quota.js'),
);
const output = process.argv.find((value) => value.startsWith('--screenshots='))?.slice(14);
if (output) {
  assert.ok(path.resolve(output).startsWith(path.resolve(os.tmpdir()) + path.sep));
  assert.ok(path.basename(output).startsWith('voxcue-usage-matrix-'));
  await mkdir(output, { recursive: true });
}
const states = [71, 20, 19, 0];
const cases = [];
const title = (provider) => `${provider === 'chatgpt' ? 'ChatGPT' : 'Copilot'} 用量`;
function chatUsage(five, week) {
  return chatGPTAccountUsage({
    rateLimits: {
      ...(five === null ? {} : { primary: { usedPercent: 100 - five, windowDurationMins: 300 } }),
      ...(week === null
        ? {}
        : { secondary: { usedPercent: 100 - week, windowDurationMins: 10080 } }),
    },
  });
}
function addChat(five, week, group, id, label) {
  cases.push({
    provider: 'chatgpt',
    id,
    label,
    group,
    title: title('chatgpt'),
    usage: chatUsage(five, week),
    values:
      five === null
        ? [{ text: `剩余 ${week}%`, low: week < 20 }]
        : [
            { text: `5小时 ${five}%`, low: five < 20 },
            ...(week === null ? [] : [{ text: `每周 ${week}%`, low: week < 20 }]),
          ],
  });
}
for (const five of states)
  for (const week of states)
    addChat(five, week, '双周期组合', `both-${five}-${week}`, `5小时 ${five}% / 每周 ${week}%`);
for (const value of states) {
  addChat(value, null, '单周期', `five-only-${value}`, `仅5小时 ${value}%`);
  addChat(null, value, '单周期', `week-only-${value}`, `仅每周 ${value}%`);
}
cases.push(
  {
    provider: 'chatgpt',
    id: 'loading',
    label: '正在读取，隐藏旧数值',
    group: '异常与连接',
    title: title('chatgpt'),
    usage: chatUsage(71, 71),
    loading: true,
    text: '正在读取…',
  },
  {
    provider: 'chatgpt',
    id: 'read-failed',
    label: '读取失败，不伪造0%',
    group: '异常与连接',
    title: 'AI 服务用量',
    fail: true,
    text: 'AI 服务用量暂不可用',
  },
  {
    provider: 'chatgpt',
    id: 'empty',
    label: '未返回额度信息',
    group: '异常与连接',
    title: 'AI 服务用量',
    usage: chatGPTAccountUsage({}),
    text: 'AI 服务用量暂不可用',
  },
);
for (const value of states)
  cases.push({
    provider: 'copilot',
    id: `copilot-${value}`,
    label: `Copilot 剩余 ${value}%`,
    group: 'Copilot',
    title: title('copilot'),
    usage: copilotAccountUsage({
      planTier: 'free',
      snapshots: {
        chat: {
          entitlementRequests: 100,
          usedRequests: 100 - value,
          remainingPercentage: value,
          hasQuota: true,
        },
      },
    }),
    values: [{ text: `剩余 ${value}%`, low: value < 20 }],
  });
cases.push(
  {
    provider: 'copilot',
    id: 'copilot-unlimited',
    label: 'Copilot 不限量',
    group: 'Copilot',
    title: title('copilot'),
    usage: copilotAccountUsage({
      snapshots: {
        chat: {
          entitlementRequests: -1,
          usedRequests: 0,
          isUnlimitedEntitlement: true,
          hasQuota: true,
        },
      },
    }),
    values: [{ text: '不限量', low: false }],
  },
  {
    provider: 'copilot',
    id: 'copilot-unknown',
    label: 'Copilot 用量未知',
    group: 'Copilot',
    title: title('copilot'),
    usage: copilotAccountUsage({ snapshots: { chat: {} } }),
    values: [{ text: '用量暂不可用', low: false }],
  },
);
assert.equal(cases.length + 1, 34);

const app = await electron.launch({
  args: [await offlineElectronEntry()],
  env: {
    ...process.env,
    COPILOT_TEST_USER_DATA: path.join(testRoot, 'usage-overview'),
    VITE_DEV_SERVER_URL: '',
    ELECTRON_RUN_AS_NODE: undefined,
  },
});
const records = [];
const errors = [];
try {
  await installUiAccount(app, { speech: true, components: true });
  await app.evaluate(
    ({ app }, initial) => {
      const require = process
        .getBuiltinModule('module')
        .createRequire(app.getAppPath() + '/package.json');
      const base = app.getAppPath() + '/dist-electron/shared/electron/';
      const { ChatGPTService } = require(base + 'backend/chat/service.js');
      const { CopilotChatService } = require(base + 'backend/copilot/service.js');
      const { CopilotAuthService } = require(base + 'backend/copilot/auth.js');
      globalThis.overviewUsage = initial;
      globalThis.overviewHold = {};
      globalThis.overviewFail = {};
      globalThis.overviewFinish = {};
      const read = (provider) => async () => {
        if (globalThis.overviewHold[provider])
          await new Promise((resolve) => {
            globalThis.overviewFinish[provider] = resolve;
          });
        if (globalThis.overviewFail[provider]) throw Error('合成用量读取失败');
        return globalThis.overviewUsage[provider];
      };
      ChatGPTService.prototype.accountUsage = read('chatgpt');
      CopilotChatService.prototype.accountUsage = read('copilot');
      const session = () =>
        globalThis.overviewCopilotActive
          ? {
              mode: 'copilot',
              user: { id: 'synthetic-copilot', name: 'Synthetic', email: '' },
              expiresAt: Date.now() + 3600000,
            }
          : null;
      CopilotAuthService.prototype.verifiedSession = async () => session();
      CopilotAuthService.prototype.signIn = async () => {
        globalThis.overviewCopilotActive = true;
        return session();
      };
      CopilotAuthService.prototype.signOut = async () => {
        globalThis.overviewCopilotActive = false;
        return { warning: null };
      };
      CopilotChatService.prototype.models = async () => [
        {
          id: 'test-model',
          label: 'Test Copilot',
          description: '',
          reasoningEfforts: ['low'],
          provider: { id: 'copilot', name: 'GitHub Copilot', dataRecipient: 'GitHub' },
        },
      ];
    },
    { chatgpt: cases[0].usage, copilot: cases.find((item) => item.provider === 'copilot').usage },
  );
  let main = await connectUiAccount(app, await app.firstWindow());
  main.on('pageerror', (error) => errors.push(error.message));
  await main.evaluate(() => document.fonts.ready.then(() => undefined));
  let activeProvider = 'chatgpt';
  const dialog = () => main.getByRole('dialog', { name: '开始面试', exact: true });
  const field = () => dialog().locator('.interview-start-summary-group > div').nth(1);
  await main.locator('.interview-start-trigger').click();

  async function release(provider) {
    await app.evaluate((_, value) => {
      globalThis.overviewHold[value] = false;
      globalThis.overviewFinish[value]?.();
      delete globalThis.overviewFinish[value];
    }, provider);
  }
  async function capture(item, target = field()) {
    await captureRequested(target, item.id);
    records.push({ id: item.id, label: item.label, group: item.group, image: `${item.id}.png` });
    if (item.id === 'both-19-71') await captureRequested(main, 'overview-mixed-full');
    if (item.id === 'week-only-19') await captureRequested(main, 'overview-weekly-only-full');
  }
  for (const item of cases) {
    if (item.provider !== activeProvider) {
      await dialog().getByRole('button', { name: '取消', exact: true }).click();
      main = await connectUiAccount(app, main, item.provider);
      activeProvider = item.provider;
      assert.equal((await main.evaluate(() => window.desktop.authSession())).mode, activeProvider);
      await main.locator('.interview-start-trigger').click();
    }
    await app.evaluate((_, value) => {
      globalThis.overviewUsage[value.provider] = value.usage ?? null;
      globalThis.overviewFail[value.provider] = value.fail === true;
      globalThis.overviewHold[value.provider] = true;
    }, item);
    await main.evaluate(() => window.dispatchEvent(new Event('focus')));
    await field().getByText('正在读取…', { exact: true }).waitFor();
    if (!item.loading) await release(item.provider);
    await field().getByText(item.title, { exact: true }).waitFor();
    const values = field().locator('.account-usage-value');
    if (item.values) {
      assert.equal(await values.count(), item.values.length, item.id);
      for (let index = 0; index < item.values.length; index++) {
        const expected = item.values[index];
        await values.nth(index).getByText(expected.text, { exact: true }).waitFor();
        const color = await values.nth(index).evaluate((node) => {
          const probe = document.createElement('span');
          probe.style.color = 'var(--warning)';
          node.append(probe);
          const warning = getComputedStyle(probe).color;
          probe.remove();
          return getComputedStyle(node).color === warning;
        });
        assert.equal(color, expected.low, `${item.id}: ${expected.text} warning color`);
      }
    } else {
      await field().getByText(item.text, { exact: true }).waitFor();
      assert.equal(await values.count(), 0, item.id);
    }
    const fits = await field().evaluate((node) => {
      const bound = node.getBoundingClientRect();
      return [...node.querySelectorAll('.account-usage-value')].every((value) => {
        const range = document.createRange();
        range.selectNodeContents(value);
        return range.getBoundingClientRect().right <= bound.right + 1;
      });
    });
    assert.equal(fits, true, `${item.id}: values stay inside the usage field`);
    await capture(item);
    if (item.loading) {
      await release(item.provider);
      await field().getByText('5小时 71% · 每周 71%', { exact: true }).waitFor();
    }
  }
  await dialog().getByRole('button', { name: '取消', exact: true }).click();
  await main.getByRole('button', { name: '用户菜单', exact: true }).click();
  await main.getByRole('menuitem', { name: '设置', exact: true }).click();
  const settings = main.getByRole('dialog', { name: '设置', exact: true });
  await settings.getByRole('button', { name: 'AI 服务', exact: true }).click();
  await settings
    .locator('.ai-service-row')
    .filter({ hasText: 'GitHub Copilot' })
    .getByRole('button', { name: '断开连接', exact: true })
    .click();
  await main.locator('.user-info small').getByText('未连接 AI 服务', { exact: true }).waitFor();
  await settings.getByRole('button', { name: '关闭设置', exact: true }).click();
  await capture(
    { id: 'disconnected', label: '未连接（开始面试时打开 AI 服务）', group: '异常与连接' },
    main.locator('.user-info small'),
  );
  await main.locator('.interview-start-trigger').click();
  await settings.getByRole('heading', { name: 'AI 服务', exact: true }).waitFor();
  for (const provider of ['chatgpt', 'copilot']) {
    await settings.locator(`[data-settings-target="${provider}"]`)
      .getByRole('button', { name: '连接', exact: true }).waitFor();
  }
  assert.equal(await dialog().count(), 0, 'An account without an AI connection cannot enter the interview');
  assert.equal(records.length, 34);
  assert.deepEqual(errors, []);
  if (output) await writeFile(path.join(output, 'cases.json'), JSON.stringify(records, null, 2));
  console.log(
    'PASS 34 usage overview states: 16 paired windows, 8 single windows, 6 Copilot states, loading/failure/missing/disconnected; actual UI colors and provider routing, synthetic data only.',
  );
} finally {
  await closeUiApp(app);
}
