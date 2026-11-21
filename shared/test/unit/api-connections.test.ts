import { expect, it, vi } from 'vitest';
import { ProfileApiConnections } from '../../electron/application/apiConnections';
import {
  parseApiConnectionConfig,
  type ApiProvider,
} from '../../electron/contracts/apiConnections';
import { emptyUsage } from '../../electron/contracts/chat';
import type { ApiCredential } from '../../electron/backend/api/types';
import { chineseProviders } from '../../electron/backend/api/chineseProviders';

it('validates before replacing credentials and keeps browser cancellation isolated', async () => {
  const original = { key: 'synthetic-original' };
  const keys = new Map<ApiProvider, ApiCredential>([['kimi', original]]);
  const store = {
    list: async () => [...keys.keys()].map((provider) => ({ provider })),
    read: async (id: ApiProvider) => keys.get(id) ?? null,
    save: vi.fn(async (id: ApiProvider, credential: ApiCredential) => {
      keys.set(id, credential);
    }),
    remove: async (id: ApiProvider) => {
      keys.delete(id);
    },
    dispose: vi.fn(async () => {}),
  };
  const discover = vi.fn(async () => [{ id: 'm', label: 'm', description: '' }]);
  const stream = vi.fn();
  const api = new ProfileApiConnections(store, {
    chat: () => ({
      models: discover,
      invalidateModels: vi.fn(),
      usage: async () => emptyUsage(),
      resetUsage: async () => emptyUsage(),
      stream,
    }),
    balance: vi.fn(),
  });
  const owner = new AbortController();
  const config = { provider: 'kimi' as const };
  expect(await api.configure(config, async () => null, vi.fn(), owner.signal)).toBe(false);
  for (const invalid of ['', 'invalid key']) {
    expect(await api.configure(config, async () => invalid, vi.fn(), owner.signal)).toEqual({
      inputError: 'API 密钥格式无效。',
    });
  }
  expect(discover).not.toHaveBeenCalled();
  discover.mockRejectedValueOnce(Error('denied'));
  await expect(
    api.configure(config, async () => 'synthetic-invalid', vi.fn(), owner.signal),
  ).resolves.toEqual({ inputError: '连接中断或请求失败，请检查网络后重试。' });
  discover.mockResolvedValueOnce([]);
  await expect(
    api.configure(config, async () => 'synthetic-empty-catalog', vi.fn(), owner.signal),
  ).resolves.toEqual({ inputError: '服务商的目录未返回 VoxCue 支持的对话模型。' });
  expect(stream).not.toHaveBeenCalled();
  expect(store.save).not.toHaveBeenCalled();
  expect(keys.get('kimi')).toBe(original);
  expect(await api.configure(config, async () => 'synthetic-new', vi.fn(), owner.signal)).toBe(
    true,
  );
  expect(await api.session('kimi')).toEqual({
    mode: 'kimi',
    user: { id: 'kimi', name: 'Kimi', email: '' },
    expiresAt: null,
  });
  const prompt = Promise.withResolvers<string>();
  const pending = api.configure(config, () => prompt.promise, vi.fn(), owner.signal);
  await expect(api.remove('kimi')).rejects.toThrow('操作正在进行');
  owner.abort();
  prompt.resolve('synthetic-cancelled');
  await expect(pending).rejects.toThrow();
  expect(store.save).toHaveBeenCalledTimes(1);
  expect(keys.get('kimi')?.key).toBe('synthetic-new');
  await api.remove('kimi');
  expect(await api.session('kimi')).toBeNull();
  const failure = Object.assign(Error('无法打开合成测试路径'), { path: '合成测试路径' });
  vi.spyOn(store, 'list').mockRejectedValueOnce(failure);
  await expect(api.list()).rejects.toThrow('无法访问本机 API 密钥记录。');
  await api.dispose();
});

it('accepts only public, provider-specific configuration', () => {
  expect(parseApiConnectionConfig({ provider: 'qwen' })).toEqual({
    provider: 'qwen',
    region: 'beijing',
  });
  const frankfurt = { provider: 'qwen', region: 'frankfurt', workspace: 'example' };
  expect(parseApiConnectionConfig(frankfurt)).toEqual(frankfurt);
  expect(parseApiConnectionConfig({ provider: 'qwen', region: 'hongkong' })).toEqual({
    provider: 'qwen', region: 'hongkong',
  });
  for (const invalid of [
    { provider: 'kimi', key: 'synthetic' },
    { provider: 'qwen', region: 'tokyo' },
    { provider: 'qwen', region: 'frankfurt' },
    { provider: 'qwen', workspace: 'example.invalid' },
    { provider: 'openai', workspace: 'unrelated' },
    { provider: 'glm', url: 'https://example.invalid' },
    { provider: '__proto__' },
  ])
    expect(() => parseApiConnectionConfig(invalid)).toThrow();
});

it('discovers the three additional providers and sends only supported reasoning controls', async () => {
  const kimi = chineseProviders.kimi,
    glm = chineseProviders.glm,
    ark = chineseProviders.doubao;
  const key = { key: 'synthetic' };
  const list = (data: unknown[]) => async () => ({ data });
  const [k3, code] = await kimi.models(key, list([{ id: 'kimi-k3' }, { id: 'kimi-k2.7-code' }]));
  expect(k3.reasoningEfforts).toEqual(['low', 'high', 'max']);
  expect(kimi.replayTextHistory!(code)).toBe(true);
  expect(code.reasoningEfforts).toBeUndefined();
  expect(kimi.reasoning!(k3, 'max')).toEqual({ reasoning_effort: 'max' });
  const [g] = await glm.models(key, list([{ id: 'glm-5.3' }, { id: 'glm-image' }]));
  expect(g.imageInput).toBe(false);
  expect(g.reasoningEfforts).toEqual(['low', 'high', 'max']);
  const [g52] = await glm.models(key, list([{ id: 'glm-5.2' }]));
  expect(g52.reasoningEfforts).toEqual(['none', 'high', 'max']);
  expect(glm.reasoning!(g52, 'high')).toEqual({ reasoning_effort: 'high' });
  const [d] = await ark.models(
    key,
    list([
      {
        id: 'doubao-seed-2-1-pro-260915',
        effort: { supported_levels: ['low', 'high', 'unknown'] },
        features: { thinking: { type: 'enabled' } },
        modalities: { input_modalities: ['text', 'image'], output_modalities: ['text'] },
      },
      { id: 'doubao-video' },
    ]),
  );
  expect(d.imageInput).toBe(true);
  expect(d.reasoningEfforts).toEqual(['none', 'low', 'high']);
  expect(ark.reasoning!(d, 'none')).toEqual({ thinking: { type: 'disabled' } });
  const balances = await kimi.balance!(key, async (url) => {
    expect(url).toBe('https://api.moonshot.cn/v1/users/me/balance');
    return { code: 0, data: { available_balance: 4.01, voucher_balance: 4.01, cash_balance: -2 } };
  });
  expect(balances).toEqual([{ currency: 'CNY', total: '4.01', granted: '4.01', toppedUp: '-2' }]);
});
