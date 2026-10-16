import { _electron as electron } from 'playwright';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { installUiAccount, closeUiApp } from './install-ui-account.mjs';
await mkdir('test/results', { recursive: true });
const profile = await mkdtemp(path.resolve('test/results/interview-screenshot-ui-'));
const env = { ...process.env, COPILOT_TEST_USER_DATA: profile, VITE_DEV_SERVER_URL: '' };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: ['.'], env });
const errors = [],
  checks = [];
try {
  assert.equal(await app.evaluate(({ app }) => app.getPath('userData')), profile);
  await installUiAccount(app, { speech: true });
  await app.evaluate(({ app }) => {
    const require = process
      .getBuiltinModule('module')
      .createRequire(app.getAppPath() + '/package.json');
    const { SpeechHost } = require(
      app.getAppPath() + '/dist-electron/shared/electron/backend/speech/host.js',
    );
    const { ChatGPTService, buildInput } = require(
      app.getAppPath() + '/dist-electron/shared/electron/backend/chat/service.js',
    );
    const crypto = require('node:crypto');
    globalThis.screenshotRequests = [];
    globalThis.screenshotFixture = { count: 0, mode: 'normal', providerMode: 'normal' };
    SpeechHost.prototype.call = async function (call) {
      globalThis.screenshotSpeech = (event) => this.emit(event);
      const status = {
        state: call.op === 'start' ? 'running' : 'idle',
        model: 'Synthetic speech',
        devices: [],
      };
      this.emit({ type: 'status', status });
      return status;
    };
    ChatGPTService.prototype.stream = async (request, emit) => {
      if (request.id.startsWith('history-title-'))
        return { answerText: '截图面试记录', usage: null, sources: [] };
      const input = buildInput(request);
      const images = input.flatMap((turn) =>
        Array.isArray(turn.content)
          ? turn.content.filter((item) => item.type === 'input_image')
          : [],
      );
      const record = {
        id: request.id,
        instructions: request.instructions,
        knowledgeBaseId: request.knowledgeBaseId,
        turns: request.turns.map((turn) => ({
          role: turn.role,
          content: turn.content,
          files: turn.files?.map((file) => ({
            name: file.name,
            bytes: file.bytes.byteLength,
            hash: crypto.createHash('sha256').update(file.bytes).digest('hex'),
          })),
        })),
        imageInputs: images.length,
        imageFormat: images[0]?.image_url.startsWith('data:image/png;base64,'),
      };
      globalThis.screenshotRequests.push(record);
      if (globalThis.screenshotFixture.providerMode === 'fail')
        throw Error('当前模型不支持图片输入');
      const answerText = '截图回归回答 ' + globalThis.screenshotRequests.length;
      emit({ id: request.id, type: 'delta', text: answerText });
      return { answerText, usage: null, sources: [] };
    };
  });
  const login = await app.firstWindow();
  const [main] = await Promise.all([
    app.waitForEvent('window'),
    login.getByRole('button', { name: '使用 ChatGPT 继续', exact: true }).click(),
  ]);
  main.setDefaultTimeout(20000);
  await main.getByRole('button', { name: '开始面试', exact: true }).click();
  const [floating] = await Promise.all([
    app.waitForEvent('window'),
    main
      .getByRole('dialog', { name: '开始面试', exact: true })
      .getByRole('button', { name: '确认开始', exact: true })
      .click(),
  ]);
  floating.setDefaultTimeout(20000);
  floating.on('pageerror', (error) => errors.push(error.message));
  await floating.getByText('语音模型已就绪', { exact: true }).waitFor();
  await floating.getByRole('button', { name: '静音后自动提交完整问题', exact: true }).click();
  const nativeCapture = await app.evaluate(async ({ app, BrowserWindow, nativeImage }) => {
    const require = process
      .getBuiltinModule('module')
      .createRequire(app.getAppPath() + '/package.json');
    const { captureInterviewScreen } = require(
      app.getAppPath() + '/dist-electron/shared/electron/screenshot.js',
    );
    const window = BrowserWindow.getAllWindows().find((win) =>
      win.webContents.getURL().endsWith('#interview'),
    );
    const file = await captureInterviewScreen(
      window,
      process.platform,
      new AbortController().signal,
    );
    const image = nativeImage.createFromBuffer(Buffer.from(file.bytes));
    // Return metadata only: actual desktop pixels are never saved or sent to a provider.
    return {
      name: file.name,
      bytes: file.bytes.byteLength,
      size: image.getSize(),
      empty: image.isEmpty(),
    };
  });
  assert.equal(nativeCapture.empty, false);
  assert.ok(nativeCapture.bytes > 0 && nativeCapture.bytes <= 8 * 1024 * 1024);
  assert.ok(nativeCapture.size.width > 100 && nativeCapture.size.height > 100);
  checks.push(
    'actual native display capture returned a bounded image; pixels stayed local and were discarded',
  );
  await app.evaluate(({ desktopCapturer, screen, nativeImage, BrowserWindow }) => {
    desktopCapturer.getSources = async (options) => {
      const fixture = globalThis.screenshotFixture;
      fixture.count++;
      fixture.options = options;
      if (fixture.mode === 'fail') throw Error('Synthetic capture failure');
      if (fixture.mode === 'hold')
        await new Promise((resolve) => {
          fixture.finish = resolve;
        });
      const pixels = Buffer.alloc(4 * 4 * 4);
      for (let i = 0; i < pixels.length; i += 4) {
        pixels[i] = fixture.count * 25;
        pixels[i + 1] = 100;
        pixels[i + 2] = 180;
        pixels[i + 3] = 255;
      }
      const window = BrowserWindow.getAllWindows().find((win) =>
        win.webContents.getURL().endsWith('#interview'),
      );
      return [
        {
          id: 'screen:fixture',
          display_id: String(screen.getDisplayMatching(window.getBounds()).id),
          thumbnail: nativeImage.createFromBitmap(pixels, { width: 4, height: 4 }),
        },
      ];
    };
  });
  const attach = floating.getByRole('button', { name: '发送题目时附当前截图', exact: true });
  const camera = floating.getByRole('button', { name: '仅发送当前屏幕截图', exact: true });
  const send = floating.getByRole('button', { name: '发送面试问题', exact: true });
  const input = floating.getByRole('textbox', { name: '面试提问', exact: true });
  assert.equal(await attach.getAttribute('aria-pressed'), 'false');
  assert.equal(await camera.isEnabled(), true);
  const cameraBox = await camera.boundingBox(),
    sendBox = await send.boundingBox();
  assert.ok(cameraBox.x + cameraBox.width <= sendBox.x && Math.abs(cameraBox.y - sendBox.y) < 1);
  assert.equal(await floating.locator('[title]').count(), 0);
  const requests = () => app.evaluate(() => globalThis.screenshotRequests);
  const captured = () => app.evaluate(() => globalThis.screenshotFixture.count);
  const waitAnswer = async (count) => {
    await app.evaluate((_electron, count) => (globalThis.screenshotExpected = count), count);
    await floating.getByText('截图回归回答 ' + count, { exact: true }).waitFor();
    return (await requests()).at(-1);
  };
  await input.fill('草稿文字不能发送');
  await camera.click();
  const only = await waitAnswer(1);
  assert.equal(await input.inputValue(), '草稿文字不能发送');
  assert.equal(only.turns.length, 1);
  assert.equal(only.imageInputs, 1);
  assert.equal(only.imageFormat, true);
  assert.equal(only.knowledgeBaseId, null);
  assert.ok(!JSON.stringify(only).includes('草稿文字'));
  await floating.getByText('仅发送当前截图', { exact: true }).waitFor();
  assert.equal(await captured(), 1);
  await attach.click();
  await input.fill('请解释截图中的 Python 题目');
  await send.click();
  const withQuestion = await waitAnswer(2);
  assert.equal(withQuestion.turns.at(-1).content, '请解释截图中的 Python 题目');
  assert.equal(withQuestion.imageInputs, 1);
  assert.equal(await captured(), 2);
  assert.notEqual(withQuestion.turns.at(-1).files[0].hash, only.turns[0].files[0].hash);
  await attach.click();
  await input.fill('普通文字问题');
  await send.click();
  const plain = await waitAnswer(3);
  assert.equal(plain.imageInputs, 0);
  assert.equal(await captured(), 2);
  checks.push(
    'default off; screenshot button before send; screenshot-only preserves draft; attached questions get a fresh image; off sends text only',
  );
  await attach.click();
  await floating.getByRole('button', { name: '静音后自动提交完整问题', exact: true }).click();
  await app.evaluate(() =>
    globalThis.screenshotSpeech({
      type: 'segment',
      segment: {
        id: 'auto-image',
        source: 'system',
        text: '自动题目也附截图',
        final: true,
        startMs: Date.now(),
        endMs: Date.now() + 10,
        reason: 'silence',
      },
    }),
  );
  const automatic = await waitAnswer(4);
  assert.equal(automatic.turns.at(-1).content, '自动题目也附截图');
  assert.equal(automatic.imageInputs, 1);
  await floating.getByRole('button', { name: '静音后自动提交完整问题', exact: true }).click();
  await input.fill('保留我的输入，不随截图发出');
  await app.evaluate(() => {
    globalThis.screenshotSpeech({
      type: 'segment',
      segment: {
        id: 'private-mic',
        source: 'microphone',
        text: '麦克风转写不要带到仅截图请求',
        final: true,
        startMs: Date.now(),
        endMs: Date.now() + 10,
      },
    });
    globalThis.screenshotSpeech({
      type: 'segment',
      segment: {
        id: 'private-system',
        source: 'system',
        text: '系统临时转写不要发送',
        final: false,
        startMs: Date.now(),
        endMs: Date.now() + 10,
      },
    });
  });
  await camera.click();
  const isolated = await waitAnswer(5);
  assert.equal(isolated.turns.length, 1);
  assert.equal(isolated.imageInputs, 1);
  assert.ok(
    !JSON.stringify(isolated).match(
      /保留我的输入|麦克风转写|系统临时转写|普通文字问题|自动题目也附截图|截图回归回答/,
    ),
  );
  assert.equal(await input.inputValue(), '保留我的输入，不随截图发出');
  checks.push(
    'automatic interviewer questions attach a fresh screenshot; screenshot-only excludes all draft/transcript/conversation history',
  );
  await app.evaluate(() => {
    globalThis.screenshotFixture.mode = 'hold';
  });
  await camera.click();
  await floating
    .locator('.floating-answer-item')
    .last()
    .locator('.activity-detail')
    .filter({ hasText: '正在截取当前屏幕' })
    .waitFor();
  assert.equal(await app.evaluate(() => typeof globalThis.screenshotFixture.finish), 'function');
  assert.equal(await camera.isDisabled(), true);
  await floating.getByRole('button', { name: '停止当前回答', exact: true }).click();
  await app.evaluate(() => {
    globalThis.screenshotFixture.finish();
    globalThis.screenshotFixture.mode = 'normal';
  });
  await floating
    .locator('.floating-answer-item')
    .last()
    .getByText('已停止回复。', { exact: true })
    .waitFor();
  assert.equal((await requests()).length, 5);
  await app.evaluate(() => {
    globalThis.screenshotFixture.mode = 'fail';
  });
  await camera.click();
  await floating
    .locator('.floating-answer-item')
    .last()
    .getByText('无法截取当前屏幕，请检查屏幕录制权限后重试。', { exact: true })
    .waitFor();
  assert.equal((await requests()).length, 5);
  await app.evaluate(() => {
    globalThis.screenshotFixture.mode = 'normal';
  });
  await floating
    .locator('.floating-answer-item')
    .last()
    .getByRole('button', { name: '重试面试回答', exact: true })
    .click();
  const retried = await waitAnswer(6);
  assert.equal(retried.turns.length, 1);
  assert.equal(retried.imageInputs, 1);
  assert.equal(await input.inputValue(), '保留我的输入，不随截图发出');
  checks.push(
    'cancel during capture prevents provider call; capture failure is visible; retry preserves screenshot-only intent and captures again',
  );
  await app.evaluate(() => {
    globalThis.screenshotFixture.providerMode = 'fail';
  });
  await camera.click();
  await floating
    .locator('.floating-answer-item')
    .last()
    .getByText('当前模型不支持图片输入', { exact: true })
    .waitFor();
  assert.equal((await requests()).length, 7);
  assert.equal((await requests()).at(-1).imageInputs, 1);
  assert.equal(
    await floating
      .getByRole('button', { name: '关闭截图保护', exact: true })
      .getAttribute('aria-pressed'),
    'true',
  );
  const handle = floating.getByRole('button', { name: '拖动右下角调整尺寸', exact: true });
  for (let i = 0; i < 4; i++) await handle.press('ArrowDown');
  for (const theme of ['light', 'dark']) {
    await floating.evaluate(
      (theme) => document.documentElement.classList.toggle('dark', theme === 'dark'),
      theme,
    );
    const layout = await floating.locator('.floating-composer').evaluate((node) => {
      const form = node.getBoundingClientRect(),
        options = node.querySelector('.floating-composer-options').getBoundingClientRect(),
        actions = node.querySelector('.floating-composer-actions').getBoundingClientRect();
      return {
        left: options.left,
        right: actions.right,
        formLeft: form.left,
        formRight: form.right,
        optionsRight: options.right,
        actionsLeft: actions.left,
      };
    });
    assert.ok(
      layout.left >= layout.formLeft &&
        layout.right <= layout.formRight &&
        layout.optionsRight < layout.actionsLeft,
    );
    await floating
      .locator('.floating-composer')
      .screenshot({ path: path.join(profile, 'controls-' + theme + '.png') });
  }
  checks.push(
    'unsupported image input stays an explicit failure; capture protection unchanged; controls fit minimum panel in both themes',
  );
  await floating.getByRole('button', { name: '结束面试', exact: true }).click();
  await Promise.all([
    floating.waitForEvent('close'),
    floating.getByRole('button', { name: '确认结束面试', exact: true }).click(),
  ]);
  const history = await main.evaluate(() => localStorage.getItem('copilot-interview-history-v1'));
  assert.ok(history?.includes('"screenshot":"only"'));
  assert.ok(!history.match(/data:image|iVBORw0KGgo|"bytes"/));
  assert.deepEqual(errors, []);
  const result = {
    passed: true,
    profile,
    checks,
    nativeCapture,
    requests: (await requests()).length,
    captures: await captured(),
    errors,
    liveAccount: false,
    nativeAudio: false,
    screenshotsUploadedToRealProvider: false,
    screenshotPixelsSaved: false,
  };
  await writeFile(path.join(profile, 'result.json'), JSON.stringify(result, null, 2));
  console.log(result);
} catch (error) {
  console.error(error);
  for (const page of app.windows())
    if (page.url().endsWith('#interview'))
      await page.screenshot({ path: path.join(profile, 'failure-ui.png') });
  throw error;
} finally {
  await app.evaluate(({ BrowserWindow }) => {
    for (const window of BrowserWindow.getAllWindows()) window.destroy();
  });
  await closeUiApp(app);
}
