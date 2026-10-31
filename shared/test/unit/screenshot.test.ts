import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { BrowserWindow } from 'electron';
import { EventEmitter } from 'node:events';
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
import {
  captureInterviewScreenshot,
  prepareInterviewScreenshot,
} from '../../../shared/electron/screenshot';
const captureFile = async (...args: Parameters<typeof captureInterviewScreenshot>) =>
  (await captureInterviewScreenshot(...args)).file;
afterEach(() => vi.useRealTimers());
const window = {
  isDestroyed: () => false,
  getBounds: () => ({ x: 50, y: 50, width: 1000, height: 700 }),
} as unknown as BrowserWindow;
const source = (display_id = '2') => {
  const thumbnail = {
    isEmpty: vi.fn(() => false),
    getSize: vi.fn(() => ({ width: 3840, height: 2400 })),
    resize: vi.fn(),
    toPNG: vi.fn(() => Buffer.from([137, 80, 78, 71])),
    toJPEG: vi.fn(() => Buffer.from([255, 216, 255])),
  };
  thumbnail.resize.mockReturnValue(thumbnail);
  return { display_id, thumbnail };
};
it('原生枚举一直不返回时取消立即结束请求，迟到图像不会编码或发送', async () => {
  let finish!: (sources: unknown[]) => void;
  native.getSources.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const controller = new AbortController();
  let failure: unknown;
  const pending = captureFile(window, 'darwin', controller.signal).catch((error) => {
    failure = error;
  });
  controller.abort();
  // The real screenshot API includes encoding/preview promises; cancellation
  // must still settle before the next event-loop turn, without a native result.
  await new Promise((resolve) => setImmediate(resolve));
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
  const pending = captureFile(window, 'darwin', new AbortController().signal).catch((error) => {
    failure = error;
  });
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
  await captureFile(window, 'win32', new AbortController().signal);
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
  const result = await captureFile(window, 'win32', new AbortController().signal);
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
  await expect(captureFile(window, 'win32', new AbortController().signal)).rejects.toThrow(
    '所在屏幕',
  );
  native.getAllDisplays.mockReturnValue([{}]);
  expect(
    (await captureFile(window, 'win32', new AbortController().signal)).bytes.byteLength,
  ).toBeGreaterThan(0);
});
it('权限、捕获异常和空截图明确失败', async () => {
  native.getMediaAccessStatus.mockReturnValue('denied');
  await expect(captureFile(window, 'darwin', new AbortController().signal)).rejects.toThrow('允许');
  expect(native.getSources).not.toHaveBeenCalled();
  native.getSources.mockRejectedValueOnce(Error('native failure'));
  await expect(captureFile(window, 'win32', new AbortController().signal)).rejects.toThrow(
    '无法截取',
  );
  const empty = source();
  empty.thumbnail.isEmpty.mockReturnValue(true);
  native.getSources.mockResolvedValue([empty]);
  await expect(captureFile(window, 'win32', new AbortController().signal)).rejects.toThrow(
    '未能获取',
  );
});
it('大 PNG 使用有界 JPEG，空或超限编码不能发送', async () => {
  const large = source();
  large.thumbnail.toPNG.mockReturnValue(Buffer.alloc(8 * 1024 * 1024 + 1));
  native.getSources.mockResolvedValue([large]);
  expect((await captureFile(window, 'win32', new AbortController().signal)).name).toBe(
    'screenshot.jpg',
  );
  large.thumbnail.toJPEG.mockReturnValue(Buffer.alloc(8 * 1024 * 1024 + 1));
  await expect(captureFile(window, 'win32', new AbortController().signal)).rejects.toThrow(
    '过大或无效',
  );
  large.thumbnail.toPNG.mockReturnValue(Buffer.alloc(0));
  await expect(captureFile(window, 'win32', new AbortController().signal)).rejects.toThrow(
    '过大或无效',
  );
});
it('开始前取消不读取屏幕，截取中取消不编码或返回图片', async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(captureFile(window, 'win32', controller.signal)).rejects.toMatchObject({
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
  const pending = captureFile(window, 'win32', active.signal);
  active.abort();
  finish([image]);
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  expect(image.thumbnail.toPNG).not.toHaveBeenCalled();
});

it.each(['win32', 'darwin'] as const)(
  '在%s提前准备只枚举元数据，不读取或编码图像',
  async (platform) => {
    const owner = Object.assign(new EventEmitter(), window) as unknown as BrowserWindow;
    const image = source();
    native.getSources.mockResolvedValue([image]);
    await prepareInterviewScreenshot(owner, platform);
    expect(native.getSources).toHaveBeenCalledWith({
      types: ['screen'],
      thumbnailSize: { width: 0, height: 0 },
      fetchWindowIcons: false,
    });
    expect(image.thumbnail.getSize).not.toHaveBeenCalled();
    expect(image.thumbnail.toPNG).not.toHaveBeenCalled();
    expect(image.thumbnail.resize).not.toHaveBeenCalled();
    expect(owner.listenerCount('closed')).toBe(0);
  },
);
it('Mac未授权或窗口已关闭时准备不发起屏幕枚举', async () => {
  native.getMediaAccessStatus.mockReturnValue('denied');
  await prepareInterviewScreenshot(window, 'darwin');
  await prepareInterviewScreenshot(
    { ...window, isDestroyed: () => true } as BrowserWindow,
    'win32',
  );
  expect(native.getSources).not.toHaveBeenCalled();
});
it('关闭和超时会结束准备并释放监听，准备失败不阻止实际截图', async () => {
  const owner = Object.assign(new EventEmitter(), window) as unknown as BrowserWindow;
  let finish!: (value: unknown[]) => void;
  native.getSources.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const pending = prepareInterviewScreenshot(owner, 'win32');
  owner.emit('closed');
  await pending;
  expect(owner.listenerCount('closed')).toBe(0);
  const late = source();
  finish([late]);
  await Promise.resolve();
  expect(late.thumbnail.toPNG).not.toHaveBeenCalled();
  vi.useFakeTimers();
  native.getSources.mockReturnValueOnce(new Promise(() => {}));
  const timed = prepareInterviewScreenshot(owner, 'win32');
  await vi.advanceTimersByTimeAsync(10001);
  await timed;
  expect(owner.listenerCount('closed')).toBe(0);
  native.getSources.mockResolvedValueOnce([source()]);
  expect(
    (await captureFile(window, 'win32', new AbortController().signal)).bytes.length,
  ).toBeGreaterThan(0);
});
it('完整截图与预览复用原生图像，每次点击仍重新获取新图', async () => {
  const first = source(),
    second = source(),
    preview = source();
  first.thumbnail.toPNG.mockReturnValue(Buffer.from([1]));
  second.thumbnail.toPNG.mockReturnValue(Buffer.from([2]));
  for (const image of [first, second]) image.thumbnail.resize.mockReturnValue(preview.thumbnail);
  native.getSources.mockResolvedValueOnce([first]).mockResolvedValueOnce([second]);
  const before = await captureInterviewScreenshot(window, 'win32', new AbortController().signal);
  const after = await captureInterviewScreenshot(window, 'win32', new AbortController().signal);
  expect(before.file.bytes).toEqual(new Uint8Array([1]));
  expect(after.file.bytes).toEqual(new Uint8Array([2]));
  expect(native.getSources).toHaveBeenCalledTimes(2);
  expect(first.thumbnail.toPNG).toHaveBeenCalledOnce();
  expect(second.thumbnail.toPNG).toHaveBeenCalledOnce();
  expect(preview.thumbnail.toJPEG).toHaveBeenCalledWith(75);
  expect(before.preview).toMatch(/^data:image\/jpeg;base64,/);
});

it('注入原生取屏端口时沿用共享编码与预览，取消后不处理迟到帧', async () => {
  const image = source(),
    preview = source();
  image.thumbnail.resize.mockReturnValue(preview.thumbnail);
  const capture = vi.fn().mockResolvedValue(image.thumbnail);
  await captureInterviewScreenshot(window, 'win32', new AbortController().signal, capture);
  expect(capture).toHaveBeenCalledOnce();
  expect(native.getSources).not.toHaveBeenCalled();
  expect(image.thumbnail.toPNG).toHaveBeenCalledOnce();
  expect(preview.thumbnail.toJPEG).toHaveBeenCalledWith(75);
  image.thumbnail.toPNG.mockClear();
  const controller = new AbortController();
  capture.mockImplementation(async () => {
    controller.abort();
    return image.thumbnail;
  });
  await expect(
    captureInterviewScreenshot(window, 'win32', controller.signal, capture),
  ).rejects.toMatchObject({ name: 'AbortError' });
  expect(image.thumbnail.toPNG).not.toHaveBeenCalled();
});
