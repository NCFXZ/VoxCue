import { beforeEach, expect, it, vi } from 'vitest';
import type { BrowserWindow } from 'electron';

const ports = vi.hoisted(() => ({ execute: vi.fn(), bitmap: vi.fn() }));
vi.mock('node:child_process', async () => {
  const { promisify } = await import('node:util');
  const execFile = (...args: unknown[]) => ports.execute(...args);
  Object.assign(execFile, {
    [promisify.custom]: (...args: unknown[]) =>
      new Promise((resolve, reject) =>
        execFile(...args, (error: Error | null, stdout: Buffer, stderr: Buffer) =>
          error ? reject(error) : resolve({ stdout, stderr }),
        ),
      ),
  });
  return { execFile };
});
vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => 'C:/VoxCue/windows' },
  nativeImage: { createFromBitmap: ports.bitmap },
}));
import { captureScreen } from '../../electron/screenshot';

const window = {
  isDestroyed: () => false,
  getNativeWindowHandle: () => Buffer.from([42, 0, 0, 0, 0, 0, 0, 0]),
} as unknown as BrowserWindow;
const frame = (width = 2, height = 2) => {
  const data = Buffer.alloc(8 + width * height * 4, 255);
  data.writeUInt32LE(width, 0);
  data.writeUInt32LE(height, 4);
  return data;
};
beforeEach(() => {
  vi.clearAllMocks();
  ports.bitmap.mockReturnValue({ isEmpty: () => false });
  ports.execute.mockImplementation((_file, _args, _options, done) =>
    done(null, frame(), Buffer.alloc(0)),
  );
});
it('只传自有窗口句柄，不使用显示器顺序或磁盘截图；限制原生输出与执行期限', async () => {
  const signal = new AbortController().signal;
  await captureScreen(window, signal);
  expect(ports.execute).toHaveBeenCalledWith(
    expect.stringMatching(/native[\\/]bin[\\/]VoxCue\.Screenshot\.exe$/),
    ['42'],
    expect.objectContaining({
      windowsHide: true,
      encoding: 'buffer',
      timeout: 10000,
      maxBuffer: 3840 * 3840 * 4 + 8,
      signal,
    }),
    expect.any(Function),
  );
  expect(ports.bitmap).toHaveBeenCalledWith(frame().subarray(8), { width: 2, height: 2 });
});
it.each([Buffer.alloc(0), frame().subarray(0, 12), frame(3841, 1)])(
  '拒绝截断或越界原生帧',
  async (data) => {
    ports.execute.mockImplementation((_file, _args, _options, done) =>
      done(null, data, Buffer.alloc(0)),
    );
    await expect(captureScreen(window, new AbortController().signal)).rejects.toThrow('无法截取');
    expect(ports.bitmap).not.toHaveBeenCalled();
  },
);
it('原生失败明确报错，取消和窗口销毁不会解码迟到图像', async () => {
  ports.execute.mockImplementationOnce((_file, _args, _options, done) =>
    done(Error('Native error')),
  );
  await expect(captureScreen(window, new AbortController().signal)).rejects.toThrow('无法截取');
  let finish!: (error: null, data: Buffer) => void;
  ports.execute.mockImplementationOnce((_file, _args, _options, done) => {
    finish = done;
  });
  const controller = new AbortController();
  const pending = captureScreen(window, controller.signal);
  controller.abort();
  finish(null, frame());
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  const closed = {
    ...window,
    isDestroyed: vi.fn().mockReturnValueOnce(false).mockReturnValue(true),
  } as unknown as BrowserWindow;
  await expect(captureScreen(closed, new AbortController().signal)).rejects.toMatchObject({
    name: 'AbortError',
  });
  expect(ports.bitmap).not.toHaveBeenCalled();
});
