import { fileURLToPath } from 'node:url';
import { realpathSync } from 'node:fs';
import { once } from 'node:events';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import assert from 'node:assert/strict';
import { testRoot, spawnTestProcess } from '../../../shared/test/scripts/test-workspace.mjs';

assert.equal(process.platform, 'win32');
const executable = path.join(testRoot, 'WindowProbe.exe');
const framework = path.join(process.env.WINDIR, 'Microsoft.NET/Framework64/v4.0.30319');
const compiled = spawnSync(
  path.join(framework, 'csc.exe'),
  [
    '/nologo',
    '/platform:x64',
    '/target:winexe',
    '/r:System.Drawing.dll',
    '/r:System.Web.Extensions.dll',
    ...['UIAutomationClient', 'UIAutomationTypes', 'WindowsBase'].map(
      (name) => '/r:' + path.join(framework, 'WPF', name + '.dll'),
    ),
    '/out:' + executable,
    fileURLToPath(new URL('../fixtures/WindowProbe.cs',import.meta.url)),
  ],
  { encoding: 'utf8', windowsHide: true, timeout: 30000 },
);
assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr);
export function probe(...args) {
  const result = spawnSync(executable, args.map(String), {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 15000,
  });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  return JSON.parse(result.stdout);
}

const quietInputMs = 450;

async function waitForQuietMatrixCursor() {
  const deadline = performance.now() + 2500;
  let previous, stillSince;
  while (performance.now() < deadline) {
    // Each sample independently checks the unlocked owner console in WindowProbe.
    const current = probe('cursor-activity');
    const now = performance.now();
    if (current.buttonDown || current.x !== previous?.x || current.y !== previous?.y)
      stillSince = now;
    if (!current.buttonDown && current.idleMs >= quietInputMs && now - stillSince >= quietInputMs)
      return current;
    previous = current;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw Error('Windows matrix cursor did not settle on the unlocked owner desktop; stopping before moving it.');
}

export async function parkMatrixCursor() {
  for (let attempt = 0; attempt < 2; attempt++) {
    const current = await waitForQuietMatrixCursor();
    if (current.x === 0 && current.y === 0) return;
    try {
      if (!probe('move', 0, 0, 'if-quiet', current.x, current.y, current.inputTick).skipped) return;
    } catch (error) {
      const displaced = error.message.includes('Native pointer position changed during the isolated check: expected 0,0; actual') ||
        error.message.includes('Injected native cursor movement was not observed before the deadline');
      if (!displaced) throw error;
      if (attempt === 1)
        throw Error('Windows matrix cursor parking was interrupted again; stopping.', { cause: error });
    }
    if (attempt === 0)
      console.warn('Windows matrix cursor parking was interrupted; waiting for quiet input before one retry.');
  }
  throw Error('Input resumed before the Windows matrix cursor could be parked; stopping.');
}

export function restoreParkedMatrixCursor(original) {
  if (original.x === 0 && original.y === 0) return;
  const current = probe('cursor-activity');
  if (current.x === 0 && current.y === 0 && !current.buttonDown && current.idleMs >= quietInputMs)
    probe('move', original.x, original.y, 'if-quiet', current.x, current.y, current.inputTick);
}

async function activateThroughOwnedCaption(app, target, pid) {
  const id = await target.evaluate((win) => win.id);
  const helper = await app.evaluateHandle(({ BrowserWindow, screen }, id) => {
    const win = BrowserWindow.fromId(id);
    if (!win?.isVisible() || win.isMinimized() || !win.isFocusable())
      throw Error('Owned Windows test window cannot receive focus');
    const area = screen.getDisplayMatching(win.getBounds()).workArea;
    const helper = new BrowserWindow({
      parent: win, frame: true, show: false, skipTaskbar: true, resizable: false,
      minimizable: false, maximizable: false, closable: false, autoHideMenuBar: true,
      title: 'VoxCue', x: area.x + 16, y: area.y + 16, width: 220, height: 64,
      webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
    });
    helper.setMenu(null);
    helper.setAlwaysOnTop(true, 'normal');
    helper.showInactive();
    helper.moveTop();
    return helper;
  }, id);
  try {
    const handle = await helper.evaluate((win) => win.getNativeWindowHandle().readBigUInt64LE().toString());
    const attempt = probe('focus-owned', handle, pid, 'caption');
    const until = performance.now() + 750;
    do {
      const foreground = probe('foreground');
      if (foreground.processId === pid && foreground.handle === handle) {
        await target.evaluate((win) => { win.moveTop(); win.focus(); win.webContents.focus(); });
        return { activated: true, caption: attempt.caption };
      }
      await new Promise((resolve) => setTimeout(resolve, 30));
    } while (performance.now() < until);
    return { activated: false, caption: attempt.caption };
  } finally {
    try { await helper.evaluate((win) => { if (!win.isDestroyed()) win.destroy(); }); }
    finally { await helper.dispose(); }
  }
}

export async function focusOwnedWindow(app, page, developmentHost) {
  const host = await app.evaluate(({ app }) => ({
    executable: app.getPath('exe'), profile: app.getPath('userData'), pid: process.pid, parentPid: process.ppid,
  }));
  const relative = path.relative(realpathSync(testRoot), realpathSync(host.profile));
  assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
  assert.equal(path.relative(realpathSync(developmentHost), realpathSync(host.executable)), '');
  // Playwright launches Windows Electron with shell:true. Its ChildProcess is
  // the command shell, whose direct child is the Electron browser process.
  assert.equal(host.parentPid, app.process().pid, 'Electron must be the owned launcher’s direct child');
  const target = await app.browserWindow(page);
  let raised = false;
  try {
    const handle = await target.evaluate((win) => win.getNativeWindowHandle().readBigUInt64LE().toString());
    probe('geometry', handle, host.pid);
    const until = performance.now() + 4000;
    let last, captionAttempt, helperAttempt;
    do {
      const native = probe('focus-owned', handle, host.pid);
      const renderer = await page.evaluate(() => ({
        focused: document.hasFocus(), visibility: document.visibilityState,
      }));
      if (native.foregroundHandle === handle && native.foregroundPid === host.pid &&
          renderer.focused && renderer.visibility === 'visible') {
        if (!raised) return;
        await target.evaluate((win) => win.setAlwaysOnTop(false));
        raised = false;
        continue;
      }
      last = { targetHandle: handle, targetPid: host.pid, native, renderer, captionAttempt, helperAttempt };
      if (native.foregroundHandle !== handle && captionAttempt === undefined) {
        if (!(await target.evaluate((win) => win.isAlwaysOnTop()))) {
          await target.evaluate((win) => win.setAlwaysOnTop(true, 'normal'));
          raised = true;
        }
        await target.evaluate((win) => win.moveTop());
        captionAttempt = probe('focus-owned', handle, host.pid, 'caption');
      } else if (native.foregroundHandle !== handle && captionAttempt && !captionAttempt.caption &&
                 helperAttempt === undefined) {
        // The floating canvas has no native caption. Its same-process helper is
        // destroyed before testing the final frontmost HWND and renderer again.
        helperAttempt = await activateThroughOwnedCaption(app, target, host.pid);
      }
      await target.evaluate((win) => {
        if (!win.isVisible() || win.isMinimized() || !win.isFocusable())
          throw Error('Owned Windows test window cannot receive focus');
        win.focus();
        win.webContents.focus();
      });
      await new Promise((resolve) => setTimeout(resolve, 50));
    } while (performance.now() < until);
    throw Error('Owned Windows HWND and renderer did not acquire foreground focus: ' + JSON.stringify(last));
  } finally {
    if (raised) await target.evaluate((win) => { if (!win.isDestroyed()) win.setAlwaysOnTop(false); });
    await target.dispose();
  }
}

// Wait for both Chromium layout and the actual DIP-to-screen projection after resize/DPI transitions.
export async function stableTarget(locator, project) {
  let previous='', stable=0, last;
  const end=performance.now()+5000;
  do {
    assert.equal(probe('desktop').interactive,true,'Native input requires an unlocked desktop');
    const box=await locator.boundingBox();
    if(box) {
      const point=await project(box),key=JSON.stringify({box,point});
      stable=key===previous?stable+1:0;previous=key;last={box,point};
      if(stable>=3) return point;
    } else {stable=0;previous='';}
    await new Promise(resolve=>setTimeout(resolve,40));
  } while(performance.now()<end);
  throw Error('Native target did not stabilize: '+JSON.stringify(last));
}

export async function pointAtOwnedControl(application, locator, hover, developmentHost, freshEntry = false) {
  const page = locator.page();
  await focusOwnedWindow(application, page, developmentHost);
  const win = await application.browserWindow(page);
  let target;
  try {
    target = await win.evaluate((window) => ({
      handle: window.getNativeWindowHandle().readBigUInt64LE().toString(), pid: process.pid,
    }));
  } finally { await win.dispose(); }
  const until = performance.now() + 3000;
  let last, enterFromOutside = freshEntry && hover;
  do {
    const entering = enterFromOutside;
    enterFromOutside = false;
    const view = await locator.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const x=rect.x + rect.width/2, y=rect.y + rect.height/2;
      const visible = (points, inside) => points.filter(({x,y}) => {
        const hit=document.elementFromPoint(x,y);
        return hit && element.contains(hit) === inside;
      });
      const inside=visible([
        {x,y}, {x:x-rect.width/4,y}, {x:x+rect.width/4,y},
        {x,y:y-rect.height/4}, {x,y:y+rect.height/4},
      ], true);
      const outside=visible([
        {x:rect.left-12,y}, {x:rect.right+12,y}, {x,y:rect.top-12}, {x,y:rect.bottom+12},
        {x:innerWidth/2,y:innerHeight/2}, {x:innerWidth/3,y:innerHeight/3},
      ], false);
      return { inside, outside, width: innerWidth, height: innerHeight, dpr: devicePixelRatio, rect: rect.toJSON() };
    });
    const geometry = probe('geometry', target.handle, target.pid);
    const move = (candidates, phase) => {
      assert.ok(candidates.length, phase + ': no visible renderer hit');
      const physical=candidates.map(point=>({
        x: geometry.clientX + Math.round(point.x * geometry.clientWidth / view.width),
        y: geometry.clientY + Math.round(point.y * geometry.clientHeight / view.height),
      }));
      const projection = { phase, rect: view.rect, viewport: [view.width, view.height], dpr: view.dpr,
        client: [geometry.clientX, geometry.clientY, geometry.clientWidth, geometry.clientHeight], candidates, physical };
      try {
        const {index}=probe('hover-candidate',target.handle,target.pid,...physical.flatMap(p=>[p.x,p.y]));
        assert.ok(Number.isInteger(index) && index>=0 && index<physical.length, 'No candidate has both physical pixels on the owned window');
        const {x,y}=physical[index];
        // Recheck native ownership before and after input independently of the read-only selection.
        probe('hover-owned',x,y,target.handle,target.pid);
        return {x,y,point:candidates[index]};
      } catch (cause) {
        throw Error(cause.message + '\nOwned window projection: ' + JSON.stringify(projection), { cause });
      }
    };
    if (entering) {
      move(view.outside, 'fresh-entry-outside');
    }
    const { x, y, point } = move(hover ? view.inside : view.outside, hover ? 'hover-target' : 'leave-target');
    const state = () => locator.evaluate((element) => ({
      hovered: element.matches(':hover'), focused: document.hasFocus(),
    }));
    last = await state();
    if (last.focused && last.hovered !== hover) {
      // A replaced control can retain the previous node's compositor hit region.
      // Synchronize Chromium at the same verified physical pixel, never by
      // forcing a pseudo-class or dispatching a DOM event.
      await page.mouse.move(point.x, point.y);
      last = await state();
      probe('pointer-owned', x, y, target.handle, target.pid);
    }
    if (last.hovered === hover && last.focused) return { ...target, x, y };
    last = { ...last, view, geometry, physical: { x, y } };
  } while (performance.now() < until);
  throw Error('Native pointer and renderer hover disagree: ' + JSON.stringify(last));
}

export const probeExecutable = executable;

async function holdProbe(args, expected, label) {
  const child=spawnTestProcess(probeExecutable,args,{stdio:['pipe','pipe','pipe'],windowsHide:true});
  let failure='';child.stderr.on('data',chunk=>failure+=chunk);
  const timer=setTimeout(()=>child.kill('SIGTERM'),10000);
  try {
    const data=await Promise.race([once(child.stdout,'data').then(([value])=>value),once(child,'exit').then(()=>{throw Error(label+' could not start: '+failure);})]);
    assert.deepEqual(JSON.parse(data),expected);
  } catch(error) {child.kill('SIGTERM');throw error;}
  finally {clearTimeout(timer);}
  let releasing;
  return () => releasing ??= (async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const exit = once(child, 'exit');
      child.stdin.end();
      await exit;
    }
  })();
}
export const holdExclusiveFiles = (files) => holdProbe(['hold-file',...files],{holding:true},'Exclusive guard');
export async function holdDesktopAwake() {
  assert.equal(probe('desktop').interactive,true,'A power request requires the unlocked owner console');
  return holdProbe(['hold-awake'],{awake:true},'Desktop awake guard');
}
