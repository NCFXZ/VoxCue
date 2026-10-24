import { afterEach, expect, it, vi } from 'vitest';
import { useChatConnection } from '../../src/stores/chatConnection';
import { copilotAccountUsage } from '../../electron/backend/copilot/quota';
afterEach(async () => {
  await useChatConnection.getState().load(false);
  vi.unstubAllGlobals();
});
it('切换/断开账户后丢弃迟到额度，不能回填上个账户数据', async () => {
  let finish!: (value: any) => void;
  vi.stubGlobal('window', {
    desktop: {
      chatModels: async () => ({ ok: true, models: [] }),
      chatAccountUsage: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    },
  });
  const pending = useChatConnection.getState().load(true);
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
  await useChatConnection.getState().load(false);
  finish({ ok: true, usage: copilotAccountUsage({ planTier: 'free' }) });
  await pending;
  expect(useChatConnection.getState()).toMatchObject({
    live: false,
    usage: null,
    usageError: null,
    loadingUsage: false,
  });
});
it('刷新失败清除旧数字，官方错误不伪造为0；并发刷新只发一次请求', async () => {
  const quota = copilotAccountUsage({
    planTier: 'free',
    snapshots: { chat: { entitlementRequests: 50, usedRequests: 10 } },
  });
  const read = vi
    .fn()
    .mockResolvedValueOnce({ ok: true, usage: quota })
    .mockResolvedValueOnce({ ok: false, error: { message: '官方额度暂不可用' } });
  vi.stubGlobal('window', {
    desktop: { chatModels: async () => ({ ok: true, models: [] }), chatAccountUsage: read },
  });
  await useChatConnection.getState().load(true);
  expect(useChatConnection.getState().usage?.quotas[0].remaining).toBe(40);
  await Promise.all([
    useChatConnection.getState().refreshUsage(),
    useChatConnection.getState().refreshUsage(),
  ]);
  expect(read).toHaveBeenCalledTimes(2);
  expect(useChatConnection.getState()).toMatchObject({
    usage: null,
    usageError: '官方额度暂不可用',
    loadingUsage: false,
  });
});
it('登录后自动读取额度，模型目录失败也不要求第二次连接', async () => {
  const quota = copilotAccountUsage({ planTier: 'free' });
  const read = vi.fn(async () => ({ ok: true, usage: quota }));
  vi.stubGlobal('window', {
    desktop: {
      chatModels: async () => {
        throw Error('synthetic models unavailable');
      },
      chatAccountUsage: read,
    },
  });
  await useChatConnection.getState().load(true);
  expect(read).toHaveBeenCalledOnce();
  expect(useChatConnection.getState().usage).toEqual(quota);
  expect(useChatConnection.getState().loadingUsage).toBe(false);
});
it('刷新仅保留旧快照供骨架沿用结构，失败仍清空；账户切换清除结构', async () => {
  const quota = copilotAccountUsage({
    snapshots: { chat: { entitlementRequests: 50, usedRequests: 10 } },
  });
  let finish!: (value: any) => void;
  const read = vi
    .fn()
    .mockResolvedValueOnce({ ok: true, usage: quota })
    .mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
  vi.stubGlobal('window', {
    desktop: { chatModels: async () => ({ ok: true, models: [] }), chatAccountUsage: read },
  });
  await useChatConnection.getState().load(true);
  const refresh = useChatConnection.getState().refreshUsage();
  expect(useChatConnection.getState()).toMatchObject({ loadingUsage: true, usage: quota });
  await useChatConnection.getState().load(false);
  expect(useChatConnection.getState().usage).toBeNull();
  finish({ ok: true, usage: quota });
  await refresh;
  expect(useChatConnection.getState().usage).toBeNull();
});
