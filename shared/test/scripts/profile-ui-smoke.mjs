import { connectUiAccount } from './install-ui-account.mjs';
import { testRoot, electron } from './test-workspace.mjs';
import { offlineElectronEntry } from './offline-electron-entry.mjs';

import { mkdir, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { installUiAccount, closeUiApp } from './install-ui-account.mjs';
import { captureRequested } from './capture-requested.mjs';
await mkdir(path.join(testRoot, 'test/results'), { recursive: true });
const profile = await mkdtemp(path.resolve(path.join(testRoot, 'test/results/personal-info-')));
const app = await electron.launch({
  args: [await offlineElectronEntry()],
  env: { ...process.env, COPILOT_TEST_USER_DATA: profile, VITE_DEV_SERVER_URL: '' },
});
const checks = [],
  errors = [];
async function verifyMathLayout(page, container) {
  await page.evaluate(() => document.fonts.ready);
  const result = await container.evaluate((element) => {
    const markdown = element.querySelector('.markdown-content');
    const math = [...markdown.querySelectorAll('.katex-display')];
    return {
      overflow: markdown.scrollWidth > markdown.clientWidth + 1,
      formulaScrolls: math.some((formula) => formula.scrollWidth > formula.clientWidth + 10),
      visible: math.every((formula) => formula.getBoundingClientRect().height > 20),
      errors: element.querySelectorAll('.katex-error').length,
      font: getComputedStyle(element.querySelector('.katex')).fontFamily,
    };
  });
  assert.equal(result.overflow, false, JSON.stringify(result));
  assert.equal(result.formulaScrolls, true, JSON.stringify(result));
  assert.equal(result.visible, true);
  assert.equal(result.errors, 0);
  assert(result.font.includes('KaTeX'));
}
async function verifySkillPromptLayout(page, action) {
  const window = await app.browserWindow(page);
  const original = await window.evaluate((win) => win.getBounds());
  const prompt = page.locator('.preparation-guide');
  await prompt.getByRole('button', { name: action, exact: true }).waitFor();
  try {
    for (const width of [1280, 960]) {
      await window.evaluate((win, bounds) => win.setBounds(bounds), { ...original, width });
      await page.waitForFunction(() =>
        document
          .getAnimations()
          .every((a) => a.effect?.getTiming().iterations === Infinity || a.playState !== 'running'),
      );
      const layout = await prompt.locator('.preparation-guide-actions').evaluate((footer) => {
        const outer = footer.getBoundingClientRect();
        const buttons = [...footer.querySelectorAll(':scope > button')];
        const rows = [];
        for (const button of buttons) {
          const box = button.getBoundingClientRect();
          let row = rows.find((value) => Math.abs(value.top - box.top) < 1);
          if (!row) rows.push((row = { top: box.top, left: box.left, right: box.right }));
          row.left = Math.min(row.left, box.left);
          row.right = Math.max(row.right, box.right);
        }
        return {
          labels: buttons.map((button) => button.textContent.trim()),
          offsets: rows.map((row) => (row.left + row.right - outer.left - outer.right) / 2),
          overflow: footer.scrollWidth > footer.clientWidth + 1,
        };
      });
      assert.deepEqual(layout.labels, [
        action,
        action === '添加职位描述' ? '更新简历' : '查看个人资料',
        '开始面试',
      ]);
      assert.ok(
        layout.offsets.every((offset) => Math.abs(offset) < 1),
        JSON.stringify(layout),
      );
      assert.equal(layout.overflow, false);
      await prompt.getByRole('button', { name: action, exact: true }).focus();
      await page.keyboard.press('Tab');
      assert.equal(
        await prompt
          .getByRole('button', {
            name: action === '添加职位描述' ? '更新简历' : '查看个人资料',
            exact: true,
          })
          .evaluate((e) => e === document.activeElement),
        true,
      );
      console.log(JSON.stringify({ skillPrompt: action, width, ...layout }));
      await captureRequested(
        page,
        `skill-prompt-${action === '生成技能' ? 'complete' : 'missing'}-${width}`,
      );
    }
  } finally {
    await window.evaluate((win, bounds) => win.setBounds(bounds), original);
  }
}
try {
  await installUiAccount(app, { speech: true, components: true });
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
    const { KnowledgeError } = require(
      app.getAppPath() + '/dist-electron/shared/electron/backend/knowledge/errors.js',
    );
    const { projectEvidence } = require(
      app.getAppPath() + '/dist-electron/shared/electron/backend/knowledge/evidence.js',
    );
    KnowledgeHost.prototype.version = async () => 'synthetic-profile-v1';
    globalThis.profileRequests = [];
    globalThis.profileSearches = [];
    globalThis.failSkills = true;
    globalThis.holdSkills = true;
    globalThis.profileJdRevision = 0;
    KnowledgeHost.prototype.search = async function (query, topK, mode, signal, baseId) {
      globalThis.profileSearches.push({ baseId, query });
      if (globalThis.failProfileSearch) {
        globalThis.failProfileSearch = false;
        throw new KnowledgeError('unavailable', 'Synthetic local retrieval unavailable');
      }
      return [
        {
          itemId: 'chosen-item',
          documentId: 'chosen-document',
          baseId: globalThis.profileChosenBase,
          revision: 'chosen-revision',
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
          revision: 'other-revision',
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
    KnowledgeHost.prototype.getEvidenceItem = async (hit, signal, expected) => {
      signal.throwIfAborted();
      if (!['chosen-item', 'other-item'].includes(hit.itemId)) return null;
      const chosen = hit.itemId === 'chosen-item';
      const documentId = chosen ? 'chosen-document' : 'other-document';
      const baseId = chosen ? globalThis.profileChosenBase : 'other-base';
      const revision = chosen ? 'chosen-revision' : 'other-revision';
      if (expected?.baseId !== baseId || expected.documentId !== documentId || expected.revision !== revision)
        throw new KnowledgeError('integrity', 'Synthetic evidence identity mismatch');
      return projectEvidence(hit, {
        itemId: hit.itemId,
        documentId,
        source: { baseId, revision },
        kind: 'text',
        title: 'TypeScript',
        content: chosen ? 'chosen-evidence' : 'private-other-base',
        followUpIds: [],
        section: '',
      });
    };
    ChatGPTService.prototype.stream = async function (request, emit) {
      if (request.id.startsWith('history-title-'))
        return { answerText: '合成面试记录', usage: null, sources: [] };
      if (request.instructions.startsWith("Decide whether the user's CURRENT request")) {
        const current = JSON.parse(request.turns[0].content).at(-1).content;
        const useKnowledge = current === '请使用知识库解释 TypeScript';
        return {
          usage: null,
          sources: [],
          answerText: JSON.stringify(
            useKnowledge
              ? { useKnowledge, userQuote: current, query: 'TypeScript' }
              : { useKnowledge },
          ),
        };
      }
      globalThis.profileRequests.push(request);
      if (!request.profile) {
        const answerText = globalThis.profileInterviewAnswer || '直接口语测试答案';
        emit({ id: request.id, type: 'delta', text: answerText });
        return { answerText, usage: null, sources: [] };
      }
      const prompt = request.turns.at(-1).content;
      if (prompt === '公式展示') {
        const answerText = globalThis.profileMathAnswer;
        const split = answerText.indexOf('bmatrix') + 8;
        emit({ id: request.id, type: 'delta', text: answerText.slice(0, split) });
        await new Promise((resolve) => setTimeout(resolve, 100));
        emit({ id: request.id, type: 'delta', text: answerText.slice(split) });
        return { answerText, profileChanges: {}, usage: null, sources: [] };
      }
      const isSkillTask = request.profileTask === 'skills' || prompt.includes('Kafka');
      let changes = {};
      const source = { title: 'TypeScript 官方文档', url: 'https://www.typescriptlang.org/docs/' };
      if (isSkillTask) {
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
                '**类型检查发生在编译阶段。** 面试中应区分静态类型与真实输入校验，不声称有未证实经历。\n\n[文档说明](https://www.typescriptlang.org/docs/)\nhttps://www.typescriptlang.org/docs/\n数组[1]和37毫秒保留。',
              sources: [source],
            },
          ],
        };
        if (prompt.includes('Kafka'))
          changes.skills = [
            ...(request.profile.skills ?? []),
            { id: 'kafka-topic', title: 'Kafka', content: '合成主题资料', sources: [source] },
          ];
      } else if (prompt.includes('知识库选择')) changes = { knowledgeBaseId: 'other-base' };
      else if (prompt.includes('删除全部自定义指令')) changes = { customInstructions: '' };
      else if (prompt.includes('自然语言要求'))
        changes = {
          customInstructions: '第一人称口语回答：先给结论，再用自然口语解释理由，只回答当前问题。',
        };
      else if (prompt.includes('请根据本次上传的简历整理摘要'))
        changes = {
          background: '更新简历摘要：负责 TypeScript 桌面项目，使用 React，负责接口校验。',
        };
      else if (prompt.includes('更新 JD'))
        changes = {
          jobDescription:
            '新 JD 摘要：TypeScript、接口边界与数据校验。修订' + ++globalThis.profileJdRevision,
        };
      else if (prompt.includes('普通联网问题') || prompt.includes('一套完整')) changes = {};
      else
        changes = {
          name: '合成候选人',
          background: '简历摘要：负责本地桌面项目、使用 TypeScript 与 React；未提供具体业务指标。',
          jobDescription: 'JD 摘要：TypeScript、React、数据库与接口设计。',
        };
      const answerText = isSkillTask
        ? '已整理面试资料。 [资料](https://www.typescriptlang.org/docs/)\nhttps://www.typescriptlang.org/docs/'
        : prompt.includes('普通联网问题')
          ? '普通回答保留[官方文档](https://www.typescriptlang.org/docs/)。'
          : '已整理待确认内容，请检查待保存内容。';
      if (isSkillTask) {
        emit({ id: request.id, type: 'sources', sources: [source] });
        emit({
          id: request.id,
          type: 'profile-preview',
          preview: { skills: changes.skills.map(({ title, content }) => ({ title, content })) },
        });
      }
      emit({ id: request.id, type: 'delta', text: answerText });
      if (isSkillTask && globalThis.holdSkills) {
        globalThis.holdSkills = false;
        await new Promise((resolve) => {
          globalThis.finishSkill = resolve;
        });
      }
      return {
        answerText,
        profileChanges: changes,
        sources: isSkillTask || prompt.includes('普通联网问题') ? [source] : [],
        usage: null,
      };
    };
  });
  const login = await app.firstWindow();
  const page = await connectUiAccount(app, login);
  page.setDefaultTimeout(20000);
  page.on('pageerror', (error) => errors.push(error.message));
  await page.locator('.welcome h1').waitFor();
  const info = page.getByRole('button', { name: '个人信息', exact: true });
  const panel = page.getByRole('complementary', { name: '个人信息', exact: true });
  const section = (label) => panel.locator('details[aria-label="' + label + '"]');
  const settleDisclosure = (locator) =>
    locator.evaluate(async (element) => {
      element.getBoundingClientRect();
      await Promise.all(
        element
          .getAnimations({ subtree: true })
          .filter((animation) => Number.isFinite(animation.effect?.getComputedTiming().endTime))
          .map((animation) => animation.finished.catch(() => {})),
      );
    });
  const expand = async (label) => {
    const row = section(label);
    if (!(await row.evaluate((e) => e.open))) await row.locator(':scope > summary').click();
    await settleDisclosure(row);
  };
  const message = page.getByRole('textbox', { name: '聊天消息', exact: true });
  const saved = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('copilot-personal-info-v1') || 'null'));
  const send = async (text) => {
    await message.fill(text);
    await page.getByRole('button', { name: '发送消息', exact: true }).click();
  };
  const proposal = () => page.getByRole('region', { name: '待确认的资料更新', exact: true }).last();
  const confirm = async () => {
    await proposal().getByRole('button', { name: '保存所选', exact: true }).click();
    await proposal().getByText('已保存所选资料', { exact: true }).waitFor();
  };
  for (const label of ['帮我准备自我介绍', '帮我梳理项目经历'])
    assert.equal(await page.getByRole('button', { name: label, exact: true }).count(), 0);
  await message.fill('已有的简历整理要求');
  await page.getByLabel('添加聊天文件', { exact: true }).setInputFiles({
    name: 'pending.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from('Existing synthetic attachment.'),
  });
  const beforeUpload = await app.evaluate(() => globalThis.profileRequests.length);
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByRole('button', { name: '上传简历', exact: true }).click(),
  ]);
  await chooser.setFiles({
    name: 'resume.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('Synthetic resume for the upload shortcut.'),
  });
  const uploadDraft =
    '已有的简历整理要求\n\n请根据本次上传的简历整理摘要，保留教育与工作背景、职责、项目、关键技术和已有成果，准确区分个人贡献、团队成果及进行中事项。合并重复表述，不补造事实。仅提出简历摘要的待确认更新，不修改其他资料。如果本次摘要有变化，且提案与已保存资料合并后简历和JD摘要都非空，请在回复末尾问一句：确认保存后是否需要生成相关面试技能；已有技能时改为询问是否更新。本次不生成技能。';
  assert.equal(await message.inputValue(), uploadDraft);
  assert.equal(await page.locator('.chat-attachment').count(), 2);
  assert.equal(await app.evaluate(() => globalThis.profileRequests.length), beforeUpload);
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await proposal().waitFor();
  const uploadRequest = await app.evaluate(() => globalThis.profileRequests.at(-1));
  assert.equal(uploadRequest.turns.at(-1).content, uploadDraft);
  assert.deepEqual(
    uploadRequest.turns.at(-1).files.map((file) => file.name),
    ['pending.md', 'resume.txt'],
  );
  assert.equal(await saved(), null);
  await page.getByRole('button', { name: '新对话', exact: true }).click();
  checks.push(
    'welcome shortcuts send full requests; resume upload preserves draft/attachments and waits for send and consent',
  );
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
  assert.equal(await panel.locator('.profile-disclosure[open]').count(), 0);
  await expand('面试知识库');
  await panel.getByRole('button', { name: '面试知识库', exact: true }).click();
  await page.getByRole('menuitemradio', { name: '选定资料', exact: true }).click();
  await page.waitForFunction(
    () =>
      JSON.parse(localStorage.getItem('copilot-interview-knowledge-base-v1') || 'null') !== null,
  );
  const chosen = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('copilot-interview-knowledge-base-v1')),
  );
  await app.evaluate((_, baseId) => { globalThis.profileChosenBase = baseId; }, chosen);
  assert.equal(await panel.getByText('官方题库', { exact: false }).count(), 0);
  await page.getByRole('button', { name: '个人信息', exact: true }).click();
  await page.getByLabel('添加聊天文件', { exact: true }).setInputFiles({
    name: 'resume.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from('Synthetic candidate resume only.'),
  });
  await send('请根据附件和以下职位描述生成简历与 JD 摘要：TypeScript 工程师');
  await proposal().waitFor();
  assert.equal(await saved(), null);
  const summaryRequest = await app.evaluate(() => globalThis.profileRequests.at(-1));
  assert.equal(summaryRequest.turns.at(-1).files.length, 1);
  assert.ok(summaryRequest.instructions.includes('直接处理当前问题'));
  assert.ok(summaryRequest.instructions.includes('用户明确要求按该指令试写面试回答时除外'));
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    globalThis.restoreProfileStorage = () => (Storage.prototype.setItem = original);
    Storage.prototype.setItem = function (key, value) {
      if (key === 'copilot-personal-info-v1') throw Error('Synthetic quota');
      return original.call(this, key, value);
    };
  });
  await proposal().getByRole('button', { name: '保存所选', exact: true }).click();
  await page.getByText('资料保存失败，请检查本地存储空间。', { exact: true }).first().waitFor();
  assert.equal(await saved(), null);
  await page.evaluate(() => globalThis.restoreProfileStorage());
  await confirm();
  assert.equal(await page.locator('.preparation-guide').count(), 0);
  await page.getByRole('button', { name: '新对话', exact: true }).click();
  await page.locator('.preparation-guide').getByText('接下来想做什么？', { exact: true }).waitFor();
  await verifySkillPromptLayout(page, '生成技能');
  await page
    .locator('.preparation-guide')
    .getByRole('button', { name: '查看个人资料', exact: true })
    .click();
  assert((await saved()).background.includes('简历摘要'));
  checks.push(
    'attachment summaries preview/consent, storage failure recovery and home-only skill guidance',
  );
  await message.fill('尚未发送的草稿');
  if (!(await panel.isVisible())) await info.click();
  await expand('简历摘要');
  const resumeSection = section('简历摘要');
  await resumeSection.getByRole('button', { name: '编辑', exact: true }).click();
  const resumeEditor = page.getByRole('dialog', { name: '编辑简历摘要', exact: true });
  await resumeEditor
    .getByLabel('内容', { exact: true })
    .fill('负责 TypeScript 桌面项目，React 与接口校验。');
  await resumeEditor.getByRole('button', { name: '保存', exact: true }).click();
  assert.equal(await message.inputValue(), '尚未发送的草稿');
  assert((await saved()).background.includes('接口校验'));
  assert.equal(await resumeEditor.count(), 0);
  await page
    .locator('.preparation-guide')
    .getByRole('button', { name: '查看个人资料', exact: true })
    .click();
  await send('把我的自然语言要求整理为自定义指令：自然口语，先给结论');
  await proposal().waitFor();
  assert.equal((await saved()).customInstructions, undefined);
  await confirm();
  await send('删除全部自定义指令');
  await proposal().getByText('清空内容', { exact: true }).waitFor();
  await proposal().getByRole('button', { name: '保留原资料', exact: true }).click();
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
      .locator('details[aria-label="自定义指令"]')
      .getByText(/\d+\/10/)
      .count(),
    0,
  );
  await send('请更新 JD 摘要');
  await confirm();
  const preparationRequest = await app.evaluate(() => globalThis.profileRequests.at(-1));
  assert(!preparationRequest.instructions.includes('第一人称口语回答'));
  assert(!preparationRequest.instructions.includes('遵循用户已经确认的自定义指令'));
  assert(preparationRequest.profile.customInstructions.includes('第一人称口语回答'));
  assert.equal(await page.locator('.preparation-guide').count(), 0);
  await page.getByRole('button', { name: '新对话', exact: true }).click();
  await page
    .locator('.preparation-guide')
    .getByRole('button', { name: '生成技能', exact: true })
    .click();
  await page.getByRole('button', { name: '重试回答', exact: true }).last().waitFor();
  assert.equal((await saved()).skills, undefined);
  await page.getByRole('button', { name: '重试回答', exact: true }).last().click();
  const preview = page.getByRole('region', { name: '正在生成的资料提案', exact: true });
  await preview.waitFor();
  assert.equal(await preview.getByRole('button', { name: '保存所选' }).isDisabled(), true);
  const skillMessage = page.locator('.chat-message.assistant').last();
  assert.equal(await skillMessage.locator('.chat-source-group').count(), 1);
  assert((await skillMessage.locator('.chat-answer a').count()) > 0);
  assert.equal(await preview.getByRole('link').count(), 0);
  assert(!/https?:|\*\*/.test(await preview.innerText()));
  assert((await preview.innerText()).includes('数组[1]和37毫秒保留'));
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (text) => {
          globalThis.skillCopied = text;
        },
      },
    });
  });
  await skillMessage.getByRole('button', { name: '复制', exact: true }).click();
  const copiedSkill = await page.evaluate(() => globalThis.skillCopied);
  assert(copiedSkill.includes('已整理面试资料'));
  assert(copiedSkill.includes('[资料](https://www.typescriptlang.org/docs/)'));
  await app.evaluate(() => globalThis.finishSkill());
  await preview.waitFor({ state: 'hidden' });
  await proposal().waitFor();
  const research = await app.evaluate(() => globalThis.profileRequests.at(-1));
  assert.equal(research.webSearch, true);
  assert.equal(research.profileTask, 'skills');
  assert.equal(research.knowledgeBaseId, null);
  assert(research.turns.at(-1).content.includes('作为技能更新提案'));
  assert(research.turns.at(-1).content.includes('不要把参考资料写成我已掌握的技能或经历'));
  assert(!/120|220|3–5|附1–2/.test(research.turns.at(-1).content));
  assert.equal(await skillMessage.locator('.chat-source-group').count(), 1);
  assert((await skillMessage.locator('.chat-answer a').count()) > 0);
  assert.equal((await saved()).skills, undefined);
  await confirm();
  assert.equal((await saved()).skills.length, 1);
  assert.equal((await saved()).skills[0].sources[0].url, 'https://www.typescriptlang.org/docs/');
  assert((await saved()).skills[0].content.includes('https://'));
  const searchesBeforeOrdinary = await app.evaluate(() => globalThis.profileSearches.length);
  const beforeOrdinaryFallback = await app.evaluate(() => globalThis.profileRequests.length);
  await send('普通联网问题：解释类型与运行时校验');
  const ordinaryMessage = page.locator('.chat-message.assistant').last();
  await ordinaryMessage.locator('.chat-source-group').waitFor();
  await ordinaryMessage.getByRole('link', { name: '官方文档', exact: true }).waitFor();
  const ordinaryFallback = await app.evaluate(() => globalThis.profileRequests);
  assert.equal(ordinaryFallback.length, beforeOrdinaryFallback + 1);
  assert.equal(await app.evaluate(() => globalThis.profileSearches.length), searchesBeforeOrdinary);
  assert.equal(ordinaryFallback.at(-1).knowledgeBaseId, null);
  assert(!ordinaryFallback.at(-1).turns.at(-1).content.includes('本地检索参考数据'));
  assert(!ordinaryFallback.at(-1).instructions.includes('第一人称口语回答'));
  await send('请使用知识库解释 TypeScript');
  await page.waitForFunction(() => !document.querySelector('button[aria-label="停止回答"]'));
  const explicitKnowledge = await app.evaluate(() => globalThis.profileRequests.at(-1));
  assert.equal(
    await app.evaluate(() => globalThis.profileSearches.length),
    searchesBeforeOrdinary + 1,
  );
  assert(explicitKnowledge.turns.at(-1).content.includes('chosen-evidence'));
  assert(!explicitKnowledge.turns.at(-1).content.includes('private-other-base'));
  const mathAnswer = [
    String.raw`矩阵相乘：\(m\times n\)。`,
    String.raw`\[
\begin{bmatrix}1&2\\3&4\end{bmatrix}
\begin{bmatrix}5&6\\7&8\end{bmatrix}
=\begin{bmatrix}19&22\\43&50\end{bmatrix}
\]`,
    '$$' + String.raw`\underbrace{${Array(60).fill('a').join('+')}}_{n}` + '$$',
    '代码示例：`\\(x\\)`',
  ].join('\n\n');
  await app.evaluate((_, answer) => {
    globalThis.profileMathAnswer = answer;
  }, mathAnswer);
  await send('公式展示');
  const mathMessage = page.locator('.chat-message.assistant').last();
  await mathMessage.locator('.katex-display').last().waitFor();
  assert.equal(await mathMessage.locator('.katex').count(), 3);
  assert.equal(await mathMessage.locator('code').innerText(), String.raw`\(x\)`);
  await mathMessage.getByRole('button', { name: '复制', exact: true }).click();
  assert.equal(await page.evaluate(() => globalThis.skillCopied), mathAnswer);
  await verifyMathLayout(page, mathMessage);
  await send('请更新 JD 摘要');
  await confirm();
  assert.equal(await page.locator('.preparation-guide').count(), 0);
  await send('请修改知识库选择');
  await page.getByText('资料更新包含未知字段。', { exact: true }).waitFor();
  assert.equal(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem('copilot-interview-knowledge-base-v1')),
    ),
    chosen,
  );
  checks.push(
    'default search availability, skill request/retry/consent, renewed JD prompt, AI cannot choose knowledge base',
  );
  if (!(await panel.isVisible())) await info.click();
  await panel.getByLabel('姓名', { exact: true }).fill('手动预览姓名');
  assert.notEqual((await saved()).name, '手动预览姓名');
  await panel.getByRole('button', { name: '保存', exact: true }).click();
  assert.equal((await saved()).name, '手动预览姓名');
  await expand('面试技能');
  await panel
    .locator('.profile-entry')
    .filter({ hasText: 'TypeScript 运行时边界' })
    .locator('summary')
    .click();
  const savedSkill = panel.locator('.profile-entry').filter({ hasText: 'TypeScript 运行时边界' });
  await settleDisclosure(savedSkill);
  assert.equal(await savedSkill.getByRole('link').count(), 0);
  assert(!/https?:|\*\*/.test(await savedSkill.innerText()));
  assert((await savedSkill.innerText()).includes('数组[1]和37毫秒保留'));
  for (const label of ['简历摘要', '职位描述摘要', '自定义指令']) await expand(label);
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
    assert(Math.abs(row.headingX - row.cardX) < 1, JSON.stringify(row));
    assert(Math.abs(row.actionY[0] - row.actionY[1]) < 1);
    assert(Math.abs(row.cardRight - row.actionRight) < 1);
  }
  await console.log(JSON.stringify(alignment, null, 2));
  await panel.locator('.personal-panel-scroll').evaluate((e) => (e.scrollTop = 0));
  await page.screenshot({ animations: 'disabled' });
  await section('自定义指令').scrollIntoViewIfNeeded();
  await page.screenshot({ animations: 'disabled' });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(960, 680));
  await page.waitForFunction(() => innerWidth <= 970);
  await page.evaluate(() => document.documentElement.classList.add('dark'));
  await page.screenshot({ animations: 'disabled' });
  assert.equal(await panel.evaluate((element) => getComputedStyle(element).position), 'absolute');
  await panel.locator('.personal-panel-scroll').evaluate((e) => (e.scrollTop = 0));
  await page.screenshot({ animations: 'disabled' });
  await page.getByRole('button', { name: '个人信息', exact: true }).click();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1280, 800));
  await page.locator('.interview-start-trigger').click();
  const start = page.getByRole('dialog', { name: '开始面试', exact: true });
  await start.getByText('选定资料', { exact: true }).waitFor();
  const [floating] = await Promise.all([
    app.waitForEvent('window'),
    start.getByRole('button', { name: '确认开始', exact: true }).click(),
  ]);
  floating.setDefaultTimeout(20000);
  floating.on('pageerror', (error) => errors.push(error.message));
  await floating.getByRole('status', { name: '语音模型：正常', exact: true }).waitFor();
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
  assert(
    interview.request.instructions.includes(
      '职位描述摘要（jobDescription）是岗位要求；技能（skills）是面试准备参考资料',
    ),
  );
  await app.evaluate((_, answer) => {
    globalThis.profileInterviewAnswer = answer;
  }, mathAnswer);
  await floating.getByRole('textbox', { name: '面试提问', exact: true }).fill('矩阵乘法');
  await floating.getByRole('button', { name: '发送面试问题', exact: true }).click();
  const mathBubble = floating.locator('.answer-bubble').last();
  await mathBubble.locator('.katex-display').last().waitFor();
  assert.equal(await mathBubble.locator('.katex').count(), 3);
  await verifyMathLayout(floating, mathBubble);
  checks.push(
    'preparation and interview inline/block/matrix math, long formula overflow, original LaTeX copy',
  );
  const beforeFallback = await app.evaluate(() => globalThis.profileRequests.length);
  await app.evaluate(() => {
    globalThis.failProfileSearch = true;
    globalThis.profileInterviewAnswer = '检索失败后的合成回答：采用输出限幅与状态监测。';
  });
  await floating.getByRole('textbox', { name: '面试提问', exact: true }).fill('怎样处理控制异常？');
  await floating.getByRole('button', { name: '发送面试问题', exact: true }).click();
  await floating
    .getByText('检索失败后的合成回答：采用输出限幅与状态监测。', { exact: true })
    .waitFor();
  const fallbackRequest = await app.evaluate(() => globalThis.profileRequests.at(-1));
  assert(fallbackRequest.turns.at(-1).content.includes('"retrievalStatus":"unavailable"'));
  assert(!fallbackRequest.turns.at(-1).content.includes('chosen-evidence'));
  assert(!fallbackRequest.turns.at(-1).content.includes('private-other-base'));
  assert.equal(fallbackRequest.modelId, interview.request.modelId);
  assert.equal(fallbackRequest.effort, interview.request.effort);
  await app.evaluate(() => {
    globalThis.profileInterviewAnswer = '合成追问回答完成。';
  });
  await floating
    .getByRole('textbox', { name: '面试提问', exact: true })
    .fill('为什么采用这种处理？');
  await floating.getByRole('button', { name: '发送面试问题', exact: true }).click();
  await floating.getByText('合成追问回答完成。', { exact: true }).waitFor();
  const afterFallback = await app.evaluate(() => globalThis.profileRequests);
  assert.equal(afterFallback.length, beforeFallback + 2);
  assert(
    afterFallback
      .at(-1)
      .turns[0].content.includes('检索失败后的合成回答：采用输出限幅与状态监测。'),
  );
  assert(afterFallback.at(-1).turns[0].content.includes('"kind":"ai_suggestion"'));
  checks.push(
    'preparation does not execute saved interview instructions; local retrieval failure answers once and remains available to follow-up context',
  );
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
  await expand('面试知识库');
  await panel
    .getByRole('button', { name: '面试知识库', exact: true })
    .getByText('选定资料', { exact: true })
    .waitFor();
  await expand('面试技能');
  const restoredSkill = panel
    .locator('.profile-entry')
    .filter({ hasText: 'TypeScript 运行时边界' });
  if (!(await restoredSkill.evaluate((element) => element.open)))
    await restoredSkill.locator('summary').click();
  await settleDisclosure(restoredSkill);
  assert.equal(await restoredSkill.getByRole('link').count(), 0);
  assert(!/https?:|\*\*/.test(await restoredSkill.innerText()));
  assert.equal((await saved()).skills[0].sources.length, 1);
  checks.push(
    'skill button request, skill entries remain plain text without links, chat citations and raw copy preserved, modal edit/save, responsive themes, locked profile and one-base interview retrieval, reload persistence',
  );
  await expand('职位描述摘要');
  await section('职位描述摘要').getByRole('button', { name: '编辑', exact: true }).click();
  const jdEditor = page.getByRole('dialog', { name: '编辑职位描述摘要', exact: true });
  await jdEditor.getByLabel('内容', { exact: true }).fill('');
  await jdEditor.getByRole('button', { name: '保存', exact: true }).click();
  const beforeTopic = await app.evaluate(() => globalThis.profileRequests.length);
  await send('请生成一套完整的面试技能');
  assert.equal(await app.evaluate(() => globalThis.profileRequests.length), beforeTopic + 1);
  assert.equal((await saved()).jobDescription, '');
  await send('帮我加一条Kafka');
  await proposal().waitFor();
  const topicRequest = await app.evaluate(() => globalThis.profileRequests.at(-1));
  assert.equal(topicRequest.profileTask, undefined);
  assert.equal(topicRequest.webSearch, true);
  assert.equal(topicRequest.profile.jobDescription, '');
  assert.equal((await saved()).jobDescription, '');
  assert.equal(
    (await saved()).skills.some((skill) => skill.id === 'kafka-topic'),
    false,
  );
  await proposal().getByRole('button', { name: '保留原资料', exact: true }).click();
  assert.equal(
    (await saved()).skills.some((skill) => skill.id === 'kafka-topic'),
    false,
  );
  checks.push(
    'named-topic skill request passes real UI/IPC with missing JD; full requests reach the model and rejected proposals do not save',
  );
  await page.getByRole('button', { name: '新对话', exact: true }).click();
  await message.fill('补充资料前的草稿');
  await page.getByLabel('添加聊天文件', { exact: true }).setInputFiles({
    name: 'missing-jd.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('Synthetic job requirements.'),
  });
  const beforeMissing = await app.evaluate(() => globalThis.profileRequests.length);
  await verifySkillPromptLayout(page, '添加职位描述');
  await page.getByRole('button', { name: '添加职位描述', exact: true }).click();
  assert.equal(await page.locator('.preparation-guide').count(), 1);
  const missingDraft = await message.inputValue();
  assert.equal(
    missingDraft,
    '补充资料前的草稿\n\n请根据以下内容整理职位描述摘要。简历保留个人经历、职责、项目、技术和成果；职位描述保留岗位定位、职责、任职要求及明确的优先条件。合并重复表述，保留事实和条件边界，不把岗位要求写成个人经历。仅提出该摘要的待确认更新，不修改其他资料。如果本次摘要有变化，且提案与已保存资料合并后简历和JD摘要都非空，请在回复末尾问一句：确认保存后是否需要生成相关面试技能；已有技能时改为询问是否更新。本次不生成技能。\n\n以下是职位描述内容：\n',
  );
  assert.equal(await page.locator('.chat-attachment').count(), 1);
  assert.equal(await app.evaluate(() => globalThis.profileRequests.length), beforeMissing);
  assert.equal((await saved()).jobDescription, '');
  await send(missingDraft + '合成 JD：应用开发与接口集成。');
  await proposal().waitFor();
  const missingRequest = await app.evaluate(() => globalThis.profileRequests.at(-1));
  assert.equal(missingRequest.profileTask, undefined);
  assert.equal(missingRequest.turns.at(-1).files[0].name, 'missing-jd.txt');
  assert.equal((await saved()).jobDescription, '');
  checks.push(
    'missing-summary shortcut preserves draft/attachments, waits for send/consent and does not trigger skill research',
  );
  // A manually saved summary must offer the same action without an AI proposal
  // in this conversation, including after chat deletion/reload.
  await page.getByRole('button', { name: '新对话', exact: true }).click();
  if (!(await panel.isVisible())) await info.click();
  await expand('职位描述摘要');
  await section('职位描述摘要').getByRole('button', { name: '编辑', exact: true }).click();
  await jdEditor.getByLabel('内容', { exact: true }).fill('手动合成 JD：接口开发。');
  await jdEditor.getByRole('button', { name: '保存', exact: true }).click();
  assert.equal(await page.locator('.preparation-guide').count(), 1);
  const manualSkills = page
    .locator('.preparation-guide')
    .getByRole('button', { name: '更新技能', exact: true });
  await manualSkills.waitFor();
  assert.equal(await page.locator('.chat-message').count(), 0);
  await page.reload();
  await manualSkills.waitFor();
  const beforeManualSkill = await app.evaluate(() => globalThis.profileRequests.length);
  await manualSkills.click();
  assert.equal(await page.locator('.preparation-guide').count(), 0);
  await proposal().waitFor();
  const manualSkillRequest = await app.evaluate(() => globalThis.profileRequests.at(-1));
  assert.equal(await app.evaluate(() => globalThis.profileRequests.length), beforeManualSkill + 1);
  assert.equal(manualSkillRequest.profileTask, 'skills');
  assert.equal(manualSkillRequest.profile.jobDescription, '手动合成 JD：接口开发。');
  assert.equal(await page.locator('.preparation-guide').count(), 0);
  checks.push(
    'manual summaries offer a new-chat home skill action after reload; the action sends once',
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
} catch (error) {
  for (const window of app.windows()) {
    if (!window.isClosed()) console.error(await window.locator('body').innerText());
  }
  throw error;
} finally {
  await closeUiApp(app);
}
