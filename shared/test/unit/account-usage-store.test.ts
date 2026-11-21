import { afterEach, expect, it, vi } from 'vitest';
import { useChatConnection } from '../../src/stores/chatConnection';
import { copilotAccountUsage } from '../../electron/backend/copilot/quota';
import { CHAT_MODEL_CATALOG_TTL_MS, type ChatModel } from '../../electron/contracts/chat';
const catalog = (id: string) => ({ ok: true, models: [{ id, label: id, description: '' }] });
afterEach(async () => {
  await useChatConnection.getState().load(false);
  vi.unstubAllGlobals();
});
it('主账号登录但未连接AI时不提供预设模拟模型，显式测试演示才可用', async () => {
  await useChatConnection.getState().load(false);
  expect(useChatConnection.getState().models).toEqual([]);
  await useChatConnection.getState().load(false, false, 'demo');
  expect(useChatConnection.getState().models.length).toBeGreaterThan(0);
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
    usageLoaded: false,
  });
});
it('reads an API model catalog without fetching a subscription quota', async () => {
  const quota = vi.fn();
  const models = vi.fn()
    .mockResolvedValueOnce(catalog('model-from-api'))
    .mockResolvedValueOnce({ ok: true, models: [] });
  vi.stubGlobal('window', { desktop: {
    chatModels: models,
    chatAccountUsage: quota,
  } });
  await useChatConnection.getState().load(true, false, 'openai');
  expect(useChatConnection.getState()).toMatchObject({
    service: 'openai', live: true, usage: null, usageLoaded: true,
    models: [{ id: 'model-from-api' }],
  });
  await useChatConnection.getState().load(true, true, 'openai');
  expect(useChatConnection.getState()).toMatchObject({
    live: true, models: [], error: '服务商的目录未返回 VoxCue 支持的对话模型。请尝试刷新模型列表。',
  });
  expect(quota).not.toHaveBeenCalled();
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
it('用量和目录共用当前连接，目录到期后自动发现新模型', async () => {
  vi.useFakeTimers();
  const events = new EventTarget();
  const quota = copilotAccountUsage({ planTier: 'free' });
  const models = vi
    .fn()
    .mockResolvedValueOnce(catalog('original'))
    .mockResolvedValue(catalog('new'));
  vi.stubGlobal('window', {
    desktop: { chatModels: models, chatAccountUsage: async () => ({ ok: true, usage: quota }) },
    setInterval,
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
  });
  await useChatConnection.getState().load(true);
  const stop = useChatConnection.getState().watchUsage();
  try {
    events.dispatchEvent(new Event('focus'));
    await vi.advanceTimersByTimeAsync(CHAT_MODEL_CATALOG_TTL_MS - 1);
    expect(models.mock.calls).toEqual([[false]]);
    await vi.advanceTimersByTimeAsync(1);
    expect(models.mock.calls).toEqual([[false], [true]]);
    expect(useChatConnection.getState()).toMatchObject({
      models: catalog('new').models,
      loading: false,
      usage: quota,
      usageLoaded: true,
    });
    stop();
    await vi.advanceTimersByTimeAsync(2 * CHAT_MODEL_CATALOG_TTL_MS);
    expect(models).toHaveBeenCalledTimes(2);
  } finally {
    stop();
    vi.useRealTimers();
  }
});

it.each(['unmount', 'switch account', 'manual refresh'])(
  '%s makes an older background catalog result ineligible',
  async (action) => {
    vi.useFakeTimers();
    const events = new EventTarget();
    let finish!: (value: { ok: boolean; models: ChatModel[] }) => void;
    const models = vi
      .fn()
      .mockResolvedValueOnce(catalog('original'))
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      )
      .mockResolvedValue(catalog('current'));
    vi.stubGlobal('window', {
      desktop: { chatModels: models, chatAccountUsage: async () => ({ ok: true, usage: null }) },
      setInterval,
      addEventListener: events.addEventListener.bind(events),
      removeEventListener: events.removeEventListener.bind(events),
    });
    await useChatConnection.getState().load(true, false, 'chatgpt');
    const stop = useChatConnection.getState().watchUsage();
    try {
      vi.setSystemTime(Date.now() + CHAT_MODEL_CATALOG_TTL_MS);
      events.dispatchEvent(new Event('focus'));
      events.dispatchEvent(new Event('focus'));
      expect(models.mock.calls).toEqual([[false], [true]]);
      expect(useChatConnection.getState()).toMatchObject({
        models: catalog('original').models,
        loading: false,
      });
      if (action === 'unmount') stop();
      else if (action === 'switch account') await useChatConnection.getState().load(true, false, 'copilot');
      else await useChatConnection.getState().load(true, true);
      finish(catalog('late'));
      await vi.advanceTimersByTimeAsync(0);
      expect(useChatConnection.getState().models).toEqual(
        catalog(action === 'unmount' ? 'original' : 'current').models,
      );
      expect(useChatConnection.getState().service).toBe(action === 'switch account' ? 'copilot' : 'chatgpt');
    } finally {
      stop();
      vi.useRealTimers();
    }
  },
);
it('退出用量监听后，迟到的模型目录不能重新发起额度读取；新连接仍正常读取', async () => {
  const events = new EventTarget();
  let finishModels!: (value: any) => void;
  const quota = copilotAccountUsage({ planTier: 'free' });
  const read = vi.fn(async () => ({ ok: true, usage: quota }));
  const models = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishModels = resolve;
        }),
    )
    .mockResolvedValue({ ok: true, models: [] });
  vi.stubGlobal('window', {
    desktop: { chatModels: models, chatAccountUsage: read },
    setInterval,
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
  });
  const loading = useChatConnection.getState().load(true);
  const stop = useChatConnection.getState().watchUsage();
  try {
    await vi.waitFor(() => expect(useChatConnection.getState().usageLoaded).toBe(true));
    expect(read).toHaveBeenCalledOnce();
    stop();
    finishModels({ ok: true, models: [] });
    await loading;
    expect(read).toHaveBeenCalledOnce();
    expect(useChatConnection.getState()).toMatchObject({
      usage: null,
      usageLoaded: false,
      loadingUsage: false,
      loading: false,
    });
    events.dispatchEvent(new Event('focus'));
    expect(read).toHaveBeenCalledOnce();
    await useChatConnection.getState().load(true);
    expect(read).toHaveBeenCalledTimes(2);
    expect(useChatConnection.getState()).toMatchObject({
      usage: quota,
      usageLoaded: true,
      loadingUsage: false,
    });
  } finally {
    stop();
  }
});
it('后台刷新保留旧快照，账户切换清除快照和首次读取状态', async () => {
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
  expect(useChatConnection.getState()).toMatchObject({
    loadingUsage: true,
    usage: quota,
    usageLoaded: true,
  });
  await useChatConnection.getState().load(false);
  expect(useChatConnection.getState().usage).toBeNull();
  finish({ ok: true, usage: quota });
  await refresh;
  expect(useChatConnection.getState().usage).toBeNull();
  expect(useChatConnection.getState().usageLoaded).toBe(false);
});

it('首次读取消除提示状态，后台保留旧值直到新值成功替换，失败与重试正常展示', async () => {
  const previous = copilotAccountUsage({
    snapshots: { chat: { entitlementRequests: 100, usedRequests: 10 } },
  });
  const updated = copilotAccountUsage({
    snapshots: { chat: { entitlementRequests: 100, usedRequests: 35 } },
  });
  let finish!: (value: any) => void;
  const read = vi.fn(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  vi.stubGlobal('window', {
    desktop: { chatModels: async () => ({ ok: true, models: [] }), chatAccountUsage: read },
  });
  const first = useChatConnection.getState().load(true);
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
  expect(useChatConnection.getState()).toMatchObject({
    loadingUsage: true,
    usageLoaded: false,
    usage: null,
  });
  finish({ ok: true, usage: previous });
  await first;
  const refresh = useChatConnection.getState().refreshUsage();
  expect(useChatConnection.getState()).toMatchObject({
    loadingUsage: true,
    usageLoaded: true,
    usage: previous,
  });
  finish({ ok: true, usage: updated });
  await refresh;
  expect(useChatConnection.getState()).toMatchObject({
    loadingUsage: false,
    usageLoaded: true,
    usage: updated,
  });
  const failing = useChatConnection.getState().refreshUsage();
  expect(useChatConnection.getState().usage).toEqual(updated);
  finish({ ok: false, error: { message: '合成额度读取失败' } });
  await failing;
  expect(useChatConnection.getState()).toMatchObject({
    loadingUsage: false,
    usageLoaded: true,
    usage: null,
    usageError: '合成额度读取失败',
  });
  const retry = useChatConnection.getState().refreshUsage();
  expect(useChatConnection.getState()).toMatchObject({
    loadingUsage: true,
    usageLoaded: true,
    usageError: '合成额度读取失败',
  });
  finish({ ok: true, usage: null });
  await retry;
  expect(useChatConnection.getState()).toMatchObject({
    loadingUsage: false,
    usageLoaded: true,
    usage: null,
    usageError: null,
  });
  const later = useChatConnection.getState().refreshUsage();
  expect(useChatConnection.getState()).toMatchObject({
    loadingUsage: true,
    usageLoaded: true,
    usage: null,
  });
  finish({ ok: true, usage: updated });
  await later;
});

it('首次读取失败也完成初始提示，后续重试保留错误而不重置首次状态', async () => {
  let finish!: (value: any) => void;
  const read = vi
    .fn()
    .mockResolvedValueOnce({ ok: false, error: { message: '首次合成失败' } })
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
  vi.stubGlobal('window', {
    desktop: { chatModels: async () => ({ ok: true, models: [] }), chatAccountUsage: read },
  });
  await useChatConnection.getState().load(true);
  expect(useChatConnection.getState()).toMatchObject({
    usageLoaded: true,
    usageError: '首次合成失败',
    usage: null,
  });
  const retry = useChatConnection.getState().refreshUsage();
  expect(useChatConnection.getState()).toMatchObject({
    loadingUsage: true,
    usageLoaded: true,
    usageError: '首次合成失败',
  });
  finish({ ok: true, usage: null });
  await retry;
  expect(useChatConnection.getState()).toMatchObject({
    loadingUsage: false,
    usageLoaded: true,
    usageError: null,
  });
});

it('面试额度用受控面试接口读取，聚焦/定时刷新，退出清除定时器及迟到快照', async () => {
  vi.useFakeTimers();
  const events = new EventTarget();
  const quota = copilotAccountUsage({
    snapshots: { chat: { entitlementRequests: 50, usedRequests: 45 } },
  });
  const mainRead = vi.fn();
  const interviewRead = vi.fn().mockResolvedValue({ ok: true, usage: quota });
  vi.stubGlobal('window', {
    desktop: { chatAccountUsage: mainRead, interviewAccountUsage: interviewRead },
    setInterval,
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
  });
  const stop = useChatConnection.getState().watchUsage('interview');
  try {
    await vi.advanceTimersByTimeAsync(0);
    expect(useChatConnection.getState().usage).toEqual(quota);
    events.dispatchEvent(new Event('focus'));
    await vi.advanceTimersByTimeAsync(0);
    expect(interviewRead).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(interviewRead).toHaveBeenCalledTimes(3);
    expect(mainRead).not.toHaveBeenCalled();
    let finish!: (value: any) => void;
    interviewRead.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
    const pending = useChatConnection.getState().refreshUsage('interview');
    stop();
    finish({ ok: true, usage: quota });
    await pending;
    events.dispatchEvent(new Event('focus'));
    await vi.advanceTimersByTimeAsync(120_000);
    expect(interviewRead).toHaveBeenCalledTimes(4);
    expect(useChatConnection.getState()).toMatchObject({
      usage: null,
      loadingUsage: false,
      usageLoaded: false,
    });
  } finally {
    stop();
    vi.useRealTimers();
  }
});
