import { beforeEach, afterEach, expect, it, vi } from 'vitest';
const native = vi.hoisted(() => ({
  visible: true,
  theme: { themeSource: 'system', on: vi.fn(), removeListener: vi.fn() },
  hide: vi.fn(),
  show: vi.fn(async () => {}),
  icon: vi.fn(),
  image: { setTemplateImage: vi.fn() },
  loadImage: vi.fn(),
}));
vi.mock('electron', () => ({
  app: {
    dock: {
      isVisible: () => native.visible,
      hide: native.hide,
      show: native.show,
      setIcon: native.icon,
    },
  },
  nativeTheme: native.theme,
  nativeImage: { createFromPath: native.loadImage },
}));
import { createPresentation } from '../../electron/presentation';
import { pendingPresentation } from '../../../shared/electron/contracts/presentation';
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(10000);
  vi.clearAllMocks();
  native.visible = true;
  native.show.mockResolvedValue(undefined);
  native.theme.themeSource = 'system';
  native.loadImage.mockReturnValue(native.image);
});
afterEach(() => vi.useRealTimers());
it('旧系统明确不支持 Liquid Glass 时不调用原生材质或强制面试深色', () => {
  const material = {
    available: false,
    configureInterviewAppearance: vi.fn(),
    configureButton: vi.fn(),
  };
  const port = createPresentation({
    icon: 'icon.png',
    capabilities: pendingPresentation,
    material: material as any,
    interviewOpen: () => false,
  });
  expect(port.capabilities?.liquidGlass).toBe(false);
  const win = { setVisibleOnAllWorkspaces: vi.fn(), isDestroyed: () => false };
  port.prepareInterview(win as any);
  expect(port.setGlassButton!(win as any, 'start', null, vi.fn())).toBe(false);
  expect(material.configureInterviewAppearance).not.toHaveBeenCalled();
  expect(material.configureButton).not.toHaveBeenCalled();
  expect(win.setVisibleOnAllWorkspaces).toHaveBeenCalledOnce();
  port.dispose();
});
it('只有原生模块明确支持才向共享页面宣告 Liquid Glass 能力', () => {
  for (const available of [true, false, undefined]) {
    const port = createPresentation({
      icon: 'icon.png',
      capabilities: pendingPresentation,
      material: { available } as any,
      interviewOpen: () => false,
    });
    expect(port.capabilities?.liquidGlass).toBe(available === true);
    port.dispose();
  }
});
it('只设置本应用外观，系统/浅/深均通过原生端口，窗口置顶不抢焦点', () => {
  const port = createPresentation({ icon: 'icon.png', interviewOpen: () => true });
  for (const theme of ['dark', 'light', 'system'] as const) {
    port.setTheme(theme);
    expect(native.theme.themeSource).toBe(theme);
  }
  const win = {
    setAlwaysOnTop: vi.fn(),
    setVisibleOnAllWorkspaces: vi.fn(),
    setIgnoreMouseEvents: vi.fn(),
    hide: vi.fn(),
    focus: vi.fn(),
  };
  port.pinInterview(win as any);
  port.prepareInterview(win as any);
  port.hideMain(win as any);
  port.setMousePassthrough(win as any, true);
  expect(win.setAlwaysOnTop).toHaveBeenCalledWith(true, 'floating');
  expect(win.setIgnoreMouseEvents).toHaveBeenCalledWith(true, { forward: true });
  expect(win.focus).not.toHaveBeenCalled();
  port.dispose();
});
it('隐藏节流任务在面试结束/释放后不执行，不能让已恢复的 Dock 再消失', async () => {
  let open = true;
  const port = createPresentation({ icon: 'icon.png', interviewOpen: () => open });
  port.hideInterviewIcon();
  expect(native.hide).toHaveBeenCalledTimes(1);
  port.hideInterviewIcon();
  open = false;
  await vi.advanceTimersByTimeAsync(1100);
  expect(native.hide).toHaveBeenCalledTimes(1);
  open = true;
  port.hideInterviewIcon();
  port.hideInterviewIcon();
  port.dispose();
  await vi.advanceTimersByTimeAsync(1100);
  expect(native.hide).toHaveBeenCalledTimes(2);
});
it('Dock 显示前及异步完成后均恢复应用图标，并取消迟到的隐藏任务', async () => {
  const port = createPresentation({ icon: 'voxcue.png', interviewOpen: () => true });
  port.initialize();
  port.hideInterviewIcon();
  port.hideInterviewIcon();
  let finish!: () => void;
  native.show.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const restoring = port.restoreInterviewIcon();
  expect(native.icon).toHaveBeenCalledTimes(2);
  finish();
  await restoring;
  expect(native.icon).toHaveBeenCalledTimes(3);
  expect(native.icon).toHaveBeenLastCalledWith(native.image);
  await vi.advanceTimersByTimeAsync(1100);
  expect(native.hide).toHaveBeenCalledTimes(1);
  port.dispose();
});
it('主题变化始终重用原始彩图，不显示隐藏的 Dock，释放后停止监听', () => {
  const port = createPresentation({ icon: 'voxcue.png', interviewOpen: () => true });
  expect(native.loadImage).toHaveBeenCalledExactlyOnceWith('voxcue.png');
  expect(native.image.setTemplateImage).toHaveBeenCalledExactlyOnceWith(false);
  port.initialize();
  port.initialize();
  expect(native.theme.on).toHaveBeenCalledTimes(1);
  expect(native.theme.on.mock.calls[0][0]).toBe('updated');
  const updated = native.theme.on.mock.calls[0][1];
  for (const theme of ['dark', 'light', 'system'] as const) {
    port.setTheme(theme);
    updated();
    expect(native.icon).toHaveBeenLastCalledWith(native.image);
  }
  expect(native.show).not.toHaveBeenCalled();
  expect(native.hide).not.toHaveBeenCalled();
  port.dispose();
  expect(native.theme.removeListener).toHaveBeenCalledExactlyOnceWith('updated', updated);
});
it('刚恢复 Dock 后再次开始面试，隐藏也必须避开 show 的一秒保护期', async () => {
  const port = createPresentation({ icon: 'voxcue.png', interviewOpen: () => true });
  await port.restoreInterviewIcon();
  port.hideInterviewIcon();
  expect(native.hide).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1099);
  expect(native.hide).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(native.hide).toHaveBeenCalledOnce();
  port.dispose();
});

it('面试只允许当前可见返回按钮的隔离前景，不开放任意弹窗或输入框投影', () => {
  const material = {
    configureInterviewAppearance: vi.fn(),
    configureInterviewMaterials: vi.fn(() => true),
  };
  let open!: (request: { url: string; frameName: string }) => { action: string };
  const win = {
    once: vi.fn(),
    isDestroyed: () => false,
    getNativeWindowHandle: () => Buffer.alloc(8),
    setVisibleOnAllWorkspaces: vi.fn(),
    webContents: {
      on: vi.fn(),
      setWindowOpenHandler: vi.fn((handler) => {
        open = handler;
      }),
    },
  };
  const port = createPresentation({
    icon: 'icon.png',
    material: material as any,
    interviewOpen: () => true,
  });
  port.prepareInterview(win as any);
  const request = { url: 'about:blank', frameName: 'voxcue-follow-surface-1' };
  expect(open(request).action).toBe('deny');
  port.setInterviewMaterials!(win as any, [{ style: 'regular-interactive' } as any]);
  expect(open(request).action).toBe('allow');
  expect(open({ ...request, frameName: 'voxcue-composer-surface-1' }).action).toBe('deny');
  expect(open({ ...request, url: 'https://example.com' }).action).toBe('deny');
  expect(open({ ...request, frameName: 'arbitrary' }).action).toBe('deny');
  port.setInterviewMaterials!(win as any, []);
  expect(open(request).action).toBe('deny');
  port.dispose();
});
