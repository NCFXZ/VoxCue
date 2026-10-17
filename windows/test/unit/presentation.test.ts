import { afterAll, expect, it, vi } from 'vitest';
import type { BrowserWindow } from 'electron';
const native = vi.hoisted(() => ({ themeSource: 'system' }));
vi.mock('electron', () => ({ nativeTheme: native }));
import { createPresentation } from '../../electron/presentation';
import { ScreenPermission } from '../../electron/screenPermission';
const original = Object.getOwnPropertyDescriptor(process, 'getSystemVersion');
let version = '10.0.26300';
Object.defineProperty(process, 'getSystemVersion', { configurable: true, value: () => version });
afterAll(() => {
  if (original) Object.defineProperty(process, 'getSystemVersion', original);
  else Reflect.deleteProperty(process, 'getSystemVersion');
});
const windowPort = () => ({
  isDestroyed: vi.fn(() => false),
  setIcon: vi.fn(),
  setSkipTaskbar: vi.fn(),
  setAlwaysOnTop: vi.fn(),
  setIgnoreMouseEvents: vi.fn(),
  hide: vi.fn(),
  on: vi.fn(),
});
it('Acrylic 能力遵循 Windows 11 22H2 的实际支持边界', () => {
  version = '10.0.19045';
  expect(
    createPresentation({ icon: 'VoxCue.ico', interviewOpen: () => false }).capabilities
      ?.frostedTransparency,
  ).toBe(false);
  version = '10.0.22621';
  expect(
    createPresentation({ icon: 'VoxCue.ico', interviewOpen: () => false }).capabilities
      ?.frostedTransparency,
  ).toBe(true);
});
it('重复面试恢复主窗口与源图标，迟到恢复不会暴露新的面试', async () => {
  let open = true;
  const port = createPresentation({ icon: 'VoxCue.ico', interviewOpen: () => open });
  const main = windowPort(),
    floating = windowPort();
  for (let cycle = 0; cycle < 20; cycle++) {
    open = true;
    port.prepareInterview(floating as unknown as BrowserWindow);
    port.hideMain(main as unknown as BrowserWindow);
    await port.restoreInterviewIcon();
    expect(main.setSkipTaskbar).toHaveBeenLastCalledWith(true);
    open = false;
    await port.restoreInterviewIcon();
    expect(main.setSkipTaskbar).toHaveBeenLastCalledWith(false);
    expect(main.setIcon).toHaveBeenLastCalledWith('VoxCue.ico');
  }
  expect(main.setIcon).toHaveBeenCalledTimes(20);
  port.pinInterview(floating as unknown as BrowserWindow);
  expect(floating.setAlwaysOnTop).toHaveBeenCalledWith(true, 'normal');
  port.setMousePassthrough(floating as unknown as BrowserWindow, true);
  expect(floating.setIgnoreMouseEvents).toHaveBeenCalledWith(true, { forward: true });
  port.setTheme('dark');
  expect(native.themeSource).toBe('dark');
  port.dispose();
});
it('已销毁主窗口不会被恢复操作引用', async () => {
  let open = true;
  const port = createPresentation({ icon: 'VoxCue.ico', interviewOpen: () => open });
  const main = windowPort();
  port.hideMain(main as unknown as BrowserWindow);
  main.isDestroyed.mockReturnValue(true);
  open = false;
  await port.restoreInterviewIcon();
  expect(main.setIcon).not.toHaveBeenCalled();
  port.dispose();
});
it('屏幕能力不伪造授权，也不执行无意义的申请或设置操作', async () => {
  const access = new ScreenPermission();
  expect(await access.call('check')).toMatchObject({ status: 'not-required' });
  await expect(access.call('request')).rejects.toThrow('无需单独申请');
  await expect(access.call('open-settings')).rejects.toThrow('无需单独申请');
});
