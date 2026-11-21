import { describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { selectDesktopPlatform, desktopResources } from '../../../shared/electron/platform';
import { windows as windowsPolicy } from '../../../windows/electron/platform';
import { macos as macosPolicy } from '../../../macos/electron/platform';
import {
  windowOptions,
  profilePartition,
  restrictWindowNavigation,
  loadWindowPage,
  whenWindowReady,
} from '../../../shared/electron/window';

const native = vi.hoisted(() => ({ fork: vi.fn() }));
vi.mock('electron', () => ({ utilityProcess: { fork: native.fork } }));
import { SpeechHost } from '../../../shared/electron/backend/speech/host';

const paths = { icon: '/application/icon', preload: '/application/preload.js', owner: 'local' };
const environment = { appPath: '/application', resourcesPath: '/resources', packaged: false };

describe('桌面平台边界', () => {
  it('keeps accounts, local mode and login in separate persistent browser sessions', () => {
    const partition = (role: Parameters<typeof windowOptions>[0], owner?: string) =>
      windowOptions(role, windowsPolicy, { ...paths, owner }).webPreferences!.partition;
    const a = 'account:a0000000-0000-4000-8000-000000000001';
    const b = 'account:a0000000-0000-4000-8000-000000000002';
    expect(new Set([partition('main', a), partition('main', b), partition('main', 'local'),
      partition('main', 'demo'), partition('login', a)]).size).toBe(5);
    expect(partition('main', a)).toMatch(/^persist:/);
    expect(partition('interview', a)).toBe(partition('main', a));
    expect(partition('interview-shortcuts', a)).toBe(partition('main', a));
    expect(partition('login', b)).toBe(partition('login'));
    expect(() => partition('main')).toThrow();
  });
  it('gives shortcut help a sandboxed transparent frameless window on either platform', () => {
    for (const platform of [windowsPolicy, macosPolicy]) {
      expect(windowOptions('interview-shortcuts', platform, paths)).toMatchObject({
        width: 360,
        height: 380,
        frame: false,
        transparent: true,
        alwaysOnTop: true,
        show: false,
        skipTaskbar: true,
        resizable: false,
        maximizable: false,
        webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
      });
    }
  });
  it('Windows 完成加载但没有首帧时仍显示一次；后续首帧和重载不重复显示', () => {
    const win = Object.assign(new EventEmitter(), {
      webContents: new EventEmitter(),
      isDestroyed: () => false,
    });
    const show = vi.fn();
    whenWindowReady(win as Parameters<typeof whenWindowReady>[0], windowsPolicy, show);
    win.webContents.emit('did-finish-load');
    expect(show).toHaveBeenCalledTimes(1);
    win.emit('ready-to-show');
    win.webContents.emit('did-finish-load');
    expect(show).toHaveBeenCalledTimes(1);
  });
  it('disables Windows frame animations for both fading interview windows', () => {
    for (const role of ['interview', 'interview-shortcuts'] as const)
      expect(windowOptions(role, windowsPolicy, paths).thickFrame).toBe(false);
    expect(windowOptions('main', windowsPolicy, paths).thickFrame).toBeUndefined();
  });
  it('Mac 仍等待原生首帧；已关闭的窗口不再显示', () => {
    const win = Object.assign(new EventEmitter(), {
      webContents: new EventEmitter(),
      isDestroyed: () => false,
    });
    const show = vi.fn();
    whenWindowReady(win as Parameters<typeof whenWindowReady>[0], macosPolicy, show);
    win.webContents.emit('did-finish-load');
    expect(show).not.toHaveBeenCalled();
    win.emit('ready-to-show');
    expect(show).toHaveBeenCalledTimes(1);
    whenWindowReady(win as Parameters<typeof whenWindowReady>[0], windowsPolicy, show);
    win.emit('closed');
    win.webContents.emit('did-finish-load');
    win.emit('ready-to-show');
    expect(show).toHaveBeenCalledTimes(1);
  });
  it('detaches readiness listeners when a still-loading window is destroyed without reading its dead webContents getter', () => {
    const contents = new EventEmitter();
    let destroyed = false;
    const win = Object.assign(new EventEmitter(), { isDestroyed: () => destroyed });
    Object.defineProperty(win, 'webContents', {
      get() {
        if (destroyed) throw TypeError('Object has been destroyed');
        return contents;
      },
    });
    const show = vi.fn();
    whenWindowReady(win as Parameters<typeof whenWindowReady>[0], windowsPolicy, show);
    expect(contents.listenerCount('did-finish-load')).toBe(1);
    destroyed = true;
    expect(() => win.emit('closed')).not.toThrow();
    expect(contents.listenerCount('did-finish-load')).toBe(0);
    expect(win.listenerCount('ready-to-show')).toBe(0);
    contents.emit('did-finish-load');
    win.emit('ready-to-show');
    expect(show).not.toHaveBeenCalled();
  });
  it('Windows 保留 Acrylic、系统应用 ID、退出策略和原生能力', () => {
    const windows = windowsPolicy;
    expect(windowOptions('main', windows, paths)).toMatchObject({
      width: 1280,
      height: 800,
      minWidth: 960,
      minHeight: 680,
      frame: false,
      show: false,
      backgroundMaterial: 'acrylic',
      backgroundColor: '#00000000',
    });
    expect(windows).toMatchObject({
      appUserModelId: 'com.voxcue.desktop',
      quitOnAllWindowsClosed: true,
      captureProtectionSupported: true,
      microphoneSettingsUrl: 'ms-settings:privacy-microphone',
      credentialEncryptionLabel: 'Windows 凭据加密',
    });
  });
  it.each(['login', 'main', 'interview'] as const)('%s 窗口始终使用沙箱和同一 preload', (role) => {
    const options = windowOptions(role, windowsPolicy, paths);
    expect(options.webPreferences).toEqual({
      partition: role === 'login' ? 'persist:voxcue-login' : profilePartition(paths.owner),
      zoomFactor: 1,
      preload: paths.preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      additionalArguments: [
        '--voxcue-presentation=' + JSON.stringify(windowsPolicy.presentation),
        '--voxcue-system-language=zh-CN',
        '--voxcue-initial-language=zh-CN',
      ],
    });
    expect(options.icon).toBe(paths.icon);
    if (role !== 'main') expect(options).not.toHaveProperty('backgroundMaterial');
    if (role === 'login')
      expect(options).toMatchObject({
        width: 1000,
        height: 660,
        minWidth: 860,
        minHeight: 580,
        transparent: true,
        maximizable: false,
      });
    if (role === 'interview')
      expect(options).toMatchObject({
        width: 1060,
        height: 682,
        minWidth: 805,
        minHeight: 557,
        hasShadow: false,
        transparent: true,
        alwaysOnTop: true,
        resizable: false,
      });
  });
  it('macOS 保留驻留生命周期和原生策略，不启用 Windows 材质或 WASAPI', () => {
    const mac = macosPolicy;
    expect(mac.quitOnAllWindowsClosed).toBe(false);
    expect(mac.captureProtectionSupported).toBe(false);
    expect(mac.credentialEncryptionLabel).toBe('macOS 钥匙串');
    expect(mac.microphoneSettingsUrl).toContain('Privacy_Microphone');
    expect(windowOptions('main', mac, paths)).toMatchObject({
      frame: true,
      titleBarStyle: 'hidden',
      titleBarOverlay: false,
      trafficLightPosition: { x: 16, y: 18 },
      transparent: false,
    });
    expect(windowOptions('main', mac, paths)).toMatchObject({
      vibrancy: 'sidebar',
      visualEffectState: 'followWindow',
    });
    expect(windowOptions('login', mac, paths)).toMatchObject({
      frame: true,
      titleBarStyle: 'hidden',
      titleBarOverlay: false,
      trafficLightPosition: { x: 16, y: 18 },
      transparent: false,
      width: 1000,
      height: 660,
      minHeight: 580,
    });
    expect(windowOptions('interview', mac, paths)).toMatchObject({
      frame: false,
      alwaysOnTop: true,
    });
    expect(windowOptions('main', mac, paths)).not.toHaveProperty('backgroundMaterial');
    const resources = desktopResources({ ...environment, packaged: true }, mac);
    expect(resources.icon).toBe(path.join(environment.appPath, 'public/voxcue.png'));
    expect(resources.audioHelper).toBe(path.join(environment.resourcesPath, 'native/VoxCue.Audio'));
    expect(resources.speechProcess).toBe(
      path.join(environment.appPath, 'dist-electron/macos/electron/speech/process.js'),
    );
    expect(resources.screenPermission).toBe(
      path.join(environment.resourcesPath, 'native/VoxCue.ScreenPermission.node'),
    );
  });
  it('开发资源分离共享模型与平台运行时，不涉及用户数据路径', () => {
    const windows = windowsPolicy;
    const dev = desktopResources(environment, windows);
    expect(dev.screenPermission).toBeUndefined();
    expect(dev.icon).toBe(path.join(environment.appPath, 'public/voxcue.ico'));
    expect(dev.audioHelper).toBe(path.join(environment.appPath, 'native/bin/VoxCue.Audio.exe'));
    expect(dev.speechProcess).toBe(
      path.join(environment.appPath, 'dist-electron/windows/electron/speech/process.js'),
    );
    expect(dev.speechModels).toBe(
      path.resolve(environment.appPath, '../shared/local-models/speech'),
    );
    expect(dev.ragModel).toBe(
      path.resolve(environment.appPath, '../shared/local-models/rag/multilingual-e5-small'),
    );
    const macDev = desktopResources(environment, macosPolicy);
    expect(macDev.icon).toBe(path.join(environment.appPath, 'public/voxcue.png'));
    expect(macDev.speechModels).toBe(dev.speechModels);
    const packaged = desktopResources({ ...environment, packaged: true }, windows);
    expect(packaged.audioHelper).toBe(
      path.join(environment.resourcesPath, 'native/VoxCue.Audio.exe'),
    );
    expect(packaged.speechModels).toBe(path.join(environment.resourcesPath, 'models/speech'));
    expect(packaged.ragModel).toBe(
      path.join(environment.resourcesPath, 'models/rag/multilingual-e5-small'),
    );
  });
  it('其他系统不会被当成 Windows 或 macOS 支持', () => {
    const other = selectDesktopPlatform('linux');
    expect(other.id).toBe('linux');
    expect(other.captureProtectionSupported).toBe(false);
    expect(other.wasapiHelper).toBeUndefined();
  });
  it('原生音频尚未适配时拒绝调用，不启动 utilityProcess 或 Windows 助手', async () => {
    const host = new SpeechHost('/models', undefined, () => {});
    await expect(host.call({ op: 'devices' })).rejects.toThrow('当前系统尚未支持');
    expect(native.fork).not.toHaveBeenCalled();
  });
  it('每类窗口拒绝新窗口和导航，加载入口及 hash 保持一致', () => {
    const contents = {
      setWindowOpenHandler: vi.fn(),
      on: vi.fn(),
      setZoomFactor: vi.fn(),
      setVisualZoomLevelLimits: vi.fn(async () => {}),
    };
    restrictWindowNavigation({ webContents: contents } as any);
    expect(contents.setWindowOpenHandler.mock.calls[0][0]({})).toEqual({ action: 'deny' });
    const event = { preventDefault: vi.fn() };
    contents.on.mock.calls.find(([name]) => name === 'will-navigate')![1](event);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(contents.setZoomFactor).toHaveBeenCalledWith(1);
    expect(contents.setVisualZoomLevelLimits).toHaveBeenCalledWith(1, 1);
    const input = contents.on.mock.calls.find(([name]) => name === 'before-input-event')![1];
    for (const key of ['+', '=', '-', '_', '0', 'Add', 'Subtract']) {
      const blocked = { preventDefault: vi.fn() };
      input(blocked, { key, control: true });
      expect(blocked.preventDefault).toHaveBeenCalledOnce();
    }
    const allowed = { preventDefault: vi.fn() };
    input(allowed, { key: '+', control: false });
    input(allowed, { key: 'c', control: true });
    expect(allowed.preventDefault).not.toHaveBeenCalled();
    for (const role of ['login', 'main', 'interview', 'interview-shortcuts'] as const) {
      const window = { loadURL: vi.fn(), loadFile: vi.fn() };
      loadWindowPage(window, role, '/index.html', 'http://127.0.0.1:5173');
      expect(window.loadURL).toHaveBeenCalledWith(
        'http://127.0.0.1:5173' + (role === 'main' ? '' : '#' + role),
      );
      loadWindowPage(window, role, '/index.html');
      expect(window.loadFile.mock.calls[0]).toEqual(
        role === 'main' ? ['/index.html'] : ['/index.html', { hash: role }],
      );
    }
  });
});
