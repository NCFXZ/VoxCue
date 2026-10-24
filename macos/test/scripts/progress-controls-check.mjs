import assert from 'node:assert/strict';

export async function checkProgressControls({ app, page, state, poll, probeFile, capture }) {
  const flatten = (node) => [node, ...(node.children ?? []).flatMap(flatten)];
  await app.evaluate(({ app, ipcMain }) => {
    const require = process
      .getBuiltinModule('module')
      .createRequire(app.getAppPath() + '/package.json');
    const { ChatGPTService } = require(
      app.getAppPath() + '/dist-electron/shared/electron/backend/chat/service.js',
    );
    globalThis.barQuota = 50;
    ChatGPTService.prototype.accountUsage = async () => ({
      provider: 'chatgpt',
      status: 'available',
      plan: 'plus',
      queriedAt: Date.now(),
      quotas: [
        ['five-hour', '5小时额度', 4 * 3600000 + 15 * 60000],
        ['weekly', '每周额度', 6 * 86400000 + 5 * 3600000 + 30 * 60000],
      ].map(([id, label, resetIn]) => ({
        id,
        label,
        unit: 'percent',
        total: null,
        used: 100 - globalThis.barQuota,
        remaining: null,
        remainingPercent: globalThis.barQuota,
        unlimited: false,
        state: 'available',
        additionalUsageAllowed: null,
        advisory: false,
        resetAt: Date.now() + resetIn,
        resetEstimated: false,
      })),
    });
    ChatGPTService.prototype.stream = async (request, emit, signal) =>
      new Promise((_resolve, reject) => {
        emit({ id: request.id, type: 'activity', activity: { phase: 'thinking' } });
        signal.addEventListener('abort', () => reject(new Error('Synthetic cancelled')), {
          once: true,
        });
      });
    ipcMain.removeHandler('appearance:native-menu');
    ipcMain.handle('appearance:native-menu', (_event, request) =>
      request.items.findIndex((item) => item.label === '设置'),
    );
  });
  const inspectBar = async (element, value) => {
    await element.waitFor();
    await page.waitForFunction(() =>
      [...document.querySelectorAll('.account-quota-progress,.audio-meter-track')]
        .filter((node) => node.getClientRects().length)
        .every((node) => node.classList.contains('macos-content-native')),
    );
    const box = await element.boundingBox();
    await poll(
      state,
      (s) =>
        flatten(s.tree).some(
          (node) =>
            node.class === 'NSProgressIndicator' &&
            node.identifier === 'voxcue-content-progress-bar' &&
            node.progressStyle === 0 &&
            !node.indeterminate &&
            node.controlSize === 1 &&
            Math.abs(node.value - value) < 0.01 &&
            Math.abs(node.frameWidth - box.width) < 1 &&
            node.frameHeight === 12 &&
            node.drawingHeight === node.frameHeight &&
            Math.abs(node.centerY - box.y - box.height / 2) < 1,
        ),
      'Actual Small NSProgressIndicator must keep natural size and align its track with the shared slot',
    );
  };
  const pixels = async (element) =>
    app.evaluate(
      async ({ BrowserWindow, nativeImage }, { file, rect }) => {
        const require = process
          .getBuiltinModule('module')
          .createRequire(process.cwd() + '/package.json');
        const win = BrowserWindow.getAllWindows().find((win) => win.getTitle() === 'VoxCue');
        const protection = win.isContentProtected();
        win.setContentProtection(false);
        try {
          const shot = await require(file).snapshot(win.getNativeWindowHandle());
          const image = nativeImage.createFromBuffer(shot.png).crop(shot.crop).crop(rect);
          return [...image.toBitmap()];
        } finally {
          win.setContentProtection(protection);
        }
      },
      {
        file: probeFile,
        rect: await element.evaluate((node) => {
          const r = node.getBoundingClientRect();
          return {
            x: Math.round(r.x),
            y: Math.round(r.y),
            width: Math.round(r.width),
            height: Math.round(r.height),
          };
        }),
      },
    );
  const buttonStyle = async (button) => {
    await button.waitFor();
    await button.page().mouse.move(0, 0);
    return button.evaluate(async (node) => {
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
      await Promise.all(
        node.getAnimations().map((animation) => animation.finished.catch(() => {})),
      );
      const c = getComputedStyle(node);
      return {
        fill: c.backgroundColor,
        color: c.color,
        radius: c.borderRadius,
        border: c.borderColor,
        corner: c.cornerShape,
        width: node.clientWidth,
        height: node.clientHeight,
      };
    });
  };
  const solid = async (button, sendStyle) => {
    const style = await buttonStyle(button);
    assert.deepEqual(style, sendStyle, 'Stop must use the same solid circle as Send');
    assert.equal(style.color, 'rgb(255, 255, 255)');
    assert.notEqual(style.fill, 'rgba(0, 0, 0, 0)');
    assert.equal(style.width, style.height);
    assert.equal(style.corner, 'round');
    assert.ok(style.radius === '50%' || parseFloat(style.radius) >= style.width / 2);
    assert.equal(style.border, 'rgba(0, 0, 0, 0)');
  };
  const composer = await poll(
    async () => {
      for (const candidate of app.context().pages())
        if (!candidate.isClosed() && (await candidate.title()) === 'VoxCue composer')
          return candidate;
    },
    Boolean,
    'Owned composer projection',
  );
  for (const theme of ['light', 'dark']) {
    await app.evaluate(({ nativeTheme }, theme) => {
      nativeTheme.themeSource = theme;
    }, theme);
    await page.emulateMedia({ colorScheme: theme });
    await page.getByRole('button', { name: '用户菜单', exact: true }).click();
    const settings = page.getByRole('dialog', { name: '设置', exact: true });
    await settings.getByRole('button', { name: '账户与用量', exact: true }).click();
    const bar = settings.getByRole('progressbar', { name: '每周额度剩余比例', exact: true });
    const fiveHour = settings.getByRole('progressbar', { name: '5小时额度剩余比例', exact: true });
    const frames = [];
    for (const value of [0, 25, 43, 100]) {
      await app.evaluate((_electron, value) => {
        globalThis.barQuota = value;
      }, value);
      await settings.getByRole('button', { name: '刷新账户额度', exact: true }).click();
      await inspectBar(bar, value);
      await inspectBar(fiveHour, value);
      if (value === 43) {
        const cards = await settings.locator('.account-quota').evaluateAll((cards) =>
          cards.map((card) => {
            const title = card.querySelector('header').getBoundingClientRect(),
              reset = card.querySelector('.account-quota-reset'),
              remaining = card.querySelector('.account-quota-remaining'),
              bar = card.querySelector('.account-quota-progress').getBoundingClientRect();
            return {
              titleGap: reset.getBoundingClientRect().top - title.bottom,
              barGap: bar.top - reset.getBoundingClientRect().bottom,
              aligned: reset.getBoundingClientRect().y === remaining.getBoundingClientRect().y,
              matching: ['fontSize', 'fontWeight', 'fontFamily', 'lineHeight', 'color'].every(
                (property) =>
                  getComputedStyle(reset)[property] === getComputedStyle(remaining)[property],
              ),
            };
          }),
        );
        assert.equal(cards.length, 2);
        for (const card of cards) {
          assert.equal(card.titleGap, 4);
          assert.equal(card.barGap, card.titleGap);
          assert.ok(card.aligned && card.matching, 'Both quota cards align reset and remaining');
        }
        await capture('quota-aligned-' + theme);
      } else if (value === 0 || value === 100) frames.push(await pixels(bar));
    }
    const changed = frames[0].reduce(
      (count, value, index) => count + (Math.abs(value - frames[1][index]) > 16 ? 1 : 0),
      0,
    );
    assert.ok(changed > 100, 'Actual system progress pixels change between 0% and 100%');
    await settings.getByRole('button', { name: '关闭设置', exact: true }).click();
    await composer.getByRole('textbox', { name: '聊天消息', exact: true }).fill('合成停止按钮检查');
    const send = composer.getByRole('button', { name: '发送消息', exact: true });
    const sendStyle = await buttonStyle(send);
    await send.click();
    const stop = composer.getByRole('button', { name: '停止回复', exact: true });
    await solid(stop, sendStyle);
    await stop.click();
    await stop.waitFor({ state: 'hidden' });
    await page.getByRole('button', { name: '开始面试', exact: true }).click();
    const start = page.getByRole('dialog', { name: '开始面试', exact: true });
    for (const [source, label] of [
      ['microphone', '麦克风'],
      ['system', '系统声音'],
    ]) {
      await start.getByRole('button', { name: '测试' + label, exact: true }).click();
      await app.evaluate(({ BrowserWindow }, source) => {
        const win = BrowserWindow.getAllWindows().find((win) => win.getTitle() === 'VoxCue');
        globalThis.meterTimer = setInterval(
          () =>
            win.webContents.send('dictation:event', {
              type: 'activity',
              source,
              speaking: true,
              level: 0.25,
            }),
          80,
        );
      }, source);
      const meter = start.getByRole('meter', { name: label + '电平', exact: true });
      await meter.waitFor();
      await page.waitForFunction(
        (label) =>
          Number(
            document
              .querySelector(`[role=meter][aria-label="${label}电平"]`)
              ?.getAttribute('aria-valuenow'),
          ) > 0,
        label,
      );
      await inspectBar(meter, Number(await meter.getAttribute('aria-valuenow')));
      await start.getByRole('button', { name: '停止' + label + '测试', exact: true }).click();
      await app.evaluate(() => clearInterval(globalThis.meterTimer));
    }
    await start.getByRole('button', { name: '取消', exact: true }).click();
  }
  await page.getByRole('button', { name: '开始面试', exact: true }).click();
  const [floating] = await Promise.all([
    app.waitForEvent('window'),
    page
      .getByRole('dialog', { name: '开始面试', exact: true })
      .getByRole('button', { name: '确认开始', exact: true })
      .click(),
  ]);
  const auto = floating.getByRole('button', { name: '静音后自动提交完整问题', exact: true });
  if ((await auto.getAttribute('aria-pressed')) === 'true') await auto.click();
  await floating.getByRole('textbox', { name: '面试提问', exact: true }).fill('合成面试停止检查');
  const send = floating.getByRole('button', { name: '发送面试问题', exact: true });
  const sendStyle = await buttonStyle(send);
  await send.click();
  const stop = floating.getByRole('button', { name: '停止当前回答', exact: true });
  await solid(stop, sendStyle);
  await stop.click();
  await stop.waitFor({ state: 'hidden' });
  console.log(
    'PASS: light/dark official NSProgressIndicator bars, natural size/alignment, 0/25/43/100 values and real pixels, synthetic microphone/system meters, solid chat/interview Stop buttons and cancellation.',
  );
}
