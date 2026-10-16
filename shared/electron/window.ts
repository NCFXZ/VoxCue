import type { BrowserWindow, BrowserWindowConstructorOptions } from 'electron';
import type { DesktopPlatform } from './platform/types';
import { interviewCanvas, interviewLayout } from './contracts/interviewLayout';

type WindowRole = 'login' | 'main' | 'interview';
const roleOptions: Record<WindowRole, BrowserWindowConstructorOptions> = {
  login: {
    width: 960,
    height: 580,
    minWidth: 860,
    minHeight: 520,
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
};

export function windowOptions(
  role: WindowRole,
  platform: DesktopPlatform,
  paths: { icon: string; preload: string },
): BrowserWindowConstructorOptions {
  return {
    ...roleOptions[role],
    ...(role === 'main' ? platform.mainWindowOptions : {}),
    icon: paths.icon,
    frame: false,
    show: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: paths.preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  };
}

export function restrictWindowNavigation(win: Pick<BrowserWindow, 'webContents'>) {
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event) => event.preventDefault());
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
