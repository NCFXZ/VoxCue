import { app, nativeImage, nativeTheme, BrowserWindow } from 'electron';
import type { NativePresentation, NativeMaterial } from '../../shared/electron/presentation';

export function createPresentation(options: {
  capabilities?: NativePresentation['capabilities'];
  icon: string;
  material?: NativeMaterial;
  interviewOpen(): boolean;
}): NativePresentation {
  // Keep the supplied light artwork as a full-color image in every appearance.
  const icon = nativeImage.createFromPath(options.icon);
  icon.setTemplateImage(false);
  const applyIcon = () => app.dock?.setIcon(icon);
  const glass = options.material?.available === false ? undefined : options.material;
  const interviewWindows = new Set<BrowserWindow>();
  const applyInterviewAppearance = () => {
    for (const win of interviewWindows)
      if (!win.isDestroyed()) glass?.configureInterviewAppearance(win.getNativeWindowHandle());
  };
  const applyAppearance = () => {
    applyIcon();
    applyInterviewAppearance();
  };
  const glassWindows = new WeakSet<Electron.BrowserWindow>();
  const buttonEpochs = new WeakMap<Electron.BrowserWindow, Map<string, number>>();
  type SurfaceKind = 'composer' | 'follow';
  const surfaces = new WeakMap<Electron.BrowserWindow, Map<SurfaceKind, Electron.BrowserWindow>>();
  const chromeStates = new WeakMap<
    Electron.BrowserWindow,
    Parameters<NativeMaterial['configureScrollChrome']>[1]
  >();
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
  const interviewFollowWindows = new WeakSet<BrowserWindow>();
  const configureSurfaces = (win: BrowserWindow, interview = false) => {
    const restoreTrafficLights = () => {
      if (!interview && !win.isDestroyed()) win.setWindowButtonPosition({ x: 16, y: 18 });
    };
    if (!interview) win.on('resize', restoreTrafficLights);
    const owned = new Map<SurfaceKind, Electron.BrowserWindow>();
    surfaces.set(win, owned);
    const closeSurface = (kind: SurfaceKind) => {
      const view = owned.get(kind);
      owned.delete(kind);
      if (!view) return;
      if (!win.isDestroyed()) glass?.detachSurface(win.getNativeWindowHandle(), kind);
      if (!view.isDestroyed()) view.destroy();
    };
    const closeAll = () => {
      for (const kind of [...owned.keys()]) closeSurface(kind);
    };
    win.webContents.setWindowOpenHandler(({ url, frameName }) => {
      const match = /^voxcue-(composer|follow)-surface-\d{1,9}$/.exec(frameName);
      const kind = match?.[1] as SurfaceKind | undefined;
      const state = chromeStates.get(win);
      if (
        !glass ||
        url !== 'about:blank' ||
        !kind ||
        (interview ? kind !== 'follow' || !interviewFollowWindows.has(win) : !state)
      )
        return { action: 'deny' };
      closeSurface(kind);
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          webPreferences: {
            preload: undefined,
            sandbox: true,
            contextIsolation: true,
            nodeIntegration: false,
          },
        },
        createWindow: (configuration) => {
          const view = new BrowserWindow({
            ...configuration,
            show: false,
            frame: false,
            transparent: true,
            backgroundColor: '#00000000',
            title: `VoxCue · ${kind} surface`,
            width: win.getContentBounds().width,
            height: win.getContentBounds().height,
            parent: win,
            skipTaskbar: true,
            webPreferences: {
              ...configuration.webPreferences,
              preload: undefined,
              sandbox: true,
              contextIsolation: true,
              nodeIntegration: false,
              backgroundThrottling: false,
            },
          });
          owned.set(kind, view);
          view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
          view.webContents.on('will-navigate', (event) => event.preventDefault());
          view.webContents.on('will-redirect', (event) => event.preventDefault());
          if (
            !glass.attachSurface(win.getNativeWindowHandle(), view.getNativeWindowHandle(), kind)
          ) {
            closeSurface(kind);
            throw Error('Native material foreground unavailable');
          }
          if (!interview)
            glass.configureScrollChrome(win.getNativeWindowHandle(), chromeStates.get(win) ?? null);
          view.on('close', () => {
            if (!win.isDestroyed() && owned.get(kind) === view)
              glass.detachSurface(win.getNativeWindowHandle(), kind);
          });
          view.once('closed', () => {
            if (owned.get(kind) === view) owned.delete(kind);
          });
          restoreTrafficLights();
          return view.webContents;
        },
      };
    });
    win.webContents.on('did-start-loading', closeAll);
    win.once('closed', closeAll);
  };
  return {
    capabilities: options.capabilities
      ? Object.freeze({ ...options.capabilities, liquidGlass: glass?.available === true })
      : undefined,
    configureMain: (win) => configureSurfaces(win),
    setScrollChrome: (win, state) => {
      if (!glass || win.isDestroyed()) return false;
      chromeStates.set(win, state);
      for (const [kind, view] of surfaces.get(win) ?? []) {
        const area = state?.[kind];
        if (!area || view.isDestroyed()) continue;
        const { width, height } = win.getContentBounds(),
          [oldWidth, oldHeight] = view.getContentSize();
        if (oldWidth !== width || oldHeight !== height) view.setContentSize(width, height);
      }
      const active = glass.configureScrollChrome(win.getNativeWindowHandle(), state);
      win.setWindowButtonPosition({ x: 16, y: 18 });
      return active;
    },
    setContentControls: (win, controls, changed) => {
      if (!glass || win.isDestroyed()) return false;
      return glass.configureContentControls(win.getNativeWindowHandle(), controls, changed);
    },
    setInterviewMaterials: (win, materials) => {
      if (!glass || win.isDestroyed()) return false;
      const active = glass.configureInterviewMaterials(win.getNativeWindowHandle(), materials);
      if (interviewWindows.has(win)) {
        if (
          active &&
          materials.some((item) =>
            ['regular-interactive', 'regular-follow-hover'].includes(item.style),
          )
        )
          interviewFollowWindows.add(win);
        else interviewFollowWindows.delete(win);
        for (const view of surfaces.get(win)?.values() ?? []) {
          if (view.isDestroyed()) continue;
          const { width, height } = win.getContentBounds(),
            [oldWidth, oldHeight] = view.getContentSize();
          if (oldWidth !== width || oldHeight !== height) view.setContentSize(width, height);
        }
      }
      return active;
    },
    popUpNativeMenu: (win, request) => {
      if (!glass || win.isDestroyed()) return null;
      return glass.popUpMenu(win.getNativeWindowHandle(), request);
    },
    setGlassButton: (win, action, placement, clicked) => {
      if (!glass || win.isDestroyed()) return false;
      let epochs = buttonEpochs.get(win);
      if (!epochs) buttonEpochs.set(win, (epochs = new Map()));
      const epoch = (epochs.get(action) ?? 0) + (placement === null ? 1 : 0);
      epochs.set(action, epoch);
      return glass.configureButton(win.getNativeWindowHandle(), action, placement, () => {
        if (!win.isDestroyed() && epochs.get(action) === epoch) clicked();
      });
    },
    setSidebarGlass: (win, width, toolbarHeight = 0, surfaceColor = '#ffffff', dark = false) => {
      if (!glass || win.isDestroyed()) return false;
      const handle = win.getNativeWindowHandle();
      try {
        let active = glass.apply(handle, width, toolbarHeight, surfaceColor, dark);
        if (active && !glassWindows.has(win)) {
          glassWindows.add(win);
          win.setVibrancy(null);
          // Removing Electron's old backing can relayout native children. Ensure
          // the actual foreground remains inside NSGlassEffectView.contentView.
          active = glass.apply(handle, width, toolbarHeight, surfaceColor, dark);
        }
        if (!active && glassWindows.delete(win)) win.setVibrancy('sidebar');
        win.setWindowButtonPosition({ x: 16, y: 18 });
        return active;
      } catch (error) {
        // Never leave the Electron foreground reparented after a failed attach.
        try {
          glass.apply(handle, 0, 0, surfaceColor, dark);
        } finally {
          if (glassWindows.delete(win)) win.setVibrancy('sidebar');
        }
        throw error;
      }
    },
    initialize: () => {
      if (!observingAppearance) {
        nativeTheme.on('updated', applyAppearance);
        observingAppearance = true;
      }
      applyIcon();
    },
    setTheme: (theme) => {
      nativeTheme.themeSource = theme;
      applyInterviewAppearance();
    },
    pinInterview: (win) => win.setAlwaysOnTop(true, 'floating'),
    prepareInterview: (win) => {
      if (glass && !interviewWindows.has(win)) {
        interviewWindows.add(win);
        configureSurfaces(win, true);
        win.once('closed', () => interviewWindows.delete(win));
      }
      glass?.configureInterviewAppearance(win.getNativeWindowHandle());
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
    dispose: () => {
      cancelHide();
      if (observingAppearance) nativeTheme.removeListener('updated', applyAppearance);
      observingAppearance = false;
      interviewWindows.clear();
    },
  };
}
