import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { BrowserWindow } from 'electron';
const native = vi.hoisted(() => ({
  getSources: vi.fn(),
  getDisplayMatching: vi.fn(),
  getAllDisplays: vi.fn(),
  getMediaAccessStatus: vi.fn(),
}));
vi.mock('electron', () => ({
  desktopCapturer: { getSources: native.getSources },
  screen: { getDisplayMatching: native.getDisplayMatching, getAllDisplays: native.getAllDisplays },
  systemPreferences: { getMediaAccessStatus: native.getMediaAccessStatus },
}));
import { captureInterviewScreen } from '../../../shared/electron/screenshot';
afterEach(() => vi.useRealTimers());
const window = {
  isDestroyed: () => false,
  getBounds: () => ({ x: 50, y: 50, width: 1000, height: 700 }),
} as unknown as BrowserWindow;
const source = (display_id = '2') => ({
  display_id,
  thumbnail: {
    isEmpty: vi.fn(() => false),
    getSize: vi.fn(() => ({ width: 3840, height: 2400 })),
    resize: vi.fn(),
    toPNG: vi.fn(() => Buffer.from([137, 80, 78, 71])),
    toJPEG: vi.fn(() => Buffer.from([255, 216, 255])),
  },
});
it('原生枚举一直不返回时取消立即结束请求，迟到图像不会编码或发送', async () => {
  let finish!: (sources: unknown[]) => void;
  native.getSources.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const controller = new AbortController();
  let failure: unknown;
  const pending = captureInterviewScreen(window, 'darwin', controller.signal).catch((error) => {
    failure = error;
  });
  controller.abort();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  expect(failure).toMatchObject({ name: 'AbortError' });
  await pending;
  const late = source();
  finish([late]);
  await Promise.resolve();
  expect(late.thumbnail.toPNG).not.toHaveBeenCalled();
});
it('原生捕获挂起会在十秒内明确失败，不让面试请求永久停留', async () => {
  vi.useFakeTimers();
  native.getSources.mockReturnValue(new Promise(() => {}));
  let failure: unknown;
  const pending = captureInterviewScreen(window, 'darwin', new AbortController().signal).catch(
    (error) => {
      failure = error;
    },
  );
  await vi.advanceTimersByTimeAsync(10001);
  expect(failure).toBeInstanceOf(Error);
  await pending;
});
it('原生缩略图超过请求尺寸时仍约束实际图像尺寸', async () => {
  const large = source(),
    bounded = source();
  large.thumbnail.getSize.mockReturnValue({ width: 7680, height: 4320 });
  large.thumbnail.resize.mockReturnValue(bounded.thumbnail);
  native.getSources.mockResolvedValue([large]);
  await captureInterviewScreen(window, 'win32', new AbortController().signal);
  expect(large.thumbnail.resize).toHaveBeenCalledWith({
    width: 3840,
    height: 2160,
    quality: 'best',
  });
  expect(large.thumbnail.toPNG).not.toHaveBeenCalled();
  expect(bounded.thumbnail.toPNG).toHaveBeenCalledOnce();
});
beforeEach(() => {
  vi.clearAllMocks();
  native.getDisplayMatching.mockReturnValue({
    id: 2,
    size: { width: 2880, height: 1800 },
    scaleFactor: 2,
  });
  native.getAllDisplays.mockReturnValue([{}, {}]);
  native.getMediaAccessStatus.mockReturnValue('granted');
  native.getSources.mockResolvedValue([source()]);
});
it('只选择浮窗所在显示器，限制图片尺寸并返回临时附件', async () => {
  const other = source('1'),
    current = source('2');
  native.getSources.mockResolvedValue([other, current]);
  const result = await captureInterviewScreen(window, 'win32', new AbortController().signal);
  expect(native.getSources).toHaveBeenCalledWith({
    types: ['screen'],
    thumbnailSize: { width: 3840, height: 2400 },
    fetchWindowIcons: false,
  });
  expect(result).toEqual({ name: 'screenshot.png', bytes: new Uint8Array([137, 80, 78, 71]) });
  expect(other.thumbnail.toPNG).not.toHaveBeenCalled();
  expect(current.thumbnail.toPNG).toHaveBeenCalledOnce();
});
it('单屏兼容缺少显示器 ID，多屏不能静默截取其他屏幕', async () => {
  native.getSources.mockResolvedValue([source('')]);
  await expect(
    captureInterviewScreen(window, 'win32', new AbortController().signal),
  ).rejects.toThrow('所在屏幕');
  native.getAllDisplays.mockReturnValue([{}]);
  expect(
    (await captureInterviewScreen(window, 'win32', new AbortController().signal)).bytes.byteLength,
  ).toBeGreaterThan(0);
});
it('权限、捕获异常和空截图明确失败', async () => {
  native.getMediaAccessStatus.mockReturnValue('denied');
  await expect(
    captureInterviewScreen(window, 'darwin', new AbortController().signal),
  ).rejects.toThrow('允许');
  expect(native.getSources).not.toHaveBeenCalled();
  native.getSources.mockRejectedValueOnce(Error('native failure'));
  await expect(
    captureInterviewScreen(window, 'win32', new AbortController().signal),
  ).rejects.toThrow('无法截取');
  const empty = source();
  empty.thumbnail.isEmpty.mockReturnValue(true);
  native.getSources.mockResolvedValue([empty]);
  await expect(
    captureInterviewScreen(window, 'win32', new AbortController().signal),
  ).rejects.toThrow('未能获取');
});
it('大 PNG 使用有界 JPEG，空或超限编码不能发送', async () => {
  const large = source();
  large.thumbnail.toPNG.mockReturnValue(Buffer.alloc(8 * 1024 * 1024 + 1));
  native.getSources.mockResolvedValue([large]);
  expect((await captureInterviewScreen(window, 'win32', new AbortController().signal)).name).toBe(
    'screenshot.jpg',
  );
  large.thumbnail.toJPEG.mockReturnValue(Buffer.alloc(8 * 1024 * 1024 + 1));
  await expect(
    captureInterviewScreen(window, 'win32', new AbortController().signal),
  ).rejects.toThrow('过大或无效');
  large.thumbnail.toPNG.mockReturnValue(Buffer.alloc(0));
  await expect(
    captureInterviewScreen(window, 'win32', new AbortController().signal),
  ).rejects.toThrow('过大或无效');
});
it('开始前取消不读取屏幕，截取中取消不编码或返回图片', async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(captureInterviewScreen(window, 'win32', controller.signal)).rejects.toMatchObject({
    name: 'AbortError',
  });
  expect(native.getSources).not.toHaveBeenCalled();
  let finish!: (sources: unknown[]) => void;
  native.getSources.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const active = new AbortController(),
    image = source();
  const pending = captureInterviewScreen(window, 'win32', active.signal);
  active.abort();
  finish([image]);
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  expect(image.thumbnail.toPNG).not.toHaveBeenCalled();
});
