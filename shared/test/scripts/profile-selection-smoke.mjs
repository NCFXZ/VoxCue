import { connectUiAccount } from './install-ui-account.mjs';
import { cornerShapeNames } from './continuous-corners.mjs';
import { testRoot, electron } from './test-workspace.mjs';
import { offlineElectronEntry } from './offline-electron-entry.mjs';
import { waitForAsync } from './wait-for-async.mjs';
import { readStoredChatFixture } from './stored-chat-fixture.mjs';
import { installUiAccount, closeUiApp } from './install-ui-account.mjs';
import { mkdir, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const profile = await mkdtemp(path.join(testRoot, 'profile-selection-'));
const screenshotDirectory = process.argv.find((arg) => arg.startsWith('--screenshots='))?.slice(14);
if (screenshotDirectory) await mkdir(path.resolve(screenshotDirectory), { recursive: true });
const executable = process.argv
  .find((arg) => arg.startsWith('--app-executable='))
  ?.slice('--app-executable='.length);
const env = { ...process.env, COPILOT_TEST_USER_DATA: profile, VITE_DEV_SERVER_URL: '' };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  ...(executable ? { executablePath: path.resolve(executable) } : {}),
  args: executable ? [] : [await offlineElectronEntry()],
  env,
});
const errors = [];
const checks = [];
try {
  await installUiAccount(app, { components: true });
  await app.evaluate(({ app }) => {
    const require = process
      .getBuiltinModule('module')
      .createRequire(app.getAppPath() + '/package.json');
    const { ChatGPTService } = require(
      app.getAppPath() + '/dist-electron/shared/electron/backend/chat/service.js',
    );
    const { ProfileAnswerStream } = require(
      app.getAppPath() + '/dist-electron/shared/electron/backend/chat/profile.js',
    );
    globalThis.selectionRequests = 0;
    ChatGPTService.prototype.stream = async function (request, emit, signal) {
      ++globalThis.selectionRequests;
      const prompt = request.turns.at(-1).content;
      if (prompt.includes('流式逐项')) {
        const stream = new ProfileAnswerStream();
        const publish = (chunk) => {
          const delta = stream.append(chunk);
          const preview = stream.preview();
          if (delta) emit({ id: request.id, type: 'delta', text: delta });
          if (preview)
            emit({
              id: request.id,
              type: 'profile-preview',
              preview,
              generation: stream.generation,
            });
        };
        publish('{"answer":"流式逐项提案","changes":{"name":"新');
        globalThis.advanceSelectionPreview = () =>
          publish(
            '姓名","skills":[{"id":"qt","title":"技能一","content":"已经完整","sources":[]},{"id":"two","title":"技能二","content":"正在生成',
          );
        globalThis.finishSelectionPreview = () => publish('内容","sources":[]}]}}');
        await new Promise((resolve) => {
          if (signal.aborted) resolve();
          else signal.addEventListener('abort', resolve, { once: true });
        });
        return { answerText: '流式逐项提案', usage: null, sources: [] };
      }
      if (/只保存|只更新|确认保存/.test(prompt))
        return { answerText: '请在提案卡片勾选后点击保存所选。', usage: null, sources: [] };
      if (prompt.includes('操作标签'))
        return {
          answerText: '请查看不同操作的状态标签。',
          usage: null,
          sources: [],
          profileChanges: {
            name: '新增姓名',
            language: '简体中文',
            background: '更新后的摘要',
            jobDescription: '相同职位',
            customInstructions: '',
          },
        };
      const skills = [
        {
          id: 'cpp',
          title: 'C++ 并发与内存管理',
          content: Array(20)
            .fill(
              '### C++ 并发与内存管理\n更新后的 C++ 面试资料。关注线程同步、对象生命周期和性能分析。',
            )
            .join('\n\n'),
          sources: [],
        },
        {
          id: 'rust',
          title: 'Rust 与系统编程：所有权、借用、异步任务与错误边界',
          content: Array(12)
            .fill(
              '### 所有权与错误处理\n新增 Rust 面试资料。理解所有权、借用与错误处理，结合合成案例检查接口约束。',
            )
            .join('\n\n'),
          sources: [],
        },
        {
          id: 'python',
          title: 'Python 自动化测试',
          content: '新增 Python 面试资料。使用自动化脚本验证接口和处理实验数据。',
          sources: [],
        },
      ];
      if (prompt.includes('删除技能'))
        return {
          answerText: '请选择需要删除的已有技能。',
          usage: null,
          sources: [],
          profileChanges: { skills: [] },
        };
      if (prompt.includes('技能逐项'))
        return {
          answerText: '请逐条勾选要保存的技能。',
          usage: null,
          sources: [],
          profileChanges: { skills },
          skillSourceIssues: [
            {
              skillId: 'rust',
              reason: 'source_unmatched',
              sources: [{ title: '待核验文档', url: 'https://example.com/unverified' }],
            },
          ],
        };
      const paragraphs = [
        '### 桌面应用与系统集成\n负责 Qt/C++ 桌面软件开发，完成设备通信、实时数据采集、图表展示与异常恢复。',
        '### 工程实践\n为接口边界、并发任务和数据持久化建立测试。记录版本、依赖与复现步骤，通过日志和性能分析定位问题。',
        '### 项目成果与职责\n独立完成模块设计与验证，明确个人贡献和团队分工，保留实验条件与结果的适用范围。',
      ];
      return {
        answerText: '已整理资料提案。请勾选需要保存的内容，长字段可点开阅读全文。',
        usage: null,
        sources: [],
        profileChanges: {
          name: '合成测试姓名',
          language: 'English',
          background: paragraphs
            .concat(paragraphs, paragraphs, ['简历全文末尾标记。'])
            .join('\n\n'),
          jobDescription:
            '### 目标岗位\n嵌入式软件工程师\n\n' +
            Array(8)
              .fill(
                '### 工作职责与任职要求\n负责嵌入式 Linux、驱动和 Qt/C++ 应用开发，参与接口设计、自动化测试和性能优化。要求理解多线程与内存管理，能独立复现问题并验证修复。',
              )
              .join('\n\n') +
            '\n\n职位全文末尾标记。',
          customInstructions: Array(8)
            .fill(
              '回答时先说明结论，再结合具体项目解释方案、取舍和验证依据。区分已完成的工作与待学习的知识；保留事实，不编造量化结果。',
            )
            .join('\n\n'),
          skills,
        },
      };
    };
  });
  const login = await app.firstWindow();
  const page = await connectUiAccount(app, login);
  page.setDefaultTimeout(20000);
  const mainWindow = await app.browserWindow(page);
  await mainWindow.evaluate((window) => window.setSize(1280, 1000));
  page.on('pageerror', (error) => errors.push(error.message));
  const base = {
    name: '原姓名',
    background: '原简历摘要',
    jobDescription: '原职位描述',
    language: '简体中文',
    customInstructions: '原自定义指令',
    skills: [
      { id: 'cpp', title: 'C++ 并发与内存管理', content: '原有 C++ 资料。', sources: [] },
      {
        id: 'qt',
        title: 'Qt 桌面开发',
        content: '原有 Qt 资料，未勾选时必须完整保留。',
        sources: [{ title: '原有来源', url: 'https://example.com/qt' }],
      },
    ],
  };
  const input = () => page.getByRole('textbox', { name: '聊天消息', exact: true });
  await input().waitFor();
  await page.evaluate(
    (base) => localStorage.setItem('copilot-personal-info-v1', JSON.stringify(base)),
    base,
  );
  await page.reload();
  await input().waitFor();
  const proposal = () => page.getByRole('region', { name: '待确认的资料更新', exact: true }).last();
  const saved = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('copilot-personal-info-v1')));
  const send = async (text) => {
    await input().fill(text);
    await page.getByRole('button', { name: '发送消息', exact: true }).click();
  };
  const capture = async (name, target = proposal()) => {
    if (screenshotDirectory)
      await target.screenshot({
        path: path.join(path.resolve(screenshotDirectory), name + '.png'),
        animations: 'disabled',
      });
  };
  const box = (name) => proposal().getByRole('checkbox', { name, exact: true });
  const checkCheckboxMotion = async (target, pseudo, toggle = target) => {
    const trigger = await toggle.elementHandle();
    try {
      const motion = await target.evaluate(
        async (node, { trigger, pseudo }) => {
          const probe = document.createElement('span');
          probe.style.color = 'var(--accent)'; node.parentElement.append(probe);
          const accent = getComputedStyle(probe).color; probe.remove();
          await Promise.all(
            node.getAnimations({ subtree: true }).map((animation) => animation.finished.catch(() => {})),
          );
          const read = () => {
            const style = getComputedStyle(node, pseudo);
            const masked = style.maskImage !== 'none';
            return { opacity: Number(style.opacity), clip: style.clipPath, masked,
              color: masked || pseudo === '::after' ? style.backgroundColor : style.borderBottomColor,
              checked: node.checked, border: getComputedStyle(node).borderTopColor };
          };
          const directions = [];
          for (let count = 0; count < 2; ++count) {
            const from = read();
            trigger.click();
            getComputedStyle(node).backgroundColor;
            await new Promise(requestAnimationFrame);
            const animations = node.getAnimations({ subtree: true });
            for (const animation of animations) {
              animation.pause();
              const timing = animation.effect.getTiming();
              animation.currentTime = timing.delay + Number(timing.duration) / 2;
            }
            const middle = read();
            for (const animation of animations) animation.finish();
            const to = read();
            directions.push({ from, middle, to });
          }
          return { radius: getComputedStyle(node).borderTopLeftRadius, directions, accent };
        },
        { trigger, pseudo },
      );
      assert.equal(motion.radius, '6px');
      for (const { from, middle, to } of motion.directions) {
        if (process.platform === 'darwin') assert.ok(to.masked, 'macOS uses its symbol mask for the glyph');
        assert.equal(to.color, motion.accent, 'The glyph uses the current theme accent');
        if (to.checked) {
          const alpha = Number(to.border.match(/(?:,\s*|\/\s*)([\d.]+)\s*\)$/)?.[1]);
          assert.ok(alpha > 0 && alpha < 1, 'The selected outline is translucent: ' + to.border);
        }
        assert.deepEqual(
          [from.opacity, to.opacity].sort(),
          [0, 1],
          'The glyph changes between hidden and visible in both directions',
        );
        assert(middle.opacity > 0 && middle.opacity < 1, 'The glyph fades through an intermediate frame');
        assert.match(middle.clip, /^inset\(/);
        assert.notEqual(middle.clip, from.clip, 'The glyph drawing advances beyond its initial clipping');
        assert.notEqual(middle.clip, to.clip, 'The glyph drawing has not reached its final clipping');
      }
    } finally {
      await trigger.dispose();
    }
  };
  const startReaderEntrance = () =>
    page.evaluate(() => {
      const frames = [];
      let frame;
      const sample = () => {
        const dialog = document.querySelector('dialog.proposal-reader[open]');
        if (dialog)
          frames.push({
            opacity: Number(getComputedStyle(dialog).opacity),
            backdrop: Number(getComputedStyle(dialog, '::backdrop').opacity),
            transform: getComputedStyle(dialog).transform,
            running: dialog.getAnimations().some((animation) => animation.playState === 'running'),
          });
        frame = requestAnimationFrame(sample);
      };
      frame = requestAnimationFrame(sample);
      window.readerEntranceFrames = { frames, stop: () => cancelAnimationFrame(frame) };
    });
  const finishReaderEntrance = async (reader) => {
    await reader.waitFor();
    await reader.evaluate(async (node) => {
      await Promise.all(
        node.getAnimations().map((animation) => animation.finished.catch(() => {})),
      );
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
    return page.evaluate(() => {
      const probe = window.readerEntranceFrames;
      probe.stop();
      delete window.readerEntranceFrames;
      return probe.frames;
    });
  };
  const startReaderExit = () =>
    page.evaluate(() => {
      const frames = [];
      let frame;
      const sample = () => {
        const snapshot = document.querySelector('[data-modal-exit]');
        if (snapshot) {
          const style = getComputedStyle(snapshot);
          frames.push({
            opacity: Number(style.opacity),
            backdrop: Number(getComputedStyle(snapshot, '::backdrop').opacity),
            transform: style.transform,
            inert: snapshot.inert,
            hidden: snapshot.getAttribute('aria-hidden'),
            topLayer: snapshot.matches(':popover-open'),
            pointerEvents: style.pointerEvents,
            backdropPointerEvents: getComputedStyle(snapshot, '::backdrop').pointerEvents,
            semanticDescendants: [
              ...snapshot.querySelectorAll('[id], [role], [name], [autofocus]'),
            ].filter(
              (node) =>
                node.hasAttribute('role') ||
                node.hasAttribute('name') ||
                node.hasAttribute('autofocus') ||
                (node.hasAttribute('id') && node.namespaceURI !== 'http://www.w3.org/2000/svg'),
            ).length,
            brokenMasks: [...snapshot.querySelectorAll('[mask]')].filter((node) => {
              const id = node.getAttribute('mask')?.match(/^url\(#(.+)\)$/)?.[1];
              const resource = id && document.getElementById(id);
              return !resource || !node.closest('svg')?.contains(resource);
            }).length,
            duplicateIds:
              new Set([...document.querySelectorAll('[id]')].map((node) => node.id)).size !==
              document.querySelectorAll('[id]').length,
            nativeModals: document.querySelectorAll('dialog:modal').length,
          });
        }
        frame = requestAnimationFrame(sample);
      };
      frame = requestAnimationFrame(sample);
      window.readerExitFrames = { frames, stop: () => cancelAnimationFrame(frame) };
    });
  const finishReaderExit = async () => {
    await page.waitForFunction(() => !document.querySelector('[data-modal-exit]'));
    const frames = await page.evaluate(() => {
      const probe = window.readerExitFrames;
      probe.stop();
      delete window.readerExitFrames;
      return probe.frames;
    });
    assert(
      frames.some((frame) => frame.opacity > 0.03 && frame.opacity < 0.97),
      'Dialog visual exit has intermediate opacity frames',
    );
    assert(
      frames.some((frame) => frame.backdrop > 0.03 && frame.backdrop < 0.97),
      'The normal backdrop brightens through intermediate opacity frames',
    );
    assert(
      frames.every(
        (frame) =>
          frame.transform === 'none' &&
          frame.inert &&
          frame.hidden === 'true' &&
          frame.topLayer &&
          frame.pointerEvents === 'none' &&
          frame.backdropPointerEvents === 'none' &&
          frame.semanticDescendants === 0 &&
          frame.brokenMasks === 0 &&
          !frame.duplicateIds &&
          frame.nativeModals === 0,
      ),
      'Only a noninteractive, inaccessible visual remains after native modal close: ' +
        JSON.stringify(frames),
    );
  };
  const checkReaderHeader = async (reader) => {
    const heading = reader.locator(':scope > .dialog-heading');
    const scroll = reader.locator('.dialog-scroll');
    const before = await heading.boundingBox();
    await scroll.evaluate(async (node) => {
      node.scrollTop = node.scrollHeight;
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
    const layout = await reader.evaluate((node) => {
      const heading = node.querySelector('.dialog-heading');
      const scroll = node.querySelector('.dialog-scroll');
      const close = heading.querySelector('.dialog-close-button');
      const choice =
        heading.querySelector('.profile-field-choice') ?? heading.querySelector('.proposal-status');
      const material = getComputedStyle(heading, '::before');
      const chatMaterial = getComputedStyle(document.querySelector('.page-toolbar'), '::before');
      const rect = heading.getBoundingClientRect();
      const area = scroll.getBoundingClientRect();
      const frame = node.getBoundingClientRect(),
        frameStyle = getComputedStyle(node);
      const title = heading.querySelector('.dialog-title h2').getBoundingClientRect();
      const closeBounds = close.getBoundingClientRect();
      const gutter = scroll.offsetWidth - scroll.clientWidth;
      const materialRight = rect.left + parseFloat(material.left) + parseFloat(material.width);
      const materialBottom = rect.top + parseFloat(material.top) + parseFloat(material.height);
      const trackStart = parseFloat(
        getComputedStyle(scroll, '::-webkit-scrollbar-track').marginTop,
      );
      return {
        top: rect.top,
        scrolled: scroll.scrollTop > 0,
        opacity: Number(material.opacity),
        scrollable: node.hasAttribute('data-scrollable'),
        divider: material.borderBottomColor,
        material: [material.backgroundColor, material.backdropFilter],
        chatMaterial: [chatMaterial.backgroundColor, chatMaterial.backdropFilter],
        gutter,
        gutterClear: area.right - rect.right >= gutter - 1,
        materialCoversWidth: Math.abs(materialRight - area.right) < 1,
        materialClearsTrack: materialBottom <= area.top + trackStart + 1,
        trackStart,
        height: rect.height,
        gap: close.getBoundingClientRect().left - choice.getBoundingClientRect().right,
        titleInset: title.left - frame.left - parseFloat(frameStyle.borderLeftWidth),
        closeInset: frame.right - parseFloat(frameStyle.borderRightWidth) - closeBounds.right,
        closeTopInset: closeBounds.top - frame.top - parseFloat(frameStyle.borderTopWidth),
        titleCloseCenterOffset:
          title.top + title.height / 2 - closeBounds.top - closeBounds.height / 2,
        overflow:
          node.scrollWidth > node.clientWidth ||
          [...heading.children].some((child) => {
            const bounds = child.getBoundingClientRect();
            return bounds.left < rect.left - 1 || bounds.right > rect.right + 1;
          }),
      };
    });
    assert.equal(layout.top, before.y, 'reader heading stays fixed while scrolling');
    assert.equal(layout.scrolled, true);
    assert.equal(layout.scrollable, true, 'A long reader retains its scrolling header treatment');
    assert.notEqual(layout.divider, 'rgba(0, 0, 0, 0)');
    assert.equal(layout.opacity, 1);
    assert.deepEqual(
      layout.material,
      layout.chatMaterial,
      'reader shares the chat header material',
    );
    assert(
      layout.gutterClear && layout.trackStart >= layout.height - 1,
      'scrollbar avoids the header',
    );
    assert(
      layout.materialCoversWidth,
      'header material covers the full width, including the top gutter',
    );
    assert(layout.materialClearsTrack, 'header material ends before the visible scrollbar track');
    assert(layout.gap >= 19.9, 'save selection and close have enough separation');
    assert(
      Math.abs(layout.titleInset - layout.closeInset) <= 1 / 64,
      'Reader title and close button have symmetric insets from the inner dialog edges: ' +
        JSON.stringify(layout),
    );
    assert(
      [layout.titleInset, layout.closeInset, layout.closeTopInset].every(
        (inset) => Math.abs(inset - 24) <= 1 / 64,
      ),
      'Reader title left and close button top/right insets share the fixed 24px spacing: ' +
        JSON.stringify(layout),
    );
    assert(
      Math.abs(layout.titleCloseCenterOffset) <= 1 / 64,
      'Reader title and close button are vertically centered on the same header line',
    );
    assert.equal(layout.overflow, false);
    if (process.argv.includes('--preview-reader')) {
      const bounds = await reader.boundingBox();
      console.log(
        'IMAGE:' +
          (
            await page.screenshot({
              type: 'jpeg',
              quality: 70,
              scale: 'css',
              clip: { ...bounds, height: Math.min(bounds.height, layout.height + 180) },
            })
          ).toString('base64'),
      );
    }
  };
  const readerVariants = [
    ['zh-CN', false, 1280],
    ['en', true, 800],
  ];
  const setReaderVariant = async (language, dark, width, height = 900) => {
    await page.evaluate(
      ({ language, dark }) => {
        localStorage.setItem('voxcue-language-v1', language);
        dispatchEvent(new StorageEvent('storage', { key: 'voxcue-language-v1' }));
        document.documentElement.classList.toggle('dark', dark);
      },
      { language, dark },
    );
    await mainWindow.evaluate((window, size) => window.setSize(...size), [width, height]);
  };
  const checkSkillMotion = async (region) => {
    const toggle = region.locator('.proposal-skills button[aria-controls]');
    const list = region.locator('.proposal-skill-rows');
    const settle = () =>
      list.evaluate(async (node) => {
        await Promise.all(
          node.getAnimations().map((animation) => animation.finished.catch(() => {})),
        );
      });
    await settle();
    const full = (await list.boundingBox()).height;
    const selection = await list
      .locator('input')
      .evaluateAll((nodes) => nodes.map((node) => node.checked));
    assert(full > 0);
    for (const expanded of [false, true]) {
      await toggle.focus();
      await toggle.press('Space');
      await page.waitForFunction(
        ({ id, expanded }) => document.getElementById(id)?.dataset.expanded === String(expanded),
        { id: await toggle.getAttribute('aria-controls'), expanded },
      );
      const middle = await list.evaluate((node) => {
        const animations = node.getAnimations();
        for (const animation of animations) {
          animation.pause();
          animation.currentTime = Number(animation.effect.getTiming().duration) / 2;
        }
        return {
          height: node.getBoundingClientRect().height,
          opacity: Number(getComputedStyle(node).opacity),
          inert: node.inert,
          hidden: node.getAttribute('aria-hidden'),
          properties: animations.map((animation) => animation.transitionProperty),
        };
      });
      assert(
        middle.properties.some((property) => property === 'block-size' || property === 'height'),
        'skill list has a height transition: ' + JSON.stringify(middle),
      );
      assert(middle.height > 0 && middle.height < full, 'skill list has intermediate height');
      assert(middle.opacity > 0 && middle.opacity < 1, 'skill list fades during transition');
      assert.equal(middle.inert, !expanded);
      assert.equal(middle.hidden, String(!expanded));
      if (process.argv.includes('--preview-motion'))
        console.log(
          'IMAGE:' +
            (await region.screenshot({ type: 'jpeg', quality: 65, scale: 'css' })).toString(
              'base64',
            ),
        );
      await list.evaluate((node) => {
        for (const animation of node.getAnimations()) animation.finish();
      });
      assert.equal(Math.round((await list.boundingBox()).height), expanded ? Math.round(full) : 0);
    }
    assert.deepEqual(
      await list.locator('input').evaluateAll((nodes) => nodes.map((node) => node.checked)),
      selection,
    );
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await toggle.click();
    assert.equal((await list.boundingBox()).height, 0);
    assert.equal(await list.evaluate((node) => node.getAnimations().length), 0);
    await toggle.press('Space');
    assert.equal(Math.round((await list.boundingBox()).height), Math.round(full));
    await page.emulateMedia({ reducedMotion: 'no-preference' });
  };
  const save = () => proposal().getByRole('button', { name: '保存所选', exact: true });
  const languageRow = () =>
    proposal().locator(':scope > .proposal-rows > .proposal-row').filter({ hasText: '面试语言' });
  await send('更新多项个人信息');
  await save().waitFor();
  await capture('proposal-overview', page);
  assert.equal(await proposal().locator(':scope > .proposal-rows > *').count(), 6);
  assert.equal(await proposal().locator('.proposal-skill-row:visible').count(), 0);
  // Retain the original five-row budget while also covering the added language row.
  assert.ok(
    (await proposal().boundingBox()).height - (await languageRow().boundingBox()).height < 650,
  );
  const rows = await proposal()
    .locator('.proposal-excerpt')
    .evaluateAll((nodes) =>
      nodes.map((node) => ({
        height: node.clientHeight,
        overflow: getComputedStyle(node).overflowY,
      })),
    );
  assert.ok(rows.every((row) => row.height < 50 && row.overflow === 'hidden'));
  const contours = await proposal().evaluate((node) => {
    const style = getComputedStyle(node);
    const operation = getComputedStyle(node.querySelector('.proposal-operation'));
    return {
      radius: style.borderTopLeftRadius,
      shape: style.cornerShape,
      operationRadius: operation.borderTopLeftRadius,
      operationShape: operation.cornerShape,
    };
  });
  assert.deepEqual(cornerShapeNames(contours), {
    radius: '20px',
    shape: 'squircle',
    operationRadius: '999px',
    operationShape: 'round',
  });
  checks.push('multiple long fields stay compact with clamped previews and no nested scroll areas');

  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await checkCheckboxMotion(box('保存姓名'), '::before');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.deepEqual(
    await box('保存姓名').evaluate((node) =>
      [null, '::before', '::after'].map((pseudo) => getComputedStyle(node, pseudo).transitionDuration),
    ),
    ['0s', '0s', '0s'],
  );
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await box('保存姓名').focus();
  await box('保存姓名').press('Space');
  assert.equal(await box('保存姓名').isChecked(), false);
  checks.push('rounded animated checkboxes, keyboard toggling and reduced motion');

  const view = proposal().getByRole('button', { name: '查看简历摘要', exact: true });
  await view.click();
  const reader = page.getByRole('dialog', { name: '简历摘要', exact: true });
  await reader.waitFor();
  assert((await reader.innerText()).includes('简历全文末尾标记'));
  assert.equal(await reader.locator('.dialog-scroll').count(), 1);
  assert.equal(await reader.getByRole('button', { name: '保存所选' }).count(), 0);
  await reader.getByRole('checkbox', { name: '保存简历摘要', exact: true }).uncheck();
  await startReaderExit();
  await reader.getByRole('button', { name: '关闭对话框', exact: true }).click();
  await finishReaderExit();
  assert.equal(await box('保存简历摘要').isChecked(), false);
  await view.focus();
  await view.press('Enter');
  await reader.waitFor();
  await reader.getByRole('checkbox', { name: '保存简历摘要', exact: true }).check();
  await capture('full-text-reader', reader);
  await reader.locator('.dialog-scroll').evaluate((node) => {
    node.scrollTop = node.scrollHeight;
  });
  const tail = await reader.getByText('简历全文末尾标记。', { exact: true }).boundingBox();
  const scrollArea = await reader.locator('.dialog-scroll').boundingBox();
  assert.ok(tail.y >= scrollArea.y && tail.y + tail.height <= scrollArea.y + scrollArea.height + 1);
  await capture('full-text-reader-end', reader);
  await startReaderExit();
  await reader.press('Escape');
  await view
    .evaluate(
      (node) =>
        new Promise((resolve) =>
          requestAnimationFrame(() => resolve(node === document.activeElement)),
        ),
    )
    .then((focused) => assert.equal(focused, true));
  await finishReaderExit();
  assert.equal(await box('保存简历摘要').isChecked(), true);
  assert.deepEqual(await saved(), base);
  checks.push(
    'full text dialog shows complete content, shares selection, restores focus and never saves itself',
  );

  for (const label of ['保存面试语言', '保存职位描述摘要', '保存自定义指令', '保存技能'])
    await box(label).uncheck();
  for (const theme of ['light', 'dark']) {
    await page.evaluate(
      (theme) => document.documentElement.classList.toggle('dark', theme === 'dark'),
      theme,
    );
    await capture('compact-fields-' + theme);
  }
  await mainWindow.evaluate((window) => window.setSize(800, 900));
  await capture('compact-fields-narrow');
  assert.equal(await proposal().evaluate((node) => node.scrollWidth <= node.clientWidth + 1), true);
  await mainWindow.evaluate((window) => window.setSize(1280, 1000));
  await waitForAsync(page, readStoredChatFixture, undefined, {
    matches: state => state?.conversations.some(c =>
      c.messages.some(m => JSON.stringify(m.selectedProfileFields) === '["background"]')),
  });
  await page.reload();
  await save().waitFor();
  assert.equal(await proposal().getByRole('checkbox', { checked: true }).count(), 1);
  await save().click();
  await proposal().getByText('已保存所选资料', { exact: true }).waitFor();
  assert.equal((await saved()).name, base.name);
  assert.equal((await saved()).jobDescription, base.jobDescription);
  assert.equal((await saved()).customInstructions, base.customInstructions);
  assert.equal((await saved()).language, base.language);
  assert.deepEqual((await saved()).skills, base.skills);
  assert.ok((await saved()).background.endsWith('简历全文末尾标记。'));
  assert.equal(await proposal().getByText('已保存', { exact: true }).count(), 1);
  assert.equal(
    await proposal()
      .locator('.proposal-status:visible')
      .filter({ hasText: /^未采用$/ })
      .count(),
    4,
  );
  assert.equal(await proposal().locator('.proposal-row-main > div.proposal-excerpt').count(), 0);
  assert.ok(
    (await proposal().boundingBox()).height - (await languageRow().boundingBox()).height < 400,
  );
  await capture('compact-saved');
  checks.push(
    'light/dark/narrow layout, persisted selection, one-click partial save and compact saved results',
  );

  const beforeText = await saved();
  const count = await app.evaluate(() => globalThis.selectionRequests);
  await send('只保存简历摘要');
  await page
    .locator('.chat-message.assistant')
    .last()
    .getByText('请在提案卡片勾选后点击保存所选。', { exact: true })
    .waitFor();
  assert.equal(await app.evaluate(() => globalThis.selectionRequests), count + 1);
  assert.deepEqual(await saved(), beforeText);
  checks.push('chat save phrases follow ordinary chat and cannot execute a save');

  await send('技能逐项');
  await box('保存技能：Rust 与系统编程：所有权、借用、异步任务与错误边界').uncheck();
  await checkCheckboxMotion(
    box('保存技能'),
    '::after',
    box('保存技能：Rust 与系统编程：所有权、借用、异步任务与错误边界'),
  );
  await box('删除技能：Qt 桌面开发').uncheck();
  await box('保存技能：Python 自动化测试').uncheck();
  assert.equal(await box('保存技能').evaluate((node) => node.indeterminate), true);
  await box('保存技能：Rust 与系统编程：所有权、借用、异步任务与错误边界').check();
  await checkSkillMotion(proposal());
  checks.push(
    'skill list height/fade transitions in both directions, keyboard, reduced motion and retained selection',
  );
  await startReaderEntrance();
  await proposal()
    .getByRole('button', {
      name: '查看技能：Rust 与系统编程：所有权、借用、异步任务与错误边界',
      exact: true,
    })
    .click();
  const skillReader = page.getByRole('dialog', {
    name: 'Rust 与系统编程：所有权、借用、异步任务与错误边界',
    exact: true,
  });
  const entering = await finishReaderEntrance(skillReader);
  assert(
    entering.some((frame) => frame.opacity > 0.03 && frame.opacity < 0.97),
    'Shared dialogs must fade through intermediate opacity frames',
  );
  assert(
    entering.some((frame) => frame.backdrop > 0.03 && frame.backdrop < 0.97),
    'The normal modal backdrop must darken through intermediate opacity frames',
  );
  assert(
    entering.every((frame) => frame.transform === 'none'),
    'Dialog entry must not scale or translate its measured geometry',
  );
  assert.equal(await skillReader.getByRole('note').count(), 0);
  for (const [language, dark, width] of readerVariants) {
    await setReaderVariant(language, dark, width);
    await checkReaderHeader(skillReader);
  }
  await setReaderVariant('zh-CN', false, 1280, 1000);
  checks.push(
    'skill reader fixed chat material header, clear scrollbar and separated controls in Chinese/light and English/dark/narrow',
  );
  await capture('skill-source-review', skillReader);
  assert.doesNotMatch(
    await skillReader.innerText(),
    /来源未核验|来源待核验|example\.com\/unverified/,
  );
  await skillReader.getByRole('button', { name: '关闭对话框', exact: true }).click();
  await page.locator('[data-modal-exit]').waitFor({ state: 'attached' });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForFunction(() => !document.querySelector('[data-modal-exit]'));
  await startReaderEntrance();
  await proposal()
    .getByRole('button', {
      name: '查看技能：Rust 与系统编程：所有权、借用、异步任务与错误边界',
      exact: true,
    })
    .click();
  const reducedEntrance = await finishReaderEntrance(skillReader);
  assert(reducedEntrance.length > 0);
  assert(
    reducedEntrance.every((frame) => frame.opacity === 1 && frame.backdrop === 1 && !frame.running),
    'Reduced motion shows the dialog and normal backdrop immediately',
  );
  await skillReader.getByRole('button', { name: '关闭对话框', exact: true }).click();
  assert.equal(await page.locator('[data-modal-exit]').count(), 0);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await proposal()
    .getByRole('button', { name: '查看技能：Python 自动化测试', exact: true })
    .click();
  const shortReader = page.getByRole('dialog', { name: 'Python 自动化测试', exact: true });
  await shortReader.waitFor();
  const shortHeader = await shortReader.evaluate((node) => {
    const scroll = node.querySelector('.dialog-scroll');
    const heading = node.querySelector('.dialog-heading');
    return {
      scrollable: node.hasAttribute('data-scrollable'),
      overflow: scroll.scrollHeight > scroll.clientHeight,
      divider: getComputedStyle(heading, '::before').borderBottomColor,
    };
  });
  assert.equal(shortHeader.overflow, false, 'The short reader fits on one page');
  assert.equal(shortHeader.scrollable, false);
  assert.equal(shortHeader.divider, 'rgba(0, 0, 0, 0)', 'A one-page dialog has no header divider');
  await shortReader.evaluate(async (node) => {
    await Promise.all(node.getAnimations().map((animation) => animation.finished.catch(() => {})));
  });
  await startReaderExit();
  await page.mouse.click(2, 2);
  await shortReader.waitFor({ state: 'detached' });
  await finishReaderExit();
  checks.push(
    'shared modal entry/exit, immediate native unlock and focus restoration, outside dismissal, one-page header and reduced motion including a running exit',
  );
  for (const theme of ['light', 'dark']) {
    await page.evaluate(
      (theme) => document.documentElement.classList.toggle('dark', theme === 'dark'),
      theme,
    );
    await capture('skill-selection-' + theme);
  }
  await save().click();
  await proposal().getByText('已保存所选资料', { exact: true }).waitFor();
  assert.deepEqual(
    (await saved()).skills.map((s) => s.id),
    ['cpp', 'qt', 'rust'],
  );
  assert.deepEqual((await saved()).skills[1], base.skills[1]);
  assert.equal((await saved()).skills[2].sources.length, 0);
  await capture('skill-saved');
  await page.reload();
  await proposal().getByText('已保存所选资料', { exact: true }).waitFor();
  assert.deepEqual((await saved()).skills[1], base.skills[1]);
  await proposal()
    .getByRole('button', {
      name: '查看技能：Rust 与系统编程：所有权、借用、异步任务与错误边界',
      exact: true,
    })
    .click();
  assert.equal(await page.getByRole('dialog').getByRole('note').count(), 0);
  assert.doesNotMatch(
    await page.getByRole('dialog').innerText(),
    /来源未核验|来源待核验|example\.com\/unverified/,
  );
  await page.getByRole('dialog').getByRole('button', { name: '关闭对话框' }).click();
  checks.push(
    'individual skills, mixed parent checkbox, removed source notes and retained unchecked skill bytes after reload',
  );

  await send('删除技能');
  await box('保存技能').uncheck();
  assert.equal(await save().isDisabled(), true);
  await capture('empty-selection');
  await box('删除技能：C++ 并发与内存管理').check();
  await capture('skill-delete-selection');
  await save().click();
  await proposal().getByText('已保存所选资料', { exact: true }).waitFor();
  assert.deepEqual(
    (await saved()).skills.map((s) => s.id),
    ['qt', 'rust'],
  );
  assert.deepEqual((await saved()).skills[0], base.skills[1]);
  await capture('skill-deleted');
  await proposal()
    .getByRole('button', { name: '查看技能：C++ 并发与内存管理', exact: true })
    .click();
  const deletedReader = page.getByRole('dialog', { name: 'C++ 并发与内存管理', exact: true });
  await deletedReader.getByText('本次已删除的技能', { exact: true }).waitFor();
  assert.equal(
    await deletedReader.locator('.dialog-heading .proposal-status').innerText(),
    '已删除',
  );
  for (const [language, dark, width] of readerVariants) {
    await setReaderVariant(language, dark, width);
    await checkReaderHeader(deletedReader);
  }
  await setReaderVariant('zh-CN', false, 1280, 1000);
  await capture('skill-deleted-reader', deletedReader);
  await deletedReader.getByRole('button', { name: '关闭对话框', exact: true }).click();
  checks.push(
    'deleted skill reader preserves symmetric title/close insets with a scrollbar across the reader variants',
  );
  checks.push('only explicitly selected deletion executes; empty selection disables save');
  const beforeStreaming = await saved();
  await send('流式逐项');
  const streaming = page.getByRole('region', { name: '正在生成的资料提案', exact: true }).last();
  await streaming.getByRole('status', { name: '姓名正在生成', exact: true }).waitFor();
  await capture('streaming-name', streaming);
  assert.equal(await streaming.locator('.proposal-heading .proposal-field-loading').count(), 0);
  await app.evaluate(() => globalThis.advanceSelectionPreview());
  await streaming.getByRole('button', { name: '展开技能清单', exact: true }).click();
  await streaming.getByRole('status', { name: '技能二正在生成', exact: true }).waitFor();
  await checkSkillMotion(streaming);
  assert.equal(
    await streaming.getByRole('status', { name: '姓名正在生成', exact: true }).count(),
    0,
  );
  assert.equal(
    await streaming.getByRole('status', { name: '技能一正在生成', exact: true }).count(),
    0,
  );
  assert.equal(
    await streaming.locator('.proposal-skill-row .proposal-operation').first().innerText(),
    '待修改',
  );
  assert.equal(
    await streaming.getByRole('button', { name: '保存所选', exact: true }).isDisabled(),
    true,
  );
  await capture('streaming-skills', streaming);
  await app.evaluate(() => globalThis.finishSelectionPreview());
  await streaming
    .getByRole('status', { name: '技能二正在生成', exact: true })
    .waitFor({ state: 'hidden' });
  assert.equal(await streaming.locator('.proposal-field-loading').count(), 0);
  await capture('streaming-fields-complete', streaming);
  await page.getByRole('button', { name: '停止回复', exact: true }).click();
  await page.getByRole('button', { name: '停止回复', exact: true }).waitFor({ state: 'hidden' });
  assert.equal(await streaming.locator('.proposal-field-loading').count(), 0);
  assert.deepEqual(await saved(), beforeStreaming);
  await capture('streaming-stopped', streaming);
  checks.push(
    'streaming fields and individual skills stop loading independently, header has no spinner, stop cannot save incomplete content',
  );
  const beforeKeeping = await saved();
  await send('更新多项个人信息');
  await proposal().getByRole('button', { name: '保留原资料', exact: true }).click();
  await proposal().getByText('已保留原资料', { exact: true }).waitFor();
  assert.deepEqual(await saved(), beforeKeeping);
  await capture('proposal-kept');
  await page.evaluate((info) => {
    localStorage.setItem(
      'copilot-personal-info-v1',
      JSON.stringify({
        ...info,
        name: '',
        background: '已有摘要',
        jobDescription: '相同职位',
        customInstructions: '已有指令',
      }),
    );
  }, beforeKeeping);
  await page.reload();
  await input().waitFor();
  await send('操作标签');
  await save().waitFor();
  const operations = proposal().locator('.proposal-operation');
  assert.equal(await operations.filter({ hasText: /^待新增$/ }).count(), 1);
  assert.equal(await operations.filter({ hasText: /^待修改$/ }).count(), 1);
  assert.equal(await operations.filter({ hasText: /^待删除$/ }).count(), 1);
  assert.equal(await operations.filter({ hasText: /^保持原内容$/ }).count(), 2);
  await capture('field-operation-states');
  checks.push(
    'keeping the current profile resolves the proposal without writing any field or skill',
  );
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify(
      { suite: 'profile-selection', checks, rendererErrors: errors.length, screenshotDirectory },
      null,
      2,
    ),
  );
} finally {
  await closeUiApp(app);
}
