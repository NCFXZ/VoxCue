import { testRoot, electron } from './test-workspace.mjs';
import { offlineElectronEntry } from './offline-electron-entry.mjs';
import { closeUiApp, installUiAccount } from './install-ui-account.mjs';
import path from 'node:path';
import assert from 'node:assert/strict';
const app = await electron.launch({
  args: [await offlineElectronEntry()],
  env: {
    ...process.env,
    COPILOT_TEST_USER_DATA: path.join(testRoot, 'profile'),
    VITE_DEV_SERVER_URL: '',
  },
});
try {
  await installUiAccount(app);
  const login = await app.firstWindow();
  await login.getByRole('button', { name: '使用 ChatGPT 继续', exact: true }).waitFor();
  const [page] = await Promise.all([
    app.waitForEvent('window'),
    login.getByRole('button', { name: '使用 ChatGPT 继续', exact: true }).click(),
  ]);
  page.setDefaultTimeout(10000);
  const surface = page;
  const input = surface.getByRole('textbox', { name: '聊天消息', exact: true });
  await input.waitFor();
  const dimensions = async () => ({
    foreground: await surface.locator('.composer').boundingBox(),
    area: await page.locator('.composer-area').boundingBox(),
    text: await input.evaluate((element) => ({
      height: element.clientHeight,
      scrollHeight: element.scrollHeight,
      value: element.value.length,
    })),
  });
  const samples = [];
  for (const [label, text] of [
    ['short', '一行'],
    ['wrapped', '需要自动换行的合成文字。'.repeat(32)],
    ['multiline', Array.from({ length: 9 }, (_, i) => '第' + i + '行').join('\n')],
    ['capped', Array.from({ length: 25 }, () => '大量换行').join('\n')],
    ['cleared', ''],
  ]) {
    await input.fill(text);
    await new Promise((resolve) => setTimeout(resolve, 50));
    samples.push({ label, ...(await dimensions()) });
  }
  console.log(JSON.stringify(samples));
  assert.ok(
    samples.at(-2).text.scrollHeight > samples.at(-2).text.height,
    'Long input uses bounded internal scrolling',
  );
  const first = samples[0],
    last = samples.at(-1);
  assert.ok(samples[2].text.height > first.text.height, 'New lines expand the editor');
  assert.ok(
    Math.abs(last.text.height - first.text.height) < 2,
    'Clearing immediately restores editor height',
  );
  for (const sample of samples) {
    assert.ok(
      Math.abs(sample.area.height - sample.foreground.height) < 2,
      'Shared/native composer height stays synchronized',
    );
    if (surface !== page)
      assert.ok(
        Math.abs(sample.area.y - sample.foreground.y) < 2,
        'Native foreground follows the anchored composer',
      );
  }
  console.log('Composer wrap/newline/delete geometry passed; isolated synthetic input.');
} finally {
  await closeUiApp(app);
}
