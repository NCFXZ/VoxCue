import type { UpdateState } from '../../contracts/updates';

// Only the native adapter owns electron-updater, release URLs and downloaded paths.
type UpdateDriverEvent =
  'update-available' | 'update-not-available' | 'download-progress' | 'update-downloaded' | 'error';
export interface UpdateDriver {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  allowDowngrade: boolean;
  allowPrerelease: boolean;
  on(event: UpdateDriverEvent, listener: (...args: any[]) => void): unknown;
  removeListener(event: UpdateDriverEvent, listener: (...args: any[]) => void): unknown;
  checkForUpdates(force?: boolean): Promise<{ cancellationToken?: { cancel(): void } } | null>;
  restoreDownloadedUpdate?(signal?: AbortSignal): Promise<boolean>;
  isAutomaticDownloadAllowed?(): boolean;
  lastCheckedAt?(): number | null;
  downloadUpdate(signal?: AbortSignal): Promise<unknown>;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void | Promise<void>;
  dispose?(): void | Promise<void>;
}

const isCancellation = (error: unknown) =>
  error instanceof Error && ['AbortError', 'CancellationError'].includes(error.name);

export class UpdateService {
  private value: UpdateState;
  private disposed = false;
  private started = false;
  private listeners: Array<[UpdateDriverEvent, (...args: any[]) => void]> = [];
  private cancellation: { cancel(): void } | undefined;
  private checkController?: AbortController;
  private checkJob?: Promise<UpdateState>;
  private downloadController?: AbortController;
  private downloadJob?: Promise<UpdateState>;
  private disposeJob?: Promise<void>;
  private cleanupFailed = false;

  constructor(
    private readonly options: {
      currentVersion: string;
      autoDownload?: boolean;
      saveAutoDownload?(enabled: boolean): void;
      driver?: UpdateDriver;
      unavailableReason?: string;
      isInterviewActive(): boolean;
      prepareInstall(): Promise<boolean>;
      emit(state: UpdateState): void;
    },
  ) {
    this.value = {
      revision: 0,
      currentVersion: options.currentVersion,
      autoDownload: options.autoDownload ?? true,
      phase: options.driver ? 'idle' : 'unavailable',
      availableVersion: null,
      progress: null,
      lastCheckedAt: null,
      message: options.driver
        ? null
        : (options.unavailableReason ?? '请使用安装版 VoxCue 获取更新。'),
      error: null,
      interviewActive: false,
    };
    const driver = options.driver;
    if (!driver) return;
    driver.autoDownload = false;
    // Installation always requires an explicit click and a successful local save.
    driver.autoInstallOnAppQuit = false;
    driver.allowDowngrade = false;
    driver.allowPrerelease = false;
    this.listen('update-available', (info: { version?: unknown }) => {
      if (this.value.phase !== 'checking') return;
      if (
        typeof info?.version !== 'string' ||
        !/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(info.version) ||
        info.version.length > 80
      ) {
        this.change({ phase: 'error', error: '更新版本信息无效，请稍后重试。' });
        return;
      }
      this.change({
        phase: 'available',
        availableVersion: info.version,
        lastCheckedAt: driver.lastCheckedAt ? driver.lastCheckedAt() : Date.now(),
      });
    });
    this.listen('update-not-available', () => {
      if (this.value.phase === 'checking')
        this.change({
          phase: 'idle',
          availableVersion: null,
          lastCheckedAt: driver.lastCheckedAt ? driver.lastCheckedAt() : Date.now(),
        });
    });
    this.listen('download-progress', (progress: { percent?: unknown }) => {
      if (
        this.value.phase === 'downloading' &&
        !this.downloadController?.signal.aborted &&
        typeof progress?.percent === 'number' &&
        Number.isFinite(progress.percent)
      )
        this.change({ progress: Math.max(0, Math.min(100, progress.percent)) });
    });
    this.listen('update-downloaded', () => {
      if (this.value.phase === 'downloading' && !this.downloadController?.signal.aborted)
        this.change({ phase: 'downloaded', progress: 100, error: null });
    });
    this.listen('error', () => {
      if (this.value.phase === 'downloading' && this.downloadController?.signal.aborted) return;
      if (!['checking', 'downloading', 'installing'].includes(this.value.phase)) return;
      this.fail(this.value.phase);
    });
  }

  state(): UpdateState {
    return { ...this.value, interviewActive: this.options.isInterviewActive() };
  }

  refresh() {
    this.change({});
  }

  setAutoDownload(enabled: boolean) {
    if (this.disposed) return this.state();
    try {
      this.options.saveAutoDownload?.(enabled);
      this.change({ autoDownload: enabled, error: null });
    } catch {
      this.change({ error: '自动下载设置未能保存，请重试。' });
      return this.state();
    }
    this.maybeDownload();
    return this.state();
  }

  private maybeDownload() {
    if (
      this.disposed ||
      this.checkController ||
      !this.value.autoDownload ||
      this.value.phase !== 'available'
    )
      return;
    try {
      if (this.options.driver?.isAutomaticDownloadAllowed?.() !== false) void this.download();
    } catch {
      this.fail('downloading');
    }
  }

  private listen(event: UpdateDriverEvent, listener: (...args: any[]) => void) {
    const guarded = (...args: any[]) => {
      if (!this.disposed) listener(...args);
    };
    this.listeners.push([event, guarded]);
    this.options.driver!.on(event, guarded);
  }

  private change(value: Partial<UpdateState>) {
    if (this.disposed) return;
    this.value = { ...this.value, ...value, revision: this.value.revision + 1 };
    this.options.emit(this.state());
  }

  private fail(phase: string) {
    this.change({
      phase: phase === 'installing' ? 'downloaded' : 'error',
      error:
        phase === 'checking'
          ? '检查更新失败，请检查网络连接或稍后重试。'
          : phase === 'downloading'
            ? '更新下载或校验失败，请重试下载。'
            : '更新尚未安装，窗口已保留。请确认聊天已保存后重试。',
    });
  }

  async start() {
    if (this.started || this.disposed || !this.options.driver) return;
    this.started = true;
    await this.check();
    if (this.downloadJob) await this.downloadJob;
  }

  check(force = false) {
    if (
      this.disposed ||
      this.checkController ||
      this.downloadJob ||
      !this.options.driver ||
      !['idle', 'available', 'error'].includes(this.value.phase)
    )
      return Promise.resolve(this.state());
    const controller = new AbortController();
    this.checkController = controller;
    this.change({ phase: 'checking', error: null, progress: null });
    this.checkJob = (async () => {
      let restoring = false;
      try {
        const result = await this.options.driver!.checkForUpdates(force);
        if (this.disposed) {
          try {
            result?.cancellationToken?.cancel();
          } catch {
            this.cleanupFailed = true;
          }
        } else this.cancellation = result?.cancellationToken;
        if (!this.disposed && this.value.phase === 'checking') this.fail('checking');
        if (
          !this.disposed &&
          this.value.phase === 'available' &&
          this.options.driver!.restoreDownloadedUpdate
        ) {
          restoring = true;
          const restored = await this.options.driver!.restoreDownloadedUpdate(controller.signal);
          if (!this.disposed && !controller.signal.aborted && restored)
            this.change({ phase: 'downloaded', progress: 100, error: null });
        }
      } catch (error) {
        if (this.disposed) {
          if (restoring && !isCancellation(error)) this.cleanupFailed = true;
        } else if (
          (!controller.signal.aborted || !isCancellation(error)) &&
          this.value.phase === (restoring ? 'available' : 'checking')
        ) {
          this.fail(restoring ? 'downloading' : 'checking');
        }
      }
    })()
      .finally(() => {
        this.checkController = undefined;
        this.checkJob = undefined;
      })
      .then(() => {
        this.maybeDownload();
        return this.state();
      });
    return this.checkJob;
  }

  download(): Promise<UpdateState> {
    if (this.downloadJob) return this.downloadJob;
    // A manual click during local cache verification waits for that result.
    // A reusable installer must never race a new HTTP download.
    if (this.checkController)
      return (
        this.checkJob?.then((state) =>
          ['available', 'downloading'].includes(state.phase) ? this.download() : state,
        ) ?? Promise.resolve(this.state())
      );
    if (
      this.disposed ||
      !this.options.driver ||
      !this.value.availableVersion ||
      !['available', 'error'].includes(this.value.phase)
    )
      return Promise.resolve(this.state());
    const controller = new AbortController();
    this.downloadController = controller;
    this.change({ phase: 'downloading', progress: 0, error: null });
    this.downloadJob = (async () => {
      try {
        await this.options.driver!.downloadUpdate(controller.signal);
        if (!this.disposed && !controller.signal.aborted && this.value.phase === 'downloading')
          this.fail('downloading');
      } catch (error) {
        if (this.disposed && controller.signal.aborted && !isCancellation(error))
          this.cleanupFailed = true;
        if (
          (!controller.signal.aborted || !isCancellation(error)) &&
          this.value.phase === 'downloading'
        )
          this.fail('downloading');
      }
      if (controller.signal.aborted && this.value.phase === 'downloading')
        this.change({ phase: 'available', progress: null, error: null });
      return this.state();
    })().finally(() => {
      this.downloadController = undefined;
      this.downloadJob = undefined;
    });
    return this.downloadJob;
  }

  cancel() {
    this.downloadController?.abort();
    return this.downloadJob ?? Promise.resolve(this.state());
  }

  async install() {
    if (this.disposed || !this.options.driver || this.value.phase !== 'downloaded')
      return this.state();
    if (this.options.isInterviewActive()) {
      this.change({ error: '面试进行中，请结束面试后重启并更新。' });
      return this.state();
    }
    this.change({ phase: 'installing', error: null });
    try {
      const ready = await this.options.prepareInstall();
      if (this.disposed) return this.state();
      if (this.options.isInterviewActive()) {
        this.change({ phase: 'downloaded', error: '面试进行中，请结束面试后重启并更新。' });
      } else if (!ready) {
        this.change({ phase: 'downloaded' });
      } else {
        await this.options.driver.quitAndInstall(false, true);
      }
    } catch {
      this.fail('installing');
    }
    return this.state();
  }

  dispose(): Promise<void> {
    if (this.disposeJob) return this.disposeJob;
    this.disposed = true;
    this.checkController?.abort();
    this.downloadController?.abort();
    try {
      this.cancellation?.cancel();
    } catch {
      this.cleanupFailed = true;
    }
    for (const [event, listener] of this.listeners)
      this.options.driver?.removeListener(event, listener);
    this.listeners = [];
    let cleanup: Promise<void>;
    try {
      cleanup = Promise.resolve(this.options.driver?.dispose?.());
    } catch {
      cleanup = Promise.reject(new Error('更新清理失败，请重试退出。'));
    }
    this.disposeJob = Promise.allSettled([this.checkJob, this.downloadJob, cleanup]).then(
      (results) => {
        if (this.cleanupFailed || results.some((result) => result.status === 'rejected'))
          throw new Error('更新清理失败，请重试退出。');
      },
    );
    return this.disposeJob;
  }
}
