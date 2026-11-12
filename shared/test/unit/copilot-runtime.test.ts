import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const sdk = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock('@github/copilot-sdk', () => ({
  CopilotClient: class {
    constructor(options: unknown) {
      return sdk.create(options);
    }
  },
  RuntimeConnection: { forStdio: (options: unknown) => options },
}));
import { CopilotRuntime } from '../../electron/backend/copilot/runtime';

const roots: string[] = [];
const runtimes: CopilotRuntime[] = [];
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function client() {
  return {
    start: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
    forceStop: vi.fn(async () => {}),
    createSession: vi.fn(async () => ({ sessionId: 'owned-control' })),
    deleteSession: vi.fn(async () => {}),
  };
}
async function runtime(...clients: ReturnType<typeof client>[]) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'voxcue-copilot-runtime-'));
  roots.push(root);
  sdk.create.mockImplementation(() => clients.shift());
  const value = new CopilotRuntime(root);
  runtimes.push(value);
  return value;
}
afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(runtimes.splice(0).map((value) => value.stop()));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  sdk.create.mockReset();
});

it('握手卡住时仍可退休 SDK，迟到旧启动不替换新的运行时', async () => {
  const first = client(),
    second = client();
  const handshake = deferred<void>();
  first.start.mockImplementation(() => handshake.promise);
  first.stop.mockImplementation(() => new Promise(() => {}));
  const value = await runtime(first, second);
  const opening = value.client().catch((error) => error);
  await vi.waitFor(() => expect(first.start).toHaveBeenCalledOnce());
  vi.useFakeTimers();
  const closing = value.stop();
  expect(value.stop()).toBe(closing);
  await expect(value.client()).rejects.toThrow('stopping');
  await vi.advanceTimersByTimeAsync(5000);
  await closing;
  expect(first.forceStop).toHaveBeenCalledOnce();
  expect(await value.client()).toBe(second);
  handshake.resolve();
  expect(await opening).toBeInstanceOf(Error);
  expect(await value.client()).toBe(second);
  expect(sdk.create).toHaveBeenCalledTimes(2);
});

it.each(['success', 'failure'])(
  '控制会话创建无响应时关停有界，迟到 %s 不恢复或清除新会话',
  async (result) => {
    const first = client(),
      second = client();
    const creation = deferred<{ sessionId: string }>();
    first.createSession.mockImplementation(() => creation.promise);
    const value = await runtime(first, second);
    const opening = value.control().catch((error) => error);
    await vi.waitFor(() => expect(first.createSession).toHaveBeenCalledOnce());
    vi.useFakeTimers();
    const closing = value.stop();
    await vi.advanceTimersByTimeAsync(5000);
    await closing;
    expect(first.forceStop).toHaveBeenCalledOnce();
    const current = await value.control();
    if (result === 'success') creation.resolve({ sessionId: 'retired-control' });
    else creation.reject(Error('synthetic old session failure'));
    expect(await opening).toBeInstanceOf(Error);
    expect(await value.control()).toBe(current);
    expect(second.createSession).toHaveBeenCalledOnce();
  },
);

it('控制会话尚未创建就关停时，不在已退休的 SDK 上发起创建', async () => {
  const native = client();
  const value = await runtime(native);
  await value.client();
  const opening = value.control().catch((error) => error);
  await value.stop();
  expect(await opening).toBeInstanceOf(Error);
  expect(native.createSession).not.toHaveBeenCalled();
  expect(native.stop).toHaveBeenCalledOnce();
});

it('正常关停先删除自有控制会话再停止 SDK，不强制结束', async () => {
  const native = client();
  const value = await runtime(native);
  await value.control();
  await value.stop();
  expect(native.deleteSession).toHaveBeenCalledExactlyOnceWith('owned-control');
  expect(native.stop).toHaveBeenCalledOnce();
  expect(native.forceStop).not.toHaveBeenCalled();
  expect(native.deleteSession.mock.invocationCallOrder[0]).toBeLessThan(
    native.stop.mock.invocationCallOrder[0],
  );
});
