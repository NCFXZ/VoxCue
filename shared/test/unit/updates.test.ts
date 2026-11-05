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
  checkForUpdates = vi.fn(async (_force?: boolean) => {
    this.emit('update-available', { version: '0.2.0', releaseNotes: '<script>private</script>' });
    return { cancellationToken: { cancel: this.cancel } };
  });
  restoreDownloadedUpdate = vi.fn(async (_signal?: AbortSignal) => false);
  isAutomaticDownloadAllowed = vi.fn(() => true);
  lastCheckedAt = vi.fn<() => number | null>(() => Date.now());
  downloadUpdate = vi.fn(async (_signal?: AbortSignal) => {
    this.emit('update-downloaded');
  });
  quitAndInstall = vi.fn();
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
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
    await s.service.dispose();
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
    const disposed = s.service.dispose();
    const events = s.emit.mock.calls.length;
    done();
    await pending;
    await disposed;
    expect(s.emit).toHaveBeenCalledTimes(events);
    expect(s.driver.cancel).toHaveBeenCalledTimes(1);
    expect(s.driver.listenerCount('update-available')).toBe(0);
    expect(s.driver.dispose).toHaveBeenCalledOnce();
  });
  it('跨启动的完整安装包先离线复原，自动下载关闭也直接显示可安装', async () => {
    for (const automatic of [false, true]) {
      const s = setup(automatic);
      s.driver.restoreDownloadedUpdate.mockImplementationOnce(async (signal) => {
        expect(signal?.aborted).toBe(false);
        s.driver.emit('download-progress', { percent: 50 });
        s.driver.emit('update-downloaded');
        return true;
      });
      await s.service.start();
      expect(s.driver.checkForUpdates).toHaveBeenCalledExactlyOnceWith(false);
      expect(s.driver.restoreDownloadedUpdate).toHaveBeenCalledOnce();
      expect(s.driver.downloadUpdate).not.toHaveBeenCalled();
      expect(s.service.state()).toMatchObject({
        phase: 'downloaded',
        availableVersion: '0.2.0',
        progress: 100,
        autoDownload: automatic,
      });
      expect(s.driver.quitAndInstall).not.toHaveBeenCalled();
      await s.service.install();
      expect(s.prepareInstall).toHaveBeenCalledOnce();
      expect(s.driver.quitAndInstall).toHaveBeenCalledExactlyOnceWith(false, true);
      await s.service.dispose();
    }
  });
  it('缓存重放保留驱动的成功检查时刻，失败或无成功记录不伪造刚检查过', async () => {
    const s = setup(false);
    s.driver.lastCheckedAt.mockReturnValue(123456);
    await s.service.check();
    expect(s.service.state().lastCheckedAt).toBe(123456);
    await s.service.check();
    expect(s.service.state().lastCheckedAt).toBe(123456);
    s.driver.checkForUpdates.mockRejectedValueOnce(Error('network unavailable'));
    await s.service.check();
    expect(s.service.state()).toMatchObject({ phase: 'error', lastCheckedAt: 123456 });
    s.driver.lastCheckedAt.mockReturnValue(null);
    s.driver.checkForUpdates.mockImplementationOnce(async () => {
      s.driver.emit('update-not-available');
      return { cancellationToken: { cancel: s.driver.cancel } };
    });
    const restores = s.driver.restoreDownloadedUpdate.mock.calls.length;
    await s.service.check(true);
    expect(s.service.state()).toMatchObject({
      phase: 'idle',
      availableVersion: null,
      lastCheckedAt: null,
    });
    expect(s.driver.restoreDownloadedUpdate).toHaveBeenCalledTimes(restores);
    await s.service.dispose();
  });
  it('下载冷却阻止启动和开关触发的自动下载，强制检查把force交给驱动解除限制', async () => {
    const s = setup();
    s.driver.isAutomaticDownloadAllowed.mockReturnValue(false);
    await s.service.start();
    expect(s.service.state().phase).toBe('available');
    expect(s.driver.restoreDownloadedUpdate).toHaveBeenCalledOnce();
    s.service.setAutoDownload(false);
    s.service.setAutoDownload(true);
    expect(s.driver.downloadUpdate).not.toHaveBeenCalled();
    s.driver.checkForUpdates.mockImplementationOnce(async (force) => {
      expect(force).toBe(true);
      s.driver.isAutomaticDownloadAllowed.mockReturnValue(true);
      s.driver.emit('update-available', { version: '0.2.0' });
      return { cancellationToken: { cancel: s.driver.cancel } };
    });
    await s.service.check(true);
    expect(s.driver.checkForUpdates).toHaveBeenLastCalledWith(true);
    expect(s.driver.downloadUpdate).toHaveBeenCalledOnce();
    expect(s.service.state().phase).toBe('downloaded');
    await s.service.dispose();
  });
  it('手动下载可绕过自动下载冷却，不取消已验证安装包的阶段保护', async () => {
    const s = setup(false);
    s.driver.isAutomaticDownloadAllowed.mockReturnValue(false);
    await s.service.check();
    await s.service.download();
    expect(s.driver.downloadUpdate).toHaveBeenCalledOnce();
    expect(s.service.state().phase).toBe('downloaded');
    await s.service.check(true);
    expect(s.driver.checkForUpdates).toHaveBeenCalledExactlyOnceWith(false);
    await s.service.dispose();
  });
  it('复原校验期间并发检查与手动/自动下载都不绕过本地恢复', async () => {
    const s = setup(false);
    const restoring = deferred<void>(),
      restored = deferred<boolean>();
    s.driver.restoreDownloadedUpdate.mockImplementationOnce(() => {
      restoring.resolve();
      return restored.promise;
    });
    const check = s.service.check();
    await restoring.promise;
    await s.service.check(true);
    const manual = s.service.download();
    s.service.setAutoDownload(true);
    expect(s.driver.checkForUpdates).toHaveBeenCalledOnce();
    expect(s.driver.downloadUpdate).not.toHaveBeenCalled();
    expect(s.service.state().phase).toBe('available');
    restored.resolve(true);
    await Promise.all([check, manual]);
    expect(s.service.state().phase).toBe('downloaded');
    expect(s.driver.downloadUpdate).not.toHaveBeenCalled();
    await s.service.dispose();
  });
  it('本地无完整安装包才执行等待中的手动下载', async () => {
    const s = setup(false);
    const restoring = deferred<void>(),
      restored = deferred<boolean>();
    s.driver.restoreDownloadedUpdate.mockImplementationOnce(() => {
      restoring.resolve();
      return restored.promise;
    });
    const checking = s.service.check();
    await restoring.promise;
    const manual = s.service.download();
    expect(s.driver.downloadUpdate).not.toHaveBeenCalled();
    restored.resolve(false);
    await Promise.all([checking, manual]);
    expect(s.driver.downloadUpdate).toHaveBeenCalledOnce();
    expect(s.service.state().phase).toBe('downloaded');
    await s.service.dispose();
  });
  it('等待恢复的手动点击不能把恢复异常自动重试为HTTP下载', async () => {
    const s = setup(false);
    const restoring = deferred<void>(),
      restored = deferred<boolean>();
    s.driver.restoreDownloadedUpdate.mockImplementationOnce(() => {
      restoring.resolve();
      return restored.promise;
    });
    const checking = s.service.check();
    await restoring.promise;
    const manual = s.service.download();
    restored.reject(Error('cache cleanup failed'));
    await Promise.all([checking, manual]);
    expect(s.service.state().phase).toBe('error');
    expect(s.driver.downloadUpdate).not.toHaveBeenCalled();
    await s.service.dispose();
  });
  it('本地恢复或清理失败明确报错，不把失败当作无缓存继续自动HTTP下载', async () => {
    const s = setup();
    s.driver.restoreDownloadedUpdate.mockRejectedValueOnce(Error('C:/private/pending'));
    await s.service.start();
    expect(s.service.state()).toMatchObject({
      phase: 'error',
      error: '更新下载或校验失败，请重试下载。',
    });
    expect(s.driver.downloadUpdate).not.toHaveBeenCalled();
    expect(JSON.stringify(s.service.state())).not.toContain('C:/private');
    await s.service.download();
    expect(s.service.state().phase).toBe('downloaded');
    await s.service.dispose();
  });
  it('取消清理错误不能被已取消的signal吞掉', async () => {
    const s = setup(false);
    await s.service.check();
    const cleanup = deferred<void>();
    s.driver.downloadUpdate.mockImplementationOnce(() => cleanup.promise);
    const pending = s.service.download();
    const cancelled = s.service.cancel();
    cleanup.reject(Error('C:/private/cannot-remove-partial'));
    await Promise.all([pending, cancelled]);
    expect(s.service.state()).toMatchObject({
      phase: 'error',
      error: '更新下载或校验失败，请重试下载。',
    });
    await s.service.dispose();
  });
  it('旧驱动的可选接口缺失与正常CancellationError仍兼容', async () => {
    const s = setup(false);
    Object.assign(s.driver, {
      restoreDownloadedUpdate: undefined,
      isAutomaticDownloadAllowed: undefined,
      lastCheckedAt: undefined,
    });
    await s.service.check();
    expect(s.service.state().lastCheckedAt).toBeTypeOf('number');
    s.driver.downloadUpdate.mockImplementationOnce(
      (signal) =>
        new Promise((_, reject) => {
          signal!.addEventListener(
            'abort',
            () => reject(Object.assign(Error('cancelled'), { name: 'CancellationError' })),
            { once: true },
          );
        }),
    );
    const pending = s.service.download();
    await s.service.cancel();
    await pending;
    expect(s.service.state()).toMatchObject({ phase: 'available', progress: null, error: null });
    await s.service.dispose();
    expect(s.driver.dispose).toHaveBeenCalledOnce();
  });
  it('退出等待本地恢复和驱动清理，期间立即移除监听并拒绝所有迟到状态', async () => {
    const s = setup();
    const restoring = deferred<void>(),
      restored = deferred<boolean>(),
      cleanup = deferred<void>();
    let signal!: AbortSignal;
    s.driver.restoreDownloadedUpdate.mockImplementationOnce((value) => {
      signal = value!;
      restoring.resolve();
      return restored.promise;
    });
    s.driver.dispose.mockReturnValueOnce(cleanup.promise);
    const checking = s.service.check();
    await restoring.promise;
    const disposal = s.service.dispose();
    expect(s.service.dispose()).toBe(disposal);
    expect(signal.aborted).toBe(true);
    expect(s.driver.listenerCount('update-available')).toBe(0);
    expect(s.driver.listenerCount('update-downloaded')).toBe(0);
    const events = s.emit.mock.calls.length;
    let finished = false;
    void disposal.then(() => {
      finished = true;
    });
    s.driver.emit('update-downloaded');
    restored.resolve(true);
    await checking;
    expect(finished).toBe(false);
    cleanup.resolve();
    await disposal;
    expect(finished).toBe(true);
    expect(s.emit).toHaveBeenCalledTimes(events);
    expect(s.driver.downloadUpdate).not.toHaveBeenCalled();
  });
  it('退出取消下载会等清理完成，失败以脱敏错误拒绝退出清理结果', async () => {
    const s = setup(false);
    await s.service.check();
    const cleanup = deferred<void>();
    s.driver.downloadUpdate.mockImplementationOnce(() => cleanup.promise);
    const pending = s.service.download();
    const disposal = s.service.dispose();
    cleanup.reject(Error('C:/private/cannot-remove-partial'));
    await expect(disposal).rejects.toThrow('更新清理失败，请重试退出。');
    await pending;
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
