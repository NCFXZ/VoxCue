import { testRoot, electron } from '../../../shared/test/scripts/test-workspace.mjs';
import { closeUiApp } from '../../../shared/test/scripts/install-ui-account.mjs';
import workspace from '../../../shared/scripts/workspace.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

// A component behavior fixture in Electron: no native icons/visual acceptance,
// production main, credentials, server or network. The production component and
// React event/effect lifecycle are bundled unchanged; only its async store port
// and decorative icon are replaced inside this owned test window.
const { build } = workspace.platformRequire('esbuild');
const bundle = await build({
  stdin: {
    contents: `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {CloudAccountPanel} from ${JSON.stringify(path.join(workspace.sharedRoot, 'src/components/CloudAccountPanel.tsx'))};
import {useCloudAccount} from ${JSON.stringify(path.join(workspace.sharedRoot, 'src/stores/cloudAccount.ts'))};
import {useGeneralSettings} from ${JSON.stringify(path.join(workspace.sharedRoot, 'src/stores/generalSettings.ts'))};
useGeneralSettings.setState({language:'zh-CN'});
const pending=[],calls=[];
window.desktop={cloudAccount:()=>{throw Error('Unexpected IPC')}};
const state={configured:true,verified:false,user:null};
useCloudAccount.setState({loaded:true,state,call:call=>{calls.push(call);return new Promise(resolve=>pending.push(resolve))}});
let root;
window.cloudFormTest={calls,state,
 mount(){root=createRoot(document.getElementById('root'));root.render(<CloudAccountPanel entry/>);},
 unmount(){root.unmount();},finish(value){const resolve=pending.shift();if(!resolve)throw Error('No held call');resolve({...value,state});}
};
window.cloudFormTest.mount();`,
    resolveDir: workspace.platformRoot,
    loader: 'tsx',
  },
  bundle: true,
  nodePaths: [path.join(workspace.platformRoot, 'node_modules')],
  write: false,
  format: 'iife',
  platform: 'browser',
  jsx: 'automatic',
  plugins: [
    {
      name: 'logic-only-icon',
      setup(bundler) {
        bundler.onResolve({ filter: /^\.\/icons$/ }, (args) =>
          args.importer.endsWith('/CloudAccountPanel.tsx')
            ? { path: 'icons', namespace: 'fixture' }
            : undefined,
        );
        bundler.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
          contents: 'export function LogOut(){return null}',
          loader: 'js',
        }));
      },
    },
  ],
});
await writeFile(path.join(testRoot, 'bundle.js'), bundle.outputFiles[0].contents);
await writeFile(
  path.join(testRoot, 'index.html'),
  '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'self\'"><div id="root"></div><script src="bundle.js"></script>',
);
const entry = path.join(testRoot, 'entry.cjs');
await mkdir(path.join(testRoot, 'profile'));
await writeFile(
  entry,
  `const {app,BrowserWindow}=require('electron');app.setAppPath(${JSON.stringify(workspace.platformRoot)});app.setPath('userData',${JSON.stringify(path.join(testRoot, 'profile'))});app.whenReady().then(()=>{const win=new BrowserWindow({width:1000,height:660,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});win.loadFile(${JSON.stringify(path.join(testRoot, 'index.html'))});});`,
);
const app = await electron.launch({
  args: [entry],
  env: {
    ...process.env,
    COPILOT_TEST_USER_DATA: path.join(testRoot, 'profile'),
    VITE_DEV_SERVER_URL: '',
  },
});
try {
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const form = page.locator('form');
  await page.getByLabel('邮箱', { exact: true }).fill('synthetic@example.test');
  await page.getByLabel('密码', { exact: true }).fill('legacy');
  await form.getByRole('button', { name: '登录', exact: true }).click();
  await form.evaluate((node) => {
    for (let i = 0; i < 5; i++)
      node.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => window.cloudFormTest.calls.length), 1);
  assert.equal(await page.getByRole('button', { name: '注册', exact: true }).isDisabled(), true);
  assert.equal(await page.getByLabel('邮箱', { exact: true }).isDisabled(), true);
  await page.evaluate(() => window.cloudFormTest.finish({ ok: false, error: 'Synthetic failure' }));
  await page.getByRole('alert').getByText('Synthetic failure', { exact: true }).waitFor();
  await page.getByRole('button', { name: '注册', exact: true }).click();
  assert.equal(await page.getByLabel('密码', { exact: true }).inputValue(), '');
  assert.equal(await page.getByRole('alert').count(), 0);
  await page.getByRole('button', { name: '获取验证码', exact: true }).click();
  assert.equal(await page.evaluate(() => window.cloudFormTest.calls.length), 2);
  await page.evaluate(() => window.cloudFormTest.unmount());
  assert.equal(await form.count(), 0);
  await page.evaluate(() => window.cloudFormTest.mount());
  await form.getByRole('button', { name: '登录', exact: true }).waitFor();
  await page.evaluate(() =>
    window.cloudFormTest.finish({
      ok: true,
      challenge: {
        id: 'a0000000-0000-4000-8000-000000000001',
        expiresInSeconds: 300,
        retryAfterSeconds: 60,
      },
    }),
  );
  await page.waitForTimeout(30);
  assert.equal(await page.getByRole('status').count(), 0);
  assert.equal(await page.getByLabel('邮箱验证码', { exact: true }).count(), 0);
  assert.equal(await page.getByLabel('密码', { exact: true }).inputValue(), '');
  await page.getByLabel('邮箱', { exact: true }).fill('next@example.test');
  await page.getByLabel('密码', { exact: true }).fill('next legacy');
  await form.getByRole('button', { name: '登录', exact: true }).click();
  assert.equal(await page.evaluate(() => window.cloudFormTest.calls.length), 3);
  await page.evaluate(() => {
    window.cloudFormTest.unmount();
    window.cloudFormTest.mount();
    window.cloudFormTest.finish({ ok: false, error: 'Late private error', retryAfterSeconds: 60 });
  });
  await form.getByRole('button', { name: '登录', exact: true }).waitFor();
  assert.equal(await page.getByRole('alert').count(), 0);
  assert.equal(await form.getByRole('button', { name: '登录', exact: true }).isEnabled(), true);
  assert.deepEqual(errors, []);
  console.log(
    'PASS: repeated submit/Enter sends once; busy locks modes; switching clears secrets/error; unmounted challenge/error cannot fill or block a fresh component. Logic fixture only, no account/Keychain/network.',
  );
} finally {
  await closeUiApp(app);
}
