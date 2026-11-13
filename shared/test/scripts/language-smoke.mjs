import { connectUiAccount, installUiAccount, closeUiApp } from './install-ui-account.mjs';
import { testRoot, electron } from './test-workspace.mjs';
import { offlineElectronEntry } from './offline-electron-entry.mjs';
import { captureRequested } from './capture-requested.mjs';
import { waitForAsync } from './wait-for-async.mjs';
import { mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

if (process.argv.includes('--bootstrap-only')) {
  await import('./language-bootstrap-smoke.mjs');
  process.exit(0);
}

const profile = await mkdtemp(path.join(testRoot, 'language-profile-'));
const env = { ...process.env, COPILOT_TEST_USER_DATA: profile, VITE_DEV_SERVER_URL: '' };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: [await offlineElectronEntry()], env });
try {
  await installUiAccount(app, { speech: true, components: true });
  await app.evaluate(({ app }) => {
    const load = process.getBuiltinModule('module').createRequire(app.getAppPath() + '/package.json');
    const { SpeechHost } = load(app.getAppPath() + '/dist-electron/shared/electron/backend/speech/host.js');
    const call = SpeechHost.prototype.call;
    SpeechHost.prototype.call = async function (request) {
      const status = await call.call(this, request);
      if (request.op === 'start') globalThis.languageSpeech = { host: this, status };
      return status;
    };
  });
  const page = await connectUiAccount(app, await app.firstWindow());
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.getByRole('button', { name: '用户菜单', exact: true }).click();
  await page.getByRole('menuitem', { name: '设置', exact: true }).click();
  await page
    .getByRole('navigation', { name: '设置分类' })
    .getByRole('button', { name: '通用', exact: true })
    .click();
  await page.getByRole('button', { name: '语言', exact: true }).click();
  await page.getByRole('menuitemradio', { name: 'English', exact: true }).click();
  await page.getByRole('heading', { name: 'General', exact: true }).waitFor();
  const audit = async (name, target = page) => {
    await target.waitForFunction(
      () =>
        !document.documentElement.dataset.viewDirection &&
        document
          .getAnimations()
          .every(
            (animation) =>
              animation.effect?.getTiming().iterations === Infinity ||
              animation.playState !== 'running',
          ),
    );
    const result = await target.evaluate(() => {
      const root = document.querySelector('dialog[open]') ?? document.body;
      const visible = (el) =>
        !!el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden';
      const leaks = [];
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let node; (node = walker.nextNode());) {
        if (!visible(node.parentElement) || node.parentElement.closest('script,style')) continue;
        const text = node.textContent.trim();
        if (/\p{Script=Han}/u.test(text) && text !== '简体中文') leaks.push(text);
      }
      for (const el of root.querySelectorAll('[aria-label],[placeholder]')) {
        if (!visible(el)) continue;
        for (const attr of ['aria-label', 'placeholder']) {
          const text = el.getAttribute(attr);
          if (text && /\p{Script=Han}/u.test(text) && text !== '简体中文')
            leaks.push(attr + ': ' + text);
        }
      }
      const clipped = [...root.querySelectorAll('button,.settings-sidebar,.settings-content')]
        .filter(
          (el) =>
            visible(el) &&
            !el.classList.contains('confirm-delete') &&
            !el.matches('.floating-end:not(.is-confirming)') &&
            el.clientWidth &&
            el.scrollWidth > el.clientWidth + 2,
        )
        .map((el) => [el.className, el.textContent.trim(), el.clientWidth, el.scrollWidth]);
      const escapedDevices = [...root.querySelectorAll('.speech-device')]
        .filter(visible)
        .flatMap((device) => {
          const bounds = device.getBoundingClientRect();
          const panel = root.getBoundingClientRect();
          // These are shared horizontal grid rows, not the former standalone
          // cards. Compare Chromium's 1/64px layout units, not float noise.
          const unit = (value) => Math.round(value * 64) / 64;
          const outside = (rect, container, vertical = true) =>
            unit(rect.left) < unit(container.left) ||
            unit(rect.right) > unit(container.right) ||
            (vertical &&
              (unit(rect.top) < unit(container.top) || unit(rect.bottom) > unit(container.bottom)));
          const escaped = [...device.children].filter(visible).filter((child) => {
            const rect = child.getBoundingClientRect();
            return outside(rect, bounds);
          });
          const label = device.querySelector(':scope > .speech-setting-label');
          const control = device.querySelector(':scope > button');
          const labelBox = label?.getBoundingClientRect();
          const controlBox = control?.getBoundingClientRect();
          const misplaced =
            !device.classList.contains('speech-setting-row') ||
            !labelBox ||
            !controlBox ||
            device.querySelectorAll(':scope > button').length !== 1 ||
            unit(controlBox.left) <= unit(labelBox.right) ||
            unit(controlBox.top + controlBox.height / 2) !==
              unit(labelBox.top + labelBox.height / 2);
          if (!escaped.length && !misplaced && !outside(bounds, panel, false)) return [];
          return [
            {
              text: device.textContent.trim(),
              row: bounds.toJSON(),
              panel: { left: panel.left, right: panel.right },
              label: labelBox?.toJSON(),
              control: controlBox?.toJSON(),
              misplaced,
              escaped: escaped.map((child) => ({
                class: child.className,
                rect: child.getBoundingClientRect().toJSON(),
              })),
            },
          ];
        });
      return { leaks: [...new Set(leaks)], clipped, escapedDevices };
    });
    console.log(name, JSON.stringify(result));
    assert.deepEqual(result.leaks, [], name + ' must be localized');
    assert.deepEqual(result.clipped, [], name + ' controls must fit');
    assert.deepEqual(
      result.escapedDevices,
      [],
      name + ' device controls stay in their own rows and panel',
    );
    await captureRequested(target, name.toLowerCase().replace(/[^a-z0-9]+/g, '-'));
    return result;
  };
  for (const name of [
    'General',
    'VoxCue account',
    'AI services',
    'Local components',
    'Interview settings',
    'Shortcuts',
    'About & updates',
  ]) {
    await page
      .getByRole('navigation', { name: 'Settings categories' })
      .getByRole('button', { name, exact: true })
      .click();
    await page.getByRole('heading', { name, exact: true }).waitFor();
    await audit(name);
    if (name === 'Shortcuts' && process.platform === 'darwin') {
      const binding = page.getByRole('button', {
        name: 'Change shortcut: Turn on or off the microphone',
        exact: true,
      });
      await binding.click();
      await page.waitForFunction(() =>
        document.querySelector('.shortcut-binding[aria-pressed="true"]'),
      );
      await page.keyboard.press('x');
      await page
        .getByRole('alert')
        .filter({ hasText: 'Include at least one of ⌃, ⌥, ⇧ or ⌘' })
        .waitFor();
      await audit('Mac shortcut modifier error');
      await page.keyboard.down('Meta');
      await page.keyboard.down('Shift');
      await page.keyboard.down('h');
      assert.equal(await binding.innerText(), '⇧⌘H');
      await audit('Mac Command shortcut preview');
      await binding.evaluate((button) => button.click());
      await page.keyboard.up('h');
      await page.keyboard.up('Shift');
      await page.keyboard.up('Meta');
      assert.equal(await binding.getAttribute('aria-pressed'), 'false');
    }
    if (process.argv.includes('--preview') && name === 'Interview settings') {
      await page.locator('.interview-preview-scene').scrollIntoViewIfNeeded();
      await page.waitForFunction(
        () => document.querySelector('.preview-backdrop-photo img')?.naturalWidth > 0,
      );
      console.log(
        'IMAGE:' +
          (await page.screenshot({ type: 'jpeg', quality: 65, scale: 'css' })).toString('base64'),
      );
    }
  }
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows().find((window) => !window.isDestroyed());
    window.setMinimumSize(500, 500);
    window.setSize(600, 600);
  });
  await page.waitForFunction(() => innerWidth <= 620);
  for (const name of ['General', 'AI services', 'Interview settings', 'Shortcuts', 'About & updates']) {
    await page
      .getByRole('navigation', { name: 'Settings categories' })
      .getByRole('button', { name, exact: true })
      .click();
    await page.getByRole('heading', { name, exact: true }).waitFor();
    await audit('Narrow ' + name);
  }
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1280, 800));
  await page.waitForFunction(() => innerWidth >= 1000);
  await page.getByRole('button', { name: 'Close settings', exact: true }).click();
  await audit('Preparation');
  await page.locator('.page-toolbar').getByText('Interview preparation', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Profile', exact: true }).click();
  await audit('Personal information');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Start interview', exact: true }).click();
  await audit('Start interview');
  const actions = await page.locator('.interview-start-actions > button').evaluateAll((buttons) =>
    buttons.map((button) => {
      const rect = button.getBoundingClientRect();
      return { width: rect.width, height: rect.height, top: rect.top };
    }),
  );
  assert.deepEqual(actions[0], actions[1], 'Start and Cancel have equal dimensions and alignment');
  if (process.argv.includes('--preview'))
    console.log(
      'IMAGE:' +
        (
          await page
            .locator('.interview-start-dialog')
            .screenshot({ type: 'jpeg', quality: 65, scale: 'css' })
        ).toString('base64'),
    );
  const [floating] = await Promise.all([
    app.waitForEvent('window'),
    page
      .getByRole('dialog', { name: 'Start interview', exact: true })
      .getByRole('button', { name: 'Start', exact: true })
      .click(),
  ]);
  await floating.getByRole('button', { name: 'Interview settings', exact: true }).waitFor();
  // No model response or captured text is translated by the interface language.
  await audit('Interview', floating);
  const readiness = await floating.locator('.floating-transcript > header').evaluate((header) => {
    const parts = [...header.querySelectorAll('h2,.interview-ready-badge')].map((part) => {
      const rect = part.getBoundingClientRect();
      return { center: rect.top + rect.height / 2, left: rect.left, right: rect.right };
    });
    const labels = [...header.querySelectorAll('.interview-ready-badge-label')].map((label) => ({
      text: label.textContent,
      width: label.clientWidth,
      content: label.scrollWidth,
    }));
    return { parts, labels };
  });
  console.log('Readiness layout', JSON.stringify(readiness));
  assert.ok(
    readiness.parts.every((part) => Math.abs(part.center - readiness.parts[0].center) < 1),
    'Transcript heading and readiness badges stay on one row',
  );
  assert.ok(
    readiness.parts.slice(1).every((part, index) => part.left >= readiness.parts[index].right),
    'Readiness badges do not overlap the title or one another',
  );
  assert.ok(
    readiness.labels.every((label) => label.content <= label.width + 1),
    'Full readiness labels fit at the default window size',
  );
  const defaultWidth = await floating
    .locator('.floating-transcript')
    .evaluate((panel) => panel.clientWidth);
  await floating.evaluate(async () => {
    for (let step = 0; step < 3; step++) await window.desktop.resizeInterview(-1);
  });
  await floating.waitForFunction(
    (width) => document.querySelector('.floating-transcript').clientWidth < width - 50,
    defaultWidth,
  );
  const narrow = await floating.locator('.floating-transcript > header').evaluate((header) => {
    const heading = header.querySelector('h2').getBoundingClientRect();
    const boundary = header.getBoundingClientRect();
    return [...header.querySelectorAll('.interview-ready-badge')].every((badge) => {
      const rect = badge.getBoundingClientRect();
      return (
        rect.left >= heading.right &&
        rect.right <= boundary.right &&
        rect.top >= boundary.top &&
        rect.bottom <= boundary.bottom &&
        badge.scrollWidth <= badge.clientWidth + 1
      );
    });
  });
  assert.ok(narrow, 'Readiness can wrap in a smaller window without clipping or overlapping');
  await waitForAsync(app, () => !!globalThis.languageSpeech);
  const recovering = 'Audio interrupted. Reconnecting automatically…';
  const interrupted = 'Audio interrupted. Incomplete segments will not automatically trigger answers.';
  const exhausted = 'Automatic audio recovery reached its retry limit. Check the device or model and reconnect.';
  const recoveryBanner = floating.locator('.audio-recovery');
  const assertRecovery = async (message, label) => {
    await recoveryBanner.getByText(message, { exact: true }).waitFor();
    await recoveryBanner.getByRole('button', { name: 'Reconnect audio', exact: true }).waitFor();
    await audit(label, floating);
    const geometry = await recoveryBanner.evaluate((node) => {
      const bounds = node.getBoundingClientRect();
      const panel = node.closest('.floating-panel').getBoundingClientRect();
      return {
        inside: bounds.left >= panel.left && bounds.right <= panel.right,
        buttons: [...node.querySelectorAll('button')].every((button) => {
          const box = button.getBoundingClientRect();
          return box.left >= bounds.left && box.right <= bounds.right &&
            button.scrollWidth <= button.clientWidth + 1;
        }),
        messageFits: node.querySelector('p').scrollWidth <= node.querySelector('p').clientWidth + 1,
      };
    });
    assert.deepEqual(geometry, { inside: true, buttons: true, messageFits: true }, label);
  };
  await app.evaluate(() => {
    const { host, status } = globalThis.languageSpeech;
    const error = '音频已中断，正在自动重新连接…';
    host.emit({ type: 'gap', source: 'system', message: '音频发生中断，不完整片段不会自动用于回答。' });
    host.emit({ type: 'status', status: { ...status, state: 'error', error, failureSource: 'system' } });
  });
  await assertRecovery(recovering, 'Narrow English automatic audio recovery');
  await floating.getByText(interrupted, { exact: true }).waitFor();
  await app.evaluate(() => {
    const { host, status } = globalThis.languageSpeech;
    host.emit({ type: 'status', status });
    host.emit({ type: 'activity', source: 'system', speaking: false, level: 0 });
  });
  await recoveryBanner.waitFor({ state: 'hidden' });
  await floating.waitForFunction((message) => ![...document.querySelectorAll('.floating-warning')]
    .some((node) => node.textContent === message), interrupted);
  await app.evaluate(() => {
    const { host, status } = globalThis.languageSpeech;
    host.emit({ type: 'status', status: { ...status, state: 'error',
      error: '音频自动恢复已达到重试上限，请检查设备或模型后重新连接。', failureSource: 'system' } });
  });
  await assertRecovery(exhausted, 'Narrow English automatic recovery retry limit');
  await recoveryBanner.getByRole('button', { name: 'Reconnect audio', exact: true }).click();
  await recoveryBanner.waitFor({ state: 'hidden' });
  await audit('English manual recovery after retry limit', floating);
  await floating.evaluate(async () => {
    for (let step = 0; step < 3; step++) await window.desktop.resizeInterview(1);
  });
  await floating.waitForFunction(
    (width) => Math.abs(document.querySelector('.floating-transcript').clientWidth - width) <= 1,
    defaultWidth,
  );
  await page.evaluate(() => localStorage.setItem('voxcue-language-v1', 'zh-CN'));
  await floating.getByRole('button', { name: '面试设置', exact: true }).waitFor();
  await page.evaluate(() => localStorage.setItem('voxcue-language-v1', 'en'));
  await floating.getByRole('button', { name: 'Interview settings', exact: true }).waitFor();
  await floating.getByRole('button', { name: 'Interview settings', exact: true }).click();
  await audit('Live interview settings', floating);
  await floating.keyboard.press('Escape');
  await floating.getByRole('button', { name: 'End interview', exact: true }).click();
  await floating.waitForFunction(
    () => document.querySelector('.floating-end').getBoundingClientRect().width >= 135,
  );
  await audit('End confirmation', floating);
  const endPadding = await floating.locator('.floating-end').evaluate((button) => {
    const outer = button.getBoundingClientRect();
    const inner = button.querySelector('.button-morph-expanded').getBoundingClientRect();
    return { left: inner.left - outer.left, right: outer.right - inner.right };
  });
  assert.ok(
    Math.min(endPadding.left, endPadding.right) >= 12,
    'End confirmation has room at both ends',
  );
  assert.ok(Math.abs(endPadding.left - endPadding.right) < 1, 'End confirmation is centered');
  if (process.argv.includes('--preview'))
    console.log(
      'IMAGE:' +
        (await floating.screenshot({ type: 'jpeg', quality: 65, scale: 'css' })).toString('base64'),
    );
  await Promise.all([
    floating.waitForEvent('close'),
    floating.getByRole('button', { name: 'Confirm end interview', exact: true }).click(),
  ]);
  await page.getByRole('button', { name: 'Interview history', exact: true }).click();
  await audit('History');
  await page.getByRole('button', { name: 'Knowledge bases', exact: true }).click();
  await audit('Knowledge');
  await page.reload();
  await page.getByRole('button', { name: 'User menu', exact: true }).waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.lang), 'en');
  assert.equal(await page.evaluate(() => localStorage.getItem('voxcue-language-v1')), 'en');
  assert.equal(
    await page.evaluate(async () => {
      try {
        await window.desktop.setUILanguage('fr');
        return false;
      } catch {
        return true;
      }
    }),
    true,
    'Unsupported language IPC input must be rejected',
  );
  assert.deepEqual(errors, []);
} finally {
  await closeUiApp(app);
}

for (const [preferred, expected] of [
  ['zh-Hans-CN', 'zh-CN'],
  ['en-GB', 'en'],
  ['zh-Hant-TW', 'en'],
  ['fr-FR', 'en'],
]) {
  const directory = await mkdtemp(path.join(testRoot, 'system-language-'));
  const instance = await electron.launch({
    args: [await offlineElectronEntry(undefined, { preferredLanguages: [preferred] })],
    env: { ...env, COPILOT_TEST_USER_DATA: directory },
  });
  try {
    const login = await instance.firstWindow();
    await login
      .getByRole('heading', {
        name: expected === 'en' ? 'Sign in to VoxCue' : '登录 VoxCue',
        exact: true,
      })
      .waitFor();
    assert.equal(await login.evaluate(() => document.documentElement.lang), expected);
    assert.equal(await login.evaluate(() => localStorage.getItem('voxcue-language-v1')), null);
    if (expected === 'en')
      assert.doesNotMatch(await login.locator('body').innerText(), /\p{Script=Han}/u);
  } finally {
    await closeUiApp(instance);
  }
}
console.log('Language defaults, English UI and saved preference passed');
