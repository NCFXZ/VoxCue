import { app, BrowserWindow, dialog, shell, screen, systemPreferences } from 'electron';
import path from 'node:path';
import { ChatGPTAuthService } from './backend/auth/service';
import { createAuthStorage } from './backend/auth/storage';
import { ChatGPTService } from './backend/chat/service';
import { UsageLedger } from './backend/chat/usage';
import { registerChatIpc } from './ipc/chat';
import { registerInterviewIpc } from './ipc/interview';
import { registerHistoryIpc } from './ipc/history';
import { writeFile } from 'node:fs/promises';
import { SpeechHost } from './backend/speech/host';
import { InterviewAccess } from './backend/speech/access';
import { devices, probeDevice } from './backend/speech/capture';
import { validateSpeech } from './backend/speech/validation';
import {
  SpeechCoordinator,
  validateInterviewConfiguration,
  validateInterviewModel,
} from './application/speech';
import { handleDesktop, onDesktop, sendDesktop } from './ipc/handle';
let auth: ChatGPTAuthService;
let chat: ChatGPTService;
let chatIpc: ReturnType<typeof registerChatIpc> | undefined;
let interviewIpc: ReturnType<typeof registerInterviewIpc> | undefined;
let historyJobs: ReturnType<typeof registerHistoryIpc> | undefined;
let speech: SpeechHost | undefined;
let speechSessions: SpeechCoordinator | undefined;
let demoSession = false;

let mainWindow: BrowserWindow | null = null;
let loginWindow: BrowserWindow | null = null;
let interviewWindow: BrowserWindow | null = null;
let closingMain = false;
let captureProtected = true;
let interviewCollapsed = false;
let expandedBounds: Electron.Rectangle | undefined;
let interviewCloseApproved = false;
let interviewResize:
  { bounds: Electron.Rectangle; pointer: Electron.Point; edge: 'left' | 'right' } | undefined;
const appIcon = path.join(
  app.getAppPath(),
  process.platform === 'win32' ? 'public/voxcue.ico' : 'public/voxcue.png',
);
// Keep existing profiles, credentials, knowledge and usage after the product rename.
app.setPath('userData', path.join(app.getPath('appData'), 'ai-interview-copilot'));
app.setName('VoxCue');
if (process.platform === 'win32') app.setAppUserModelId('com.voxcue.desktop');
function createLoginWindow() {
  if (loginWindow) {
    loginWindow.show();
    loginWindow.focus();
    return;
  }
  const win = new BrowserWindow({
    icon: appIcon,
    width: 960,
    height: 580,
    minWidth: 860,
    minHeight: 520,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    maximizable: false,
    show: false,
    title: 'VoxCue · 登录',
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
  interviewCollapsed = false;
  expandedBounds = undefined;
  interviewCloseApproved = false;
  const win = new BrowserWindow({
    icon: appIcon,
    width: 1100,
    height: 650,
    minWidth: 800,
    minHeight: 490,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    show: false,
    title: 'VoxCue · 面试',
    resizable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  interviewWindow = win;
  win.on('close', (event) => {
    if (!closingMain && !interviewCloseApproved) {
      event.preventDefault();
      sendDesktop(win.webContents, 'interview:request-end');
    }
  });
  win.setContentProtection(true);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  win.once('ready-to-show', () => {
    win.show();
    // Electron 38 on Windows: the default "floating" level can report and stay
    // non-topmost. Explicit normal uses the standard Windows topmost behavior.
    win.setAlwaysOnTop(true, 'normal');
    mainWindow?.minimize();
  });
  if (process.env.VITE_DEV_SERVER_URL)
    void win.loadURL(`${process.env.VITE_DEV_SERVER_URL}#interview`);
  else void win.loadFile(path.join(__dirname, '../dist/index.html'), { hash: 'interview' });
  win.on('closed', () => {
    interviewWindow = null;
    speechSessions?.releaseInterview(true);
    interviewIpc?.cancel();
    captureProtected = true;
    if (!closingMain) {
      mainWindow?.restore();
      mainWindow?.focus();
    }
  });
  win.webContents.on('did-start-loading', () => {
    speechSessions?.releaseInterview();
    interviewIpc?.cancel();
  });
}
// Keep smoke tests isolated from the user's actual local documents and settings.
if (process.env.COPILOT_TEST_USER_DATA) app.setPath('userData', process.env.COPILOT_TEST_USER_DATA);
function createMainWindow() {
  if (mainWindow) return;
  closingMain = false;
  mainWindow = new BrowserWindow({
    icon: appIcon,
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 680,
    frame: false,
    show: false,
    backgroundColor: '#00000000',
    backgroundMaterial: 'acrylic',
    title: 'VoxCue',
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
    speechSessions?.releaseDictation();
    mainWindow = null;
  });
  mainWindow.webContents.on('did-start-loading', () => speechSessions?.releaseDictation());
  mainWindow.on('close', () => {
    speechSessions?.releaseDictation();
    chatIpc?.cancelActive();
    auth.cancel();
    closingMain = true;
    interviewWindow?.close();
  });
}
app.whenReady().then(() => {
  const systemAccent = () => {
    try {
      const color = systemPreferences.getAccentColor();
      return /^[a-f0-9]{8}$/i.test(color) ? '#' + color.slice(0, 6) : null;
    } catch {
      return null;
    }
  };
  handleDesktop('appearance:accent', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || ![loginWindow, mainWindow, interviewWindow].includes(win))
      throw new Error('Unauthorized window');
    return systemAccent();
  });
  systemPreferences.on('accent-color-changed', () => {
    const color = systemAccent();
    for (const win of [loginWindow, mainWindow, interviewWindow])
      if (win && !win.isDestroyed())
        sendDesktop(win.webContents, 'appearance:accent-changed', color);
  });
  auth = new ChatGPTAuthService({
    storage: createAuthStorage(),
    openBrowser: (url) => shell.openExternal(url),
  });
  chat = new ChatGPTService({
    access: () => auth.access(),
    ledger: new UsageLedger(path.join(app.getPath('userData'), 'chat-usage')),
  });
  const requireMain = (event: Electron.IpcMainInvokeEvent) => {
    if (event.sender !== mainWindow?.webContents) throw new Error('Unauthorized window');
  };
  const requireLogin = (event: Electron.IpcMainInvokeEvent) => {
    if (event.sender !== loginWindow?.webContents) throw new Error('Unauthorized window');
  };
  handleDesktop('auth:session', async (event) => {
    if (event.sender !== loginWindow?.webContents) requireMain(event);
    const session = demoSession
      ? {
          mode: 'demo' as const,
          user: { id: 'local-demo', name: '本地用户', email: '' },
          expiresAt: null,
        }
      : await auth.session();
    return session;
  });
  handleDesktop('auth:sign-in', async (event) => {
    requireLogin(event);
    demoSession = false;
    const session = await auth.signIn();
    createMainWindow();
    return session;
  });
  handleDesktop('auth:cancel', (event) => {
    requireLogin(event);
    auth.cancel();
  });
  handleDesktop('auth:demo', (event) => {
    requireLogin(event);
    if (app.isPackaged || !process.env.COPILOT_TEST_USER_DATA) throw Error('测试入口不可用。');
    if (auth.isPending()) throw new Error('请先取消 ChatGPT 登录。');
    demoSession = true;
    createMainWindow();
    return {
      mode: 'demo',
      user: { id: 'local-demo', name: '本地用户', email: '' },
      expiresAt: null,
    };
  });
  handleDesktop('auth:sign-out', async (event) => {
    requireMain(event);
    historyJobs?.cancelAll();
    chatIpc?.cancelActive();
    interviewCloseApproved = true;
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
  chatIpc = registerChatIpc({
    chat,
    requireMain,
    isDemo: () => demoSession,
    openLink: (url) => shell.openExternal(url),
  });
  const requireInterview = (event: Electron.IpcMainInvokeEvent) => {
    if (
      event.sender !== interviewWindow?.webContents ||
      event.senderFrame !== event.sender.mainFrame
    )
      throw Error('Unauthorized window');
  };
  interviewIpc = registerInterviewIpc({
    chat,
    requireInterview,
    isDemo: () => demoSession,
    configuration: () => speechSessions?.configuration,
  });
  historyJobs = registerHistoryIpc({
    chat,
    requireMain,
    authorizeTitle(event) {
      if (event.senderFrame !== event.sender.mainFrame || demoSession)
        throw Error('请先连接 ChatGPT。');
      if (event.sender === mainWindow?.webContents) {
        requireMain(event);
        return undefined;
      }
      requireInterview(event);
      const configuration = speechSessions?.configuration;
      if (!configuration?.aiEnabled) throw Error('请先连接 ChatGPT。');
      return configuration.modelId;
    },
    emit(event) {
      for (const win of [mainWindow, interviewWindow])
        if (win && !win.isDestroyed()) sendDesktop(win.webContents, 'history:title', event);
    },
    async exportFile(event, request) {
      const win = BrowserWindow.fromWebContents(event.sender)!;
      const name =
        request.title
          .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
          .replace(/[. ]+$/g, '')
          .slice(0, 100) || '面试记录';
      const result = await dialog.showSaveDialog(win, {
        title: '导出面试记录',
        defaultPath: path.join(app.getPath('downloads'), name + '.txt'),
        filters: [{ name: '文本文件', extensions: ['txt'] }],
      });
      if (result.canceled || !result.filePath) return false;
      await writeFile(result.filePath, '\uFEFF' + request.text, 'utf8');
      return true;
    },
  });
  const audioHelper = app.isPackaged
    ? path.join(process.resourcesPath, 'native/VoxCue.Audio.exe')
    : path.join(app.getAppPath(), 'native/bin/VoxCue.Audio.exe');
  const interviewAccess = new InterviewAccess({
    platform: process.platform,
    microphonePermission: () => systemPreferences.getMediaAccessStatus('microphone'),
    devices: () => devices(audioHelper),
    probe: (source, device) => probeDevice(audioHelper, source, device),
  });
  speech = new SpeechHost(
    app.isPackaged
      ? path.join(process.resourcesPath, 'models/speech')
      : path.join(app.getAppPath(), 'local-models/speech'),
    audioHelper,
    (event) => {
      if (speechSessions?.target === 'dictation' && mainWindow && !mainWindow.isDestroyed())
        sendDesktop(mainWindow.webContents, 'dictation:event', event);
      if (
        speechSessions?.target === 'interview' &&
        interviewWindow &&
        !interviewWindow.isDestroyed()
      )
        sendDesktop(interviewWindow.webContents, 'speech:event', event);
    },
  );
  speechSessions = new SpeechCoordinator(speech);
  handleDesktop('speech:call', (event, value: unknown) => {
    const call = validateSpeech(value);
    if (
      event.sender === mainWindow?.webContents &&
      event.senderFrame === event.sender.mainFrame &&
      call.op === 'devices'
    )
      return speech!.call(call);
    requireInterview(event);
    return speechSessions!.interview(call);
  });
  handleDesktop('dictation:call', (event, value: unknown) => {
    requireMain(event);
    if (event.senderFrame !== event.sender.mainFrame) throw Error('Unauthorized frame');
    return speechSessions!.dictation(value);
  });
  handleDesktop('interview:check-access', async (event, value: unknown) => {
    requireMain(event);
    if (event.senderFrame !== event.sender.mainFrame) throw Error('Unauthorized frame');
    const configuration = validateInterviewConfiguration(value);
    if (configuration.mode !== 'local') throw Error('请选择本地音频设备。');
    return interviewAccess.check(configuration.options);
  });
  handleDesktop('interview:microphone-settings', (event) => {
    requireMain(event);
    if (event.senderFrame !== event.sender.mainFrame || process.platform !== 'win32')
      throw Error('Invalid request');
    return shell.openExternal('ms-settings:privacy-microphone');
  });
  handleDesktop('interview:open', async (event, value: unknown) => {
    requireMain(event);
    if (event.senderFrame !== event.sender.mainFrame) throw Error('Unauthorized frame');
    if (!demoSession && !(await auth.session())) throw new Error('Please sign in first');
    const configuration = validateInterviewConfiguration(value);
    if (!demoSession && (configuration.mode !== 'local' || !configuration.aiEnabled))
      throw Error('请先连接 ChatGPT 并选择回答模型。');
    if (configuration.aiEnabled) {
      if (demoSession) throw Error('请先登录 ChatGPT 并选择账户可用的回答模型。');
      validateInterviewModel(configuration, await chat.models(false));
    }
    if (configuration.mode === 'local') {
      const access = await interviewAccess.check(configuration.options);
      if (!access.ready)
        throw Error(
          access.checks
            .filter((check) => check.status !== 'granted')
            .map((check) => check.message)
            .join('\n'),
        );
    }
    await speechSessions!.confirm(configuration);
    openInterview();
  });
  handleDesktop('interview:state', (event) => {
    requireInterview(event);
    return {
      protected: captureProtected,
      pinned: interviewWindow!.isAlwaysOnTop(),
      supported: process.platform === 'win32',
      collapsed: interviewCollapsed,
      configuration: speechSessions!.configuration!,
    };
  });
  handleDesktop('interview:capture', (event, allowed: unknown) => {
    if (event.sender !== interviewWindow?.webContents || typeof allowed !== 'boolean')
      throw new Error('Invalid request');
    interviewWindow.setContentProtection(!allowed);
    captureProtected = !allowed;
    return captureProtected;
  });
  handleDesktop('interview:pin', (event) => {
    requireInterview(event);
    interviewWindow!.setAlwaysOnTop(true, 'normal');
    return interviewWindow!.isAlwaysOnTop();
  });
  handleDesktop('interview:collapse', (event) => {
    if (event.sender !== interviewWindow?.webContents) throw new Error('Unauthorized window');
    const win = interviewWindow;
    if (!interviewCollapsed) {
      expandedBounds = win.getBounds();
      interviewResize = undefined;
      win.setMinimumSize(420, 72);
      win.setResizable(false);
      win.setBounds({
        x: Math.round(expandedBounds.x + (expandedBounds.width - 420) / 2),
        y: expandedBounds.y,
        width: 420,
        height: 72,
      });
    } else {
      win.setResizable(false);
      win.setMinimumSize(800, 490);
      const bounds = expandedBounds!;
      win.setBounds({
        x: Math.round(win.getBounds().x + win.getBounds().width / 2 - bounds.width / 2),
        y: win.getBounds().y,
        width: bounds.width,
        height: bounds.height,
      });
    }
    interviewCollapsed = !interviewCollapsed;
    return interviewCollapsed;
  });
  handleDesktop('interview:resize', (event, direction: unknown) => {
    requireInterview(event);
    if (!interviewWindow) throw new Error('Invalid request');
    if (interviewCollapsed) return;
    if (direction && typeof direction === 'object') {
      const change = direction as { phase?: unknown; edge?: unknown };
      if (change.phase === 'end') {
        interviewResize = undefined;
        return;
      }
      if (change.phase === 'start' && (change.edge === 'left' || change.edge === 'right')) {
        interviewResize = {
          bounds: interviewWindow.getBounds(),
          pointer: screen.getCursorScreenPoint(),
          edge: change.edge,
        };
        return;
      }
      if (change.phase !== 'move') throw new Error('Invalid resize');
      if (!interviewResize) return;
      const { bounds, pointer, edge } = interviewResize;
      const current = screen.getCursorScreenPoint();
      const area = screen.getDisplayMatching(bounds).workArea;
      const center = bounds.x + bounds.width / 2;
      const maximumWidth = Math.floor(2 * Math.min(center - area.x, area.x + area.width - center));
      const width = Math.max(
        Math.min(800, maximumWidth),
        Math.min(
          maximumWidth,
          bounds.width + (current.x - pointer.x) * (edge === 'right' ? 2 : -2),
        ),
      );
      const height = Math.max(
        Math.min(490, area.height),
        Math.min(area.y + area.height - bounds.y, bounds.height + current.y - pointer.y),
      );
      interviewWindow.setBounds({
        x: Math.round(center - width / 2),
        y: bounds.y,
        width: Math.round(width),
        height: Math.round(height),
      });
      return;
    }
    if (direction !== -1 && direction !== 1) throw new Error('Invalid request');
    const bounds = interviewWindow.getBounds();
    const area = screen.getDisplayMatching(bounds).workArea;
    const width = Math.max(800, Math.min(area.width, bounds.width + direction * 100));
    const height = Math.max(490, Math.min(area.height, bounds.height + direction * 60));
    interviewWindow.setBounds({
      width,
      height,
      x: Math.max(area.x, Math.min(bounds.x, area.x + area.width - width)),
      y: Math.max(area.y, Math.min(bounds.y, area.y + area.height - height)),
    });
  });
  onDesktop('interview:confirm-end', (event) => {
    if (event.sender !== interviewWindow?.webContents) return;
    interviewCloseApproved = true;
    interviewWindow.close();
  });
  onDesktop('window:action', (event, action: unknown) => {
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
app.on('before-quit', () => {
  historyJobs?.cancelAll();
  speech?.stop();
  interviewIpc?.cancel();
});
