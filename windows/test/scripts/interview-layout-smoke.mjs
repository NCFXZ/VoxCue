import { captureRequested } from '../../../shared/test/scripts/capture-requested.mjs';
import { connectUiAccount } from '../../../shared/test/scripts/install-ui-account.mjs';
import { testRoot, electron } from '../../../shared/test/scripts/test-workspace.mjs';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { installUiAccount, closeUiApp } from '../../../shared/test/scripts/install-ui-account.mjs';
import { probe } from './window-probe.mjs';

function requireDesktop() {
  assert.equal(
    probe('desktop').interactive,
    true,
    'Native resize checks require an unlocked desktop',
  );
}
requireDesktop();

await mkdir(path.join(testRoot, 'test/results'), { recursive: true });
const profile = await mkdtemp(
  path.resolve(path.join(testRoot, 'test/results/interview-layout-ui-')),
);
const fixture = path.join(profile, 'main.cjs');
const nativeMouse = path.join(profile, 'mouse.exe');
const nativeSource = path.join(profile, 'mouse.cs');
const runMouse = promisify(execFile);
await writeFile(
  nativeSource,
  `
using System;
using System.Runtime.InteropServices;
using System.Threading;
public static class LayoutMouse {
  public static void Main(string[] args) { Run(int.Parse(args[0]),int.Parse(args[1]),int.Parse(args[2]),int.Parse(args[3]),args[4]=="restore",args.Length>5?new IntPtr(long.Parse(args[5])):IntPtr.Zero); }
  [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
  [DllImport("user32.dll")] static extern bool SetCursorPos(int x,int y);
  [StructLayout(LayoutKind.Sequential)] struct Point { public int x; public int y; }
  [DllImport("user32.dll")] static extern bool GetCursorPos(out Point point);
  [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(Point point);
  [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr window,uint flags);
  [DllImport("user32.dll")] static extern void mouse_event(uint flags,uint dx,uint dy,uint data,UIntPtr extra);
  static void Move(int x,int y) {
    // Per-monitor-v2 coordinates are already physical pixels. Avoid converting
    // them through asynchronous normalized mouse_event coordinates again.
    if(!SetCursorPos(x,y))throw new Exception("Native cursor unavailable on the input desktop");
  }
  public static void Run(int x,int y,int dx,int dy,bool restore,IntPtr expected) {
    var context=SetThreadDpiAwarenessContext(new IntPtr(-4));
    try {
      Move(x,y);
      if(restore)return;
      if(expected==IntPtr.Zero||GetAncestor(WindowFromPoint(new Point{x=x,y=y}),2)!=expected)throw new Exception("Refusing input outside the intended synthetic test window");
      mouse_event(2,0,0,0,UIntPtr.Zero);
      // Gesture pacing, not a wait for UI readiness.
      Thread.Sleep(150);
      for(int i=1;i<=20;i++){Move(x+dx*i/20,y+dy*i/20);Thread.Sleep(16);}
      // Hold the last gesture position while the injected 30 ms IPC delay drains.
      Thread.Sleep(70);
      Point end;GetCursorPos(out end);Console.WriteLine(end.x+","+end.y);
    } finally {if(!restore)mouse_event(4,0,0,0,UIntPtr.Zero);SetThreadDpiAwarenessContext(context);}
  }
}
`,
);
await runMouse(
  path.join(process.env.WINDIR || 'C:/Windows', 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'),
  ['/nologo', '/target:exe', '/out:' + nativeMouse, nativeSource],
  { windowsHide: true },
);
await writeFile(
  fixture,
  `
const {app,ipcMain,screen,BrowserWindow}=require('electron');
app.setAppPath(${JSON.stringify(process.cwd())});
process.chdir(${JSON.stringify(process.cwd())});
app.setPath('userData',${JSON.stringify(profile)});
globalThis.layoutStats={moves:0,inFlight:0,maximumInFlight:0,bounds:0};
globalThis.layoutBoundsTrace=[];
const handle=ipcMain.handle.bind(ipcMain);
ipcMain.handle=(channel,callback)=>handle(channel,async(event,...args)=>{
  if(channel!=='interview:resize'||args[0]?.phase!=='move')return callback(event,...args);
  const stats=globalThis.layoutStats;
  stats.moves++;stats.inFlight++;stats.maximumInFlight=Math.max(stats.maximumInFlight,stats.inFlight);
  try { await new Promise(resolve=>setTimeout(resolve,30));return await callback(event,...args); }
  finally { stats.inFlight--; }
});
app.whenReady().then(()=>{
  const cursor=screen.getCursorScreenPoint.bind(screen);
  screen.getCursorScreenPoint=()=>globalThis.layoutCursor??cursor();
});
const setBounds=BrowserWindow.prototype.setBounds;
BrowserWindow.prototype.setBounds=function(...args){
  const interview=this.webContents.getURL().endsWith('#interview');
  if(interview)globalThis.layoutStats.bounds++;
  const result=setBounds.apply(this,args);
  if(interview)globalThis.layoutBoundsTrace.push({...this.getBounds(),requested:args[0]});
  return result;
};
require(${JSON.stringify(path.resolve('dist-electron/shared/electron/main.js'))});
`,
);
const env = { ...process.env, COPILOT_TEST_USER_DATA: profile, VITE_DEV_SERVER_URL: '' };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: [fixture], env });
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
    const { ChatGPTService } = require(
      app.getAppPath() + '/dist-electron/shared/electron/backend/chat/service.js',
    );
    SpeechHost.prototype.call = async function (call) {
      globalThis.layoutSpeech = (event) => this.emit(event);
      const status = {
        state: call.op === 'start' ? 'running' : 'idle',
        model: 'Synthetic speech port',
        devices: [],
      };
      this.emit({ type: 'status', status });
      return status;
    };
    globalThis.layoutRequests = [];
    ChatGPTService.prototype.stream = async (request, emit) => {
      if (request.id.startsWith('history-title-'))
        return { answerText: '合成记录', usage: null, sources: [] };
      globalThis.layoutRequests.push(request);
      emit({
        id: request.id,
        type: 'provider',
        provider: { id: 'chatgpt', name: 'ChatGPT', dataRecipient: 'OpenAI' },
      });
      emit({ id: request.id, type: 'activity', activity: { phase: 'waiting' } });
      globalThis.layoutThought = () => {
        emit({ id: request.id, type: 'reasoning-summary', text: '**分析问题**\n\n先比较条件。' });
        emit({
          id: request.id,
          type: 'activity',
          activity: {
            id: 'public-thought',
            kind: 'reasoning',
            phase: 'thinking',
            detail: '**分析问题**\n\n先比较条件。',
          },
        });
      };
      return new Promise((resolve) => {
        globalThis.layoutFinish = () =>
          resolve({
            answerText: '合成回答正文。',
            reasoningSummary: '**分析问题**\n\n先比较条件。',
            usage: null,
            sources: [],
          });
      });
    };
  });
  const login = await app.firstWindow();
  const main = await connectUiAccount(app, login);
  main.setDefaultTimeout(20000);
  main.on('pageerror', (error) => errors.push(error.message));
  await main.getByRole('textbox', { name: '聊天消息', exact: true }).fill('普通问题');
  await main.getByRole('button', { name: '发送消息', exact: true }).click();
  // A fresh request must use the modern thinking label before any public steps.
  await main.locator('.chat-activity').getByText('正在思考', { exact: true }).waitFor();
  assert.equal(await main.locator('.activity-dot').count(), 0);
  assert.equal(await main.getByText(/正在查询网页/).count(), 0);
  await app.evaluate(() => globalThis.layoutThought());
  await main.locator('.reasoning-section summary').filter({ hasText: '分析问题' }).waitFor();
  const checkDivider = async (page) => {
    const layout = await page
      .locator('.response-progress')
      .last()
      .evaluate((root) => ({
        border: parseFloat(getComputedStyle(root).borderBottomWidth),
        durationBorder: parseFloat(getComputedStyle(root.firstElementChild).borderBottomWidth),
        bottom: root.getBoundingClientRect().bottom,
        contentBottom: root.querySelector('.response-progress-content').getBoundingClientRect()
          .bottom,
      }));
    assert.ok(layout.border > 0);
    assert.equal(layout.durationBorder, 0);
    assert.ok(layout.contentBottom <= layout.bottom - layout.border);
  };
  await checkDivider(main);
  await app.evaluate(() => globalThis.layoutFinish());
  await main.getByText('合成回答正文。', { exact: true }).waitFor();
  const checkCompactDuration = async (page) => {
    await page.locator('.response-progress.is-collapsed').last().waitFor();
    const gap = await page
      .locator('.response-progress.is-collapsed')
      .last()
      .evaluate(
        (root) =>
          root.getBoundingClientRect().bottom -
          parseFloat(getComputedStyle(root).borderBottomWidth) -
          root.querySelector('.response-duration').getBoundingClientRect().bottom,
      );
    assert.ok(gap >= 0 && gap <= 9, 'Collapsed duration must stay close to its separator');
  };
  await checkCompactDuration(main);
  await main.locator('.response-progress').last().screenshot({});
  await main.locator('.duration-toggle').last().click();
  await checkDivider(main);
  checks.push(
    'chat initial thinking without old dot; public thought above separator before and after answer',
  );

  await main.getByRole('button', { name: '开始面试', exact: true }).click();
  const confirmation = main.getByRole('dialog', { name: '开始面试', exact: true });
  await confirmation.locator('.interview-start-summary > div').first().waitFor();
  const rows = await confirmation.locator('.interview-start-summary > div').evaluateAll((nodes) =>
    nodes.map((node) => {
      const box = node.getBoundingClientRect();
      return {
        title: node.querySelector('dt').textContent,
        value: node.querySelector('dd').textContent,
        x: box.x,
        y: box.y,
        width: box.width,
      };
    }),
  );
  assert.deepEqual(
    rows.map((row) => row.title),
    [
      '面试知识库',
      'AI 服务剩余用量',
      '面试官 · 系统音频',
      '面试者 · 麦克风',
      '语音模型',
      '推理设备',
      '回答模型',
      '思考强度',
    ],
  );
  for (let i = 0; i < rows.length; i += 2) {
    assert.equal(rows[i].y, rows[i + 1].y);
    assert.ok(Math.abs(rows[i].width - rows[i + 1].width) <= 1);
  }
  assert.equal(rows[4].value, '轻量语音识别');
  assert.equal(rows[5].value, 'CPU');
  assert.ok(rows[0].y < rows[2].y && rows[2].y < rows[4].y && rows[4].y < rows[6].y);
  await confirmation.screenshot({});
  checks.push(
    'start dialog: paired knowledge/AI usage, audio, actual speech/device and answer model/effort rows',
  );
  const [floating] = await Promise.all([
    app.waitForEvent('window'),
    main
      .getByRole('dialog', { name: '开始面试', exact: true })
      .getByRole('button', { name: '确认开始', exact: true })
      .click(),
  ]);
  floating.setDefaultTimeout(20000);
  floating.on('pageerror', (error) => errors.push(error.message));
  await floating.getByRole('status', { name: '语音模型：正常', exact: true }).waitFor();
  await assert.rejects(
    () => main.evaluate(() => window.desktop.setInterviewTranscriptVisible(false)),
    /Unauthorized/,
  );
  await assert.rejects(
    () => floating.evaluate(() => window.desktop.setInterviewTranscriptVisible('invalid')),
    /Invalid transcript/,
  );
  const panelBoxes = () =>
    floating.evaluate(() =>
      [...document.querySelectorAll('.floating-panel')]
        .filter((node) => node.checkVisibility())
        .map((node) => {
          const b = node.getBoundingClientRect();
          return { x: b.x, y: b.y, width: b.width, height: b.height };
        }),
    );
  const assertRatios = async () => {
    await floating.waitForFunction(
      () => !document.querySelector('.floating-shell').dataset.panelMotion,
    );
    // Await native viewport layout and its paint, rather than measuring the
    // previous frame immediately after an IPC reply.
    await floating.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
    await floating.waitForFunction(() => {
      const box = document.querySelector('.floating-answer').getBoundingClientRect();
      return Math.abs(box.width / box.height - 1.2) < 0.003;
    });
    const boxes = await panelBoxes();
    assert.ok(Math.abs(boxes.at(-1).width / boxes.at(-1).height - 1.2) < 0.003);
    if (boxes.length === 2) assert.ok(Math.abs(boxes[0].width / boxes[0].height - 0.84) < 0.003);
    return boxes;
  };
  const nativeBounds = () =>
    app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((win) => win.webContents.getURL().endsWith('#interview'))
        .getBounds(),
    );
  const initial = await assertRatios();
  for (const theme of ['light', 'dark']) {
    await floating.evaluate(
      (theme) => document.documentElement.classList.toggle('dark', theme === 'dark'),
      theme,
    );
    await floating.getByRole('button', { name: '关闭截图保护', exact: true }).click();
    const notice = floating.getByText('此窗口未隐藏', { exact: true });
    await notice.waitFor();
    assert.deepEqual(await panelBoxes(), initial, 'A notice cannot move or resize either panel');
    const placement = await notice.evaluate((node) => ({
      top: node.getBoundingClientRect().top,
      bottom: node.getBoundingClientRect().bottom,
      panelBottom: document.querySelector('.floating-panels').getBoundingClientRect().bottom,
      viewport: innerHeight,
    }));
    assert.ok(placement.top > placement.panelBottom && placement.bottom <= placement.viewport);
    await floating.screenshot({ animations: 'disabled' });
    await floating.getByRole('button', { name: '开启截图保护', exact: true }).click();
    await notice.waitFor({ state: 'hidden' });
    assert.deepEqual(await panelBoxes(), initial);
  }
  checks.push(
    'exact capture warning below unchanged panels; symmetric toolbar without native window shadow in both themes',
  );
  const bothBounds = await nativeBounds();
  await floating.getByRole('button', { name: '转写面板', exact: true }).click();
  await floating.locator('.floating-transcript').waitFor({ state: 'hidden' });
  await assertRatios();
  assert.equal(await floating.locator('.floating-panel:visible').count(), 1);
  assert.equal(
    await floating.locator('.floating-panel').count(),
    2,
    'Hidden transcript DOM is retained',
  );
  const answerOnly = (await assertRatios())[0];
  assert.ok(Math.abs(answerOnly.width - initial[1].width) < 1);
  assert.ok(Math.abs(answerOnly.height - initial[1].height) < 1);
  assert.ok((await nativeBounds()).width < bothBounds.width);
  await floating.reload();
  await floating.waitForFunction(
    () =>
      document
        .querySelector('.floating-toggle[aria-label="转写面板"]')
        ?.getAttribute('aria-pressed') === 'false',
  );
  assert.equal(
    (await floating.evaluate(() => window.desktop.interviewState())).transcriptVisible,
    false,
  );
  assert.equal(
    await floating.locator('.floating-panel:visible').count(),
    1,
    'Reload preserves hidden transcript geometry',
  );
  await floating.getByRole('button', { name: '转写面板', exact: true }).click();
  await assertRatios();
  const restored = await nativeBounds();
  assert.ok(
    Math.abs(restored.width - bothBounds.width) <= 1 && Math.abs(restored.x - bothBounds.x) <= 1,
  );
  await app.evaluate(() =>
    globalThis.layoutSpeech({
      type: 'segment',
      segment: {
        id: 'resize-reading',
        source: 'microphone',
        final: true,
        text: '窗口放大应显示更多文字，字号、工具栏和按钮保持不变。'.repeat(100),
        startMs: Date.now(),
        endMs: Date.now() + 10,
      },
    }),
  );
  await floating.locator('.transcript-item p').waitFor();
  const readingMetrics = () =>
    floating.evaluate(() => {
      const paragraph = document.querySelector('.transcript-item p');
      const scroll = paragraph.closest('.floating-scroll').getBoundingClientRect();
      const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT);
      const range = document.createRange();
      let visibleCharacters = 0;
      while (walker.nextNode()) {
        const text = walker.currentNode;
        for (let i = 0; i < text.length; i++) {
          range.setStart(text, i);
          range.setEnd(text, i + 1);
          const rect = range.getBoundingClientRect();
          if (rect.top >= scroll.top && rect.bottom <= scroll.bottom) visibleCharacters++;
        }
      }
      const box = (selector) => {
        const b = document.querySelector(selector).getBoundingClientRect();
        return { width: b.width, height: b.height };
      };
      return {
        font: getComputedStyle(paragraph).fontSize,
        lineHeight: getComputedStyle(paragraph).lineHeight,
        transform: getComputedStyle(document.querySelector('.floating-shell')).transform,
        toolbar: box('.floating-toolbar'),
        button: box('.send-button'),
        headerIcon: box('.floating-panel h2 svg'),
        visibleCharacters,
      };
    });
  const handle = floating.getByRole('button', { name: '拖动右下角调整尺寸', exact: true });
  await handle.press('ArrowDown');
  await floating.waitForFunction(
    (width) => document.querySelector('.floating-answer').getBoundingClientRect().width < width - 1,
    initial[1].width,
  );
  const smaller = await assertRatios();
  assert.ok(smaller[1].width < initial[1].width);
  const smallReading = await readingMetrics();
  await handle.press('ArrowUp');
  await floating.waitForFunction(
    (width) => document.querySelector('.floating-answer').getBoundingClientRect().width > width + 1,
    smaller[1].width,
  );
  await assertRatios();
  const largeReading = await readingMetrics();
  assert.equal(largeReading.transform, 'none');
  for (const name of ['font', 'lineHeight', 'toolbar', 'button', 'headerIcon'])
    assert.deepEqual(
      largeReading[name],
      smallReading[name],
      `${name} must stay fixed while resizing`,
    );
  assert.ok(
    largeReading.visibleCharacters > smallReading.visibleCharacters,
    'Enlarging the panels must show more actual text at the same font size',
  );
  await floating.screenshot({});
  await handle.press('ArrowDown');
  await floating.waitForFunction(
    (width) => document.querySelector('.floating-answer').getBoundingClientRect().width < width - 1,
    initial[1].width,
  );
  checks.push(
    'fixed fonts and controls; larger panels expose more actual text; fixed panel ratios through hide/reload/restore',
  );

  // Real Electron bounds and renderer pointer capture, with a controlled native
  // cursor and 30 ms handler latency to expose accidental request accumulation.
  const hb = await handle.boundingBox();
  const icons = await floating.locator('.floating-resize svg').evaluateAll((nodes) =>
    nodes.map((node) => ({
      path: node.innerHTML,
      transform: getComputedStyle(node).transform,
    })),
  );
  assert.equal(icons[0].path, icons[1].path);
  assert.equal(icons[0].transform, 'none');
  assert.equal(icons[1].transform, 'matrix(-1, 0, 0, 1, 0, 0)');
  const panelBottom = (await panelBoxes()).at(-1);
  assert.ok(
    Math.abs(hb.y + hb.height / 2 - panelBottom.y - panelBottom.height) < 2,
    'Resize handles must remain on the visible panel corners, not below the notices',
  );
  const point = { x: hb.x + hb.width / 2, y: hb.y + hb.height / 2 };
  await app.evaluate(() => {
    globalThis.layoutCursor = { x: 500, y: 500 };
    globalThis.layoutStats = { moves: 0, inFlight: 0, maximumInFlight: 0, bounds: 0 };
  });
  await floating.mouse.move(point.x, point.y);
  await floating.mouse.down();
  await floating.locator('.floating-shell.is-resizing').waitFor();
  assert.equal(
    await floating
      .locator('.floating-panel')
      .first()
      .evaluate((node) => getComputedStyle(node).backdropFilter),
    'none',
  );
  for (let step = 1; step <= 12; step++) {
    await app.evaluate((_electron, step) => {
      globalThis.layoutCursor = { x: 500 + step * 3, y: 500 + step * 2 };
    }, step);
    await floating.mouse.move(point.x + step * 3, point.y + step * 2, { steps: 10 });
  }
  await floating.mouse.up();
  await floating.locator('.floating-shell.is-resizing').waitFor({ state: 'hidden' });
  await assertRatios();
  const stats = await app.evaluate(() => globalThis.layoutStats);
  assert.equal(stats.maximumInFlight, 1, 'Native resize requests must remain serial under latency');
  assert.ok(
    stats.moves > 0 && stats.moves < 120,
    'Coalesce pointer moves rather than queue all of them',
  );
  const stable = stats.bounds;
  await floating.evaluate(async () => {
    await window.desktop.resizeInterview({ phase: 'start', edge: 'right' });
    for (let i = 0; i < 10; i++) await window.desktop.resizeInterview({ phase: 'move' });
    await window.desktop.resizeInterview({ phase: 'end' });
  });
  assert.equal(
    (await app.evaluate(() => globalThis.layoutStats)).bounds,
    stable,
    'Identical bounds never cause redundant native resizes',
  );
  checks.push(
    'pointer resize coalescing under 30ms latency; one request in flight; no redundant bounds; blur restored after drag',
  );
  await app.evaluate(() => {
    delete globalThis.layoutCursor;
  });
  const originalCursor = await app.evaluate(({ screen }) =>
    screen.dipToScreenPoint(screen.getCursorScreenPoint()),
  );
  await floating.evaluate(() => {
    window.layoutNativePointerEvents = [];
    window.addEventListener('mousemove', (event) => {
      const events = window.layoutNativePointerEvents;
      events.push({
        x: event.clientX,
        y: event.clientY,
        buttons: event.buttons,
        target: document.elementFromPoint(event.clientX, event.clientY)?.className,
      });
      if (events.length > 6) events.shift();
    });
  });
  const nativeDrags = [];
  for (const [edge, change] of [
    ['right', -0.08],
    ['left', 0.1],
  ]) {
    requireDesktop();
    await floating.bringToFront();
    const target = floating.getByRole('button', {
      name: edge === 'right' ? '拖动右下角调整尺寸' : '拖动左下角调整尺寸',
      exact: true,
    });
    const box = await target.boundingBox();
    const before = await nativeBounds();
    const boundsBefore = await app.evaluate(() => globalThis.layoutStats.bounds);
    const traceStart = await app.evaluate(() => globalThis.layoutBoundsTrace.length);
    const dipStart = {
      x: before.x + box.x + box.width / 2,
      y: before.y + box.y + box.height / 2,
    };
    const dipEnd = {
      x: dipStart.x + (edge === 'right' ? 1 : -1) * 510 * change,
      y: dipStart.y + 500 * change,
    };
    const [start, end] = await app.evaluate(
      ({ screen }, points) => points.map((p) => screen.dipToScreenPoint(p)),
      [dipStart, dipEnd],
    );
    try {
      const nativeHandle = await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()
          .find((w) => w.webContents.getURL().endsWith('#interview'))
          .getNativeWindowHandle()
          .readBigUInt64LE()
          .toString(),
      );
      await runMouse(
        nativeMouse,
        [String(Math.round(start.x)), String(Math.round(start.y)), '0', '0', 'restore'],
        { windowsHide: true },
      );
      // SetCursorPos alone can leave a transparent Electron window without a
      // forwarded mousemove. Send the same native move used by the hover check
      // before waiting for click-through to turn off. No press occurs here.
      probe('move', Math.round(start.x) + 1, Math.round(start.y));
      const readyDeadline = performance.now() + 5000;
      while (probe('window', nativeHandle, path.resolve('public/voxcue.ico')).extendedStyle & 32) {
        if (performance.now() > readyDeadline) {
          console.error(
            JSON.stringify({
              edge,
              before,
              box,
              start,
              originalCursor,
              pointerEvents: await floating.evaluate(() => window.layoutNativePointerEvents),
              cursor: probe('cursor'),
              hit: probe('hit', nativeHandle, Math.round(start.x), Math.round(start.y)),
              viewport: await floating.evaluate(() => ({
                width: innerWidth,
                height: innerHeight,
                x: screenX,
                y: screenY,
                focused: document.hasFocus(),
                resizing: document.querySelector('.floating-shell')?.className,
              })),
              current: await nativeBounds(),
            }),
          );
          throw Error('Resize corner did not become native-interactive');
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      probe('move', Math.round(start.x) + 1, Math.round(start.y));
      await target.evaluate(
        (element) =>
          new Promise((resolve, reject) => {
            const deadline = performance.now() + 5000;
            const poll = () =>
              getComputedStyle(element).opacity === '1'
                ? resolve()
                : performance.now() > deadline
                  ? reject(Error('Resize hover did not settle'))
                  : requestAnimationFrame(poll);
            poll();
          }),
      );
      const hitDeadline = performance.now() + 5000;
      while (!probe('hit', nativeHandle, Math.round(start.x), Math.round(start.y)).expected) {
        if (performance.now() > hitDeadline) {
          console.error(
            JSON.stringify({
              before,
              box,
              start,
              cursor: probe('cursor'),
              viewport: await floating.evaluate(() => ({
                width: innerWidth,
                height: innerHeight,
                x: screenX,
                y: screenY,
              })),
              current: await nativeBounds(),
            }),
          );
          throw Error('Resize corner did not acquire native hit testing');
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      await captureRequested(target, 'resize-' + edge);
      if (edge === 'left') await captureRequested(floating, 'interview-resize-corners');
      const mouseRun = await runMouse(
        nativeMouse,
        [
          String(Math.round(start.x)),
          String(Math.round(start.y)),
          String(Math.round(end.x - start.x)),
          String(Math.round(end.y - start.y)),
          'drag',
          nativeHandle,
        ],
        { windowsHide: true },
      );
      requireDesktop();
      await floating.locator('.floating-shell.is-resizing').waitFor({ state: 'hidden' });
      const after = await nativeBounds();
      const resizeUpdates =
        (await app.evaluate(() => globalThis.layoutStats.bounds)) - boundsBefore;
      assert.ok(
        resizeUpdates >= 3,
        'Native bounds must update during the gesture, not only on release',
      );
      const frames = await app.evaluate(
        (_electron, start) => globalThis.layoutBoundsTrace.slice(start),
        traceStart,
      );
      for (const frame of frames) {
        assert.ok(
          Math.abs(frame.x + frame.width / 2 - before.x - before.width / 2) <= 1,
          'Toolbar center must stay fixed throughout the gesture',
        );
        assert.equal(frame.y, before.y, 'Toolbar top must stay fixed throughout the gesture');
      }
      assert.ok(
        edge === 'right' ? after.width < before.width - 3 : after.width > before.width + 3,
        'Actual Windows mouse drag must change the native window size',
      );
      await assertRatios();
      assert.ok(Math.abs(after.y - before.y) <= 1, 'Top stays fixed during a corner drag');
      assert.ok(
        Math.abs(after.x + after.width / 2 - before.x - before.width / 2) <= 1,
        'Toolbar center stays fixed during a drag',
      );
      const endBox = await target.boundingBox();
      const cursor = await app.evaluate(({ screen }) => screen.getCursorScreenPoint());
      const nativeCursor = probe('cursor');
      // getCursorScreenPoint rounds DIP coordinates at fractional Windows DPI.
      // Compare physical points first so that readback rounding is not counted
      // as an extra drag error. Keep the original three-DIP accuracy limit.
      const corner = await app.evaluate(
        ({ screen }, point) => ({
          physical: screen.dipToScreenPoint(point),
          scale: screen.getDisplayNearestPoint(point).scaleFactor,
        }),
        { x: after.x + endBox.x + endBox.width / 2, y: after.y + endBox.y + endBox.height / 2 },
      );
      const distance =
        Math.hypot(corner.physical.x - nativeCursor.x, corner.physical.y - nativeCursor.y) /
        corner.scale;
      assert.ok(
        distance <= 3,
        `Dragged corner must follow the actual cursor within DPI rounding: ${JSON.stringify({ edge, before, after, cursor, nativeCursor, corner, dipStart, dipEnd, start, end, endBox, frames: frames.slice(-4), viewport: await floating.evaluate(() => ({ width: innerWidth, height: innerHeight, ratio: devicePixelRatio })), mouseOutput: mouseRun.stdout, distance, resizeUpdates })}`,
      );
      nativeDrags.push({ edge, before, after, resizeUpdates, cursorDistance: distance });
    } finally {
      await runMouse(
        nativeMouse,
        [String(originalCursor.x), String(originalCursor.y), '0', '0', 'restore'],
        { windowsHide: true },
      );
    }
  }
  checks.push(
    'actual Windows mouse: both corners track the cursor around the fixed toolbar; release ends gesture; mirrored icons',
  );
  const visibleAnswer = (await panelBoxes()).at(-1);
  await floating.getByRole('button', { name: '转写面板', exact: true }).click();
  await floating.waitForFunction(
    () =>
      !document.querySelector('.floating-shell').dataset.panelMotion &&
      [...document.querySelectorAll('.floating-panel')].filter((node) => node.checkVisibility())
        .length === 1,
  );
  await floating.waitForFunction(
    (width) =>
      Math.abs(document.querySelector('.floating-answer').getBoundingClientRect().width - width) <=
      1,
    visibleAnswer.width,
  );
  const hiddenStart = await assertRatios();
  assert.ok(Math.abs(hiddenStart[0].width - visibleAnswer.width) <= 1);
  await handle.press('ArrowDown');
  await floating.waitForFunction(
    (width) => document.querySelector('.floating-answer').getBoundingClientRect().width < width - 1,
    hiddenStart[0].width,
  );
  const hiddenSmall = (await assertRatios())[0];
  const hiddenBounds = await nativeBounds();
  await floating.getByRole('button', { name: '收起面试窗口', exact: true }).click();
  await floating.waitForFunction(
    () =>
      document.querySelector('.floating-shell').classList.contains('is-collapsed') &&
      !document.querySelector('.floating-shell').dataset.panelMotion,
  );
  await floating.getByRole('button', { name: '展开面试窗口', exact: true }).click();
  await assertRatios();
  const expandedBounds = await nativeBounds();
  assert.ok(Math.abs(expandedBounds.width - hiddenBounds.width) <= 1);
  assert.ok(Math.abs(expandedBounds.height - hiddenBounds.height) <= 1);
  assert.ok(
    Math.abs(
      expandedBounds.x + expandedBounds.width / 2 - hiddenBounds.x - hiddenBounds.width / 2,
    ) <= 1,
  );
  assert.equal(expandedBounds.y, hiddenBounds.y);
  await floating.getByRole('button', { name: '转写面板', exact: true }).click();
  const shownAgain = await assertRatios();
  assert.ok(Math.abs(shownAgain.at(-1).width - hiddenSmall.width) <= 1);
  assert.ok(Math.abs(shownAgain.at(-1).height - hiddenSmall.height) <= 1);
  checks.push(
    'answer-only resize and collapse/expand preserve panel size, aspect ratio and toolbar anchor',
  );
  await floating.getByRole('button', { name: '关闭截图保护', exact: true }).click();
  await floating.getByRole('textbox', { name: '面试提问', exact: true }).fill('面试普通问题');
  await floating.getByRole('button', { name: '发送面试问题', exact: true }).click();
  await floating.locator('.chat-activity').getByText('正在思考', { exact: true }).waitFor();
  assert.equal(await floating.locator('.activity-dot').count(), 0);
  await app.evaluate(() => globalThis.layoutThought());
  await floating.locator('.reasoning-section summary').filter({ hasText: '分析问题' }).waitFor();
  await checkDivider(floating);
  await app.evaluate(() => globalThis.layoutFinish());
  await floating.getByText('合成回答正文。', { exact: true }).waitFor();
  await checkCompactDuration(floating);
  await floating.locator('.response-progress').screenshot({});
  await floating.locator('.duration-toggle').click();
  await checkDivider(floating);
  await floating.screenshot({ animations: 'disabled' });
  checks.push('interview shares modern progress component and public-summary disclosure');
  assert.deepEqual(errors, []);
  const result = {
    passed: true,
    profile,
    checks,
    resize: stats,
    reading: { small: smallReading, large: largeReading },
    nativeDrags,
    errors,
    liveAccount: false,
    nativeAudio: false,
    nativeCursorSimulated: true,
    actualWindowsMouseDrags: 2,
    resizeLatencyInjectedMs: 30,
  };
  await console.log(JSON.stringify(result, null, 2));
  console.log(result);
} catch (error) {
  await writeFile(
    path.join(profile, 'failure.json'),
    JSON.stringify(
      {
        message: String(error),
        renderer: await Promise.all(
          app
            .windows()
            .filter((page) => page.url().endsWith('#interview'))
            .map((page) =>
              page.evaluate(() => ({
                viewport: { width: innerWidth, height: innerHeight },
                panels: [...document.querySelectorAll('.floating-panel')].map((node) => ({
                  width: node.getBoundingClientRect().width,
                  height: node.getBoundingClientRect().height,
                })),
              })),
            ),
        ),
        native: await app.evaluate(({ BrowserWindow, screen }) => ({
          trace: globalThis.layoutBoundsTrace,
          stats: globalThis.layoutStats,
          windows: BrowserWindow.getAllWindows().map((win) => ({
            bounds: win.getBounds(),
            url: win.webContents.getURL(),
          })),
          displays: screen
            .getAllDisplays()
            .map((display) => ({ workArea: display.workArea, scaleFactor: display.scaleFactor })),
        })),
      },
      null,
      2,
    ),
  );
  for (const page of app.windows()) {
    if (page.url().endsWith('#interview')) await page.screenshot({});
  }
  console.error(error);
  throw error;
} finally {
  await app.evaluate(({ BrowserWindow }) => {
    for (const win of BrowserWindow.getAllWindows()) win.destroy();
  });
  await closeUiApp(app);
}
