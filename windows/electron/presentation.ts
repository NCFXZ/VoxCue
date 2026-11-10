import { nativeTheme, screen } from 'electron';
import type { BrowserWindow, Rectangle } from 'electron';
import type { NativePresentation } from '../../shared/electron/presentation';

function applyInterviewBounds(win: BrowserWindow, bounds: Rectangle) {
  // Predict the HWND's enclosing-pixel round trip before changing it. A
  // second corrective resize would expose a shifted frame at fractional DPI.
  const rounded = screen.screenToDipRect(win, screen.dipToScreenRect(win, bounds));
  // Round the extent at the display origin. Enclosing a fractional top/left
  // twice also expands its extent; keep that separate from positional error.
  const origin = screen.getDisplayMatching(bounds).bounds;
  const extent = screen.screenToDipRect(
    win,
    screen.dipToScreenRect(win, { ...bounds, x: origin.x, y: origin.y }),
  );
  win.setBounds(
    {
      x: 2 * bounds.x - rounded.x,
      y: 2 * bounds.y - rounded.y,
      width: 2 * bounds.width - extent.width,
      height: 2 * bounds.height - extent.height,
    },
    false,
  );
}

/** Applies only to this application's HWNDs; never changes shell preferences. */
export function createPresentation(options: {
  icon: string;
  interviewOpen(): boolean;
}): NativePresentation {
  const hidden = new Set<BrowserWindow>();
  let interview: BrowserWindow | undefined;
  return {
    fixedInterviewCanvas: true,
    capabilities: Object.freeze({
      frostedTransparency: Number(process.getSystemVersion().split('.')[2]) >= 22621,
      nativeTheme: true,
      screenCapturePermission: true,
      interviewMousePassthrough: true,
      interviewIconVisibility: true,
    }),
    initialize() {},
    setTheme: (theme) => {
      nativeTheme.themeSource = theme;
    },
    resizeInterview: applyInterviewBounds,
    moveInterview: applyInterviewBounds,
    pinInterview(win) {
      // Chromium can retain a floating level after Windows has demoted the
      // HWND behind the taskbar. Reset that stale level before restoring it.
      if (!win.isAlwaysOnTop()) win.setAlwaysOnTop(false, 'normal');
      win.setAlwaysOnTop(true, 'normal');
    },
    prepareInterview(win) {
      interview = win;
      win.setIcon(options.icon);
      const keepHidden = () => {
        if (options.interviewOpen() && !win.isDestroyed()) win.setSkipTaskbar(true);
      };
      keepHidden();
      win.on('show', keepHidden);
      win.on('restore', keepHidden);
    },
    hideMain(win) {
      hidden.add(win);
      win.setSkipTaskbar(true);
      win.hide();
    },
    hideInterviewIcon() {
      if (!options.interviewOpen()) return;
      if (interview && !interview.isDestroyed()) interview.setSkipTaskbar(true);
      for (const win of hidden) if (!win.isDestroyed()) win.setSkipTaskbar(true);
    },
    async restoreInterviewIcon() {
      if (options.interviewOpen()) return;
      interview = undefined;
      for (const win of hidden) {
        if (win.isDestroyed()) continue;
        win.setIcon(options.icon);
        win.setSkipTaskbar(false);
      }
      hidden.clear();
    },
    setMousePassthrough: (win, ignore) => win.setIgnoreMouseEvents(ignore, { forward: true }),
    dispose() {
      hidden.clear();
      interview = undefined;
    },
  };
}
