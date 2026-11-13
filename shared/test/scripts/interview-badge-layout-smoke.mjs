import assert from 'node:assert/strict';
import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import { testRoot, electron } from './test-workspace.mjs';
import { offlineElectronEntry } from './offline-electron-entry.mjs';
import { enterDemoUiAccount, installUiAccount, closeUiApp } from './install-ui-account.mjs';

// Explicit demo mode, synthetic device state and key-registration port only.
// The real header renders normally; no audio capture, credentials or screenshots.
const fixture = path.join(testRoot, 'interview-badges-entry.cjs');
await writeFile(
  fixture,
  `
const {globalShortcut}=require('electron');
globalShortcut.register=()=>true;globalShortcut.unregister=()=>{};
require(${JSON.stringify(path.resolve('dist-electron/shared/electron/main.js'))});
`,
);
const app = await electron.launch({
  args: [await offlineElectronEntry(fixture)],
  env: {
    ...process.env,
    COPILOT_TEST_USER_DATA: path.join(testRoot, 'badge-layout'),
    VITE_DEV_SERVER_URL: '',
  },
});
try {
  await installUiAccount(app, { components: true });
  const login = await app.firstWindow();
  await login.getByRole('heading', { name: '登录 VoxCue', exact: true }).waitFor();
  const [main] = await Promise.all([app.waitForEvent('window'), enterDemoUiAccount(app, login)]);
  const [interview] = await Promise.all([
    app.waitForEvent('window'),
    main.evaluate(() =>
      window.desktop.openInterview({
        mode: 'mock',
        inputMode: 'remote',
        options: { sources: [] },
        aiEnabled: false,
        autoAnswer: false,
        modelId: '',
        effort: 'auto',
      }),
    ),
  ]);
  interview.setDefaultTimeout(10000);
  await interview.locator('.floating-transcript').waitFor();
  await app.evaluate(({ BrowserWindow }) => {
    const owner = BrowserWindow.getAllWindows().find((win) =>
      win.webContents.getURL().endsWith('#interview'),
    );
    owner.webContents.send('remote:state', {
      status: 'connected',
      revision: 100000,
      presentationOwner: 'interview',
      addresses: [],
      clientName: 'Synthetic device',
      pending: null,
      error: null,
    });
  });
  await interview.locator('.floating-transcript .interview-ready-badge').nth(3).waitFor();
  for (const language of ['zh-CN', 'en']) {
    await interview.evaluate((language) => {
      localStorage.setItem('voxcue-language-v1', language);
      dispatchEvent(new StorageEvent('storage', { key: 'voxcue-language-v1' }));
    }, language);
    await interview.waitForFunction(
      (language) => document.documentElement.lang === language,
      language,
    );
    for (const width of [700, 340]) {
      const geometry = await interview
        .locator('.floating-transcript')
        .evaluate(async (panel, width) => {
          panel.style.width = width + 'px';
          panel.style.flex = 'none';
          await new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          );
          const badges = [...panel.querySelectorAll('.interview-ready-badge')].map((node) =>
            node.getBoundingClientRect(),
          );
          const rows = new Map();
          for (const badge of badges) {
            const top = Math.round(badge.top);
            rows.set(top, (rows.get(top) ?? 0) + 1);
          }
          const title = panel.querySelector('h2').getBoundingClientRect();
          const group = panel.querySelector('.interview-ready-badges').getBoundingClientRect();
          return {
            rows: [...rows.values()],
            titleCenter: title.top + title.height / 2,
            groupCenter: group.top + group.height / 2,
          };
        }, width);
      assert.deepEqual(geometry.rows, width === 700 ? [4] : [2, 2], `${language}: ${width}px`);
      assert.ok(
        Math.abs(geometry.titleCenter - geometry.groupCenter) <= 1,
        `${language}: title and badges center vertically`,
      );
    }
  }
  await interview.getByRole('button', { name: 'End interview', exact: true }).click();
  const closed = interview.waitForEvent('close');
  await interview.getByRole('button', { name: 'Confirm end interview', exact: true }).click();
  await closed;
  console.log(
    'PASS: actual interview header uses one row or 2+2 with device connected, vertically centered with its title in Chinese and English. No hardware or real account.',
  );
} finally {
  await closeUiApp(app);
}
