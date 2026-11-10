import assert from 'node:assert/strict';
import path from 'node:path';
import { testRoot, electron } from './test-workspace.mjs';
import { offlineElectronEntry } from './offline-electron-entry.mjs';
import { installUiAccount, connectUiAccount, closeUiApp } from './install-ui-account.mjs';

// Owned temporary profile and synthetic records only. No native capture,
// production credential helper, downloads or persistent application data.
const app = await electron.launch({
  args: [await offlineElectronEntry()],
  env: {
    ...process.env,
    COPILOT_TEST_USER_DATA: path.join(testRoot, 'history-scroll'),
    VITE_DEV_SERVER_URL: '',
  },
});
const errors = [];
try {
  await installUiAccount(app, { components: true });
  const main = await connectUiAccount(app, await app.firstWindow());
  main.setDefaultTimeout(15000);
  main.on('pageerror', (error) => errors.push(error.message));
  await main.evaluate(() => {
    const now = Date.now();
    localStorage.setItem(
      'copilot-interview-history-v1',
      JSON.stringify(
        Array.from({ length: 60 }, (_, index) => ({
          id: 'scroll-fixture-' + index,
          title:
            'Scroll fixture ' +
            (index < 30 ? 'group-a ' : 'group-b ') +
            String(index).padStart(2, '0'),
          titleStatus: 'ready',
          titleSource: 'manual',
          startedAt: now - (index + 1) * 86400000,
          endedAt: now - (index + 1) * 86400000 + 60000,
          status: 'ended',
          mock: false,
          transcripts: [],
          answers: [],
        })),
      ),
    );
  });
  await main.getByRole('button', { name: '面试记录', exact: true }).click();
  const list = main.locator('.history-page .management-scroll');
  const search = main.getByRole('searchbox', { name: '搜索标题', exact: true });
  await list.waitFor();
  const settled = () => main.waitForFunction(() => !document.documentElement.dataset.viewDirection);
  const pick = async (top) => {
    await settled();
    const target = await list.evaluate((scroll, requested) => {
      scroll.scrollTop = requested;
      const viewport = scroll.getBoundingClientRect();
      const toolbar = scroll
        .closest('.history-page')
        .querySelector('.page-toolbar')
        .getBoundingClientRect();
      const visibleTop = Math.max(viewport.top, toolbar.bottom) + 20;
      const row = [...scroll.querySelectorAll('.history-row-open')].find((button) => {
        const bounds = button.getBoundingClientRect();
        return bounds.top >= visibleTop && bounds.bottom <= viewport.bottom - 20;
      });
      if (!row) throw Error('Synthetic history must contain a fully visible row');
      return { label: row.getAttribute('aria-label'), top: scroll.scrollTop };
    }, top);
    assert.ok(target.top > 100, 'The list must actually be scrolled away from the top');
    await main.getByRole('button', { name: target.label, exact: true }).click();
    await main.locator('.history-detail').waitFor();
    await settled();
    return target;
  };
  const assertPosition = async (previous) => {
    await list.waitFor();
    await settled();
    const value = await list.evaluate((scroll) => {
      const top = scroll.scrollTop;
      // Integer client/scroll extents lose the native fractional maximum at
      // scaled DPI. Measure that clamp without treating this probe as restore.
      scroll.scrollTop = Number.MAX_SAFE_INTEGER;
      const max = scroll.scrollTop;
      scroll.scrollTop = top;
      return { top, max };
    });
    assert.ok(
      Math.abs(value.top - Math.min(previous, value.max)) <= 1 / 64,
      `Expected previous list position ${previous} (max ${value.max}), received ${value.top}`,
    );
  };
  const remove = async () => {
    await main.getByRole('button', { name: '删除记录', exact: true }).click();
    await main.getByRole('button', { name: /^确认删除：面试记录：/ }).click();
  };
  await search.fill('Scroll fixture');
  let target = await pick(1300);
  await main.getByRole('button', { name: '返回面试记录', exact: true }).click();
  await assertPosition(target.top);
  assert.equal(await search.inputValue(), 'Scroll fixture');

  target = await pick(1300);
  await remove();
  await assertPosition(target.top);
  assert.equal(await main.getByRole('button', { name: target.label, exact: true }).count(), 0);
  assert.equal(await search.inputValue(), 'Scroll fixture');

  // Deleting near the filtered list's bottom must clamp to its new maximum,
  // rather than reset to zero or overwrite the current search.
  await search.fill('Scroll fixture group-a');
  target = await pick(Number.MAX_SAFE_INTEGER);
  await remove();
  await assertPosition(target.top);
  assert.equal(await search.inputValue(), 'Scroll fixture group-a');
  assert.deepEqual(errors, []);
  console.log(
    'PASS: history detail back and deletion restore the previous list scroll, retain search, and clamp a shortened filtered list; synthetic temporary profile only.',
  );
} finally {
  await closeUiApp(app);
}
