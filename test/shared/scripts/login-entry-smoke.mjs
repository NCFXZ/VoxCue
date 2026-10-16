import { closeUiApp } from './install-ui-account.mjs';
import { _electron as electron } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const profile = path.resolve('test/results', `login-entry-${Date.now()}`);
await mkdir(profile, { recursive: true });
const fixture = path.join(profile, 'main.cjs');
await writeFile(
  fixture,
  `
const {app}=require('electron');
app.setAppPath(${JSON.stringify(process.cwd())});
const setPath=app.setPath.bind(app);
app.setPath=(name,value)=>setPath(name,name==='userData'?${JSON.stringify(profile)}:value);
const {ChatGPTAuthService}=require(${JSON.stringify(path.resolve('dist-electron/shared/electron/backend/auth/service.js'))});
ChatGPTAuthService.prototype.session=async()=>null;
require(${JSON.stringify(path.resolve('dist-electron/shared/electron/main.js'))});
`,
);
const env = { ...process.env, VITE_DEV_SERVER_URL: '' };
delete env.ELECTRON_RUN_AS_NODE;
delete env.COPILOT_TEST_USER_DATA;
const app = await electron.launch({ args: [fixture], env });
try {
  const page = await app.firstWindow();
  await page.getByRole('button', { name: '使用 ChatGPT 继续', exact: true }).waitFor();
  assert.equal(/mock|模拟/i.test(await page.locator('body').innerText()), false);
  assert.equal(await page.getByRole('button', { name: /体验|测试|Mock/ }).count(), 0);
  assert.equal(
    await page.evaluate(async () => {
      try {
        await window.desktop.enterDemo();
        return false;
      } catch {
        return true;
      }
    }),
    true,
  );
  assert.equal(await page.evaluate(() => window.desktop.authSession()), null);
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1);
  await page.screenshot({ path: path.join(profile, 'login.png') });
  console.log(
    JSON.stringify({
      passed: 3,
      profile,
      checks: [
        '登录界面没有 Mock 或测试入口',
        '非测试配置拒绝演示 IPC',
        '拒绝后仍处于未登录且未打开主窗口',
      ],
    }),
  );
} finally {
  await closeUiApp(app);
}
