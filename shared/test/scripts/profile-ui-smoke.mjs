import { testRoot, electron } from './test-workspace.mjs';
import workspace from '../../scripts/workspace.mjs';

import { mkdir, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { installUiAccount, closeUiApp } from './install-ui-account.mjs';
await mkdir(path.join(testRoot, 'test/results'), { recursive: true });
const profile = await mkdtemp(path.resolve(path.join(testRoot, 'test/results/personal-info-')));
const app = await electron.launch({
  args: ['.'],
  env: { ...process.env, COPILOT_TEST_USER_DATA: profile, VITE_DEV_SERVER_URL: '' },
});
const checks = [],
  errors = [];
try {
  await installUiAccount(app, { speech: true });
  await app.evaluate(({ app }) => {
    const require = process
      .getBuiltinModule('module')
      .createRequire(app.getAppPath() + '/package.json');
    const { ChatGPTService } = require(
      app.getAppPath() + '/dist-electron/shared/electron/backend/chat/service.js',
    );
    const { KnowledgeHost } = require(
      app.getAppPath() + '/dist-electron/shared/electron/backend/knowledge/host.js',
    );
    globalThis.profileRequests = [];
    globalThis.profileSearches = [];
    globalThis.failSkills = true;
    KnowledgeHost.prototype.search = async function (query, topK, mode, signal, baseId) {
      globalThis.profileSearches.push({ baseId, query });
      return [
        {
          itemId: 'chosen-item',
          documentId: 'chosen-document',
          baseId,
          name: 'chosen.md',
          title: query,
          excerpt: query,
          chunkId: 'chosen',
          mode,
          score: 1,
          similarity: 0.99,
        },
        {
          itemId: 'other-item',
          documentId: 'other-document',
          baseId: 'other-base',
          name: 'other.md',
          title: query,
          excerpt: 'private-other-base',
          chunkId: 'other',
          mode,
          score: 1,
          similarity: 0.99,
        },
      ];
    };
    KnowledgeHost.prototype.getItem = async (itemId) => ({
      itemId,
      documentId: itemId === 'chosen-item' ? 'chosen-document' : 'other-document',
      kind: 'text',
      title: 'TypeScript',
      content: itemId === 'chosen-item' ? 'chosen-evidence' : 'private-other-base',
      followUpIds: [],
      section: '',
    });
    ChatGPTService.prototype.stream = async function (request, emit) {
      if (request.id.startsWith('history-title-'))
        return { answerText: '合成面试记录', usage: null, sources: [] };
      globalThis.profileRequests.push(request);
      if (!request.profile) {
        emit({ id: request.id, type: 'delta', text: '直接口语测试答案' });
        return { answerText: '直接口语测试答案', usage: null, sources: [] };
      }
      const prompt = request.turns.at(-1).content;
      let changes = {};
      const source = { title: 'TypeScript 官方文档', url: 'https://www.typescriptlang.org/docs/' };
      if (request.profileTask === 'skills') {
        if (globalThis.failSkills) {
          globalThis.failSkills = false;
          throw Error('Synthetic web search unavailable');
        }
        changes = {
          skills: [
            {
              id: 'ts-skill',
              title: 'TypeScript 运行时边界',
              content:
                '类型检查发生在编译阶段。面试中应区分静态类型与真实输入校验，不声称有未证实经历。',
              sources: [source],
            },
          ],
        };
      } else if (prompt.includes('知识库选择')) changes = { knowledgeBaseId: 'other-base' };
      else if (prompt.includes('删除全部自定义指令')) changes = { customInstructions: '' };
      else if (prompt.includes('自然语言要求'))
        changes = {
          customInstructions: '第一人称口语回答：先给结论，再用自然口语解释理由，只回答当前问题。',
        };
      else if (prompt.includes('根据以下内容生成或更新简历摘要'))
        changes = {
          background: '更新简历摘要：负责 TypeScript 桌面项目，使用 React，负责接口校验。',
        };
      else if (prompt.includes('更新 JD'))
        changes = { jobDescription: '新 JD 摘要：TypeScript、接口边界与数据校验。' };
      else
        changes = {
          name: '合成候选人',
          background: '简历摘要：负责本地桌面项目、使用 TypeScript 与 React；未提供具体业务指标。',
          jobDescription: 'JD 摘要：TypeScript、React、数据库与接口设计。',
        };
      const answerText = '已整理待确认内容，请检查待保存内容。';
      emit({ id: request.id, type: 'delta', text: answerText });
      return {
        answerText,
        profileChanges: changes,
        sources: request.profileTask === 'skills' ? [source] : [],
        usage: null,
      };
    };
  });
  const login = await app.firstWindow();
  const [page] = await Promise.all([
    app.waitForEvent('window'),
    login.getByRole('button', { name: '使用 ChatGPT 继续', exact: true }).click(),
  ]);
  page.setDefaultTimeout(20000);
  page.on('pageerror', (error) => errors.push(error.message));
  await page.getByRole('heading', { name: '今天想准备哪一部分面试？', exact: true }).waitFor();
  const info = page.getByRole('button', { name: '个人信息', exact: true });
  const panel = page.getByRole('complementary', { name: '个人信息', exact: true });
  const message = page.getByRole('textbox', { name: '聊天消息', exact: true });
  const saved = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('copilot-personal-info-v1') || 'null'));
  const send = async (text) => {
    await message.fill(text);
    await page.getByRole('button', { name: '发送消息', exact: true }).click();
  };
  const proposal = () => page.getByRole('region', { name: '待确认的资料更新', exact: true }).last();
  const confirm = async () => {
    await proposal().getByRole('button', { name: '确认更新', exact: true }).click();
    await proposal().getByText('个人信息已更新', { exact: true }).waitFor();
  };
  await page.getByRole('button', { name: '知识库', exact: true }).click();
  for (const name of ['选定资料', '其他资料']) {
    await page
      .getByRole('button', { name: /创建知识库/ })
      .first()
      .click();
    await page.getByLabel('知识库名称', { exact: true }).fill(name);
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await page
      .getByRole('dialog', { name, exact: true })
      .getByRole('button', { name: '关闭对话框', exact: true })
      .click();
  }
  await page.getByRole('button', { name: '新对话', exact: true }).click();
  if (!(await panel.isVisible())) await info.click();
  await panel.getByRole('button', { name: '面试知识库', exact: true }).click();
  await page.getByRole('menuitemradio', { name: '选定资料', exact: true }).click();
  await page.waitForFunction(
    () =>
      JSON.parse(localStorage.getItem('copilot-interview-knowledge-base-v1') || 'null') !== null,
  );
  const chosen = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('copilot-interview-knowledge-base-v1')),
  );
  assert.equal(await panel.getByText('官方题库', { exact: false }).count(), 0);
  await page.getByRole('button', { name: '关闭个人信息', exact: true }).click();
  await page.getByLabel('添加聊天文件', { exact: true }).setInputFiles({
    name: 'resume.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from('Synthetic candidate resume only.'),
  });
  await send('请根据附件和以下职位描述生成简历与 JD 摘要：TypeScript 工程师');
  await proposal().waitFor();
  assert.equal(await saved(), null);
  assert(
    (await app.evaluate(() => globalThis.profileRequests.at(-1))).turns.at(-1).files.length === 1,
  );
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    globalThis.restoreProfileStorage = () => (Storage.prototype.setItem = original);
    Storage.prototype.setItem = function (key, value) {
      if (key === 'copilot-personal-info-v1') throw Error('Synthetic quota');
      return original.call(this, key, value);
    };
  });
  await proposal().getByRole('button', { name: '确认更新', exact: true }).click();
  await page.getByText('资料保存失败，请检查本地存储空间。', { exact: true }).first().waitFor();
  assert.equal(await saved(), null);
  await page.evaluate(() => globalThis.restoreProfileStorage());
  await confirm();
  await proposal()
    .getByText('简历或职位描述已更新，是否联网更新面试技能？', { exact: true })
    .waitFor();
  await proposal().getByRole('button', { name: '暂不更新', exact: true }).click();
  assert((await saved()).background.includes('简历摘要'));
  checks.push(
    'attachment summaries preview/consent, storage failure recovery and proactive skill question',
  );
  await message.fill('尚未发送的草稿');
  if (!(await panel.isVisible())) await info.click();
  const resumeSection = panel.getByRole('region', { name: '简历摘要', exact: true });
  await resumeSection.getByRole('button', { name: '编辑', exact: true }).click();
  const resumeEditor = page.getByRole('region', { name: '编辑简历摘要', exact: true });
  await resumeEditor
    .getByLabel('内容', { exact: true })
    .fill('负责 TypeScript 桌面项目，React 与接口校验。');
  await resumeEditor.getByRole('button', { name: '保存', exact: true }).click();
  assert.equal(await message.inputValue(), '尚未发送的草稿');
  assert((await saved()).background.includes('接口校验'));
  assert.equal(await resumeEditor.count(), 0);
  await proposal().getByRole('button', { name: '暂不更新', exact: true }).click();
  await send('把我的自然语言要求整理为自定义指令：自然口语，先给结论');
  await proposal().waitFor();
  assert.equal((await saved()).customInstructions, undefined);
  await confirm();
  await send('删除全部自定义指令');
  await proposal().getByText('未填写 / 清空', { exact: true }).waitFor();
  await proposal().getByRole('button', { name: '保留旧版', exact: true }).click();
  assert((await saved()).customInstructions.includes('口语'));
  await send('删除全部自定义指令');
  await confirm();
  assert.equal((await saved()).customInstructions, '');
  await send('新增自然语言要求：第一人称口语，专业而有逻辑');
  await confirm();
  checks.push('natural instruction generation, reject deletion, confirm deletion and add');
  if (!(await panel.isVisible())) await info.click();
  assert.equal(await panel.getByLabel('目标岗位', { exact: true }).count(), 0);
  assert.equal(await panel.getByText('0/10', { exact: true }).count(), 1); // Skills only.
  assert.equal(
    await panel
      .getByRole('region', { name: '自定义指令' })
      .getByText(/\d+\/10/)
      .count(),
    0,
  );
  await send('请联网生成面试技能');
  await page.getByRole('button', { name: '重试回答', exact: true }).last().waitFor();
  assert.equal((await saved()).skills, undefined);
  await page.getByRole('button', { name: '重试回答', exact: true }).last().click();
  await proposal().waitFor();
  const research = await app.evaluate(() => globalThis.profileRequests.at(-1));
  assert.equal(research.webSearch, true);
  assert.equal(research.profileTask, 'skills');
  assert.equal(research.knowledgeBaseId, null);
  assert.equal((await saved()).skills, undefined);
  await confirm();
  assert.equal((await saved()).skills.length, 1);
  await send('请更新 JD 摘要');
  await confirm();
  await proposal().getByRole('button', { name: '联网更新技能', exact: true }).waitFor();
  await proposal().getByRole('button', { name: '暂不更新', exact: true }).click();
  await send('请修改知识库选择');
  await page.getByText('资料更新包含未知字段。', { exact: true }).waitFor();
  assert.equal(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem('copilot-interview-knowledge-base-v1')),
    ),
    chosen,
  );
  checks.push(
    'forced skill web request/retry/consent, renewed JD prompt, AI cannot choose knowledge base',
  );
  if (!(await panel.isVisible())) await info.click();
  await panel.getByLabel('姓名', { exact: true }).fill('手动预览姓名');
  assert.notEqual((await saved()).name, '手动预览姓名');
  await panel.getByRole('button', { name: '保存', exact: true }).click();
  assert.equal((await saved()).name, '手动预览姓名');
  await panel
    .locator('.profile-entry')
    .filter({ hasText: 'TypeScript 运行时边界' })
    .locator('summary')
    .click();
  await panel.getByRole('link', { name: 'TypeScript 官方文档', exact: true }).waitFor();
  const alignment = await panel.locator('.profile-section').evaluateAll((sections) =>
    sections
      .filter((e) =>
        ['简历摘要', '职位描述摘要', '自定义指令'].includes(e.getAttribute('aria-label')),
      )
      .map((e) => {
        const heading = e.querySelector('h3').getBoundingClientRect();
        const card = e.querySelector('.profile-summary').getBoundingClientRect();
        const actions = [...e.querySelectorAll('.profile-section-actions button')].map((b) =>
          b.getBoundingClientRect(),
        );
        return {
          headingX: heading.x,
          cardX: card.x,
          cardRight: card.right,
          actionY: actions.map((b) => b.y),
          actionRight: actions.at(-1).right,
        };
      }),
  );
  assert.equal(alignment.length, 3);
  for (const row of alignment) {
    assert(Math.abs(row.headingX - row.cardX) < 1);
    assert(Math.abs(row.actionY[0] - row.actionY[1]) < 1);
    assert(Math.abs(row.cardRight - row.actionRight) < 1);
  }
  await console.log(JSON.stringify(alignment, null, 2));
  await panel.locator('.personal-panel-scroll').evaluate((e) => (e.scrollTop = 0));
  await page.screenshot({ animations: 'disabled' });
  await panel.getByRole('region', { name: '自定义指令', exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ animations: 'disabled' });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(960, 680));
  await page.waitForFunction(() => innerWidth <= 970);
  await page.evaluate(() => document.documentElement.classList.add('dark'));
  await page.screenshot({ animations: 'disabled' });
  assert.equal(await panel.evaluate((element) => getComputedStyle(element).position), 'absolute');
  await panel.locator('.personal-panel-scroll').evaluate((e) => (e.scrollTop = 0));
  await page.screenshot({ animations: 'disabled' });
  await page.getByRole('button', { name: '关闭个人信息', exact: true }).click();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1280, 800));
  await page.getByRole('button', { name: '开始面试', exact: true }).click();
  const start = page.getByRole('dialog', { name: '开始面试', exact: true });
  await start.getByText('选定资料', { exact: true }).waitFor();
  const [floating] = await Promise.all([
    app.waitForEvent('window'),
    start.getByRole('button', { name: '确认开始', exact: true }).click(),
  ]);
  floating.setDefaultTimeout(20000);
  floating.on('pageerror', (error) => errors.push(error.message));
  await floating.getByText('语音模型已就绪', { exact: true }).waitFor();
  await floating.getByRole('button', { name: '静音后自动提交完整问题', exact: true }).click();
  await floating.getByRole('textbox', { name: '面试提问', exact: true }).fill('TypeScript');
  await floating.getByRole('button', { name: '发送面试问题', exact: true }).click();
  await floating.getByText('直接口语测试答案', { exact: true }).waitFor();
  const interview = await app.evaluate(() => ({
    request: globalThis.profileRequests.at(-1),
    search: globalThis.profileSearches.at(-1),
  }));
  assert.equal(interview.search.baseId, chosen);
  assert(interview.request.turns.at(-1).content.includes('chosen-evidence'));
  assert(!interview.request.turns.at(-1).content.includes('private-other-base'));
  assert(interview.request.instructions.includes('第一人称口语回答'));
  assert(interview.request.instructions.includes('手动预览姓名'));
  await assert.rejects(
    () =>
      floating.evaluate(() =>
        window.desktop.interviewAnswer({
          id: 'tamper',
          question: 'Q',
          modelId: 'test-model',
          effort: 'low',
          knowledgeBaseId: 'other-base',
        }),
      ),
    /Invalid interview question/,
  );
  await floating.getByRole('button', { name: '结束面试', exact: true }).click();
  await Promise.all([
    floating.waitForEvent('close'),
    floating.getByRole('button', { name: '确认结束面试', exact: true }).click(),
  ]);
  await page.reload();
  await info.waitFor();
  if (!(await panel.isVisible())) await info.click();
  assert.equal(await panel.getByLabel('姓名', { exact: true }).inputValue(), '手动预览姓名');
  await panel
    .getByRole('button', { name: '面试知识库', exact: true })
    .getByText('选定资料', { exact: true })
    .waitFor();
  checks.push(
    'direct inline save, source links, responsive themes, locked profile and one-base interview retrieval, reload persistence',
  );
  assert.deepEqual(errors, []);
  await console.log(
    JSON.stringify(
      {
        checks,
        errors,
        scope:
          'Synthetic account/audio/AI/search ports; real UI, preload, IPC and local storage; live model quality not claimed',
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ profile, checks, errors }));
} finally {
  await closeUiApp(app);
}
