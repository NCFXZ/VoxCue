import { connectUiAccount, installUiAccount, closeUiApp, focusUiWindow } from './install-ui-account.mjs';
import { testRoot, electron } from './test-workspace.mjs';
import { offlineElectronEntry } from './offline-electron-entry.mjs';
import { mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const profile = await mkdtemp(path.join(testRoot, 'preparation-guide-'));
const app = await electron.launch({
  args: [await offlineElectronEntry()],
  env: { ...process.env, COPILOT_TEST_USER_DATA: profile, VITE_DEV_SERVER_URL: '' },
});
try {
  await installUiAccount(app, { speech: true, components: true });
  await app.evaluate(({ app, shell }) => {
    const require = process
      .getBuiltinModule('module')
      .createRequire(app.getAppPath() + '/package.json');
    const { ChatGPTService } = require(
      app.getAppPath() + '/dist-electron/shared/electron/backend/chat/service.js',
    );
    globalThis.guideRequests = [];
    globalThis.guideLinks = [];
    shell.openExternal = async (url) => {
      globalThis.guideLinks.push(url);
      if (globalThis.guideLinkFail) throw Error('synthetic guide link failure');
    };
    ChatGPTService.prototype.stream = async (request, emit) => {
      globalThis.guideRequests.push(request);
      const profileChanges =
        request.profileTask === 'skills'
          ? {
              skills: [
                {
                  id: 'synthetic-topic',
                  title: '接口设计',
                  content: '合成面试参考资料。',
                  sources: [],
                },
              ],
            }
          : !request.profile.background
            ? { background: '合成简历：负责桌面应用与接口开发。' }
            : { jobDescription: '合成职位描述：应用开发与接口设计。' };
      const answerText = '已整理，请检查并确认保存。';
      emit({ id: request.id, type: 'delta', text: answerText });
      return { answerText, profileChanges, usage: null, sources: [] };
    };
  });
  const page = await connectUiAccount(app, await app.firstWindow());
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const guide = page.locator('.preparation-guide');
  const expectStep = async (step) => {
    await guide.waitFor();
    const labels = {
      resume: ['上传简历', '粘贴简历内容', '添加职位描述'],
      job: ['添加职位描述', '更新简历', '开始面试'],
      skills: ['生成技能', '查看个人资料', '开始面试'],
      ready: ['开始面试', '更新技能', '查看个人资料'],
    };
    assert.equal(await guide.count(), 1);
    assert.deepEqual(await guide.getByRole('button').allTextContents(), labels[step]);
    assert.equal(await guide.locator('.preparation-guide-description > .is-active').count(), 1);
    await guide.getByRole('heading', { name: '接下来想做什么？', exact: true }).waitFor();
  };
  const saved = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('copilot-personal-info-v1') || 'null'));
  const send = () => page.getByRole('button', { name: '发送消息', exact: true }).click();
  const confirm = async () => {
    const proposal = page.getByRole('region', { name: '待确认的资料更新', exact: true }).last();
    await proposal.getByRole('button', { name: '保存所选', exact: true }).click();
    await proposal.getByText('已保存所选资料', { exact: true }).waitFor();
  };
  const measure = async (label) => {
    const dimensions = await guide.evaluate((element) => {
      const body = element.getBoundingClientRect();
      const actions = element.querySelector('.preparation-guide-actions').getBoundingClientRect();
      const buttons = [...element.querySelectorAll('button')];
      const link = element.querySelector('a').getBoundingClientRect();
      const rects = buttons.map((button) => button.getBoundingClientRect());
      const left = Math.min(...rects.map((rect) => rect.left));
      const right = Math.max(...rects.map((rect) => rect.right));
      return {
        overflow: [...element.querySelectorAll('button,a,p')].some(
          (node) => node.scrollWidth > node.clientWidth + 1,
        ),
        aligned:
          Math.abs((left + right - body.left - body.right) / 2) < 1 &&
          Math.abs((link.left + link.right - body.left - body.right) / 2) < 1,
        noOverlap: link.top >= Math.max(...rects.map((rect) => rect.bottom)),
        within: left >= actions.left - 1 && right <= actions.right + 1,
      };
    });
    assert.deepEqual(
      dimensions,
      { overflow: false, aligned: true, noOverlap: true, within: true },
      label,
    );
    console.log(label, JSON.stringify(dimensions));
  };
  const checkDescriptions = async () => {
    const description = guide.locator('.preparation-guide-description');
    const defaultDescription = description.locator('[id$="-default"].is-active[aria-hidden="false"]');
    await focusUiWindow(app, page);
    await guide.getByRole('heading').hover();
    await defaultDescription.waitFor();
    const defaultText = await defaultDescription.innerText();
    const row = guide.locator('.preparation-guide-actions');
    const before = await row.boundingBox();
    for (const button of await guide.getByRole('button').all()) {
      const id = await button.getAttribute('aria-describedby');
      assert.ok(id);
      await button.hover();
      // Sample the hover, its React description and its fade in the same
      // animation frame. A mouseleave between IPC reads restores the default.
      const sample = await page.waitForFunction((id) => {
        const selected = document.getElementById(id);
        const element = selected?.parentElement;
        const target = element?.closest('.preparation-guide')?.querySelector('button:hover');
        if (!selected || target?.getAttribute('aria-describedby') !== id || !selected.classList.contains('is-active'))
          return false;
        const transitions = element.getAnimations({ subtree: true })
          .filter((animation) => animation.transitionProperty === 'opacity');
        if (!transitions.length) return false;
        for (const animation of transitions) {
          animation.pause();
          animation.currentTime = Number(animation.effect.getTiming().duration) / 2;
        }
        const fading = [...element.children].some((child) => {
          const opacity = Number(getComputedStyle(child).opacity);
          return opacity > 0 && opacity < 1;
        });
        for (const animation of transitions) animation.finish();
        return {
          id: element.querySelector('.is-active').id,
          text: selected.innerText,
          ariaHidden: selected.getAttribute('aria-hidden'),
          fading,
          rowY: target.parentElement.getBoundingClientRect().y,
        };
      }, id);
      const observed = await sample.jsonValue();
      await sample.dispose();
      assert.equal(observed.id, id);
      assert.equal(observed.ariaHidden, 'false');
      assert.notEqual(observed.text, defaultText);
      assert(observed.fading, 'subtitle changes through intermediate opacity');
      assert(Math.abs(before.y - observed.rowY) < 1, 'subtitle does not move buttons');
    }
    await guide.getByRole('heading').hover();
    await defaultDescription.waitFor();
    assert.equal(await defaultDescription.innerText(), defaultText);
    // Enter the last choice via the keyboard, without invoking its action.
    await guide.getByRole('link').focus();
    await page.keyboard.press('Shift+Tab');
    const last = guide.getByRole('button').last();
    await page.waitForFunction(
      (id) => document.activeElement?.getAttribute('aria-describedby') === id &&
        document.getElementById(id)?.matches('.is-active[aria-hidden="false"]'),
      await last.getAttribute('aria-describedby'),
    );
    await guide.getByRole('link').focus();
    await defaultDescription.waitFor();
    assert.equal(await defaultDescription.innerText(), defaultText);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await last.hover();
    await page.waitForFunction((id) => {
      const label = document.getElementById(id);
      return label?.matches('.is-active[aria-hidden="false"]') && getComputedStyle(label).opacity === '1';
    }, await last.getAttribute('aria-describedby'));
    assert.equal(
      await description.evaluate((element) => element.getAnimations({ subtree: true }).length),
      0,
    );
    await guide.getByRole('heading').hover();
    await page.emulateMedia({ reducedMotion: 'no-preference' });
  };
  const verifyGuideLink = async (language) => {
    const english = language === 'en';
    const url = english
      ? 'https://voxcue.com.cn/en/install/?lang=en'
      : 'https://voxcue.com.cn/install/?lang=zh-CN';
    const error = english
      ? 'Could not open the user guide. Please try again.'
      : '无法打开使用指南，请稍后重试。';
    const link = guide.getByRole('link', { name: english ? 'User guide' : '使用指南', exact: true });
    assert.equal(await link.getAttribute('href'), url);
    await app.evaluate(() => {
      globalThis.guideLinkFail = true;
    });
    await link.focus();
    await link.press('Enter');
    await guide.getByRole('alert').filter({ hasText: error }).waitFor();
    await app.evaluate(() => {
      globalThis.guideLinkFail = false;
    });
    await link.press('Enter');
    await guide.getByText(error, { exact: true }).waitFor({ state: 'hidden' });
    assert.deepEqual(await app.evaluate(() => globalThis.guideLinks.slice(-2)), [url, url]);
  };
  await expectStep('resume');
  for (const language of ['zh-CN', 'en']) {
    await page.evaluate((value) => {
      localStorage.setItem('voxcue-language-v1', value);
      dispatchEvent(new StorageEvent('storage', { key: 'voxcue-language-v1' }));
    }, language);
    await verifyGuideLink(language);
    for (const width of [1280, 960]) {
      const window = await app.browserWindow(page);
      await window.evaluate((win, width) => win.setSize(width, 800), width);
      await page.waitForFunction((width) => Math.abs(innerWidth - width) < 20, width);
      for (const dark of [false, true]) {
        await page.evaluate(
          (dark) => document.documentElement.classList.toggle('dark', dark),
          dark,
        );
        await page.waitForFunction(() =>
          document
            .getAnimations()
            .every(
              (a) => a.effect?.getTiming().iterations === Infinity || a.playState !== 'running',
            ),
        );
        await measure(`${language} ${width} ${dark ? 'dark' : 'light'}`);
        await checkDescriptions();
      }
    }
    if (process.argv.includes('--preview'))
      console.log(
        'IMAGE:' +
          (await page.screenshot({ type: 'jpeg', quality: 65, scale: 'css' })).toString('base64'),
      );
  }
  await guide.getByRole('button', { name: 'Add job description', exact: true }).click();
  const englishDraft = page.getByRole('textbox', { name: 'Chat message', exact: true });
  assert.match(await englishDraft.inputValue(), /after I confirm and save/);
  assert.match(await englishDraft.inputValue(), /If I already have skills, ask whether to update/);
  await englishDraft.fill('');
  await page.evaluate(() => {
    localStorage.setItem('voxcue-language-v1', 'zh-CN');
    dispatchEvent(new StorageEvent('storage', { key: 'voxcue-language-v1' }));
    document.documentElement.classList.remove('dark');
  });
  await verifyGuideLink('zh-CN');
  await guide.getByRole('button', { name: '粘贴简历内容', exact: true }).click();
  const input = page.getByRole('textbox', { name: '聊天消息', exact: true });
  assert((await input.inputValue()).includes('以下是简历内容：'));
  assert.equal(await app.evaluate(() => globalThis.guideRequests.length), 0);
  await input.fill((await input.inputValue()) + '合成简历');
  await send();
  await page.getByRole('region', { name: '待确认的资料更新', exact: true }).waitFor();
  assert.equal(await saved(), null);
  assert.equal(await guide.count(), 0);
  await confirm();
  assert.equal(await guide.count(), 0, 'saved resume does not insert a guide in chat');
  await page.reload();
  await page.locator('.chat-message.assistant').first().waitFor();
  assert.equal(await guide.count(), 0, 'reloaded chat does not insert a guide');
  await page.getByRole('button', { name: '新对话', exact: true }).click();
  await expectStep('job');
  await measure('new chat after saved resume');
  if (process.argv.includes('--preview'))
    console.log(
      'IMAGE:' +
        (await page.screenshot({ type: 'jpeg', quality: 65, scale: 'css' })).toString('base64'),
    );
  const resume = await saved();
  await guide.getByRole('button', { name: '开始面试', exact: true }).click();
  assert.deepEqual(await saved(), resume);
  const start = page.getByRole('dialog', { name: '开始面试', exact: true });
  await start.waitFor();
  await start.getByRole('button', { name: '取消', exact: true }).click();
  await page.reload();
  await page.getByRole('button', { name: '新对话', exact: true }).click();
  await expectStep('job');
  await guide.getByRole('button', { name: '添加职位描述', exact: true }).click();
  await input.fill((await input.inputValue()) + '合成职位描述');
  await send();
  await page.getByRole('region', { name: '待确认的资料更新', exact: true }).waitFor();
  const jdRequest = await app.evaluate(() => globalThis.guideRequests.at(-1));
  assert.equal(jdRequest.profile.background, resume.background);
  assert.equal(jdRequest.profile.jobDescription, '');
  assert.equal(jdRequest.profileTask, undefined, 'a follow-up invitation is not a skill task');
  assert.equal(jdRequest.webSearch, true, 'search is available without forcing a skill task');
  assert.match(jdRequest.turns.at(-1).content, /确认保存后是否需要生成相关面试技能/);
  assert.match(jdRequest.turns.at(-1).content, /已有技能时改为询问是否更新/);
  assert.equal((await saved()).jobDescription, '', 'the JD still requires confirmation');
  await confirm();
  assert.equal(await guide.count(), 0, 'saved JD does not insert a guide in chat');
  await page.getByRole('button', { name: '新对话', exact: true }).click();
  await expectStep('skills');
  await guide.getByRole('button', { name: '生成技能', exact: true }).click();
  await confirm();
  assert.equal(await guide.count(), 0);
  assert.equal((await saved()).skills.length, 1);
  await page.getByRole('button', { name: '新对话', exact: true }).click();
  await expectStep('ready');
  await page.reload();
  await expectStep('ready');
  await page.getByRole('button', { name: '用户菜单', exact: true }).click();
  await page.getByRole('menuitem', { name: '设置', exact: true }).click();
  const settings = page.getByRole('dialog', { name: '设置', exact: true });
  const aiCategory = settings.getByRole('button', { name: 'AI 服务', exact: true });
  const closeSettings = settings.getByRole('button', { name: '关闭设置', exact: true });
  await aiCategory.click();
  const chatgpt = settings.locator('[data-settings-target="chatgpt"]');
  await chatgpt.getByRole('button', { name: '退出登录', exact: true }).click();
  await chatgpt.getByRole('button', { name: '登录', exact: true }).waitFor();
  await closeSettings.click();
  for (const launch of [page.locator('.interview-start-trigger'), guide.getByRole('button', { name: '开始面试', exact: true })]) {
    await launch.click();
    await chatgpt.getByRole('button', { name: '登录', exact: true }).waitFor();
    assert.equal(await aiCategory.getAttribute('aria-current'), 'page');
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await settings.locator('[data-location-highlight]').count(), 0);
    assert.equal(await start.count(), 0);
    await closeSettings.click();
  }
  await connectUiAccount(app, page);
  const catalog = await page.evaluate(() => window.desktop.components({ op: 'status' }));
  const mainWindow = await app.browserWindow(page);
  let revision = catalog.revision;
  const publishCatalog = (state) => mainWindow.evaluate(
    (win, next) => win.webContents.send('components:event', next),
    { ...state, revision: ++revision },
  );
  const missingNotice = page.getByRole('complementary', { name: '本地组件提示', exact: true });
  for (const hasQwen of [true, false]) {
    await publishCatalog({
      ...catalog, phase: 'needed',
      items: catalog.items.filter((item) => hasQwen || item.id !== 'qwen').map((item) =>
        item.id === 'rag' ? item : { ...item, phase: 'pending', received: 0 }),
    });
    await missingNotice.waitFor();
    await guide.getByRole('button', { name: '开始面试', exact: true }).click();
    await settings.locator('[data-settings-target="speech"][data-location-highlight]').waitFor();
    const highlighted = await settings.locator('[data-settings-target][data-location-highlight]')
      .evaluateAll((rows) => rows.map((row) => row.dataset.settingsTarget).sort());
    assert.deepEqual(highlighted, hasQwen ? ['qwen', 'speech'] : ['speech']);
    await closeSettings.click();
    await publishCatalog(catalog);
    await missingNotice.waitFor({ state: 'hidden' });
  }
  await mainWindow.dispose();
  await page.evaluate(() => {
    localStorage.setItem('voxcue-language-v1', 'en');
    dispatchEvent(new StorageEvent('storage', { key: 'voxcue-language-v1' }));
  });
  await guide.getByRole('button', { name: 'Update skills', exact: true }).waitFor();
  await measure('saved skills use the update label in English');
  await guide.getByRole('button', { name: 'Update skills', exact: true }).click();
  await page.getByRole('region', { name: 'Profile updates to review', exact: true }).waitFor();
  const englishSkills = await app.evaluate(() => globalThis.guideRequests.at(-1));
  assert.equal(englishSkills.profileTask, 'skills');
  assert.equal(englishSkills.webSearch, true);
  assert.match(
    englishSkills.turns.at(-1).content,
    /^Using my confirmed resume and job description/,
  );
  assert.deepEqual(errors, []);
  console.log(
    'Three contextual choices: confirmed profile, optional actions, draft safety, reload, bilingual alignment and external guide passed. Synthetic data only.',
  );
} finally {
  await closeUiApp(app);
}
