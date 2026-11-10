import { connectUiAccount, openModelMenu } from './install-ui-account.mjs';
import { testRoot, electron } from './test-workspace.mjs';
import { offlineElectronEntry } from './offline-electron-entry.mjs';
import { installUiAccount, closeUiApp } from './install-ui-account.mjs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import workspace from '../../scripts/workspace.mjs';
import { waitForAsync } from './wait-for-async.mjs';

const nativeProbe =
  process.platform === 'win32'
    ? (
        await import(
          pathToFileURL(path.join(workspace.platformRoot, 'test/scripts/window-probe.mjs')).href
        )
      ).probe
    : undefined;
const originalCursor = nativeProbe?.('cursor');

const screenshotOption = process.argv.slice(2).find((value) => value.startsWith('--screenshots='));
const memoryPreview = process.argv.includes('--memory-preview');
if (
  process.argv.slice(2).some((value) => value !== screenshotOption && value !== '--memory-preview')
)
  throw Error('Only --screenshots=<requested-output-directory> and --memory-preview are supported');
const screenshots = screenshotOption ? path.resolve(screenshotOption.slice(14)) : undefined;
if (screenshots) await mkdir(screenshots, { recursive: true });
const profile = path.join(testRoot, 'interview-ux');
await mkdir(profile);
const app = await electron.launch({
  args: [await offlineElectronEntry()],
  env: { ...process.env, COPILOT_TEST_USER_DATA: profile, VITE_DEV_SERVER_URL: '' },
});
const checks = [];
async function capture(page, name) {
  // Media emulation acknowledges before Chromium necessarily paints the new
  // palette. Flush its style/frame update before waiting for finite transitions.
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .every(
        (a) =>
          a.effect?.target?.closest?.('.interview-readiness-symbol') ||
          a.effect?.getTiming().iterations === Infinity ||
          a.playState !== 'running',
      ),
  );
  if (screenshots)
    await page.screenshot({
      path: path.join(screenshots, name + '.png'),
      type: 'png',
      scale: 'css',
    });
  if (memoryPreview && ['settings-layout-wide-light', 'settings-layout-narrow-dark'].includes(name))
    console.log(
      'VOXCUE_SETTINGS_PREVIEW:' +
        (
          await page
            .getByRole('dialog', { name: '面试设置', exact: true })
            .screenshot({ type: 'jpeg', quality: 60, scale: 'css' })
        ).toString('base64'),
    );
}
async function settingsLayout(dialog) {
  const result = await dialog.evaluate((element) => {
    const rect = (node) => node.getBoundingClientRect().toJSON();
    const rows = [...element.querySelectorAll('.speech-setting-row')]
      .filter((row) => row.querySelector(':scope > button, :scope > .frosted-slider'))
      .map((row) => {
        const label = row.querySelector('.speech-setting-label');
        const text = label.querySelector('label') ?? label;
        return {
          text: text.textContent,
          writingMode: getComputedStyle(text).writingMode,
          label: rect(label),
          control: rect(row.querySelector(':scope > button, :scope > .frosted-slider')),
          row: rect(row),
          overflow: row.scrollWidth > row.clientWidth,
        };
      });
    return {
      rows,
      sections: [...element.querySelectorAll('.interview-settings-section')].map(rect),
      overflow: element.scrollWidth > element.clientWidth + 1,
      audio: [...element.querySelectorAll('.audio-device-editor .choice-trigger')].map(rect),
      groups: [...element.querySelectorAll('.speech-model-group')].map((group) => ({
        width: group.clientWidth,
        scrollWidth: group.scrollWidth,
      })),
    };
  });
  assert.equal(result.overflow, false);
  assert.equal(
    result.rows.length,
    7,
    'Two audio, three model and two display rows share one layout',
  );
  assert.equal(result.rows.filter((row) => row.text === '回答模型').length, 1);
  assert.equal(result.rows.filter((row) => row.text === '思考强度').length, 0);
  for (const row of result.rows) {
    assert.equal(row.writingMode, 'horizontal-tb', `${row.text}: label must remain horizontal`);
    assert.equal(row.overflow, false, `${row.text}: row must not overflow`);
    assert.ok(
      row.control.left > row.label.right,
      `${row.text}: control belongs to the right of its label`,
    );
    assert.ok(Math.abs(row.label.left - result.rows[0].label.left) <= 1 / 64);
    assert.ok(Math.abs(row.control.left - result.rows[0].control.left) <= 1 / 64);
    assert.ok(Math.abs(row.row.right - row.control.right) <= 1 / 64);
    assert.ok(
      Math.abs(row.label.top + row.label.height / 2 - row.control.top - row.control.height / 2) <=
        1 / 64,
      `${row.text}: label and control centers must align`,
    );
    assert.ok(row.control.width >= 150);
    assert.ok(
      Math.abs(row.control.width - result.audio[0].width) <= 1 / 64,
      `${row.text}: control width matches audio dropdowns`,
    );
  }
  for (let i = 1; i < result.rows.length; i++)
    assert.ok(result.rows[i].row.top >= result.rows[i - 1].row.bottom);
  for (let i = 1; i < result.sections.length; i++)
    assert.ok(result.sections[i].top >= result.sections[i - 1].bottom);
  for (const group of result.groups) assert.ok(group.scrollWidth <= group.width + 1);
  return result;
}
async function readinessLayout(dialog, untilReady = false) {
  return dialog.evaluate(async (element, untilReady) => {
    const rect = (node) => {
      const { left, top, width, height } = node.getBoundingClientRect();
      return { left, top, width, height };
    };
    const snapshot = () => ({
      dialog: rect(element),
      summary: rect(element.querySelector('.interview-start-summary')),
      access: rect(element.querySelector('.interview-access')),
      list: rect(element.querySelector('.interview-access-list')),
      footer: rect(element.querySelector('.modal-footer')),
      rows: [...element.querySelectorAll('.interview-access-row')].map(rect),
      statuses: [...element.querySelectorAll('.interview-access-row')].map((row) =>
        rect(
          row.querySelector(
            '.interview-access-status-slot, .interview-access-status, .remote-connection-status',
          ),
        ),
      ),
      tests: [...element.querySelectorAll('.interview-access-row')]
        .map((row) => row.querySelector('.interview-access-test-slot, button'))
        .filter(Boolean)
        .map(rect),
      devices: [...element.querySelectorAll('.interview-start-summary-group > div')]
        .filter((row) =>
          ['系统音频 · 面试官', '麦克风 · 面试者'].includes(row.querySelector('dt').textContent),
        )
        .map((row) => rect(row.querySelector('dd'))),
    });
    if (!untilReady) return snapshot();
    const frames = [];
    let readyFrames = 0;
    for (let frame = 0; frame < 180; frame++) {
      frames.push(snapshot());
      readyFrames =
        element.querySelector('.interview-access').getAttribute('aria-busy') === 'true'
          ? 0
          : readyFrames + 1;
      if (readyFrames === 3) return frames;
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    throw Error('The held readiness check did not finish');
  }, untilReady);
}
function assertReadinessGeometry(before, after) {
  const same = (first, last, label) => {
    for (const key of ['left', 'top', 'width', 'height'])
      assert.ok(
        Math.abs(first[key] - last[key]) <= 1 / 64,
        `${label}.${key} changed during readiness: ${first[key]} → ${last[key]}`,
      );
  };
  for (const key of ['dialog', 'summary', 'access', 'list', 'footer'])
    same(before[key], after[key], key);
  for (const key of ['rows', 'devices', 'statuses', 'tests']) {
    assert.equal(after[key].length, before[key].length);
    after[key].forEach((rect, index) => same(before[key][index], rect, `${key}[${index}]`));
  }
}
async function assertSkeletonClip(page, target) {
  await target.scrollIntoViewIfNeeded();
  await page.waitForFunction(
    () =>
      !document.documentElement.dataset.viewDirection &&
      document
        .getAnimations()
        .every(
          (animation) =>
            animation.effect?.getTiming().iterations === Infinity ||
            animation.playState !== 'running',
        ),
  );
  const saved = await target.evaluate(async (line) => {
    await Promise.all(
      line
        .closest('dialog')
        .getAnimations({ subtree: true })
        .filter((animation) => animation.effect.getTiming().iterations !== Infinity)
        .map((animation) => animation.finished.catch(() => {})),
    );
    const animation = line
      .getAnimations({ subtree: true })
      .find((item) => item.animationName === 'quota-skeleton-sweep');
    if (!animation) throw Error('Expected the real skeleton sweep animation');
    const saved = {
      time: Number(animation.currentTime),
      running: animation.playState === 'running',
    };
    animation.pause();
    await animation.ready;
    const rect = line.getBoundingClientRect();
    const before = getComputedStyle(line, '::before');
    return {
      ...saved,
      duration: Number(animation.effect.getTiming().duration),
      devicePixelRatio,
      bounds: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
      clip: {
        x: Math.floor(rect.left),
        y: Math.floor(rect.top),
        width: Math.ceil(rect.right) - Math.floor(rect.left),
        height: Math.ceil(rect.bottom) - Math.floor(rect.top),
      },
      bar: {
        left: rect.left + parseFloat(before.left),
        top: rect.top + parseFloat(before.top),
        width: parseFloat(before.width),
        height: parseFloat(before.height),
      },
    };
  });
  const windowId = await (await app.browserWindow(page)).evaluate((window) => window.id);
  // Native capture keeps the actual display raster instead of changing its
  // viewport/emulation scale as CDP's clip.scale does.
  const nativeFrame = () =>
    app.evaluate(
      async ({ BrowserWindow }, { windowId, clip, dpi }) => {
        const image = await BrowserWindow.fromId(windowId).webContents.capturePage(clip);
        const size = image.getSize();
        const bitmapBytes = image.toBitmap().length;
        const expected = {
          width: Math.ceil(clip.width * dpi),
          height: Math.ceil(clip.height * dpi),
        };
        if (
          size.width !== expected.width ||
          size.height !== expected.height ||
          bitmapBytes !== size.width * size.height * 4
        )
          throw Error(
            'Native sweep bitmap does not match its integer DIP clip: ' +
              JSON.stringify({
                clip,
                dpi,
                size,
                expected,
                bitmapBytes,
                scaleFactors: image.getScaleFactors(),
              }),
          );
        return { data: image.toPNG().toString('base64'), size, bitmapBytes };
      },
      { windowId, clip: saved.clip, dpi: saved.devicePixelRatio },
    );
  try {
    const images = [];
    const nativeFrames = [];
    const maskImages = [];
    const maskId = 'skeleton-clip-mask-' + Date.now();
    try {
      const rect = await page.evaluate(
        ({ id, bar }) => {
          const style = document.createElement('style');
          style.id = id + '-style';
          style.textContent =
            '#' +
            CSS.escape(id) +
            '::backdrop{background:transparent!important;pointer-events:none!important}';
          document.head.append(style);
          const mask = document.createElement('div');
          mask.id = id;
          mask.popover = 'manual';
          mask.inert = true;
          mask.setAttribute('aria-hidden', 'true');
          mask.style.cssText =
            'position:fixed!important;inset:auto!important;margin:0!important;' +
            'border:0!important;padding:0!important;box-sizing:border-box!important;' +
            `left:${bar.left}px!important;top:${bar.top}px!important;` +
            `width:${bar.width}px!important;height:${bar.height}px!important;` +
            'border-radius:999px!important;corner-shape:round!important;' +
            'background:black!important;opacity:1!important;outline:0!important;' +
            'box-shadow:none!important;filter:none!important;backdrop-filter:none!important;' +
            'clip-path:none!important;overflow:visible!important;transform:none!important;' +
            'animation:none!important;transition:none!important;pointer-events:none!important;';
          document.body.append(mask);
          mask.showPopover();
          const box = mask.getBoundingClientRect();
          return { left: box.left, top: box.top, width: box.width, height: box.height };
        },
        { id: maskId, bar: saved.bar },
      );
      for (const key of ['left', 'top', 'width', 'height'])
        assert.ok(
          Math.abs(rect[key] - saved.bar[key]) <= 1 / 64,
          `Round mask must keep the skeleton's native pixel phase: ${JSON.stringify({ rect, bar: saved.bar })}`,
        );
      for (const color of ['black', 'white']) {
        await page.evaluate(
          async ({ id, color }) => {
            document.getElementById(id).style.setProperty('background', color, 'important');
            await new Promise((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(resolve)),
            );
          },
          { id: maskId, color },
        );
        maskImages.push((await nativeFrame()).data);
      }
    } finally {
      await page.evaluate((id) => {
        document.getElementById(id)?.remove();
        document.getElementById(id + '-style')?.remove();
      }, maskId);
    }
    for (const progress of [0, 0.35, 0.65]) {
      const geometry = await target.evaluate(async (line, time) => {
        line
          .getAnimations({ subtree: true })
          .find((item) => item.animationName === 'quota-skeleton-sweep').currentTime = time;
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const rect = line.getBoundingClientRect();
        return {
          bounds: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
          opacity: getComputedStyle(line.closest('dialog')).opacity,
        };
      }, saved.duration * progress);
      assert.equal(geometry.opacity, '1', 'Sweep pixels must be sampled after the modal fade');
      for (const key of ['left', 'top', 'width', 'height'])
        assert.ok(
          Math.abs(geometry.bounds[key] - saved.bounds[key]) <= 1 / 64,
          `Sweep sampling must keep one fixed clip: ${JSON.stringify({ saved: saved.bounds, geometry })}`,
        );
      const frame = await nativeFrame();
      images.push(frame.data);
      nativeFrames.push({ size: frame.size, bitmapBytes: frame.bitmapBytes });
    }
    const pixels = await app.evaluate(
      ({ nativeImage }, { images, maskImages, clip, bar }) => {
        const frames = images.map((image) =>
          nativeImage.createFromBuffer(Buffer.from(image, 'base64')),
        );
        const { width, height } = frames[0].getSize();
        const buffers = frames.map((frame) => frame.toBitmap());
        const masks = maskImages.map((image) =>
          nativeImage.createFromBuffer(Buffer.from(image, 'base64')),
        );
        if (
          [...frames, ...masks].some(
            (frame) =>
              frame.getSize().width !== width ||
              frame.getSize().height !== height ||
              frame.toBitmap().length !== width * height * 4,
          )
        )
          throw Error('Sweep frames must preserve one native pixel grid');
        const maskBuffers = masks.map((frame) => frame.toBitmap());
        const sx = width / clip.width,
          sy = height / clip.height;
        const radius = Math.min(bar.width, bar.height) / 2;
        const outside = [0, 0],
          inside = [0, 0];
        let outsideDelta = 0,
          outsideSample = null,
          maskInside = 0;
        for (let y = 0; y < height; y++)
          for (let x = 0; x < width; x++) {
            const left = clip.x + x / sx - bar.left,
              right = left + 1 / sx;
            const top = clip.y + y / sy - bar.top,
              bottom = top + 1 / sy;
            // A corner pixel may straddle the rectangular bar bounds at low
            // DPR. Keep it if it intersects that rectangle: an incorrectly
            // rectangular sweep would visibly paint its intersecting area.
            if (right <= 0 || left >= bar.width || bottom <= 0 || top >= bar.height) continue;
            const dy = bottom < radius ? radius - bottom : top > radius ? top - radius : 0;
            const side = right < radius ? 0 : left > bar.width - radius ? 1 : -1;
            const dx = side === 0 ? radius - right : left - (bar.width - radius);
            const pixelOffset = (y * width + x) * 4;
            let maskDelta = 0;
            for (let channel = 0; channel < 4; channel++)
              maskDelta = Math.max(
                maskDelta,
                Math.abs(
                  maskBuffers[0][pixelOffset + channel] - maskBuffers[1][pixelOffset + channel],
                ),
              );
            // Keep the original half-CSS-pixel separation as well as the
            // independent mask: border-radius and clip-path can rasterize
            // their near-edge coverage differently at fractional DPR.
            const fullyOutside = side >= 0 && Math.hypot(dx, dy) > radius + 0.5 && maskDelta === 0;
            const cx = (left + right) / 2,
              cy = (top + bottom) / 2;
            const center = Math.max(radius, Math.min(bar.width - radius, cx));
            const fullyInside =
              left >= 0 &&
              right <= bar.width &&
              top >= 0 &&
              bottom <= bar.height &&
              Math.hypot(cx - center, cy - radius) < radius - 0.5;
            if (fullyInside && maskDelta >= 240) maskInside++;
            if (fullyOutside) outside[side]++;
            for (let index = 1; index < buffers.length; index++) {
              let delta = 0;
              for (let channel = 0; channel < 4; channel++) {
                const offset = (y * width + x) * 4 + channel;
                delta = Math.max(delta, Math.abs(buffers[index][offset] - buffers[0][offset]));
              }
              if (fullyOutside && delta > outsideDelta) {
                outsideDelta = delta;
                const offset = (y * width + x) * 4;
                outsideSample = {
                  outputPoint: [x, y],
                  cssPoint: [clip.x + x / sx, clip.y + y / sy],
                  cornerDistance: Math.hypot(dx, dy),
                  radius,
                  roundMask: maskBuffers.map((buffer) => [...buffer.subarray(offset, offset + 4)]),
                  bgra: buffers.map((buffer) => [...buffer.subarray(offset, offset + 4)]),
                };
              }
              if (fullyInside && delta > 1) inside[index - 1]++;
            }
          }
        return {
          outside,
          outsideDelta,
          outsideSample,
          inside,
          maskInside,
          size: { width, height },
        };
      },
      { images, maskImages, clip: saved.clip, bar: saved.bar },
    );
    assert.ok(
      pixels.maskInside > 0,
      `The independent round mask must really paint opaque black/white interior pixels: ${JSON.stringify(pixels)}`,
    );
    assert.ok(
      pixels.outside.every((count) => count > 0),
      JSON.stringify(pixels),
    );
    assert.ok(
      pixels.outsideDelta <= 2,
      `Sweep escaped its capsule corners: ${JSON.stringify({
        ...pixels,
        devicePixelRatio: saved.devicePixelRatio,
        nativeFrames,
        clip: saved.clip,
        bar: saved.bar,
      })}`,
    );
    assert.ok(
      pixels.inside.every((count) => count > 0),
      `The sampled sweep must actually be visible: ${JSON.stringify(pixels)}`,
    );
  } finally {
    await target.evaluate((line, saved) => {
      const animation = line
        .getAnimations({ subtree: true })
        .find((item) => item.animationName === 'quota-skeleton-sweep');
      animation.currentTime = saved.time;
      if (saved.running) animation.play();
    }, saved);
  }
}
async function geometry(page) {
  const result = await page.evaluate(() => {
    const visible = (e) =>
      e.getBoundingClientRect().width > 0 && e.getBoundingClientRect().height > 0;
    return {
      overflow: [
        ...document.querySelectorAll(
          '.audio-check,.audio-input-meters,.audio-recovery,.interview-settings-dialog,.audio-device-editor',
        ),
      ]
        .filter(visible)
        .filter((e) => e.scrollWidth > e.clientWidth + 1)
        .map((e) => e.className),
      dialogs: [...document.querySelectorAll('dialog[open]')].map((e) => {
        const r = e.getBoundingClientRect();
        return (
          r.left >= -1 && r.right <= innerWidth + 1 && r.top >= -1 && r.bottom <= innerHeight + 1
        );
      }),
      echoCopy: document.body.innerText.includes('回声消除'),
    };
  });
  assert.deepEqual(result.overflow, []);
  assert.ok(result.dialogs.every(Boolean));
  assert.equal(result.echoCopy, false);
}
try {
  await installUiAccount(app, { speech: true, components: true });
  await app.evaluate(({ app }) => {
    const require = process
      .getBuiltinModule('module')
      .createRequire(app.getAppPath() + '/package.json');
    const { ComponentService } = require(
      app.getAppPath() + '/dist-electron/shared/electron/backend/components/service.js',
    );
    const { SpeechHost } = require(
      app.getAppPath() + '/dist-electron/shared/electron/backend/speech/host.js',
    );
    const { ChatGPTService } = require(
      app.getAppPath() + '/dist-electron/shared/electron/backend/chat/service.js',
    );
    const platform = process.platform === 'darwin' ? 'macos' : 'windows';
    const { InterviewAccess } = require(
      app.getAppPath() + '/dist-electron/' + platform + '/electron/speech/access.js',
    );
    const { ScreenPermission } = require(
      app.getAppPath() + '/dist-electron/' + platform + '/electron/screenPermission.js',
    );
    const screenPermission = ScreenPermission.prototype.call;
    ScreenPermission.prototype.call = function (action) {
      return action === 'check'
        ? Promise.resolve({
            status: platform === 'windows' ? 'not-required' : 'granted',
            message: 'Synthetic',
          })
        : screenPermission.call(this, action);
    };
    globalThis.uxAccessChecks = 0;
    InterviewAccess.prototype.check = async (options) => {
      globalThis.uxAccessChecks++;
      if (globalThis.uxHoldAccess)
        await new Promise((resolve) => {
          globalThis.uxReleaseAccess = () => {
            globalThis.uxHoldAccess = false;
            globalThis.uxReleaseAccess = undefined;
            resolve();
          };
        });
      return {
        ready: true,
        checks: options.sources.map((source) => ({
          source,
          status: 'granted',
          message: 'Synthetic',
        })),
        devices: [
          { id: 'output', source: 'system', name: '合成播放设备', default: true },
          { id: 'input', source: 'microphone', name: '合成麦克风', default: true },
        ],
      };
    };
    globalThis.uxNeedSpeech = true;
    globalThis.uxComponentRevision = 0;
    globalThis.uxDownloads = [];
    globalThis.uxCalls = [];
    globalThis.uxAnswers = 0;
    globalThis.uxDevices = [
      { id: 'output', source: 'system', name: '合成播放设备', default: true },
      { id: 'input', source: 'microphone', name: '合成麦克风', default: true },
    ];
    globalThis.uxRequests = [];
    globalThis.uxHold = false;
    globalThis.uxHoldSpeech = false;
    globalThis.uxFailSpeech = false;
    const state = ComponentService.prototype.state;
    ComponentService.prototype.state = function () {
      const result = state.call(this);
      return {
        ...result,
        revision: result.revision + globalThis.uxComponentRevision,
        phase: globalThis.uxNeedSpeech ? 'needed' : 'ready',
        items: result.items.map((item) => ({
          ...item,
          phase:
            globalThis.uxNeedSpeech && ['speech', 'qwen'].includes(item.id) ? 'pending' : 'ready',
        })),
      };
    };
    ComponentService.prototype.ready = (id) =>
      !(['speech', 'qwen'].includes(id) && globalThis.uxNeedSpeech);
    ComponentService.prototype.download = async function (id) {
      globalThis.uxDownloads.push(id);
      globalThis.uxNeedSpeech = false;
      globalThis.uxComponentRevision++;
      return this.state();
    };
    SpeechHost.prototype.call = async function (call) {
      globalThis.uxCalls.push(call);
      globalThis.uxHost = this;
      const devices = globalThis.uxDevices;
      if (call.op === 'devices') return { state: 'idle', model: 'Synthetic', devices };
      if (call.op === 'start') this.uxInput = structuredClone(call.inputState);
      if (call.op === 'set-input-state') {
        this.uxInput = structuredClone(call.state);
        return { ...this.uxStatus, inputState: this.uxInput };
      }
      if (call.op === 'cancel-input-state') return { ...this.uxStatus, inputState: this.uxInput };
      if (call.op === 'switch-recognizer') {
        const previous = this.uxStatus;
        this.emit({ type: 'status', status: { ...previous, switching: 'loading' } });
        globalThis.uxSpeechWait = () =>
          this.emit({ type: 'status', status: { ...previous, switching: 'waiting' } });
        if (globalThis.uxHoldSpeech)
          await new Promise((resolve) => {
            globalThis.uxSpeechFinish = resolve;
          });
        if (globalThis.uxFailSpeech) {
          this.emit({ type: 'status', status: previous });
          throw Error('合成候选加载失败，仍使用原配置。');
        }
        const status = {
          state: 'running',
          model: 'Synthetic',
          speechModel: call.options.speechModel,
          inferenceDevice: call.options.inferenceDevice,
        };
        this.uxStatus = status;
        this.emit({ type: 'status', status });
        return status;
      }
      clearInterval(globalThis.uxLevels);
      clearInterval(globalThis.uxProgress);
      const status = {
        state: call.op === 'start' ? 'running' : call.op === 'pause' ? 'paused' : 'idle',
        model: 'Synthetic',
      };
      this.uxStatus = status;
      if (call.op === 'start')
        globalThis.uxLevels = setInterval(() => {
          for (const source of call.options.sources)
            this.emit({
              type: 'activity',
              source,
              speaking: true,
              level: source === 'system' ? 0.08 : 0.04,
            });
        }, 100);
      if (call.op === 'start')
        globalThis.uxProgress = setInterval(
          () =>
            this.emit({
              type: 'audio-progress',
              source: 'system',
              pending: false,
              processedThroughMs: Date.now(),
            }),
          100,
        );
      this.emit({ type: 'status', status });
      return status;
    };
    SpeechHost.prototype.stop = function () {
      clearInterval(globalThis.uxLevels);
      clearInterval(globalThis.uxProgress);
    };
    ChatGPTService.prototype.models = async () => [
      { id: 'test-model', label: 'Test Model', description: '', reasoningEfforts: ['low', 'high'] },
      { id: 'next-model', label: '验证模型', description: '', reasoningEfforts: ['high'] },
    ];
    ChatGPTService.prototype.stream = async function (request, emit, signal) {
      const answering = !request.id.startsWith('history-title-');
      if (answering) {
        globalThis.uxAnswers++;
        globalThis.uxRequests.push({ modelId: request.modelId, effort: request.effort });
      }
      const held = answering && globalThis.uxHold;
      if (held) {
        globalThis.uxHold = false;
        globalThis.uxCurrentSignal = signal;
      }
      const text = request.id.startsWith('history-title-')
        ? '项目介绍与追问'
        : held
          ? '当前回答继续使用原模型。'
          : '我会先确认问题和边界，再结合已知事实说明实现方法。';
      emit({ id: request.id, type: 'delta', text });
      if (held)
        await new Promise((resolve) => {
          globalThis.uxFinish = resolve;
        });
      return {
        answerText: text,
        usage: null,
        sources: [],
        provider: { id: 'chatgpt', name: 'ChatGPT', dataRecipient: 'OpenAI' },
      };
    };
  });
  const login = await app.firstWindow();
  const page = await connectUiAccount(app, login);
  page.setDefaultTimeout(15000);
  await page.locator('.welcome h1').waitFor();
  await page.getByLabel('本地组件提示', { exact: true }).waitFor();
  assert.ok(await page.locator('.interview-start-trigger').isDisabled());
  await geometry(page);
  await capture(page, '01-readiness');
  await page
    .getByLabel('本地组件提示', { exact: true })
    .getByRole('button', { name: '前往设置', exact: true })
    .click();
  await page
    .locator('.component-row[data-component-id="speech"]')
    .getByRole('button', { name: '下载', exact: true })
    .click();
  await page.getByRole('button', { name: '关闭设置', exact: true }).click();
  await page.getByLabel('本地组件提示', { exact: true }).waitFor({ state: 'hidden' });
  assert.deepEqual(await app.evaluate(() => globalThis.uxDownloads), ['speech']);
  assert.equal(await page.getByText('ChatGPT 可用', { exact: true }).count(), 0);
  assert.equal(await page.getByText('面试练习助手', { exact: true }).count(), 0);
  const brand = await page.locator('.sidebar-wordmark').evaluate((e) => ({
    font: getComputedStyle(e.querySelector('strong')).fontSize,
    title: getComputedStyle(document.querySelector('.page-toolbar .breadcrumb > strong')).fontSize,
    logo: parseFloat(getComputedStyle(e.querySelector('.app-logo')).width),
  }));
  assert.equal(brand.font, brand.title);
  assert.equal(brand.logo, 24);
  checks.push('restored compact component notice and simpler sidebar');

  await page.getByRole('button', { name: '个人信息', exact: true }).click();
  const panel = page.getByRole('complementary', { name: '个人信息', exact: true });
  assert.equal(await panel.locator('.profile-empty-circle').count(), 5);
  assert.equal(await panel.locator('.profile-overview .is-ready').count(), 0);
  await capture(page, '02-profile-empty');
  for (const [name, text] of [
    ['简历摘要', '合成资料：负责检索服务和客户端研发，带领四人团队完成性能改进。'],
    ['职位描述摘要', '合成岗位：客户端工程师，关注跨平台体验与稳定性。'],
  ]) {
    const section = panel.locator(`details[aria-label="${name}"]`);
    await section.locator(':scope > summary').click();
    await section.getByRole('button', { name: '编辑', exact: true }).click();
    const editor = page.getByRole('dialog', { name: '编辑' + name, exact: true });
    await editor.getByRole('textbox').fill(text);
    await editor.getByRole('button', { name: '保存', exact: true }).click();
    await editor.waitFor({ state: 'hidden' });
    await section.locator(':scope > summary').click();
  }
  assert.equal(await panel.locator('.profile-overview .is-ready').count(), 2);
  assert.equal(await panel.locator('.profile-empty-circle').count(), 3);
  await panel.locator('.personal-panel-scroll').evaluate((element) => (element.scrollTop = 0));
  await capture(page, '03-profile-saved');
  await page.getByRole('button', { name: '个人信息', exact: true }).click();
  assert.equal(await panel.getByText('可选', { exact: true }).count(), 0);
  checks.push('profile completion without optional labels or redundant instructions');

  await page.getByRole('button', { name: '用户菜单', exact: true }).click();
  await page.getByRole('menuitem', { name: '设置', exact: true }).click();
  await page
    .getByRole('navigation', { name: '设置分类' })
    .getByRole('button', { name: '通用', exact: true })
    .click();
  const settings = page.getByRole('dialog', { name: '设置', exact: true });
  await settings.getByRole('button', { name: '面试设置', exact: true }).click();
  await settings.getByRole('slider', { name: '面试字体大小', exact: true }).fill('16');
  assert.equal(
    await settings.getByRole('slider', { name: '面试背景透明度', exact: true }).count(),
    1,
  );
  assert.equal(
    await settings
      .getByRole('slider', { name: '面试背景透明度', exact: true })
      .getAttribute('aria-valuetext'),
    '100%',
  );
  await settings.getByRole('heading', { name: '模型设置', exact: true }).waitFor();
  assert.equal(await settings.getByRole('button', { name: '测试麦克风', exact: true }).count(), 0);
  assert.equal(await settings.getByRole('button', { name: '刷新设备', exact: true }).count(), 0);
  await app.evaluate(() =>
    globalThis.uxDevices.push({ id: 'input-2', source: 'microphone', name: '合成麦克风2' }),
  );
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await settings.getByRole('button', { name: '麦克风设备', exact: true }).click();
  await page.getByRole('menuitemradio', { name: '合成麦克风2', exact: true }).waitFor();
  await page.keyboard.press('Escape');
  await settings.locator('.settings-content').evaluate((element) => (element.scrollTop = 0));
  await capture(page, '09-display-settings');
  assert.equal(
    await page.evaluate(() => document.documentElement.dataset.interviewTransparency),
    '100',
  );
  const preview = settings.locator('.interview-preview-scene');
  await preview.scrollIntoViewIfNeeded();
  if (screenshots)
    await preview.screenshot({
      path: path.join(screenshots, '12-layered-preview.png'),
      scale: 'css',
    });
  const layers = await preview.evaluate((e) =>
    Object.fromEntries(
      [
        '.floating-panel',
        '.floating-toolbar',
        '.answer-bubble',
        '.floating-composer',
        '.transcript-item p',
      ].map((selector) => {
        const style = getComputedStyle(e.querySelector(selector));
        return [selector, { fill: style.backgroundColor, image: style.backgroundImage }];
      }),
    ),
  );
  assert.notEqual(layers['.floating-panel'].fill, layers['.answer-bubble'].fill);
  assert.notEqual(layers['.floating-toolbar'].fill, layers['.floating-panel'].fill);
  assert.deepEqual(layers['.floating-toolbar'], layers['.answer-bubble']);
  assert.notEqual(layers['.answer-bubble'].fill, layers['.floating-composer'].fill);
  assert.equal(layers['.answer-bubble'].fill, layers['.transcript-item p'].fill);
  const misSizedIcons = await settings
    .locator('svg[data-ui-icon]')
    .evaluateAll((icons) =>
      icons
        .filter(
          (e) =>
            e.getBoundingClientRect().width > 0 &&
            (Math.abs(
              parseFloat(getComputedStyle(e).width) -
                parseFloat(e.style.getPropertyValue('--icon-size')),
            ) > 0.01 ||
              Math.abs(
                parseFloat(getComputedStyle(e).height) -
                  parseFloat(e.style.getPropertyValue('--icon-size')),
              ) > 0.01),
        )
        .map((e) => e.outerHTML),
    );
  assert.deepEqual(misSizedIcons, []);
  await settings.getByRole('button', { name: '通用', exact: true }).click();
  await settings.getByRole('heading', { name: '通用', exact: true }).waitFor();
  assert.equal(
    await settings.getByRole('slider', { name: '毛玻璃透明度', exact: true }).count(),
    0,
  );
  assert.equal(
    await page.evaluate(() => document.documentElement.dataset.frostedTransparency),
    '100',
  );
  await settings.getByRole('button', { name: '关闭设置', exact: true }).click();
  const originalDark = await page
    .locator('html')
    .evaluate((element) => element.classList.contains('dark'));
  const skeletonColors = [];
  try {
    for (const dark of [false, true]) {
      await page.evaluate((dark) => document.documentElement.classList.toggle('dark', dark), dark);
      for (const reducedMotion of ['no-preference', 'reduce']) {
        await page.emulateMedia({ reducedMotion });
        const beforeChecks = await app.evaluate(() => {
          globalThis.uxHoldAccess = true;
          return globalThis.uxAccessChecks;
        });
        await page.locator('.interview-start-trigger').click();
        const pending = page.getByRole('dialog', { name: '开始面试', exact: true });
        await pending.locator('.interview-access[aria-busy="true"]').waitFor();
        await pending.getByRole('status').filter({ hasText: '正在检查权限与音频设备…' }).waitFor();
        await waitForAsync(app, () => typeof globalThis.uxReleaseAccess === 'function');
        await page.evaluate(
          () =>
            new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
        );
        const loading = await pending.evaluate((dialog) => ({
          rows: [...dialog.querySelectorAll('.interview-access-row')].map((row) => {
            const status = row.querySelector('.interview-access-status, .remote-connection-status');
            return {
              label: row.querySelector(':scope > span').textContent,
              skeletons: row.querySelectorAll('.interview-access-skeleton.quota-skeleton-line')
                .length,
              status:
                status && getComputedStyle(status).visibility === 'visible'
                  ? status.textContent.trim()
                  : '',
            };
          }),
          devices: [...dialog.querySelectorAll('.interview-start-summary-group > div')]
            .filter((row) =>
              ['系统音频 · 面试官', '麦克风 · 面试者'].includes(
                row.querySelector('dt').textContent,
              ),
            )
            .map((row) => {
              const slot = row.querySelector('.interview-access-device-slot');
              const content = slot.querySelector('.interview-access-skeleton-content');
              return {
                text: row.querySelector('dd').innerText.trim(),
                skeletons: row.querySelectorAll('dd .interview-access-skeleton.quota-skeleton-line')
                  .length,
                slotWidth: slot.getBoundingClientRect().width,
                contentWidth: content.getBoundingClientRect().width,
                hidden: getComputedStyle(content).visibility === 'hidden',
              };
            }),
          skeletons: [
            ...dialog.querySelectorAll('.interview-access-skeleton.quota-skeleton-line'),
          ].map((line) => ({
            hidden: !!line.closest('[aria-hidden="true"]'),
            width: line.getBoundingClientRect().width,
            height: line.getBoundingClientRect().height,
            color: getComputedStyle(line, '::before').backgroundColor,
            animation: getComputedStyle(line, '::after').animationName,
            display: getComputedStyle(line, '::after').display,
            transform: getComputedStyle(line, '::after').transform,
            clip: getComputedStyle(line).clipPath,
          })),
        }));
        assert.deepEqual(
          loading.rows.map((row) => row.label).sort(),
          ['麦克风', '系统音频', '屏幕截图', '远程连接'].sort(),
        );
        assert.ok(
          loading.rows.every((row) =>
            row.label === '远程连接'
              ? row.skeletons === 0 && row.status === '未连接'
              : row.skeletons > 0 && row.status === '',
          ),
          JSON.stringify(loading.rows),
        );
        assert.equal(loading.devices.length, 2);
        assert.ok(
          loading.devices.every(
            (device) =>
              device.text === '' &&
              device.skeletons > 0 &&
              device.hidden &&
              device.slotWidth > 0 &&
              Math.abs(device.slotWidth - device.contentWidth) <= 1 / 64,
          ),
          'Pending device placeholders use hidden natural text width, without displaying unconfirmed names',
        );
        assert.ok(loading.skeletons.length >= 5);
        assert.ok(
          loading.skeletons.every((line) => line.hidden && line.width > 0 && line.height > 0),
        );
        assert.ok(
          loading.skeletons.every((line) => /^inset\(.+round /u.test(line.clip)),
          'Every skeleton clips its sweep to the fixed rounded bar',
        );
        assert.equal(await pending.locator('li[aria-label="屏幕捕获权限检查"]').count(), 1);
        assert.equal(
          await pending.getByRole('button', { name: '确认开始', exact: true }).isDisabled(),
          true,
        );
        assert.equal(
          await pending.getByRole('button', { name: '测试麦克风', exact: true }).count(),
          0,
        );
        assert.equal(
          await pending.getByRole('button', { name: '测试系统声音', exact: true }).count(),
          0,
        );
        if (reducedMotion === 'reduce') {
          assert.ok(
            loading.skeletons.every((line) => line.animation === 'none' && line.display === 'none'),
          );
        } else {
          assert.ok(loading.skeletons.every((line) => line.animation === 'quota-skeleton-sweep'));
          const first = loading.skeletons[0];
          await page.waitForFunction((previous) => {
            const line = document.querySelector(
              '.interview-start-dialog .interview-access-skeleton',
            );
            return line && getComputedStyle(line, '::after').transform !== previous;
          }, first.transform);
          skeletonColors.push(first.color);
          await assertSkeletonClip(
            page,
            pending.locator('.interview-access-status-slot > .quota-skeleton-line').first(),
          );
          await assertSkeletonClip(
            page,
            pending.locator('.interview-access-test-slot > .quota-skeleton-line').first(),
          );
        }
        const before = await readinessLayout(pending);
        const settling = readinessLayout(pending, true);
        await app.evaluate(() => globalThis.uxReleaseAccess());
        const frames = await settling;
        await pending.locator('.interview-access[aria-busy="false"]').waitFor();
        for (const frame of frames) assertReadinessGeometry(before, frame);
        assertReadinessGeometry(before, await readinessLayout(pending));
        assert.equal(await pending.locator('.interview-access-skeleton').count(), 0);
        await pending.getByText('合成播放设备', { exact: true }).waitFor();
        await pending.getByText('合成麦克风', { exact: true }).waitFor();
        assert.equal(
          await pending.getByRole('button', { name: '确认开始', exact: true }).isEnabled(),
          true,
        );
        assert.equal(await app.evaluate(() => globalThis.uxAccessChecks), beforeChecks + 1);
        await pending.getByRole('button', { name: '取消', exact: true }).click();
        await pending.waitFor({ state: 'hidden' });
      }
    }
    assert.notEqual(
      skeletonColors[0],
      skeletonColors[1],
      'Readiness skeleton colors follow the palette',
    );
  } finally {
    await app.evaluate(() => globalThis.uxReleaseAccess?.());
    await page.evaluate(
      (dark) => document.documentElement.classList.toggle('dark', dark),
      originalDark,
    );
    await page.emulateMedia({ reducedMotion: 'no-preference' });
  }
  checks.push(
    'held readiness IPC keeps three rows and measured status/button placeholders stable, hides unconfirmed device names, and clips real sweep pixels to capsule corners in both palettes and motion preferences',
  );
  await page.locator('.interview-start-trigger').click();
  const start = page.getByRole('dialog', { name: '开始面试', exact: true });
  await page.evaluate(() => {
    globalThis.uxTestEvents = [];
    globalThis.uxRemoveListener = window.desktop.onDictationEvent((event) =>
      globalThis.uxTestEvents.push(event),
    );
  });
  await start.getByRole('button', { name: '测试系统声音', exact: true }).click();
  await start.getByRole('button', { name: '停止系统声音测试' }).waitFor();
  await app.evaluate(() =>
    globalThis.uxHost.emit({
      type: 'segment',
      segment: {
        id: 'test-private',
        source: 'system',
        text: '此测试转写不得进入资料或面试',
        final: true,
        startMs: Date.now(),
        endMs: Date.now(),
        silenceStartMs: Date.now() - 800,
        reason: 'silence',
      },
    }),
  );
  await start.getByRole('meter', { name: '系统声音电平', exact: true }).waitFor();
  assert.equal(
    await start.getByRole('button', { name: '停止系统声音测试', exact: true }).innerText(),
    '停止',
  );
  await start.getByRole('meter', { name: '系统声音电平', exact: true }).evaluate(
    (e) =>
      new Promise((resolve) => {
        const check = () =>
          Number(e.getAttribute('aria-valuenow')) > 0 ? resolve() : requestAnimationFrame(check);
        check();
      }),
  );
  assert.ok(await start.getByRole('button', { name: '确认开始', exact: true }).isDisabled());
  assert.ok(
    await start.getByRole('button', { name: '确认开始', exact: true }).evaluate((element) => {
      const r = element.getBoundingClientRect();
      return r.top >= 0 && r.bottom <= innerHeight;
    }),
  );
  await geometry(page);
  assert.equal(await start.getByText('有输入', { exact: true }).count(), 0);
  assert.equal(await start.locator('.modal-footer .interview-start-description').count(), 1);
  assert.equal(await start.getByRole('button', { name: '前往面试设置', exact: true }).count(), 0);
  assert.ok(
    await start
      .locator('.modal-footer')
      .evaluate(
        (e) =>
          e.querySelector('.interview-start-description').getBoundingClientRect().bottom <=
          e.querySelector('.interview-start-actions').getBoundingClientRect().top,
      ),
  );
  await capture(page, '04-audio-check');
  await start.getByRole('button', { name: '测试系统声音', exact: true }).waitFor();
  assert.equal(await start.locator('.audio-check-inline').count(), 0);
  await start.getByRole('button', { name: '测试麦克风', exact: true }).click();
  await start.getByRole('meter', { name: '麦克风电平', exact: true }).waitFor();
  await start.getByRole('button', { name: '停止麦克风测试', exact: true }).click();
  await start.getByRole('button', { name: '测试麦克风', exact: true }).waitFor();
  const testEvents = await page.evaluate(() => {
    globalThis.uxRemoveListener();
    return globalThis.uxTestEvents.map((e) => e.type);
  });
  assert.ok(testEvents.includes('activity'));
  assert.ok(!testEvents.includes('segment'));
  await start.getByRole('button', { name: '测试麦克风', exact: true }).click();
  await start.getByRole('meter', { name: '麦克风电平', exact: true }).waitFor();
  await app.evaluate(() =>
    globalThis.uxHost.emit({
      type: 'status',
      status: { state: 'error', model: 'Synthetic', error: '合成音频检查失败' },
    }),
  );
  await start.getByRole('alert').filter({ hasText: '合成音频检查失败' }).waitFor();
  await start.getByRole('button', { name: '测试麦克风', exact: true }).waitFor();
  await waitForAsync(app, () => globalThis.uxHost.uxStatus.state === 'idle');
  await app.evaluate(() => {
    globalThis.uxHoldAccess = true;
  });
  try {
    await start.getByRole('button', { name: '重新检查', exact: true }).click();
    await waitForAsync(app, () => typeof globalThis.uxReleaseAccess === 'function');
    await start.locator('.interview-access[aria-busy="true"]').waitFor();
    assert.equal(
      await start.getByText('合成音频检查失败', { exact: true }).count(),
      0,
      'A new readiness attempt clears the previous audio-test error while loading',
    );
  } finally {
    await app.evaluate(() => globalThis.uxReleaseAccess?.());
  }
  await start.locator('.interview-access[aria-busy="false"]').waitFor();
  await start.getByRole('button', { name: '测试麦克风', exact: true }).waitFor();
  assert.equal(
    await start.getByText('合成音频检查失败', { exact: true }).count(),
    0,
    'The previous audio-test error must not return after a fresh readiness check',
  );
  assert.equal(
    await start.getByRole('button', { name: '确认开始', exact: true }).isEnabled(),
    true,
  );
  checks.push('10-second dual-source test, activity-only routing, release before interview');

  // Observe from creation: production deduplicates unchanged native states.
  // A late observer can miss an already-enabled passthrough state entirely.
  await app.evaluate(({ BrowserWindow }) => {
    const original = BrowserWindow.prototype.setIgnoreMouseEvents;
    globalThis.uxRestorePassthrough = () => {
      BrowserWindow.prototype.setIgnoreMouseEvents = original;
    };
    BrowserWindow.prototype.setIgnoreMouseEvents = function (ignore, ...args) {
      globalThis.uxIgnored = ignore;
      return original.call(this, ignore, ...args);
    };
  });
  const [floating] = await Promise.all([
    app.waitForEvent('window'),
    start.getByRole('button', { name: '确认开始', exact: true }).click(),
  ]);
  floating.setDefaultTimeout(15000);
  await floating.getByRole('status', { name: '语音模型：正常', exact: true }).waitFor();
  await app.evaluate(() => clearInterval(globalThis.uxLevels));
  const badge = (label, status) =>
    floating.getByRole('status', { name: `${label}：${status}`, exact: true, includeHidden: true });
  await badge('系统音频', '正常').waitFor();
  await app.evaluate(() => {
    globalThis.uxHost.emit({ type: 'activity', source: 'microphone', speaking: true, level: 0.08 });
    globalThis.uxHost.emit({ type: 'activity', source: 'system', speaking: false, level: 0.04 });
  });
  await badge('麦克风', '有输入').waitFor();
  await badge('系统音频', '有输入').waitFor();
  assert.equal(await badge('语音模型', '有输入').count(), 0);
  const bars = floating.locator(
    '.interview-ready-badge[aria-label^="麦克风："] .interview-readiness-level i',
  );
  assert.equal(await bars.count(), 3);
  assert.equal(await bars.first().evaluate((e) => getComputedStyle(e).transitionDuration), '0.09s');
  const firstLevel = await bars.first().evaluate((e) => getComputedStyle(e).transform);
  await app.evaluate(() =>
    globalThis.uxHost.emit({ type: 'activity', source: 'microphone', speaking: false, level: 0 }),
  );
  await floating.waitForFunction((before) => {
    const bar = document.querySelector(
      '.interview-ready-badge[aria-label^="麦克风："] .interview-readiness-level i',
    );
    return bar && getComputedStyle(bar).transform !== before;
  }, firstLevel);
  await badge('麦克风', '正常').waitFor();
  await badge('系统音频', '正常').waitFor();
  await app.evaluate(() => {
    globalThis.uxBadgeActivity = setInterval(
      () =>
        globalThis.uxHost.emit({
          type: 'activity',
          source: 'microphone',
          speaking: true,
          level: 0.06,
        }),
      100,
    );
    globalThis.uxHost.emit({
      type: 'gap',
      source: 'system',
      message: '合成播放设备连接中断，请检查设备连接。',
    });
  });
  await badge('麦克风', '有输入').waitFor();
  await badge('系统音频', '异常').hover();
  await floating
    .getByRole('tooltip', { name: '系统音频：合成播放设备连接中断，请检查设备连接。', exact: true })
    .waitFor();
  await capture(floating, '15-compact-status');
  await app.evaluate(() => {
    clearInterval(globalThis.uxBadgeActivity);
    globalThis.uxHost.emit({ type: 'activity', source: 'system', speaking: false, level: 0 });
  });
  await badge('系统音频', '正常').waitFor();
  await floating.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await bars.first().evaluate((e) => getComputedStyle(e).transitionDuration), '0s');
  await floating.emulateMedia({ reducedMotion: 'no-preference' });
  checks.push(
    'compact status uses actual source activity with animated decay, source-specific warning tooltip, disabled/paused states and reduced-motion support',
  );
  await app.evaluate(() =>
    globalThis.uxHost.emit({
      type: 'segment',
      segment: {
        id: 'pending-1',
        source: 'system',
        text: '请介绍一个你负责过的项目。',
        final: true,
        startMs: Date.now(),
        endMs: Date.now(),
        silenceStartMs: Date.now() - 800,
        reason: 'silence',
      },
    }),
  );
  assert.equal(await floating.getByRole('button', { name: '取消本次', exact: true }).count(), 0);
  assert.equal(await floating.getByText('待提交问题', { exact: true }).count(), 0);
  assert.equal(await floating.locator('.floating-composer-options').getByRole('status').count(), 0);
  await floating
    .getByText('我会先确认问题和边界，再结合已知事实说明实现方法。', { exact: true })
    .waitFor();
  await app.evaluate(() => {
    clearInterval(globalThis.uxLevels);
    globalThis.uxHost.emit({
      type: 'status',
      status: {
        state: 'error',
        model: 'Synthetic',
        error: '所选音频设备已断开。',
        failureSource: 'system',
      },
    });
  });
  await floating.getByRole('button', { name: '重新连接音频', exact: true }).waitFor();
  await badge('系统音频', '异常').waitFor();
  await badge('麦克风', '已暂停').waitFor();
  await badge('语音模型', '已暂停').waitFor();
  await geometry(floating);
  await capture(floating, '06-audio-recovery');
  await floating.getByRole('button', { name: '重新连接音频', exact: true }).click();
  await badge('语音模型', '正常').waitFor();
  assert.ok(
    await floating
      .getByText('我会先确认问题和边界，再结合已知事实说明实现方法。', { exact: true })
      .isVisible(),
  );
  assert.ok((await floating.getByText('请介绍一个你负责过的项目。', { exact: true }).count()) > 0);
  await app.evaluate(() => {
    globalThis.uxHold = true;
  });
  await floating
    .getByRole('textbox', { name: '面试提问', exact: true })
    .fill('如何设计清晰的接口？');
  await floating.getByRole('button', { name: '发送面试问题', exact: true }).click();
  await floating.getByRole('button', { name: '停止当前回答', exact: true }).waitFor();
  await floating.getByText('当前回答继续使用原模型。', { exact: true }).waitFor();
  const clearCorner = { x: 12, y: 12, width: 48, height: 24 };
  const unobscured = await floating.screenshot({ clip: clearCorner, scale: 'css' });
  const passthrough = await floating.evaluate(
    () => window.desktop.presentation.interviewMousePassthrough,
  );
  const waitNativePassthrough = async (expected) => {
    const matched = await app.evaluate(async (_electron, expected) => {
      const deadline = Date.now() + 3000;
      while (Date.now() < deadline) {
        if (globalThis.uxIgnored === expected) return true;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      return false;
    }, expected);
    assert.equal(
      matched,
      true,
      JSON.stringify({
        expected,
        actual: await app.evaluate(() => globalThis.uxIgnored),
        document: await floating.evaluate(() => ({
          corner: document.elementFromPoint(2, 2)?.outerHTML.slice(0, 300),
          dialogs: [...document.querySelectorAll('dialog[open]')].map((d) =>
            d.getAttribute('aria-label'),
          ),
        })),
      }),
    );
  };
  const moveToBlankCorner = async () => {
    await floating.mouse.move(2, 2);
    if (process.platform === 'darwin') {
      // Native forwarding can replay the stationary OS cursor after a CDP move.
      // Supply this fixture's viewport input directly; hit testing, preload/IPC
      // and the real BrowserWindow passthrough call remain under test.
      await floating.evaluate(() =>
        window.dispatchEvent(
          new MouseEvent('mousemove', { clientX: 2, clientY: 2, bubbles: true }),
        ),
      );
    }
    await waitNativePassthrough(true);
  };
  if (passthrough) {
    if (nativeProbe) {
      // CDP mouse movement leaves the Windows cursor unchanged. The production
      // stale-leave guard checks that cursor, so move it onto this window's own
      // blank corner before checking actual native passthrough at every DPI.
      const point = await app.evaluate(({ BrowserWindow, screen }, url) => {
        const win = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL() === url);
        win.moveTop();
        win.focus();
        const bounds = win.getContentBounds();
        return screen.dipToScreenPoint({ x: bounds.x + 2, y: bounds.y + 2 });
      }, floating.url());
      assert.equal(nativeProbe('desktop').interactive, true);
      nativeProbe('move', point.x, point.y);
    }
    await moveToBlankCorner();
  }
  await floating.getByRole('button', { name: '面试设置', exact: true }).click();
  const devices = floating.getByRole('dialog', { name: '面试设置', exact: true });
  await settingsLayout(devices);
  assert.equal(
    await floating.evaluate(() => typeof window.desktop.setInterviewSettingsMaterial),
    'undefined',
  );
  const settingsCorner = await floating.screenshot({ clip: clearCorner, scale: 'css' });
  assert.equal(
    unobscured.equals(settingsCorner),
    true,
    'Interview settings leave the background unchanged',
  );
  const clearPixels = await app.evaluate(({ nativeImage }, bytes) => {
    const pixels = nativeImage.createFromBuffer(Buffer.from(bytes, 'base64')).toBitmap();
    let valid = true;
    for (let i = 0; i < pixels.length; i += 4) valid &&= pixels[i + 3] === 0;
    return { valid, first: [...pixels.subarray(0, 4)] };
  }, settingsCorner.toString('base64'));
  assert.equal(clearPixels.valid, true, JSON.stringify(clearPixels));
  if (passthrough) {
    await waitNativePassthrough(false);
    const visible = await floating.locator('.floating-viewport').evaluate((viewport) => {
      const width =
        parseFloat(getComputedStyle(viewport).getPropertyValue('--interview-width')) || innerWidth;
      return { x: (innerWidth - width) / 2 + 2, y: 2 };
    });
    await floating.mouse.move(visible.x, visible.y);
    await waitNativePassthrough(false);
    if (visible.x > 2) {
      await floating.mouse.move(2, 2);
      await waitNativePassthrough(true);
      await floating.mouse.move(visible.x, visible.y);
      await waitNativePassthrough(false);
    }
  }
  // Dismissal consumes the first click on both the transcript and toolbar.
  const transcriptEdge = await floating.locator('.floating-transcript').boundingBox();
  await floating.mouse.click(transcriptEdge.x + 5, transcriptEdge.y + 100);
  await devices.waitFor({ state: 'hidden' });
  assert.equal(
    unobscured.equals(await floating.screenshot({ clip: clearCorner, scale: 'css' })),
    true,
    'Closing settings preserves the clear background',
  );
  await floating.waitForFunction(() => !document.querySelector('[data-modal-exit]'));
  await floating.getByRole('button', { name: '面试设置', exact: true }).click();
  await devices.waitFor({ state: 'visible' });
  const end = await floating.getByRole('button', { name: '结束面试', exact: true }).boundingBox();
  await floating.mouse.click(end.x + end.width / 2, end.y + end.height / 2);
  await devices.waitFor({ state: 'hidden' });
  assert.equal(
    await floating.getByRole('button', { name: '确认结束面试', exact: true }).count(),
    0,
  );
  await floating.waitForFunction(() => !document.querySelector('[data-modal-exit]'));
  await floating.getByRole('button', { name: '面试设置', exact: true }).click();
  await devices.waitFor({ state: 'visible' });
  assert.equal(await devices.getByRole('button', { name: '刷新设备', exact: true }).count(), 0);
  await app.evaluate(() =>
    globalThis.uxDevices.push({ id: 'output-2', source: 'system', name: '合成播放设备2' }),
  );
  await floating.evaluate(() => window.dispatchEvent(new Event('focus')));
  await devices.getByRole('button', { name: '选择播放设备', exact: true }).click();
  await floating.getByRole('menuitemradio', { name: '合成播放设备2', exact: true }).waitFor();
  await floating.keyboard.press('Escape');
  await devices.getByRole('button', { name: '选择麦克风', exact: true }).click();
  await devices.getByRole('menuitemradio', { name: '不使用麦克风', exact: true }).click();
  await badge('麦克风', '未启用').waitFor();
  const configuration = await floating.evaluate(() => window.desktop.interviewState());
  assert.deepEqual(configuration.configuration.options.sources, ['system']);
  const captureCalls = () =>
    app.evaluate(
      () =>
        globalThis.uxCalls.filter((call) => ['start', 'stop', 'pause'].includes(call.op)).length,
    );
  const capturesBefore = await captureCalls();
  for (const label of ['选择播放设备', '选择麦克风', '选择播放设备', '选择麦克风']) {
    const trigger = devices.getByRole('button', { name: label, exact: true, includeHidden: true });
    await trigger.dispatchEvent('keydown', { key: 'Enter', code: 'Enter' });
    assert.equal(await floating.getByRole('menu').count(), 1);
    assert.equal(await devices.locator('[aria-haspopup="menu"][aria-expanded="true"]').count(), 1);
    assert.equal(
      await floating.getByRole('menu').getAttribute('aria-labelledby'),
      await trigger.getAttribute('id'),
    );
  }
  await floating.keyboard.press('Escape');
  assert.equal(await floating.getByRole('menu').count(), 0);
  assert.equal(await captureCalls(), capturesBefore);
  await app.evaluate(() => {
    globalThis.uxHoldSpeech = true;
  });
  await devices.getByRole('button', { name: '语音识别模型', exact: true }).click();
  await floating.getByRole('menuitemradio', { name: '多语言语音识别', exact: true }).click();
  await devices.getByRole('status').filter({ hasText: '原配置继续转写' }).waitFor();
  const checkSpeechStatusHeading = async () => {
    const layout = await devices.locator('.speech-model-status').evaluate((status) => {
      const heading = status.closest('.speech-model-heading');
      const frame = heading.getBoundingClientRect();
      const text = status.getBoundingClientRect();
      const row = heading.nextElementSibling.getBoundingClientRect();
      return {
        role: status.getAttribute('role'),
        aligned: Math.abs(text.left - frame.left) <= 1 / 64,
        above: text.bottom <= row.top,
        redundantTitle: heading.querySelector('h4') !== null,
        overflow: heading.scrollWidth > heading.clientWidth,
      };
    });
    assert.equal(layout.role, 'status');
    assert.ok(
      layout.aligned && layout.above && !layout.redundantTitle && !layout.overflow,
      JSON.stringify(layout),
    );
  };
  await checkSpeechStatusHeading();
  assert.equal(
    await devices.getByRole('button', { name: '语音识别模型', exact: true }).isDisabled(),
    true,
  );
  assert.equal(
    await devices.getByRole('button', { name: '选择播放设备', exact: true }).isDisabled(),
    true,
  );
  assert.equal(
    await devices.getByRole('button', { name: '面试回答模型', exact: true }).isDisabled(),
    false,
  );
  await waitForAsync(app, () => typeof globalThis.uxSpeechWait === 'function');
  await app.evaluate(() => globalThis.uxSpeechWait());
  await devices.getByRole('status').filter({ hasText: '等待语音停顿' }).waitFor();
  await checkSpeechStatusHeading();
  await openModelMenu(floating, '面试回答模型', '面试思考强度');
  await floating.getByRole('menuitemradio', { name: '验证模型', exact: true }).click();
  await waitForAsync(
    floating,
    async () => (await window.desktop.interviewState()).configuration.modelId === 'next-model',
  );
  const effortSlider = devices.getByRole('slider', { name: '面试思考强度', exact: true });
  await effortSlider.waitFor();
  assert.equal(await effortSlider.getAttribute('aria-valuetext'), '高');
  assert.equal(await effortSlider.isDisabled(), true);
  await floating.keyboard.press('Escape');
  await waitForAsync(
    floating,
    async () => (await window.desktop.interviewState()).configuration.effort === 'high',
  );
  assert.equal(await app.evaluate(() => globalThis.uxCurrentSignal.aborted), false);
  await app.evaluate(() => {
    globalThis.uxHoldSpeech = false;
    globalThis.uxSpeechFinish();
  });
  await waitForAsync(
    floating,
    async () =>
      (await window.desktop.interviewState()).configuration.options.speechModel === 'qwen',
  );
  await devices.getByRole('button', { name: '语音推理设备', exact: true }).click();
  await floating.getByRole('menuitemradio', { name: 'CPU', exact: true }).click();
  await waitForAsync(
    floating,
    async () =>
      (await window.desktop.interviewState()).configuration.options.inferenceDevice === 'cpu',
  );
  await app.evaluate(() => {
    globalThis.uxFailSpeech = true;
  });
  await devices.getByRole('button', { name: '语音推理设备', exact: true }).click();
  await floating
    .getByRole('menuitemradio', {
      name: process.platform === 'darwin' ? 'Metal（推荐）' : 'CUDA（推荐）',
      exact: true,
    })
    .click();
  await devices.getByRole('alert').filter({ hasText: '合成候选加载失败' }).waitFor();
  assert.equal(
    (await floating.evaluate(() => window.desktop.interviewState())).configuration.options
      .inferenceDevice,
    'cpu',
  );
  assert.equal(await floating.getByText('音频采集中断', { exact: true }).count(), 0);
  await app.evaluate(() => {
    globalThis.uxFailSpeech = false;
  });
  await devices.getByRole('button', { name: '语音识别模型', exact: true }).click();
  await floating.getByRole('menuitemradio', { name: '轻量语音识别', exact: true }).click();
  await waitForAsync(
    floating,
    async () =>
      (await window.desktop.interviewState()).configuration.options.speechModel === 'paraformer',
  );
  assert.equal(await captureCalls(), capturesBefore);
  checks.push(
    'background speech/model device switches preserve capture; pending switch leaves answer model editable; failure retains old device without capture error',
  );
  const slider = devices.getByRole('slider', { name: '面试字体大小', exact: true });
  await slider.fill('18');
  assert.equal(
    await devices.getByRole('slider', { name: '面试背景透明度', exact: true }).count(),
    1,
  );
  const actualLayers = await floating.evaluate(() =>
    Object.fromEntries(
      [
        '.floating-panel',
        '.floating-toolbar',
        '.answer-bubble',
        '.floating-composer',
        '.transcript-item p',
      ].map((selector) => {
        const style = getComputedStyle(document.querySelector(selector));
        return [selector, { fill: style.backgroundColor, image: style.backgroundImage }];
      }),
    ),
  );
  assert.deepEqual(
    actualLayers,
    layers,
    'Preview and real interview must share the same reading and chat chrome materials',
  );
  assert.equal(
    await floating.evaluate(() => document.documentElement.dataset.interviewTransparency),
    '100',
  );
  assert.equal(await devices.getByRole('button', { name: /应用.*设置/ }).count(), 0);
  assert.equal(await devices.getByRole('button', { name: '完成', exact: true }).count(), 0);
  assert.equal(await devices.locator('.display-slider-icon').count(), 4);
  assert.equal(await devices.getByText('当前回答结束后可修改', { exact: true }).count(), 0);
  await geometry(floating);
  const backdrop = await devices.evaluate((e) => {
    const style = getComputedStyle(e, '::backdrop');
    return {
      clip: style.clipPath,
      filter: style.backdropFilter,
      color: style.backgroundColor,
      shadow: getComputedStyle(e).boxShadow,
      surface: getComputedStyle(e).backgroundColor,
      surfaceFilter: getComputedStyle(e).backdropFilter,
    };
  });
  assert.equal(backdrop.clip, 'none');
  assert.equal(backdrop.color, 'rgba(0, 0, 0, 0)');
  assert.equal(backdrop.filter, 'none');
  assert.equal(backdrop.surface, 'rgb(28, 32, 35)');
  assert.equal(backdrop.surfaceFilter, 'none');
  assert.equal(backdrop.shadow, 'none');
  const beforeMaterial = backdrop.surface;
  for (const value of [0, 50, 100]) {
    await page.evaluate((value) => {
      localStorage.setItem('voxcue-frosted-transparency-v2', String(value));
      localStorage.setItem('voxcue-interview-background-transparency-v1', String(value));
      window.dispatchEvent(new StorageEvent('storage', { key: 'voxcue-frosted-transparency-v2' }));
      window.dispatchEvent(
        new StorageEvent('storage', { key: 'voxcue-interview-background-transparency-v1' }),
      );
    }, value);
    assert.equal(
      await page.evaluate(() => document.documentElement.dataset.frostedTransparency),
      '100',
    );
    assert.equal(
      await floating.evaluate(() => document.documentElement.dataset.frostedTransparency),
      '100',
    );
    await floating.waitForFunction(
      (value) => document.documentElement.dataset.interviewTransparency === String(value),
      value,
    );
    assert.equal(
      await floating.evaluate(() => document.documentElement.dataset.interviewTransparency),
      String(value),
    );
    for (const theme of ['light', 'dark']) {
      await floating.emulateMedia({ colorScheme: theme });
      assert.equal(
        await floating.locator('html').evaluate((e) => e.classList.contains('dark')),
        true,
      );
      assert.equal(
        await devices.evaluate((e) => getComputedStyle(e).backgroundColor),
        beforeMaterial,
      );
      assert.equal(await devices.evaluate((e) => getComputedStyle(e).backdropFilter), 'none');
    }
  }
  await floating.emulateMedia({ forcedColors: 'active' });
  assert.equal(await devices.evaluate((e) => getComputedStyle(e).backdropFilter), 'none');
  await floating.emulateMedia({ forcedColors: 'none' });
  // Restoring the normal palette can start finite color transitions. Compare
  // the opaque surface only after those transitions have settled.
  await capture(floating, 'settings-palette-settled');
  const settingsBox = await devices.boundingBox();
  // Sample only the panel's inner padding: text antialiasing may differ by one
  // channel value when Chromium recomposites an unrelated filtered layer.
  const opaqueSample = { x: settingsBox.x + 8, y: settingsBox.y + 60, width: 8, height: 120 };
  // Palette restoration can start a header-border transition after the first
  // style flush. Compare the same animation phase in both shots; the unchanged
  // background must not differ merely because that border advances a frame.
  // Compare native pixels: CSS-size screenshots resample fractional DPI and
  // can round channels differently after recompositing an unrelated layer.
  // The same CSS rectangle and zero-difference assertion remain unchanged.
  const covered = await floating.screenshot({
    clip: opaqueSample,
    scale: 'device',
    animations: 'disabled',
  });
  await floating.locator('.floating-panels').evaluate((e) => {
    e.style.filter = 'invert(1)';
  });
  const changedBackground = await floating.screenshot({
    clip: opaqueSample,
    scale: 'device',
    animations: 'disabled',
  });
  await floating.locator('.floating-panels').evaluate((e) => {
    e.style.removeProperty('filter');
  });
  const pixelDifference = await app.evaluate(
    ({ nativeImage }, images) => {
      const [a, b] = images.map((value) =>
        nativeImage.createFromBuffer(Buffer.from(value, 'base64')).toBitmap(),
      );
      let changed = 0,
        max = 0;
      for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) changed++;
        max = Math.max(max, Math.abs(a[i] - b[i]));
      }
      return { changed, max, first: [...a.subarray(0, 4)], second: [...b.subarray(0, 4)] };
    },
    [covered.toString('base64'), changedBackground.toString('base64')],
  );
  assert.equal(
    pixelDifference.changed,
    0,
    'Opaque settings must hide changes in the underlying interview: ' +
      JSON.stringify(pixelDifference),
  );
  await capture(floating, '07-interview-settings');
  await devices.getByRole('button', { name: '关闭对话框', exact: true }).click();
  await devices.waitFor({ state: 'hidden' });
  if (passthrough) {
    await moveToBlankCorner();
  }
  await app.evaluate(() => globalThis.uxRestorePassthrough());
  assert.equal(await app.evaluate(() => globalThis.uxCurrentSignal.aborted), false);
  assert.equal((await app.evaluate(() => globalThis.uxRequests))[1].modelId, 'test-model');
  await app.evaluate(() => globalThis.uxFinish());
  await floating.getByRole('button', { name: '发送面试问题', exact: true }).waitFor();
  await floating
    .getByRole('textbox', { name: '面试提问', exact: true })
    .fill('新的追问应该如何回答？');
  await floating.getByRole('button', { name: '发送面试问题', exact: true }).click();
  await floating.getByRole('button', { name: '发送面试问题', exact: true }).waitFor();
  assert.deepEqual((await app.evaluate(() => globalThis.uxRequests)).at(-1), {
    modelId: 'next-model',
    effort: 'high',
  });
  checks.push(
    'device/model choices save directly without Apply; active answer continues on old settings and next question uses new model/effort',
  );
  await capture(floating, '05-interview');
  const metadata = await floating
    .locator('.transcript-meta')
    .first()
    .evaluate((e) => {
      const label = e.querySelector('strong').getBoundingClientRect(),
        time = e.querySelector('time').getBoundingClientRect();
      return { gap: time.left - label.right, text: e.textContent };
    });
  assert.ok(metadata.gap >= 0 && metadata.gap < 16);
  assert.ok(!metadata.text.includes('系统音频'));
  checks.push(
    'compact status beside auto-answer, nearby timestamps, green readiness, in-place audio and model settings, centered font slider and fixed 60% material',
  );
  for (const theme of ['light', 'dark']) {
    await floating.emulateMedia({ colorScheme: theme });
    assert.equal(
      await floating.locator('html').evaluate((e) => e.classList.contains('dark')),
      true,
    );
    await geometry(floating);
    await floating.evaluate(() => window.desktop.resizeInterview(-1));
    await geometry(floating);
  }
  await capture(floating, '08-interview-dark');
  const originalWindow = await app.evaluate(({ BrowserWindow }, url) => {
    const window = BrowserWindow.getAllWindows().find(
      (window) => window.webContents.getURL() === url,
    );
    return { size: window.getContentSize(), minimum: window.getMinimumSize() };
  }, floating.url());
  for (const width of [960, 620, 440]) {
    await app.evaluate(
      ({ BrowserWindow }, { url, width }) => {
        const window = BrowserWindow.getAllWindows().find(
          (window) => window.webContents.getURL() === url,
        );
        window.setMinimumSize(360, 420);
        window.setContentSize(width, 780);
      },
      { url: floating.url(), width },
    );
    for (const theme of ['light', 'dark']) {
      await floating.emulateMedia({ colorScheme: theme });
      assert.equal(
        await floating.locator('html').evaluate((e) => e.classList.contains('dark')),
        true,
      );
      await floating.waitForFunction(() => !document.querySelector('[data-modal-exit]'));
      await floating.getByRole('button', { name: '面试设置', exact: true }).click();
      await devices.waitFor({ state: 'visible' });
      const layout = await settingsLayout(devices);
      const recognition = layout.rows.filter((row) => ['语音模型', '推理设备'].includes(row.text));
      assert.equal(recognition.length, 2);
      const answer = layout.rows.find((row) => row.text === '回答模型');
      assert.ok(layout.audio[1].top > layout.audio[0].bottom);
      assert.ok(recognition[1].row.top > recognition[0].row.bottom);
      assert.ok(recognition[0].row.top > answer.row.bottom);
      if (width === 960 || width === 440) {
        await devices.locator('.dialog-scroll').evaluate((element) => {
          element.scrollTop = 0;
        });
        if (width === 440)
          await devices.locator('.speech-model-group').last().scrollIntoViewIfNeeded();
        await capture(floating, `settings-layout-${width === 960 ? 'wide' : 'narrow'}-${theme}`);
      }
      await devices.getByRole('button', { name: '关闭对话框', exact: true }).click();
      await devices.waitFor({ state: 'hidden' });
    }
  }
  await app.evaluate(
    ({ BrowserWindow }, { url, originalWindow }) => {
      const window = BrowserWindow.getAllWindows().find(
        (window) => window.webContents.getURL() === url,
      );
      window.setContentSize(...originalWindow.size);
      window.setMinimumSize(...originalWindow.minimum);
    },
    { url: floating.url(), originalWindow },
  );
  checks.push(
    'settings sections and all seven rows stack vertically with labels left and equal-width centered controls right; 960/620/440 widths in both themes fit without overflow',
  );
  checks.push(
    'fixed dark interview and smaller native interview bounds, automatic device refresh in both settings, font slider and fixed opacity scene, footer privacy and meters without trailing status',
  );
  await floating.getByRole('button', { name: '结束面试', exact: true }).click();
  await floating.getByRole('button', { name: '确认结束面试', exact: true }).click();
  console.log(
    JSON.stringify({
      status: 'passed',
      checks,
      screenshots: screenshots ?? 'none',
      physicalCapture: false,
      realAccounts: false,
    }),
  );
} finally {
  if (nativeProbe && originalCursor) nativeProbe('move', originalCursor.x, originalCursor.y);
  await closeUiApp(app);
}
