import type { BrowserWindow, BrowserWindowConstructorOptions } from 'electron';
import type { DesktopPlatform } from './platform/types';
import { interviewCanvas, interviewLayout } from './contracts/interviewLayout';
import { pendingPresentation } from './contracts/presentation';
import { translateUI, type UILanguage } from './contracts/uiLanguage';

export type WindowRole = 'login' | 'main' | 'interview' | 'interview-shortcuts';
const roleOptions: Record<WindowRole, BrowserWindowConstructorOptions> = {
  login: {
    width: 1000,
    height: 660,
    minWidth: 860,
    minHeight: 580,
    transparent: true,
    maximizable: false,
    title: 'VoxCue · 登录',
  },
  main: { width: 1280, height: 800, minWidth: 960, minHeight: 680, title: 'VoxCue' },
  interview: {
    ...interviewCanvas(),
    minWidth: Math.round(interviewCanvas(true, false, interviewLayout.minimumScale).width),
    minHeight: Math.round(interviewCanvas(true, false, interviewLayout.minimumScale).height),
    hasShadow: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    title: 'VoxCue · 面试',
  },
  'interview-shortcuts': {
    width: 360,
    height: 380,
    hasShadow: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    title: '快捷键',
  },
};

export function windowOptions(
  role: WindowRole,
  platform: DesktopPlatform,
  paths: { icon: string; preload: string },
  language: UILanguage = 'zh-CN',
  systemLanguage: UILanguage = language,
): BrowserWindowConstructorOptions {
  return {
    ...roleOptions[role],
    title: translateUI(roleOptions[role].title ?? 'VoxCue', language),
    ...(role === 'main' ? platform.mainWindowOptions : {}),
    ...(role === 'interview' &&
    platform.id === 'win32' &&
    platform.presentation?.interviewIconVisibility
      ? { skipTaskbar: true }
      : {}),
    icon: paths.icon,
    frame: false,
    ...(platform.id === 'darwin' && (role === 'main' || role === 'login')
      ? {
          frame: true,
          titleBarStyle: 'hidden' as const,
          trafficLightPosition: { x: 16, y: 18 },
          titleBarOverlay: false,
          transparent: false,
          roundedCorners: true,
        }
      : {}),
    show: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: paths.preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      zoomFactor: 1,
      additionalArguments: [
        '--voxcue-presentation=' + JSON.stringify(platform.presentation ?? pendingPresentation),
        '--voxcue-system-language=' + systemLanguage,
      ],
    },
  };
}

export function restrictWindowNavigation(win: Pick<BrowserWindow, 'webContents'>) {
  const resetZoom = () => win.webContents.setZoomFactor(1);
  resetZoom();
  void win.webContents.setVisualZoomLevelLimits(1, 1);
  win.webContents.on('did-finish-load', resetZoom);
  win.webContents.on('before-input-event', (event, input) => {
    if (
      (input.control || input.meta) &&
      !input.alt &&
      ['+', '=', '-', '_', '0', 'Add', 'Subtract'].includes(input.key)
    ) {
      event.preventDefault();
      resetZoom();
    }
  });
  win.webContents.on('zoom-changed', (event) => {
    event.preventDefault();
    resetZoom();
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event) => event.preventDefault());
}

/** Keep every quit attempt behind the same retirement barrier. */
export function guardQuitDrain(
  target: {
    on(event: 'will-quit', listener: (event: { preventDefault(): void }) => void): unknown;
    quit(): void;
  },
  drain: () => Promise<unknown>,
) {
  let complete = false;
  let pending: Promise<unknown> | undefined;
  target.on('will-quit', (event) => {
    if (complete) return;
    event.preventDefault();
    if (pending) return;
    pending = Promise.resolve()
      .then(drain)
      .then(
        () => {
          complete = true;
          // Electron can ignore a retry inside the prevented will-quit native turn.
          setImmediate(() => target.quit());
        },
        () => {
          // Unexpected retirement failure must not open the gate; a later quit retries.
          pending = undefined;
        },
      );
  });
}

export function whenWindowReady(win: BrowserWindow, platform: DesktopPlatform, show: () => void) {
  // BrowserWindow.webContents cannot be read from the already-closed window.
  const contents = win.webContents;
  const dispose = () => {
    win.removeListener('ready-to-show', ready);
    contents.removeListener('did-finish-load', ready);
    win.removeListener('closed', dispose);
  };
  const ready = () => {
    dispose();
    if (!win.isDestroyed()) show();
  };
  win.once('ready-to-show', ready);
  win.once('closed', dispose);
  // A hidden Acrylic/transparent HWND can defer its first paint indefinitely.
  // Show the loaded Windows page without waiting for that paint to reveal it.
  if (platform.id === 'win32') contents.once('did-finish-load', ready);
}

export function loadWindowPage(
  win: Pick<BrowserWindow, 'loadURL' | 'loadFile'>,
  role: WindowRole,
  indexFile: string,
  devUrl?: string,
) {
  const hash = role === 'main' ? '' : role;
  if (devUrl) void win.loadURL(devUrl + (hash ? '#' + hash : ''));
  else if (hash) void win.loadFile(indexFile, { hash });
  else void win.loadFile(indexFile);
}
