import { testRoot, electron } from './test-workspace.mjs';
import { closeUiApp } from './install-ui-account.mjs';

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const profile = path.resolve(path.join(testRoot, 'test/results'), `login-entry-${Date.now()}`);
await mkdir(profile, { recursive: true });
const isolatedAppData = path.join(profile, 'app-data');
await mkdir(isolatedAppData);
const fixture = path.join(profile, 'main.cjs');
await writeFile(
  fixture,
  `
const {app}=require('electron');
app.setAppPath(${JSON.stringify(process.cwd())});
const setPath=app.setPath.bind(app);
const getPath=app.getPath.bind(app);
app.getPath=name=>name==='appData'?${JSON.stringify(isolatedAppData)}:getPath(name);
app.setPath=(name,value)=>setPath(name,['userData','sessionData'].includes(name)?${JSON.stringify(profile)}:value);
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
  page.setDefaultTimeout(15000);
  await page.getByRole('heading', { name: '登录 VoxCue', exact: true }).waitFor();
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
  const preview = page.locator('.login-interview-preview');
  const waitForPhase = (phase) =>
    page.waitForFunction(
      (expected) =>
        document.querySelector('.login-interview-preview')?.dataset.previewPhase === expected,
      phase,
      { polling: 16, timeout: 12000 },
    );
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  // Open a fresh page under an explicit motion preference so the one-shot
  // sequence is observed from its start, independent of attachment timing.
  await page.reload();
  await page.getByRole('heading', { name: '登录 VoxCue', exact: true }).waitFor();
  await waitForPhase('question');
  assert.ok((await preview.locator('.transcript-item > p').innerText()).trim().length > 0);
  await waitForPhase('thinking');
  assert.equal(await preview.locator('.login-preview-thinking').innerText(), '正在思考');
  await waitForPhase('answering');
  await page.waitForFunction(
    () =>
      (document.querySelector('.login-interview-preview .answer-bubble')?.textContent.trim()
        .length ?? 0) > 0,
    undefined,
    { polling: 16 },
  );
  const partialAnswer = await preview.locator('.answer-bubble').textContent();
  const displayBefore = await preview.evaluate((node) => {
    const value = node.style.display;
    node.style.display = 'none';
    return value;
  });
  await page.waitForFunction(
    () => document.querySelector('.login-interview-preview')?.dataset.playing === 'false',
  );
  const offscreenAnswer = await preview.textContent();
  await page.waitForTimeout(250);
  assert.equal(await preview.textContent(), offscreenAnswer, 'Offscreen playback pauses');
  await preview.evaluate((node, value) => (node.style.display = value), displayBefore);
  await page.waitForFunction(
    () => document.querySelector('.login-interview-preview')?.dataset.playing === 'true',
  );
  assert.ok(
    (await preview.locator('.answer-bubble').textContent()).startsWith(partialAnswer),
    'Returning onscreen resumes the unfinished answer',
  );
  await page.waitForFunction(
    () => {
      const scene = document.querySelector('.login-interview-preview');
      const node = scene?.querySelector('.floating-answer .floating-scroll');
      return scene?.dataset.previewPhase === 'answering' && node?.scrollTop > 0;
    },
    undefined,
    { polling: 16 },
  );
  const followingGap = await preview
    .locator('.floating-answer .floating-scroll')
    .evaluate((node) => node.scrollHeight - node.clientHeight - node.scrollTop);
  assert.ok(Math.abs(followingGap) <= 1, 'Typing follows the latest answer text');
  await waitForPhase('complete');
  const completeAnswer = await preview.locator('.answer-bubble').textContent();
  assert.ok(completeAnswer.length > partialAnswer.length, 'Answer text is progressively revealed');
  assert.equal(await preview.locator('.answer-bubble .markdown-content > p').count(), 3);
  const reading = await preview.locator('.floating-answer .floating-scroll').evaluate((node) => {
    const panel = node.closest('.floating-panel').getBoundingClientRect();
    const bounds = node.getBoundingClientRect();
    return {
      bottomGap: node.scrollHeight - node.clientHeight - node.scrollTop,
      withinPanel: bounds.top >= panel.top && bounds.bottom <= panel.bottom,
    };
  });
  assert.ok(reading.withinPanel, 'Animated answer stays inside its panel');
  assert.ok(Math.abs(reading.bottomGap) <= 1, 'Completed answer stays on its final lines');
  assert.equal(await page.locator('.login-preview-content').evaluate((node) => node.inert), true);
  assert.equal(
    await preview.evaluate((node) =>
      [node, ...node.querySelectorAll('*')].every((element) => {
        const style = getComputedStyle(element);
        return style.userSelect === 'none' && style.cursor === 'default';
      }),
    ),
    true,
    'All decorative preview text uses an arrow and cannot be selected',
  );
  await page.evaluate(() => window.getSelection()?.removeAllRanges());
  const textBox = await preview.locator('.transcript-item > p').boundingBox();
  await page.mouse.move(textBox.x + 8, textBox.y + 8);
  await page.mouse.down();
  await page.mouse.move(textBox.x + textBox.width - 8, textBox.y + textBox.height - 8, {
    steps: 12,
  });
  await page.mouse.up();
  assert.equal(await page.evaluate(() => window.getSelection()?.toString() ?? ''), '');
  assert.equal(
    await preview.locator('textarea').evaluate((node) => {
      node.focus();
      return document.activeElement === node;
    }),
    false,
    'The decorative input cannot take focus',
  );
  assert.equal(
    await preview.evaluate(
      (node) =>
        [...node.querySelectorAll('button,input,textarea,select,a[href],[tabindex]')].filter(
          (target) => target.tabIndex >= 0 && !target.disabled,
        ).length,
    ),
    0,
    'The login animation has no keyboard interaction targets',
  );
  await page.waitForFunction(
    () => document.querySelector('.login-interview-preview')?.dataset.playing === 'false',
  );
  const completedPreview = await preview.textContent();
  await page.waitForTimeout(3000);
  assert.equal(await preview.getAttribute('data-preview-phase'), 'complete');
  assert.equal(await preview.getAttribute('data-playing'), 'false');
  assert.equal(await preview.textContent(), completedPreview, 'Completed playback never loops');
  for (const [button, title] of [
    ['注册', '创建账号'],
    ['返回登录', '登录 VoxCue'],
    ['找回密码', '重置密码'],
    ['返回登录', '登录 VoxCue'],
  ]) {
    await page.getByRole('button', { name: button, exact: true }).click();
    await page.getByRole('heading', { name: title, exact: true }).waitFor();
    assert.equal(await preview.getAttribute('data-preview-phase'), 'complete');
    assert.equal(await preview.getAttribute('data-playing'), 'false');
    assert.equal(await preview.textContent(), completedPreview, 'Auth mode changes do not replay');
  }
  // The Electron automation host keeps document.hidden false after a native
  // window hide. Native Page Visibility delivery is not exercised here.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.reload();
  await page.getByRole('heading', { name: '登录 VoxCue', exact: true }).waitFor();
  await waitForPhase('complete');
  await page.waitForFunction(
    () => document.querySelector('.login-interview-preview')?.dataset.playing === 'false',
  );
  const reducedAnswer = await preview.textContent();
  await page.waitForTimeout(350);
  assert.equal(await preview.textContent(), reducedAnswer, 'Reduced motion shows a stable answer');
  assert.equal(await preview.locator('.typing-caret:visible').count(), 0);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.waitForTimeout(350);
  assert.equal(await preview.getAttribute('data-preview-phase'), 'complete');
  await page.waitForFunction(
    () => document.querySelector('.login-interview-preview')?.dataset.playing === 'false',
  );
  assert.equal(
    await preview.textContent(),
    reducedAnswer,
    'Changing motion preference does not replay',
  );
  await page.screenshot({});
  console.log(
    JSON.stringify({
      passed: 9,
      profile,
      checks: [
        '登录界面没有 Mock 或测试入口',
        '非测试配置拒绝演示 IPC',
        '拒绝后仍处于未登录且未打开主窗口',
        '预览自动转写、思考及逐字回答，仅播放一次',
        '回答随最新内容滚动，完成后停在末行且保持面板内裁切',
        '预览文字不可选中，光标为箭头，无可聚焦交互控件',
        '预览离屏时暂停并在返回后恢复',
        '完成后停止播放，注册和重置密码切换不重播',
        '减少动态效果显示稳定完整回答，切换偏好不重播',
      ],
    }),
  );
} finally {
  await closeUiApp(app);
}
