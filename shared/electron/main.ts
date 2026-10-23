import { RagChatService } from './application/rag';
import { KnowledgeHost } from './backend/knowledge/host';
import { KnowledgeCoordinator } from './application/knowledge';
import { registerKnowledgeIpc } from './ipc/knowledge';
import { UpdateService } from './backend/updates/service';
import { readAutoDownload, saveAutoDownload } from './backend/updates/preferences';
import { createUpdateDriver, updateUnavailableReason } from './backend/updates/driver';
import { registerUpdateIpc } from './ipc/updates';
import {
  app,
  BrowserWindow,
  dialog,
  shell,
  screen,
  systemPreferences,
  Menu,
  session,
} from 'electron';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { migrateUserData } from './userData';
import { packagesFor } from './backend/components/catalog';
import { ComponentService, componentPaths } from './backend/components/service';
import { registerComponentIpc } from './ipc/components';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ChatGPTAuthService } from './backend/auth/service';
import { createAuthStorage } from './backend/auth/storage';
import { ChatGPTService } from './backend/chat/service';
import type { AIChatService } from './backend/chat/ports';
import { UsageLedger } from './backend/chat/usage';
import { registerChatIpc } from './ipc/chat';
import { registerInterviewIpc } from './ipc/interview';
import { InterviewContext } from './application/interviewContext';
import { captureInterviewScreenshot } from './screenshot';
import { registerScreenCaptureIpc } from './ipc/screenCapture';
import type { ScreenCaptureAccess } from './contracts/screenCapture';
import { registerHistoryIpc } from './ipc/history';
import { readFile, writeFile } from 'node:fs/promises';
import { SpeechHost } from './backend/speech/host';
import { SpeechHardwareProbe } from './backend/speech/hardware';
import type {
  AudioDevice,
  AudioSource,
  InterviewAccessReport,
  SpeechOptions,
} from './contracts/speech';
import { validateSpeech } from './backend/speech/validation';
import { speechModelInstalled } from './backend/speech/models';
import { speechComponent } from './contracts/speechSettings';
import {
  SpeechCoordinator,
  validateInterviewConfiguration,
  validateInterviewModel,
} from './application/speech';
import { handleDesktop, onDesktop, sendDesktop } from './ipc/handle';
import { selectDesktopPlatform, desktopResources } from './platform';
import { windowOptions, restrictWindowNavigation, loadWindowPage } from './window';
import type { NativePresentation } from './presentation';
import {
  interviewPanelScale,
  fitInterviewBounds,
  draggedInterviewScale,
  interviewLayout,
} from './contracts/interviewLayout';
let knowledge: KnowledgeHost;
let knowledgeCoordinator: KnowledgeCoordinator;
let auth: ChatGPTAuthService;
let chat: AIChatService;
let signingIn = false;
let cancelLoginWait: (() => void) | undefined;
let chatIpc: ReturnType<typeof registerChatIpc> | undefined;
let interviewIpc: ReturnType<typeof registerInterviewIpc> | undefined;
let historyJobs: ReturnType<typeof registerHistoryIpc> | undefined;
let updates: UpdateService | undefined;
let components: ComponentService;
let updateWasInstalling = false;
let interviewOpening = false;
let updateFlush: { resolve(saved: boolean): void; reject(error: Error): void } | null = null;
let speech: SpeechHost | undefined;
let speechSessions: SpeechCoordinator | undefined;
const interviewContext = new InterviewContext();
let demoSession = false;

let macQuitRequested = false;
let mainWindow: BrowserWindow | null = null;
let loginWindow: BrowserWindow | null = null;
let interviewWindow: BrowserWindow | null = null;
let interviewMousePassthrough = false;
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
let interviewMove:
  { bounds: Electron.Rectangle; pointer: Electron.Point; lastPointer: Electron.Point } | undefined;
let interviewResize:
  | {
      bounds: Electron.Rectangle;
      pointer: Electron.Point;
      lastPointer: Electron.Point;
      edge: 'left' | 'right';
      scale: number;
    }
  | undefined;
const platformPolicy = selectDesktopPlatform();
const resources = desktopResources(
  {
    appPath: app.getAppPath(),
    resourcesPath: process.resourcesPath,
    packaged: app.isPackaged,
  },
  platformPolicy,
);
const windowPaths = { icon: resources.icon, preload: path.join(__dirname, 'preload.js') };
const nativePresentation: NativePresentation | undefined = platformPolicy.presentationFile
  ? require(
      path.join(app.getAppPath(), 'dist-electron', platformPolicy.presentationFile),
    ).createPresentation({
      capabilities: platformPolicy.presentation,
      icon: resources.icon,
      material:
        resources.presentationBinding && existsSync(resources.presentationBinding)
          ? require(resources.presentationBinding)
          : undefined,
      interviewOpen: () => !!interviewWindow && !interviewWindow.isDestroyed(),
    })
  : undefined;
const desktopPlatform = {
  ...platformPolicy,
  presentation: nativePresentation?.capabilities ?? platformPolicy.presentation,
};
const indexFile = path.join(app.getAppPath(), 'dist/index.html');
app.setName('VoxCue');
try {
  // Resolve/migrate before any session, credential store, model cache or window is created.
  // Isolated test profiles must bypass real user data and migration entirely.
  const isolated = process.env.COPILOT_TEST_USER_DATA;
  if (isolated) mkdirSync(isolated, { recursive: true });
  const directory = isolated ?? migrateUserData(app.getPath('appData'));
  app.setPath('userData', directory);
  app.setPath('sessionData', directory);
} catch (error) {
  dialog.showErrorBox(
    '应用数据迁移未完成',
    error instanceof Error ? error.message : '请检查数据目录后重试。',
  );
  app.exit(1);
}
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
    cancelLoginWait?.();
    auth.cancel();
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
const pinningInterviews = new WeakSet<BrowserWindow>();
function pinInterview(win: BrowserWindow) {
  if (win.isDestroyed() || pinningInterviews.has(win)) return;
  pinningInterviews.add(win);
  try {
    // Windows can emit always-on-top-changed before its native level update
    // returns. Do not recursively re-enter the same update from that event.
    if (nativePresentation) nativePresentation.pinInterview(win);
    else win.setAlwaysOnTop(true, 'normal');
  } finally {
    pinningInterviews.delete(win);
  }
}
function setInterviewMousePassthrough(ignore: boolean) {
  const win = interviewWindow;
  if (
    !nativePresentation ||
    !desktopPlatform.presentation?.interviewMousePassthrough ||
    !win ||
    win.isDestroyed() ||
    ignore === interviewMousePassthrough
  )
    return;
  nativePresentation.setMousePassthrough(win, ignore);
  interviewMousePassthrough = ignore;
}
function hideInterviewIcon() {
  nativePresentation?.hideInterviewIcon();
}
function restoreAfterInterview() {
  const restoreMain = () => {
    if (!closingMain && !interviewWindow) {
      mainWindow?.restore();
      if (nativePresentation) mainWindow?.show();
      mainWindow?.focus();
    }
  };
  if (!nativePresentation) return restoreMain();
  if (macQuitRequested) return nativePresentation.dispose();
  void nativePresentation
    .restoreInterviewIcon()
    .then(() => {
      // A new interview can open while the asynchronous Dock restoration completes.
      if (interviewWindow) hideInterviewIcon();
      else restoreMain();
    })
    .catch(() => {
      restoreMain();
      dialog.showErrorBox('应用图标恢复失败', '面试已结束，请重新打开 VoxCue。');
    });
}
function openInterview() {
  if (interviewWindow) {
    interviewWindow.restore();
    interviewWindow.focus();
    if (nativePresentation) {
      hideInterviewIcon();
      pinInterview(interviewWindow);
    }
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
  interviewMove = undefined;
  const win = new BrowserWindow(windowOptions('interview', desktopPlatform, windowPaths));
  interviewWindow = win;
  interviewMousePassthrough = false;
  setInterviewMousePassthrough(true);
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
  if (nativePresentation) {
    const keepOnTop = () => pinInterview(win);
    win.on('show', keepOnTop);
    win.on('restore', keepOnTop);
    win.on('always-on-top-changed', (_event, onTop) => {
      if (!onTop && !closingMain && !interviewCloseApproved) pinInterview(win);
    });
  }
  win.once('ready-to-show', () => {
    if (nativePresentation) {
      nativePresentation.prepareInterview(win);
    }
    win.show();
    pinInterview(win);
    if (nativePresentation) {
      if (mainWindow) nativePresentation.hideMain(mainWindow);
      // Showing a later interview can restore the application's Dock policy.
      // Apply automatic icon hiding after all native window-show operations.
      hideInterviewIcon();
    } else mainWindow?.minimize();
  });
  loadWindowPage(win, 'interview', indexFile, process.env.VITE_DEV_SERVER_URL);
  win.on('closed', () => {
    interviewMove = undefined;
    interviewWindow = null;
    interviewMousePassthrough = false;
    speechSessions?.releaseInterview(true);
    updates?.refresh();
    interviewIpc?.cancel();
    interviewContext.clear();
    captureProtected = true;
    restoreAfterInterview();
  });
  win.webContents.on('did-start-loading', () => {
    interviewMove = undefined;
    nativePresentation?.setContentControls?.(win, [], () => {});
    nativePresentation?.setInterviewMaterials?.(win, []);
    setInterviewMousePassthrough(true);
    speechSessions?.releaseInterview();
    interviewIpc?.cancel();
  });
  win.webContents.on('render-process-gone', () => {
    if (win.isDestroyed() || win !== interviewWindow) return;
    interviewCloseApproved = true;
    win.destroy();
    if (!closingMain)
      dialog.showErrorBox('面试窗口已关闭', '面试窗口发生异常，已停止本场采集并恢复主窗口。');
  });
}
const componentRoot = path.join(app.getPath('userData'), 'component-cache');
const componentMarker = path.join(process.resourcesPath, 'voxcue-components.json');
const developmentModelsMissing =
  !speechModelInstalled(resources.speechModels) ||
  !['config.json', 'tokenizer.json', 'onnx/model_quantized.onnx'].every((file) =>
    existsSync(path.join(resources.ragModel, file)),
  );
const managedComponents = app.isPackaged ? existsSync(componentMarker) : developmentModelsMissing;
if (managedComponents) {
  if (app.isPackaged && JSON.parse(readFileSync(componentMarker, 'utf8')).schemaVersion !== 1)
    throw Error('Invalid component layout');
  Object.assign(
    resources,
    componentPaths(componentRoot, packagesFor(process.platform, process.arch)),
  );
}
// Optional Qwen is managed even in development installs with bundled legacy models.
if (packagesFor(process.platform, process.arch).some((pkg) => pkg.id === 'qwen'))
  resources.qwenModels = componentPaths(
    componentRoot,
    packagesFor(process.platform, process.arch),
  ).qwenModels;
if (desktopPlatform.nativeWindowControls || desktopPlatform.presentationFile) {
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    process.exit(0);
  }
  app.on('second-instance', () => {
    const win = interviewWindow ?? mainWindow ?? loginWindow;
    if (win && !win.isDestroyed()) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    } else app.emit('activate');
  });
}
function createMainWindow() {
  if (mainWindow) return;
  closingMain = false;
  sessionHasContent = false;
  mainCloseApproved = false;
  mainCloseFlushed = false;
  pendingMainClose = null;
  mainWindow = new BrowserWindow(windowOptions('main', desktopPlatform, windowPaths));
  restrictWindowNavigation(mainWindow);
  nativePresentation?.configureMain?.(mainWindow);
  const focusChanged = (focused: boolean) => {
    if (mainWindow && !mainWindow.isDestroyed())
      sendDesktop(mainWindow.webContents, 'appearance:window-focus-changed', focused);
  };
  mainWindow.on('focus', () => focusChanged(true));
  mainWindow.on('blur', () => focusChanged(false));
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
    loginWindow?.close();
    void updates?.start();
  });
  loadWindowPage(mainWindow, 'main', indexFile, process.env.VITE_DEV_SERVER_URL);
  mainWindow.on('closed', () => {
    speechSessions?.releaseDictation();
    mainWindow = null;
    if (macQuitRequested) app.quit();
  });
  mainWindow.webContents.on('did-start-loading', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      nativePresentation?.setScrollChrome?.(mainWindow, null);
      nativePresentation?.setContentControls?.(mainWindow, [], () => {});
      nativePresentation?.setInterviewMaterials?.(mainWindow, []);
      for (const action of ['sidebar', 'profile', 'start'] as const)
        nativePresentation?.setGlassButton?.(mainWindow, action, null, () => {});
      nativePresentation?.setSidebarGlass?.(mainWindow, 0);
    }
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
          if (response !== 1 && desktopPlatform.nativeWindowControls) macQuitRequested = false;
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
        if (desktopPlatform.nativeWindowControls) macQuitRequested = false;
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
  const speechHardware = new SpeechHardwareProbe(
    resources.audioHelper,
    desktopPlatform.id,
    resources.qwenRuntime,
  );
  components = new ComponentService({
    root: componentRoot,
    packages: packagesFor(process.platform, process.arch),
    managed: managedComponents,
    managedIds: ['qwen'],
    fetch: (url, options) => session.fromPartition('voxcue-components').fetch(String(url), options),
    emit(state) {
      for (const win of [mainWindow, loginWindow, interviewWindow])
        if (win && !win.isDestroyed()) sendDesktop(win.webContents, 'components:event', state);
    },
    async prepareRemove(id) {
      if (interviewOpening || interviewWindow) return false;
      if (id === 'speech' || id === 'qwen') {
        if (speechSessions?.busy) return false;
        await speech?.close();
      } else {
        if (knowledgeCoordinator?.busy || chatIpc?.isBusy()) return false;
        await knowledge?.unloadModel();
      }
      return true;
    },
  });
  registerComponentIpc(
    components,
    (event) => {
      if (![mainWindow?.webContents, loginWindow?.webContents].includes(event.sender))
        throw Error('Unauthorized window');
    },
    (event) => {
      if (event.sender !== mainWindow?.webContents) throw Error('Unauthorized window');
    },
    (event) => {
      if (event.sender === interviewWindow?.webContents) requireInterview(event);
      else if (![mainWindow?.webContents, loginWindow?.webContents].includes(event.sender))
        throw Error('Unauthorized window');
    },
  );
  void components.status();
  nativePresentation?.initialize();
  if (desktopPlatform.nativeWindowControls) {
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        { role: 'appMenu' },
        { role: 'fileMenu' },
        { role: 'editMenu' },
        { role: 'windowMenu' },
      ]),
    );
  }
  const systemAccent = () => {
    try {
      const color = systemPreferences.getAccentColor();
      return /^[a-f0-9]{8}$/i.test(color) ? '#' + color.slice(0, 6) : null;
    } catch {
      return null;
    }
  };
  handleDesktop('appearance:theme', (event, ...args) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || ![loginWindow, mainWindow].includes(win)) throw new Error('Unauthorized window');
    if (event.senderFrame !== event.sender.mainFrame) throw Error('Unauthorized frame');
    if (args.length !== 1 || !['system', 'light', 'dark'].includes(args[0]))
      throw Error('Invalid theme');
    if (!nativePresentation || !desktopPlatform.presentation?.nativeTheme)
      throw Error('当前平台的原生外观尚未适配。');
    nativePresentation.setTheme(args[0]);
  });
  handleDesktop('appearance:accent', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || ![loginWindow, mainWindow, interviewWindow].includes(win))
      throw new Error('Unauthorized window');
    return systemAccent();
  });
  handleDesktop('appearance:sidebar-glass', (event, ...args) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win !== mainWindow || event.senderFrame !== event.sender.mainFrame)
      throw Error('Unauthorized window');
    const width = args[0];
    const toolbarHeight = args[1];
    const surfaceColor = args[2];
    const dark = args[3];
    if (
      args.length !== 4 ||
      typeof dark !== 'boolean' ||
      typeof surfaceColor !== 'string' ||
      !/^#[a-f0-9]{6}$/i.test(surfaceColor) ||
      typeof width !== 'number' ||
      !Number.isFinite(width) ||
      width < 0 ||
      width > 320 ||
      width > win.getContentBounds().width ||
      typeof toolbarHeight !== 'number' ||
      !Number.isFinite(toolbarHeight) ||
      toolbarHeight < 0 ||
      toolbarHeight > 96
    )
      throw Error('Invalid sidebar width');
    return (
      nativePresentation?.setSidebarGlass?.(win, width, toolbarHeight, surfaceColor, dark) ?? false
    );
  });
  handleDesktop('appearance:glass-button', (event, ...args) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win !== mainWindow || event.senderFrame !== event.sender.mainFrame)
      throw Error('Unauthorized window');
    const [action, placement] = args;
    if (args.length !== 2 || !['sidebar', 'profile', 'start'].includes(action))
      throw Error('Invalid material action');
    if (
      placement !== null &&
      (!placement ||
        typeof placement !== 'object' ||
        Array.isArray(placement) ||
        Object.keys(placement).sort().join(',') !==
          'behindContent,disabled,enabled,foregroundColor,height,hovered,pressed,width,x,y' ||
        typeof placement.hovered !== 'boolean' ||
        typeof placement.pressed !== 'boolean' ||
        typeof placement.behindContent !== 'boolean' ||
        typeof placement.foregroundColor !== 'string' ||
        !/^#[a-f0-9]{6}$/i.test(placement.foregroundColor) ||
        typeof placement.disabled !== 'boolean' ||
        typeof placement.enabled !== 'boolean' ||
        !(['x', 'y', 'width', 'height'] as const).every(
          (key) => typeof placement[key] === 'number' && Number.isFinite(placement[key]),
        ) ||
        placement.x < 0 ||
        placement.y < 0 ||
        placement.width < 28 ||
        placement.width > 220 ||
        placement.height < 28 ||
        placement.height > 48 ||
        placement.x + placement.width > win.getContentBounds().width ||
        placement.y + placement.height > win.getContentBounds().height)
    )
      throw Error('Invalid button placement');
    return (
      nativePresentation?.setGlassButton?.(win, action, placement, () => {
        if (!win.isDestroyed() && win === mainWindow)
          sendDesktop(win.webContents, 'appearance:glass-button-clicked', action);
      }) ?? false
    );
  });
  handleDesktop('appearance:window-focus', (event, ...args) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win !== mainWindow || event.senderFrame !== event.sender.mainFrame || args.length)
      throw Error('Unauthorized window');
    return win.isFocused();
  });
  const nativeFontControls = new WeakMap<BrowserWindow, Set<number>>();
  handleDesktop('appearance:content-controls', (event, ...args) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (
      !win ||
      ![mainWindow, interviewWindow].includes(win) ||
      event.senderFrame !== event.sender.mainFrame
    )
      throw Error('Unauthorized window');
    const controls = args[0],
      bounds = win.getContentBounds();
    const ids = new Set<number>();
    if (
      args.length !== 1 ||
      !Array.isArray(controls) ||
      controls.length > 256 ||
      controls.some((item) => {
        if (
          !item ||
          typeof item !== 'object' ||
          Object.keys(item).sort().join(',') !==
            'checked,color,covered,disabled,focused,height,hovered,id,kind,label,opacity,overGlass,pressed,symbol,symbolColor,trailing,value,width,x,y'
        )
          return true;
        if (
          !Number.isSafeInteger(item.id) ||
          item.id < 1 ||
          item.id > 1_000_000_000 ||
          ids.has(item.id)
        )
          return true;
        ids.add(item.id);
        return (
          ![
            'button',
            'button-glass',
            'button-hover',
            'font-slider',
            'popup',
            'search',
            'switch',
            'button-background',
            'progress',
          ].includes(item.kind) ||
          (item.kind === 'font-slider' &&
            (!/^\d+$/.test(item.value) ||
              Number(item.value) < 12 ||
              Number(item.value) > 24 ||
              item.overGlass)) ||
          (item.kind === 'progress' &&
            item.value !== '' &&
            (typeof item.value !== 'string' ||
              !/^\d+(?:\.\d+)?(?:e-\d+)?$/.test(item.value) ||
              !Number.isFinite(Number(item.value)) ||
              Number(item.value) < 0 ||
              Number(item.value) > 100)) ||
          (win === interviewWindow &&
            !(
              (item.kind === 'button-background' && item.overGlass === true) ||
              ['button', 'popup', 'font-slider'].includes(item.kind)
            )) ||
          typeof item.label !== 'string' ||
          item.label.length > 300 ||
          typeof item.value !== 'string' ||
          item.value.length > 6000 ||
          typeof item.color !== 'string' ||
          !/^#[a-f0-9]{6}$/i.test(item.color) ||
          (item.symbol !== null &&
            (typeof item.symbol !== 'string' || !/^[a-z0-9.]{1,100}$/i.test(item.symbol))) ||
          (item.symbolColor !== null &&
            (typeof item.symbolColor !== 'string' || !/^#[a-f0-9]{6}$/i.test(item.symbolColor))) ||
          !(
            [
              'disabled',
              'covered',
              'overGlass',
              'pressed',
              'focused',
              'checked',
              'hovered',
              'trailing',
            ] as const
          ).every((key) => typeof item[key] === 'boolean') ||
          typeof item.opacity !== 'number' ||
          !Number.isFinite(item.opacity) ||
          item.opacity < 0 ||
          item.opacity > 1 ||
          !(['x', 'y', 'width', 'height'] as const).every(
            (key) => typeof item[key] === 'number' && Number.isFinite(item[key]),
          ) ||
          item.x < 0 ||
          item.y < 0 ||
          item.width < 12 ||
          item.height < 12 ||
          item.height > 100 ||
          item.x + item.width > bounds.width + 1 ||
          item.y + item.height > bounds.height + 1
        );
      })
    )
      throw Error('Invalid content controls');
    nativeFontControls.set(
      win,
      new Set(
        controls
          .filter((item) => item.kind === 'font-slider' && !item.disabled && !item.covered)
          .map((item) => item.id),
      ),
    );
    return (
      nativePresentation?.setContentControls?.(win, controls, (id, value) => {
        if (win.isDestroyed()) return;
        if (typeof value === 'number') {
          if (
            Number.isInteger(value) &&
            value >= 12 &&
            value <= 24 &&
            nativeFontControls.get(win)?.has(id)
          )
            sendDesktop(win.webContents, 'appearance:content-range', id, value);
          return;
        }
        if (win !== mainWindow) return;
        if (typeof value === 'boolean')
          sendDesktop(win.webContents, 'appearance:content-toggle', id, value);
        else sendDesktop(win.webContents, 'appearance:content-search', id, value.slice(0, 6000));
      }) ?? false
    );
  });
  handleDesktop('appearance:interview-materials', (event, ...args) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (
      !win ||
      ![mainWindow, interviewWindow].includes(win) ||
      event.senderFrame !== event.sender.mainFrame
    )
      throw Error('Unauthorized window');
    const materials = args[0],
      bounds = win.getContentBounds(),
      ids = new Set<number>();
    const rectangle = (value: unknown, clip = false) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
      const area = value as Record<string, number>;
      return (
        (clip ? Object.keys(area).sort().join(',') === 'height,width,x,y' : true) &&
        ['x', 'y', 'width', 'height'].every(
          (key) =>
            typeof area[key] === 'number' &&
            Number.isFinite(area[key]) &&
            Math.abs(area[key]) <= 100_000,
        ) &&
        area.width > 0 &&
        area.height > 0 &&
        (!clip ||
          (area.x >= 0 &&
            area.y >= 0 &&
            area.x + area.width <= bounds.width + 1 &&
            area.y + area.height <= bounds.height + 1))
      );
    };
    if (
      args.length !== 1 ||
      !Array.isArray(materials) ||
      materials.length > 256 ||
      materials.some((item) => {
        if (
          !item ||
          typeof item !== 'object' ||
          Array.isArray(item) ||
          Object.keys(item).sort().join(',') !==
            'clip,dark,fadeBottom,height,id,opacity,radius,round,style,width,x,y' ||
          !Number.isSafeInteger(item.id) ||
          item.id < 1 ||
          item.id > 1_000_000_000 ||
          ids.has(item.id)
        )
          return true;
        ids.add(item.id);
        return (
          !(
            win === mainWindow
              ? ['clear', 'regular', 'preview-scene']
              : [
                  'clear',
                  'regular',
                  'regular-dark',
                  'regular-interactive',
                  'regular-follow-hover',
                  'dialog-halo',
                ]
          ).includes(item.style) ||
          !rectangle(item) ||
          !rectangle(item.clip, true) ||
          typeof item.radius !== 'number' ||
          typeof item.round !== 'boolean' ||
          typeof item.dark !== 'boolean' ||
          !Number.isFinite(item.radius) ||
          item.radius < 0 ||
          item.radius > 1000 ||
          typeof item.fadeBottom !== 'number' ||
          !Number.isFinite(item.fadeBottom) ||
          item.fadeBottom < 0 ||
          item.fadeBottom > 1000 ||
          typeof item.opacity !== 'number' ||
          !Number.isFinite(item.opacity) ||
          item.opacity < 0 ||
          item.opacity > 1
        );
      })
    )
      throw Error('Invalid interview materials');
    return nativePresentation?.setInterviewMaterials?.(win, materials) ?? false;
  });
  handleDesktop('appearance:scroll-chrome', (event, ...args) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win !== mainWindow || event.senderFrame !== event.sender.mainFrame)
      throw Error('Unauthorized window');
    const state = args[0],
      bounds = win.getContentBounds();
    const rectangle = (value: unknown) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
      const area = value as Record<string, unknown>;
      return (
        Object.keys(area).sort().join(',') === 'height,width,x,y' &&
        ['x', 'y', 'width', 'height'].every(
          (key) => typeof area[key] === 'number' && Number.isFinite(area[key]),
        ) &&
        Number(area.x) >= 0 &&
        Number(area.y) >= 0 &&
        Number(area.width) > 0 &&
        Number(area.height) > 0 &&
        Number(area.x) + Number(area.width) <= bounds.width + 1 &&
        Number(area.y) + Number(area.height) <= bounds.height + 1
      );
    };
    if (
      args.length !== 1 ||
      (state !== null &&
        (!state ||
          typeof state !== 'object' ||
          Array.isArray(state) ||
          Object.keys(state).sort().join(',') !==
            'area,composer,follow,followHovered,foregroundColor,headerOpacity,modal,modalRadius,title,titleOpacity,titleText,topHeight' ||
          !rectangle(state.area) ||
          !rectangle(state.title) ||
          typeof state.titleText !== 'string' ||
          state.titleText.length > 100 ||
          (state.composer !== null && !rectangle(state.composer)) ||
          (state.follow !== null && !rectangle(state.follow)) ||
          typeof state.followHovered !== 'boolean' ||
          (state.modal !== null && !rectangle(state.modal)) ||
          typeof state.foregroundColor !== 'string' ||
          !/^#[a-f0-9]{6}$/i.test(state.foregroundColor) ||
          !(['topHeight', 'headerOpacity', 'modalRadius', 'titleOpacity'] as const).every(
            (key) =>
              typeof state[key] === 'number' && Number.isFinite(state[key]) && state[key] >= 0,
          ) ||
          state.headerOpacity > 1 ||
          state.titleOpacity > 1 ||
          state.topHeight > 96 ||
          state.modalRadius > 128))
    )
      throw Error('Invalid scroll chrome');
    return nativePresentation?.setScrollChrome?.(win, state) ?? false;
  });
  handleDesktop('appearance:native-menu', (event, ...args) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (
      !win ||
      ![mainWindow, interviewWindow].includes(win) ||
      event.senderFrame !== event.sender.mainFrame
    )
      throw Error('Unauthorized window');
    const request = args[0];
    if (
      args.length !== 1 ||
      !request ||
      typeof request !== 'object' ||
      Array.isArray(request) ||
      Object.keys(request).sort().join(',') !== 'align,anchor,items,side,width' ||
      !['top', 'bottom'].includes(request.side) ||
      !['start', 'end'].includes(request.align) ||
      typeof request.width !== 'number' ||
      !Number.isFinite(request.width) ||
      request.width < 32 ||
      request.width > win.getContentBounds().width ||
      !request.anchor ||
      typeof request.anchor !== 'object' ||
      Array.isArray(request.anchor) ||
      Object.keys(request.anchor).sort().join(',') !== 'height,width,x,y' ||
      !(['x', 'y', 'width', 'height'] as const).every(
        (key) => typeof request.anchor[key] === 'number' && Number.isFinite(request.anchor[key]),
      ) ||
      request.anchor.x < 0 ||
      request.anchor.y < 0 ||
      request.anchor.width <= 0 ||
      request.anchor.height <= 0 ||
      request.anchor.x + request.anchor.width > win.getContentBounds().width + 1 ||
      request.anchor.y + request.anchor.height > win.getContentBounds().height + 1 ||
      !Array.isArray(request.items) ||
      !request.items.length ||
      request.items.length > 128 ||
      request.items.some(
        (item) =>
          !item ||
          typeof item !== 'object' ||
          Array.isArray(item) ||
          Object.keys(item).sort().join(',') !==
            'checked,disabled,label,separator,symbol,symbolColor' ||
          typeof item.label !== 'string' ||
          item.label.length > 200 ||
          (item.symbol !== null &&
            (typeof item.symbol !== 'string' ||
              item.symbol.length > 100 ||
              !/^[a-z0-9.]+$/.test(item.symbol))) ||
          (item.symbolColor !== null &&
            (typeof item.symbolColor !== 'string' || !/^#[a-f0-9]{6}$/i.test(item.symbolColor))) ||
          !(['separator', 'disabled', 'checked'] as const).every(
            (key) => typeof item[key] === 'boolean',
          ),
      )
    )
      throw Error('Invalid native menu');
    return nativePresentation?.popUpNativeMenu?.(win, request) ?? null;
  });
  systemPreferences.on('accent-color-changed', () => {
    const color = systemAccent();
    for (const win of [loginWindow, mainWindow, interviewWindow])
      if (win && !win.isDestroyed())
        sendDesktop(win.webContents, 'appearance:accent-changed', color);
  });
  auth = new ChatGPTAuthService({
    storage: createAuthStorage(
      desktopPlatform.credentialEncryptionLabel,
      desktopPlatform.credentialEncryptionFile
        ? require(
            path.join(app.getAppPath(), 'dist-electron', desktopPlatform.credentialEncryptionFile),
          ).createCredentialEncryption(
            path.join(
              app.isPackaged ? process.resourcesPath : app.getAppPath(),
              app.isPackaged ? 'native' : 'native/bin',
              'VoxCue.Credentials',
            ),
          )
        : undefined,
    ),
    openBrowser: (url) => shell.openExternal(url),
    callbackLogo: () => readFile(resources.brandLogo),
  });
  chat = new ChatGPTService({
    access: () => auth.access(),
    ledger: new UsageLedger(path.join(app.getPath('userData'), 'chat-usage')),
  });
  const requireMain = (event: Electron.IpcMainInvokeEvent) => {
    if (event.sender !== mainWindow?.webContents) throw new Error('Unauthorized window');
  };
  const updatePreferences = path.join(app.getPath('userData'), 'update-settings.json');
  updates = new UpdateService({
    currentVersion: app.getVersion(),
    autoDownload: readAutoDownload(updatePreferences),
    saveAutoDownload: (enabled) => saveAutoDownload(updatePreferences, enabled),
    driver:
      app.isPackaged && desktopPlatform.updateDriverFile
        ? require(
            path.join(app.getAppPath(), 'dist-electron', desktopPlatform.updateDriverFile),
          ).createMacUpdateDriver()
        : createUpdateDriver(app.isPackaged),
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
      if (desktopPlatform.nativeWindowControls) macQuitRequested = false;
    }
  });
  const requireLogin = (event: Electron.IpcMainInvokeEvent) => {
    if (event.sender !== loginWindow?.webContents || event.senderFrame !== event.sender.mainFrame)
      throw new Error('Unauthorized window');
  };
  handleDesktop('auth:session', async (event) => {
    if (event.sender !== loginWindow?.webContents) requireMain(event);
    if (event.senderFrame !== event.sender.mainFrame) throw Error('Unauthorized frame');
    const session = demoSession
      ? {
          mode: 'demo' as const,
          user: { id: 'local-demo', name: '本地用户', email: '' },
          expiresAt: null,
        }
      : await auth.session();
    return session;
  });
  const signIn = async () => {
    if (signingIn || auth.isPending()) throw Error('已有登录操作正在进行。');
    signingIn = true;
    try {
      demoSession = false;
      const session = await auth.signIn();
      if (!loginWindow || loginWindow.isDestroyed()) throw Error('登录窗口已关闭。');
      // Fast reauthentication can finish while the signed-out main window is
      // still flushing its chat store. Wait for its normal saved close before
      // creating the next window; createMainWindow deliberately reuses no window.
      if (mainWindow) {
        const outgoing = mainWindow;
        if (!mainCloseApproved) throw Error('主窗口尚未完成退出，请稍后重试。');
        await new Promise<void>((resolve, reject) => {
          const finish = (error?: Error) => {
            clearTimeout(timer);
            outgoing.removeListener('closed', closed);
            cancelLoginWait = undefined;
            if (error) reject(error);
            else resolve();
          };
          const closed = () => finish();
          const timer = setTimeout(() => {
            finish(Error('聊天尚未保存，请完成保存后重试登录。'));
          }, 15000);
          cancelLoginWait = () => finish(Error('登录已取消。'));
          outgoing.once('closed', closed);
          outgoing.close();
        });
        if (!loginWindow || loginWindow.isDestroyed()) throw Error('登录窗口已关闭。');
      }
      createMainWindow();
      return session;
    } finally {
      signingIn = false;
    }
  };
  handleDesktop('auth:sign-in', async (event) => {
    requireLogin(event);
    return signIn();
  });
  handleDesktop('auth:cancel', (event) => {
    requireLogin(event);
    cancelLoginWait?.();
    auth.cancel();
  });
  handleDesktop('auth:demo', (event) => {
    requireLogin(event);
    if (app.isPackaged || !process.env.COPILOT_TEST_USER_DATA) throw Error('测试入口不可用。');
    if (auth.isPending()) throw new Error('请先取消正在进行的登录。');
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
    const result = await auth.signOut();
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
  registerKnowledgeIpc(knowledgeCoordinator, requireMain, () => components.require('rag'));
  const ragChat = new RagChatService(
    chat,
    knowledge,
    () => knowledgeCoordinator.getMode(),
    () => components.require('rag'),
  );
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
    updateModel: (value, models) => speechSessions!.updateModel(value, models),
    context: interviewContext,
    captureScreen: (signal) =>
      captureInterviewScreenshot(interviewWindow!, desktopPlatform.id, signal),
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
  if (!resources.speechProcess) throw Error('当前系统尚未支持本地音频采集。');
  const speechDirectory = path.dirname(resources.speechProcess);
  // Native entry paths come from the selected platform policy, never from IPC.
  const capture: {
    devices(helper: string): Promise<AudioDevice[]>;
    probeDevice(
      helper: string,
      source: AudioSource,
      device?: string,
    ): Promise<{ ok: boolean; code?: string }>;
  } = require(path.join(speechDirectory, 'capture.js'));
  const access: {
    InterviewAccess: new (dependencies: {
      platform: string;
      microphonePermission(): string;
      devices(): Promise<AudioDevice[]>;
      probe(source: AudioSource, device?: string): Promise<{ ok: boolean; code?: string }>;
    }) => { check(options: SpeechOptions): Promise<InterviewAccessReport> };
  } = require(path.join(speechDirectory, 'access.js'));
  const interviewAccess = new access.InterviewAccess({
    platform: desktopPlatform.id,
    microphonePermission: () => systemPreferences.getMediaAccessStatus('microphone'),
    devices: async () => {
      if (!audioHelper) throw Error('当前系统尚未支持本地音频采集。');
      return capture.devices(audioHelper);
    },
    probe: async (source, device) => {
      if (!audioHelper) return { ok: false };
      return capture.probeDevice(audioHelper, source, device);
    },
  });
  const speechModelRoot = resources.speechModels;
  let screenCaptureAccess: ScreenCaptureAccess | undefined;
  if (desktopPlatform.id === 'darwin') {
    const {
      ScreenPermission,
    }: {
      ScreenPermission: new (dependencies: {
        mediaStatus(): string;
        binding(): { preflight(): boolean; request(): Promise<boolean> };
        openSettings(): Promise<void>;
      }) => ScreenCaptureAccess;
    } = require(path.join(app.getAppPath(), 'dist-electron/macos/electron/screenPermission.js'));
    screenCaptureAccess = new ScreenPermission({
      mediaStatus: () => systemPreferences.getMediaAccessStatus('screen'),
      binding: () => {
        if (!resources.screenPermission) throw Error('Screen permission binding unavailable');
        return require(resources.screenPermission);
      },
      openSettings: () => {
        if (!desktopPlatform.screenCaptureSettingsUrl) throw Error('Invalid request');
        return shell.openExternal(desktopPlatform.screenCaptureSettingsUrl);
      },
    });
  }
  if (desktopPlatform.id === 'win32') {
    const { ScreenPermission }: { ScreenPermission: new () => ScreenCaptureAccess } = require(
      path.join(app.getAppPath(), 'dist-electron/windows/electron/screenPermission.js'),
    );
    screenCaptureAccess = new ScreenPermission();
  }
  registerScreenCaptureIpc(screenCaptureAccess, requireMain);
  const checkInterviewAccess = async (options: SpeechOptions): Promise<InterviewAccessReport> => {
    const report = await interviewAccess.check(options);
    // Screenshot access is independent and optional for an audio-only interview.
    return screenCaptureAccess
      ? { ...report, screenCapture: await screenCaptureAccess.call('check') }
      : report;
  };
  speech = new SpeechHost(
    speechModelRoot,
    audioHelper,
    (event) => {
      if (
        (speechSessions?.target === 'dictation' ||
          (speechSessions?.target === 'audio-test' &&
            (event.type === 'status' || event.type === 'activity'))) &&
        mainWindow &&
        !mainWindow.isDestroyed()
      )
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
    resources.qwenModels,
    resources.qwenRuntime,
  );
  speechSessions = new SpeechCoordinator(speech);
  handleDesktop('speech:hardware', (event) => {
    if (event.sender === mainWindow?.webContents) {
      requireMain(event);
      if (event.senderFrame !== event.sender.mainFrame) throw Error('Unauthorized frame');
    } else requireInterview(event);
    return speechHardware.read();
  });
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
    const fallback =
      !components.ready('speech') && components.ready('qwen')
        ? { speechModel: 'qwen' as const, inferenceDevice: 'cpu' as const }
        : undefined;
    if (['start', 'test'].includes((value as { op: string })?.op))
      components.require(fallback ? 'qwen' : 'speech');
    return speechSessions!.dictation(value, fallback);
  });
  handleDesktop('interview:reconnect-audio', async (event, options) => {
    requireInterview(event);
    const validated = validateSpeech({
      op: 'start',
      options: options ?? speechSessions?.configuration?.options,
    });
    if (validated.op !== 'start') throw Error('Invalid speech options');
    if (validated.options.speechModel === 'qwen' && !resources.qwenModels)
      throw Error('当前平台尚未接入 Qwen 原生推理。');
    await speechHardware.require(validated.options);
    components.require(speechComponent(validated.options));
    return speechSessions!.reconnect(options);
  });
  handleDesktop('interview:check-access', async (event, value: unknown) => {
    requireMain(event);
    if (event.senderFrame !== event.sender.mainFrame) throw Error('Unauthorized frame');
    const configuration = validateInterviewConfiguration(value);
    if (configuration.mode !== 'local') throw Error('请选择本地音频设备。');
    return checkInterviewAccess(configuration.options);
  });
  handleDesktop('interview:microphone-settings', (event, source: unknown = 'microphone') => {
    requireMain(event);
    if (
      event.senderFrame !== event.sender.mainFrame ||
      !['microphone', 'system'].includes(source as string)
    )
      throw Error('Invalid request');
    const url =
      source === 'system'
        ? desktopPlatform.systemAudioSettingsUrl
        : desktopPlatform.microphoneSettingsUrl;
    if (!url) throw Error('Invalid request');
    return shell.openExternal(url);
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
      if (configuration.options.speechModel === 'qwen' && !resources.qwenModels)
        throw Error('当前平台尚未接入 Qwen 原生推理。');
      await speechHardware.require(configuration.options);
      components.require(speechComponent(configuration.options));
      if (configuration.knowledgeBaseId) components.require('rag');
      if (!demoSession && (configuration.mode !== 'local' || !configuration.aiEnabled))
        throw Error('请先连接模型服务并选择回答模型。');
      if (configuration.aiEnabled) {
        if (demoSession) throw Error('请先连接模型服务并选择可用的回答模型。');
        validateInterviewModel(configuration, await chat.models(false));
      }
      if (configuration.mode === 'local') {
        if (configuration.options.speechModel !== 'qwen' && !speechModelInstalled(speechModelRoot))
          throw Error('本地语音模型未安装，请先下载模型后再开始面试。');
        const access = await checkInterviewAccess(configuration.options);
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
    pinInterview(interviewWindow!);
    return interviewWindow!.isAlwaysOnTop();
  });
  handleDesktop('interview:collapse', (event) => {
    requireInterview(event);
    interviewMove = undefined;
    interviewResize = undefined;
    interviewCollapsed = !interviewCollapsed;
    sizeInterview(interviewScale);
    return interviewCollapsed;
  });
  handleDesktop('interview:transcript', (event, visible: unknown) => {
    requireInterview(event);
    interviewMove = undefined;
    if (typeof visible !== 'boolean') throw Error('Invalid transcript visibility');
    interviewResize = undefined;
    interviewTranscriptVisible = visible;
    if (!interviewCollapsed) sizeInterview(interviewScale);
    return interviewTranscriptVisible;
  });
  handleDesktop('interview:move', (event, ...args: unknown[]) => {
    requireInterview(event);
    const change = args[0];
    if (
      args.length !== 1 ||
      !change ||
      typeof change !== 'object' ||
      Array.isArray(change) ||
      Object.keys(change).length !== 1 ||
      !Object.hasOwn(change, 'phase') ||
      !['start', 'move', 'end'].includes((change as { phase: string }).phase)
    )
      throw Error('Invalid window move');
    const { phase } = change as { phase: 'start' | 'move' | 'end' };
    if (phase === 'end') {
      interviewMove = undefined;
      return;
    }
    if (phase === 'start') {
      interviewResize = undefined;
      const pointer = screen.getCursorScreenPoint();
      interviewMove = {
        bounds: interviewWindow!.getBounds(),
        pointer,
        lastPointer: pointer,
      };
      setInterviewMousePassthrough(false);
      return;
    }
    if (!interviewMove) return;
    const cursor = screen.getCursorScreenPoint();
    if (cursor.x === interviewMove.lastPointer.x && cursor.y === interviewMove.lastPointer.y)
      return;
    interviewMove.lastPointer = cursor;
    const x = Math.round(interviewMove.bounds.x + cursor.x - interviewMove.pointer.x);
    const y = Math.round(interviewMove.bounds.y + cursor.y - interviewMove.pointer.y);
    const current = interviewWindow!.getBounds();
    if (current.x !== x || current.y !== y) {
      if (nativePresentation?.moveInterview)
        return nativePresentation.moveInterview(interviewWindow!, {
          ...interviewMove.bounds,
          x,
          y,
        });
      else interviewWindow!.setPosition(x, y, false);
    }
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
        interviewMove = undefined;
        const pointer = screen.getCursorScreenPoint();
        const bounds = interviewWindow.getBounds();
        interviewResize = {
          bounds,
          pointer,
          lastPointer: pointer,
          edge: change.edge,
          // The panels are sized from viewport height. At fractional Windows
          // DPI the last requested scale and actual HWND bounds can differ;
          // anchor this gesture to the visible geometry to avoid an initial jump.
          scale: Math.max(
            0,
            (bounds.height - interviewLayout.chromeHeight) / interviewLayout.panelHeight,
          ),
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
  onDesktop('interview:confirm-end', (event, ...args: unknown[]) => {
    if (
      event.sender !== interviewWindow?.webContents ||
      event.senderFrame !== event.sender.mainFrame ||
      args.length
    )
      return;
    interviewCloseApproved = true;
    interviewWindow.close();
  });
  onDesktop('interview:mouse-passthrough', (event, ...args: unknown[]) => {
    if (
      !nativePresentation ||
      !desktopPlatform.presentation?.interviewMousePassthrough ||
      event.sender !== interviewWindow?.webContents ||
      event.senderFrame !== event.sender.mainFrame ||
      args.length !== 1 ||
      typeof args[0] !== 'boolean'
    )
      return;
    if (args[0] && interviewMove) return;
    setInterviewMousePassthrough(args[0]);
  });
  onDesktop('window:action', (event, action: unknown, ...extra: unknown[]) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (
      !win ||
      (win !== mainWindow && win !== interviewWindow) ||
      event.senderFrame !== event.sender.mainFrame ||
      extra.length
    )
      return;
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
    if (BrowserWindow.getAllWindows().length !== 0) return;
    if (!desktopPlatform.nativeWindowControls) return createLoginWindow();
    void auth
      .session()
      .then((session) => {
        if (BrowserWindow.getAllWindows().length) return;
        if (session) createMainWindow();
        else createLoginWindow();
      })
      .catch(() => createLoginWindow());
  });
});
app.on('window-all-closed', () => {
  if (desktopPlatform.quitOnAllWindowsClosed) app.quit();
});
app.on('before-quit', (event) => {
  if (desktopPlatform.nativeWindowControls) macQuitRequested = true;
  if (mainWindow && !mainWindow.isDestroyed() && !mainCloseFlushed) {
    event.preventDefault();
    mainWindow.close();
    return;
  }
  updates?.dispose();
  components?.dispose();
  nativePresentation?.dispose();
  knowledgeCoordinator?.cancelAll();
  knowledge?.stop();
  historyJobs?.cancelAll();
  speech?.stop();
  interviewIpc?.cancel();
  auth?.cancel();
});
