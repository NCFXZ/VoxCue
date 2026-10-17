import { beforeEach, afterEach, expect, it, vi } from 'vitest';
const native = vi.hoisted(() => ({
  visible: true,
  theme: { themeSource: 'system' },
  hide: vi.fn(),
  show: vi.fn(async () => {}),
  icon: vi.fn(),
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
}));
import { createPresentation } from '../../electron/presentation';
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(10000);
  vi.clearAllMocks();
  native.visible = true;
  native.show.mockResolvedValue(undefined);
  native.theme.themeSource = 'system';
});
afterEach(() => vi.useRealTimers());
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
  expect(native.icon).toHaveBeenLastCalledWith('voxcue.png');
  await vi.advanceTimersByTimeAsync(1100);
  expect(native.hide).toHaveBeenCalledTimes(1);
  port.dispose();
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
