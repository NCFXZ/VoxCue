import { afterEach, expect, it, vi } from 'vitest';
import { useCloudUsage } from '../../src/stores/cloudUsage';
import { isLowInterviewCredit } from '../../electron/contracts/cloudUsage';
import { useCloudAccount } from '../../src/stores/cloudAccount';
import { userError } from '../../src/services/errors';
const first = '11111111-1111-4111-8111-111111111111';
const value = {
  permanent: false,
  remainingSeconds: 3600,
  zeroSince: null,
  cloudDeleteAfter: null,
  cloudPurgePending: false,
};
it('marks only finite balances strictly below fifteen minutes as low', () => {
  expect(isLowInterviewCredit(undefined)).toBe(false);
  expect(isLowInterviewCredit({ ...value, remainingSeconds: 0 })).toBe(true);
  expect(isLowInterviewCredit({ ...value, remainingSeconds: 899 })).toBe(true);
  expect(isLowInterviewCredit({ ...value, remainingSeconds: 900 })).toBe(false);
  expect(isLowInterviewCredit({ ...value, permanent: true, remainingSeconds: null })).toBe(false);
});
function bind(id: string) {
  useCloudAccount.setState({
    state: {
      configured: true,
      verified: true,
      user: { id, email: 'synthetic@example.test', createdAt: 1 },
    },
    loaded: true,
  });
  useCloudUsage.getState().bind(id);
}
afterEach(() => {
  useCloudUsage.getState().bind(undefined);
  vi.unstubAllGlobals();
});
it('coalesces concurrent quota readers and discards a late result from the previous account', async () => {
  let finish!: (value: unknown) => void;
  const send = vi.fn(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  vi.stubGlobal('window', { desktop: { cloudUsage: send } });
  bind(first);
  const pending = useCloudUsage.getState().run({ action: 'status' });
  expect(await useCloudUsage.getState().run({ action: 'status' })).toBe(false);
  expect(send).toHaveBeenCalledTimes(1);
  bind('22222222-2222-4222-8222-222222222222');
  finish({ ok: true, entitlements: value });
  expect(await pending).toBe(false);
  expect(useCloudUsage.getState().value).toBeUndefined();
  expect(useCloudUsage.getState().busy).toBe(false);
});
it('shares redeemed credit with the sidebar and retains the last good value after a failed refresh', async () => {
  const send = vi
    .fn()
    .mockResolvedValueOnce({ ok: true, entitlements: value })
    .mockResolvedValueOnce({ ok: false, error: '服务繁忙，请稍后重试。' });
  vi.stubGlobal('window', { desktop: { cloudUsage: send } });
  bind(first);
  expect(await useCloudUsage.getState().run({ action: 'redeem', code: 'synthetic-only' })).toBe(
    true,
  );
  expect(useCloudUsage.getState().value?.remainingSeconds).toBe(3600);
  expect(await useCloudUsage.getState().run({ action: 'status' })).toBe(false);
  expect(useCloudUsage.getState().value?.remainingSeconds).toBe(3600);
  expect(useCloudUsage.getState().error).toContain('繁忙');
});
it('removes only Electron transport wrappers from actionable interview errors', () => {
  expect(
    userError(
      new Error("Error invoking remote method 'interview:open': Error: 面试额度已用完。"),
      '失败',
    ),
  ).toBe('面试额度已用完。');
  expect(userError(new Error('设备 Error: busy'), '失败')).toBe('设备 Error: busy');
  expect(userError(null, '请重试。')).toBe('请重试。');
});
