import { connectUiAccount } from './install-ui-account.mjs';
import { cornerShapeNames } from './continuous-corners.mjs';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import workspace from '../../scripts/workspace.mjs';
import { testRoot, electron } from './test-workspace.mjs';
import { offlineElectronEntry } from './offline-electron-entry.mjs';
import { installUiAccount, closeUiApp, focusUiWindow } from './install-ui-account.mjs';
import { captureRequested } from './capture-requested.mjs';

const entry = path.join(testRoot, 'web-materials.cjs');
await writeFile(
  entry,
  `
const {app,dialog}=require('electron');
dialog.showErrorBox=(title,message)=>{console.error(title,message);app.exit(91);};
require(${JSON.stringify(path.join(workspace.platformRoot, 'dist-electron/shared/electron/main.js'))});
`,
);
await mkdir(path.join(testRoot, 'profile'));
const app = await electron.launch({
  args: [await offlineElectronEntry(entry)],
  env: {
    ...process.env,
    COPILOT_TEST_USER_DATA: path.join(testRoot, 'profile'),
    VITE_DEV_SERVER_URL: '',
  },
});
try {
  await installUiAccount(app, { components: true, speech: true });
  await app.evaluate(({ app }) => {
    const require = process
      .getBuiltinModule('module')
      .createRequire(app.getAppPath() + '/package.json');
    const { ChatGPTService } = require(
      app.getAppPath() + '/dist-electron/shared/electron/backend/chat/service.js',
    );
    ChatGPTService.prototype.stream = async (request, emit) => {
      const answerText = Array.from(
        { length: 36 },
        (_, i) => `第${i + 1}段合成回答：用于核对共享毛玻璃的内容覆盖、滚动和阅读对比度。`,
      ).join('\n\n');
      emit({ id: request.id, type: 'delta', text: answerText });
      return { answerText, usage: null, sources: [] };
    };
  });
  const login = await app.firstWindow();
  const signIn = login.getByRole('button', { name: '登录', exact: true });
  await signIn.waitFor();
  for (const dark of [false, true]) {
    await login.emulateMedia({ colorScheme: dark ? 'dark' : 'light' });
    await login.waitForFunction(
      (dark) => document.documentElement.classList.contains('dark') === dark,
      dark,
    );
    assert.notEqual(
      await signIn.evaluate((node) => getComputedStyle(node).color),
      'rgba(0, 0, 0, 0)',
    );
    assert.equal(await signIn.evaluate((node) => getComputedStyle(node).borderRadius), '999px');
    assert.equal(await signIn.evaluate((node) => getComputedStyle(node).justifyContent), 'center');
    assert.equal(await login.locator('.login-explanation').count(), 0);
    const scene = login.locator('.login-preview .interview-preview-scene');
    assert.equal(await scene.locator('.floating-panel').count(), 2);
    assert.equal(await scene.locator('.provider-identity').innerText(), 'ChatGPT');
    assert.equal(await scene.locator('.macos-native-panel-material').count(), 0);
    assert.equal(await scene.evaluate((node) => getComputedStyle(node).backgroundImage), 'none');
    const backdrop = await login.locator('.login-preview').evaluate((node) => ({
      background: getComputedStyle(node).backgroundImage,
      glow: getComputedStyle(node, '::before').opacity,
    }));
    assert.ok(backdrop.background.includes(dark ? 'rgb(37, 46, 62)' : 'rgb(230, 236, 244)'));
    assert.equal(backdrop.glow, '0.25');
    assert.match(
      await scene
        .locator('.floating-composer')
        .evaluate((node) => getComputedStyle(node).backdropFilter),
      /blur\(24px\)/,
    );
    if (process.argv.some((arg) => arg.startsWith('--screenshots='))) {
      const directory = process.argv.find((arg) => arg.startsWith('--screenshots=')).slice(14);
      assert.ok(path.isAbsolute(directory));
      await mkdir(directory, { recursive: true });
      await login.screenshot({
        path: path.join(directory, 'fallback-login-' + (dark ? 'dark' : 'light') + '.png'),
        animations: 'disabled',
      });
    }
  }
  const minimumContent = await (
    await app.browserWindow(login)
  ).evaluate((win) => {
    win.setSize(860, 580);
    return win.getContentSize();
  });
  // Windows clamps native minimum bounds and rounds frame insets at fractional
  // DPI. Test the actual minimum content viewport, rather than outer dimensions.
  await login
    .waitForFunction(
      ([width, height]) => Math.abs(innerWidth - width) <= 1 && Math.abs(innerHeight - height) <= 1,
      minimumContent,
    )
    .catch(async (error) => {
      const native = await (
        await app.browserWindow(login)
      ).evaluate((win) => ({
        bounds: win.getBounds(),
        content: win.getContentBounds(),
        minimum: win.getMinimumSize(),
      }));
      const renderer = await login.evaluate(() => ({
        width: innerWidth,
        height: innerHeight,
        dpi: devicePixelRatio,
      }));
      throw new Error('Minimum login bounds: ' + JSON.stringify({ native, renderer }), {
        cause: error,
      });
    });
  assert.ok(
    await login.locator('.login-preview .interview-font-preview').evaluate((node) => {
      const panels = [...node.children].map((child) => child.getBoundingClientRect());
      return (
        panels[0].right < panels[1].left &&
        panels.every((box) => box.top >= 0 && box.bottom <= innerHeight)
      );
    }),
    'Minimum login retains both preview panels side by side within the window',
  );
  for (const colorScheme of ['light', 'dark']) {
    await login.emulateMedia({ colorScheme });
    await login.waitForFunction(
      (dark) => document.documentElement.classList.contains('dark') === dark,
      colorScheme === 'dark',
    );
    await captureRequested(login, 'minimum-login-' + colorScheme);
  }
  const page = await connectUiAccount(app, login);
  page.setDefaultTimeout(15000);
  await page.waitForFunction(() => document.documentElement.classList.contains('web-materials'));
  assert.equal(await page.evaluate(() => 'setContentControls' in window.desktop), false);
  assert.equal(await page.locator('.macos-content-native,.macos-composer-slot').count(), 0);
  const idleClassWrites = await page.evaluate(async () => {
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    let writes = 0;
    const observer = new MutationObserver((records) => {
      writes += records.length;
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    await new Promise((resolve) => setTimeout(resolve, 250));
    observer.disconnect();
    return writes;
  });
  assert.ok(
    idleClassWrites <= 2,
    'Idle material observation must not schedule a perpetual animation loop: ' + idleClassWrites,
  );

  for (const dark of [false, true]) {
    await page.evaluate((dark) => document.documentElement.classList.toggle('dark', dark), dark);
    const start = page.locator('.interview-start-trigger');
    const shape = await start.evaluate((node) => ({
      radius: getComputedStyle(node).borderRadius,
      curve: getComputedStyle(node).getPropertyValue('corner-shape'),
      height: node.getBoundingClientRect().height,
    }));
    assert.deepEqual(cornerShapeNames(shape), { radius: '999px', curve: 'round', height: 36 });
    const composer = page.locator('.composer');
    const idle = await composer.evaluate((node) => ({
      radius: getComputedStyle(node).borderRadius,
      curve: getComputedStyle(node).getPropertyValue('corner-shape'),
      filter: getComputedStyle(node).backdropFilter,
    }));
    assert.equal(idle.radius, '40px');
    assert.match(idle.curve, /superellipse|squircle/);
    assert.match(idle.filter, /blur\(24px\)/);
    await captureRequested(page, 'preparation-' + (dark ? 'dark' : 'light'));
    await page.getByRole('button', { name: '聊天模型', exact: true }).click();
    const menu = page.getByRole('menu');
    assert.match(
      await menu.evaluate((node) => getComputedStyle(node).backdropFilter),
      /blur\(24px\)/,
    );
    assert.equal(
      await menu
        .locator('[role="menuitemradio"]')
        .first()
        .evaluate((node) => getComputedStyle(node).borderRadius),
      '999px',
    );
    const item = menu.locator('[role="menuitemradio"]').first();
    for (const accent of ['#16835d', '#8764b8']) {
      await app.evaluate(({ BrowserWindow }, color) => {
        for (const window of BrowserWindow.getAllWindows())
          window.webContents.send('appearance:accent-changed', color);
      }, accent);
      await focusUiWindow(app, page);
      await page.mouse.move(0, 0);
      await item.hover();
      await page
        .waitForFunction((accent) => {
          const node = document.querySelector('[role="menuitemradio"][data-highlighted]');
          return (
            node &&
            document.documentElement.style.getPropertyValue('--system-accent') === accent &&
            getComputedStyle(node).backgroundColor === 'rgba(128, 128, 128, 0.2)'
          );
        }, accent)
        .catch(async (error) => {
          console.error(
            await item.evaluate((node) => ({
              highlighted: node.hasAttribute('data-highlighted'),
              background: getComputedStyle(node).backgroundColor,
              accent: document.documentElement.style.getPropertyValue('--system-accent'),
            })),
          );
          throw error;
        });
      assert.equal(
        await item.evaluate((node) => getComputedStyle(node).color),
        dark ? 'rgb(231, 235, 237)' : 'rgb(37, 41, 43)',
      );
    }
    await captureRequested(page, 'model-menu-' + (dark ? 'dark' : 'light'));
    await page.keyboard.press('Escape');
  }
  const checkPanelHeader = async (selector, name) => {
    const panel = page.locator(selector);
    const scroll = panel.locator('.personal-panel-scroll, .record-answer-scroll');
    const header = panel.locator(':scope > header');
    await page.waitForFunction((selector) => {
      const panel = document.querySelector(selector);
      const header = panel.querySelector(':scope > header');
      return (
        parseFloat(panel.style.getPropertyValue('--panel-header-height')) ===
          header.getBoundingClientRect().height && panel.clientWidth > 250
      );
    }, selector);
    for (const dark of [false, true]) {
      await page.evaluate((dark) => document.documentElement.classList.toggle('dark', dark), dark);
      await scroll.evaluate((node) => {
        node.scrollTop = 0;
      });
      await page
        .waitForFunction(
          (selector) =>
            Number(
              getComputedStyle(document.querySelector(selector + ' > header'), '::before').opacity,
            ) <=
            1 / 64 / 24,
          selector,
        )
        .catch(async (error) => {
          const geometry = await panel.evaluate((node) => {
            const heading = node.querySelector(':scope > header');
            const scroll = node.querySelector('.personal-panel-scroll, .record-answer-scroll');
            return {
              opacity: getComputedStyle(heading, '::before').opacity,
              heading: heading.getBoundingClientRect().toJSON(),
              scrollTop: scroll.scrollTop,
              first: scroll.firstElementChild.getBoundingClientRect().toJSON(),
            };
          });
          throw Error(
            error.message + ' Header reset geometry: ' + JSON.stringify({ selector, geometry }),
          );
        });
      const initial = await header.boundingBox();
      const first = await scroll.locator(':scope > :visible').first().boundingBox();
      assert.ok(
        first.y >= initial.y + initial.height - 1,
        'First row must clear the fixed heading: ' + JSON.stringify({ initial, first }),
      );
      await scroll.evaluate((node) => {
        node.scrollTop = 180;
      });
      await page.waitForFunction(
        (selector) =>
          getComputedStyle(document.querySelector(selector + ' > header'), '::before').opacity ===
          '1',
        selector,
      );
      const scrolled = await header.boundingBox();
      assert.ok(
        Math.abs(scrolled.y - initial.y) < 1,
        'Heading stays fixed while content scrolls behind it',
      );
      const material = await header.evaluate((node) => {
        const own = getComputedStyle(node, '::before');
        const chat = getComputedStyle(document.querySelector('.page-toolbar'), '::before');
        return {
          filter: own.backdropFilter,
          fill: own.backgroundColor,
          chatFilter: chat.backdropFilter,
          chatFill: chat.backgroundColor,
        };
      });
      assert.equal(material.filter, material.chatFilter);
      assert.equal(material.fill, material.chatFill);
      assert.match(material.filter, /blur\(24px\)/);
      await captureRequested(page, name + '-header-' + (dark ? 'dark' : 'light'));
      await scroll.evaluate((node) => {
        node.scrollTop = node.scrollHeight;
      });
      assert.ok(
        await scroll.evaluate((node) => {
          const last = node.lastElementChild.getBoundingClientRect();
          const box = node.getBoundingClientRect();
          return last.bottom <= box.bottom + 1;
        }),
        'Last row remains fully reachable',
      );
    }
    await scroll.evaluate((node) => {
      node.scrollTop = 0;
    });
  };
  const infoToggle = page.getByRole('button', { name: '个人信息', exact: true });
  if ((await infoToggle.getAttribute('aria-expanded')) !== 'true') await infoToggle.click();
  await checkPanelHeader('.personal-panel', 'personal');
  await infoToggle.click();
  await page.getByRole('textbox', { name: '聊天消息', exact: true }).fill('共享回退材质检查');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await page.locator('.chat-copy').waitFor();
  const copyAlignment = await page.locator('.chat-message.assistant').evaluate((node) => ({
    text: node.querySelector('.chat-answer').getBoundingClientRect().left,
    icon: node.querySelector('.chat-copy svg').getBoundingClientRect().left,
  }));
  assert.ok(Math.abs(copyAlignment.text - copyAlignment.icon) < 1, JSON.stringify(copyAlignment));
  await page.locator('.chat-scroll').evaluate((node) => {
    node.scrollTop = 400;
  });
  await page.waitForFunction(
    () => Number(document.documentElement.style.getPropertyValue('--web-header-opacity')) === 1,
  );
  const latest = page.getByRole('button', { name: /返回最新/ });
  await latest.waitFor();
  assert.equal(await latest.evaluate((node) => getComputedStyle(node).borderRadius), '50%');
  const before = await latest.evaluate((node) => getComputedStyle(node).backgroundColor);
  await latest.hover();
  assert.notEqual(await latest.evaluate((node) => getComputedStyle(node).backgroundColor), before);
  await captureRequested(page, 'scrolled-header-follow');
  await latest.click();
  await page.getByRole('button', { name: '用户菜单', exact: true }).click();
  await page.getByRole('menuitem', { name: '设置', exact: true }).click();
  await page
    .getByRole('navigation', { name: '设置分类' })
    .getByRole('button', { name: '通用', exact: true })
    .click();
  const settings = page.getByRole('dialog', { name: '设置', exact: true });
  assert.equal(
    await settings.getByRole('slider', { name: '毛玻璃透明度', exact: true }).count(),
    0,
  );
  assert.equal(
    await page.evaluate(() => document.documentElement.dataset.frostedTransparency),
    '100',
  );
  await settings.getByRole('button', { name: '面试设置', exact: true }).click();
  assert.equal(
    await settings.getByRole('slider', { name: '面试背景透明度', exact: true }).count(),
    1,
  );
  assert.equal(
    await settings.getByRole('slider', { name: '面试背景透明度', exact: true }).getAttribute('max'),
    '100',
  );
  await settings.getByRole('slider', { name: '面试字体大小', exact: true }).waitFor();
  await captureRequested(page, 'settings-interview-preview');
  assert.equal(
    await settings.evaluate((node) => getComputedStyle(node, '::backdrop').backgroundColor),
    'rgba(0, 0, 0, 0.4)',
  );
  await settings.getByRole('button', { name: '关闭设置', exact: true }).click();
  await page.getByRole('button', { name: '面试记录', exact: true }).click();
  await page.evaluate(() => {
    const records = ['项目讨论', '自我介绍'].map((title, i) => ({
      id: 'synthetic-search-' + i,
      title,
      titleStatus: 'ready',
      startedAt: Date.now() - i * 60000,
      endedAt: Date.now(),
      status: 'ended',
      mock: false,
      transcripts: [],
      answers: [],
    }));
    localStorage.setItem('copilot-interview-history-v1', JSON.stringify(records));
    window.dispatchEvent(new StorageEvent('storage', { key: 'copilot-interview-history-v1' }));
  });
  await page.waitForFunction(() => document.querySelectorAll('.history-row').length === 2);
  const search = page.getByRole('searchbox', { name: '搜索标题' });
  for (const dark of [false, true]) {
    await page.evaluate((dark) => document.documentElement.classList.toggle('dark', dark), dark);
    await search.focus();
    assert.deepEqual(
      await search.evaluate((node) => ({
        height: Math.round(node.getBoundingClientRect().height * 100) / 100,
        radius: getComputedStyle(node).borderRadius,
        opacity: getComputedStyle(node).opacity,
      })),
      { height: 44, radius: '999px', opacity: '1' },
    );
    await captureRequested(page, 'search-empty-focused-' + (dark ? 'dark' : 'light'));
    await search.fill('项目');
    await page.waitForFunction(() => document.querySelectorAll('.history-row').length === 1);
    await captureRequested(page, 'search-filtered-' + (dark ? 'dark' : 'light'));
    const clear = page.getByRole('button', { name: '清除搜索', exact: true });
    await page.mouse.move(1, 1);
    await clear.evaluate((node) => node.blur());
    await page.waitForFunction(() =>
      document
        .getAnimations()
        .every(
          (animation) =>
            animation.effect?.getTiming().iterations === Infinity ||
            animation.playState !== 'running',
        ),
    );
    assert.equal(
      await clear.evaluate((node) => getComputedStyle(node).backgroundColor),
      'rgba(0, 0, 0, 0)',
    );
    assert.equal(await clear.evaluate((node) => getComputedStyle(node).borderRadius), '50%');
    await clear.click();
    assert.equal(await search.inputValue(), '');
    assert.equal(await search.evaluate((node) => document.activeElement === node), true);
    assert.equal(await clear.count(), 0);
    await page.waitForFunction(() => document.querySelectorAll('.history-row').length === 2);
  }
  await page.evaluate(() => {
    const records = Array.from({ length: 32 }, (_, i) => ({
      id: 'synthetic-scroll-' + i,
      title: '合成面试记录 ' + (i + 1),
      titleStatus: 'ready',
      startedAt: Date.now() - i * 60000,
      endedAt: Date.now(),
      status: 'ended',
      mock: false,
      transcripts: [],
      answers: Array.from({ length: 8 }, (_, j) => ({
        id: 'answer-' + j,
        question: '合成问题 ' + (j + 1),
        content: Array.from(
          { length: 5 },
          () => '这是一段用于滚动与标题毛玻璃检查的合成回答。',
        ).join('\n\n'),
        provider: 'chatgpt',
        createdAt: Date.now(),
      })),
    }));
    localStorage.setItem('copilot-interview-history-v1', JSON.stringify(records));
    window.dispatchEvent(new StorageEvent('storage', { key: 'copilot-interview-history-v1' }));
  });
  await page.waitForFunction(() => document.querySelectorAll('.history-row').length === 32);
  await page.locator('.management-scroll').evaluate((node) => {
    node.scrollTop = 320;
  });
  await page.waitForFunction(
    () => Number(document.documentElement.style.getPropertyValue('--web-header-opacity')) === 1,
  );
  for (const dark of [false, true]) {
    await page.evaluate((dark) => document.documentElement.classList.toggle('dark', dark), dark);
    await captureRequested(page, 'history-scrolled-header-' + (dark ? 'dark' : 'light'));
  }
  await page
    .locator('.history-row')
    .first()
    .locator('.history-row-open')
    .click({ position: { x: 16, y: 16 } });
  await page.getByRole('button', { name: 'AI 回答面板', exact: true }).click();
  await checkPanelHeader('.record-answer-panel', 'record-answer');
  await page.getByRole('button', { name: '新对话', exact: true }).click();
  for (const [width, dark] of [
    [1280, false],
    [960, true],
  ]) {
    await (await app.browserWindow(page)).evaluate((win, width) => win.setSize(width, 800), width);
    await page.evaluate((dark) => document.documentElement.classList.toggle('dark', dark), dark);
    const overflow = await page
      .locator('.composer')
      .evaluate(
        (node) =>
          node.getBoundingClientRect().left < 0 || node.getBoundingClientRect().right > innerWidth,
      );
    assert.equal(overflow, false);
    await captureRequested(page, 'composer-width-' + width);
    await infoToggle.click();
    await checkPanelHeader('.personal-panel', 'personal-width-' + width);
    await infoToggle.click();
    if (process.argv.includes('--preview')) {
      const file = path.join(testRoot, `web-materials-${width}-${dark ? 'dark' : 'light'}.png`);
      await page.screenshot({ path: file, animations: 'disabled' });
      console.log(JSON.stringify({ preview: file }));
      process.stdin.resume();
      await new Promise((resolve) => process.stdin.once('data', resolve));
      process.stdin.pause();
    }
  }
  console.log(
    'PASS: shared fallback capsules/circles, 40px composer, frosted menus/header/follow, hover, settings and narrow layout.',
  );
} finally {
  await closeUiApp(app);
}
