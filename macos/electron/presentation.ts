import { app, nativeTheme } from 'electron';
import type { NativePresentation } from '../../shared/electron/presentation';

export function createPresentation(options: {
  icon: string;
  interviewOpen(): boolean;
}): NativePresentation {
  let hideTimer: ReturnType<typeof setTimeout> | undefined;
  let lastHide = 0;
  let lastShow = 0;
  const cancelHide = () => {
    clearTimeout(hideTimer);
    hideTimer = undefined;
  };
  const hideInterviewIcon = () => {
    cancelHide();
    if (!options.interviewOpen() || !app.dock?.isVisible()) return;
    // Electron can ignore hide immediately after either a hide or a show.
    const delay = Math.max(lastHide, lastShow) + 1100 - Date.now();
    if (delay > 0) {
      hideTimer = setTimeout(hideInterviewIcon, delay);
      return;
    }
    app.dock.hide();
    lastHide = Date.now();
  };
  return {
    initialize: () => app.dock?.setIcon(options.icon),
    setTheme: (theme) => {
      nativeTheme.themeSource = theme;
    },
    pinInterview: (win) => win.setAlwaysOnTop(true, 'floating'),
    prepareInterview: (win) =>
      win.setVisibleOnAllWorkspaces(true, {
        visibleOnFullScreen: true,
        skipTransformProcessType: true,
      }),
    hideMain: (win) => win.hide(),
    hideInterviewIcon,
    async restoreInterviewIcon() {
      cancelHide();
      const dock = app.dock;
      if (!dock) return;
      dock.setIcon(options.icon);
      lastShow = Date.now();
      await dock.show();
      lastShow = Date.now();
      dock.setIcon(options.icon);
    },
    setMousePassthrough: (win, ignore) => win.setIgnoreMouseEvents(ignore, { forward: true }),
    dispose: cancelHide,
  };
}
