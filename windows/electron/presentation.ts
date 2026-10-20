import { nativeTheme } from 'electron';
import type { BrowserWindow } from 'electron';
import type { NativePresentation } from '../../shared/electron/presentation';

/** Applies only to this application's HWNDs; never changes shell preferences. */
export function createPresentation(options: {
  icon: string;
  interviewOpen(): boolean;
}): NativePresentation {
  const hidden = new Set<BrowserWindow>();
  let interview: BrowserWindow | undefined;
  return {
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
    moveInterview(win, bounds) {
      // setPosition reads rounded DIP dimensions back into setBounds. At
      // fractional DPI that can enlarge a transparent HWND on every move.
      // Keep the gesture's original dimensions and compensate the round trip.
      win.setBounds(bounds, false);
      const actual = win.getBounds();
      if (actual.width !== bounds.width || actual.height !== bounds.height)
        win.setBounds(
          {
            ...bounds,
            width: 2 * bounds.width - actual.width,
            height: 2 * bounds.height - actual.height,
          },
          false,
        );
    },
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
