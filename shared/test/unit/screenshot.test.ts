import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { BrowserWindow } from 'electron';
import { EventEmitter } from 'node:events';
const native = vi.hoisted(() => ({
  getSources: vi.fn(),
  getDisplayMatching: vi.fn(),
  getDisplayNearestPoint: vi.fn(),
  getAllDisplays: vi.fn(),
  getMediaAccessStatus: vi.fn(),
  encode: vi.fn(),
}));
vi.mock('electron', () => ({
  desktopCapturer: { getSources: native.getSources },
  screen: {
    getDisplayMatching: native.getDisplayMatching,
    getDisplayNearestPoint: native.getDisplayNearestPoint,
    getAllDisplays: native.getAllDisplays,
  },
  systemPreferences: { getMediaAccessStatus: native.getMediaAccessStatus },
}));
import {
  captureInterviewScreenshot as captureScreenshot,
  prepareInterviewScreenshot,
} from '../../electron/screenshot';
const captureInterviewScreenshot = (
  window: BrowserWindow,
  platform: NodeJS.Platform,
  signal: AbortSignal,
  captureScreen?: Parameters<typeof captureScreenshot>[4],
  displayPoint?: Parameters<typeof captureScreenshot>[5],
) => captureScreenshot(window, platform, signal, native.encode, captureScreen, displayPoint);
const captureFile = async (...args: Parameters<typeof captureInterviewScreenshot>) =>
  (await captureInterviewScreenshot(...args)).file;
const window = {
  isDestroyed: () => false,
  getBounds: () => ({ x: 50, y: 50, width: 1000, height: 700 }),
} as unknown as BrowserWindow;
function source(display_id = '2') {
  const thumbnail = {
    isEmpty: vi.fn(() => false),
    getSize: vi.fn(() => ({ width: 2, height: 2 })),
    toBitmap: vi.fn(() => Buffer.alloc(16)),
    toPNG: vi.fn(),
    toJPEG: vi.fn(),
    resize: vi.fn(),
  };
  return { display_id, thumbnail };
}
beforeEach(() => {
  vi.clearAllMocks();
  native.getDisplayMatching.mockReturnValue({
    id: 2,
    size: { width: 2880, height: 1800 },
    scaleFactor: 2,
  });
  native.getAllDisplays.mockReturnValue([{}, {}]);
  native.getDisplayNearestPoint.mockImplementation(() => native.getDisplayMatching());
  native.getMediaAccessStatus.mockReturnValue('granted');
  native.getSources.mockResolvedValue([source()]);
  native.encode.mockImplementation(async () => ({
    file: { name: 'screenshot.png', bytes: new Uint8Array([137, 80, 78, 71]) },
    preview: 'data:image/jpeg;base64,/9j/',
  }));
});
afterEach(() => vi.useRealTimers());
it('enumeration cancellation settles immediately and never processes late frames', async () => {
  let finish!: (value: unknown[]) => void;
  native.getSources.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const controller = new AbortController();
  const pending = captureFile(window, 'darwin', controller.signal);
  controller.abort();
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  const late = source();
  finish([late]);
  await Promise.resolve();
  expect(late.thumbnail.toBitmap).not.toHaveBeenCalled();
  expect(native.encode).not.toHaveBeenCalled();
});
it('bounds a hung native enumeration to ten seconds', async () => {
  vi.useFakeTimers();
  native.getSources.mockReturnValue(new Promise(() => {}));
  const pending = expect(
    captureFile(window, 'darwin', new AbortController().signal),
  ).rejects.toThrow('无法截取');
  await vi.advanceTimersByTimeAsync(10001);
  await pending;
});
it('selects only the interview display and transfers pixels without resizing or encoding in main', async () => {
  const other = source('1'),
    current = source('2');
  native.getSources.mockResolvedValue([other, current]);
  expect((await captureFile(window, 'win32', new AbortController().signal)).name).toBe(
    'screenshot.png',
  );
  expect(native.getSources).toHaveBeenCalledWith({
    types: ['screen'],
    thumbnailSize: { width: 3840, height: 2400 },
    fetchWindowIcons: false,
  });
  expect(other.thumbnail.toBitmap).not.toHaveBeenCalled();
  expect(current.thumbnail.toBitmap).toHaveBeenCalledOnce();
  expect(native.encode).toHaveBeenCalledWith(
    { width: 2, height: 2, bitmap: expect.any(ArrayBuffer) },
    expect.any(AbortSignal),
  );
  for (const method of [
    current.thumbnail.toPNG,
    current.thumbnail.toJPEG,
    current.thumbnail.resize,
  ])
    expect(method).not.toHaveBeenCalled();
});
it('passes oversized native frames to the worker for dimension limiting and rejects excessive or malformed frames', async () => {
  const image = source();
  image.thumbnail.getSize.mockReturnValue({ width: 7680, height: 4320 });
  image.thumbnail.toBitmap.mockReturnValue(Buffer.alloc(7680 * 4320 * 4));
  native.getSources.mockResolvedValue([image]);
  await captureFile(window, 'win32', new AbortController().signal);
  expect(native.encode).toHaveBeenCalledWith(
    expect.objectContaining({ width: 7680, height: 4320 }),
    expect.any(AbortSignal),
  );
  expect(image.thumbnail.resize).not.toHaveBeenCalled();
  image.thumbnail.getSize.mockReturnValue({ width: 16385, height: 1 });
  await expect(captureFile(window, 'win32', new AbortController().signal)).rejects.toThrow(
    '过大或无效',
  );
  image.thumbnail.getSize.mockReturnValue({ width: 2, height: 2 });
  image.thumbnail.toBitmap.mockReturnValue(Buffer.alloc(0));
  await expect(captureFile(window, 'win32', new AbortController().signal)).rejects.toThrow(
    '过大或无效',
  );
});
it('uses the Mac toolbar anchor when the transparent window overlaps another display', async () => {
  const wrong = source('1'),
    correct = source('2');
  native.getSources.mockResolvedValue([wrong, correct]);
  native.getDisplayNearestPoint.mockReturnValue({
    id: 2,
    size: { width: 1920, height: 1080 },
    scaleFactor: 2,
  });
  await captureFile(window, 'darwin', new AbortController().signal, undefined, {
    x: -140,
    y: -176,
  });
  expect(native.getDisplayNearestPoint).toHaveBeenCalledWith({ x: -140, y: -176 });
  expect(native.getDisplayMatching).not.toHaveBeenCalled();
  expect(correct.thumbnail.toBitmap).toHaveBeenCalledOnce();
  expect(wrong.thumbnail.toBitmap).not.toHaveBeenCalled();
});
it('allows an absent display ID only when the desktop has one display', async () => {
  native.getSources.mockResolvedValue([source('')]);
  await expect(captureFile(window, 'win32', new AbortController().signal)).rejects.toThrow(
    '所在屏幕',
  );
  native.getAllDisplays.mockReturnValue([{}]);
  expect(
    (await captureFile(window, 'win32', new AbortController().signal)).bytes.length,
  ).toBeGreaterThan(0);
});
it('fails explicitly on denied permission, native errors, and empty images', async () => {
  native.getMediaAccessStatus.mockReturnValue('denied');
  await expect(captureFile(window, 'darwin', new AbortController().signal)).rejects.toThrow('允许');
  expect(native.getSources).not.toHaveBeenCalled();
  native.getSources.mockRejectedValueOnce(Error('private native failure'));
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
it('never reads the screen after prior cancellation and never returns a cancelled encoding', async () => {
  const cancelled = new AbortController();
  cancelled.abort();
  await expect(captureFile(window, 'win32', cancelled.signal)).rejects.toMatchObject({
    name: 'AbortError',
  });
  expect(native.getSources).not.toHaveBeenCalled();
  const active = new AbortController();
  native.encode.mockImplementationOnce(async () => {
    active.abort();
    return { file: { name: 'screenshot.png', bytes: new Uint8Array([1]) }, preview: 'synthetic' };
  });
  await expect(captureFile(window, 'win32', active.signal)).rejects.toMatchObject({
    name: 'AbortError',
  });
});
it.each(['win32', 'darwin'] as const)(
  'prepares metadata only on %s and releases listeners',
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
    expect(image.thumbnail.toBitmap).not.toHaveBeenCalled();
    expect(native.encode).not.toHaveBeenCalled();
    expect(owner.listenerCount('closed')).toBe(0);
  },
);
it('does not prepare an unauthorized Mac or a closed window', async () => {
  native.getMediaAccessStatus.mockReturnValue('denied');
  await prepareInterviewScreenshot(window, 'darwin');
  await prepareInterviewScreenshot(
    { ...window, isDestroyed: () => true } as BrowserWindow,
    'win32',
  );
  expect(native.getSources).not.toHaveBeenCalled();
});
it('retires preparation on close or timeout and permits a later explicit capture', async () => {
  const owner = Object.assign(new EventEmitter(), window) as unknown as BrowserWindow;
  native.getSources.mockReturnValueOnce(new Promise(() => {}));
  const pending = prepareInterviewScreenshot(owner, 'win32');
  owner.emit('closed');
  await pending;
  expect(owner.listenerCount('closed')).toBe(0);
  vi.useFakeTimers();
  native.getSources.mockReturnValueOnce(new Promise(() => {}));
  const timed = prepareInterviewScreenshot(owner, 'win32');
  await vi.advanceTimersByTimeAsync(10001);
  await timed;
  expect(owner.listenerCount('closed')).toBe(0);
  expect(
    (await captureFile(window, 'win32', new AbortController().signal)).bytes.length,
  ).toBeGreaterThan(0);
});
it('takes a fresh frame per click and uses the private encoder for native capture ports', async () => {
  const first = source(),
    second = source();
  const capture = vi
    .fn()
    .mockResolvedValueOnce(first.thumbnail)
    .mockResolvedValueOnce(second.thumbnail);
  await captureInterviewScreenshot(window, 'win32', new AbortController().signal, capture);
  await captureInterviewScreenshot(window, 'win32', new AbortController().signal, capture);
  expect(native.getSources).not.toHaveBeenCalled();
  expect(capture).toHaveBeenCalledTimes(2);
  expect(native.encode).toHaveBeenCalledTimes(2);
  expect(first.thumbnail.toBitmap).toHaveBeenCalledOnce();
  expect(second.thumbnail.toBitmap).toHaveBeenCalledOnce();
  const controller = new AbortController();
  capture.mockImplementation(async () => {
    controller.abort();
    return first.thumbnail;
  });
  await expect(
    captureInterviewScreenshot(window, 'win32', controller.signal, capture),
  ).rejects.toMatchObject({ name: 'AbortError' });
  expect(first.thumbnail.toBitmap).toHaveBeenCalledOnce();
});
