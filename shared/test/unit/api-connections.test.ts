import { expect, it, vi } from 'vitest';
import { ProfileApiConnections } from '../../electron/application/apiConnections';
import {
  parseApiConnectionConfig,
  type ApiProvider,
} from '../../electron/contracts/apiConnections';
import { emptyUsage } from '../../electron/contracts/chat';
import type { ApiCredential } from '../../electron/backend/api/types';

it('validates before replacing credentials and keeps browser cancellation isolated', async () => {
  const original = { key: 'synthetic-original' };
  const keys = new Map<ApiProvider, ApiCredential>([['deepseek', original]]);
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
  const config = { provider: 'deepseek' as const };
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
  expect(keys.get('deepseek')).toBe(original);
  expect(await api.configure(config, async () => 'synthetic-new', vi.fn(), owner.signal)).toBe(
    true,
  );
  expect(await api.session('deepseek')).toEqual({
    mode: 'deepseek',
    user: { id: 'deepseek', name: 'DeepSeek', email: '' },
    expiresAt: null,
  });
  const prompt = Promise.withResolvers<string>();
  const pending = api.configure(config, () => prompt.promise, vi.fn(), owner.signal);
  await expect(api.remove('deepseek')).rejects.toThrow('操作正在进行');
  owner.abort();
  prompt.resolve('synthetic-cancelled');
  await expect(pending).rejects.toThrow();
  expect(store.save).toHaveBeenCalledTimes(1);
  expect(keys.get('deepseek')?.key).toBe('synthetic-new');
  await api.remove('deepseek');
  expect(await api.session('deepseek')).toBeNull();
  const failure = Object.assign(Error('无法打开合成测试路径'), { path: '合成测试路径' });
  vi.spyOn(store, 'list').mockRejectedValueOnce(failure);
  await expect(api.list()).rejects.toThrow('无法访问本机 API 密钥记录。');
  await api.dispose();
});

it('accepts only the provider identifier for the supported API connections', () => {
  for (const provider of ['openai', 'deepseek', 'kimi', 'gemini']) {
    expect(parseApiConnectionConfig({ provider })).toStrictEqual({ provider });
  }
  for (const invalid of [
    { provider: 'deepseek', key: 'synthetic' },
    { provider: 'qwen' },
    { provider: 'deepseek', baseUrl: 'https://example.invalid' },
    { provider: 'openai', workspace: 'unrelated' },
    { provider: 'copilot' },
    { provider: '__proto__' },
  ]) expect(() => parseApiConnectionConfig(invalid)).toThrow();
});
