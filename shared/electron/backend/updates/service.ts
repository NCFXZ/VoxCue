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
  checkForUpdates(): Promise<{ cancellationToken?: { cancel(): void } } | null>;
  downloadUpdate(): Promise<unknown>;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
  dispose?(): void;
}

export class UpdateService {
  private value: UpdateState;
  private disposed = false;
  private started = false;
  private listeners: Array<[UpdateDriverEvent, (...args: any[]) => void]> = [];
  private cancellation: { cancel(): void } | undefined;

  constructor(
    private readonly options: {
      currentVersion: string;
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
        lastCheckedAt: Date.now(),
      });
    });
    this.listen('update-not-available', () => {
      if (this.value.phase === 'checking')
        this.change({ phase: 'idle', availableVersion: null, lastCheckedAt: Date.now() });
    });
    this.listen('download-progress', (progress: { percent?: unknown }) => {
      if (
        this.value.phase === 'downloading' &&
        typeof progress?.percent === 'number' &&
        Number.isFinite(progress.percent)
      )
        this.change({ progress: Math.max(0, Math.min(100, progress.percent)) });
    });
    this.listen('update-downloaded', () => {
      if (this.value.phase === 'downloading')
        this.change({ phase: 'downloaded', progress: 100, error: null });
    });
    this.listen('error', () => {
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
    if (!this.disposed && this.value.phase === 'available') await this.download();
  }

  async check() {
    if (
      this.disposed ||
      !this.options.driver ||
      !['idle', 'available', 'error'].includes(this.value.phase)
    )
      return this.state();
    this.change({ phase: 'checking', error: null, progress: null });
    try {
      const result = await this.options.driver.checkForUpdates();
      if (this.disposed) result?.cancellationToken?.cancel();
      else this.cancellation = result?.cancellationToken;
      if (!this.disposed && this.value.phase === 'checking') this.fail('checking');
    } catch {
      if (this.value.phase === 'checking') this.fail('checking');
    }
    return this.state();
  }

  async download() {
    if (
      this.disposed ||
      !this.options.driver ||
      !this.value.availableVersion ||
      !['available', 'error'].includes(this.value.phase)
    )
      return this.state();
    this.change({ phase: 'downloading', progress: 0, error: null });
    try {
      await this.options.driver.downloadUpdate();
      if (!this.disposed && this.value.phase === 'downloading') this.fail('downloading');
    } catch {
      if (this.value.phase === 'downloading') this.fail('downloading');
    }
    return this.state();
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
        this.options.driver.quitAndInstall(false, true);
      }
    } catch {
      this.fail('installing');
    }
    return this.state();
  }

  dispose() {
    this.disposed = true;
    this.cancellation?.cancel();
    this.options.driver?.dispose?.();
    for (const [event, listener] of this.listeners)
      this.options.driver?.removeListener(event, listener);
    this.listeners = [];
  }
}
