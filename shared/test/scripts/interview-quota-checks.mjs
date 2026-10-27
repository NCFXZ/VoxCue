import assert from 'node:assert/strict';
import path from 'node:path';

// Called by cloud-account-smoke --interview-quota: real loopback accounting,
// isolated desktop/local history, synthetic audio/images; no wall-clock sleeps.
export async function checkInterviewQuota({
  app,
  main,
  services,
  userId,
  directory,
  advanceServer,
}) {
  await main.evaluate(() => window.desktop.signInWithChatGPT());
  const errors = [];
  let clock = 0;
  const advanceTo = async (target) => {
    while (clock < target) {
      const ms = Math.min(15000, target - clock);
      clock += ms;
      advanceServer(ms);
      await app.evaluate(async (_electron, ms) => {
        globalThis.quotaClock += ms;
        await globalThis.quotaLease.tick();
      }, ms);
    }
  };
  const records = () =>
    main.evaluate(() => JSON.parse(localStorage.getItem('copilot-interview-history-v1') || '[]'));
  const start = async (minutes, silent = false) => {
    const code = services.rights.issue({ minutes }).code;
    assert.equal(
      (await main.evaluate((code) => window.desktop.cloudUsage({ action: 'redeem', code }), code))
        .ok,
      true,
    );
    await app.evaluate((_electron, silent) => {
      globalThis.quotaSilent = silent;
    }, silent);
    const opened = app.waitForEvent('window');
    await main.evaluate(() =>
      window.desktop.openInterview({
        mode: 'local',
        options: { sources: ['system'], speechModel: 'paraformer', inferenceDevice: 'cpu' },
        aiEnabled: true,
        modelId: 'synthetic-model',
        effort: 'auto',
        autoAnswer: false,
      }),
    );
    const floating = await opened;
    floating.setDefaultTimeout(20000);
    floating.on('pageerror', (error) => errors.push(error.message));
    await floating.locator('.floating-toolbar').waitFor();
    await floating.getByRole('status', { name: '语音模型：正常', exact: true }).waitFor();
    if (!silent)
      await floating
        .getByLabel('面试转写', { exact: true })
        .getByText('Synthetic quota interview', { exact: true })
        .waitFor();
    return floating;
  };
  let floating = await start(6);
  const warning = () => floating.locator('.floating-usage-notice');
  assert.equal(await warning().count(), 0);
  const camera = floating.getByRole('button', { name: '截取图像', exact: true });
  const mac = (await floating.evaluate(() => window.desktop.platform)) === 'macos';
  assert.equal(await camera.locator('kbd').innerText(), mac ? '⌃S' : 'Alt+S');
  await floating.keyboard.press(mac ? 'Alt+s' : 'Control+s');
  assert.equal(await floating.locator('.floating-screenshot-preview').count(), 0);
  await floating.keyboard.press(mac ? 'Control+s' : 'Alt+s');
  await floating.locator('.floating-screenshot-preview').waitFor();
  await floating.getByRole('button', { name: '移除截图 1', exact: true }).click();
  await floating.getByRole('button', { name: '收起面试窗口', exact: true }).click();
  await floating.waitForFunction(
    () =>
      document.querySelector('.floating-shell').classList.contains('is-collapsed') &&
      !document.querySelector('.floating-shell').dataset.panelMotion,
  );
  const folded = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((win) => win.webContents.getURL().endsWith('#interview'))
      .getBounds(),
  );
  await advanceTo(60000);
  await warning().filter({ hasText: '5 分钟' }).waitFor();
  const warned = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((win) => win.webContents.getURL().endsWith('#interview'))
      .getBounds(),
  );
  assert.equal(warned.height, folded.height + 64);
  assert.equal(warned.y, folded.y);
  assert.equal(warned.width, folded.width);
  assert.equal(await warning().isVisible(), true);
  await floating.getByRole('button', { name: '展开面试窗口', exact: true }).click();
  await floating.waitForFunction(
    () =>
      !document.querySelector('.floating-shell').classList.contains('is-collapsed') &&
      !document.querySelector('.floating-shell').dataset.panelMotion,
  );
  if (process.argv.includes('--preview'))
    await floating.screenshot({ path: path.join(directory, 'quota-five-minutes.png') });
  await advanceTo(300000);
  await warning().filter({ hasText: '1 分钟' }).waitFor();
  await advanceTo(301000);
  await warning().filter({ hasText: '59 秒' }).waitFor();
  await advanceTo(359000);
  await warning().filter({ hasText: '1 秒' }).waitFor();
  if (process.argv.includes('--preview')) {
    await floating.screenshot({ path: path.join(directory, 'quota-one-second.png') });
    console.log('QUOTA_VISUAL_DIRECTORY=' + directory);
    await new Promise((resolve) => setTimeout(resolve, 30000));
  }
  await app.evaluate(() => {
    globalThis.quotaHoldStop = true;
  });
  await advanceTo(360000);
  await warning().filter({ hasText: '正在保存' }).waitFor();
  assert.equal(floating.isClosed(), false);
  assert.equal(
    (await records()).length,
    0,
    'Do not close or claim saved before the audio tail finishes.',
  );
  const closed = floating.waitForEvent('close');
  await app.evaluate(() => globalThis.quotaReleaseStop());
  await closed;
  await main.getByRole('status').filter({ hasText: '本次面试记录已保存在本机' }).waitFor();
  let saved = await records();
  assert.equal(saved.length, 1);
  assert.equal(saved[0].status, 'ended');
  assert.equal(saved[0].mock, false);
  assert.ok(saved[0].transcripts.some((row) => row.text === 'Final quota tail'));
  assert.equal(services.rights.current(userId).remainingSeconds, 0);
  await main.getByRole('button', { name: '面试记录', exact: true }).click();
  await main.getByRole('heading', { name: '面试记录', exact: true }).count();

  floating = await start(1, true);
  const emptyClosed = floating.waitForEvent('close');
  await advanceTo(420000);
  await emptyClosed;
  saved = await records();
  assert.equal(saved.length, 2, 'A silent expired interview is still retained.');
  assert.ok(saved.some((record) => record.transcripts.length === 0));

  floating = await start(1);
  await floating.evaluate(() => {
    const write = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'copilot-interview-history-v1')
        throw new DOMException('Synthetic full disk', 'QuotaExceededError');
      return write.call(this, key, value);
    };
    window.restoreQuotaStorage = () => {
      Storage.prototype.setItem = write;
    };
  });
  await advanceTo(480000);
  await floating.getByRole('alert').filter({ hasText: '记录保存失败' }).waitFor();
  assert.equal(floating.isClosed(), false);
  assert.equal((await records()).length, 2);
  assert.ok(
    await floating
      .getByLabel('面试转写', { exact: true })
      .getByText('Synthetic quota interview', { exact: true })
      .isVisible(),
  );
  for (const action of ['speech', 'reconnect']) {
    const refused = await floating.evaluate(async (action) => {
      try {
        if (action === 'speech')
          await window.desktop.speech({ op: 'start', options: { sources: ['system'] } });
        else await window.desktop.reconnectInterviewAudio();
        return false;
      } catch {
        return true;
      }
    }, action);
    assert.equal(refused, true, 'An expired window cannot restart capture through IPC.');
  }
  await floating.evaluate(() => window.restoreQuotaStorage());
  const retryClosed = floating.waitForEvent('close');
  await floating.getByRole('button', { name: '结束面试', exact: true }).click();
  await floating.getByRole('button', { name: '确认结束面试', exact: true }).click();
  await retryClosed;
  assert.equal((await records()).length, 3);
  assert.deepEqual(errors, []);
  console.log(
    'Interview quota UI: 5-minute warning, 60/59/1-second boundaries, zero-credit tail flush and archive, empty record retention, save-failure retry, expired IPC rejection and platform screenshot shortcut passed; synthetic data only.',
  );
}
