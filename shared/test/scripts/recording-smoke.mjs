import { evaluateHistory } from './stored-history-fixture.mjs';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, readFile, readdir } from 'node:fs/promises';
import { testRoot, electron } from './test-workspace.mjs';
import { offlineElectronEntry } from './offline-electron-entry.mjs';
import { closeUiApp, connectUiAccount, installUiAccount } from './install-ui-account.mjs';
import { holdControl } from './assert-download-button.mjs';
import { assertMenuBackdrop } from './assert-menu-backdrop.mjs';
import { captureRequested } from './capture-requested.mjs';

const profile = path.join(testRoot, 'recording-profile');
await mkdir(profile);
const app = await electron.launch({
  args: [await offlineElectronEntry()],
  env: { ...process.env, COPILOT_TEST_USER_DATA: profile, VITE_DEV_SERVER_URL: '' },
});
try {
  await installUiAccount(app, { components: true, speech: true });
  const main = await connectUiAccount(app, await app.firstWindow());
  main.setDefaultTimeout(15000);
  const errors = [];
  main.on('pageerror', (error) => errors.push(error.message));
  await main.getByRole('button', { name: '用户菜单', exact: true }).click();
  await assertMenuBackdrop(app, main, 'sidebar');
  await main.getByRole('menuitem', { name: '设置', exact: true }).click();
  const settings = main.getByRole('dialog', { name: '设置', exact: true });
  await settings.getByRole('button', { name: '面试设置', exact: true }).click();
  const auto = settings.getByRole('switch', { name: '面试时自动录音', exact: true });
  assert.equal(await auto.getAttribute('aria-checked'), 'false');
  assert.equal(await settings.locator('.recording-preference').evaluate(el => getComputedStyle(el).borderBottomWidth), '0px');
  await auto.click();
  assert.equal(await auto.getAttribute('aria-checked'), 'true');
  await settings.getByRole('button', { name: '关闭设置', exact: true }).click();

  // Substitute only the audio source with an owned deterministic PCM sequence.
  await app.evaluate(({ app }) => {
    const req = process
      .getBuiltinModule('module')
      .createRequire(app.getAppPath() + '/package.json');
    const backend = app.getAppPath() + '/dist-electron/shared/electron/backend/';
    const { SpeechHost } = req(backend + 'speech/host.js');
    const { InterviewRecording } = req(backend + 'speech/recording.js');
    const original = SpeechHost.prototype.call;
    SpeechHost.prototype.call = async function (call) {
      if (call.op === 'stop' && globalThis.fixtureTailFailure) {
        globalThis.fixtureTailFailure = false;
        await original.call(this, call);
        throw Error('Synthetic final transcript unavailable');
      }
      if (call.op !== 'recording') return original.call(this, call);
      if (call.directory) {
        globalThis.fixtureAudioOrigin ??= Date.now();
        this.testDuration = globalThis.fixtureClipCount ? 4000 : 24000;
        this.testClip = new InterviewRecording(call.directory,
          globalThis.fixtureAudioOrigin + (globalThis.fixtureClipCount ? 34000 : 0));
        globalThis.fixtureClipCount = (globalThis.fixtureClipCount ?? 0) + 1;
        this.testClip.append('system', new Float32Array(64000).fill(0.01), 16000, this.testClip.startedAt);
      } else {
        await this.testClip.close(this.testClip.startedAt + this.testDuration);
        this.testClip = undefined;
      }
      this.emit({ type: 'recording', active: !!this.testClip });
      return { state: 'running', model: 'fixture', recording: !!this.testClip };
    };
  });
  await main.locator('.interview-start-trigger').click();
  const [floating] = await Promise.all([
    app.waitForEvent('window'),
    main.getByRole('button', { name: '确认开始', exact: true }).click(),
  ]);
  floating.setDefaultTimeout(15000);
  const wave = floating.locator('.floating-record .recording-wave path');
  const sampleWave = () => wave.evaluate(async path => {
    const frames = [];
    for (let i = 0; i < 12; i++) {
      await new Promise(requestAnimationFrame);
      frames.push({ x: path.getPointAtLength(0).x, shape: path.getAttribute('d') });
    }
    return frames;
  });
  if (process.platform === 'win32') {
    const protectedButton = floating.getByRole('button', { name: '关闭截图保护', exact: true, pressed: true });
    const visibleButton = floating.getByRole('button', { name: '开启截图保护', exact: true, pressed: false });
    const original = await protectedButton.locator('svg path').getAttribute('d');
    await protectedButton.click();
    assert.notEqual(await visibleButton.locator('svg path').getAttribute('d'), original);
    await visibleButton.click();
    assert.equal(await protectedButton.locator('svg path').getAttribute('d'), original);
  }
  await floating.emulateMedia({ reducedMotion: 'no-preference' });
  const moving = await sampleWave();
  assert.ok(moving.some((frame, i) => i && frame.x < moving[i - 1].x), 'Wave travels left between samples');
  assert.equal(await wave.evaluate(path => {
    const svg = path.ownerSVGElement;
    svg.style.setProperty('--accent', 'rgb(83, 164, 221)');
    const stroke = getComputedStyle(path).stroke;
    svg.style.removeProperty('--accent');
    return stroke;
  }), 'rgb(83, 164, 221)');
  await floating.waitForFunction(() => document.querySelector('.floating-record path').getBBox().height < 3);
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('#interview'));
    win.webContents.send('speech:event', { type: 'activity', source: 'system', level: .3, speaking: true });
  });
  await floating.waitForFunction(() => document.querySelector('.floating-record path').getBBox().height > 10);
  await floating.emulateMedia({ reducedMotion: 'reduce' });
  const still = await sampleWave();
  assert.equal(new Set(still.map(frame => frame.shape)).size, 1);
  await floating.getByRole('button', { name: '停止录音', exact: true }).click();
  await floating.emulateMedia({ reducedMotion: 'no-preference' });
  const idle = await sampleWave();
  assert.equal(new Set(idle.map(frame => frame.x)).size, 1, 'Idle bars stay in place');
  assert.equal(new Set(idle.map(frame => frame.shape)).size, 1, 'Idle bars keep their shape');
  await floating.getByRole('button', { name: '开始录音', exact: true }).click();
  await floating.waitForFunction(() => document.querySelector('.floating-record path').getBBox().height < 3);
  const returning = await wave.evaluate(async (path, idleShape) => {
    const button = path.closest('button');
    const current = () => button.querySelector('path').getAttribute('d');
    const shapes = [current()];
    const deadline = performance.now() + 5000;
    button.click();
    while (button.getAttribute('aria-pressed') === 'true' || current() !== idleShape) {
      if (performance.now() > deadline) throw Error('Stopped waveform did not settle');
      await new Promise(requestAnimationFrame);
      if (button.getAttribute('aria-pressed') === 'false') shapes.push(current());
    }
    return { samePath: button.querySelector('path') === path, shapes };
  }, still[0].shape);
  assert.ok(returning.samePath, 'Stopping keeps the live path on screen');
  const lengths = shape => [...shape.matchAll(/v([\d.]+)/g)].map(match => Number(match[1]));
  const startBars = lengths(returning.shapes[0]);
  const endBars = lengths(still[0].shape);
  const frames = returning.shapes.slice(1).map(lengths);
  for (const [i, end] of endBars.entries()) {
    if (Math.abs(startBars[i] - end) < 1) continue;
    assert.ok(frames.some(bars => bars[i] > Math.min(startBars[i], end) && bars[i] < Math.max(startBars[i], end)),
      `Bar ${i} reaches its idle length through intermediate frames`);
  }
  await floating.getByRole('button', { name: '结束面试', exact: true }).click();
  await app.evaluate(() => { globalThis.fixtureTailFailure = true; });
  await Promise.all([
    floating.waitForEvent('close'),
    floating.getByRole('button', { name: '确认结束面试', exact: true }).click(),
  ]);
  const id = await evaluateHistory(main, async () => {
    const records = await fixtureHistory.read();
    const record = records[0];
    const clips = await window.desktop.recordings({ op: 'list', recordId: record.id });
    if (clips.length !== 2) throw Error('Expected two real local WAV files');
    record.titleStatus = 'ready';
    record.title = 'Synthetic recording';
    record.transcripts = Array.from({ length: 60 }, (_, i) => ({
      id: 't' + i,
      time: '',
      text: 'Synthetic ' + i,
      final: true,
      source: i % 2 ? 'system' : 'microphone',
      startMs: clips[0].startedAt + Math.max(0, i - 1) * 4000,
      endMs: clips[0].startedAt + Math.max(1, i) * 4000,
    }));
    record.answers = [{
      id: 'a3', question: record.transcripts[3].text, content: 'Synthetic answer',
      sourceTranscriptIds: ['t3'], createdAt: clips[0].startedAt + 9000,
    }];
    await fixtureHistory.replace(records);
    return record.id;
  });
  await main.getByRole('button', { name: '面试记录', exact: true }).click();
  await main.locator('.history-row-open').first().click();
  const player = main.locator('.record-player');
  await player.waitFor();
  const badge = main.locator('.record-session-heading .neutral-badge');
  const badgeSpacing = () => badge.evaluate(el => {
    const style = getComputedStyle(el);
    return [style.marginTop, style.marginRight, style.marginBottom, style.marginLeft,
      style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft];
  });
  assert.equal((await badge.textContent()).trim(), '转写可能不完整');
  const incompleteSpacing = await badgeSpacing();
  await captureRequested(main.locator('.record-session-heading'), 'interview-tail-status');
  const checkMaterial = async (frosted) => {
    const material = await player.evaluate(el => {
      const header = getComputedStyle(document.querySelector('.record-detail-toolbar'), '::before');
      const player = getComputedStyle(el);
      return {
        player: [player.backgroundColor, player.backdropFilter],
        header: [header.backgroundColor, header.backdropFilter],
      };
    });
    assert.deepEqual(material.player, material.header);
    assert.equal(material.player[1].includes('blur('), frosted);
  };
  await checkMaterial(true);
  await player.hover();
  const expandButton = player.getByRole('button', { name: '展开播放器' });
  const clipIcon = player.getByRole('button', { name: '选择录音' }).locator('svg path');
  await expandButton.waitFor();
  assert.equal(await clipIcon.getAttribute('d'), still[0].shape);
  await main.waitForFunction(() => document.querySelector('.record-player').offsetWidth === 118);
  const metrics = await player.evaluate(el => {
    const play = el.querySelector('.record-player-transport > button:not(.record-extra)');
    const [expand, more] = el.querySelectorAll('.record-player-options button');
    const gap = (a, b) => b.getBoundingClientRect().left - a.getBoundingClientRect().right;
    return [gap(play, expand), gap(expand, more), getComputedStyle(more).backgroundColor, getComputedStyle(el).cornerShape];
  });
  assert.ok(metrics.slice(0, 2).every(gap => Math.abs(gap - 6) < 0.01));
  await checkMaterial(true);
  assert.equal(metrics[2], 'rgba(0, 0, 0, 0)');
  assert.match(metrics[3], /^(round|superellipse\(1\))$/);
  await expandButton.click();
  await main.waitForFunction(() => {
    const el = document.querySelector('.record-player');
    return el.offsetHeight === 90 && el.getAnimations().length === 0;
  });
  assert.equal(await player.evaluate(el => getComputedStyle(el).borderTopLeftRadius),
    await player.evaluate(el => getComputedStyle(el).getPropertyValue('--radius-composer').trim()));
  assert.equal(await player.locator('.frosted-slider-control input').count(), 1);
  assert.equal(await clipIcon.getAttribute('d'), still[0].shape);
  await checkMaterial(true);
  await main.evaluate(() => document.documentElement.classList.toggle('dark'));
  await checkMaterial(true);
  await main.evaluate(() => document.documentElement.classList.toggle('dark'));
  await main.emulateMedia({ contrast: 'more' });
  await checkMaterial(false);
  await main.emulateMedia({ contrast: 'no-preference' });
  await player.getByRole('button', { name: '播放录音' }).click();
  await main.waitForFunction(
    () =>
      document.querySelector('audio').currentTime > 0.1 &&
      document.querySelectorAll('.record-transcript-row.is-playing').length === 2,
  ).catch(async (cause) => {
    const media = await player.locator('audio').evaluate(audio => ({
      error: audio.error?.message,
      ready: audio.readyState,
      paused: audio.paused,
      time: audio.currentTime,
      duration: audio.duration,
    }));
    throw Error('Recording did not start or synchronize: ' + JSON.stringify(media), { cause });
  });
  const locate = player.getByRole('button', { name: '定位到当前位置' });
  const rows = main.locator('.record-transcript-row');
  const tints = await main.evaluate(() => {
    const probe = document.createElement('span');
    document.body.append(probe);
    const resolve = (value) => {
      probe.style.backgroundColor = value;
      return getComputedStyle(probe).backgroundColor;
    };
    const colors = {
      playing: resolve('color-mix(in srgb, var(--accent) 12%, transparent)'),
      hover: resolve('color-mix(in srgb, var(--accent) 20%, transparent)'),
      located: resolve('var(--location-highlight)'),
    };
    probe.remove();
    return colors;
  });
  const gap = rows.nth(8);
  assert.equal(await gap.getAttribute('data-playable'), null);
  await gap.hover();
  assert.equal(await gap.evaluate(el => getComputedStyle(el).backgroundColor), 'rgba(0, 0, 0, 0)');
  const column = main.locator('.record-transcript-scroll');
  const beforeWheel = await column.evaluate(el => el.scrollTop);
  await column.hover({ position: { x: 80, y: 120 } });
  await main.mouse.wheel(0, 640);
  await main.waitForFunction(top => document.querySelector('.record-transcript-scroll').scrollTop > top + 150, beforeWheel);
  assert.equal(await locate.isEnabled(), true);
  // Cross a caption boundary during free reading without pulling the reader back.
  await player.locator('audio').evaluate(audio => { audio.currentTime = 4.1; });
  await main.waitForFunction(() => document.querySelectorAll('.record-transcript-row')[2].classList.contains('is-playing'));
  assert.ok(await column.evaluate((el, top) => el.scrollTop > top + 150, beforeWheel));
  await locate.click();
  assert.equal(await locate.isDisabled(), true);
  await main.waitForFunction(() => {
    const column = document.querySelector('.record-transcript-scroll');
    const row = column.querySelector('.is-playing').getBoundingClientRect();
    const pane = column.getBoundingClientRect();
    return Math.abs(row.top + row.height / 2 - pane.top - pane.height / 2) < 3 || column.scrollTop === 0;
  });
  const scrollAway = () => column.dispatchEvent('wheel', { deltaY: 120 });
  for (const name of ['前进十秒', '后退十秒']) {
    await scrollAway();
    await player.getByRole('button', { name }).click();
    assert.equal(await locate.isDisabled(), true);
  }
  await scrollAway();
  await player.getByRole('slider', { name: '录音进度' }).press('ArrowRight');
  assert.equal(await locate.isDisabled(), true);
  await scrollAway();
  await rows.nth(3).locator('.record-transcript-text').click();
  assert.equal(await locate.isEnabled(), true);
  await main.waitForFunction(() => document.querySelector('audio').currentTime >= 8 && !document.querySelector('audio').paused);
  // Leaving the clicked row must restore the playback tint even while focus stays there.
  await main.waitForFunction(hover => {
    const row = document.querySelector('.record-transcript-row.is-playing:hover:focus-within');
    return row && getComputedStyle(row).backgroundColor === hover && getComputedStyle(row).borderRadius === '0px';
  }, tints.hover);
  await main.getByRole('button', { name: '返回面试记录', exact: true }).hover();
  await main.waitForFunction(playing => {
    const row = document.querySelector('.record-transcript-row.is-playing:focus-within:not(:hover)');
    return row && getComputedStyle(row).backgroundColor === playing &&
      getComputedStyle(row, '::after').content === 'none';
  }, tints.playing);
  await rows.nth(10).locator('.record-transcript-text').click();
  await main.waitForFunction(() => document.querySelector('audio').duration === 4 &&
    document.querySelector('audio').currentTime >= 2 && !document.querySelector('audio').paused);
  assert.equal(await locate.isDisabled(), true);
  await player.getByRole('button', { name: '暂停播放' }).click();
  await main.getByRole('button', { name: 'AI 回答面板' }).click();
  await main.waitForFunction(
    () =>
      document.querySelector('.record-player').getBoundingClientRect().right <=
      document.querySelector('.record-answer-panel').getBoundingClientRect().left + 1,
  );
  await scrollAway();
  await player.getByRole('button', { name: '选择录音' }).click();
  const clipMenu = main.getByRole('menu');
  const clipScroll = clipMenu.locator('.dropdown-scroll');
  assert.equal(await clipScroll.evaluate(el => el.scrollHeight - el.clientHeight), 0,
    'A short clip list should fit without scrolling');
  await main.getByRole('menuitemradio', { name: /录音1/ }).click();
  assert.equal(await locate.isDisabled(), true);
  await main.waitForFunction(() => document.querySelector('audio').duration === 24 && document.querySelector('audio').paused);
  await player.getByRole('slider', { name: '录音进度' }).press('End');
  await main.waitForFunction(() => {
    const audio = document.querySelector('.record-player audio');
    return !audio.seeking && audio.currentTime === 24;
  });
  await player.getByRole('button', { name: '播放录音' }).waitFor();
  assert.ok(await player.locator('audio').evaluate(audio => audio.paused && audio.duration === 24),
    'Seeking to the end while paused must keep the current clip paused');
  await rows.nth(3).getByRole('button', { name: '查看回答：Synthetic 3' }).hover();
  await main.waitForFunction(() => {
    const link = document.querySelector('.record-transcript-row .record-answer-link:hover');
    return link && getComputedStyle(link.closest('.record-transcript-row')).backgroundColor === 'rgba(0, 0, 0, 0)';
  });
  await main.getByRole('button', { name: '定位到原问题' }).click();
  await rows.nth(3).locator('.record-paragraph-time').click();
  await main.waitForFunction(located => {
    const row = document.querySelector('.record-transcript-row[data-location-highlight].is-playing:hover');
    if (!row) return false;
    const overlay = getComputedStyle(row, '::before');
    return overlay.backgroundColor === located && Number(overlay.opacity) >= 0.99;
  }, tints.located);
  await main.locator('.record-transcript-row[data-location-highlight]').waitFor({ state: 'detached' });
  await rows.nth(3).locator('.record-paragraph-time').hover();
  await main.waitForFunction(hover => {
    const row = document.querySelectorAll('.record-transcript-row')[3];
    return row?.matches('[data-playable]:hover:not([data-location-highlight])') &&
      getComputedStyle(row).backgroundColor === hover;
  }, tints.hover);
  await player.getByRole('button', { name: '暂停播放' }).click();
  await player.getByRole('button', { name: '收起播放器' }).click();
  assert.equal(await player.getAttribute('data-expanded'), 'false');

  const output = path.join(profile, 'selection.wav');
  await app.evaluate(({ dialog }, target) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: target });
  }, output);
  const exportButton = main.getByRole('button', { name: '导出录音', exact: true });
  await exportButton.click();
  const selection = main.getByRole('dialog', { name: '导出录音' });
  const all = selection.getByRole('checkbox', { name: '所有录音', exact: true });
  const toggle = selection.getByRole('button', { name: /^(展开|收起)录音列表$/ });
  const list = selection.locator('.record-export-list');
  const submit = selection.getByRole('button', { name: '导出录音', exact: true });
  assert.equal(await selection.getByRole('checkbox').count(), 3);
  assert.equal(await all.isChecked(), true);
  assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
  assert.equal(await toggle.getAttribute('aria-controls'), await list.getAttribute('id'));
  await toggle.hover();
  const hover = await toggle.evaluate(async button => {
    await new Promise(requestAnimationFrame);
    await Promise.all(button.getAnimations().map(animation => animation.finished));
    return { hovered: button.matches(':hover'), background: getComputedStyle(button).backgroundColor };
  });
  assert.deepEqual(hover, { hovered: true, background: 'rgba(0, 0, 0, 0)' });
  const layout = await selection.evaluate(dialog => {
    const parent = dialog.querySelector('.record-export-group-heading input').getBoundingClientRect();
    const children = [...dialog.querySelectorAll('.record-export-list input')].map(input => input.getBoundingClientRect());
    const heading = dialog.querySelector('.record-export-group-heading label').getBoundingClientRect();
    const arrow = dialog.querySelector('.record-export-toggle');
    return {
      indents: children.map(child => child.left - parent.left),
      checkboxWidth: parent.width,
      arrowGap: arrow.getBoundingClientRect().left - heading.right,
      independent: !arrow.closest('label'),
    };
  });
  assert.equal(layout.indents.length, 2);
  assert.ok(layout.indents.every(indent => indent >= layout.checkboxWidth + 4 && indent === layout.indents[0]));
  assert.ok(layout.independent && layout.arrowGap >= 0 && layout.arrowGap <= 12);

  const browserLabelClicks = process.argv.includes('--browser-label-clicks');
  if (!browserLabelClicks && process.platform === 'win32') {
    const win = await app.browserWindow(main);
    try { await win.evaluate(window => { window.setAlwaysOnTop(true); window.moveTop(); }); }
    finally { await win.dispose(); }
  }
  const clickText = async (label, checked) => {
    const text = selection.getByText(label, { exact: true });
    const expanded = await toggle.getAttribute('aria-expanded');
    await text.evaluate(span => {
      span.trustedLabelClick = false;
      span.addEventListener('click', event => { span.trustedLabelClick = event.isTrusted; }, { once: true });
    });
    if (browserLabelClicks) await text.click();
    else {
      const press = await holdControl(app, text);
      try { await press.check(); } finally { await press.release(); }
    }
    await selection.getByRole('checkbox', { name: label, exact: true, checked }).waitFor();
    assert.equal(await text.evaluate(span => span.trustedLabelClick), true);
    assert.equal(await toggle.getAttribute('aria-expanded'), expanded);
  };
  const initialSize = await selection.evaluate(dialog => ({
    dialog: dialog.getBoundingClientRect().height,
    list: dialog.querySelector('.record-export-list').getBoundingClientRect().height,
  }));
  assert.ok(initialSize.list > 0);
  const toggleList = async (expanded, reduced, keyboard = false) => {
    const previousSelections = await list.locator('input').evaluateAll(inputs => inputs.map(input => input.checked));
    await selection.evaluate(dialog => {
      const list = dialog.querySelector('.record-export-list');
      const arrow = dialog.querySelector('.record-export-toggle svg');
      const buttons = [...dialog.querySelectorAll('.modal-footer button')];
      const frames = [], animations = new Set();
      let frame;
      const sample = () => {
        const box = dialog.getBoundingClientRect();
        const buttonsInside = buttons.length === 2 && buttons.every(button => {
          const b = button.getBoundingClientRect();
          return b.width > 0 && b.height > 0 && b.left >= box.left - 0.5 && b.right <= box.right + 0.5 &&
            b.top >= box.top - 0.5 && b.bottom <= box.bottom + 0.5;
        });
        frames.push({
          height: box.height, listHeight: list.getBoundingClientRect().height, buttonsInside,
          opacity: Number(getComputedStyle(list).opacity), angle: getComputedStyle(arrow).transform,
        });
        for (const anim of [...list.getAnimations(), ...arrow.getAnimations()]) animations.add(anim);
      };
      const record = () => { sample(); frame = requestAnimationFrame(record); };
      record();
      dialog.finishListMotion = async () => {
        sample();
        await Promise.all([...animations].map(anim => anim.finished.catch(() => {})));
        await new Promise(requestAnimationFrame);
        cancelAnimationFrame(frame);
        sample();
        return { frames, animations: animations.size };
      };
    });
    if (keyboard) await toggle.press('Enter');
    else await toggle.click();
    await selection.getByRole('button', {
      name: expanded ? '收起录音列表' : '展开录音列表', expanded, exact: true,
    }).waitFor();
    const result = await selection.evaluate(dialog => dialog.finishListMotion());
    const first = result.frames[0], last = result.frames.at(-1);
    const closedHeight = initialSize.dialog - initialSize.list;
    const near = (a, b) => Math.abs(a - b) <= 1;
    const intermediate = (value, a, b) => value > Math.min(a, b) + 1 && value < Math.max(a, b) - 1;
    assert.ok(near(last.height, expanded ? initialSize.dialog : closedHeight),
      'Dialog height must follow the visible list: ' + JSON.stringify({ expanded, initialSize, first, last }));
    assert.ok(near(last.listHeight, expanded ? initialSize.list : 0));
    assert.ok(result.frames.every(frame => frame.buttonsInside), 'Both footer buttons stay inside the resizing dialog');
    assert.equal(last.opacity, expanded ? 1 : 0);
    if (reduced) {
      assert.equal(result.animations, 0);
      assert.ok(result.frames.every(frame => near(frame.height, first.height) || near(frame.height, last.height)),
        'Reduced motion changes the dialog height immediately');
    } else {
      assert.ok(result.frames.some(frame => intermediate(frame.height, first.height, last.height) &&
        intermediate(frame.listHeight, first.listHeight, last.listHeight)),
        'The dialog and list must pass through intermediate heights together: ' +
          JSON.stringify(result.frames.map(({ height, listHeight }) => [height, listHeight])));
      assert.ok(result.frames.some(frame => frame.opacity > 0 && frame.opacity < 1));
      assert.ok(new Set(result.frames.map(frame => frame.angle)).size > 2, 'Arrow turns through intermediate angles');
    }
    assert.equal(await list.evaluate(el => el.inert), !expanded);
    assert.equal(await selection.getByRole('checkbox').count(), expanded ? 3 : 1);
    assert.deepEqual(await list.locator('input').evaluateAll(inputs => inputs.map(input => input.checked)), previousSelections);
  };
  await main.emulateMedia({ reducedMotion: 'no-preference' });
  await clickText('所有录音', false);
  assert.equal(await submit.isDisabled(), true);
  await clickText(/录音1（/, true);
  assert.equal(await all.evaluate(el => el.indeterminate), true);
  await toggleList(false, false);
  assert.equal(await all.evaluate(el => el.indeterminate), true);
  await toggle.press('Tab');
  const cancelExport = selection.getByRole('button', { name: '取消', exact: true });
  assert.equal(await cancelExport.evaluate(el => el === document.activeElement), true);
  await cancelExport.press('Shift+Tab');
  const keyboardFocus = await toggle.evaluate(button => {
    const style = getComputedStyle(button);
    const outline = parseFloat(style.outlineWidth) > 0 && style.outlineStyle !== 'none' &&
      style.outlineColor !== 'rgba(0, 0, 0, 0)';
    return button.matches(':focus-visible') && (outline || style.boxShadow !== 'none');
  });
  assert.ok(keyboardFocus, 'The focused recording-list arrow shows a keyboard focus indicator');
  await toggleList(true, false, true);
  await main.emulateMedia({ reducedMotion: 'reduce' });
  await toggleList(false, true);
  await clickText('所有录音', true);
  await toggleList(true, true, true);
  assert.equal(await list.getByRole('checkbox', { checked: true }).count(), 2);
  await clickText(/录音1（/, false);
  await toggleList(false, true);
  assert.equal(await selection.getByRole('button', { name: '取消' }).locator('svg').count(), 1);
  await selection.getByRole('button', { name: '导出录音' }).click();
  await selection.waitFor({ state: 'hidden' });
  assert.equal((await readFile(output)).readUInt32LE(40), 128000);
  await app.evaluate(({ dialog }, target) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [target] });
  }, profile);
  await exportButton.click();
  assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
  assert.equal(await all.isChecked(), true);
  await selection.getByRole('button', { name: '导出录音' }).click();
  await selection.waitFor({ state: 'hidden' });
  const directory = (await readdir(profile)).find(
    (name) => name === 'VoxCue - Synthetic recording',
  );
  assert.equal((await readdir(path.join(profile, directory))).length, 2);
  await player.getByRole('button', { name: '播放录音' }).click();
  await main.evaluate(
    () => (window.detachedRecording = document.querySelector('.record-player audio')),
  );
  await main.getByRole('button', { name: '返回面试记录', exact: true }).click();
  await main.waitForFunction(
    () => window.detachedRecording.paused && !window.detachedRecording.hasAttribute('src'),
  );
  // Keep the single-clip export case and add enough segments to the first record to overflow its menu.
  const single = await app.evaluate(async ({ app }, firstId) => {
    const req = process
      .getBuiltinModule('module')
      .createRequire(app.getAppPath() + '/package.json');
    const backend = app.getAppPath() + '/dist-electron/shared/electron/backend/';
    const { RecordingLibrary } = req(backend + 'interview/recordings.js');
    const { InterviewRecording } = req(backend + 'speech/recording.js');
    const { CloudAccountClient } = req(backend + 'cloud/client.js');
    const id = req('node:crypto').randomUUID();
    const owner = 'account:' + CloudAccountClient.prototype.snapshot().user.id;
    const library = new RecordingLibrary(
      req('node:path').join(app.getPath('userData'), 'interview-recordings-v1'),
    );
    const writer = new InterviewRecording(library.prepare(owner, id, false));
    writer.append('system', new Float32Array(8000).fill(0.02), 16000, writer.startedAt);
    await writer.close(writer.startedAt + 500);
    const directory = library.prepare(owner, firstId, true);
    for (let i = 0; i < 40; i++) {
      const clip = new InterviewRecording(directory, writer.startedAt + 60000 + i * 1000);
      await clip.close(clip.startedAt + 500);
      if (i === 38) await req('node:fs/promises').truncate(clip.file, 45);
    }
    return id;
  }, id);
  await main.getByRole('button', { name: '查看面试记录：Synthetic recording', exact: true }).click();
  await player.hover();
  await exportButton.click();
  assert.ok(await selection.getByRole('checkbox', { name: '所有可用录音（41 段）' }).isChecked());
  const damaged = selection.getByRole('checkbox', { name: /录音 41\s+无法读取/ });
  assert.ok(await damaged.isDisabled());
  assert.ok(!(await damaged.isChecked()));
  assert.ok(await selection.getByRole('checkbox', { name: /^录音42[（(]/ }).isChecked());
  if (process.argv.some(arg => arg.startsWith('--screenshots='))) {
    await damaged.scrollIntoViewIfNeeded();
    await captureRequested(selection, 'recording-export-selection');
  }
  await selection.getByRole('button', { name: '取消' }).click();
  await player.hover();
  const chooseClip = player.getByRole('button', { name: '选择录音' });
  await chooseClip.click();
  const lastClip = clipMenu.getByRole('menuitemradio').last();
  assert.equal(await clipMenu.getByRole('menuitemradio').count(), 41);
  await assertMenuBackdrop(app, main, 'sidebar');
  const size = await clipMenu.evaluate(el => {
    const scroll = el.querySelector('.dropdown-scroll');
    return {
      available: parseFloat(getComputedStyle(el).getPropertyValue('--radix-dropdown-menu-content-available-height')),
      height: el.getBoundingClientRect().height,
      overflow: scroll.scrollHeight - scroll.clientHeight,
    };
  });
  assert.ok(Math.abs(size.height - size.available / 3) <= 2 && size.overflow > 0, JSON.stringify(size));
  await lastClip.scrollIntoViewIfNeeded();
  assert.ok(await clipScroll.evaluate(el => el.scrollTop > 0));
  await lastClip.click();
  await player.hover();
  await chooseClip.click();
  assert.equal(await lastClip.getAttribute('aria-checked'), 'true');
  // Play 39, 40 and 42, skipping the truncated 41st WAV.
  await clipMenu.getByRole('menuitemradio', { name: /^录音39[（(]/ }).click();
  await player.evaluate(node => {
    node.playedSources = [];
    node.addEventListener('play', event => node.playedSources.push(event.target.currentSrc), true);
  });
  await player.getByRole('button', { name: '播放录音' }).click();
  await main.waitForFunction(() => {
    const node = document.querySelector('.record-player');
    const audio = node.querySelector('audio');
    return node.playedSources.length >= 3 && audio.ended && audio.paused &&
      !document.querySelector('.record-transcript-row.is-playing');
  });
  const playedSources = await player.evaluate(node => node.playedSources);
  assert.equal(playedSources.length, 3);
  assert.equal(new Set(playedSources).size, 3);
  await player.getByRole('button', { name: '播放录音' }).waitFor();
  await player.hover();
  await chooseClip.click();
  assert.equal(await lastClip.getAttribute('aria-checked'), 'true');
  await lastClip.press('Escape');
  await main.getByRole('button', { name: '返回面试记录', exact: true }).click();
  await evaluateHistory(main, async (single) => {
    const records = await fixtureHistory.read();
    records.unshift({ ...records[0], id: single, startedAt: Date.now(), title: 'Single clip',
      status: 'ended', transcriptTailIncomplete: undefined });
    await fixtureHistory.replace(records);
  }, single);
  await main.getByRole('button', { name: '查看面试记录：Single clip', exact: true }).click();
  assert.equal((await badge.textContent()).trim(), '已结束');
  assert.deepEqual(await badgeSpacing(), incompleteSpacing);
  await player.hover();
  await player.getByRole('button', { name: '展开播放器' }).waitFor();
  assert.equal(await player.getByRole('button', { name: '选择录音' }).count(), 0);
  await exportButton.click();
  await main.waitForFunction(
    () => !document.querySelector('.record-toolbar-actions button').disabled,
  );
  assert.equal(await selection.count(), 0);
  assert.equal((await readFile(output)).readUInt32LE(40), 16000);
  await evaluateHistory(main, () => fixtureHistory.failNextWrite());
  const remove = main.locator('.record-toolbar-actions .confirm-delete');
  await remove.click();
  await remove.click();
  const error = main.locator('.record-history-error');
  await error.waitFor();
  assert.equal(await main.locator('.record-detail-toolbar .confirm-delete-error').count(), 0);
  assert.ok(Math.abs(await error.evaluate(el => el.getBoundingClientRect().left -
    document.querySelector('.record-heading-title h1').getBoundingClientRect().left)) < 1);
  await captureRequested(main.locator('.record-transcript-pane'), 'history-delete-error');
  await player.locator('audio').evaluate(el => el.load());
  await main.waitForFunction(() => document.querySelector('.record-player audio').readyState >= 1);
  assert.equal(await main.evaluate(async id =>
    (await window.desktop.recordings({ op: 'list', recordId: id })).length, single), 1);
  await main.evaluate((id) => window.desktop.recordings({ op: 'remove', recordId: id }), id);
  assert.equal(
    await main.evaluate(
      async (id) => (await window.desktop.recordings({ op: 'list', recordId: id })).length,
      id,
    ),
    0,
  );
  assert.deepEqual(errors, []);
  console.log(
    'PASS recording preference, interview toggles, WAV playback, overlapping rows, follow, panel geometry, clip selection and export.',
  );
} finally {
  await closeUiApp(app);
}
