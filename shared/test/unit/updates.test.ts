import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { UpdateService, type UpdateDriver } from '../../../shared/electron/backend/updates/service';

class Driver extends EventEmitter implements UpdateDriver {
  autoDownload = true;
  autoInstallOnAppQuit = true;
  allowDowngrade = true;
  allowPrerelease = true;
  cancel = vi.fn();
  dispose = vi.fn();
  checkForUpdates = vi.fn(async () => {
    this.emit('update-available', { version: '0.2.0', releaseNotes: '<script>private</script>' });
    return { cancellationToken: { cancel: this.cancel } };
  });
  downloadUpdate = vi.fn(async (_signal?: AbortSignal) => {
    this.emit('update-downloaded');
  });
  quitAndInstall = vi.fn();
}
function setup(autoDownload = true) {
  const driver = new Driver();
  const emit = vi.fn();
  const prepareInstall = vi.fn(async () => true);
  const context = { interview: false };
  const saveAutoDownload = vi.fn();
  const service = new UpdateService({
    currentVersion: '0.1.0',
    autoDownload,
    saveAutoDownload,
    driver,
    emit,
    prepareInstall,
    isInterviewActive: () => context.interview,
  });
  return { driver, emit, prepareInstall, context, service, saveAutoDownload };
}

describe('应用更新生命周期', () => {
  it('关闭自动下载只提示更新；重新开启后下载但不会自动安装', async () => {
    const s = setup(false);
    await s.service.start();
    expect(s.service.state()).toMatchObject({ phase: 'available', autoDownload: false });
    expect(s.driver.downloadUpdate).not.toHaveBeenCalled();
    s.service.setAutoDownload(true);
    expect(s.saveAutoDownload).toHaveBeenCalledExactlyOnceWith(true);
    expect(s.driver.downloadUpdate).toHaveBeenCalledTimes(1);
    expect(s.service.state()).toMatchObject({ phase: 'downloaded', autoDownload: true });
    expect(s.driver.quitAndInstall).not.toHaveBeenCalled();
  });
  it('检查过程中关闭开关会阻止随后自动下载，手动下载仍可使用', async () => {
    const s = setup();
    let finish!: () => void;
    s.driver.checkForUpdates.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = () => {
            s.driver.emit('update-available', { version: '0.2.0' });
            resolve(null as any);
          };
        }),
    );
    const checking = s.service.check();
    s.service.setAutoDownload(false);
    finish();
    await checking;
    expect(s.service.state()).toMatchObject({ phase: 'available', autoDownload: false });
    expect(s.driver.downloadUpdate).not.toHaveBeenCalled();
    await s.service.download();
    expect(s.service.state().phase).toBe('downloaded');
  });
  it('偏好保存失败保留原开关与下载行为，不误显示已保存', async () => {
    const s = setup(false);
    await s.service.start();
    s.saveAutoDownload.mockImplementation(() => {
      throw Error('/private/config');
    });
    expect(s.service.setAutoDownload(true)).toMatchObject({
      autoDownload: false,
      phase: 'available',
      error: '自动下载设置未能保存，请重试。',
    });
    expect(s.driver.downloadUpdate).not.toHaveBeenCalled();
  });
  it('启动仅检查与下载；普通退出、面试和下载事件都不会自动安装', async () => {
    const s = setup();
    expect(s.driver.autoDownload).toBe(false);
    expect(s.driver.autoInstallOnAppQuit).toBe(false);
    expect(s.driver.allowDowngrade).toBe(false);
    expect(s.driver.allowPrerelease).toBe(false);
    s.context.interview = true;
    await s.service.start();
    await s.service.start();
    expect(s.driver.checkForUpdates).toHaveBeenCalledTimes(1);
    expect(s.service.state()).toMatchObject({
      phase: 'downloaded',
      availableVersion: '0.2.0',
      interviewActive: true,
    });
    expect(JSON.stringify(s.service.state())).not.toContain('script');
    await s.service.install();
    expect(s.prepareInstall).not.toHaveBeenCalled();
    expect(s.driver.quitAndInstall).not.toHaveBeenCalled();
    s.service.dispose();
    expect(s.driver.quitAndInstall).not.toHaveBeenCalled();
  });
  it('保存成功才允许安装，等待期间并发安装仅执行一次', async () => {
    const s = setup();
    await s.service.start();
    let done!: (value: boolean) => void;
    s.prepareInstall.mockImplementation(
      () =>
        new Promise((resolve) => {
          done = resolve;
        }),
    );
    const pending = s.service.install();
    await s.service.install();
    expect(s.driver.quitAndInstall).not.toHaveBeenCalled();
    done(true);
    await pending;
    expect(s.driver.quitAndInstall).toHaveBeenCalledExactlyOnceWith(false, true);
  });
  it('取消、保存失败或保存期间开始面试均保留下载结果，不安装', async () => {
    for (const kind of ['cancel', 'failure', 'interview']) {
      const s = setup();
      await s.service.start();
      s.prepareInstall.mockImplementation(async () => {
        if (kind === 'failure') throw Error('C:/private/session');
        if (kind === 'interview') s.context.interview = true;
        return kind !== 'cancel';
      });
      await s.service.install();
      expect(s.service.state().phase).toBe('downloaded');
      expect(s.driver.quitAndInstall).not.toHaveBeenCalled();
      expect(JSON.stringify(s.service.state())).not.toContain('C:/private');
    }
  });
  it('下载/校验失败明确报错并可重试，不把失败视为已是最新', async () => {
    const s = setup();
    s.driver.downloadUpdate.mockImplementationOnce(async () => {
      throw Error('sha512 mismatch');
    });
    await s.service.start();
    expect(s.service.state()).toMatchObject({ phase: 'error', availableVersion: '0.2.0' });
    await s.service.install();
    expect(s.driver.quitAndInstall).not.toHaveBeenCalled();
    await s.service.download();
    expect(s.service.state().phase).toBe('downloaded');
  });
  it('取消下载等待清理，忽略取消后的事件，允许重新下载而不触发安装', async () => {
    const s = setup(false);
    await s.service.check();
    let finish!: () => void;
    let signal!: AbortSignal;
    s.driver.downloadUpdate.mockImplementationOnce((value) => {
      signal = value!;
      return new Promise((resolve) => {
        finish = resolve;
      });
    });
    const pending = s.service.download();
    const cancelled = s.service.cancel();
    expect(signal.aborted).toBe(true);
    s.driver.emit('download-progress', { percent: 99 });
    s.driver.emit('update-downloaded');
    s.driver.emit('error', Error('cancelled'));
    expect(s.service.state()).toMatchObject({ phase: 'downloading', progress: 0, error: null });
    await s.service.check();
    expect(s.service.download()).toBe(pending);
    expect(s.driver.downloadUpdate).toHaveBeenCalledTimes(1);
    finish();
    await cancelled;
    expect(s.service.state()).toMatchObject({ phase: 'available', progress: null, error: null });
    await s.service.download();
    expect(s.service.state().phase).toBe('downloaded');
    await s.service.cancel();
    expect(s.service.state().phase).toBe('downloaded');
    expect(s.driver.quitAndInstall).not.toHaveBeenCalled();
  });
  it('并发检查串行且终止后不接收迟到结果', async () => {
    const s = setup();
    let done!: () => void;
    s.driver.checkForUpdates.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          done = () => {
            s.driver.emit('update-available', { version: '0.2.0' });
            resolve({ cancellationToken: { cancel: s.driver.cancel } });
          };
        }),
    );
    const pending = s.service.check();
    await s.service.check();
    expect(s.driver.checkForUpdates).toHaveBeenCalledTimes(1);
    s.service.dispose();
    const events = s.emit.mock.calls.length;
    done();
    await pending;
    expect(s.emit).toHaveBeenCalledTimes(events);
    expect(s.driver.cancel).toHaveBeenCalledTimes(1);
    expect(s.driver.listenerCount('update-available')).toBe(0);
    expect(s.driver.dispose).toHaveBeenCalledOnce();
  });
  it('便携/开发环境明确不可用，不尝试网络或安装', async () => {
    const emit = vi.fn();
    const service = new UpdateService({
      currentVersion: '0.1.0',
      emit,
      prepareInstall: vi.fn(),
      isInterviewActive: () => false,
    });
    await service.start();
    await service.check();
    await service.download();
    await service.install();
    expect(service.state().phase).toBe('unavailable');
    expect(emit).not.toHaveBeenCalled();
  });
});
