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
async function assertWarningColor(locator, expected) {
  const result = await locator.evaluate((node) => {
    const probe = document.createElement('span');
    probe.style.color = 'var(--warning)';
    node.append(probe);
    const warning = getComputedStyle(probe).color;
    probe.remove();
    return getComputedStyle(node).color === warning;
  });
  assert.equal(result, expected, 'Low quota uses the shared yellow warning color');
}
async function assertSidebarLayout(main, inline = false) {
  const layout = await main.locator('.user-info small').evaluate((node) => {
    const range = document.createRange();
    range.selectNodeContents(node.querySelector('.account-usage-values'));
    const rect = range.getBoundingClientRect();
    const email = node
      .closest('.user-button')
      .querySelector('.user-info strong')
      .getBoundingClientRect();
    const avatar = node.closest('.user-button').querySelector('.avatar').getBoundingClientRect();
    const note = node.getBoundingClientRect();
    const heading = node.querySelector('.account-usage-heading').getBoundingClientRect();
    return {
      right: rect.right,
      left: rect.left,
      start: node.getBoundingClientRect().left,
      bound: node.getBoundingClientRect().right,
      rows: new Set([...range.getClientRects()].map((row) => Math.round(row.top))).size,
      valueTop: rect.top,
      headingTop: heading.top,
      headingBottom: heading.bottom,
      headingLeft: heading.left,
      emailLeft: email.left,
      avatarCenter: (avatar.top + avatar.bottom) / 2,
      textCenter: (Math.min(email.top, note.top) + Math.max(email.bottom, note.bottom)) / 2,
    };
  });
  assert.ok(
    layout.left >= layout.start - 1,
    'Compact quotas stay inside the sidebar start: ' + JSON.stringify(layout),
  );
  assert.ok(
    layout.right <= layout.bound + 1,
    'Compact quotas fit without sidebar truncation: ' + JSON.stringify(layout),
  );
  assert.equal(layout.rows, 1, 'Sidebar quotas share one line');
  assert.ok(Math.abs(layout.headingLeft - layout.emailLeft) <= 1, 'Usage aligns with email');
  assert.ok(Math.abs(layout.avatarCenter - layout.textCenter) <= 1, 'Avatar centers with the text');
  if (inline)
    assert.ok(
      Math.abs(layout.valueTop - layout.headingTop) <= 1,
      'Single period stays on one line',
    );
  else {
    assert.ok(layout.valueTop >= layout.headingBottom, 'Provider title is above the quota row');
    assert.ok(Math.abs(layout.left - layout.emailLeft) <= 1, 'Quota row aligns with email');
  }
}
async function assertNarrowSidebar(main, language, inline = false) {
  const window = await app.browserWindow(main);
  const size = await window.evaluate((window) => {
    const size = window.getSize();
    window.setSize(...window.getMinimumSize());
    return {
      previous: size,
      content: window.getContentSize(),
      zoom: window.webContents.getZoomFactor(),
    };
  });
  try {
    await main.waitForFunction(
      ({ content, zoom }) => Math.abs(innerWidth - content[0] / zoom) <= 1,
      size,
    );
    assert.equal(
      await main
        .locator('.sidebar')
        .evaluate((node) => Math.round(node.getBoundingClientRect().width * 64) / 64),
      230,
      'The expanded sidebar retains its fixed width at the minimum window size',
    );
    for (const dark of [false, true]) {
      await main.evaluate(
        (value) => document.documentElement.classList.toggle('dark', value),
        dark,
      );
      await assertSidebarLayout(main, inline);
    }
    if (process.argv.some((argument) => argument.startsWith('--screenshots='))) {
      const english = language === 'en';
      await main
        .getByRole('button', { name: english ? 'Close settings' : '关闭设置', exact: true })
        .click();
      await main.getByRole('dialog').waitFor({ state: 'detached' });
      await captureRequested(
        main.locator('.user-button'),
        'usage-sidebar-' + language + (inline ? '-single' : '') + '-narrow',
      );
      await main
        .getByRole('button', { name: english ? 'User menu' : '用户菜单', exact: true })
        .click();
      await main
        .getByRole('menuitem', { name: english ? 'Settings' : '设置', exact: true })
        .click();
      await main.getByRole('button', { name: english ? 'General' : '通用', exact: true }).click();
    }
  } finally {
    const restored = await window.evaluate((window, size) => {
      window.setSize(...size.previous);
      return { content: window.getContentSize(), zoom: window.webContents.getZoomFactor() };
    }, size);
    await main.waitForFunction(
      ({ content, zoom }) => Math.abs(innerWidth - content[0] / zoom) <= 1,
      restored,
    );
  }
}
try {
  await installUiAccount(app, { speech: true, components: true });
  await app.evaluate(({ app }) => {
    const require = process
      .getBuiltinModule('module')
      .createRequire(app.getAppPath() + '/package.json');
    const base = app.getAppPath() + '/dist-electron/shared/electron/';
    const { SpeechHost } = require(base + 'backend/speech/host.js');
    const speechCall = SpeechHost.prototype.call;
    SpeechHost.prototype.call = function (...args) {
      globalThis.freeSpeechHost = this;
      return speechCall.apply(this, args);
    };
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
  await main.evaluate(() => document.fonts.ready.then(() => undefined));
  main.on('pageerror', (e) => errors.push(e.message));
  await main.locator('.user-info small').getByText('ChatGPT 剩余 22%', { exact: true }).waitFor();
  await main.locator('.interview-start-trigger').click();
  const normalStart = main.getByRole('dialog', { name: '开始面试', exact: true });
  await normalStart.getByText('ChatGPT 用量', { exact: true }).waitFor();
  await normalStart.locator('dd').getByText('5小时 22% · 每周 71%', { exact: true }).waitFor();
  assert.equal(await normalStart.locator('.account-usage-heading').count(), 0);
  await captureRequested(main, 'free-interview-start-normal');
  await normalStart.getByRole('button', { name: '取消', exact: true }).click();
  assert.equal(await main.evaluate(() => 'cloudUsage' in window.desktop), false);
  await main.getByRole('button', { name: '用户菜单', exact: true }).click();
  await main.getByRole('menuitem', { name: '设置', exact: true }).click();
  const settings = main.getByRole('dialog', { name: '设置', exact: true });
  await settings.getByRole('button', { name: 'VoxCue 账号', exact: true }).click();
  await settings.getByRole('heading', { name: 'VoxCue 账号', exact: true }).waitFor();
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

  for (const [weekly, five, expected, low] of [
    [29, 100, 'ChatGPT 用量 5小时 0% · 每周 71%', true],
    [29, 80, 'ChatGPT 剩余 20%', false],
    [29, 80.01, 'ChatGPT 用量 5小时 19% · 每周 71%', true],
    [29, 81, 'ChatGPT 用量 5小时 19% · 每周 71%', true],
    [29, null, 'ChatGPT 剩余 71%', false],
    [85, null, 'ChatGPT 剩余 15%', true],
    [80.01, 0, 'ChatGPT 用量 5小时 100% · 每周 19%', true],
    [100, 0, 'ChatGPT 用量 5小时 100% · 每周 0%', true],
    [85, 81, 'ChatGPT 用量 5小时 19% · 每周 15%', true],
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
    await main.locator('.user-info small').getByText(expected, { exact: true }).waitFor();
    for (const dark of [false, true]) {
      await main.evaluate(
        (value) => document.documentElement.classList.toggle('dark', value),
        dark,
      );
      const sidebarValues = main.locator('.user-info small .account-usage-value');
      const used = low && five !== null ? [five, weekly] : [five ?? weekly];
      assert.equal(await sidebarValues.count(), used.length);
      for (let index = 0; index < used.length; index++)
        await assertWarningColor(sidebarValues.nth(index), five !== null && used[index] > 80);
      if (low && five === null)
        await assertWarningColor(main.locator('.user-info .account-usage-percent'), true);
      if (low) {
        await assertWarningColor(main.locator('.user-info small .account-usage-heading'), false);
        await assertSidebarLayout(main, five === null);
      }
    }
    if (weekly === 80.01 && five === 0) {
      await assertNarrowSidebar(main, 'zh');
      await settings.getByRole('button', { name: '通用', exact: true }).click();
      await settings.getByRole('button', { name: '语言', exact: true }).click();
      await main.getByRole('menuitemradio', { name: 'English', exact: true }).click();
      await main
        .locator('.user-info .account-usage-values')
        .getByText('5h 100% · Weekly 19%', { exact: true })
        .waitFor();
      for (const dark of [false, true]) {
        await main.evaluate(
          (value) => document.documentElement.classList.toggle('dark', value),
          dark,
        );
        const values = main.locator('.user-info .account-usage-value');
        await assertWarningColor(values.nth(0), false);
        await assertWarningColor(values.nth(1), true);
        await assertSidebarLayout(main);
      }
      await assertNarrowSidebar(main, 'en');
      const english = main.getByRole('dialog', { name: 'Settings', exact: true });
      await english.getByRole('button', { name: 'AI services', exact: true }).click();
      for (const windowDurationMins of [300, 10080]) {
        for (const remaining of [0, 19, 20, 71]) {
          await app.evaluate(
            (_, values) => {
              globalThis.freeUsage = {
                rateLimits: {
                  primary: {
                    usedPercent: 100 - values.remaining,
                    windowDurationMins: values.windowDurationMins,
                  },
                },
              };
            },
            { remaining, windowDurationMins },
          );
          await english.getByRole('button', { name: 'Refresh usage', exact: true }).click();
          await main
            .locator('.user-info small')
            .getByText(`ChatGPT ${remaining}% remaining`, { exact: true })
            .waitFor();
          for (const dark of [false, true]) {
            await main.evaluate(
              (value) => document.documentElement.classList.toggle('dark', value),
              dark,
            );
            await assertSidebarLayout(main, true);
            await assertWarningColor(main.locator('.user-info .account-usage-heading'), false);
            await assertWarningColor(main.locator('.user-info .account-usage-value'), false);
            const percent = main.locator('.user-info .account-usage-percent');
            assert.equal(await percent.count(), remaining < 20 ? 1 : 0);
            if (remaining < 20) await assertWarningColor(percent, true);
          }
          if (remaining === 19) {
            await assertNarrowSidebar(main, 'en', true);
            await english.getByRole('button', { name: 'AI services', exact: true }).click();
          }
        }
      }
      await english.getByRole('button', { name: 'General', exact: true }).click();
      await english.getByRole('button', { name: 'Language', exact: true }).click();
      await main.getByRole('menuitemradio', { name: '简体中文', exact: true }).click();
      await settings.getByRole('button', { name: 'AI 服务', exact: true }).click();
    }
    if (weekly === 29 && (five === 80 || five === 81 || five === null)) {
      const remaining = five === null ? 'weekly-only' : 100 - five;
      await settings.getByRole('button', { name: '关闭设置', exact: true }).click();
      await main.locator('.interview-start-trigger').click();
      const thresholdStart = main.getByRole('dialog', { name: '开始面试', exact: true });
      await thresholdStart.getByText('ChatGPT 用量', { exact: true }).waitFor();
      const thresholdUsage = thresholdStart.locator('.account-usage-values');
      await thresholdUsage
        .getByText(five === null ? '剩余 71%' : `5小时 ${100 - five}% · 每周 71%`, { exact: true })
        .waitFor();
      await main.evaluate(() => document.documentElement.classList.remove('dark'));
      const thresholdValues = thresholdUsage.locator('.account-usage-value');
      assert.equal(await thresholdValues.count(), five === null ? 1 : 2);
      await assertWarningColor(thresholdValues.nth(0), low);
      if (five !== null) await assertWarningColor(thresholdValues.nth(1), false);
      await captureRequested(main, `threshold-start-${remaining}`);
      await thresholdStart.getByRole('button', { name: '取消', exact: true }).click();
      await main.getByRole('button', { name: '用户菜单', exact: true }).click();
      await main.getByRole('menuitem', { name: '设置', exact: true }).click();
      await settings.getByRole('button', { name: 'AI 服务', exact: true }).click();
    }
  }
  await settings.getByRole('button', { name: '关闭设置', exact: true }).click();
  await main.locator('.interview-start-trigger').click();
  const start = main.getByRole('dialog', { name: '开始面试', exact: true });
  const startTitle = start.getByText('ChatGPT 用量', { exact: true });
  await startTitle.waitFor();
  const startUsage = start.locator('.account-usage-low .account-usage-values');
  await startUsage.getByText('5小时 19% · 每周 15%', { exact: true }).waitFor();
  assert.equal(
    await start.locator('.account-usage-heading').count(),
    0,
    'Provider title appears once',
  );
  for (const dark of [false, true]) {
    await main.evaluate((value) => document.documentElement.classList.toggle('dark', value), dark);
    for (const value of await startUsage.locator('.account-usage-value').all())
      await assertWarningColor(value, true);
    await assertWarningColor(startTitle, false);
    await captureRequested(main, `free-interview-start-${dark ? 'dark' : 'light'}`);
  }
  assert.equal(await start.getByText(/剩余面试时长|面试额度|兑换/).count(), 0);
  await captureRequested(main, 'free-interview-start');
  const opened = app.waitForEvent('window');
  await start.getByRole('button', { name: '确认开始', exact: true }).click();
  const floating = await opened;
  floating.on('pageerror', (e) => errors.push(e.message));
  await floating.getByRole('textbox', { name: '面试提问', exact: true }).waitFor();
  assert.equal(await floating.getByText(/面试额度|剩余面试时长/).count(), 0);
  const usageNotice = floating.locator('.floating-usage-notice');
  await usageNotice.getByText('ChatGPT 剩余: 5小时 19% · 每周 15%', { exact: true }).waitFor();
  await floating.getByRole('button', { name: '关闭截图保护', exact: true }).click();
  await floating.locator('.floating-capture-notice').waitFor();
  for (const dark of [false, true]) {
    await floating.evaluate(
      (value) => document.documentElement.classList.toggle('dark', value),
      dark,
    );
    await assertWarningColor(usageNotice, true);
    const noticeLayout = await usageNotice.evaluate((node) => {
      const range = document.createRange();
      range.selectNodeContents(node);
      return {
        rows: new Set([...range.getClientRects()].map((rect) => Math.round(rect.top))).size,
        right: range.getBoundingClientRect().right,
        bound: node.getBoundingClientRect().right,
      };
    });
    assert.equal(noticeLayout.rows, 1, 'Both floating quotas share one line');
    assert.ok(noticeLayout.right <= noticeLayout.bound, 'Both floating quotas are fully visible');
    assert.equal(
      await floating
        .locator('.floating-notices')
        .evaluate((node) => getComputedStyle(node).scrollbarWidth),
      'auto',
      'Status notices retain the original visible scrollbar',
    );
    const statusLayout = await floating.locator('.floating-notices').evaluate((node) => ({
      clientHeight: node.clientHeight,
      scrollHeight: node.scrollHeight,
      clientWidth: node.clientWidth,
      scrollWidth: node.scrollWidth,
      gap: getComputedStyle(node).gap,
      notices: [...node.children].map((child) => ({
        height: child.getBoundingClientRect().height,
        border: getComputedStyle(child).borderTopWidth,
        padding: getComputedStyle(child).paddingTop,
        lineHeight: getComputedStyle(child).lineHeight,
      })),
    }));
    assert.ok(
      statusLayout.scrollHeight <= statusLayout.clientHeight,
      'Two single-line notices fit without a surplus vertical scrollbar: ' +
        JSON.stringify(statusLayout),
    );
    await captureRequested(floating, `free-floating-low-${dark ? 'dark' : 'light'}`);
  }
  await app.evaluate(() => {
    globalThis.freeSpeechHost.emit({
      type: 'gap',
      source: 'microphone',
      message: '合成麦克风提示：请检查连接',
    });
  });
  const extraNotice = floating.getByText('合成麦克风提示：请检查连接', { exact: true });
  await extraNotice.waitFor();
  const overflowLayout = await floating.locator('.floating-notices').evaluate((node) => {
    const viewport = node.getBoundingClientRect();
    const rows = [...node.children].map((child) => child.getBoundingClientRect());
    const third = rows[2];
    const visibleFraction =
      Math.max(0, Math.min(third.bottom, viewport.bottom) - third.top) / third.height;
    node.scrollTop = node.scrollHeight;
    const scrollTop = node.scrollTop;
    node.scrollTop = 0;
    return {
      rows: rows.length,
      secondVisible: rows[1].bottom <= viewport.bottom,
      visibleFraction,
      scrollHeight: node.scrollHeight,
      clientHeight: node.clientHeight,
      scrollTop,
    };
  });
  assert.equal(overflowLayout.rows, 3);
  assert.equal(overflowLayout.secondVisible, true);
  assert.ok(
    overflowLayout.visibleFraction >= 0.4 && overflowLayout.visibleFraction <= 0.6,
    'The third notice is about half visible: ' + JSON.stringify(overflowLayout),
  );
  assert.ok(
    overflowLayout.scrollHeight > overflowLayout.clientHeight && overflowLayout.scrollTop > 0,
  );
  await captureRequested(floating, 'free-floating-overflow');
  await app.evaluate(() => {
    globalThis.freeSpeechHost.emit({
      type: 'activity',
      source: 'microphone',
      speaking: false,
      level: 0,
    });
  });
  await extraNotice.waitFor({ state: 'detached' });
  await floating.getByRole('button', { name: '开启截图保护', exact: true }).click();
  await floating.locator('.floating-capture-notice').waitFor({ state: 'detached' });
  const refreshFloatingUsage = () =>
    floating.evaluate(() => window.dispatchEvent(new Event('focus')));
  await app.evaluate(() => {
    globalThis.freeUsage = {
      rateLimits: { primary: { usedPercent: 80, windowDurationMins: 300 } },
    };
  });
  await refreshFloatingUsage();
  await usageNotice.waitFor({ state: 'detached' });
  await floating.waitForFunction(
    async () =>
      (await window.desktop.interviewAccountUsage()).usage?.quotas[0].remainingPercent === 20,
  );
  await captureRequested(floating, 'threshold-floating-20');
  await app.evaluate(() => {
    globalThis.freeUsage = {
      rateLimits: {
        primary: { usedPercent: 81, windowDurationMins: 300 },
        secondary: { usedPercent: 29, windowDurationMins: 10080 },
      },
    };
  });
  await refreshFloatingUsage();
  await usageNotice.getByText('ChatGPT 剩余: 5小时 19%', { exact: true }).waitFor();
  await assertWarningColor(usageNotice, true);
  await captureRequested(floating, 'threshold-floating-19');
  await floating.getByRole('button', { name: '关闭截图保护', exact: true }).click();
  await floating.locator('.floating-capture-notice').waitFor();
  await app.evaluate(() => {
    globalThis.freeUsage = {
      rateLimits: {
        primary: { usedPercent: 81, windowDurationMins: 300 },
        secondary: { usedPercent: 85, windowDurationMins: 10080 },
      },
    };
  });
  await floating
    .getByRole('textbox', { name: '面试提问', exact: true })
    .fill('Explain the synthetic project.');
  await floating.getByRole('textbox', { name: '面试提问', exact: true }).press('Enter');
  await floating.getByText('Synthetic interview answer', { exact: true }).waitFor();
  await usageNotice.getByText('ChatGPT 剩余: 5小时 19% · 每周 15%', { exact: true }).waitFor();
  await captureRequested(floating, 'free-floating-both-low');
  await app.evaluate(() => {
    globalThis.freeUsage = {};
  });
  await refreshFloatingUsage();
  await usageNotice.waitFor({ state: 'detached' });
  await floating.locator('.floating-capture-notice').waitFor();
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
    'PASS free client UI: one-line normal sidebar unchanged; warning sidebar shows both actual periods with independent colors; compact rows without truncation; start overview unchanged; floating notice shows only low quotas on one line; two notices fit, the third is half visible and scrollable; weekly 0% warns with five-hour 100%; both-low warnings; 20% neutral; light/dark; focus recovery, post-answer warning and unavailable cleanup; no billing requests; synthetic accounts/audio only.',
  );
} finally {
  await closeUiApp(app);
}
