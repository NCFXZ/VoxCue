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
  powerMonitor,
  globalShortcut,
} from 'electron';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { migrateUserData } from './userData';
import { encodeScreenshotBitmap } from './backend/screenshot/host';
import { runtimeEnvironment, restrictSessionPermissions } from './runtimePolicy';
import { packagesFor } from './backend/components/catalog';
import { ComponentService, componentPaths } from './backend/components/service';
import { registerComponentIpc } from './ipc/components';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ChatGPTAuthService } from './backend/auth/service';
import { ManagedChatGPTAuth } from './backend/auth/managed';
import { createAuthStorage } from './backend/auth/storage';
import { CloudAccountClient, cloudOrigin } from './backend/cloud/client';
import { LocalMode } from './backend/localMode';
import { Telemetry } from './backend/telemetry/service';
import { registerTelemetryIpc } from './ipc/telemetry';
import type { TelemetryStage } from './contracts/telemetry';
import type { CloudAccountState } from './contracts/cloudAccount';
import { createCloudVault, createCredentialVault } from './backend/cloud/vault';
import type { TelemetryProofState } from './backend/telemetry/identity';
import { CloudSyncClient } from './backend/cloud/sync';
import { AccountArchive } from './backend/accountArchive';
import { accountErasureMarker, eraseLocalAccount } from './backend/accountErasure';
import { ChatGPTService } from './backend/chat/service';
import { CodexUsageRuntime } from './backend/chat/codexUsage';
import { ChatGPTAccountUsage } from './backend/chat/accountUsage';
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
import { checkTranscriptionAccess } from './application/transcriptionAccess';
import { InterviewAudioIntent } from './application/interviewAudioIntent';
import { captureInterviewScreenshot, prepareInterviewScreenshot } from './screenshot';
import { InterviewImageStore } from './backend/interview/images';
import { registerInterviewImageIpc } from './ipc/interviewImages';
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
  InterviewConfiguration,
  SpeechOptions,
} from './contracts/speech';
import { validateSpeech } from './backend/speech/validation';
import { speechModelInstalled } from './backend/speech/models';
import { speechComponent, questionSource, inputSources } from './contracts/speechSettings';
import {
  SpeechCoordinator,
  validateInterviewConfiguration,
  validateInterviewModel,
  validateInterviewInput,
} from './application/speech';
import { handleDesktop, onDesktop, sendDesktop } from './ipc/handle';
import { InterviewShortcutController, interviewShortcutsBounds } from './interviewShortcuts';
import { defaultShortcuts } from './contracts/shortcuts';
import type { InterviewShortcutsState } from './contracts/desktop';
import { readShortcuts, writeShortcuts } from './backend/shortcutPreferences';
import { registerInterviewShortcutsIpc, registerShortcutSettingsIpc } from './ipc/interviewShortcuts';
import { RemoteConnectionService } from './backend/remoteConnection/service';
import { createMobileAssets } from './backend/remoteConnection/assets';
import { RemoteInterviewCoordinator } from './application/remoteConnection';
import { registerRemoteConnectionIpc } from './ipc/remoteConnection';
import type { RemoteConnectionState } from './contracts/remoteConnection';
import { WindowVisibility } from './windowVisibility';
import { revealExistingInterview } from './interviewActivation';
import { selectDesktopPlatform, desktopResources } from './platform';
import {
  windowOptions,
  whenWindowReady,
  restrictWindowNavigation,
  loadWindowPage,
  guardQuitDrain,
} from './window';
import type { NativePresentation } from './presentation';
import {
  isUILanguage,
  systemUILanguage,
  translateUI,
  type UILanguage,
} from './contracts/uiLanguage';
import {
  fitInterviewBounds,
  draggedInterviewScale,
  interviewLayout,
  interviewToolbarPoint,
} from './contracts/interviewLayout';
const systemLanguage = systemUILanguage(app.getPreferredSystemLanguages()[0]);
let uiLanguage: UILanguage = systemLanguage;
const nativeText = (source: string) => translateUI(source, uiLanguage);
let knowledge: KnowledgeHost;
let knowledgeCoordinator: KnowledgeCoordinator;
let auth: ChatGPTAuthService;
let copilotAuth: CopilotAuthService;
let copilotRuntime: CopilotRuntime;
let codexUsageRuntime: CodexUsageRuntime;
let chatGPTUsage: ChatGPTAccountUsage;
let chat: AIChatService;
let telemetry: Telemetry | undefined;
let telemetryClosed = false;
let telemetryClosing = false;
let signingIn = false;
let cancelLoginWait: (() => void) | undefined;
let chatIpc: ReturnType<typeof registerChatIpc> | undefined;
let interviewIpc: ReturnType<typeof registerInterviewIpc> | undefined;
let remoteConnection: RemoteConnectionService | undefined;
let remoteInterview: RemoteInterviewCoordinator | undefined;
let remotePresentationRevision = 0;
let historyJobs: ReturnType<typeof registerHistoryIpc> | undefined;
let updates: UpdateService | undefined;
let updatesClosed = false;
let updatesClosing = false;
let components: ComponentService;
let updateWasInstalling = false;
let interviewOpening = false;
let updateFlush: { resolve(saved: boolean): void; reject(error: Error): void } | null = null;
let speech: SpeechHost | undefined;
let speechSessions: SpeechCoordinator | undefined;
const interviewAudioIntent = new InterviewAudioIntent();
const interviewContext = new InterviewContext();
let demoSession = false;
let erasingAccount = false;
let leavingAccount = false;
let accountArchive: AccountArchive | undefined;

let macQuitRequested = false;
let mainWindow: BrowserWindow | null = null;
let loginWindow: BrowserWindow | null = null;
let interviewWindow: BrowserWindow | null = null;
let checkedMicrophone: { owner: BrowserWindow; device?: string } | undefined;
let interviewShortcutsWindow: BrowserWindow | null = null;
let interviewShortcutsReady = false;
let interviewShortcutsRequested = false;
let interviewVisibility: WindowVisibility | undefined;
let shortcutsVisibility: WindowVisibility | undefined;
const surfaceReadyCallbacks = new WeakMap<BrowserWindow, () => void>();
const surfaceRevisions = new WeakMap<BrowserWindow, number>();
const interviewRevealCallbacks = new WeakMap<BrowserWindow, (focus: boolean) => void>();
let releaseInterviewShortcuts: (() => void) | undefined;
let shortcutController: InterviewShortcutController;
let shortcutSettingsReady: Promise<void>;
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
let interviewSettingsOpen = false;
let interviewTranscriptVisible = true;
let interviewScale = 1;
let interviewCanvasLayout: import('./contracts/desktop').InterviewCanvasLayout | undefined;
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
      interviewOpen: () => !!interviewWindow && !interviewWindow.isDestroyed(),
    })
  : undefined;
const desktopPlatform = {
  ...platformPolicy,
  presentation: nativePresentation?.capabilities ?? platformPolicy.presentation,
};
const indexFile = path.join(app.getAppPath(), 'dist/index.html');
const environment = runtimeEnvironment(app.isPackaged, process.env);
app.on('session-created', (created) =>
  restrictSessionPermissions(created, indexFile, environment.devServerUrl),
);
app.setName('VoxCue');
try {
  // Resolve/migrate before any session, credential store, model cache or window is created.
  // Isolated test profiles must bypass real user data and migration entirely.
  const isolated = environment.userData;
  if (isolated) mkdirSync(isolated, { recursive: true });
  const directory = isolated ?? migrateUserData(app.getPath('appData'));
  app.setPath('userData', directory);
  app.setPath('sessionData', directory);
} catch (error) {
  dialog.showErrorBox(
    nativeText('应用数据迁移未完成'),
    nativeText(error instanceof Error ? error.message : '请检查数据目录后重试。'),
  );
  app.exit(1);
}
if (desktopPlatform.appUserModelId && !process.windowsStore)
  app.setAppUserModelId(desktopPlatform.appUserModelId);
function interviewActive() {
  return interviewOpening || !!interviewWindow || !!speechSessions?.configuration;
}
async function prepareUpdateInstall(accountLogout = false, deletingAccount = false) {
  const win = mainWindow;
  if (!win || win.isDestroyed() || pendingMainClose || mainCloseChecking)
    throw Error('Window is not ready');
  if (sessionHasContent && !deletingAccount) {
    mainCloseChecking = true;
    try {
      const { response } = await dialog.showMessageBox(win, {
        type: 'warning',
        title: nativeText(accountLogout ? '退出 VoxCue 账号' : '重启并更新 VoxCue'),
        message: nativeText(
          accountLogout ? '退出主账号？未保存的编辑会丢失。' : '重启并安装更新？',
        ),
        detail: nativeText(
          '正在生成的回复会停止，未保存的个人信息编辑会丢失。已保存资料、普通聊天和附件草稿会保留。',
        ),
        buttons: [nativeText('取消'), nativeText(accountLogout ? '退出账号' : '重启并更新')],
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
function remoteViewState(state: RemoteConnectionState): RemoteConnectionState {
  return {
    ...state,
    revision: ++remotePresentationRevision,
    presentationOwner: interviewWindow && !interviewWindow.isDestroyed() ? 'interview' : 'main',
  };
}
function publishRemoteState(state = remoteConnection?.state()) {
  if (!state) return;
  const value = remoteViewState(state);
  for (const win of [mainWindow, interviewWindow])
    if (win && !win.isDestroyed()) sendDesktop(win.webContents, 'remote:state', value);
  publishInterviewShortcutsState();
}
function clearRemoteInterview() {
  remoteInterview?.reset();
  remoteConnection?.updateSnapshot(null);
  publishRemoteState();
}
function createLoginWindow() {
  if (loginWindow) {
    loginWindow.show();
    loginWindow.focus();
    return;
  }
  clearRemoteInterview();
  void remoteConnection?.disconnect().catch(() => {});
  const win = new BrowserWindow(
    windowOptions('login', desktopPlatform, windowPaths, uiLanguage, systemLanguage),
  );
  loginWindow = win;
  restrictWindowNavigation(win);
  whenWindowReady(win, desktopPlatform, () => {
    win.show();
    mainWindow?.close();
  });
  win.on('close', () => {
    cancelLoginWait?.();
    auth.cancel();
    copilotAuth?.cancel();
  });
  win.on('closed', () => {
    loginWindow = null;
  });
  loadWindowPage(win, 'login', indexFile, environment.devServerUrl);
}
function publishInterviewLayout(win: BrowserWindow, bounds: Electron.Rectangle) {
  if (
    interviewCanvasLayout?.width === bounds.width &&
    interviewCanvasLayout.height === bounds.height
  )
    return;
  interviewCanvasLayout = {
    revision: (interviewCanvasLayout?.revision ?? 0) + 1,
    width: bounds.width,
    height: bounds.height,
  };
  sendDesktop(win.webContents, 'interview:layout', interviewCanvasLayout);
}
function sizeInterview(scale: number, anchor?: Electron.Rectangle) {
  const win = interviewWindow!;
  const previous = win.getBounds();
  const same = (a: Electron.Rectangle, b: Electron.Rectangle) =>
    a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
  // Reuse the logical request while the HWND still matches its rounded result.
  // Feeding that result back into another resize accumulates fractional-DPI
  // position/size rounding on every collapse or transcript toggle. Explicit
  // gesture anchors and external moves must continue to use their actual bounds.
  anchor ??=
    !nativePresentation?.fixedInterviewCanvas &&
    lastInterviewBounds &&
    same(previous, lastInterviewBounds.actual)
      ? lastInterviewBounds.requested
      : previous;
  const area =
    nativePresentation?.fixedInterviewCanvas || nativePresentation?.reserveTranscriptCanvas
      ? screen.getDisplayNearestPoint(interviewToolbarPoint(anchor)).workArea
      : screen.getDisplayMatching(anchor).workArea;
  let bounds = fitInterviewBounds(
    anchor,
    area,
    interviewCollapsed && interviewSettingsOpen ? interviewLayout.minimumScale : scale,
    interviewCollapsed && interviewSettingsOpen ? false : interviewTranscriptVisible,
    interviewCollapsed && !interviewSettingsOpen,
  );
  // Panels are laid out from height. Deriving the next scale from the rounded
  // width can change height on a transcript toggle after a fractional-DPI drag.
  if (!interviewCollapsed)
    interviewScale = Math.max(
      0,
      (bounds.height - interviewLayout.chromeHeight) / interviewLayout.panelHeight,
    );
  if (nativePresentation?.fixedInterviewCanvas) {
    // A layered HWND move/resize and Chromium's new surface are not presented
    // atomically. Reserve a stable canvas once; resize only the content inside.
    const areas = screen.getAllDisplays().map((display) => display.workArea);
    const width = Math.max(...areas.map((area) => area.width));
    const height = Math.max(...areas.map((area) => area.height));
    if (!interviewCanvasLayout || width > previous.width + 1 || height > previous.height + 1) {
      nativePresentation.resizeInterview!(win, {
        x: Math.round(bounds.x + bounds.width / 2 - width / 2),
        y: bounds.y,
        width,
        height,
      });
    } else {
      const center = previous.x + previous.width / 2;
      // Recover an off-screen anchor after a display change or an edge drag.
      // Ordinary panel changes keep both the HWND origin and extent untouched.
      if (center <= area.x || center >= area.x + area.width || bounds.y !== previous.y)
        nativePresentation.moveInterview!(win, {
          ...previous,
          x: Math.round(bounds.x + bounds.width / 2 - previous.width / 2),
          y: bounds.y,
        });
    }
    publishInterviewLayout(win, bounds);
    return;
  }
  if (nativePresentation?.reserveTranscriptCanvas) {
    publishInterviewLayout(win, bounds);
    if (!interviewCollapsed) {
      // Reserve only this scale's two-panel width on Mac, not a display-sized
      // canvas. Transcript toggles retain the native surface and toolbar anchor.
      const expanded = fitInterviewBounds(anchor, area, interviewScale, true);
      if (expanded.width > bounds.width)
        bounds = { ...bounds, x: expanded.x, width: expanded.width };
    }
  }
  // Windows fractional DPI can round a requested DIP to a different DIP when
  // read back. Compare the last request as well, without ignoring user moves.
  if (
    same(bounds, previous) ||
    (lastInterviewBounds &&
      same(bounds, lastInterviewBounds.requested) &&
      same(previous, lastInterviewBounds.actual))
  )
    return;
  if (nativePresentation?.resizeInterview) nativePresentation.resizeInterview(win, bounds);
  else win.setBounds(bounds, false);
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
      dialog.showErrorBox(
        nativeText('应用图标恢复失败'),
        nativeText('面试已结束，请重新打开 VoxCue。'),
      );
    });
}
function shortcutsOpen() {
  return interviewShortcutsRequested;
}
function interviewShortcutsState(role: 'owner' | 'help'): InterviewShortcutsState {
  const input = speechSessions?.inputState;
  return {
    open: shortcutsOpen(),
    rendererRevision:
      surfaceRevisions.get((role === 'owner' ? interviewWindow : interviewShortcutsWindow)!) ?? 0,
    deviceConnected: remoteConnection?.state().status === 'connected',
    visible: interviewVisibility?.visible ?? false,
    collapsed: interviewCollapsed,
    transcriptVisible: interviewTranscriptVisible,
    microphoneMuted:
      input?.microphoneMuted ??
      !speechSessions?.configuration?.options.sources.includes('microphone'),
    systemAudioMuted: input?.systemAudioMuted ?? false,
  };
}
function publishInterviewShortcutsState() {
  const win = interviewShortcutsWindow;
  if (win && interviewShortcutsReady && !win.isDestroyed() && !win.webContents.isDestroyed())
    sendDesktop(win.webContents, 'interview:shortcuts-state', interviewShortcutsState('help'));
}
function reducedNativeMotion() {
  try {
    const settings = systemPreferences.getAnimationSettings();
    return settings.prefersReducedMotion === true || settings.shouldRenderRichAnimation === false;
  } catch {
    return true;
  }
}
function notifyShortcutsOpen() {
  if (
    interviewWindow &&
    !interviewWindow.isDestroyed() &&
    !interviewWindow.webContents.isDestroyed() &&
    !interviewCloseApproved &&
    !closingMain
  )
    sendDesktop(interviewWindow.webContents, 'interview:shortcuts-open', shortcutsOpen());
}
function positionInterviewShortcuts() {
  const win = interviewShortcutsWindow;
  if (!win || win.isDestroyed() || !interviewWindow || interviewWindow.isDestroyed()) return;
  const owner = interviewWindow.getBounds();
  const area = screen.getDisplayNearestPoint(interviewToolbarPoint(owner)).workArea;
  const bounds = interviewShortcutsBounds(area, desktopPlatform.id === 'darwin');
  const current = win.getBounds();
  if (
    bounds.x !== current.x ||
    bounds.y !== current.y ||
    bounds.width !== current.width ||
    bounds.height !== current.height
  ) {
    if (nativePresentation?.resizeInterview) nativePresentation.resizeInterview(win, bounds);
    else win.setBounds(bounds, false);
  }
}
function showInterviewShortcuts() {
  const win = interviewShortcutsWindow;
  if (
    !win ||
    win.isDestroyed() ||
    !interviewShortcutsReady ||
    !interviewShortcutsRequested ||
    !interviewWindow ||
    interviewWindow.isDestroyed() ||
    !interviewVisibility?.visible
  )
    return;
  positionInterviewShortcuts();
  pinInterview(win);
  void shortcutsVisibility?.set(true);
  hideInterviewIcon();
}
function closeInterviewShortcuts() {
  interviewShortcutsWindow?.destroy();
}
function setInterviewShortcutsOpen(open: boolean): boolean {
  if (!open) {
    interviewShortcutsRequested = false;
    notifyShortcutsOpen();
    const win = interviewShortcutsWindow;
    if (win && shortcutsVisibility)
      void shortcutsVisibility.set(false).then((completed) => {
        if (completed && !interviewShortcutsRequested && !win.isDestroyed()) win.destroy();
      });
    else closeInterviewShortcuts();
    return false;
  }
  if (!interviewWindow || interviewWindow.isDestroyed()) throw Error('Unauthorized window');
  if (interviewShortcutsWindow && !interviewShortcutsWindow.isDestroyed()) {
    interviewShortcutsRequested = true;
    notifyShortcutsOpen();
    showInterviewShortcuts();
    return true;
  }
  const win = new BrowserWindow({
    ...windowOptions(
      'interview-shortcuts',
      desktopPlatform,
      windowPaths,
      uiLanguage,
      systemLanguage,
    ),
    ...(desktopPlatform.id === 'darwin' ? { parent: interviewWindow } : {}),
  });
  interviewShortcutsRequested = true;
  interviewShortcutsWindow = win;
  surfaceRevisions.set(win, 1);
  interviewShortcutsReady = false;
  let nativeReady = false,
    rendererReady = false;
  let nativeSurfaceReady = false;
  let readyTimer: ReturnType<typeof setTimeout> | undefined;
  win.once('closed', () => {
    clearTimeout(readyTimer);
    surfaceReadyCallbacks.delete(win);
    surfaceRevisions.delete(win);
    if (interviewShortcutsWindow !== win) return;
    shortcutsVisibility?.dispose();
    shortcutsVisibility = undefined;
    interviewShortcutsWindow = null;
    interviewShortcutsReady = false;
    interviewShortcutsRequested = false;
    notifyShortcutsOpen();
  });
  const failed = () => {
    if (win.isDestroyed()) return;
    win.destroy();
    if (!closingMain)
      dialog.showErrorBox(nativeText('快捷键'), nativeText('快捷键窗口未能打开，请重试。'));
  };
  try {
    shortcutsVisibility = new WindowVisibility(win, reducedNativeMotion, failed);
    const reveal = () => {
      if (!nativeReady || !rendererReady || win.isDestroyed()) return;
      try {
        clearTimeout(readyTimer);
        interviewShortcutsReady = true;
        showInterviewShortcuts();
        publishInterviewShortcutsState();
      } catch {
        failed();
      }
    };
    surfaceReadyCallbacks.set(win, () => {
      rendererReady = true;
      reveal();
    });
    readyTimer = setTimeout(failed, 30000);
    readyTimer.unref();
    restrictWindowNavigation(win);
    win.setContentProtection(captureProtected);
    positionInterviewShortcuts();
    whenWindowReady(win, desktopPlatform, () => {
      try {
        nativeReady = true;
        nativeSurfaceReady = true;
        reveal();
      } catch {
        failed();
      }
    });
    win.webContents.on('did-fail-load', (_event, code, _description, _url, mainFrame) => {
      if (mainFrame && code !== -3) failed();
    });
    win.webContents.on('render-process-gone', failed);
    win.webContents.on('did-start-loading', () => {
      surfaceRevisions.set(win, (surfaceRevisions.get(win) ?? 0) + 1);
      nativeReady = false;
      rendererReady = false;
      interviewShortcutsReady = false;
      void shortcutsVisibility?.set(false);
      clearTimeout(readyTimer);
      readyTimer = setTimeout(failed, 30000);
      readyTimer.unref();
    });
    win.webContents.on('did-finish-load', () => {
      if (!nativeSurfaceReady) return;
      nativeReady = true;
      reveal();
    });
    const loadFailed = (error: unknown) => {
      if (!(error instanceof Error && 'code' in error && error.code === 'ERR_ABORTED')) failed();
    };
    loadWindowPage(
      {
        loadURL: (...args) => win.loadURL(...args).catch(loadFailed),
        loadFile: (...args) => win.loadFile(...args).catch(loadFailed),
      },
      'interview-shortcuts',
      indexFile,
      environment.devServerUrl,
    );
    notifyShortcutsOpen();
    return true;
  } catch (error) {
    if (!win.isDestroyed()) win.destroy();
    throw error;
  }
}
function openInterview() {
  if (interviewWindow) {
    revealExistingInterview(interviewWindow, interviewRevealCallbacks);
    return;
  }
  captureProtected = true;
  interviewContext.clear();
  interviewCollapsed = false;
  interviewSettingsOpen = false;
  interviewTranscriptVisible = true;
  interviewScale = 1;
  interviewCanvasLayout = undefined;
  lastInterviewBounds = undefined;
  interviewResize = undefined;
  interviewCloseApproved = false;
  interviewMove = undefined;
  const win = new BrowserWindow(
    windowOptions('interview', desktopPlatform, windowPaths, uiLanguage, systemLanguage),
  );
  let windowReady = false;
  let nativeReady = false,
    rendererReady = false;
  let nativeSurfaceReady = false;
  let focusOnReveal = false;
  let firstReveal = true;
  let remoteInitialNavigation = true;
  let readyTimer: ReturnType<typeof setTimeout> | undefined;
  let surfaceVisibility: WindowVisibility | undefined;
  let releaseShortcuts: (() => void) | undefined;
  surfaceRevisions.set(win, 1);
  const displayChanged = () => {
    if (win === interviewWindow && !win.isDestroyed() && nativePresentation?.fixedInterviewCanvas)
      sizeInterview(interviewScale);
    positionInterviewShortcuts();
  };
  // Attach ownership cleanup before registration or native setup can fail.
  win.on('closed', () => {
    clearTimeout(readyTimer);
    surfaceReadyCallbacks.delete(win);
    surfaceRevisions.delete(win);
    interviewRevealCallbacks.delete(win);
    surfaceVisibility?.dispose();
    if (interviewVisibility === surfaceVisibility) interviewVisibility = undefined;
    releaseShortcuts?.();
    if (releaseInterviewShortcuts === releaseShortcuts) releaseInterviewShortcuts = undefined;
    screen.removeListener('display-added', displayChanged);
    screen.removeListener('display-removed', displayChanged);
    screen.removeListener('display-metrics-changed', displayChanged);
    if (interviewWindow !== win) return;
    if (checkedMicrophone?.owner === win) checkedMicrophone = undefined;
    interviewAudioIntent.cancel();
    closeInterviewShortcuts();
    telemetry?.finishInterview(false, 'window');
    interviewMove = undefined;
    interviewWindow = null;
    clearRemoteInterview();
    interviewMousePassthrough = false;
    speechSessions?.releaseInterview(true);
    updates?.refresh();
    interviewIpc?.cancel();
    interviewContext.clear();
    captureProtected = true;
    restoreAfterInterview();
  });
  const failedWindow = () => {
    if (win.isDestroyed()) return;
    win.destroy();
    if (!closingMain)
      dialog.showErrorBox(
        nativeText('面试窗口已关闭'),
        nativeText('面试窗口发生异常，已停止本场采集并恢复主窗口。'),
      );
  };
  try {
    const visibility = new WindowVisibility(win, reducedNativeMotion, failedWindow);
    surfaceVisibility = visibility;
    interviewVisibility = visibility;
    releaseShortcuts = shortcutController.attach({
      window: {
        isDestroyed: () => win.isDestroyed(),
        isVisible: () => visibility.visible,
        hide: () => {
          void visibility.set(false);
          void shortcutsVisibility?.set(false);
          publishInterviewShortcutsState();
        },
        showInactive: () => {
          void visibility.set(true);
          showInterviewShortcuts();
          publishInterviewShortcutsState();
        },
      },
      ready: () => windowReady,
      command: (command) => {
        if (win !== interviewWindow || win.webContents.isDestroyed()) return;
        if (command === 'scroll-device-up' || command === 'scroll-device-down') {
          remoteConnection?.scroll(command === 'scroll-device-up' ? 'up' : 'down');
          return;
        }
        sendDesktop(win.webContents, 'interview:shortcut', command);
      },
    });
    releaseInterviewShortcuts = releaseShortcuts;
    if (!desktopPlatform.captureScreen && !demoSession && speechSessions?.configuration?.aiEnabled)
      void prepareInterviewScreenshot(win, desktopPlatform.id);
    interviewWindow = win;
    clearRemoteInterview();
    const initialAudio = speechSessions?.configuration;
    if (initialAudio?.mode === 'local' && initialAudio.options.sources.includes('microphone'))
      checkedMicrophone = { owner: win, device: initialAudio.options.microphone };
    interviewMousePassthrough = false;
    setInterviewMousePassthrough(true);
    // All expanded sizes use the controlled proportional resize path. Removing
    // OS minimums also permits the narrower answer-only and collapsed canvases.
    win.setMinimumSize(1, 1);
    const area = screen.getDisplayMatching(mainWindow?.getBounds() ?? win.getBounds()).workArea;
    const initial = win.getBounds();
    sizeInterview(1, { ...initial, x: area.x + (area.width - initial.width) / 2, y: area.y + 24 });
    screen.on('display-added', displayChanged);
    screen.on('display-removed', displayChanged);
    screen.on('display-metrics-changed', displayChanged);
    win.on('move', positionInterviewShortcuts);
    win.on('show', showInterviewShortcuts);
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
    const reveal = () => {
      if (!nativeReady || !rendererReady || windowReady || win.isDestroyed()) return;
      try {
        if (nativePresentation) {
          nativePresentation.prepareInterview(win);
        }
        windowReady = true;
        clearTimeout(readyTimer);
        void visibility.set(true);
        pinInterview(win);
        if (focusOnReveal) {
          focusOnReveal = false;
          if (win.isMinimized()) win.restore();
          win.focus();
        }
        if (nativePresentation) {
          if (mainWindow) nativePresentation.hideMain(mainWindow);
          // Showing a later interview can restore the application's Dock policy.
          // Apply automatic icon hiding after all native window-show operations.
          hideInterviewIcon();
        } else mainWindow?.minimize();
        if (firstReveal) {
          firstReveal = false;
          try {
            setInterviewShortcutsOpen(true);
          } catch {
            dialog.showErrorBox(nativeText('快捷键'), nativeText('快捷键窗口未能打开，请重试。'));
          }
        }
      } catch {
        failedWindow();
      }
    };
    surfaceReadyCallbacks.set(win, () => {
      rendererReady = true;
      reveal();
    });
    interviewRevealCallbacks.set(win, (focus) => {
      if (win.isDestroyed()) return;
      if (!windowReady) {
        focusOnReveal ||= focus;
        reveal();
        return;
      }
      if (win.isMinimized()) win.restore();
      void visibility.set(true);
      showInterviewShortcuts();
      pinInterview(win);
      hideInterviewIcon();
      if (focus) win.focus();
    });
    readyTimer = setTimeout(failedWindow, 30000);
    readyTimer.unref();
    whenWindowReady(win, desktopPlatform, () => {
      nativeReady = true;
      nativeSurfaceReady = true;
      reveal();
    });
    win.webContents.on('did-fail-load', (_event, code, _description, _url, mainFrame) => {
      if (mainFrame && code !== -3) failedWindow();
    });
    const loadFailed = (error: unknown) => {
      if (!(error instanceof Error && 'code' in error && error.code === 'ERR_ABORTED'))
        failedWindow();
    };
    win.webContents.on('did-start-loading', () => {
      if (win === interviewWindow) interviewAudioIntent.cancel();
      if (win === interviewWindow) {
        clearRemoteInterview();
        // Starting an interview from the desktop approves sharing that session.
        // Reloading its renderer must not silently extend the phone's access.
        if (!remoteInitialNavigation) void remoteConnection?.disconnect().catch(() => {});
        remoteInitialNavigation = false;
      }
      surfaceRevisions.set(win, (surfaceRevisions.get(win) ?? 0) + 1);
      nativeReady = false;
      windowReady = false;
      rendererReady = false;
      void visibility.set(false);
      clearTimeout(readyTimer);
      readyTimer = setTimeout(failedWindow, 30000);
      readyTimer.unref();
      closeInterviewShortcuts();
      telemetry?.speechState('paused');
      interviewMove = undefined;
      if (interviewSettingsOpen) {
        interviewSettingsOpen = false;
        sizeInterview(interviewScale);
      }
      setInterviewMousePassthrough(true);
      speechSessions?.releaseInterview();
      interviewIpc?.cancel();
    });
    win.webContents.on('did-finish-load', () => {
      if (!nativeSurfaceReady) return;
      nativeReady = true;
      reveal();
    });
    win.webContents.on('render-process-gone', () => {
      if (win.isDestroyed() || win !== interviewWindow) return;
      interviewCloseApproved = true;
      win.destroy();
      if (!closingMain)
        dialog.showErrorBox(
          nativeText('面试窗口已关闭'),
          nativeText('面试窗口发生异常，已停止本场采集并恢复主窗口。'),
        );
    });
    loadWindowPage(
      {
        loadURL: (...args) => win.loadURL(...args).catch(loadFailed),
        loadFile: (...args) => win.loadFile(...args).catch(loadFailed),
      },
      'interview',
      indexFile,
      environment.devServerUrl,
    );
  } catch (error) {
    releaseShortcuts?.();
    if (!win.isDestroyed()) win.destroy();
    throw error;
  }
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
if (desktopPlatform.id === 'darwin' || desktopPlatform.presentationFile) {
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    process.exit(0);
  }
  app.on('second-instance', () => {
    if (interviewWindow && !interviewWindow.isDestroyed()) {
      openInterview();
      return;
    }
    const win = mainWindow ?? loginWindow;
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
  mainWindow = new BrowserWindow(
    windowOptions('main', desktopPlatform, windowPaths, uiLanguage, systemLanguage),
  );
  restrictWindowNavigation(mainWindow);
  whenWindowReady(mainWindow, desktopPlatform, () => {
    mainWindow?.show();
    loginWindow?.close();
    void updates?.start();
  });
  loadWindowPage(mainWindow, 'main', indexFile, environment.devServerUrl);
  mainWindow.on('closed', () => {
    clearRemoteInterview();
    void remoteConnection?.disconnect().catch(() => {});
    void accountArchive?.cancel().catch(() => {});
    speechSessions?.releaseDictation();
    mainWindow = null;
    if (macQuitRequested) app.quit();
  });
  mainWindow.webContents.on('did-start-loading', () => {
    void accountArchive?.cancel().catch(() => {});
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
          title: nativeText('关闭 VoxCue'),
          message: nativeText('关闭应用？'),
          detail: nativeText(
            '正在生成的回复会停止，未保存的个人信息编辑会丢失。普通聊天、附件草稿和已保存资料会保留。',
          ),
          buttons: [nativeText('取消'), nativeText('关闭应用')],
          defaultId: 0,
          cancelId: 0,
          noLink: true,
        })
        .then(({ response }) => {
          if (response !== 1 && desktopPlatform.id === 'darwin') macQuitRequested = false;
          if (response === 1 && mainWindow && !mainWindow.isDestroyed()) {
            mainCloseApproved = true;
            mainWindow.close();
          }
        })
        .catch(() =>
          dialog.showErrorBox(nativeText('关闭确认失败'), nativeText('窗口已保留，请重试关闭。')),
        )
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
        if (desktopPlatform.id === 'darwin') macQuitRequested = false;
        dialog.showErrorBox(
          nativeText('聊天尚未保存'),
          nativeText('窗口已保留，请等待聊天保存完成后重试关闭。'),
        );
      }, 15000);
      return;
    }
    speechSessions?.releaseDictation();
    chatIpc?.cancelActive();
    auth.cancel();
    copilotAuth?.cancel();
    closingMain = true;
    interviewWindow?.close();
  });
}
app.whenReady().then(async () => {
  restrictSessionPermissions(session.defaultSession, indexFile, environment.devServerUrl);
  const eraseBrowser = async () => {
    await session.defaultSession.clearStorageData();
    await session.defaultSession.clearCache();
    await session.defaultSession.clearAuthCache();
  };
  const erasureFile = path.join(app.getPath('userData'), accountErasureMarker);
  if (existsSync(erasureFile)) {
    try {
      const pending = JSON.parse(await readFile(erasureFile, 'utf8'));
      if (pending.committed === true)
        await eraseLocalAccount(app.getPath('userData'), eraseBrowser);
    } catch {
      dialog.showErrorBox(
        nativeText('本机账号资料尚未清理完成'),
        nativeText('请关闭占用资料的程序后重新打开 VoxCue。应用会继续清理，暂不载入资料。'),
      );
      app.exit(1);
      return;
    }
  }
  const shortcutFile = path.join(app.getPath('userData'), 'shortcut-settings.json');
  shortcutController = new InterviewShortcutController(globalShortcut, (state) => {
    for (const win of [mainWindow, interviewWindow, interviewShortcutsWindow])
      if (win && !win.isDestroyed() && !win.webContents.isDestroyed())
        sendDesktop(win.webContents, 'shortcuts:settings', state);
  }, (bindings) => writeShortcuts(shortcutFile, bindings));
  shortcutSettingsReady = readShortcuts(shortcutFile, desktopPlatform.id === 'darwin').then(({ bindings, error }) => {
    shortcutController.configure(bindings, error);
  });
  await shortcutSettingsReady;
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
  if (desktopPlatform.id === 'darwin') {
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
  handleDesktop('appearance:language', (event, ...args) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || ![loginWindow, mainWindow, interviewWindow].includes(win))
      throw Error('Unauthorized window');
    if (event.senderFrame !== event.sender.mainFrame) throw Error('Unauthorized frame');
    if (args.length !== 1 || !isUILanguage(args[0])) throw Error('Invalid UI language');
    uiLanguage = args[0];
    for (const [window, title] of [
      [loginWindow, 'VoxCue · 登录'],
      [mainWindow, 'VoxCue'],
      [interviewWindow, 'VoxCue · 面试'],
      [interviewShortcutsWindow, '快捷键'],
    ] as const)
      if (window && !window.isDestroyed()) window.setTitle(nativeText(title));
  });
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
    if (!win || ![loginWindow, mainWindow, interviewWindow, interviewShortcutsWindow].includes(win))
      throw new Error('Unauthorized window');
    if (win === interviewShortcutsWindow && event.senderFrame !== event.sender.mainFrame)
      throw Error('Unauthorized frame');
    return systemAccent();
  });
  systemPreferences.on('accent-color-changed', () => {
    const color = systemAccent();
    for (const win of [loginWindow, mainWindow, interviewWindow, interviewShortcutsWindow])
      if (win && !win.isDestroyed())
        sendDesktop(win.webContents, 'appearance:accent-changed', color);
  });
  codexUsageRuntime = new CodexUsageRuntime(
    path.join(app.getPath('userData'), 'chatgpt-usage'),
    undefined,
    app.getVersion(),
  );
  const credentialEncryption = desktopPlatform.credentialEncryptionFile
    ? require(
        path.join(app.getAppPath(), 'dist-electron', desktopPlatform.credentialEncryptionFile),
      ).createCredentialEncryption(
        path.join(
          app.isPackaged ? process.resourcesPath : app.getAppPath(),
          app.isPackaged ? 'native' : 'native/bin',
          'VoxCue.Credentials',
        ),
      )
    : undefined;
  const localMode = new LocalMode(path.join(app.getPath('userData'), 'local-mode.json'));
  // An unreadable preference returns to explicit entry; it never grants access.
  const localModeReady = localMode.load().catch(() => {});
  let entryBusy = false;
  const accountOrigin = cloudOrigin(
    environment.accountOrigin,
    environment.allowLocalAccount === true,
  );
  const cloudAccount = new CloudAccountClient({
    origin: accountOrigin,
    vault: createCloudVault(credentialEncryption),
    deviceLabel: process.platform === 'darwin' ? 'VoxCue · Mac' : 'VoxCue · Windows',
  });
  telemetry = new Telemetry({
    root: app.getPath('userData'),
    version: app.getVersion(),
    platform: desktopPlatform.id === 'darwin' ? 'macos' : 'windows',
    origin: cloudOrigin(environment.accountOrigin, environment.allowLocalAccount === true),
    enabled: app.isPackaged,
    proofVault: createCredentialVault<TelemetryProofState>(
      path.join(app.getPath('userData'), 'cloud-account', 'telemetry.bin'),
      credentialEncryption,
      262144,
    ),
    identityProvider: (installationId, userId, signal) =>
      cloudAccount.telemetryIdentity(installationId, userId, signal),
  });
  powerMonitor.on('suspend', () => telemetry?.suspend(true));
  powerMonitor.on('resume', () => telemetry?.suspend(false));
  const accountState = (freshIdentity = false): CloudAccountState => {
    const state = localMode.active
      ? { ...cloudAccount.snapshot(), user: null, verified: false, localMode: true }
      : cloudAccount.snapshot();
    telemetry?.setIdentity(
      state.user
        ? { accountMode: 'account', userId: state.user.id }
        : { accountMode: state.localMode ? 'local' : 'signed_out' },
      freshIdentity,
    );
    return state;
  };
  handleDesktop('cloud:account', async (event, call) => {
    if (
      ![mainWindow?.webContents, loginWindow?.webContents].includes(event.sender) ||
      event.senderFrame !== event.sender.mainFrame
    )
      throw Error('Unauthorized window');
    await localModeReady;
    if (erasingAccount) throw Error('账号资料正在清理。');
    if (localMode.active) {
      if (call?.action === 'status') return { ok: true as const, state: accountState() };
      if (!['login', 'register', 'reset', 'code'].includes(call?.action))
        return {
          ok: false as const,
          state: accountState(),
          error: '登录 VoxCue 后可使用账号与云服务。',
        };
    }
    const authenticating = ['login', 'register', 'reset'].includes(call?.action);
    if (entryBusy && authenticating)
      return { ok: false as const, state: accountState(), error: '使用模式正在切换，请稍候。' };
    if (leavingAccount)
      return {
        ok: false as const,
        state: accountState(),
        error: '账号操作正在进行，请稍候。',
      };
    if (call?.action === 'delete' && event.sender !== mainWindow?.webContents)
      throw Error('Unauthorized window');
    const leaving =
      call?.action === 'logout' ||
      call?.action === 'delete' ||
      (call?.action === 'revoke' && cloudAccount.isCurrentSession(call.sessionId));
    if (leaving && mainWindow) {
      if (interviewActive())
        return { ok: false as const, state: accountState(), error: '请先结束面试。' };
      if (!(await prepareUpdateInstall(true, call.action === 'delete')))
        return { ok: false as const, state: accountState(), error: '已取消退出。' };
    }
    if (authenticating) entryBusy = true;
    const result = await (async () => {
      if (leaving) leavingAccount = true;
      try {
        if (leaving) await accountArchive?.cancel();
        if (call?.action === 'delete') {
          // Prove persistence is writable before the irreversible server operation.
          await writeFile(erasureFile, JSON.stringify({ committed: false }), { mode: 0o600 });
          knowledgeCoordinator?.cancelAll();
          historyJobs?.cancelAll();
          chatIpc?.cancelActive();
          await knowledge.close();
        }
        const response = await cloudAccount.call(call);
        if (response.ok && response.state.user && ['login', 'register'].includes(call.action)) {
          if (localMode.active) {
            await accountArchive?.cancel();
            await localMode.set(false);
          }
          accountState(true);
          telemetry?.entry(call.action as 'login' | 'register', response.state.user.createdAt);
        }
        return response;
      } finally {
        if (leaving) leavingAccount = false;
        if (authenticating) entryBusy = false;
      }
    })();
    if (call?.action === 'delete' && !result.ok)
      await import('node:fs/promises').then((fs) => fs.rm(erasureFile, { force: true }));
    if (leaving && !result.ok) {
      mainCloseApproved = false;
      mainCloseFlushed = false;
    }
    if (result.ok && result.state.user && ['login', 'register'].includes(call.action))
      createMainWindow();
    if (result.ok && call.action === 'delete') {
      erasingAccount = true;
      await telemetry?.close();
      await writeFile(erasureFile, JSON.stringify({ committed: true }), { mode: 0o600 });
      // Retire all writers before clearing browser databases. A persisted marker retries interrupted cleanup at startup.
      setTimeout(() => {
        void (async () => {
          mainCloseApproved = mainCloseFlushed = true;
          mainWindow?.destroy();
          loginWindow?.destroy();
          interviewWindow?.destroy();
          await Promise.all([interviewImages.dispose(), ledger.dispose()]);
          auth.cancel();
          copilotAuth.cancel();
          interviewIpc?.cancel();
          await auth.signOut();
          if (await copilotAuth.session()) await copilotAuth.signOut();
          await codexUsageRuntime.stop();
          await copilotRuntime.stop();
          await eraseLocalAccount(app.getPath('userData'), eraseBrowser);
          app.relaunch();
          app.exit(0);
        })().catch(() => {
          dialog.showErrorBox(
            nativeText('账号已删除，本机清理尚未完成'),
            nativeText('请关闭占用资料的程序后重新打开 VoxCue。应用会继续清理，暂不载入资料。'),
          );
          app.exit(1);
        });
      }, 0);
    }
    if (
      result.ok &&
      !result.state.user &&
      mainWindow &&
      ['logout', 'revoke'].includes(call.action)
    ) {
      knowledgeCoordinator?.cancelAll();
      historyJobs?.cancelAll();
      chatIpc?.cancelActive();
      createLoginWindow();
    }
    return { ...result, state: accountState() };
  });
  const cloudSync = new CloudSyncClient(cloudAccount, async (id, bytes, preview) => {
    await interviewImages.save([{ id, preview, file: { bytes, name: 'screenshot.png' } }]);
  });
  handleDesktop('cloud:sync', (event, call) => {
    if (event.sender !== mainWindow?.webContents || event.senderFrame !== event.sender.mainFrame)
      throw Error('Unauthorized window');
    if (call?.action === 'cancel') return cloudSync.call(call);
    if (localMode.active)
      return { ok: false as const, error: '登录 VoxCue 后可使用云备份。', status: 401 };
    if (interviewActive())
      return {
        ok: false as const,
        error: '面试期间暂停同步。',
        status: 503,
        retryAfterSeconds: 10,
      };
    return cloudSync.call(call);
  });
  auth = new ChatGPTAuthService({
    managed: new ManagedChatGPTAuth(codexUsageRuntime, (url) => shell.openExternal(url)),
    storage: createAuthStorage(desktopPlatform.credentialEncryptionLabel, credentialEncryption),
    openBrowser: (url) => shell.openExternal(url),
    callbackLogo: () => readFile(resources.brandLogo),
    uiLanguage: () => uiLanguage,
  });
  const ledger = new UsageLedger(path.join(app.getPath('userData'), 'chat-usage'));
  chatGPTUsage = new ChatGPTAccountUsage({
    runtime: codexUsageRuntime,
    identity: () => auth.usageIdentity(),
  });
  const chatGPT = new ChatGPTService({
    access: () => auth.access(),
    ledger,
    accountUsage: chatGPTUsage,
  });
  copilotRuntime = new CopilotRuntime(path.join(app.getPath('userData'), 'copilot-runtime'));
  copilotAuth = new CopilotAuthService({
    credentialEncryptionLabel: desktopPlatform.credentialEncryptionLabel,
    storage: createCopilotLoginStorage(),
    control: () => copilotRuntime.control(),
    openBrowser: (url) => shell.openExternal(url),
  });
  const copilot = new CopilotChatService({
    client: () => copilotRuntime.client(),
    control: () => copilotRuntime.control(),
    access: () => copilotAuth.access(),
    ledger,
  });
  const selection = createServiceSelection();
  let selectedService: AIService = 'chatgpt';
  let selectionReady = selection.read().then((service) => {
    selectedService = service;
  });
  void selectionReady.catch(() => {});
  const activeAuth = () => (selectedService === 'copilot' ? copilotAuth : auth);
  chat = new SelectedChatService(() => (selectedService === 'copilot' ? copilot : chatGPT));
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
        ? (() => {
            const adapter = require(
              path.join(app.getAppPath(), 'dist-electron', desktopPlatform.updateDriverFile),
            );
            return (adapter.createUpdateDriver ?? adapter.createMacUpdateDriver)();
          })()
        : createUpdateDriver(app.isPackaged, {
            cacheDirectory: path.join(app.getPath('userData'), 'updates'),
          }),
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
      if (desktopPlatform.id === 'darwin') macQuitRequested = false;
    }
  });
  const requireLogin = (event: Electron.IpcMainInvokeEvent) => {
    if (event.sender !== loginWindow?.webContents || event.senderFrame !== event.sender.mainFrame)
      throw new Error('Unauthorized window');
  };
  handleDesktop('session:local-mode', async (event, enabled, ...extra) => {
    if (typeof enabled !== 'boolean' || extra.length) throw Error('Invalid local mode');
    if (enabled) requireLogin(event);
    else {
      requireMain(event);
      if (event.senderFrame !== event.sender.mainFrame) throw Error('Unauthorized frame');
    }
    await localModeReady;
    if (entryBusy || leavingAccount || erasingAccount)
      return { ok: false as const, state: accountState(), error: '账号操作正在进行，请稍候。' };
    entryBusy = true;
    try {
      if (enabled) {
        if (cloudAccount.snapshot().user) throw Error('请先退出 VoxCue 账号。');
        if (auth.isPending() || copilotAuth.isPending()) throw Error('请先取消正在进行的授权。');
        await finishSignedOutMain();
        await localMode.set(true);
        accountState();
        telemetry?.entry('local');
        createMainWindow();
      } else {
        if (!localMode.active) throw Error('当前不是本地账户模式。');
        if (interviewActive()) throw Error('请先结束面试。');
        if (!(await prepareUpdateInstall(true)))
          return { ok: false as const, state: accountState(), error: '已取消返回登录。' };
        await accountArchive?.cancel();
        await localMode.set(false);
        auth.cancel();
        copilotAuth.cancel();
        knowledgeCoordinator?.cancelAll();
        historyJobs?.cancelAll();
        chatIpc?.cancelActive();
        createLoginWindow();
      }
      return { ok: true as const, state: accountState() };
    } catch (error) {
      if (!enabled) mainCloseApproved = mainCloseFlushed = false;
      throw error;
    } finally {
      entryBusy = false;
    }
  });
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
  // Entry can finish while the previous main window is still flushing its chat store.
  const finishSignedOutMain = async () => {
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
  };
  const signIn = async (service: AIService) => {
    if (signingIn || auth.isPending() || copilotAuth.isPending())
      throw Error('已有登录操作正在进行。');
    signingIn = true;
    try {
      demoSession = false;
      const session = await (service === 'copilot' ? copilotAuth : auth).signIn();
      if (mainWindow && !mainCloseApproved) {
        await selection.write(service);
        selectedService = service;
        selectionReady = Promise.resolve();
        chatIpc?.cancelActive();
        historyJobs?.cancelAll();
        return session;
      }
      if (!loginWindow || loginWindow.isDestroyed()) throw Error('登录窗口已关闭。');
      await finishSignedOutMain();
      await selection.write(service);
      selectedService = service;
      selectionReady = Promise.resolve();
      createMainWindow();
      return session;
    } finally {
      signingIn = false;
    }
  };
  const requireAIWindow = (event: Electron.IpcMainInvokeEvent) => {
    if (event.sender === mainWindow?.webContents && event.senderFrame === event.sender.mainFrame) {
      if (interviewActive()) throw Error('请先结束面试再切换 AI 服务。');
      if (!cloudAccount.snapshot().user && !localMode.active && !demoSession)
        throw Error('请先登录 VoxCue 账号或选择本地账户。');
      return;
    }
    requireLogin(event);
    if (app.isPackaged || !process.env.COPILOT_TEST_USER_DATA)
      throw Error('请在设置中连接 AI 服务。');
  };
  handleDesktop('auth:sign-in', async (event, ...args) => {
    requireAIWindow(event);
    if (args.length) throw Error('Invalid request');
    return signIn('chatgpt');
  });
  handleDesktop('auth:copilot-sign-in', async (event, ...args) => {
    requireAIWindow(event);
    if (args.length) throw Error('Invalid request');
    return signIn('copilot');
  });
  handleDesktop('auth:cancel', (event) => {
    requireAIWindow(event);
    cancelLoginWait?.();
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
    if (interviewActive()) throw Error('请先结束面试再断开 AI 服务。');
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
        title: nativeText('退出登录'),
        message: nativeText(result.warning),
        buttons: [nativeText('确定')],
      });
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
    ragModelPath,
    (event) => {
      if (mainWindow && !mainWindow.isDestroyed())
        sendDesktop(mainWindow.webContents, 'knowledge:event', event);
    },
    interviewActive,
  );
  registerKnowledgeIpc(knowledgeCoordinator, requireMain, () => components.require('rag'));
  const ragChat = new RagChatService(chat, knowledge, () => components.require('rag'));
  chatIpc = registerChatIpc({
    chat: ragChat,
    requireMain,
    isDemo: () => demoSession,
    openLink: (url) => shell.openExternal(url),
    telemetry,
  });
  const requireInterview = (event: Electron.IpcMainInvokeEvent) => {
    if (
      event.sender !== interviewWindow?.webContents ||
      event.senderFrame !== event.sender.mainFrame
    )
      throw Error('Unauthorized window');
  };
  remoteInterview = new RemoteInterviewCoordinator((command) => {
    const win = interviewWindow;
    if (!win || win.isDestroyed() || erasingAccount || closingMain) return false;
    sendDesktop(win.webContents, 'remote:command', command);
    return true;
  });
  remoteConnection = new RemoteConnectionService({
    mobileAssets: createMobileAssets(path.join(app.getAppPath(), 'dist')),
    onState: publishRemoteState,
    onCommand: (command, signal) => remoteInterview!.dispatch(command, signal),
  });
  registerRemoteConnectionIpc({
    service: remoteConnection,
    coordinator: remoteInterview,
    requireOwner(event) {
      if (erasingAccount || closingMain ||
        ![mainWindow?.webContents, interviewWindow?.webContents].includes(event.sender) ||
        event.senderFrame !== event.sender.mainFrame)
        throw Error('Unauthorized window');
    },
    requireInterview(event) {
      requireInterview(event);
      if (erasingAccount || closingMain) throw Error('Unauthorized window');
    },
    viewState: remoteViewState,
  });
  let shortcutCaptureWindow: BrowserWindow | null = null;
  const endShortcutCapture = () => {
    shortcutCaptureWindow?.removeListener('blur', endShortcutCapture);
    shortcutCaptureWindow?.removeListener('closed', endShortcutCapture);
    if (shortcutCaptureWindow && !shortcutCaptureWindow.isDestroyed()) {
      shortcutCaptureWindow.webContents.removeListener('did-start-loading', endShortcutCapture);
      if (desktopPlatform.id === 'darwin' && !shortcutCaptureWindow.webContents.isDestroyed())
        shortcutCaptureWindow.webContents.setIgnoreMenuShortcuts(false);
    }
    shortcutCaptureWindow = null;
    shortcutController.capture(false);
  };
  registerShortcutSettingsIpc({
    mac: desktopPlatform.id === 'darwin',
    authorize(event, write) {
      const win = BrowserWindow.fromWebContents(event.sender);
      if (!win || ![mainWindow, interviewWindow, interviewShortcutsWindow].includes(win) ||
        event.senderFrame !== event.sender.mainFrame) throw Error('Unauthorized window');
      if (write) {
        requireMain(event);
        if (erasingAccount || closingMain) throw Error('Unauthorized window');
      }
    },
    async call(call, event) {
      const win = BrowserWindow.fromWebContents(event.sender)!;
      await shortcutSettingsReady;
      if (win.isDestroyed()) throw Error('Unauthorized window');
      if (call.op !== 'status') {
        requireMain(event);
        if (erasingAccount || closingMain) throw Error('Unauthorized window');
      }
      if (call.op === 'status') return { state: shortcutController.state() };
      if (call.op === 'check') return { state: shortcutController.check() };
      if (call.op === 'capture') {
        if (!call.active) endShortcutCapture();
        else {
          if (!shortcutCaptureWindow) {
            shortcutCaptureWindow = win;
            if (desktopPlatform.id === 'darwin') win.webContents.setIgnoreMenuShortcuts(true);
            win.once('blur', endShortcutCapture);
            win.once('closed', endShortcutCapture);
            win.webContents.once('did-start-loading', endShortcutCapture);
          }
          shortcutController.capture(true);
        }
        return { state: shortcutController.state() };
      }
      return shortcutController.save(call.op === 'set' ? call.action : null,
        call.op === 'set' ? call.accelerator : null, defaultShortcuts());
    },
  });
  registerInterviewShortcutsIpc({
    requireWindow(event) {
      if (
        !interviewWindow ||
        interviewWindow.isDestroyed() ||
        event.senderFrame !== event.sender.mainFrame
      )
        throw Error('Unauthorized window');
      if (event.sender === interviewWindow.webContents) return 'owner';
      if (event.sender === interviewShortcutsWindow?.webContents) return 'help';
      throw Error('Unauthorized window');
    },
    state: interviewShortcutsState,
    setOpen: setInterviewShortcutsOpen,
    ready(role) {
      const win = role === 'owner' ? interviewWindow : interviewShortcutsWindow;
      const callback = win && surfaceReadyCallbacks.get(win);
      if (!callback) throw Error('Unauthorized window');
      callback();
    },
  });
  registerTelemetryIpc({
    telemetry,
    requireMain,
    requireInterview,
    requireEntry(event) {
      if (![loginWindow?.webContents, mainWindow?.webContents].includes(event.sender))
        throw Error('Unauthorized window');
      accountState();
    },
  });
  const interviewImages = new InterviewImageStore(
    path.join(app.getPath('userData'), 'interview-images-v1'),
  );
  accountArchive = new AccountArchive({
    userData: app.getPath('userData'),
    image: (id) => interviewImages.original(id),
    async choose() {
      if (!mainWindow || mainWindow.isDestroyed()) throw Error('账号窗口已关闭。');
      const result = await dialog.showSaveDialog(mainWindow, {
        title: nativeText('导出资料'),
        defaultPath: path.join(app.getPath('documents'), nativeText('VoxCue资料.zip')),
        filters: [{ name: nativeText('ZIP 压缩包'), extensions: ['zip'] }],
      });
      return result.canceled ? undefined : result.filePath;
    },
  });
  guardQuitDrain(app, () =>
    Promise.allSettled([
      accountArchive?.dispose(),
      interviewImages.dispose(),
      ledger.dispose(),
      codexUsageRuntime.stop(),
      copilotRuntime.stop(),
    ]),
  );
  handleDesktop('account:data', (event, call) => {
    requireMain(event);
    if (event.senderFrame !== event.sender.mainFrame || erasingAccount)
      throw Error('Unauthorized window');
    if (leavingAccount) return { ok: false as const, error: '账号正在退出，请稍候。' };
    if (interviewActive()) return { ok: false as const, error: '请先结束面试再导出资料。' };
    const user = cloudAccount.snapshot().user;
    if (!user && !localMode.active)
      return { ok: false as const, error: '请先登录 VoxCue 账号或选择本地账户。' };
    return accountArchive!.call(
      event.sender.id + ':' + (localMode.active ? 'local' : user!.id),
      call,
    );
  });
  registerInterviewImageIpc({
    store: interviewImages,
    requireMain,
    requireReader(event) {
      if (event.sender === mainWindow?.webContents) requireMain(event);
      else requireInterview(event);
    },
    async saveFile(event, image) {
      const win = BrowserWindow.fromWebContents(event.sender);
      if (!win || win.isDestroyed()) throw Error('截图窗口已关闭。');
      const result = await dialog.showSaveDialog(win, {
        title: nativeText('保存截屏'),
        defaultPath: path.join(
          app.getPath('pictures'),
          nativeText('VoxCue截屏') + '.' + image.extension,
        ),
        filters: [
          {
            name: nativeText(image.extension === 'png' ? 'PNG图片' : 'JPEG图片'),
            extensions: [image.extension],
          },
        ],
      });
      if (result.canceled || !result.filePath || win.isDestroyed()) return false;
      await writeFile(result.filePath, image.bytes, { mode: 0o600 });
      return true;
    },
  });
  interviewIpc = registerInterviewIpc({
    chat: ragChat,
    telemetry,
    requireInterview(event) {
      requireInterview(event);
    },
    isDemo: () => demoSession,
    configuration: () => speechSessions?.configuration,
    updateModel: (value, models) => speechSessions!.updateModel(value, models),
    context: interviewContext,
    captureScreen: (signal) =>
      captureInterviewScreenshot(
        interviewWindow!,
        desktopPlatform.id,
        signal,
        encodeScreenshotBitmap,
        desktopPlatform.captureScreen,
        desktopPlatform.id === 'darwin'
          ? interviewToolbarPoint(interviewWindow!.getBounds())
          : undefined,
      ),
    archiveImages: (images) => interviewImages.save(images),
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
          .slice(0, 100) || nativeText('面试记录');
      const result = await dialog.showSaveDialog(win, {
        title: nativeText('导出面试记录'),
        defaultPath: path.join(app.getPath('downloads'), name + '.txt'),
        filters: [{ name: nativeText('文本文件'), extensions: ['txt'] }],
      });
      if (result.canceled || !result.filePath) return false;
      await writeFile(result.filePath, '\uFEFF' + request.text, 'utf8');
      telemetry?.activity('history_export');
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
  const audioAccess = {
    platform: desktopPlatform.id,
    microphonePermission: () => systemPreferences.getMediaAccessStatus('microphone'),
    devices: async () => {
      if (!audioHelper) throw Error('当前系统尚未支持本地音频采集。');
      return capture.devices(audioHelper);
    },
    probe: async (source: AudioSource, device?: string) => {
      if (!audioHelper) return { ok: false };
      return capture.probeDevice(audioHelper, source, device);
    },
  };
  const interviewAccess = new access.InterviewAccess(audioAccess);
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
  const checkInterviewAccess = async (
    configuration: InterviewConfiguration,
  ): Promise<InterviewAccessReport> => {
    const report =
      configuration.inputMode === 'transcription'
        ? await checkTranscriptionAccess(configuration.options, audioAccess)
        : await interviewAccess.check(configuration.options);
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
        if (event.type === 'status' && event.status.state === 'error') {
          interviewAudioIntent.cancel();
          speechSessions.cancelInput();
        }
        if (speechSessions.blocksInput(event)) return;
        if (event.type === 'status') telemetry?.speechState(event.status.state);
        if (
          event.type === 'segment' &&
          event.segment.final &&
          event.segment.text.trim() &&
          event.segment.reason !== 'discontinuity'
        )
          telemetry?.transcript(event.segment.id);
        interviewContext.event(event, questionSource(speechSessions.configuration?.inputMode));
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
  handleDesktop('speech:call', async (event, value: unknown) => {
    const call = validateSpeech(value);
    if (
      event.sender === mainWindow?.webContents &&
      event.senderFrame === event.sender.mainFrame &&
      call.op === 'devices'
    )
      return speech!.call(call);
    requireInterview(event);
    if (call.op === 'start' || call.op === 'pause' || call.op === 'stop')
      interviewAudioIntent.cancel();
    if (call.op === 'start' && !demoSession) telemetry?.beginInterview();
    if (call.op === 'pause' || call.op === 'stop') {
      telemetry?.speechState('paused');
    }
    try {
      const status = await speechSessions!.interview(call);
      telemetry?.speechState(status.state);
      if (status.state === 'error' && call.op === 'start') telemetry?.audioFailed();
      publishInterviewShortcutsState();
      return status;
    } catch (error) {
      if (call.op === 'start') telemetry?.audioFailed();
      throw error;
    }
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
    const confirmed = speechSessions?.configuration;
    if (!confirmed) throw Error('请先开始本地语音面试。');
    if (speechSessions!.inputChanging) throw Error('音频输入正在切换，请稍候。');
    validateInterviewConfiguration({ ...confirmed, options: validated.options });
    if (validated.options.speechModel === 'qwen' && !resources.qwenModels)
      throw Error('当前平台尚未接入 Qwen 原生推理。');
    const owner = interviewWindow!;
    const rendererRevision = surfaceRevisions.get(owner);
    const attempt = interviewAudioIntent.begin(() => {
      if (
        owner !== interviewWindow ||
        owner.isDestroyed() ||
        surfaceRevisions.get(owner) !== rendererRevision
      )
        return false;
      try {
        requireInterview(event);
        return true;
      } catch {
        return false;
      }
    });
    try {
      const status = await attempt.run(
        () => speechHardware.require(validated.options),
        () => {
          components.require(speechComponent(validated.options));
          return speechSessions!.reconnect(options);
        },
      );
      telemetry?.speechState(status.state);
      return status;
    } catch (error) {
      if (attempt.current()) telemetry?.speechState('error');
      throw error;
    }
  });
  handleDesktop('interview:input', async (event, ...args: unknown[]) => {
    requireInterview(event);
    if (args.length !== 1) throw Error('Invalid request');
    const state = validateInterviewInput(args[0]);
    const confirmed = speechSessions?.configuration;
    if (!confirmed || confirmed.mode !== 'local') throw Error('请先开始本地语音面试。');
    if (speechSessions!.inputChanging) throw Error('音频输入正在切换，请稍候。');
    const next = validateInterviewConfiguration({
      ...confirmed,
      inputMode: state.inputMode,
      options: { ...confirmed.options, sources: inputSources(state) },
    });
    const owner = interviewWindow!;
    const revision = surfaceRevisions.get(owner);
    const attempt = interviewAudioIntent.begin(() => {
      if (
        owner !== interviewWindow ||
        owner.isDestroyed() ||
        surfaceRevisions.get(owner) !== revision
      )
        return false;
      try {
        requireInterview(event);
        return true;
      } catch {
        return false;
      }
    });
    try {
      const status = await attempt.run(
        async () => {
          if (state.inputMode === 'remote' && confirmed.inputMode === 'transcription') {
            const report = await interviewAccess.check({ ...next.options, sources: ['system'] });
            if (!report.ready)
              throw Error(
                report.checks
                  .filter((item) => item.status !== 'granted')
                  .map((item) => item.message)
                  .join('\n'),
              );
          }
          if (
            next.options.sources.includes('microphone') &&
            (checkedMicrophone?.owner !== owner ||
              checkedMicrophone.device !== next.options.microphone)
          ) {
            const report = await checkTranscriptionAccess(
              { ...next.options, sources: ['microphone'] },
              audioAccess,
            );
            if (!report.ready) throw Error(report.checks.map((item) => item.message).join('\n'));
          }
        },
        () => speechSessions!.setInputState(state),
      );
      if (next.options.sources.includes('microphone'))
        checkedMicrophone = { owner, device: next.options.microphone };
      publishInterviewShortcutsState();
      return status;
    } catch (error) {
      if (attempt.current()) telemetry?.speechState('error');
      throw error;
    }
  });
  handleDesktop('interview:check-access', async (event, value: unknown) => {
    requireMain(event);
    if (event.senderFrame !== event.sender.mainFrame) throw Error('Unauthorized frame');
    const configuration = validateInterviewConfiguration(value);
    if (configuration.mode !== 'local') throw Error('请选择本地音频设备。');
    knowledgeCoordinator.assertInterviewReady(configuration.knowledgeBaseId);
    return checkInterviewAccess(configuration);
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
    const configuration = validateInterviewConfiguration(value);
    if (interviewWindow) {
      openInterview();
      return;
    }
    if (!demoSession) telemetry?.beginInterview();
    let stage: TelemetryStage = 'preflight';
    const openingAbort = new AbortController();
    const abortOpening = () => openingAbort.abort();
    event.sender.once('destroyed', abortOpening);
    event.sender.once('did-start-loading', abortOpening);
    const assertOpeningOwner = () => {
      openingAbort.signal.throwIfAborted();
      if (
        event.sender.isDestroyed() ||
        event.sender !== mainWindow?.webContents ||
        event.senderFrame !== event.sender.mainFrame
      )
        throw Error('面试启动已取消。');
    };
    interviewOpening = true;
    updates?.refresh();
    try {
      if (!demoSession && !(await activeAuth().session())) throw new Error('Please sign in first');
      stage = 'model';
      if (configuration.options.speechModel === 'qwen' && !resources.qwenModels)
        throw Error('当前平台尚未接入 Qwen 原生推理。');
      await speechHardware.require(configuration.options);
      components.require(speechComponent(configuration.options));
      knowledgeCoordinator.assertInterviewReady(configuration.knowledgeBaseId);
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
        assertOpeningOwner();
        stage = 'permission';
        const access = await checkInterviewAccess(configuration);
        if (!access.ready)
          throw Error(
            access.checks
              .filter((check) => check.status !== 'granted')
              .map((check) => check.message)
              .join('\n'),
          );
      }
      stage = 'audio';
      assertOpeningOwner();
      await speechSessions!.confirm(configuration);
      try {
        stage = 'window';
        assertOpeningOwner();
        openInterview();
      } catch (error) {
        speechSessions!.releaseInterview(true);
        throw error;
      }
    } catch (error) {
      telemetry?.finishInterview(false, stage);
      throw error;
    } finally {
      event.sender.removeListener('destroyed', abortOpening);
      event.sender.removeListener('did-start-loading', abortOpening);
      interviewOpening = false;
      updates?.refresh();
    }
  });
  handleDesktop('interview:state', (event) => {
    requireInterview(event);
    return {
      visible: interviewVisibility?.visible ?? interviewWindow!.isVisible(),
      rendererRevision: surfaceRevisions.get(interviewWindow!) ?? 0,
      inputState: speechSessions!.inputState,
      protected: captureProtected,
      pinned: interviewWindow!.isAlwaysOnTop(),
      supported: desktopPlatform.captureProtectionSupported,
      collapsed: interviewCollapsed,
      transcriptVisible: interviewTranscriptVisible,
      layout: interviewCanvasLayout,
      configuration: speechSessions!.configuration!,
    };
  });
  handleDesktop('interview:capture', (event, allowed: unknown) => {
    requireInterview(event);
    if (typeof allowed !== 'boolean') throw new Error('Invalid request');
    interviewWindow!.setContentProtection(!allowed);
    interviewShortcutsWindow?.setContentProtection(!allowed);
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
    publishInterviewShortcutsState();
    return interviewCollapsed;
  });
  handleDesktop('interview:settings', (event, ...args: unknown[]) => {
    requireInterview(event);
    if (args.length !== 1 || typeof args[0] !== 'boolean') throw Error('Invalid request');
    interviewMove = undefined;
    interviewResize = undefined;
    const previous = interviewSettingsOpen;
    interviewSettingsOpen = args[0];
    try {
      if (interviewCollapsed) sizeInterview(interviewScale);
    } catch (error) {
      interviewSettingsOpen = previous;
      throw error;
    }
  });
  handleDesktop('interview:transcript', (event, visible: unknown) => {
    requireInterview(event);
    interviewMove = undefined;
    if (typeof visible !== 'boolean') throw Error('Invalid transcript visibility');
    interviewResize = undefined;
    interviewTranscriptVisible = visible;
    if (!interviewCollapsed) sizeInterview(interviewScale);
    publishInterviewShortcutsState();
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
          scale: interviewCanvasLayout
            ? interviewScale
            : Math.max(
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
    telemetry?.finishInterview(true);
    interviewCloseApproved = true;
    interviewWindow.close();
  });
  onDesktop('interview:mouse-passthrough', (event, ...args: unknown[]) => {
    if (
      !nativePresentation ||
      !desktopPlatform.presentation?.interviewMousePassthrough ||
      ![interviewWindow?.webContents, interviewShortcutsWindow?.webContents].includes(
        event.sender,
      ) ||
      event.senderFrame !== event.sender.mainFrame ||
      args.length !== 1 ||
      typeof args[0] !== 'boolean'
    )
      return;
    if (args[0] && event.sender === interviewWindow?.webContents && interviewMove) return;
    if (event.sender === interviewShortcutsWindow?.webContents)
      nativePresentation.setMousePassthrough(interviewShortcutsWindow, args[0]);
    else setInterviewMousePassthrough(args[0]);
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
  void selectionReady
    .then(async () => {
      await localModeReady;
      if (localMode.active) {
        accountState();
        telemetry?.entry('local');
        return true;
      }
      const result = await cloudAccount.call({ action: 'status' });
      accountState();
      if (result.ok && result.state.user && result.state.verified)
        telemetry?.entry('restore', result.state.user.createdAt);
      return (
        result.state.user ||
        (!app.isPackaged && process.env.COPILOT_TEST_USER_DATA
          ? await activeAuth().session()
          : null)
      );
    })
    .then((session) => {
      if (session) createMainWindow();
      else createLoginWindow();
    })
    .catch(() => createLoginWindow());
  app.on('activate', () => {
    if (revealExistingInterview(interviewWindow, interviewRevealCallbacks)) return;
    if (BrowserWindow.getAllWindows().length !== 0) return;
    if (desktopPlatform.id !== 'darwin') return createLoginWindow();
    void selectionReady
      .then(async () => {
        await localModeReady;
        if (localMode.active) {
          accountState();
          telemetry?.entry('local');
          return true;
        }
        const result = await cloudAccount.call({ action: 'status' });
        accountState();
        if (result.ok && result.state.user && result.state.verified)
          telemetry?.entry('restore', result.state.user.createdAt);
        return result.state.user;
      })
      .then((session) => {
        if (BrowserWindow.getAllWindows().length) return;
        if (session) createMainWindow();
        else createLoginWindow();
      })
      .catch(() => createLoginWindow());
  });
});
app.on('window-all-closed', () => {
  if (erasingAccount) return;
  if (desktopPlatform.quitOnAllWindowsClosed) app.quit();
});
app.on('will-quit', () => releaseInterviewShortcuts?.());
app.on('before-quit', (event) => {
  if (desktopPlatform.id === 'darwin') macQuitRequested = true;
  if (mainWindow && !mainWindow.isDestroyed() && !mainCloseFlushed) {
    event.preventDefault();
    mainWindow.close();
    return;
  }
  if (updates && !updatesClosed) {
    event.preventDefault();
    if (updatesClosing) return;
    updatesClosing = true;
    void updates
      .dispose()
      .catch(() => console.error('Unfinished update cleanup will retry on the next launch.'))
      .finally(() => {
        updatesClosed = true;
        app.quit();
      });
    return;
  }
  if (telemetry && !telemetryClosed) {
    event.preventDefault();
    if (telemetryClosing) return;
    telemetryClosing = true;
    void telemetry
      .close()
      .catch(() => console.error('Telemetry shutdown did not finish cleanly.'))
      .finally(() => {
        telemetryClosed = true;
        app.quit();
      });
    return;
  }
  remoteInterview?.reset();
  void remoteConnection?.disconnect().catch(() => {});
  components?.dispose();
  nativePresentation?.dispose();
  knowledgeCoordinator?.cancelAll();
  knowledge?.stop();
  historyJobs?.cancelAll();
  speech?.stop();
  interviewIpc?.cancel();
  auth?.cancel();
  copilotAuth?.cancel();
});
