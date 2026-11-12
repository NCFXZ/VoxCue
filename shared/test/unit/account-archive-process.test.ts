import { afterEach, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';

const native = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn: native.spawn }));
import { zipDirectory } from '../../electron/backend/accountArchive';

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

it.each(['cancel', 'timeout'] as const)(
  'terminates ZIP work on %s and waits for actual child closure before cleanup',
  async (ending) => {
    vi.useFakeTimers();
    const child = new EventEmitter();
    let signal!: AbortSignal;
    native.spawn.mockImplementation((_command, _args, options) => {
      signal = options.signal;
      expect(options.windowsHide).toBe(true);
      expect(options.killSignal).toBe('SIGKILL');
      signal.addEventListener('abort', () => child.emit('error', Error('synthetic abort')));
      return child;
    });
    const controller = new AbortController();
    let settled = false;
    const outcome = zipDirectory('synthetic-source', 'synthetic-output', controller.signal)
      .catch((error: Error) => error)
      .finally(() => {
        settled = true;
      });
    if (ending === 'cancel') controller.abort();
    else await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(signal.aborted).toBe(true);
    await Promise.resolve();
    expect(settled).toBe(false);
    child.emit('close', null);
    expect(((await outcome) as Error).message).toBe(
      ending === 'cancel' ? '导出已取消。' : '生成压缩包超时，请重试。',
    );
    expect(vi.getTimerCount()).toBe(0);
  },
);
