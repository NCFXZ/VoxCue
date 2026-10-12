import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import path from 'node:path';
import { ChatGPTAuthService } from './backend/auth/service';
import { createAuthStorage } from './backend/auth/storage';
let auth: ChatGPTAuthService;
let demoSession = false;

let mainWindow: BrowserWindow | null = null;
let loginWindow: BrowserWindow | null = null;
let interviewWindow: BrowserWindow | null = null;
let closingMain = false;
let captureProtected = true;
function createLoginWindow() {
  if (loginWindow) {
    loginWindow.show();
    loginWindow.focus();
    return;
  }
  const win = new BrowserWindow({
    width: 960,
    height: 580,
    minWidth: 860,
    minHeight: 520,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    maximizable: false,
    show: false,
    title: 'AI Interview Copilot · 登录',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  loginWindow = win;
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  win.once('ready-to-show', () => {
    win.show();
    mainWindow?.close();
  });
  win.on('close', () => auth.cancel());
  win.on('closed', () => {
    loginWindow = null;
  });
  if (process.env.VITE_DEV_SERVER_URL) void win.loadURL(`${process.env.VITE_DEV_SERVER_URL}#login`);
  else void win.loadFile(path.join(__dirname, '../dist/index.html'), { hash: 'login' });
}
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
  if (mainWindow) return;
  closingMain = false;
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
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
    loginWindow?.close();
  });
  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) void mainWindow.loadURL(devUrl);
  else void mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
  mainWindow.on('close', () => {
    auth.cancel();
    closingMain = true;
    interviewWindow?.close();
  });
}
app.whenReady().then(() => {
  auth = new ChatGPTAuthService({
    storage: createAuthStorage(),
    openBrowser: (url) => shell.openExternal(url),
  });
  const requireMain = (event: Electron.IpcMainInvokeEvent) => {
    if (event.sender !== mainWindow?.webContents) throw new Error('Unauthorized window');
  };
  const requireLogin = (event: Electron.IpcMainInvokeEvent) => {
    if (event.sender !== loginWindow?.webContents) throw new Error('Unauthorized window');
  };
  ipcMain.handle('auth:session', async (event) => {
    if (event.sender !== loginWindow?.webContents) requireMain(event);
    const session = demoSession
      ? { mode: 'demo', user: { id: 'local-demo', name: '本地用户', email: '' }, expiresAt: null }
      : await auth.session();
    return session;
  });
  ipcMain.handle('auth:sign-in', async (event) => {
    requireLogin(event);
    demoSession = false;
    const session = await auth.signIn();
    createMainWindow();
    return session;
  });
  ipcMain.handle('auth:cancel', (event) => {
    requireLogin(event);
    auth.cancel();
  });
  ipcMain.handle('auth:demo', (event) => {
    requireLogin(event);
    if (auth.isPending()) throw new Error('请先取消 ChatGPT 登录。');
    demoSession = true;
    createMainWindow();
    return {
      mode: 'demo',
      user: { id: 'local-demo', name: '本地用户', email: '' },
      expiresAt: null,
    };
  });
  ipcMain.handle('auth:sign-out', async (event) => {
    requireMain(event);
    interviewWindow?.close();
    if (demoSession) {
      demoSession = false;
      createLoginWindow();
      return { warning: null };
    }
    const result = await auth.signOut();
    if (result.warning && mainWindow)
      await dialog.showMessageBox(mainWindow, {
        type: 'warning',
        title: '退出登录',
        message: result.warning,
        buttons: ['确定'],
      });
    createLoginWindow();
    return result;
  });
  ipcMain.handle('interview:open', async (event) => {
    if (event.sender !== mainWindow?.webContents) throw new Error('Unauthorized window');
    if (!demoSession && !(await auth.session())) throw new Error('Please sign in first');
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
  void auth
    .session()
    .then((session) => {
      if (session) createMainWindow();
      else createLoginWindow();
    })
    .catch(() => createLoginWindow());
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createLoginWindow();
  });
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
