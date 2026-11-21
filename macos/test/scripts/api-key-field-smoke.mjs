import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import workspace from '../../../shared/scripts/workspace.mjs';
import { testRoot, electron } from '../../../shared/test/scripts/test-workspace.mjs';
import { closeUiApp, focusUiWindow } from '../../../shared/test/scripts/install-ui-account.mjs';
import { requireUnlockedDesktop } from './desktop-session.mjs';

requireUnlockedDesktop();
const probe = path.join(testRoot, 'secure-input-probe.node');
execFileSync('/usr/bin/xcrun', ['clang++', '-std=c++17', '-fobjc-arc', '-DNAPI_VERSION=8', '-bundle',
  '-undefined', 'dynamic_lookup', '-arch', 'arm64', '-mmacosx-version-min=14.2',
  '-I', path.join(workspace.platformRoot, '.cache/node-api-headers'),
  path.join(workspace.platformRoot, 'test/fixtures/secure-input-probe.mm'), '-framework', 'AppKit', '-o', probe]);
const fixture = path.join(testRoot, 'secure-input.cjs');
await writeFile(fixture, `
const { app, BrowserWindow } = require('electron');
const { promptApiKey, controlApiKey } = require(app.getAppPath() + '/dist-electron/macos/electron/apiKeyPrompt.js');
const field = { x: 40, y: 80, width: 160, height: 24, dark: false };
app.whenReady().then(async () => {
  const win = new BrowserWindow({ webPreferences: { sandbox:true, contextIsolation:true, nodeIntegration:false } });
  await win.loadURL('data:text/html,<title>Owned synthetic input</title><button>Tab target</button>');
  globalThis.input = {
    probe: require(${JSON.stringify(probe)}).probe,
    open() {
      this.controller = new AbortController();
      this.tab = undefined;
      this.result = promptApiKey(win, 'Synthetic', 'en', this.controller.signal, field, back => { this.tab = back; });
      this.result.catch(() => {});
    },
    control(command) { controlApiKey(win, command); },
    layout(dark) { this.control({action:'layout', field:{...field, x: 52, dark}}); }
  };
});
`);
const app = await electron.launch({ args: [fixture], env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined } });
try {
  const page = await app.firstWindow();
  await focusUiWindow(app, page);
  const observed = await app.evaluate(async () => {
    const end = Date.now() + 3000;
    while (!globalThis.input && Date.now() < end) await new Promise(r => setTimeout(r, 10));
    const input = globalThis.input;
    input.open();
    const mask = input.probe('type');
    input.layout(true);
    input.control({ action: 'visibility', visible: true });
    const shown = input.probe('inspect');
    input.control({ action: 'visibility', visible: false });
    const masked = input.probe('tab');
    while (input.tab === undefined && Date.now() < end) await new Promise(r => setTimeout(r, 10));
    const tab = input.tab;
    input.control({ action: 'focus' });
    input.probe('enter');
    const submitted = await input.result;
    const closed = input.probe('inspect');
    input.open();
    input.controller.abort();
    const cancelled = await input.result.then(() => false, error => error.name === 'AbortError');
    return { mask, shown, masked, tab, correct: submitted === 'synthetic-api-key', closed, cancelled };
  });
  assert.deepEqual(observed, { mask: 'masked', shown: 'visible', masked: 'masked', tab: false,
    correct: true, closed: 'closed', cancelled: true });
  assert.equal(await page.evaluate(() => document.documentElement.outerHTML.includes('synthetic-api-key')), false);
  console.log('PASS AppKit secure field masking, reveal, focus, Tab, Enter, cancellation and renderer isolation.');
} finally { await closeUiApp(app); }
