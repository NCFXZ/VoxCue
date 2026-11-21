import assert from 'node:assert/strict';

// Measure the visible control, card or first line box. The row around it can
// have its own padding and can be taller than either of its children.
const firstContent = {
  '面试设置': '.interview-input-mode > :is(h3, [role="radiogroup"])',
  'VoxCue 账号': '.cloud-account-panel > .settings-entry:first-child > :is(div, button)',
  'AI 服务': '.ai-services-panel > p:first-child',
  '本地组件': '.components-panel',
  '通用': '.settings-entry:first-child > :is(strong, .settings-choice)',
  '快捷键': '.shortcut-setting-row:first-child > :is(div, button)',
  '关于与更新': '.settings-entry:first-child > :is(strong, .settings-value)',
};

export async function assertSettingsHeadingGaps(page, names = Object.keys(firstContent)) {
  const settings = page.getByRole('dialog', { name: '设置', exact: true });
  const gaps = {};
  for (const name of new Set(['面试设置', ...names])) {
    await settings
      .getByRole('navigation', { name: '设置分类' })
      .getByRole('button', { name, exact: true })
      .click();
    await settings.getByRole('heading', { name, exact: true }).waitFor();
    const items = settings.locator('.settings-content-body').locator(firstContent[name]);
    await items.first().waitFor();
    await page.waitForFunction(() => !document.documentElement.dataset.viewDirection);
    gaps[name] = await items.evaluateAll((nodes) => {
      const title = document.querySelector('#settings-category-title').getBoundingClientRect();
      return Math.min(...nodes.map((node) => node.getBoundingClientRect().top)) - title.bottom;
    });
  }
  const reference = gaps['面试设置'];
  assert.ok(
    reference > 0 && Object.values(gaps).every((gap) => Math.abs(gap - reference) <= 1),
    'First visible settings content must align with interview mode: ' + JSON.stringify(gaps),
  );
}
