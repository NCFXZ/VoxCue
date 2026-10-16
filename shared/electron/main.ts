import { RagChatService } from './application/rag';
import { KnowledgeHost } from './backend/knowledge/host';
import { KnowledgeCoordinator } from './application/knowledge';
import { registerKnowledgeIpc } from './ipc/knowledge';
import { UpdateService } from './backend/updates/service';
import { createUpdateDriver, updateUnavailableReason } from './backend/updates/driver';
import { registerUpdateIpc } from './ipc/updates';
import { app, BrowserWindow, dialog, shell, screen, systemPreferences } from 'electron';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ChatGPTAuthService } from './backend/auth/service';
import { createAuthStorage } from './backend/auth/storage';
import { ChatGPTService } from './backend/chat/service';
import type { AIChatService } from './backend/chat/ports';
import type { AIService } from './contracts/auth';
import { CopilotRuntime } from './backend/copilot/runtime';
import { CopilotAuthService } from './backend/copilot/auth';
import { CopilotChatService } from './backend/copilot/service';
import { createCopilotLoginStorage, createServiceSelection } from './backend/copilot/storage';
import { SelectedChatService } from './application/providers';
import { UsageLedger } from './backend/chat/usage';
import { registerChatIpc } from './ipc/chat';
import { registerInterviewIpc } from './ipc/interview';
import { InterviewContext } from './application/interviewContext';
import { captureInterviewScreen } from './screenshot';
import { registerHistoryIpc } from './ipc/history';
import { writeFile } from 'node:fs/promises';
import { SpeechHost } from './backend/speech/host';
import { InterviewAccess } from '../../windows/electron/speech/access';
import { devices, probeDevice } from '../../windows/electron/speech/capture';
import { validateSpeech } from './backend/speech/validation';
import { speechModelInstalled } from './backend/speech/models';
import {
  SpeechCoordinator,
  validateInterviewConfiguration,
  validateInterviewModel,
} from './application/speech';
import { handleDesktop, onDesktop, sendDesktop } from './ipc/handle';
import { selectDesktopPlatform, desktopResources } from './platform';
import { windowOptions, restrictWindowNavigation, loadWindowPage } from './window';
import {
  interviewPanelScale,
  fitInterviewBounds,
  draggedInterviewScale,
} from './contracts/interviewLayout';
let knowledge: KnowledgeHost;
let knowledgeCoordinator: KnowledgeCoordinator;
let auth: ChatGPTAuthService;
let chat: AIChatService;
let copilotRuntime: CopilotRuntime;
let copilotAuth: CopilotAuthService;
let selectedService: AIService = 'chatgpt';
let signingIn = false;
let chatIpc: ReturnType<typeof registerChatIpc> | undefined;
let interviewIpc: ReturnType<typeof registerInterviewIpc> | undefined;
let historyJobs: ReturnType<typeof registerHistoryIpc> | undefined;
let updates: UpdateService | undefined;
let updateWasInstalling = false;
let interviewOpening = false;
let updateFlush: { resolve(saved: boolean): void; reject(error: Error): void } | null = null;
let speech: SpeechHost | undefined;
let speechSessions: SpeechCoordinator | undefined;
const interviewContext = new InterviewContext();
let demoSession = false;

let mainWindow: BrowserWindow | null = null;
let loginWindow: BrowserWindow | null = null;
let interviewWindow: BrowserWindow | null = null;
let closingMain = false;
let sessionHasContent = false;
let mainCloseApproved = false;
let mainCloseChecking = false;
let mainCloseFlushed = false;
let pendingMainClose: string | null = null;
let mainCloseTimer: ReturnType<typeof setTimeout> | undefined;
let captureProtected = true;
let interviewCollapsed = false;
let interviewTranscriptVisible = true;
let interviewScale = 1;
let lastInterviewBounds: { requested: Electron.Rectangle; actual: Electron.Rectangle } | undefined;
let interviewCloseApproved = false;
let interviewResize:
  | {
      bounds: Electron.Rectangle;
      pointer: Electron.Point;
      lastPointer: Electron.Point;
      edge: 'left' | 'right';
      scale: number;
    }
  | undefined;
const desktopPlatform = selectDesktopPlatform();
const resources = desktopResources(
  {
    appPath: app.getAppPath(),
    resourcesPath: process.resourcesPath,
    packaged: app.isPackaged,
  },
  desktopPlatform,
);
const windowPaths = { icon: resources.icon, preload: path.join(__dirname, 'preload.js') };
const indexFile = path.join(app.getAppPath(), 'dist/index.html');
// Keep existing profiles, credentials, knowledge and usage after the product rename.
app.setPath('userData', path.join(app.getPath('appData'), 'ai-interview-copilot'));
app.setName('VoxCue');
if (desktopPlatform.appUserModelId) app.setAppUserModelId(desktopPlatform.appUserModelId);
function interviewActive() {
  return interviewOpening || !!interviewWindow || !!speechSessions?.configuration;
}
async function prepareUpdateInstall() {
  const win = mainWindow;
  if (!win || win.isDestroyed() || pendingMainClose || mainCloseChecking)
    throw Error('Window is not ready');
  if (sessionHasContent) {
    mainCloseChecking = true;
    try {
      const { response } = await dialog.showMessageBox(win, {
        type: 'warning',
        title: '重启并更新 VoxCue',
        message: '重启并安装更新？',
        detail:
          '正在生成的回复会停止，未保存的个人信息编辑会丢失。已保存资料、普通聊天和附件草稿会保留。',
        buttons: ['取消', '重启并更新'],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      });
      if (response !== 1) return false;
    } finally {
      mainCloseChecking = false;
    }
  }
  if (interviewActive() || win.isDestroyed()) throw Error('Interview or window changed');
  mainCloseFlushed = false;
  return new Promise<boolean>((resolve, reject) => {
    updateFlush = { resolve, reject };
    pendingMainClose = randomUUID();
    mainCloseTimer = setTimeout(() => {
      pendingMainClose = null;
      updateFlush = null;
      mainCloseApproved = false;
      reject(Error('Save timeout'));
    }, 15000);
    sendDesktop(win.webContents, 'session:request-close', pendingMainClose);
  });
}
function createLoginWindow() {
  if (loginWindow) {
    loginWindow.show();
    loginWindow.focus();
    return;
  }
  const win = new BrowserWindow(windowOptions('login', desktopPlatform, windowPaths));
  loginWindow = win;
  restrictWindowNavigation(win);
  win.once('ready-to-show', () => {
    win.show();
    mainWindow?.close();
  });
  win.on('close', () => {
    auth.cancel();
    copilotAuth?.cancel();
  });
  win.on('closed', () => {
    loginWindow = null;
  });
  loadWindowPage(win, 'login', indexFile, process.env.VITE_DEV_SERVER_URL);
}
function sizeInterview(scale: number, anchor = interviewWindow!.getBounds()) {
  const win = interviewWindow!;
  const area = screen.getDisplayMatching(anchor).workArea;
  const bounds = fitInterviewBounds(
    anchor,
    area,
    scale,
    interviewTranscriptVisible,
    interviewCollapsed,
  );
  if (!interviewCollapsed)
    interviewScale = interviewPanelScale(bounds.width, interviewTranscriptVisible);
  const previous = win.getBounds();
  const same = (a: Electron.Rectangle, b: Electron.Rectangle) =>
    a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
  // Windows fractional DPI can round a requested DIP to a different DIP when
  // read back. Compare the last request as well, without ignoring user moves.
  if (
    same(bounds, previous) ||
    (lastInterviewBounds &&
      same(bounds, lastInterviewBounds.requested) &&
      same(previous, lastInterviewBounds.actual))
  )
    return;
  win.setBounds(bounds, false);
  lastInterviewBounds = { requested: bounds, actual: win.getBounds() };
}
function openInterview() {
  if (interviewWindow) {
    interviewWindow.restore();
    interviewWindow.focus();
    return;
  }
  captureProtected = true;
  interviewContext.clear();
  interviewCollapsed = false;
  interviewTranscriptVisible = true;
  interviewScale = 1;
  lastInterviewBounds = undefined;
  interviewResize = undefined;
  interviewCloseApproved = false;
  const win = new BrowserWindow(windowOptions('interview', desktopPlatform, windowPaths));
  interviewWindow = win;
  // All expanded sizes use the controlled proportional resize path. Removing
  // OS minimums also permits the narrower answer-only and collapsed canvases.
  win.setMinimumSize(1, 1);
  sizeInterview(1);
  updates?.refresh();
  win.on('close', (event) => {
    if (!closingMain && !interviewCloseApproved) {
      event.preventDefault();
      sendDesktop(win.webContents, 'interview:request-end');
    }
  });
  win.setContentProtection(true);
  restrictWindowNavigation(win);
  win.once('ready-to-show', () => {
    win.show();
    // Electron 38 on Windows: the default "floating" level can report and stay
    // non-topmost. Explicit normal uses the standard Windows topmost behavior.
    win.setAlwaysOnTop(true, 'normal');
    mainWindow?.minimize();
  });
  loadWindowPage(win, 'interview', indexFile, process.env.VITE_DEV_SERVER_URL);
  win.on('closed', () => {
    interviewWindow = null;
    speechSessions?.releaseInterview(true);
    updates?.refresh();
    interviewIpc?.cancel();
    interviewContext.clear();
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
  sessionHasContent = false;
  mainCloseApproved = false;
  mainCloseFlushed = false;
  pendingMainClose = null;
  mainWindow = new BrowserWindow(windowOptions('main', desktopPlatform, windowPaths));
  restrictWindowNavigation(mainWindow);
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
    loginWindow?.close();
    void updates?.start();
  });
  loadWindowPage(mainWindow, 'main', indexFile, process.env.VITE_DEV_SERVER_URL);
  mainWindow.on('closed', () => {
    speechSessions?.releaseDictation();
    mainWindow = null;
  });
  mainWindow.webContents.on('did-start-loading', () => {
    speechSessions?.releaseDictation();
    chatIpc?.cancelActive();
  });
  mainWindow.on('close', (event) => {
    if (updates?.state().phase === 'installing' && !mainCloseFlushed) {
      event.preventDefault();
      return;
    }
    if (sessionHasContent && !mainCloseApproved) {
      event.preventDefault();
      if (mainCloseChecking) return;
      mainCloseChecking = true;
      void dialog
        .showMessageBox(mainWindow!, {
          type: 'warning',
          title: '关闭 VoxCue',
          message: '关闭应用？',
          detail:
            '正在生成的回复会停止，未保存的个人信息编辑会丢失。普通聊天、附件草稿和已保存资料会保留。',
          buttons: ['取消', '关闭应用'],
          defaultId: 0,
          cancelId: 0,
          noLink: true,
        })
        .then(({ response }) => {
          if (response === 1 && mainWindow && !mainWindow.isDestroyed()) {
            mainCloseApproved = true;
            mainWindow.close();
          }
        })
        .catch(() => dialog.showErrorBox('关闭确认失败', '窗口已保留，请重试关闭。'))
        .finally(() => {
          mainCloseChecking = false;
        });
      return;
    }
    if (!mainCloseFlushed) {
      event.preventDefault();
      if (pendingMainClose) return;
      pendingMainClose = randomUUID();
      sendDesktop(mainWindow!.webContents, 'session:request-close', pendingMainClose);
      mainCloseTimer = setTimeout(() => {
        pendingMainClose = null;
        mainCloseApproved = false;
        dialog.showErrorBox('聊天尚未保存', '窗口已保留，请等待聊天保存完成后重试关闭。');
      }, 15000);
      return;
    }
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
    storage: createAuthStorage(desktopPlatform.credentialEncryptionLabel),
    openBrowser: (url) => shell.openExternal(url),
  });
  const chatGPT = new ChatGPTService({
    access: () => auth.access(),
    ledger: new UsageLedger(path.join(app.getPath('userData'), 'chat-usage')),
  });
  copilotRuntime = new CopilotRuntime(
    path.join(app.getPath('userData'), 'copilot-runtime'),
    resources.copilotRuntime,
  );
  copilotAuth = new CopilotAuthService({
    credentialEncryptionLabel: desktopPlatform.credentialEncryptionLabel,
    storage: createCopilotLoginStorage(),
    control: () => copilotRuntime.control(),
    openBrowser: (url) => shell.openExternal(url),
  });
  const copilot = new CopilotChatService({
    client: () => copilotRuntime.client(),
    access: () => copilotAuth.access(),
    ledger: new UsageLedger(path.join(app.getPath('userData'), 'chat-usage')),
  });
  const selection = createServiceSelection();
  let selectionReady = selection.read().then((service) => {
    selectedService = service;
  });
  void selectionReady.catch(() => {});
  const activeAuth = () => (selectedService === 'copilot' ? copilotAuth : auth);
  chat = new SelectedChatService(() => (selectedService === 'copilot' ? copilot : chatGPT));
  const requireMain = (event: Electron.IpcMainInvokeEvent) => {
    if (event.sender !== mainWindow?.webContents) throw new Error('Unauthorized window');
  };
  updates = new UpdateService({
    currentVersion: app.getVersion(),
    driver: createUpdateDriver(app.isPackaged),
    unavailableReason: updateUnavailableReason(app.isPackaged),
    isInterviewActive: interviewActive,
    prepareInstall: prepareUpdateInstall,
    emit(state) {
      if (updateWasInstalling && state.phase !== 'installing') {
        mainCloseFlushed = false;
        mainCloseApproved = false;
      }
      updateWasInstalling = state.phase === 'installing';
      if (mainWindow && !mainWindow.isDestroyed())
        sendDesktop(mainWindow.webContents, 'updates:event', state);
    },
  });
  registerUpdateIpc(updates, requireMain);
  handleDesktop('session:state', (event, hasContent) => {
    requireMain(event);
    if (event.senderFrame !== event.sender.mainFrame) throw Error('Unauthorized frame');
    if (typeof hasContent !== 'boolean') throw Error('Invalid session state');
    sessionHasContent = hasContent;
  });
  handleDesktop('session:close-ready', (event, id, saved) => {
    requireMain(event);
    if (event.senderFrame !== event.sender.mainFrame) throw Error('Unauthorized frame');
    if (
      typeof id !== 'string' ||
      id.length > 80 ||
      typeof saved !== 'boolean' ||
      id !== pendingMainClose
    )
      throw Error('Invalid close acknowledgement');
    clearTimeout(mainCloseTimer);
    pendingMainClose = null;
    if (updateFlush) {
      const pending = updateFlush;
      updateFlush = null;
      mainCloseFlushed = saved;
      mainCloseApproved = saved;
      if (saved) pending.resolve(true);
      else pending.reject(Error('Save failed'));
      return;
    }
    if (saved) {
      mainCloseFlushed = true;
      mainWindow?.close();
    } else {
      mainCloseApproved = false;
    }
  });
  const requireLogin = (event: Electron.IpcMainInvokeEvent) => {
    if (event.sender !== loginWindow?.webContents || event.senderFrame !== event.sender.mainFrame)
      throw new Error('Unauthorized window');
  };
  handleDesktop('auth:session', async (event) => {
    if (event.sender !== loginWindow?.webContents) requireMain(event);
    if (event.senderFrame !== event.sender.mainFrame) throw Error('Unauthorized frame');
    await selectionReady;
    const session = demoSession
      ? {
          mode: 'demo' as const,
          user: { id: 'local-demo', name: '本地用户', email: '' },
          expiresAt: null,
        }
      : await activeAuth().session();
    return session;
  });
  const signIn = async (service: AIService) => {
    if (signingIn || auth.isPending() || copilotAuth.isPending())
      throw Error('已有登录操作正在进行。');
    signingIn = true;
    try {
      demoSession = false;
      const session = await (service === 'copilot' ? copilotAuth : auth).signIn();
      if (!loginWindow || loginWindow.isDestroyed()) throw Error('登录窗口已关闭。');
      await selection.write(service);
      selectedService = service;
      selectionReady = Promise.resolve();
      createMainWindow();
      return session;
    } finally {
      signingIn = false;
    }
  };
  handleDesktop('auth:sign-in', async (event) => {
    requireLogin(event);
    return signIn('chatgpt');
  });
  handleDesktop('auth:copilot-sign-in', async (event) => {
    requireLogin(event);
    return signIn('copilot');
  });
  handleDesktop('auth:cancel', (event) => {
    requireLogin(event);
    auth.cancel();
    copilotAuth.cancel();
  });
  handleDesktop('auth:demo', (event) => {
    requireLogin(event);
    if (app.isPackaged || !process.env.COPILOT_TEST_USER_DATA) throw Error('测试入口不可用。');
    if (auth.isPending() || copilotAuth.isPending()) throw new Error('请先取消正在进行的登录。');
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
    if (event.senderFrame !== event.sender.mainFrame) throw Error('Unauthorized frame');
    knowledgeCoordinator?.cancelAll();
    historyJobs?.cancelAll();
    chatIpc?.cancelActive();
    interviewCloseApproved = true;
    interviewWindow?.close();
    if (demoSession) {
      demoSession = false;
      mainCloseApproved = true;
      createLoginWindow();
      return { warning: null };
    }
    interviewIpc?.cancel();
    const result = await activeAuth().signOut();
    await copilotRuntime.stop();
    if (result.warning && mainWindow)
      await dialog.showMessageBox(mainWindow, {
        type: 'warning',
        title: '退出登录',
        message: result.warning,
        buttons: ['确定'],
      });
    mainCloseApproved = true;
    createLoginWindow();
    return result;
  });
  const ragModelPath = resources.ragModel;
  knowledge = new KnowledgeHost(
    path.join(app.getPath('userData'), 'knowledge-v1'),
    ragModelPath,
    (event) => knowledgeCoordinator.progress(event),
  );
  knowledgeCoordinator = new KnowledgeCoordinator(
    knowledge,
    path.join(app.getPath('userData'), 'knowledge-v1'),
    ragModelPath,
    (event) => {
      if (mainWindow && !mainWindow.isDestroyed())
        sendDesktop(mainWindow.webContents, 'knowledge:event', event);
    },
    () => chat.functionCallingStatus ?? { supported: null, reason: '当前服务尚未验证本地工具。' },
  );
  registerKnowledgeIpc(knowledgeCoordinator, requireMain);
  const ragChat = new RagChatService(chat, knowledge, () => knowledgeCoordinator.getMode());
  chatIpc = registerChatIpc({
    chat: ragChat,
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
    chat: ragChat,
    requireInterview,
    isDemo: () => demoSession,
    configuration: () => speechSessions?.configuration,
    context: interviewContext,
    captureScreen: (signal) => captureInterviewScreen(interviewWindow!, desktopPlatform.id, signal),
  });
  historyJobs = registerHistoryIpc({
    chat,
    requireMain,
    authorizeTitle(event) {
      if (event.senderFrame !== event.sender.mainFrame || demoSession)
        throw Error('请先连接模型服务。');
      if (event.sender === mainWindow?.webContents) {
        requireMain(event);
        return undefined;
      }
      requireInterview(event);
      const configuration = speechSessions?.configuration;
      if (!configuration?.aiEnabled) throw Error('请先连接模型服务。');
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
  const audioHelper = resources.audioHelper;
  const interviewAccess = new InterviewAccess({
    platform: desktopPlatform.id,
    microphonePermission: () => systemPreferences.getMediaAccessStatus('microphone'),
    devices: async () => {
      if (!audioHelper) throw Error('当前系统尚未支持本地音频采集。');
      return devices(audioHelper);
    },
    probe: async (source, device) => {
      if (!audioHelper) return { ok: false };
      return probeDevice(audioHelper, source, device);
    },
  });
  const speechModelRoot = resources.speechModels;
  speech = new SpeechHost(
    speechModelRoot,
    audioHelper,
    (event) => {
      if (speechSessions?.target === 'dictation' && mainWindow && !mainWindow.isDestroyed())
        sendDesktop(mainWindow.webContents, 'dictation:event', event);
      if (
        speechSessions?.target === 'interview' &&
        interviewWindow &&
        !interviewWindow.isDestroyed()
      ) {
        interviewContext.event(event);
        sendDesktop(interviewWindow.webContents, 'speech:event', event);
      }
    },
    resources.speechProcess,
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
    if (event.senderFrame !== event.sender.mainFrame || !desktopPlatform.microphoneSettingsUrl)
      throw Error('Invalid request');
    return shell.openExternal(desktopPlatform.microphoneSettingsUrl);
  });
  handleDesktop('interview:open', async (event, value: unknown) => {
    requireMain(event);
    if (event.senderFrame !== event.sender.mainFrame) throw Error('Unauthorized frame');
    if (updates?.state().phase === 'installing')
      throw Error('正在准备更新，请完成或取消更新后再开始面试。');
    if (interviewOpening) throw Error('正在检查面试设备，请稍候。');
    interviewOpening = true;
    updates?.refresh();
    try {
      if (!demoSession && !(await auth.session())) throw new Error('Please sign in first');
      const configuration = validateInterviewConfiguration(value);
      if (!demoSession && (configuration.mode !== 'local' || !configuration.aiEnabled))
        throw Error('请先连接模型服务并选择回答模型。');
      if (configuration.aiEnabled) {
        if (demoSession) throw Error('请先连接模型服务并选择可用的回答模型。');
        validateInterviewModel(configuration, await chat.models(false));
      }
      if (configuration.mode === 'local') {
        if (!speechModelInstalled(speechModelRoot))
          throw Error('本地语音模型未安装，请先下载模型后再开始面试。');
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
    } finally {
      interviewOpening = false;
      updates?.refresh();
    }
  });
  handleDesktop('interview:state', (event) => {
    requireInterview(event);
    return {
      protected: captureProtected,
      pinned: interviewWindow!.isAlwaysOnTop(),
      supported: desktopPlatform.captureProtectionSupported,
      collapsed: interviewCollapsed,
      transcriptVisible: interviewTranscriptVisible,
      configuration: speechSessions!.configuration!,
    };
  });
  handleDesktop('interview:capture', (event, allowed: unknown) => {
    requireInterview(event);
    if (typeof allowed !== 'boolean') throw new Error('Invalid request');
    interviewWindow!.setContentProtection(!allowed);
    captureProtected = !allowed;
    return captureProtected;
  });
  handleDesktop('interview:pin', (event) => {
    requireInterview(event);
    interviewWindow!.setAlwaysOnTop(true, 'normal');
    return interviewWindow!.isAlwaysOnTop();
  });
  handleDesktop('interview:collapse', (event) => {
    requireInterview(event);
    interviewResize = undefined;
    interviewCollapsed = !interviewCollapsed;
    sizeInterview(interviewScale);
    return interviewCollapsed;
  });
  handleDesktop('interview:transcript', (event, visible: unknown) => {
    requireInterview(event);
    if (typeof visible !== 'boolean') throw Error('Invalid transcript visibility');
    interviewResize = undefined;
    interviewTranscriptVisible = visible;
    if (!interviewCollapsed) sizeInterview(interviewScale);
    return interviewTranscriptVisible;
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
        const pointer = screen.getCursorScreenPoint();
        interviewResize = {
          bounds: interviewWindow.getBounds(),
          pointer,
          lastPointer: pointer,
          edge: change.edge,
          scale: interviewScale,
        };
        return;
      }
      if (change.phase !== 'move') throw new Error('Invalid resize');
      if (!interviewResize) return;
      const { bounds, pointer, edge, scale } = interviewResize;
      const current = screen.getCursorScreenPoint();
      // Do not round-trip native DIP bounds for a stationary pointer. Windows
      // can read back a different pixel and otherwise shift the toolbar by one.
      if (
        current.x === interviewResize.lastPointer.x &&
        current.y === interviewResize.lastPointer.y
      )
        return;
      interviewResize.lastPointer = current;
      sizeInterview(
        draggedInterviewScale(
          scale,
          current.x - pointer.x,
          current.y - pointer.y,
          edge,
          interviewTranscriptVisible,
        ),
        bounds,
      );
      return;
    }
    if (direction !== -1 && direction !== 1) throw new Error('Invalid request');
    sizeInterview(interviewScale + direction * 0.08);
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
  void selectionReady
    .then(() => activeAuth().session())
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
  if (desktopPlatform.quitOnAllWindowsClosed) app.quit();
});
app.on('before-quit', (event) => {
  if (mainWindow && !mainWindow.isDestroyed() && !mainCloseFlushed) {
    event.preventDefault();
    mainWindow.close();
    return;
  }
  updates?.dispose();
  knowledgeCoordinator?.cancelAll();
  knowledge?.stop();
  historyJobs?.cancelAll();
  speech?.stop();
  interviewIpc?.cancel();
  auth?.cancel();
  copilotAuth?.cancel();
  void copilotRuntime?.stop();
});
