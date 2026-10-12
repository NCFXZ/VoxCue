import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';

let mainWindow: BrowserWindow | null = null;
let interviewWindow: BrowserWindow | null = null;
let closingMain = false;
let captureProtected = true;
function openInterview() {
  if (interviewWindow) {
    interviewWindow.restore();
    interviewWindow.focus();
    return;
  }
  captureProtected = true;
  const win = new BrowserWindow({
    width: 1100,
    height: 650,
    minWidth: 800,
    minHeight: 490,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    show: false,
    title: 'AI Interview Copilot · 模拟面试',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  interviewWindow = win;
  win.setContentProtection(true);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  win.once('ready-to-show', () => {
    win.show();
    mainWindow?.minimize();
  });
  if (process.env.VITE_DEV_SERVER_URL)
    void win.loadURL(`${process.env.VITE_DEV_SERVER_URL}#interview`);
  else void win.loadFile(path.join(__dirname, '../dist/index.html'), { hash: 'interview' });
  win.on('closed', () => {
    interviewWindow = null;
    captureProtected = true;
    if (!closingMain) {
      mainWindow?.restore();
      mainWindow?.focus();
    }
  });
}
// Keep smoke tests isolated from the user's actual local documents and settings.
if (process.env.COPILOT_TEST_USER_DATA) app.setPath('userData', process.env.COPILOT_TEST_USER_DATA);
function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 960,
    minHeight: 680,
    frame: false,
    show: false,
    backgroundColor: '#00000000',
    backgroundMaterial: 'acrylic',
    title: 'AI Interview Copilot',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault());
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) void mainWindow.loadURL(devUrl);
  else void mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
  mainWindow.on('close', () => {
    closingMain = true;
    interviewWindow?.close();
  });
}
app.whenReady().then(() => {
  ipcMain.handle('interview:open', (event) => {
    if (event.sender !== mainWindow?.webContents) throw new Error('Unauthorized window');
    openInterview();
  });
  ipcMain.handle('interview:state', (event) => {
    if (event.sender !== interviewWindow?.webContents) throw new Error('Unauthorized window');
    return {
      protected: captureProtected,
      pinned: interviewWindow.isAlwaysOnTop(),
      supported: process.platform === 'win32',
    };
  });
  ipcMain.handle('interview:capture', (event, allowed: unknown) => {
    if (event.sender !== interviewWindow?.webContents || typeof allowed !== 'boolean')
      throw new Error('Invalid request');
    interviewWindow.setContentProtection(!allowed);
    captureProtected = !allowed;
    return captureProtected;
  });
  ipcMain.handle('interview:pin', (event) => {
    if (event.sender !== interviewWindow?.webContents) throw new Error('Unauthorized window');
    const pinned = !interviewWindow.isAlwaysOnTop();
    interviewWindow.setAlwaysOnTop(pinned);
    return pinned;
  });
  ipcMain.on('window:action', (event, action: unknown) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || (win !== mainWindow && win !== interviewWindow)) return;
    if (action === 'minimize') win.minimize();
    if (action === 'maximize') win.isMaximized() ? win.unmaximize() : win.maximize();
    if (action === 'close') win.close();
  });
  createMainWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
