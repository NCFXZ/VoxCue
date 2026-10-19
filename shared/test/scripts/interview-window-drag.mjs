import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import workspace from '../../scripts/workspace.mjs';

const nativeProbe =
  process.platform === 'win32'
    ? (
        await import(
          pathToFileURL(path.join(workspace.platformRoot, 'test/scripts/window-probe.mjs')).href
        )
      ).probe
    : undefined;

// Only cursor input is synthetic. Pointer capture, preload, IPC and BrowserWindow
// movement run through the production path in this runner's isolated process.
export async function exerciseInterviewWindowDrag(app, page) {
  const native = () =>
    app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((w) => w.webContents.getURL().endsWith('#interview'))
        .getBounds(),
    );
  const before = await native();
  const originalCursor = nativeProbe?.('cursor');
  await app.evaluate(({ screen, ipcMain, BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) =>
      w.webContents.getURL().endsWith('#interview'),
    );
    const cursor = screen.getCursorScreenPoint.bind(screen);
    const move = win.setPosition.bind(win);
    const bounds = win.setBounds.bind(win);
    const handler = ipcMain._invokeHandlers.get('interview:move');
    const passthrough = win.setIgnoreMouseEvents.bind(win);
    globalThis.gripTest = { cursor: cursor(), phases: [], moves: 0, completed: 0, ignored: [] };
    win.setIgnoreMouseEvents = (ignore, ...args) => {
      globalThis.gripTest.ignored.push(ignore);
      return passthrough(ignore, ...args);
    };
    screen.getCursorScreenPoint = () => ({ ...globalThis.gripTest.cursor });
    win.setPosition = (...args) => {
      globalThis.gripTest.moves++;
      return move(...args);
    };
    win.setBounds = (...args) => {
      globalThis.gripTest.moves++;
      return bounds(...args);
    };
    ipcMain._invokeHandlers.set('interview:move', (event, ...args) => {
      globalThis.gripTest.phases.push(args[0]?.phase);
      if (args[0]?.phase === 'start') globalThis.gripTest.startBounds = win.getBounds();
      const result = handler(event, ...args);
      return Promise.resolve(result).then((value) => {
        if (args[0]?.phase === 'move') globalThis.gripTest.completed++;
        return value;
      });
    });
    globalThis.restoreGripTest = () => {
      screen.getCursorScreenPoint = cursor;
      win.setPosition = move;
      win.setBounds = bounds;
      win.setIgnoreMouseEvents = passthrough;
      ipcMain._invokeHandlers.set('interview:move', handler);
    };
  });
  const until = async (predicate, label, arg) => {
    const deadline = performance.now() + 5000;
    while (performance.now() < deadline) {
      if (await app.evaluate(predicate, arg)) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw Error(label);
  };
  await page.evaluate(() => {
    window.dragEvents = [];
    for (const type of [
      'pointerdown',
      'pointerup',
      'pointercancel',
      'mousedown',
      'mouseup',
      'mousemove',
      'blur',
    ])
      window.addEventListener(
        type,
        (e) => {
          window.dragEvents.push({
            type,
            buttons: e.buttons,
            x: e.screenX,
            y: e.screenY,
            wx: screenX,
            wy: screenY,
            target: e.target?.className,
          });
          if (window.dragEvents.length > 30) window.dragEvents.shift();
        },
        true,
      );
  });
  try {
    if (nativeProbe) {
      // CDP holds a synthetic button without moving the OS cursor. If the moved
      // transparent HWND crosses that cursor, Windows forwards a real buttons=0
      // move and correctly ends the gesture. Keep that unrelated cursor outside
      // the tested window's movement envelope; native input has its own suite.
      const parked = await app.evaluate(({ screen }, bounds) => {
        const display = screen.getDisplayMatching(bounds).workArea;
        const candidates = [
          { x: display.x + 2, y: display.y + 2 },
          { x: display.x + display.width - 2, y: display.y + 2 },
          { x: display.x + 2, y: display.y + display.height - 2 },
          { x: display.x + display.width - 2, y: display.y + display.height - 2 },
        ];
        const point = candidates.find(
          ({ x, y }) =>
            x < bounds.x - 128 ||
            y < bounds.y - 128 ||
            x > bounds.x + bounds.width + 128 ||
            y > bounds.y + bounds.height + 128,
        );
        if (!point) throw Error('Synthetic drag needs an OS cursor outside its movement envelope');
        return screen.dipToScreenPoint(point);
      }, before);
      nativeProbe('move', parked.x, parked.y);
    }
    const grip = page.locator('.floating-drag-handle');
    assert.equal(
      await grip.evaluate((e) => getComputedStyle(e).webkitAppRegion),
      'no-drag',
      'The grip needs ordinary pointer events, including while native passthrough is enabled',
    );
    const box = await grip.boundingBox();
    const x = box.x + box.width / 2,
      y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await until(
      () => globalThis.gripTest.phases.includes('start'),
      'Grip did not start a window gesture',
    );
    await app.evaluate(() => {
      globalThis.gripTest.cursor.x += 48;
      globalThis.gripTest.cursor.y += 35;
    });
    await page.mouse.move(x + 16, y + 12);
    await until(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find((w) =>
        w.webContents.getURL().endsWith('#interview'),
      );
      return globalThis.gripTest.completed > 0 && win.getBounds().x !== undefined;
    }, 'Grip did not reach native window movement');
    const expectedPosition = await app.evaluate(
      ({ screen }, point) => {
        if (process.platform !== 'win32') return point;
        // HWND origins occupy physical pixels. Electron reads their DIP bounds
        // with a floored origin; e.g. y=191 at 175% maps back to y=190.
        const resolved = screen.screenToDipPoint(screen.dipToScreenPoint(point));
        return { x: Math.floor(resolved.x), y: Math.floor(resolved.y) };
      },
      { x: before.x + 48, y: before.y + 35 },
    );
    assert.deepEqual(
      await native(),
      { ...before, ...expectedPosition },
      'Dragging must move the real native window without resizing the panels',
    );
    const previousMoves = await app.evaluate(() => globalThis.gripTest.moves);
    await page.mouse.move(x + 20, y + 15);
    await until(
      () => globalThis.gripTest.phases.filter((p) => p === 'move').length >= 2,
      'Stationary-cursor regression did not reach the native route',
    );
    assert.equal(
      await app.evaluate(() => globalThis.gripTest.moves),
      previousMoves,
      'The same native cursor position must not issue another setPosition',
    );
    await page.mouse.up();
    await until(
      () => globalThis.gripTest.phases.includes('end'),
      'Pointer release did not finish dragging',
    );
    const finished = await native();
    await app.evaluate(() => {
      globalThis.gripTest.cursor.x += 100;
      globalThis.gripTest.cursor.y += 100;
    });
    await page.evaluate(() => window.desktop.moveInterviewWindow({ phase: 'move' }));
    assert.deepEqual(
      await native(),
      finished,
      'Late movement after release must not move the window',
    );
    for (const event of ['pointercancel', 'blur']) {
      const nextGrip = await grip.boundingBox();
      const ended = await app.evaluate(
        () => globalThis.gripTest.phases.filter((p) => p === 'end').length,
      );
      await page.mouse.move(nextGrip.x + nextGrip.width / 2, nextGrip.y + nextGrip.height / 2);
      await page.mouse.down();
      await page.evaluate(
        (event) =>
          window.dispatchEvent(
            event === 'pointercancel' ? new PointerEvent(event) : new Event(event),
          ),
        event,
      );
      await until(
        (_electron, ended) => globalThis.gripTest.phases.filter((p) => p === 'end').length > ended,
        'A cancelled or unfocused drag must finish',
        ended,
      );
      await page.mouse.up();
      const stopped = await native();
      await app.evaluate(() => {
        globalThis.gripTest.cursor.x += 12;
        globalThis.gripTest.cursor.y += 9;
      });
      await page.evaluate(() => window.desktop.moveInterviewWindow({ phase: 'move' }));
      assert.deepEqual(await native(), stopped, event + ' must stop native window movement');
      assert.ok(
        (await app.evaluate(() => globalThis.gripTest.phases.filter((p) => p === 'end').length)) >
          ended,
      );
    }
    await page.mouse.move(2, 2);
    await until(
      () => globalThis.gripTest.ignored.at(-1) === true,
      'Blank canvas must regain mouse passthrough after dragging ends',
    );
    await page.reload();
    await page.locator('.floating-drag-handle').waitFor();
    const reloaded = await native();
    await page.evaluate(() => window.desktop.moveInterviewWindow({ phase: 'move' }));
    assert.deepEqual(await native(), reloaded, 'Reload cannot retain an old drag session');
    assert.equal(
      await app.evaluate(({ ipcMain, BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows().find((w) =>
          w.webContents.getURL().endsWith('#interview'),
        );
        try {
          ipcMain._invokeHandlers.get('interview:move')(
            { sender: win.webContents, senderFrame: {} },
            { phase: 'start' },
          );
          return false;
        } catch {
          return true;
        }
      }),
      true,
      'Subframes cannot start moving the interview window',
    );
    for (const change of [{ phase: 'start', x: 50 }, { phase: 'execute' }, {}, null, ['start']]) {
      assert.equal(
        await page.evaluate(async (change) => {
          try {
            await window.desktop.moveInterviewWindow(change);
            return false;
          } catch {
            return true;
          }
        }, change),
        true,
        'Untrusted move fields must be rejected',
      );
    }
  } catch (error) {
    console.log(
      'Drag diagnostic (synthetic input only):',
      JSON.stringify({
        native: await app.evaluate(() => globalThis.gripTest),
        events: await page.evaluate(() => window.dragEvents),
      }),
    );
    throw error;
  } finally {
    await page.mouse.up().catch(() => {});
    await page.evaluate(() => window.desktop.moveInterviewWindow({ phase: 'end' })).catch(() => {});
    try {
      await app.evaluate(({ BrowserWindow }, bounds) => {
        globalThis.restoreGripTest();
        BrowserWindow.getAllWindows()
          .find((w) => w.webContents.getURL().endsWith('#interview'))
          .setBounds(bounds);
        delete globalThis.gripTest;
        delete globalThis.restoreGripTest;
      }, before);
    } finally {
      if (nativeProbe && originalCursor) nativeProbe('move', originalCursor.x, originalCursor.y);
    }
  }
}
