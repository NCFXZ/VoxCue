import { expect, it, vi } from 'vitest';
import { ScreenPermission } from '../../electron/screenPermission';
function setup() {
  let granted = false;
  const native = {
    preflight: vi.fn(() => granted),
    request: vi.fn(async () => {
      granted = true;
      return true;
    }),
  };
  const openSettings = vi.fn(async () => {});
  const mediaStatus = vi.fn(() => 'denied');
  const access = new ScreenPermission({ binding: () => native, mediaStatus, openSettings });
  return {
    native,
    openSettings,
    mediaStatus,
    access,
    revoke: () => {
      granted = false;
    },
  };
}
it('单独查询屏幕权限不会申请权限或打开设置，授权撤销后返回未允许', async () => {
  const s = setup();
  expect((await s.access.call('check')).status).toBe('denied');
  expect(s.native.request).not.toHaveBeenCalled();
  expect(s.openSettings).not.toHaveBeenCalled();
  await s.access.call('request');
  s.revoke();
  expect((await s.access.call('check')).status).toBe('denied');
});
it('用户申请成功后重新读实际权限，不信任请求函数的成功标记', async () => {
  const s = setup();
  expect((await s.access.call('request')).status).toBe('granted');
  expect(s.native.request).toHaveBeenCalledOnce();
  expect(s.openSettings).not.toHaveBeenCalled();
  s.revoke();
  s.native.request.mockResolvedValue(true);
  expect((await s.access.call('request')).status).toBe('denied');
  expect(s.openSettings).toHaveBeenCalledOnce();
});
it('重复申请合并为一次原生操作，权限未生效只打开固定设置入口', async () => {
  const s = setup();
  let finish!: (value: boolean) => void;
  s.native.request.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const first = s.access.call('request'),
    second = s.access.call('request');
  finish(false);
  expect((await first).status).toBe('denied');
  expect((await second).status).toBe('denied');
  expect(s.native.request).toHaveBeenCalledOnce();
  expect(s.openSettings).toHaveBeenCalledOnce();
});
it('打开系统设置不会申请或伪造授权，受限/未知状态不会显示已允许', async () => {
  const s = setup();
  expect((await s.access.call('open-settings')).status).toBe('denied');
  expect(s.native.request).not.toHaveBeenCalled();
  for (const status of ['restricted', 'unknown', 'granted', 'not-determined']) {
    s.mediaStatus.mockReturnValue(status);
    expect((await s.access.call('check')).status).not.toBe('granted');
  }
});
it('缺失组件、非法结果和原生失败明确报错，不暴露本机路径', async () => {
  const s = setup();
  s.native.preflight.mockImplementation(() => {
    throw Error('/private/native/path');
  });
  expect((await s.access.call('check')).status).toBe('error');
  s.native.request.mockRejectedValue(Error('/private/native/path'));
  await expect(s.access.call('request')).rejects.toThrow('无法申请');
  await expect(s.access.call('invalid' as never)).rejects.toThrow('Invalid');
});
