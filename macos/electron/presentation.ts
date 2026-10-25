import { app, nativeImage, nativeTheme } from 'electron';
import type { NativePresentation } from '../../shared/electron/presentation';

/** macOS window and Dock lifecycle. Application UI is shared with Windows. */
export function createPresentation(options: {
  capabilities?: NativePresentation['capabilities'];
  icon: string;
  interviewOpen(): boolean;
}): NativePresentation {
  const icon = nativeImage.createFromPath(options.icon);
  icon.setTemplateImage(false);
  const applyIcon = () => app.dock?.setIcon(icon);
  let observingAppearance = false;
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
    capabilities: options.capabilities,
    initialize() {
      if (!observingAppearance) {
        nativeTheme.on('updated', applyIcon);
        observingAppearance = true;
      }
      applyIcon();
    },
    setTheme: (theme) => {
      nativeTheme.themeSource = theme;
    },
    pinInterview: (win) => win.setAlwaysOnTop(true, 'floating'),
    prepareInterview: (win) => {
      win.setVisibleOnAllWorkspaces(true, {
        visibleOnFullScreen: true,
        skipTransformProcessType: true,
      });
    },
    hideMain: (win) => win.hide(),
    hideInterviewIcon,
    async restoreInterviewIcon() {
      cancelHide();
      const dock = app.dock;
      if (!dock) return;
      applyIcon();
      lastShow = Date.now();
      await dock.show();
      lastShow = Date.now();
      applyIcon();
    },
    setMousePassthrough: (win, ignore) => win.setIgnoreMouseEvents(ignore, { forward: true }),
    dispose() {
      cancelHide();
      if (observingAppearance) nativeTheme.removeListener('updated', applyIcon);
      observingAppearance = false;
    },
  };
}
